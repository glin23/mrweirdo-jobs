// 真投 2026-09-27（BUG_REPORT 第 2 章）：三个 Ashby 岗点了提交、页面一条请求都没发，驱动却记成
// unknown / 可能投过，还没截图。这里跑的是出货驱动自己的 main()，只有浏览器边界是替身：
//   ① 点提交前必须等简历上传真正走完（S3 + 其后的 graphql 都回来、请求数不再涨）
//   ② 点完问页面「接住了吗」：没接住 = 什么都没发出去，同一次运行内可以再点 1 次；
//      再不接 → not_submitted / submit_click_not_registered，不算投过
//   ③ 接住了但读不懂 → 仍 unknown、仍只点一次（守住 7ef0ac3），但必须整页留证
//   ④ 所有点过提交之后的终局都带截图
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveMayHaveSubmitted } from '../shared/driver_contract.mjs';
import { loadDriver as loadAshby, BASE as ASHBY_BASE } from './ashby_driver_harness.mjs';
import { loadDriver as loadGreenhouse, BASE as GH_BASE } from './greenhouse_driver_harness.mjs';

const SHARED = join(dirname(fileURLToPath(import.meta.url)), '..', 'shared');
const fixture = (name) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'submission_pages', name), 'utf8');

async function runToEmit(main) {
  const sandbox = mkdtempSync(join(tmpdir(), 'mrw-click-received-'));
  const prev = process.env.MRWEIRDO_HOME;
  process.env.MRWEIRDO_HOME = sandbox;
  try {
    await main();
  } catch (e) {
    if (e && e.emitted) return e.emitted;
    throw e;
  } finally {
    if (prev === undefined) delete process.env.MRWEIRDO_HOME; else process.env.MRWEIRDO_HOME = prev;
  }
  throw new Error('main() finished without emitting an outcome');
}

function reset() {
  delete globalThis.__MRW_EVAL_RULES;
  delete globalThis.__MRW_EMITTED;
  delete globalThis.__MRW_CDP_RULES;
  delete globalThis.__MRW_EVIDENCE;
  delete globalThis.__MRW_FILLS;
  delete globalThis.__MRW_WATCH;
}

const ASHBY_PAGE = (bodyText, { missing = [] } = {}) => ({ bodyText, missing, error_count: missing.length, url: 'https://jobs.ashbyhq.com/testco/x', snippet: bodyText.slice(0, 200) });

// Event log shared by every stub so ordering can be asserted.
function ashbyRig({ settled = () => ({ settled: true, why: 'quiet', count: 3 }), received = () => ({ registered: true, via: 'request_after_click' }), page = () => ASHBY_PAGE('nothing recognizable on this page') } = {}) {
  const events = [];
  const rules = [
    { match: 'has_resume', result: { ready: 'complete', has_resume: true, input_count: 9, url: 'x', title: 't', body_text: '' } },
    { match: 'mrw_upload_mark', result: () => { events.push('upload_mark'); return { since: 100 }; } },
    { match: 'react_unmounted', result: { ok: true, files: 1, name: 'resume.pdf' } },
    { match: 'function uploadSettled', result: () => { const r = settled(); events.push(`settle:${r.settled}`); return r; } },
    { match: 'mrw_phone_temp', result: { found: false } },
    { match: 'btn.click()', result: () => { events.push('click'); return { ok: true, mark: { t: 5000, origin: 1 } }; } },
    { match: 'function clickReceived', result: () => { const r = received(); events.push(`received:${r.registered}`); return r; } },
    { match: 'error_count', result: () => page() },
  ];
  globalThis.__MRW_EVAL_RULES = rules;
  return events;
}

test('Ashby ①：上传没走完不点提交——等到「S3 + 其后 graphql 回来且请求数不再涨」才点', async () => {
  const d = await loadAshby(ASHBY_BASE);
  const seq = [{ settled: false, why: 'upload_not_confirmed', count: 2 }, { settled: false, why: 'still_loading', count: 3 }, { settled: true, why: 'quiet', count: 3 }];
  const events = ashbyRig({ settled: () => seq.shift() });
  try {
    await runToEmit(d.main);
    const firstClick = events.indexOf('click');
    assert.deepEqual(events.filter((e) => e.startsWith('settle:')), ['settle:false', 'settle:false', 'settle:true'], `upload was not polled until settled: ${events}`);
    assert.ok(firstClick > events.lastIndexOf('settle:false'), `clicked before the upload settled: ${events}`);
    assert.ok(events.indexOf('settle:true') < firstClick, `never saw a settled upload before clicking: ${events}`);
  } finally {
    reset();
  }
});

