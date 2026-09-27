// restart-apply-3 BUG_REPORT（2026-09-27 Prior Labs / Rillet「只填到简历就停」）：
// Ashby 前端每个字段打字后 500ms 自动保存（graphql ApiSetFormValue）；保存在途时点提交，前端只弹一个
// 会消失的提示，提交请求（ApiSubmitSingleApplicationFormAction / ApiSubmitMultipleFormsAction）根本
// 不发。旧判断「点击后有任何请求 = 接住了」把自动保存当成了接住 → unknown / 可能投过。
//   ① 点提交前等「页面空闲」：表单相关请求全部走完、请求数稳定；等不到 = crashed，点之前失败
//   ② 接没接住只认提交请求本身（或换了页面）
//   ③ 没有提交请求 + 页面上必填还空着 → not_submitted（没投出去），不是 unknown
// 页面内函数与出货代码是同一份源码（pageCall 注入），这里在假 performance / 假 document 上跑。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formSettled, clickReceived, clickVerdict, emptyRequiredFields, netIdleTracker, pageCall,
  ASHBY_SUBMIT_REQUEST, ASHBY_FORM_TRAFFIC,
} from '../shared/page_signals.mjs';

const perf = (entries, timeOrigin = 1000) => ({ timeOrigin, getEntriesByType: (t) => (t === 'resource' ? entries : []) });
const req = (name, startTime, responseEnd = startTime + 50) => ({ name, startTime, responseEnd });
const SAVE = 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSetFormValue';
const SUBMIT = 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSubmitSingleApplicationFormAction';
const SUBMIT_MULTI = 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSubmitMultipleFormsAction';
const S3 = 'https://loaded-files-ashby.s3.us-east-1.amazonaws.com/abc?X-Amz-Signature=1';
const GQL_FILE = 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSetFile';
const RECAPTCHA = 'https://www.google.com/recaptcha/api2/clr?k=x';

// ---------------------------------------------------------------- 页面空闲闸

test('空闲闸：表单请求数与上一轮相同 → 落定；上一轮没读过（-1）→ 还不算', () => {
  const entries = [req(SAVE, 9255, 9352), req(SAVE, 9541, 10175)];
  assert.equal(formSettled(perf(entries), 0, -1, false).settled, false);
  assert.equal(formSettled(perf(entries), 0, 2, false).settled, true);
});

test('空闲闸：只数表单相关请求（保存 / 上传），页面里别的请求（统计、人机验证）不影响稳定', () => {
  const r1 = formSettled(perf([req(SAVE, 10), req('https://analytics.example/beacon', 20)]), 0, -1, false);
  const r2 = formSettled(perf([req(SAVE, 10), req('https://analytics.example/beacon', 20), req('https://analytics.example/beacon', 900)]), 0, r1.count, false);
  assert.equal(r2.settled, true, JSON.stringify(r2));
});

test('空闲闸：上一轮之后又有一条保存走完（Rillet 那条 10049–10184）→ 未落定', () => {
  const r = formSettled(perf([req(SAVE, 9255, 9352), req(SAVE, 9541, 10175), req(SAVE, 10049, 10184)]), 0, 2, false);
  assert.equal(r.settled, false);
});

test('空闲闸（上传）：还要求 S3 + 其后的 graphql 都回来——沿用原上传闸的全部规则', () => {
  assert.equal(formSettled(perf([req(SAVE, 120)]), 100, 1, true).why, 'no_upload_request_yet');
  assert.equal(formSettled(perf([req(GQL_FILE, 120, 200), req(S3, 210, 900)]), 100, 2, true).why, 'upload_not_confirmed');
  assert.equal(formSettled(perf([req(GQL_FILE, 120, 200), req(S3, 210, 900), req(GQL_FILE, 905, 980)]), 100, 3, true).settled, true);
  assert.equal(formSettled(perf([req(S3, 10, 20), req(GQL_FILE, 30, 40)]), 100, 2, true).why, 'no_upload_request_yet');
});

test('空闲闸：资源记录满了 → 判不出（null），不许说落定', () => {
  const full = Array.from({ length: 250 }, (_, i) => req(`https://x/${i}`, i));
  assert.equal(formSettled(perf(full), 0, 3, false).settled, null);
});

