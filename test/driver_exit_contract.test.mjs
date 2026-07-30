// 三驱动 × 统一退出契约（阶段 1 设计 §14.10 提交 4 / ADR-15）——驱动替身测试：
// 跑的是出货驱动自己的 main()，只有浏览器边界是替身；最终结局必须走 emitOutcome
// 且词汇 / 退出码在契约表内。重点场景：
//   * Directive 失败横幅 → not_submitted，且第 1 次尝试就短路（不再烧 4 次盲目重试）
//   * 真成功 → submitted 且 verdict 同行（outcome 由 verdict 推出）
//   * 全问答（answers[]）随最终结局一起上交（ADR-16）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_CODES, validateOutcome } from '../shared/driver_contract.mjs';
import { loadDriver as loadAshby, BASE as ASHBY_BASE } from './ashby_driver_harness.mjs';
import { loadDriver as loadGreenhouse, BASE as GH_BASE } from './greenhouse_driver_harness.mjs';
import { loadDriver as loadLever, BASE as LEVER_BASE } from './lever_driver_harness.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'submission_pages');
const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8');

// captureEvidence resolves the state home AT CALL TIME — main() must always run
// with MRWEIRDO_HOME pointed at the throwaway home, never the real one.
async function withHome(home, fn) {
  const prev = process.env.MRWEIRDO_HOME;
  process.env.MRWEIRDO_HOME = home;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.MRWEIRDO_HOME; else process.env.MRWEIRDO_HOME = prev;
  }
}

// Runs a harnessed main() whose emitOutcome throws; returns the emitted object.
// Always under a throwaway MRWEIRDO_HOME — captureEvidence must never see the
// real state home from inside a test.
async function runToEmit(main) {
  const sandbox = mkdtempSync(join(tmpdir(), 'mrw-exit-contract-'));
  try {
    await withHome(sandbox, main);
  } catch (e) {
    if (e && e.emitted) return e.emitted;
    throw e;
  }
  throw new Error('main() finished without emitting an outcome — the contract says that cannot happen');
}

function setEvalRules(rules) {
  globalThis.__MRW_EVAL_RULES = rules;
  globalThis.__MRW_EMITTED = [];
}

function clearStubs() {
  delete globalThis.__MRW_EVAL_RULES;
  delete globalThis.__MRW_EMITTED;
  delete globalThis.__MRW_CDP_RULES;
}

// ---------------------------------------------------------------- Ashby -----

const ASHBY_PAGE = (bodyText, { missing = [], url = 'https://jobs.ashbyhq.com/testco/x' } = {}) =>
  ({ bodyText, missing, error_count: missing.length, url, snippet: bodyText.slice(0, 200) });

const ashbyBaseRules = () => ([
  { match: 'has_resume', result: { ready: 'complete', has_resume: true, input_count: 9, url: 'x', title: 't', body_text: '' } },
  { match: 'react_unmounted', result: { ok: true, files: 1, name: 'resume.pdf' } },
  { match: 'mrw_phone_temp', result: { found: false } },
]);

test('Ashby 出货 main()：真成功 → submitted / exit 0，verdict 与 answers 同行', async () => {
  const driver = await loadAshby(ASHBY_BASE);
  setEvalRules([
    ...ashbyBaseRules(),
    { match: 'error_count', result: ASHBY_PAGE(fixture('confirm_ashby_success.txt')) },
  ]);
  try {
    const emitted = await runToEmit(driver.main);
    assert.equal(emitted.outcome, 'submitted');
    assert.equal(EXIT_CODES[emitted.outcome], 0);
    assert.equal(emitted.verdict.verdict, 'submitted', 'outcome submitted must carry verdict submitted');
    const labels = emitted.answers.map((a) => a.label);
    assert.ok(labels.includes('_systemfield_name') && labels.includes('_systemfield_email'), `basics logged, got ${labels}`);
    assert.ok(emitted.answers.every((a) => a.source && a.widget), 'every FillEntry carries source+widget');
  } finally {
    clearStubs();
  }
});

