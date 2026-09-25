// apply_batch × 投前权威闸（restart-apply DESIGN S2 验收：替身驱动跑 V4 V5 V6 V9 V10）。
// 真 apply_batch + 真记账人 + 真账本 + 真闸；只有驱动和外围步骤是替身。
// 「第 2 次运行重新找到同一岗位」用新行号、同链接的库行模拟（S3 工作库的样子）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { append, readAll } from '../shared/submission_ledger.mjs';
import { makeBatchRig, gh, ashby } from './apply_batch_harness.mjs';

const blocked = (summary) => summary.rows.filter((r) => r.action === 'guard_blocked').map((r) => r.reason);

test('V4 历史不重投：账本里有 6 月前的历史投递（同公司同标题、不同链接）→ 不派驱动', () => {
  const rig = makeBatchRig('mrw-batch-v4-');
  append(rig.home, {
    era: 'legacy', job_id: 3001, ts: '2026-05-20T00:00:00.000Z', apply_url: gh('synthesia', 111),
    company_key: 'synthesia', title_key: 'growth intern', ats: 'greenhouse',
    outcome: 'legacy_submitted', verdict: 'legacy_unverified', may_have_submitted: true,
    reason: null, evidence: null, answers: [], work_auth_provenance: null,
  });
  const rows = rig.addJobs([{ company: 'Synthesia', title: 'Growth Internship', apply_url: ashby('synthesia', 9) }]);
  const r = rig.run(rows);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(rig.driverCalls(), []);
  assert.deepEqual(blocked(r.summary), ['already_attempted_company_title']);
  assert.equal(readAll(rig.home).length, 1, 'a blocked row is not an attempt — nothing recorded');
});

test('V5「不确定」不重投：第 1 次 unknown，第 2 次重新找到同一岗位 → 不派；60 天计数算它 1 次', () => {
  const rig = makeBatchRig('mrw-batch-v5-');
  const url = ashby('pika', 1);
  rig.script({ [url]: { outcome: 'unknown', reason: 'no_errors_no_success', verdict: { verdict: 'unknown', confirmHits: [], denyHits: [] } } });
  const first = rig.addJobs([{ company: 'Pika', title: 'Ops Intern', apply_url: url }]);
  assert.equal(rig.run(first).status, 0);
  assert.equal(rig.driverCalls().length, 1);
  assert.equal(readAll(rig.home)[0].may_have_submitted, true);

  rig.newRunDb();
  const again = rig.addJobs([
    { company: 'Pika', title: 'Ops Intern', apply_url: url },
    { company: 'Pika', title: 'Design Intern', apply_url: ashby('pika', 2) },
    { company: 'Pika', title: 'Data Intern', apply_url: ashby('pika', 3) },
  ]);
  rig.script({});
  const r = rig.run(again);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(blocked(r.summary), ['already_attempted_fp', 'company_cooldown_60d']);
  assert.deepEqual(rig.driverCalls(), [url, ashby('pika', 2)], 'unknown counted as 1 of the 2 per company');
});

test('V6 投前失败重试 1 次：第 1、2 次运行都「表单没打开」→ 第 2 次重试、第 3 次不再试；不占今日额度', () => {
  const rig = makeBatchRig('mrw-batch-v6-');
  const url = ashby('elevenlabs', 1);
  rig.script({ [url]: { outcome: 'crashed', reason: 'ashby_form_not_loaded' } });
  const job = { company: 'ElevenLabs', title: 'Ops Intern', apply_url: url };
  for (let i = 0; i < 3; i += 1) {
    if (i > 0) rig.newRunDb();
    const r = rig.run(rig.addJobs([job]));
    assert.equal(r.status, 0, r.stderr);
    if (i === 2) assert.deepEqual(blocked(r.summary), ['pre_submit_retry_exhausted']);
  }
  assert.equal(rig.driverCalls().length, 2);
  assert.ok(readAll(rig.home).every((e) => e.may_have_submitted === false));
  const r = rig.run(rig.addJobs([{ company: 'Runway', title: 'Ops Intern', apply_url: gh('runway', 5) }]), ['--max', '1']);
  assert.match(r.stderr, /今日额度剩 10/, 'pre-submit failures never consumed the daily tier');
});

test('V9 同公司 60 天 2 次：同公司 3 个合适岗位 → 投 2 个，第 3 个跳过', () => {
  const rig = makeBatchRig('mrw-batch-v9-');
  const rows = rig.addJobs([1, 2, 3].map((n) => ({ company: 'HeyGen', title: `Role ${n}`, apply_url: gh('heygen', n) })));
  const r = rig.run(rows);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(rig.driverCalls().length, 2);
  assert.deepEqual(blocked(r.summary), ['company_cooldown_60d']);
});

