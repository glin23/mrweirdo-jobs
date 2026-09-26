// driver_contract.mjs — 三驱动统一退出契约（阶段 1 设计 §14 数字变真 / ADR-15）。
//
// Why: today every driver exits 0 and invents its own outcome words ('skip'
// with 20 reasons, 'error', 'essay_pending'), and the funnel silently converts
// a driver that died without output into a routine skip. The contract is one
// vocabulary + one exit-code map + one emission point, shaped after
// ai-job-agent's five-driver contract (ARCH_NOTES §7.3 调研笔记: 判不出时绝不谎报成功):
//
//   outcome          exit  meaning
//   submitted          0   page-level verdict said submitted (and ONLY then)
//   crashed            1   driver died / machinery failed (selector rot must ring)
//   needs_user         2   blocked on information only a human has (essay_pending 族)
//   not_submitted      2   page explicitly said the application did not go through
//   unknown            2   judged but unreadable — never counts as submitted
//   captcha_blocked    3   captcha / human-verification wall
//   rate_limited       4   step or quota ceiling (max attempts exceeded)
//
// There is no path from any non-zero state to a success record: outcome
// 'submitted' additionally REQUIRES verdict 'submitted'（§14.8 跨栈对照表——
// outcome 由 verdict 推出，反向不成立）, enforced in validateOutcome.

export const OUTCOMES = Object.freeze([
  'submitted',
  'not_submitted',
  'needs_user',
  'captcha_blocked',
  'rate_limited',
  'crashed',
  'unknown',
]);

export const EXIT_CODES = Object.freeze({
  submitted: 0,
  crashed: 1,
  needs_user: 2,
  not_submitted: 2,
  unknown: 2,
  captcha_blocked: 3,
  rate_limited: 4,
});

// FillEntry.source vocabulary（§14.3 数据结构一节）. Distinct from
// PROVENANCE_SOURCES on purpose: provenance records who put a value INTO the
// profile; this records where the value typed onto ONE form came from at fill time.
export const FILL_SOURCES = Object.freeze(['profile', 'bank_default', 'derived', 'user_confirmed', 'left_blank']);

// Funnel-side validation. Unknown outcome string = a producer bug, and the
// contract's whole point is that bugs here are heard, not bucketed (ADR-15:
// 响亮退出非静默兜底). Legacy words ('skip' / 'essay_pending' / 'error') are
// deliberately NOT aliased — every in-repo producer migrates in the same
// commit, and accepting them quietly would let the old vocabulary regrow.
export function validateOutcome(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || typeof obj.outcome !== 'string') {
    throw new Error(`driver outcome must be an object with an "outcome" string, got: ${JSON.stringify(obj).slice(0, 200)}`);
  }
  if (!OUTCOMES.includes(obj.outcome)) {
    throw new Error(
      `unknown driver outcome "${obj.outcome}" — not in the contract (${OUTCOMES.join('/')}). ` +
      'Legacy vocabulary must be migrated at the producer, never silently accepted here (ADR-15).'
    );
  }
  if (obj.outcome === 'submitted') {
    const verdict = obj.verdict && typeof obj.verdict === 'object' ? obj.verdict.verdict : obj.verdict;
    if (verdict !== 'submitted') {
      throw new Error(
        `outcome "submitted" without page verdict "submitted" (got ${JSON.stringify(verdict)}) — ` +
        'a submission claim must be backed by the single page-level judgement, not asserted（§14.8 跨栈一致性）.'
      );
    }
  }
  return obj;
}

// A driver's stdout must be written synchronously. On macOS a pipe write is
// asynchronous, and emitOutcome exits right after printing: anything past the
// first 64KB of a long outcome line (it carries every answer) was dropped, the
// recorder found no outcome and filed a crash — "may have submitted", slot
// used (same consequence as verify 第 7 轮 FLUSH). A blocking stdout makes every
// write complete before the next statement, so exiting immediately is safe and
// nothing after emitOutcome runs. Switched on as soon as a driver process loads
// this module, before its first write, so no async write is ever queued ahead
// of the outcome line; emitOutcome repeats it for any other caller.
function blockingStdout() {
  const handle = process.stdout._handle;
  if (handle && typeof handle.setBlocking === 'function') handle.setBlocking(true);
}
if (/_apply_driver\.mjs$/.test(process.argv[1] ?? '')) blockingStdout();

