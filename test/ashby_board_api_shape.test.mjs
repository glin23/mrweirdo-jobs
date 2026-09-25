// Ashby 公开接口：「板 404」和「回包形状不对」必须分开；请求必须有超时
// （restart-apply DESIGN 第 2 轮 S1 第 6、7 项 / 小修包 VERIFY_REPORT §5 真 bug 2 + P3）。
// 原来 200 但形状不对（{} / {success:false} / jobs 非数组）一律当空板返回 []，
// 存活检查据此把活岗判成 expired；fetch 不带超时，接口挂住整批卡死。
// 全程替身 fetch，不走网络。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchJobs, fetchJobsForCompany, FETCH_TIMEOUT_MS } from '../shared/sourcing/ashby_board_api.mjs';
import { checkAshbyPosting } from '../shared/liveness_gate.mjs';

const POSTING = 'https://jobs.ashbyhq.com/acme/11111111-2222-3333-4444-555555555555';

async function withFetch(fake, fn) {
  const prev = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await fn();
  } finally {
    globalThis.fetch = prev;
  }
}

const json = (status, body) => async () => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});

test('板 404 → [] （公司没有这块板，真没有岗位）', async () => {
  const jobs = await withFetch(json(404, null), () => fetchJobs('acme'));
  assert.deepEqual(jobs, []);
});

for (const [label, body] of [['{}', {}], ['{success:false}', { success: false }], ['jobs 不是数组', { jobs: 'nope' }]]) {
  test(`200 但回包形状不对（${label}）→ throw ashby_unexpected_shape，不当成空板`, async () => {
    await assert.rejects(withFetch(json(200, body), () => fetchJobs('acme')), /ashby_unexpected_shape/);
  });
}

test('200 且 jobs 是空数组 → []（空板是合法形状）', async () => {
  const jobs = await withFetch(json(200, { jobs: [] }), () => fetchJobs('acme'));
  assert.deepEqual(jobs, []);
});

test('接口挂住 → 按超时中止、重试 1 次后 throw；缺省超时 15 秒', async () => {
  assert.equal(FETCH_TIMEOUT_MS, 15000);
  let calls = 0;
  let signalled = 0;
  const hang = (url, init) => {
    calls += 1;
    if (init?.signal) signalled += 1;
    // Never settles on its own: only an abort signal can end this request.
    return new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal.reason));
    });
  };
  await assert.rejects(withFetch(hang, () => fetchJobs('acme', { timeoutMs: 30 })), { name: 'TimeoutError' });
  assert.equal(calls, 2, 'one retry, then loud');
  assert.equal(signalled, 2, 'every request carries an abort signal');
});

test('fetchJobsForCompany：单家形状不对照旧吞掉只记日志（找岗不因一家挂掉整体失败）', async () => {
  const jobs = await withFetch(json(200, {}), () => fetchJobsForCompany('Acme', ['acme']));
  assert.deepEqual(jobs, []);
});

test('存活检查：回包形状不对 → uncertain（不拦），不再误判 expired', async () => {
  const r = await withFetch(json(200, { success: false }), () => checkAshbyPosting(POSTING, new Map()));
  assert.equal(r.liveness_status, 'uncertain');
  assert.match(r.error, /ashby_unexpected_shape/);
});

test('存活检查：板 404 仍判 expired（公司板没了）', async () => {
  const r = await withFetch(json(404, null), () => checkAshbyPosting(POSTING, new Map()));
  assert.equal(r.liveness_status, 'expired');
});