test('在途跟踪：保存请求发出到回来之间不空闲；回来后从回来那一刻起算安静时长', () => {
  const t = netIdleTracker(ASHBY_FORM_TRAFFIC);
  t.onEvent({ method: 'Network.requestWillBeSent', params: { requestId: '1', request: { url: SAVE } } }, 500);
  assert.equal(t.idleFor(2000, 0), 0, 'a save in flight is never idle');
  assert.deepEqual(t.inflight(), [SAVE]);
  t.onEvent({ method: 'Network.loadingFinished', params: { requestId: '1' } }, 1100);
  assert.equal(t.idleFor(2000, 0), 900);
  assert.deepEqual(t.inflight(), []);
});

test('在途跟踪：失败的请求也算走完；与表单无关的请求不跟踪', () => {
  const t = netIdleTracker(ASHBY_FORM_TRAFFIC);
  t.onEvent({ method: 'Network.requestWillBeSent', params: { requestId: 'a', request: { url: 'https://analytics.example/beacon' } } }, 100);
  assert.equal(t.idleFor(1000, 0), 1000, 'an unrelated request neither blocks nor resets idleness');
  t.onEvent({ method: 'Network.requestWillBeSent', params: { requestId: 'b', request: { url: S3 } } }, 200);
  t.onEvent({ method: 'Network.loadingFailed', params: { requestId: 'b' } }, 300);
  assert.equal(t.idleFor(1000, 0), 700);
});

// ---------------------------------------------------------------- 只认提交请求

test('接住：点击后只有自动保存（ApiSetFormValue）→ 按提交请求看，没接住', () => {
  const r = clickReceived(perf([req(SAVE, 9541, 10175), req(SAVE, 10049, 10184)]), { t: 9600, origin: 1000 }, ASHBY_SUBMIT_REQUEST);
  assert.equal(r.registered, false);
  assert.equal(r.via, 'no_submit_request_after_click');
});

test('接住：点击后有 ApiSubmitSingleApplicationFormAction / ApiSubmitMultipleFormsAction → 接住', () => {
  for (const url of [SUBMIT, SUBMIT_MULTI]) {
    const r = clickReceived(perf([req(RECAPTCHA, 9610), req(url, 9900)]), { t: 9600, origin: 1000 }, ASHBY_SUBMIT_REQUEST);
    assert.equal(r.registered, true, url);
  }
});

test('接住：换了文档（跳到确认页）→ 接住，不管有没有看到请求', () => {
  assert.equal(clickReceived(perf([], 5000), { t: 1, origin: 1000 }, ASHBY_SUBMIT_REQUEST).registered, true);
});

test('接住：不给提交请求样式的调用方（Greenhouse）行为不变——任何请求都算', () => {
  assert.equal(clickReceived(perf([req(SAVE, 9700)]), { t: 9600, origin: 1000 }).registered, true);
});

test('判定：CDP 看到的只有自动保存 + 时间表也没有提交请求 → 确定没发出（false）', () => {
  const watch = { ok: true, requests: [{ url: SAVE, method: 'POST', ms: 40 }], window_ms: 19000 };
  const v = clickVerdict(watch, { registered: false }, ASHBY_SUBMIT_REQUEST);
  assert.equal(v.registered, false);
  assert.equal(v.via, 'no_submit_request_sent_after_click');
});

test('判定：CDP 看到提交请求（哪怕在途）→ 接住', () => {
  const watch = { ok: true, requests: [{ url: SAVE }, { url: SUBMIT }] };
  assert.equal(clickVerdict(watch, { registered: false }, ASHBY_SUBMIT_REQUEST).registered, true);
});

test('判定：CDP 没看成 / 时间表判不出 → 仍是判不出（null），不许说没发出', () => {
  assert.equal(clickVerdict({ ok: false, error: 'ws closed' }, { registered: false }, ASHBY_SUBMIT_REQUEST).registered, null);
  assert.equal(clickVerdict({ ok: true, requests: [] }, { registered: null }, ASHBY_SUBMIT_REQUEST).registered, null);
});

test('注入串：带提交请求样式的 clickReceived 在只有 performance 的沙盒里原样跑得通', () => {
  const js = pageCall(clickReceived, { t: 1, origin: 2 }, ASHBY_SUBMIT_REQUEST);
  const out = new Function('performance', `return ${js};`)(perf([req(SAVE, 5)], 2));
  assert.equal(out.registered, false);
});

