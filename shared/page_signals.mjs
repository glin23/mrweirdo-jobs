// page_signals.mjs — read-only in-page checks for "did the page really get it?"
// (真投 2026-09-27, BUG_REPORT 第 2 章: three Ashby clicks landed while the
// resume upload was still in flight; Ashby dropped them silently, no request left
// the browser, and the ledger said "may have submitted").
//
// Each function below runs INSIDE the tab: the driver injects its source via
// pageCall(fn, ...args) → `(<fn source>)(performance, ...args)`. The same source
// is unit-tested in node against a fake `performance`, so the tested code is the
// shipped code. Consequences for page-side code: no imports, no outer constants,
// no closures — everything a function needs is a parameter or a literal.
//
// Only the browser's own Resource Timing list and the form's own field values
// are read. Nothing is clicked, typed, delayed or changed to look human: this is about knowing what happened,
// never about getting past a platform's checks.

// Ashby form-state traffic (restart-apply-3 BUG_REPORT 第 2 章, Ashby's public
// front-end script): every text box saves itself 500ms after typing through
// graphql ApiSetFormValue; files go to S3 (loaded-files-*) and are attached by
// graphql ApiSetFile. While ANY of these is in flight, Ashby's submit handler
// only shows a toast that fades — no submission request leaves the browser.
// Patterns are strings so they can travel into the page through pageCall.
export const ASHBY_FORM_TRAFFIC = 'graphql|loaded-files|amazonaws\\.com';
// The only requests that submit an Ashby application.
export const ASHBY_SUBMIT_REQUEST = 'ApiSubmit(?:SingleApplicationForm|MultipleForms)Action';

// Page-idle gate, page half (one gate for uploads and field saves). Counts the
// finished form-state requests since `since`; settled = same count as the
// previous poll. A Resource Timing entry exists only once its request has
// finished, so this half cannot see a request in flight — the CDP half
// (netIdleTracker, run by `cdp.mjs netidle`) does. With `needUpload`, the
// upload must also be observably done: an S3 request and a graphql call after it.
export function formSettled(perf, since, prevCount, needUpload) {
  const all = perf.getEntriesByType('resource');
  if (all.length >= 250) return { settled: null, why: 'resource_buffer_full', count: all.length };
  const form = all.filter((e) => e.startTime >= since && /graphql|loaded-files|amazonaws\.com/i.test(e.name));
  if (needUpload) {
    const uploads = form.filter((e) => /loaded-files|amazonaws\.com/i.test(e.name));
    if (!uploads.length) return { settled: false, why: 'no_upload_request_yet', count: form.length };
    const uploadEnd = Math.max(...uploads.map((e) => e.responseEnd));
    if (!form.some((e) => /graphql/i.test(e.name) && e.startTime >= uploadEnd)) {
      return { settled: false, why: 'upload_not_confirmed', count: form.length };
    }
  }
  const quiet = form.length === prevCount;
  return { settled: quiet, why: quiet ? 'quiet' : 'still_loading', count: form.length };
}

// Did the submit click reach the page? `mark` = { t: performance.now(), origin:
// performance.timeOrigin } taken in the same eval as the click.
//   true  — a new document (navigated to a confirmation page), or a request
//           started after the click. With `submitPattern` (Ashby) only a
//           request whose URL matches it counts: the page autosaves fields all
//           the time, and an autosave after the click is not the click being
//           received (restart-apply-3: Prior Labs / Rillet).
//   false — same document, no (matching) request since the click
//   null  — the 250-entry buffer is full, so absence proves nothing
// Callers treat only `false` as "not received"; null is never read as false.
export function clickReceived(perf, mark, submitPattern) {
  if (perf.timeOrigin !== mark.origin) return { registered: true, via: 'new_document' };
  const all = perf.getEntriesByType('resource');
  if (all.length >= 250) return { registered: null, via: 'resource_buffer_full' };
  const after = all.filter((e) => e.startTime >= mark.t);
  const hits = submitPattern ? after.filter((e) => new RegExp(submitPattern, 'i').test(e.name)) : after;
  const none = submitPattern ? 'no_submit_request_after_click' : 'no_request_after_click';
  return {
    registered: hits.length > 0,
    via: hits.length ? (submitPattern ? 'submit_request_after_click' : 'request_after_click') : none,
    requests: after.slice(0, 8).map((e) => String(e.name).slice(0, 120)),
  };
}