test('Ashby 出货 main()：Directive 失败横幅 → not_submitted，第 1 次尝试就短路', async () => {
  const driver = await loadAshby(ASHBY_BASE);
  setEvalRules([
    ...ashbyBaseRules(),
    { match: 'error_count', result: ASHBY_PAGE(fixture('deny_directive_304.txt')) },
  ]);
  try {
    const emitted = await runToEmit(driver.main);
    assert.equal(emitted.outcome, 'not_submitted');
    assert.equal(emitted.reason, 'page_states_failure');
    assert.equal(EXIT_CODES[emitted.outcome], 2);
    assert.equal(emitted.attempt, 1, 'the failure page is terminal — no more 4 wasted retries');
  } finally {
    clearStubs();
  }
});

test('Ashby 出货 main()：读不懂的页面 → unknown（绝不默认成功）', async () => {
  const driver = await loadAshby(ASHBY_BASE);
  setEvalRules([
    ...ashbyBaseRules(),
    { match: 'error_count', result: ASHBY_PAGE('nothing recognizable on this page') },
  ]);
  try {
    const emitted = await runToEmit(driver.main);
    assert.equal(emitted.outcome, 'unknown');
    assert.equal(emitted.reason, 'no_errors_no_success');
    assert.equal(EXIT_CODES[emitted.outcome], 2);
  } finally {
    clearStubs();
  }
});

test('Ashby 出货 main()：答得上但换着法子缺字段 → 步数超限 rate_limited / exit 4 + 全问答落盘', async () => {
  const driver = await loadAshby(ASHBY_BASE);
  let round = 0;
  setEvalRules([
    ...ashbyBaseRules(),
    { match: 'label_for', result: { ok: true, sel: '#q_txt', via: 'label_for' } },
    { match: 'error_count', result: () => ASHBY_PAGE('errors remain', { missing: [`How did you hear about Acme (round ${round++})`] }) },
  ]);
  try {
    const emitted = await runToEmit(driver.main);
    assert.equal(emitted.outcome, 'rate_limited');
    assert.equal(emitted.reason, 'max_attempts_exceeded');
    assert.equal(EXIT_CODES[emitted.outcome], 4);
    const heard = emitted.answers.filter((a) => /how did you hear/i.test(a.label));
    assert.ok(heard.length >= 4, `each round's fill is logged, got ${heard.length}`);
    assert.ok(heard.every((a) => a.value.length > 0), 'answers carry the actual typed value');
  } finally {
    clearStubs();
  }
});

// ----------------------------------------------------------- Greenhouse -----

const ghBaseRules = () => ([
  { match: 'has_file_input', result: { url: 'https://job-boards.greenhouse.io/testco/jobs/1', has_file_input: true, has_submit: true, has_form: true, body_snippet: '' } },
  { match: 'grnhse_iframe', result: { ok: false } },
  { match: 'dispatched: true', result: { dispatched: true, files: 1, name: 'resume.pdf' } },
  { match: 'has_resume_text', result: { has_resume_text: true, has_replace_btn: true } },
]);

const GH_PAGE = (bodyText, { missing = [], url = 'https://job-boards.greenhouse.io/testco/jobs/1' } = {}) =>
  ({ bodyText, missing, url, body_snippet: bodyText.slice(0, 250) });

test('Greenhouse 出货 main()：确认页 URL + 文案 → submitted / exit 0，基础字段进 answers', async () => {
  const { main } = await loadGreenhouse(GH_BASE);
  setEvalRules([
    ...ghBaseRules(),
    { match: 'helper-text--error', result: GH_PAGE(fixture('confirm_greenhouse_thank_you.txt'), { url: 'https://job-boards.greenhouse.io/testco/confirmation' }) },
  ]);
  globalThis.__MRW_FILLS = [];
  try {
    const emitted = await runToEmit(main);
    assert.equal(emitted.outcome, 'submitted');
    assert.equal(emitted.verdict.verdict, 'submitted');
    assert.equal(EXIT_CODES[emitted.outcome], 0);
    const labels = emitted.answers.map((a) => a.label);
    for (const basic of ['first_name', 'last_name', 'email']) {
      assert.ok(labels.includes(basic), `${basic} logged, got ${labels}`);
    }
  } finally {
    clearStubs();
  }
});