// The ONLY exit for a driver's final result: one structured JSON line on
// stdout, then the mapped exit code. Drivers must not use bare process.exit
// for outcomes (usage errors excepted). `io` is a test seam; production
// callers pass nothing.
export function emitOutcome(obj, io = {}) {
  const valid = validateOutcome(obj);
  if (!io.log) blockingStdout();
  (io.log || console.log)(JSON.stringify(valid));
  return (io.exit || process.exit)(EXIT_CODES[valid.outcome]);
}

// Accumulates one FillEntry {label, value, source, widget} onto the driver's
// answers array (ADR-16 全问答落盘). Kept strict: an answers log with holes is
// exactly the "答了什么已不可考" hole this exists to close.
export function recordFill(answers, entry) {
  if (!Array.isArray(answers)) throw new Error('recordFill: answers must be the driver-level array');
  const { label, value, source, widget } = entry || {};
  if (!label) throw new Error('recordFill: label is required');
  if (!FILL_SOURCES.includes(source)) {
    throw new Error(`recordFill: source "${source}" not in ${FILL_SOURCES.join('|')}`);
  }
  answers.push({
    label: String(label),
    value: String(value ?? ''),
    source,
    widget: String(widget || 'unknown'),
  });
  return answers;
}

// 「点提交之前」出口表（restart-apply DESIGN §3 / ADR-S6 第 2 轮）。Each key is
// "<outcome>:<reason>" at an exit read-verified to fire BEFORE the first click
// on Submit — the company received nothing:
//   crashed:ashby_form_not_loaded    ashby_apply_driver main(), before uploadResume
//   crashed:resume_upload_failed     ashby + greenhouse main(), before any submitAndCheck
//   not_submitted:job_unavailable    greenhouse (page says closed) / lever, before submit
//   crashed:cdp_goto_failed … submit_button_not_found   lever main() (Lever paused)
// Lever's pre-click needs_user / captcha_blocked exits are deliberately NOT
// listed: the key has no ATS, and the same keys (e.g. needs_user:
// cover_letter_required_not_generated) are emitted by greenhouse AFTER a click.
// A driver adding a pre-click exit must add its row here plus a test; a
// missing row costs one retry, never a re-application.
export const PRE_SUBMIT_EXITS = new Set([
  'crashed:ashby_form_not_loaded',
  'crashed:resume_upload_failed',
  'not_submitted:job_unavailable',
  'crashed:cdp_goto_failed',
  'crashed:helpers_inject_fail',
  'crashed:resume_upload_fail',
  'crashed:resume_storage_timeout',
  'crashed:submit_button_not_found',
]);

// apply_batch's synthesized line for a row that failed pre-dispatch validation:
// no driver ran at all.
export const PRE_DISPATCH_STAGE = 'pre_dispatch';

// The ONE place "may this attempt have reached the company?" is decided
// (ledger field may_have_submitted = the single 投过 predicate). Order:
//   1. pre-dispatch validation failure → false (no driver ran)
//   2. a page verdict is present (the post-submit page was read) → true
//   3. "<outcome>:<reason>" in PRE_SUBMIT_EXITS → false
//   4. needs_user / rate_limited carrying the page's required-field error list
//      (missing / still_missing / last_missing, non-empty) → false: the page
//      rejected the form (回炉第 1 轮, VERIFY_REPORT 第 2 轮 P1)
//   5. everything else → true — incl. driver_exception / died / recovered
//      in-flight, captcha_blocked, and needs_user without page evidence.
export function deriveMayHaveSubmitted(o) {
  const valid = validateOutcome(o);
  if (valid.stage === PRE_DISPATCH_STAGE) return false;
  if (valid.verdict != null) return true;
  if (PRE_SUBMIT_EXITS.has(`${valid.outcome}:${valid.reason ?? ''}`)) return false;
  // Submit was clicked, but the page stayed on the form listing required-field
  // errors → the form was rejected; nothing reached the company. Judged on the
  // page evidence, not the reason string (greenhouse builds reasons
  // dynamically). No error list = no evidence = stays true.
  const pageErrors = valid.missing ?? valid.still_missing ?? valid.last_missing;
  if (['needs_user', 'rate_limited'].includes(valid.outcome) && Array.isArray(pageErrors) && pageErrors.length > 0) return false;
  return true;
}