test('Ashby ①：上传一直确认不了 → crashed / resume_upload_failed（点提交之前，不算投过），一次都没点', async () => {
  const d = await loadAshby(ASHBY_BASE);
  const events = ashbyRig({ settled: () => ({ settled: false, why: 'upload_not_confirmed', count: 2 }) });
  try {
    const out = await runToEmit(d.main);
    assert.equal(out.outcome, 'crashed');
    assert.equal(out.reason, 'resume_upload_failed');
    assert.equal(out.detail.note, 'resume_upload_not_confirmed');
    assert.ok(!events.includes('click'), 'must not click while the upload is unconfirmed');
    assert.equal(deriveMayHaveSubmitted(out), false);
  } finally {
    reset();
  }
});

test('Ashby ②：第一次点击页面没接住 → 再点一次；第二次接住并成功 → submitted，共点 2 次', async () => {
  const d = await loadAshby(ASHBY_BASE);
  globalThis.__MRW_WATCH = { ok: true, requests: [] };
  const rec = [{ registered: false, via: 'no_request_after_click' }];
  let clicks = 0;
  const events = ashbyRig({
    received: () => rec.shift() || { registered: true },
    page: () => (clicks >= 2 ? ASHBY_PAGE(fixture('confirm_ashby_success.txt')) : ASHBY_PAGE('Application')),
  });
  const clickRule = globalThis.__MRW_EVAL_RULES.find((r) => r.match === 'btn.click()');
  const orig = clickRule.result;
  clickRule.result = () => { clicks += 1; return orig(); };
  try {
    const out = await runToEmit(d.main);
    assert.equal(out.outcome, 'submitted');
    assert.equal(events.filter((e) => e === 'click').length, 2);
  } finally {
    reset();
  }
});

test('Ashby ②：两次都没接住 → not_submitted / submit_click_not_registered，不算投过，有截图，只点 2 次', async () => {
  const d = await loadAshby(ASHBY_BASE);
  globalThis.__MRW_WATCH = { ok: true, requests: [] };
  const events = ashbyRig({ received: () => ({ registered: false, via: 'no_request_after_click' }) });
  try {
    const out = await runToEmit(d.main);
    assert.equal(out.outcome, 'not_submitted');
    assert.equal(out.reason, 'submit_click_not_registered');
    assert.equal(events.filter((e) => e === 'click').length, 2, 'exactly one extra click, never more');
    assert.equal(deriveMayHaveSubmitted(out), false, 'nothing left the browser: not an attempt');
    assert.ok(out.evidence?.path && existsSync(out.evidence.path), `evidence missing: ${JSON.stringify(out.evidence)}`);
    assert.match(out.evidence.path, /_after_not_submitted\.png$/);
    assert.equal(statSync(out.evidence.path).mode & 0o777, 0o600, 'evidence is locked the moment it lands');
  } finally {
    reset();
  }
});

test('Ashby ③：接住了但页面读不懂 → unknown，只点 1 次（守住 7ef0ac3），整页截图 after_unknown', async () => {
  const d = await loadAshby(ASHBY_BASE);
  const events = ashbyRig();
  try {
    const out = await runToEmit(d.main);
    assert.equal(out.outcome, 'unknown');
    assert.equal(out.reason, 'no_errors_no_success');
    assert.equal(events.filter((e) => e === 'click').length, 1);
    assert.ok(out.evidence?.path && existsSync(out.evidence.path), `unknown must carry evidence: ${JSON.stringify(out.evidence)}`);
    assert.match(out.evidence.path, /_after_unknown\.png$/);
  } finally {
    reset();
  }
});

test('Ashby ③：资源记录满了、判不出接没接住 → 按「接住了」走：unknown，不再点', async () => {
  const d = await loadAshby(ASHBY_BASE);
  const events = ashbyRig({ received: () => ({ registered: null, via: 'resource_buffer_full' }) });
  try {
    const out = await runToEmit(d.main);
    assert.equal(out.outcome, 'unknown');
    assert.equal(events.filter((e) => e === 'click').length, 1);
  } finally {
    reset();
  }
});

test('Ashby：找不到提交按钮 → crashed / submit_button_not_found（不再默默当成点过）', async () => {
  const d = await loadAshby(ASHBY_BASE);
  ashbyRig();
  globalThis.__MRW_EVAL_RULES.find((r) => r.match === 'btn.click()').result = { ok: false, note: 'no_submit_btn' };
  try {
    const out = await runToEmit(d.main);
    assert.equal(out.outcome, 'crashed');
    assert.equal(out.reason, 'submit_button_not_found');
    assert.equal(deriveMayHaveSubmitted(out), false);
  } finally {
    reset();
  }
});