// Required fields still empty on the page (visible text boxes / textareas /
// selects with no value; required radio groups with nothing picked). Evidence
// for "the platform can only refuse this form": Ashby's server answers such a
// submission with a missing-field list, so a click that sent nothing on such a
// page did not submit anything. Read-only; runs in the page like the others
// (`document` is the page's own).
export function emptyRequiredFields() {
  const labelOf = (el) => {
    const l = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
    return String((l && l.innerText) || el.getAttribute('aria-label') || el.name || el.id || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  };
  const isRequired = (el) => el.required === true || el.getAttribute('aria-required') === 'true';
  const fields = [];
  const groups = new Map();
  for (const el of document.querySelectorAll('input, textarea, select')) {
    if (!isRequired(el) || el.offsetParent === null) continue;
    const type = String(el.type || '').toLowerCase();
    if (['hidden', 'file', 'submit', 'button', 'checkbox'].includes(type)) continue;
    if (type === 'radio') {
      const key = el.name || el.id;
      groups.set(key, (groups.get(key) || false) || el.checked === true);
      continue;
    }
    if (String(el.value ?? '').trim() === '') fields.push(labelOf(el));
  }
  for (const [name, picked] of groups) if (!picked) fields.push(name);
  return { ok: true, fields };
}

export const pageCall = (fn, ...args) => `(${fn.toString()})(performance, ${args.map((a) => JSON.stringify(a)).join(', ')})`;

// ---- node side (NOT injected) ------------------------------------------------
// verify 第 19 轮 P2: Resource Timing lists only FINISHED requests, so a
// submission still in flight looked like "nothing was sent" and got a second
// click. The decision therefore leans on the CDP watch taken in the same session
// as the click (cdp.mjs clickwatch: Network.requestWillBeSent fires the moment a
// request is sent, finished or not). "Not received" needs BOTH to be empty:
// the watch ran and saw no request for its whole window, and the page's own list
// shows none either on the same document. Anything short of that is null —
// cannot tell — and the caller does not click again (宁可漏投不可重投).
export function clickVerdict(watch, received, submitPattern) {
  if (received?.registered === true) return { registered: true, via: received.via || 'page_signal' };
  const sent = Array.isArray(watch?.requests)
    ? (submitPattern ? watch.requests.filter((r) => new RegExp(submitPattern, 'i').test(String(r?.url || ''))) : watch.requests)
    : [];
  if (watch?.ok === true && sent.length > 0) {
    return { registered: true, via: submitPattern ? 'submit_request_sent_after_click' : 'request_sent_after_click', requests: sent.slice(0, 8) };
  }
  if (watch?.ok !== true || !Array.isArray(watch.requests)) return { registered: null, via: 'click_watch_unavailable', watch_error: watch?.error || null };
  if (received?.registered !== false) return { registered: null, via: received?.via || 'page_signal_unavailable' };
  return {
    registered: false,
    via: submitPattern ? 'no_submit_request_sent_after_click' : 'no_request_sent_after_click',
    watched_ms: watch.window_ms ?? null,
    ...(submitPattern ? { other_requests: watch.requests.slice(0, 8).map((r) => String(r?.url || '').slice(0, 120)) } : {}),
  };
}

// Page-idle gate, CDP half: fed Network events from `cdp.mjs netidle`, it knows
// which matching requests are IN FLIGHT (sent, not yet finished or failed) —
// what Resource Timing cannot show. idleFor = how long nothing matching has
// been in flight (0 while one is). Requests that were already in flight when
// the watch started are invisible here; formSettled's stable count catches
// those when they finish.
export function netIdleTracker(pattern) {
  const re = pattern ? new RegExp(pattern, 'i') : null;
  const inflight = new Map();
  const seen = [];
  let lastActivity = null;
  return {
    onEvent(msg, now) {
      const p = msg?.params || {};
      if (msg?.method === 'Network.requestWillBeSent') {
        const url = String(p.request?.url || '');
        if (re && !re.test(url)) return;
        inflight.set(p.requestId, url);
        if (seen.length < 20) seen.push(url.slice(0, 160));
        lastActivity = now;
      } else if (msg?.method === 'Network.loadingFinished' || msg?.method === 'Network.loadingFailed') {
        if (inflight.delete(p.requestId)) lastActivity = now;
      }
    },
    idleFor(now, start) {
      if (inflight.size) return 0;
      return now - (lastActivity ?? start);
    },
    inflight: () => [...inflight.values()],
    seen,
  };
}
