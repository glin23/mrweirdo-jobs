// 真投 2026-09-27（BUG_REPORT 第 2 章）：OpusClip / Creatify / ElevenLabs MktOps 三页在简历上传那串
// 请求还没走完时就点了提交，Ashby 静默吞掉了点击——一条请求都没发出去。这两个页面内判断
// 在浏览器里跑的就是这里被测的同一份函数源码（fn.toString() 注入），不是副本。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formSettled, clickReceived, pageCall } from '../shared/page_signals.mjs';

const perf = (entries, timeOrigin = 1000) => ({ timeOrigin, getEntriesByType: (t) => (t === 'resource' ? entries : []) });
const req = (name, startTime, responseEnd = startTime + 50) => ({ name, startTime, responseEnd });
const uploadSettled = (p, since, prev) => formSettled(p, since, prev, true); // the upload half of the page-idle gate
const S3 = 'https://loaded-files-ashby.s3.us-east-1.amazonaws.com/abc?X-Amz-Signature=1';
const GQL = 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSetFile';

test('上传：还没有任何上传请求 → 未完成', () => {
  const r = uploadSettled(perf([req('https://cdn.ashbyhq.com/app.js', 10)]), 100, -1);
  assert.equal(r.settled, false);
  assert.equal(r.why, 'no_upload_request_yet');
});

test('上传：S3 已传完、但其后的 graphql 还没回来 → 未完成（OpusClip 的时刻）', () => {
  const r = uploadSettled(perf([req(GQL, 120, 200), req(S3, 210, 900)]), 100, -1);
  assert.equal(r.settled, false);
  assert.equal(r.why, 'upload_not_confirmed');
});

test('上传：S3 之后的 graphql 已回来，但请求数还在涨 → 等下一轮', () => {
  const entries = [req(GQL, 120, 200), req(S3, 210, 900), req(GQL, 905, 980)];
  const r = uploadSettled(perf(entries), 100, 2);
  assert.equal(r.settled, false);
  assert.equal(r.count, 3);
});

test('上传：S3 + 其后 graphql 都回来、两次读数一致 → 完成', () => {
  const entries = [req(GQL, 120, 200), req(S3, 210, 900), req(GQL, 905, 980)];
  assert.equal(uploadSettled(perf(entries), 100, 3).settled, true);
});

test('上传：上传开始之前的旧请求不算', () => {
  const r = uploadSettled(perf([req(S3, 10, 20), req(GQL, 30, 40)]), 100, 2);
  assert.equal(r.settled, false);
  assert.equal(r.why, 'no_upload_request_yet');
});

test('点击：点之后 0 条新请求 → 页面没接住', () => {
  const r = clickReceived(perf([req(S3, 210, 900), req(GQL, 905, 980)]), { t: 1000, origin: 1000 });
  assert.equal(r.registered, false);
});

test('点击：点之后有 recaptcha clr / 提交请求 → 接住了', () => {
  const r = clickReceived(perf([req('https://www.google.com/recaptcha/api2/clr?k=x', 1010), req(GQL, 1100)]), { t: 1000, origin: 1000 });
  assert.equal(r.registered, true);
});

test('点击：页面换了文档（跳到确认页）→ 接住了', () => {
  assert.equal(clickReceived(perf([], 5000), { t: 1000, origin: 1000 }).registered, true);
});

test('点击：资源记录满了（250 条）→ 判不出，不许说「没接住」', () => {
  const full = Array.from({ length: 250 }, (_, i) => req(`https://x/${i}`, i));
  assert.equal(clickReceived(perf(full), { t: 1000, origin: 1000 }).registered, null);
});

test('注入串：函数源码原样进页面，参数按 JSON 传', () => {
  const js = pageCall(clickReceived, { t: 1, origin: 2 });
  assert.ok(js.includes(clickReceived.toString()));
  assert.ok(js.endsWith('(performance, {"t":1,"origin":2})'));
  // 在一个只有 performance 的沙盒里真跑一遍这段串
  const out = new Function('performance', `return ${js};`)(perf([req(GQL, 5)], 2));
  assert.equal(out.registered, true);
});

// verify 第 19 轮 P2 ①：只有「确定什么都没发出去」才算没接住；任何不确定都按接住（不再点）。
import { clickVerdict } from '../shared/page_signals.mjs';

test('判定：点击后 CDP 看到任何已发出的请求（含在途）→ 接住', () => {
  assert.equal(clickVerdict({ ok: true, requests: [{ url: 'https://jobs.ashbyhq.com/api/non-user-graphql' }] }, { registered: false }).registered, true);
});

test('判定：CDP 整个窗口 0 条 + 时间表 0 条、同一文档 → 才算没接住', () => {
  assert.equal(clickVerdict({ ok: true, requests: [] }, { registered: false }).registered, false);
});

test('判定：CDP 没看成（没开起来 / 没数据）→ 判不出，不许说没接住', () => {
  for (const watch of [null, undefined, { ok: false, error: 'ws closed' }, { ok: true }]) {
    assert.equal(clickVerdict(watch, { registered: false }).registered, null, JSON.stringify(watch));
  }
});

test('判定：时间表判不出 / 换了文档 → 不许说没接住', () => {
  assert.equal(clickVerdict({ ok: true, requests: [] }, { registered: null }).registered, null);
  assert.equal(clickVerdict({ ok: true, requests: [] }, undefined).registered, null);
  assert.equal(clickVerdict({ ok: true, requests: [] }, { registered: true, via: 'new_document' }).registered, true);
});