test('Greenhouse 出货 main()：Directive 式失败页 → not_submitted，第 1 次尝试就短路', async () => {
  const { main } = await loadGreenhouse(GH_BASE);
  setEvalRules([
    ...ghBaseRules(),
    { match: 'helper-text--error', result: GH_PAGE(fixture('deny_directive_304.txt')) },
  ]);
  globalThis.__MRW_FILLS = [];
  try {
    const emitted = await runToEmit(main);
    assert.equal(emitted.outcome, 'not_submitted');
    assert.equal(emitted.reason, 'page_states_failure');
    assert.equal(emitted.attempt, 1, 'terminal denial must not burn retries');
  } finally {
    clearStubs();
  }
});

// ----------------------------------------------------------------- Lever ----

const leverBaseEvalRules = () => ([
  { match: 'hasSubmit', result: { unavailable: false, hasSubmit: true, url: 'https://jobs.lever.co/testco/x/apply', title: 't' } },
  { match: 'Lever.fillForm', result: { ok: true, filled: ['name', 'email'], errors: [], plan: [
    { step: 'setText', id: 'name', value: 'Test User' },
    { step: 'setText', id: 'email', value: 't@example.com' },
  ] } },
  { match: 'waitForResumeStorageId', result: { ok: true, storageId: 's1' } },
  { match: 'verifyResumeUploaded', result: { ok: true } },
  { match: 'findEmptyRequired', result: [] },
  { match: 'isErrorMessageVisible', result: { visible: false } },
  { match: 'findSubmit', result: { ok: true, clicked: '#btn-submit', text: 'Submit application' } },
]);

const leverCdpRules = () => ([
  // The helpers source itself contains the literal 'Lever ready: ' banner.
  { match: 'Lever ready', result: { code: 0, stdout: 'Lever ready', stderr: '' } },
]);

async function runLever(scenarioEvalRules, opts = {}) {
  const { driver, home } = await loadLever(LEVER_BASE, opts);
  globalThis.__MRW_EVAL_RULES = scenarioEvalRules;
  globalThis.__MRW_CDP_RULES = leverCdpRules();
  try {
    const outcome = await withHome(home, () => driver.main());
    return validateOutcome(outcome);
  } finally {
    clearStubs();
  }
}

test('Lever 出货 main()：/thanks 跳转 + 确认文案 → submitted / exit 0，fillForm 的落笔进 answers', async () => {
  const outcome = await runLever([
    ...leverBaseEvalRules(),
    { match: 'Lever.checkSuccess', result: { path: '/testco/x/thanks', url: 'https://jobs.lever.co/testco/x/thanks', bodyText: fixture('confirm_lever_submitted.txt') } },
  ]);
  assert.equal(outcome.outcome, 'submitted');
  assert.equal(outcome.verdict.verdict, 'submitted');
  assert.equal(EXIT_CODES[outcome.outcome], 0);
  const labels = outcome.answers.map((a) => a.label);
  assert.ok(labels.includes('name') && labels.includes('email'), `fillForm plan logged, got ${labels}`);
});

test('Lever 出货 main()：页面明说失败 → not_submitted（本地成功正则已拔除）', async () => {
  const outcome = await runLever([
    ...leverBaseEvalRules(),
    { match: 'Lever.checkSuccess', result: { path: '/testco/x/apply', url: 'https://jobs.lever.co/testco/x/apply', bodyText: fixture('deny_directive_304.txt') } },
  ]);
  assert.equal(outcome.outcome, 'not_submitted');
  assert.equal(outcome.reason, 'page_states_failure');
  assert.equal(EXIT_CODES[outcome.outcome], 2);
});

test('Lever 出货 main()：验证码墙 → captcha_blocked / exit 3', async () => {
  const outcome = await runLever([
    ...leverBaseEvalRules().filter((r) => r.match !== 'isErrorMessageVisible'),
    { match: 'recaptcha', result: { found_widget: true, found_text: false } },
  ]);
  assert.equal(outcome.outcome, 'captcha_blocked');
  assert.equal(EXIT_CODES[outcome.outcome], 3);
});

test('Lever 出货 main()：简历文件不存在 → needs_user（缺的是只有人能补的东西）', async () => {
  const outcome = await runLever(leverBaseEvalRules(), { resume: false });
  assert.equal(outcome.outcome, 'needs_user');
  assert.equal(outcome.reason, 'resume_missing');
  assert.equal(EXIT_CODES[outcome.outcome], 2);
});
