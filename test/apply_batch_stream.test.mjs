// apply_batch 流式模式（restart-apply DESIGN §1.3 / ADR-S4 / ADR-S8）：stream_run
// 每批调它投这一批。工作库里只有本次运行的行，所以：
//   · 不跑全库去重 / 全库资格重算；不生成落在家目录的报告（分数明细不过夜，V12）；
//   · 不预截断队列：被闸拦下的行不占 --max 名额，本次目标由投前闸按开跑以来计数；
//   · 指向缺省 jobs.db 时响亮失败。
// 另：持锁进程已不在的陈旧锁自动接管并响亮说明（ADR-S8，VERIFY P3）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { append } from '../shared/submission_ledger.mjs';
import { makeBatchRig, gh } from './apply_batch_harness.mjs';
import { fakeLiveBatch } from './stream_run_harness.mjs';

const prior = (url) => ({
  era: 'v2', job_id: 5, ts: '2026-09-01T00:00:00.000Z', apply_url: url, company_key: 'old', title_key: 'x', ats: 'greenhouse',
  outcome: 'submitted', verdict: 'submitted', may_have_submitted: true, reason: null, evidence: null, answers: [], work_auth_provenance: null,
});

test('流式：拦下的行不占名额（--max 1：第 1 行已投过被拦，第 2 行照投）；不跑去重/重算/家目录报告', () => {
  const rig = makeBatchRig('mrw-batch-stream-');
  rig.newRunDb();
  append(rig.home, prior(gh('acme', 1)));
  const rows = rig.addJobs([
    { company: 'Acme', title: 'Ops Intern', apply_url: gh('acme', 1) },
    { company: 'Beta', title: 'Ops Intern', apply_url: gh('beta', 2) },
    { company: 'Gamma', title: 'Ops Intern', apply_url: gh('gamma', 3) },
  ]);
  const r = rig.run(rows, ['--max', '1', '--stream-run', 'stream-test']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(rig.driverCalls(), [gh('beta', 2)]);
  assert.equal(r.summary.stopped_by, 'run_target_reached');
  const steps = rig.steps();
  for (const skipped of ['dedupe_jobs.mjs', 'recompute_auto_apply_eligibility.mjs', 'job_report.mjs', 'apply_report.mjs']) {
    assert.ok(!steps.includes(skipped), `${skipped} must not run in stream mode`);
  }
  assert.ok(steps.includes('supervisor_preflight.mjs') && steps.includes('liveness_gate.mjs'));
});

test('流式：库路径是缺省的家目录 jobs.db → 响亮失败，什么都不派', () => {
  const rig = makeBatchRig('mrw-batch-stream-default-');
  const rows = rig.addJobs([{ company: 'Acme', title: 'Ops Intern', apply_url: gh('acme', 1) }]);
  const r = rig.run(rows, ['--stream-run', 'stream-test']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /default jobs\.db/);
  assert.deepEqual(rig.driverCalls(), []);
});

test('非流式（旧流程）不变：仍跑去重和重算', () => {
  const rig = makeBatchRig('mrw-batch-legacy-steps-');
  const r = rig.run(rig.addJobs([{ company: 'Acme', title: 'Ops Intern', apply_url: gh('acme', 1) }]));
  assert.equal(r.status, 0, r.stderr);
  assert.ok(rig.steps().includes('dedupe_jobs.mjs') && rig.steps().includes('recompute_auto_apply_eligibility.mjs'));
});

test('陈旧锁（持锁进程已经不在）→ 自动接管并响亮说明；活进程的锁仍拒绝', () => {
  const rig = makeBatchRig('mrw-batch-stale-lock-');
  const dead = spawnSync(process.execPath, ['-e', '0']).pid;
  mkdirSync(join(rig.home, 'locks'), { recursive: true });
  writeFileSync(join(rig.home, 'locks', 'apply_batch.lock'), JSON.stringify({ pid: dead, started_at: '2026-09-25T00:00:00Z' }));
  const r = rig.run(rig.addJobs([{ company: 'Acme', title: 'Ops Intern', apply_url: gh('acme', 1) }]));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /stale lock.*no longer running/);
  assert.equal(rig.driverCalls().length, 1);

  const live = fakeLiveBatch(rig.base);
  try {
    writeFileSync(join(rig.home, 'locks', 'apply_batch.lock'), JSON.stringify({ pid: live.pid, started_at: '2026-09-25T00:00:00Z' }));
    const r2 = rig.run(rig.addJobs([{ company: 'Beta', title: 'Ops Intern', apply_url: gh('beta', 2) }]));
    assert.equal(r2.status, 1);
    assert.match(r2.stderr, /another apply batch appears to be running/);
    assert.match(r2.stderr, new RegExp(`kill ${live.pid}`), 'the refusal spells out the way out');
  } finally {
    live.kill();
  }
});

test('PID 复用（VERIFY 第 5 轮 P3）：锁里的 pid 活着但不是派单进程 → 当陈旧锁接管并响亮说明', () => {
  const rig = makeBatchRig('mrw-batch-reused-pid-');
  mkdirSync(join(rig.home, 'locks'), { recursive: true });
  // process.pid = this test runner: alive, command line is not apply_batch.
  writeFileSync(join(rig.home, 'locks', 'apply_batch.lock'), JSON.stringify({ pid: process.pid, started_at: '2026-09-25T00:00:00Z' }));
  const r = rig.run(rig.addJobs([{ company: 'Acme', title: 'Ops Intern', apply_url: gh('acme', 1) }]));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, new RegExp(`stale lock.*pid ${process.pid} .*not an apply batch`));
  assert.equal(rig.driverCalls().length, 1);
});