// ---------------------------------------------------------------- 必填还空着

function fakeDoc(fields) {
  const els = fields.map((f) => ({
    tagName: (f.tag || 'input').toUpperCase(),
    type: f.type || 'text',
    id: f.id,
    name: f.name || '',
    value: f.value ?? '',
    checked: !!f.checked,
    required: !!f.required,
    offsetParent: f.hidden ? null : {},
    getAttribute: (k) => (k === 'aria-required' ? (f.ariaRequired ? 'true' : null) : k === 'aria-label' ? (f.aria || null) : null),
  }));
  const labels = Object.fromEntries(fields.filter((f) => f.label).map((f) => [f.id, { innerText: f.label }]));
  return {
    querySelectorAll: () => els,
    querySelector: (sel) => {
      const m = sel.match(/label\[for="(.+)"\]/);
      return m ? labels[m[1]] || null : null;
    },
  };
}
const runRequired = (doc) => new Function('performance', 'document', 'CSS', `return ${pageCall(emptyRequiredFields)};`)(perf([]), doc, { escape: (s) => s });

test('必填空着：列出 required 且值为空的可见输入框（Prior Labs：薪资 / 所在地 / 开放题）', () => {
  const doc = fakeDoc([
    { id: '_systemfield_name', label: 'Name', value: 'Lee Lin', required: true },
    { id: 'a1', label: 'Salary expectations', type: 'number', required: true },
    { id: 'a2', label: 'Where are you located?', required: true, value: '   ' },
    { id: 'a3', label: 'Why Prior Labs?', tag: 'textarea', ariaRequired: true },
    { id: 'a4', label: 'Optional note' },
    { id: 'a5', label: 'Hidden required', required: true, hidden: true },
    { id: 'f1', label: 'Resume', type: 'file', required: true },
  ]);
  const r = runRequired(doc);
  assert.equal(r.ok, true);
  assert.deepEqual(r.fields, ['Salary expectations', 'Where are you located?', 'Why Prior Labs?']);
});

test('必填空着：required 单选组一个都没选才算空；选了一个就不算', () => {
  const empty = runRequired(fakeDoc([
    { id: 'r1', name: 'g', type: 'radio', required: true, label: 'Yes' },
    { id: 'r2', name: 'g', type: 'radio', required: true, label: 'No' },
  ]));
  assert.deepEqual(empty.fields, ['g']);
  const picked = runRequired(fakeDoc([
    { id: 'r1', name: 'g', type: 'radio', required: true, label: 'Yes', checked: true },
    { id: 'r2', name: 'g', type: 'radio', required: true, label: 'No' },
  ]));
  assert.deepEqual(picked.fields, []);
});

// ---------------------------------------------------------------- 出货驱动 main()
// 只有浏览器边界是替身（test/ashby_driver_harness.mjs）；驱动逻辑是出货源码。
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveMayHaveSubmitted } from '../shared/driver_contract.mjs';
import { loadDriver, BASE } from './ashby_driver_harness.mjs';

async function runToEmit(main) {
  const sandbox = mkdtempSync(join(tmpdir(), 'mrw-submit-gate-'));
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
  for (const k of ['__MRW_EVAL_RULES', '__MRW_EMITTED', '__MRW_CDP_RULES', '__MRW_EVIDENCE', '__MRW_WATCH', '__MRW_CLICKWATCH_ARGS']) delete globalThis[k];
}

const SAVE_ONLY = { ok: true, requests: [{ url: SAVE, method: 'POST', ms: 30 }], window_ms: 19000 };
const SUBMIT_SENT = { ok: true, requests: [{ url: SAVE, method: 'POST', ms: 30 }, { url: SUBMIT, method: 'POST', ms: 900 }], window_ms: 900 };
const page = (missing = []) => ({ bodyText: 'Application', missing, error_count: missing.length, url: 'https://jobs.ashbyhq.com/testco/x', snippet: '' });