test('V10 额度封顶：档位 10、说 50 → 最多投 10，第一行明说；不写 daily_count.jsonl', () => {
  const rig = makeBatchRig('mrw-batch-v10-');
  const rows = rig.addJobs(Array.from({ length: 12 }, (_, i) => ({ company: `Co${i}`, title: 'Intern', apply_url: gh(`co${i}`, i + 1) })));
  const r = rig.run(rows, ['--max', '50']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /你要 50，今天档位 10，今天已尝试 0\/10，本次最多投 10/);
  assert.equal(rig.driverCalls().length, 10);
  assert.deepEqual(blocked(r.summary), ['daily_cap_reached']);
  assert.equal(existsSync(join(rig.home, 'daily_count.jsonl')), false, 'the second counting book is retired');
});

test('档位 50 没有 --confirm-tier-over-30 → 开跑前响亮失败，驱动 0 次', () => {
  const rig = makeBatchRig('mrw-batch-tier-');
  const r = rig.run(rig.addJobs([{ company: 'A', title: 'Intern', apply_url: gh('a', 1) }]), [], { MRWEIRDO_DAILY_TIER: '50' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /confirm-tier-over-30/);
  assert.deepEqual(rig.driverCalls(), []);
});

test('熔断：连续 3 家 crashed（驱动异常）→ 停止派单，第 4 家不派', () => {
  const rig = makeBatchRig('mrw-batch-breaker-');
  const rows = rig.addJobs([1, 2, 3, 4].map((n) => ({ company: `Co${n}`, title: 'Intern', apply_url: gh(`co${n}`, n) })));
  rig.script(Object.fromEntries(rows.map((row) => [row.apply_url, { outcome: 'crashed', reason: 'driver_exception', error: 'boom' }])));
  const r = rig.run(rows);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(rig.driverCalls().length, 3);
  assert.match(r.stderr, /breaker/i);
  assert.equal(r.summary.breaker?.open, true);
});

test('每行派单前现读账本：别的会话刚记的账，本批下一行就看得到', () => {
  const rig = makeBatchRig('mrw-batch-fresh-');
  const rows = rig.addJobs([
    { company: 'A', title: 'Intern', apply_url: gh('a', 1) },
    { company: 'B', title: 'Intern', apply_url: gh('b', 2) },
  ]);
  // The driver for row 1 "is" another session writing row 2's attempt to the ledger.
  rig.script({});
  const writerRig = rows[1];
  append(rig.home, {
    era: 'v2', job_id: 500000, apply_url: writerRig.apply_url, company_key: 'b', title_key: 'intern', ats: 'greenhouse',
    outcome: 'submitted', verdict: 'submitted', may_have_submitted: true, reason: null, evidence: null, answers: [], work_auth_provenance: null,
  });
  const r = rig.run(rows);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(rig.driverCalls(), [rows[0].apply_url]);
  assert.deepEqual(blocked(r.summary), ['already_attempted_fp']);
});

// 回炉第 1 轮（VERIFY_REPORT 第 2 轮 P1）：页面列出必填项错误 = 表单被拒、公司没收到。
const STUCK = (missing) => ({ outcome: 'needs_user', reason: 'stuck_on_same_missing', missing });

test('补信息回路：卡缺信息 → retry_gap_rows 放回队列 → 投前闸放行、第 2 次派单投成、不报重投', () => {
  const rig = makeBatchRig('mrw-batch-gap-retry-');
  const [row] = rig.addJobs([{ company: 'Synthesia', title: 'Ops Intern', apply_url: ashby('synthesia', 7) }]);
  rig.script({ [row.apply_url]: STUCK(['What is your full address?']) });
  const first = rig.run([row]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(readAll(rig.home)[0].may_have_submitted, false, 'the page rejected the form: nothing reached the company');

  // The user answered; the onboard follow-up requeues the row (SKILL :434-443).
  const gap = join(rig.base, 'gap.json');
  writeFileSync(gap, JSON.stringify({ retry_candidates: [{ row_id: row.id, company: row.company, title: row.title, categories: ['user_full_address'] }] }));
  const requeue = spawnSync(process.execPath, ['shared/retry_gap_rows.mjs', '--apply', '--gap-report', gap], { cwd: process.cwd(), env: rig.env, encoding: 'utf8' });
  assert.equal(requeue.status, 0, requeue.stderr);
  assert.equal(JSON.parse(requeue.stdout).summary.requeued, 1);

  rig.script({});
  const second = rig.run([row]);
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(blocked(second.summary), []);
  assert.deepEqual(rig.driverCalls(), [row.apply_url, row.apply_url]);
  assert.deepEqual(readAll(rig.home).map((e) => e.verdict), ['unknown', 'submitted']);
  assert.doesNotMatch(second.stderr, /invariant_violation_reapplied/);
});

test('10 家全卡缺信息不吃光当日额度：第 11 家照投', () => {
  const rig = makeBatchRig('mrw-batch-gap-tier-');
  const rows = rig.addJobs(Array.from({ length: 11 }, (_, i) => ({ company: `Co${i}`, title: 'Intern', apply_url: gh(`co${i}`, i + 1) })));
  rig.script(Object.fromEntries(rows.slice(0, 10).map((r) => [r.apply_url, STUCK(['Why us?'])])));
  const r = rig.run(rows, ['--max', '50']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(rig.driverCalls().length, 11);
  assert.deepEqual(blocked(r.summary), []);
  assert.equal(readAll(rig.home).at(-1).verdict, 'submitted');
});
