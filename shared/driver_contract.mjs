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

// The ONLY exit for a driver's final result: one structured JSON line on
// stdout, then the mapped exit code. Drivers must not use bare process.exit
// for outcomes (usage errors excepted). `io` is a test seam; production
// callers pass nothing.
export function emitOutcome(obj, io = {}) {
  const valid = validateOutcome(obj);
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