function rig({ settled = () => ({ settled: true, why: 'quiet', count: 3 }), idle = () => ({ ok: true, idle_ms: 1500 }), received = () => ({ registered: false, via: 'no_submit_request_after_click' }), required = () => ({ ok: true, fields: [] }), pages = [[]] } = {}) {
  const events = [];
  let clicks = 0;
  globalThis.__MRW_CDP_RULES = [
    { match: 'netidle', result: () => { const r = idle(); events.push(`netidle:${r.ok}`); return { stdout: JSON.stringify(r), stderr: '' }; } },
  ];
  globalThis.__MRW_EVAL_RULES = [
    { match: 'has_resume', result: { ready: 'complete', has_resume: true, input_count: 9, url: 'x', title: 't', body_text: '' } },
    { match: 'mrw_upload_mark', result: { since: 100 } },
    { match: 'react_unmounted', result: { ok: true, files: 1, name: 'resume.pdf' } },
    { match: 'function formSettled', result: () => { const r = settled(); events.push(`settle:${r.settled}`); return r; } },
    { match: 'mrw_phone_temp', result: { found: false } },
    { match: 'label_for', result: { ok: true, sel: '#f', via: 'label_for', type: 'text' } },
    { match: 'btn.click()', result: () => { clicks += 1; events.push('click'); return { ok: true, mark: { t: 5000, origin: 1 } }; } },
    { match: 'function clickReceived', result: () => received() },
    { match: 'function emptyRequiredFields', result: () => required() },
    { match: 'error_count', result: () => page(pages[Math.min(clicks, pages.length) - 1] || []) },
  ];
  return { events, clicks: () => clicks };
}

test('驱动①：每次点提交之前都先过页面空闲闸（CDP 在途 + 请求数稳定）', async () => {
  const d = await loadDriver(BASE);
  // First click: the page lists LinkedIn (fillable) → second click after filling.
  const { events, clicks } = rig({ pages: [['LinkedIn Profile'], ['LinkedIn Profile', 'Brand new question qq7']] });
  globalThis.__MRW_WATCH = SUBMIT_SENT;
  try {
    await runToEmit(d.main);
    assert.equal(clicks(), 2);
    const clickAt = events.reduce((a, e, i) => (e === 'click' ? [...a, i] : a), []);
    for (const [n, at] of clickAt.entries()) {
      const before = events.slice(n === 0 ? 0 : clickAt[n - 1] + 1, at);
      assert.ok(before.includes('netidle:true') && before.includes('settle:true'), `click ${n + 1} not preceded by an idle page: ${events}`);
    }
  } finally {
    reset();
  }
});

test('驱动①：在途跟踪说还有保存没回来 → 继续等，不点', async () => {
  const d = await loadDriver(BASE);
  const idles = [{ ok: false, why: 'timeout', inflight: [SAVE] }, { ok: true }, { ok: true }, { ok: true }, { ok: true }, { ok: true }, { ok: true }];
  const { events } = rig({ idle: () => idles.shift() || { ok: true } });
  globalThis.__MRW_WATCH = SUBMIT_SENT;
  try {
    await runToEmit(d.main);
    const firstClick = events.indexOf('click');
    assert.ok(events.indexOf('netidle:false') < firstClick, `${events}`);
    assert.equal(events[firstClick - 1], 'settle:true', `the click must directly follow a settled read: ${events}`);
  } finally {
    reset();
  }
});

test('驱动①：页面一直不空闲 → crashed / form_saves_not_settled，一次都没点，不算投过', async () => {
  const d = await loadDriver(BASE);
  const { clicks } = rig();
  // Upload gate passes (needs an upload); the pre-submit gate never settles.
  let uploadDone = false;
  globalThis.__MRW_EVAL_RULES.find((r) => r.match === 'function formSettled').result = (js) => {
    if (/true\)$/.test(js.trim())) { uploadDone = true; return { settled: true, why: 'quiet', count: 3 }; }
    return { settled: false, why: 'still_loading', count: Math.random() };
  };
  try {
    const out = await runToEmit(d.main);
    assert.ok(uploadDone, 'upload gate ran');
    assert.equal(out.outcome, 'crashed');
    assert.equal(out.reason, 'form_saves_not_settled');
    assert.equal(clicks(), 0);
    assert.equal(deriveMayHaveSubmitted(out), false);
    assert.ok(out.evidence?.path && existsSync(out.evidence.path));
  } finally {
    reset();
  }
});

