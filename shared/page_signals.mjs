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
// Only the browser's own Resource Timing list is read. Nothing is clicked,
// typed, delayed or changed to look human: this is about knowing what happened,
// never about getting past a platform's checks.

// Ashby resume/cover-letter upload: the file goes to S3 (loaded-files-*), then a
// graphql call attaches it (BUG_REPORT 第 2 章 network records on all 5 pages).
// Settled = both are back AND no new request since the previous poll.
// A Resource Timing entry only exists once its request has finished, so
// "in flight" is invisible here; the second condition covers it.
export function uploadSettled(perf, since, prevCount) {
  const all = perf.getEntriesByType('resource');
  if (all.length >= 250) return { settled: null, why: 'resource_buffer_full', count: all.length };
  const after = all.filter((e) => e.startTime >= since);
  const uploads = after.filter((e) => /loaded-files|amazonaws\.com/i.test(e.name));
  if (!uploads.length) return { settled: false, why: 'no_upload_request_yet', count: after.length };
  const uploadEnd = Math.max(...uploads.map((e) => e.responseEnd));
  if (!after.some((e) => /graphql/i.test(e.name) && e.startTime >= uploadEnd)) {
    return { settled: false, why: 'upload_not_confirmed', count: after.length };
  }
  const quiet = after.length === prevCount;
  return { settled: quiet, why: quiet ? 'quiet' : 'still_loading', count: after.length };
}

// Did the submit click reach the page? `mark` = { t: performance.now(), origin:
// performance.timeOrigin } taken in the same eval as the click.
//   true  — a new document (navigated to a confirmation page) or any request
//           started after the click (Ashby: seon / recaptcha clr / non-user-graphql)
//   false — same document, zero requests since the click: nothing was sent
//   null  — the 250-entry buffer is full, so absence proves nothing
// Callers treat only `false` as "not received"; null is never read as false.
export function clickReceived(perf, mark) {
  if (perf.timeOrigin !== mark.origin) return { registered: true, via: 'new_document' };
  const all = perf.getEntriesByType('resource');
  if (all.length >= 250) return { registered: null, via: 'resource_buffer_full' };
  const after = all.filter((e) => e.startTime >= mark.t);
  return {
    registered: after.length > 0,
    via: after.length ? 'request_after_click' : 'no_request_after_click',
    requests: after.slice(0, 8).map((e) => String(e.name).slice(0, 120)),
  };
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
export function clickVerdict(watch, received) {
  if (received?.registered === true) return { registered: true, via: received.via || 'page_signal' };
  if (watch?.ok === true && Array.isArray(watch.requests) && watch.requests.length > 0) {
    return { registered: true, via: 'request_sent_after_click', requests: watch.requests.slice(0, 8) };
  }
  if (watch?.ok !== true || !Array.isArray(watch.requests)) return { registered: null, via: 'click_watch_unavailable', watch_error: watch?.error || null };
  if (received?.registered !== false) return { registered: null, via: received?.via || 'page_signal_unavailable' };
  return { registered: false, via: 'no_request_sent_after_click', watched_ms: watch.window_ms ?? null };
}