test('Ashby ④：卡在同样的缺字段（needs_user）也整页留证', async () => {
  const d = await loadAshby(ASHBY_BASE);
  ashbyRig({ page: () => ASHBY_PAGE('errors', { missing: ['Some question nobody can answer 7f3'] }) });
  try {
    const out = await runToEmit(d.main);
    assert.equal(out.outcome, 'needs_user');
    assert.ok(out.evidence?.path && existsSync(out.evidence.path), `needs_user after a click must carry evidence: ${JSON.stringify(out)}`);
  } finally {
    reset();
  }
});

// ---------------------------------------------------------------- Greenhouse

function ghRig({ received = () => ({ registered: true }), page = () => ({ bodyText: 'nothing recognizable on this page', missing: [], url: 'https://job-boards.greenhouse.io/testco/jobs/1', body_snippet: '' }) } = {}) {
  const events = [];
  globalThis.__MRW_FILLS = [];
  globalThis.__MRW_EVAL_RULES = [
    { match: 'has_file_input', result: { url: 'https://job-boards.greenhouse.io/testco/jobs/1', has_file_input: true, has_submit: true, has_form: true, body_snippet: '' } },
    { match: 'grnhse_iframe', result: { ok: false } },
    { match: 'dispatched: true', result: { dispatched: true, files: 1, name: 'resume.pdf' } },
    { match: 'has_resume_text', result: { has_resume_text: true, has_replace_btn: true } },
    { match: 'btn.click()', result: () => { events.push('click'); return { ok: true, text: 'Submit application', mark: { t: 5000, origin: 1 } }; } },
    { match: 'function clickReceived', result: () => received() },
    { match: 'helper-text--error', result: () => page() },
  ];
  return events;
}

test('Greenhouse ②：两次都没接住 → not_submitted / submit_click_not_registered，点 2 次，有截图', async () => {
  const { main } = await loadGreenhouse(GH_BASE);
  globalThis.__MRW_WATCH = { ok: true, requests: [] };
  const events = ghRig({ received: () => ({ registered: false, via: 'no_request_after_click' }) });
  try {
    const out = await runToEmit(main);
    assert.equal(out.outcome, 'not_submitted');
    assert.equal(out.reason, 'submit_click_not_registered');
    assert.equal(events.filter((e) => e === 'click').length, 2);
    assert.equal(deriveMayHaveSubmitted(out), false);
    assert.ok(out.evidence?.path && existsSync(out.evidence.path));
  } finally {
    reset();
  }
});

test('Greenhouse ③：接住了但读不懂 → unknown，只点 1 次，整页截图', async () => {
  const { main } = await loadGreenhouse(GH_BASE);
  const events = ghRig();
  try {
    const out = await runToEmit(main);
    assert.equal(out.outcome, 'unknown');
    assert.equal(events.filter((e) => e === 'click').length, 1);
    assert.ok(out.evidence?.path && existsSync(out.evidence.path), `unknown must carry evidence: ${JSON.stringify(out.evidence)}`);
  } finally {
    reset();
  }
});