test('驱动②：点提交时 CDP 只按提交请求等（把样式交给 clickwatch）', async () => {
  const d = await loadDriver(BASE);
  rig({ required: () => ({ ok: true, fields: [] }) });
  globalThis.__MRW_WATCH = SUBMIT_SENT;
  try {
    await runToEmit(d.main);
    assert.equal(globalThis.__MRW_CLICKWATCH_ARGS?.[0]?.pattern, ASHBY_SUBMIT_REQUEST);
  } finally {
    reset();
  }
});

test('驱动③：只有自动保存、没有提交请求、必填还空着 → not_submitted / submit_request_not_sent，不算投过，有截图', async () => {
  const d = await loadDriver(BASE);
  const { clicks } = rig({ required: () => ({ ok: true, fields: ['Salary expectations', 'Why Prior Labs?'] }) });
  globalThis.__MRW_WATCH = SAVE_ONLY;
  try {
    const out = await runToEmit(d.main);
    assert.equal(out.outcome, 'not_submitted');
    assert.equal(out.reason, 'submit_request_not_sent');
    assert.deepEqual(out.required_empty, ['Salary expectations', 'Why Prior Labs?']);
    assert.equal(out.submit_request_seen, false);
    assert.equal(clicks(), 1, 'no re-click: ≤2 guard untouched');
    assert.equal(deriveMayHaveSubmitted(out), false);
    assert.ok(out.evidence?.path && existsSync(out.evidence.path));
  } finally {
    reset();
  }
});

test('驱动③：没看到提交请求、但必填都有值 → 判不出，仍 unknown（可能投过）', async () => {
  const d = await loadDriver(BASE);
  rig({ required: () => ({ ok: true, fields: [] }) });
  globalThis.__MRW_WATCH = SAVE_ONLY;
  try {
    const out = await runToEmit(d.main);
    assert.equal(out.outcome, 'unknown');
    assert.equal(deriveMayHaveSubmitted(out), true);
  } finally {
    reset();
  }
});

test('驱动③：提交请求发出了（哪怕必填看着空）→ unknown，算可能投过', async () => {
  const d = await loadDriver(BASE);
  rig({ received: () => ({ registered: true, via: 'request_after_click' }), required: () => ({ ok: true, fields: ['Salary expectations'] }) });
  globalThis.__MRW_WATCH = SUBMIT_SENT;
  try {
    const out = await runToEmit(d.main);
    assert.equal(out.outcome, 'unknown');
    assert.equal(deriveMayHaveSubmitted(out), true);
  } finally {
    reset();
  }
});

test('驱动③：必填读不出来 / CDP 没看成 → unknown，不许判没投', async () => {
  for (const [watch, required] of [[SAVE_ONLY, () => ({ ok: false })], [{ ok: false, error: 'ws closed' }, () => ({ ok: true, fields: ['X'] })]]) {
    const d = await loadDriver(BASE);
    rig({ required });
    globalThis.__MRW_WATCH = watch;
    try {
      const out = await runToEmit(d.main);
      assert.equal(out.outcome, 'unknown', JSON.stringify(watch));
      assert.equal(deriveMayHaveSubmitted(out), true);
    } finally {
      reset();
    }
  }
});

test('驱动③：补字段后第 2 次点击没发出提交请求、页面仍挂旧报错、必填还空 → not_submitted，不点第 3 次', async () => {
  const d = await loadDriver(BASE);
  const { clicks } = rig({ pages: [['LinkedIn Profile'], ['LinkedIn Profile']], required: () => ({ ok: true, fields: ['Why us?'] }) });
  let n = 0;
  globalThis.__MRW_WATCH = () => (n++ === 0 ? SUBMIT_SENT : SAVE_ONLY);
  globalThis.__MRW_EVAL_RULES.find((r) => r.match === 'function clickReceived').result = () => (n <= 1 ? { registered: true } : { registered: false });
  try {
    const out = await runToEmit(d.main);
    assert.equal(clicks(), 2);
    assert.equal(out.outcome, 'not_submitted');
    assert.equal(out.reason, 'submit_request_not_sent');
    assert.equal(deriveMayHaveSubmitted(out), false);
  } finally {
    reset();
  }
});
