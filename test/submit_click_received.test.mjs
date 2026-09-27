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

test('源码守卫：Ashby / Greenhouse 里每个 unknown 结局都带 evidence', () => {
  const offenders = [];
  for (const f of ['ashby_apply_driver.mjs', 'greenhouse_apply_driver.mjs']) {
    readFileSync(join(SHARED, f), 'utf8').split('\n').forEach((line, i) => {
      if (/emitOutcome\(\{\s*outcome:\s*'unknown'/.test(line) && !/evidence/.test(line)) offenders.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
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
  test(`P2②（${name}）：页面列出缺字段（第一次被拒）、补完再点时按钮没了 → unknown，算可能投过，不进「点提交前」`, async () => {
    const d = await load();
    rig();
    // First answer: the page rejects the form and lists a field the driver can fill.
    const pageRule = globalThis.__MRW_EVAL_RULES.find((r) => r.match === 'error_count' || r.match === 'helper-text--error');
    pageRule.result = name === 'Ashby'
      ? { bodyText: 'errors', missing: ['LinkedIn Profile'], error_count: 1, url: 'https://jobs.ashbyhq.com/testco/x', snippet: '' }
      : { bodyText: 'errors', missing: ['Gender'], url: 'https://job-boards.greenhouse.io/testco/jobs/1', body_snippet: '' };
    globalThis.__MRW_EVAL_RULES.unshift({ match: 'label_for', result: { ok: true, sel: '#li', via: 'label_for' } });
    const clickRule = globalThis.__MRW_EVAL_RULES.find((r) => r.match === 'btn.click()');
    let n = 0;
    const first = clickRule.result;
    clickRule.result = () => (n++ === 0 ? first() : { ok: false, note: 'no_submit_btn' });
    try {
      const out = await runToEmit(d.main);
      assert.equal(n, 2, 'the second click is the ordinary fill-and-resubmit after a rejection');
      assert.equal(out.outcome, 'unknown');
      assert.equal(out.reason, 'submit_button_gone_after_click');
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

// ------------------------------------------------ verify 第 20 轮 / lead 裁决 ----
// 砍掉自动再点：页面没回答（没报缺字段、读不出结果）的点击之后，任何路径都不许再点提交。
// 只有页面明确列出缺字段（表单被拒、什么都没交上去）之后，才会补完再点——那是原本的填表流程。
const SILENT_VARIANTS = [
  ['CDP 看到请求', { ok: true, requests: [{ url: 'https://x/submit' }] }, { registered: true }],
  ['CDP 0 条 + 时间表 0 条', { ok: true, requests: [] }, { registered: false }],
  ['CDP 断开', { ok: false, error: 'WebSocket closed' }, { registered: false }],
  ['CDP 输出读不出', undefined, { registered: false }],
  ['时间表判不出', { ok: true, requests: [] }, { registered: null }],
];

for (const [label, watch, received] of SILENT_VARIANTS) {
  for (const [name, load, rig] of [
    ['Ashby', () => loadAshby(ASHBY_BASE), () => ashbyRig({ received: () => received })],
    ['Greenhouse', () => loadGreenhouse(GH_BASE), () => ghRig({ received: () => received })],
  ]) {
    test(`守卫（${name}·${label}）：页面没回答 → 只点 1 次，unknown，算可能投过，有截图`, async () => {
      const d = await load();
      globalThis.__MRW_WATCH = watch === undefined ? () => undefined : watch;
      const events = rig();
      try {
        const out = await runToEmit(d.main);
        const clicks = name === 'Ashby' ? events.filter((e) => e === 'click').length : events.filter((e) => e === 'click').length;
        assert.equal(clicks, 1, `clicked Submit ${clicks} times`);
        assert.equal(out.outcome, 'unknown');
        assert.equal(deriveMayHaveSubmitted(out), true);
        assert.ok(out.evidence?.path && existsSync(out.evidence.path));
      } finally {
        reset();
      }
    });
  }
}

test('守卫（源码）：驱动里不再有「再点一次」的分支与 submit_click_not_registered 结局', () => {
  for (const f of ['ashby_apply_driver.mjs', 'greenhouse_apply_driver.mjs', 'driver_contract.mjs', 'stream_run.mjs']) {
    const src = readFileSync(join(SHARED, f), 'utf8');
    assert.ok(!/reclick/i.test(src), `${f} still has a re-click path`);
    assert.ok(!/submit_click_not_registered/.test(src), `${f} still knows submit_click_not_registered`);
  }
});

// ------------------------------------------------ verify 第 21 轮 / lead 裁决 ----
// 补字段再提交：服务端慢于 7 秒时页面残留上一轮的缺字段报错，看起来像「又被拒了」，其实第 2 次
// 可能已经交上去了。规则：第 2 次提交之后，页面所列缺字段全是本轮已经补过的 → 判不出 → unknown
// （算可能投过）、截图、停；有从没填过的新字段 → 页面确实拒了 → needs_user，也停。
// 总点击 ≤ 2，第 2 次只在第 1 次被页面明确列出缺字段、且全部补上之后。
// Fields each driver answers from BASE under its harness (Greenhouse's stub
// renders custom questions as dropdowns, so it gets dropdown-shaped questions).
const FIELDS = { Ashby: ['LinkedIn Profile', 'Website'], Greenhouse: ['Gender', 'Veteran status'] };
const NEW = 'Favorite color zz9';

function scripted(name, pagesFor) {
  const [A, B] = FIELDS[name];
  const pages = pagesFor(A, B);
  // pages[i] = missing list the page shows after click i+1 (sticky on the last).
  const rig = name === 'Ashby' ? ashbyRig : ghRig;
  let clicks = 0;
  const pageFor = (missing) => (name === 'Ashby'
    ? { bodyText: 'Application', missing, error_count: missing.length, url: 'https://jobs.ashbyhq.com/testco/x', snippet: '' }
    : { bodyText: 'Application', missing, url: 'https://job-boards.greenhouse.io/testco/jobs/1', body_snippet: '' });
  rig({ page: () => pageFor(pages[Math.min(clicks, pages.length) - 1] || []) });
  globalThis.__MRW_EVAL_RULES.unshift({ match: 'label_for', result: { ok: true, sel: '#f', via: 'label_for' } });
  const clickRule = globalThis.__MRW_EVAL_RULES.find((r) => r.match === 'btn.click()');
  const orig = clickRule.result;
  clickRule.result = () => { clicks += 1; return orig(); };
  return () => clicks;
}

for (const [name, load] of [['Ashby', () => loadAshby(ASHBY_BASE)], ['Greenhouse', () => loadGreenhouse(GH_BASE)]]) {
  test(`第 21 轮（${name}）：慢服务端、页面原样残留已补过的缺字段 → unknown，算可能投过，点 2 次不点第 3 次`, async () => {
    const d = await load();
    const clicks = scripted(name, (A) => [[A], [A]]);
    try {
      const out = await runToEmit(d.main);
      assert.equal(clicks(), 2);
      assert.equal(out.outcome, 'unknown', JSON.stringify(out).slice(0, 300));
      assert.equal(deriveMayHaveSubmitted(out), true);
      assert.ok(out.evidence?.path && existsSync(out.evidence.path));
    } finally {
      reset();
    }
  });

  test(`第 21 轮（${name}）：部分残留（两项补完、页面还挂一项）→ unknown，不点第 3 次`, async () => {
    const d = await load();
    const clicks = scripted(name, (A, B) => [[A, B], [A]]);
    try {
      const out = await runToEmit(d.main);
      assert.equal(clicks(), 2, 'a third click after a partly stale page is the duplicate verify saw');
      assert.equal(out.outcome, 'unknown');
      assert.equal(deriveMayHaveSubmitted(out), true);
    } finally {
      reset();
    }
  });

  test(`第 21 轮（${name}）：再提交后页面报出从没填过的新字段 → 页面确实拒了：needs_user、不算投过，不点第 3 次`, async () => {
    const d = await load();
    const clicks = scripted(name, (A) => [[A], [A, NEW]]);
    try {
      const out = await runToEmit(d.main);
      assert.equal(clicks(), 2);
      assert.equal(out.outcome, 'needs_user');
      assert.equal(deriveMayHaveSubmitted(out), false);
      assert.ok(out.evidence?.path && existsSync(out.evidence.path));
    } finally {
      reset();
    }
  });

  test(`第 21 轮（${name}）：第 1 次被拒且有补不上的字段 → 直接 needs_user，不点第 2 次`, async () => {
    const d = await load();
    const clicks = scripted(name, (A) => [[A, NEW]]);
    try {
      const out = await runToEmit(d.main);
      assert.equal(clicks(), 1, 'resubmitting a form we could not complete only re-lists the gap');
      assert.equal(out.outcome, 'needs_user');
      assert.equal(deriveMayHaveSubmitted(out), false);
    } finally {
      reset();
    }
  });

  test(`第 21 轮守卫（${name}）：任何缺字段序列下总点击 ≤ 2`, async () => {
    const [A, B] = FIELDS[name];
    for (const pages of [[[A], [B]], [[A], [NEW]], [[A], [A]], [[A, B], [B]], [[A], [], []], [[A], [NEW], [NEW]], [[A, B], [A, B], [A]]]) {
      const d = await load();
      const clicks = scripted(name, () => pages);
      try {
        const out = await runToEmit(d.main);
        assert.ok(clicks() <= 2, `${JSON.stringify(pages)}: ${clicks()} clicks`);
        // "Not submitted" after the resubmit is only allowed when the page lists
        // a field that was not answered before that click.
        if (clicks() === 2 && out.outcome === 'needs_user') assert.ok((out.missing || out.still_missing || []).some((m) => !pages[0].includes(m)), `${JSON.stringify(pages)}: not-submitted after a resubmit needs a never-filled field`);
        if (clicks() === 2 && pages[1] && pages[1].length && pages[1].every((m) => pages[0].includes(m))) assert.equal(out.outcome, 'unknown', JSON.stringify(pages));
      } finally {
        reset();
      }
    }
  });
}