test('源码守卫：Ashby / Greenhouse 里每个 unknown 与 submit_click_not_registered 结局都带 evidence', () => {
  const offenders = [];
  for (const f of ['ashby_apply_driver.mjs', 'greenhouse_apply_driver.mjs']) {
    readFileSync(join(SHARED, f), 'utf8').split('\n').forEach((line, i) => {
      if (/emitOutcome\(\{\s*outcome:\s*'unknown'|reason:\s*'submit_click_not_registered'/.test(line) && !/evidence/.test(line)) offenders.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});

// 3 行报告：没接住的点击不是「表单没打开」，也不是「判不确定」——如实说。
import { makeStreamRig, job } from './stream_run_harness.mjs';
import { readAll } from '../shared/submission_ledger.mjs';

test('3 行报告第 2 行：「点了提交但页面没收到，没发出去」+ 截图，不算投过', async () => {
  const rig = await makeStreamRig('mrw-stream-click-');
  try {
    const j = job('Creatify', 1, { fit: true });
    rig.board({ rotation: [j] });
    rig.script({ [j.apply_url]: { outcome: 'not_submitted', reason: 'submit_click_not_registered', detail: { registered: false }, evidence: { path: '/tmp/creatify_after_not_submitted.png' } } });
    const r = await rig.run(1);
    assert.match(r.finish.lines[0], /^投出 0 个/);
    assert.match(r.finish.lines[1], /1 个点了提交但页面没收到/);
    assert.match(r.finish.lines[1], /creatify_after_not_submitted\.png/);
    assert.doesNotMatch(r.finish.lines[1], /判不确定|表单没打开/);
    const line = readAll(rig.home).find((e) => e.apply_url === j.apply_url);
    assert.equal(line.may_have_submitted, false);
  } finally {
    await rig.close();
  }
});

// ------------------------------------------------ verify 第 19 轮 P2 / P3 ----

test('P2①：时间表说没接住、但 CDP 看到点击后发出的请求（在途）→ unknown，只点 1 次，算可能投过', async () => {
  const d = await loadAshby(ASHBY_BASE);
  globalThis.__MRW_WATCH = { ok: true, requests: [{ url: 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSubmit' }] };
  const events = ashbyRig({ received: () => ({ registered: false, via: 'no_request_after_click' }) });
  try {
    const out = await runToEmit(d.main);
    assert.equal(out.outcome, 'unknown');
    assert.equal(events.filter((e) => e === 'click').length, 1, 'an in-flight submission must never be clicked again');
    assert.equal(deriveMayHaveSubmitted(out), true);
  } finally {
    reset();
  }
});

test('P2①：CDP 没看成（watch 失败）→ 判不出 → unknown，不再点', async () => {
  const d = await loadAshby(ASHBY_BASE);
  globalThis.__MRW_WATCH = { ok: false, error: 'websocket closed' };
  const events = ashbyRig({ received: () => ({ registered: false }) });
  try {
    const out = await runToEmit(d.main);
    assert.equal(out.outcome, 'unknown');
    assert.equal(events.filter((e) => e === 'click').length, 1);
  } finally {
    reset();
  }
});

for (const [name, load, rig] of [
  ['Ashby', () => loadAshby(ASHBY_BASE), () => ashbyRig({ received: () => ({ registered: false }) })],
  ['Greenhouse', async () => loadGreenhouse(GH_BASE), () => ghRig({ received: () => ({ registered: false }) })],
]) {
  test(`P2②（${name}）：第一次点完被误判没接住，再点时按钮没了（已跳确认页）→ unknown，算可能投过，不进「点提交前」`, async () => {
    const d = await load();
    globalThis.__MRW_WATCH = { ok: true, requests: [] };
    rig();
    const clickRule = globalThis.__MRW_EVAL_RULES.find((r) => r.match === 'btn.click()');
    let n = 0;
    const first = clickRule.result;
    clickRule.result = () => (n++ === 0 ? first() : { ok: false, note: 'no_submit_btn' });
    try {
      const out = await runToEmit(d.main);
      assert.notEqual(out.reason, 'submit_button_not_found');
      assert.equal(out.outcome, 'unknown');
      assert.equal(deriveMayHaveSubmitted(out), true, 'a click already happened: may have submitted');
      assert.match(out.evidence?.path || '', /_after_unknown\.png$/);
    } finally {
      reset();
    }
  });

  test(`P2②（${name}）：点击结果读不出来（进程出错）→ 不当成「没点」，unknown 算可能投过`, async () => {
    const d = await load();
    rig();
    globalThis.__MRW_EVAL_RULES.find((r) => r.match === 'btn.click()').result = { _raw: '', _err: 'WebSocket closed' };
    try {
      const out = await runToEmit(d.main);
      assert.equal(out.outcome, 'unknown');
      assert.equal(deriveMayHaveSubmitted(out), true);
    } finally {
      reset();
    }
  });

  test(`P3（${name}）：点过提交之后程序抛异常 → crashed / driver_exception 也带 after_submit 截图`, async () => {
    const d = await load();
    rig();
    const pageRule = globalThis.__MRW_EVAL_RULES.find((r) => r.match === 'error_count' || r.match === 'helper-text--error');
    pageRule.result = () => { throw new Error('boom after click'); };
    const sandbox = mkdtempSync(join(tmpdir(), 'mrw-exc-'));
    const prev = process.env.MRWEIRDO_HOME;
    process.env.MRWEIRDO_HOME = sandbox;
    try {
      const err = await d.main().then(() => null, (e) => e);
      assert.equal(err?.message, 'boom after click');
      const out = await d.onDriverException(err).then(() => null, (e) => e.emitted);
      assert.equal(out.outcome, 'crashed');
      assert.equal(out.reason, 'driver_exception');
      assert.match(out.evidence?.path || '', /_after_unknown\.png$/);
    } finally {
      if (prev === undefined) delete process.env.MRWEIRDO_HOME; else process.env.MRWEIRDO_HOME = prev;
      reset();
    }
  });
}
