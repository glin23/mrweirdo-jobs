// 在途标记与崩溃恢复（restart-apply DESIGN §4.2 / ADR-S8）。
// 驱动可能已点提交、账本还没写，进程死了 → 下次开跑先补记，且这个岗位永不自动重投。
// 最坏只能是「漏投 1 家」，绝不能是「重投 1 家」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readAll } from '../shared/submission_ledger.mjs';
import { inflightPath, readInflight, writeInflight } from '../shared/apply_guard.mjs';
import { makeBatchRig, gh } from './apply_batch_harness.mjs';

function strand(rig, row, resultText) {
  const resultFile = join(rig.base, `apply-result-${row.id}.jsonl`);
  if (resultText != null) writeFileSync(resultFile, resultText);
  writeInflight(rig.home, {
    run_id: 'dead-run', work_db: rig.env.MRWEIRDO_DB_PATH, row_id: row.id, apply_url: row.apply_url,
    result_file: resultFile, started_at: new Date(Date.now() - 60_000).toISOString(),
  });
}

test('崩在点提交之后、写账之前：下次开跑补记 crashed/recovered_inflight（可能已提交），且不再派这个岗', () => {
  const rig = makeBatchRig('mrw-inflight-died-');
  const [row] = rig.addJobs([{ company: 'Synthesia', title: 'Ops Intern', apply_url: gh('synthesia', 1) }]);
  strand(rig, row, '[driver] clicking submit…\n'); // the tee file has no structured line
  rig.newRunDb();
  const again = rig.addJobs([{ company: 'Synthesia', title: 'Ops Intern', apply_url: row.apply_url }]);
  const r = rig.run(again);
  assert.equal(r.status, 0, r.stderr);
  const [e] = readAll(rig.home);
  assert.equal(e.job_id, row.id);
  assert.equal(e.outcome, 'crashed');
  assert.equal(e.reason, 'recovered_inflight');
  assert.equal(e.verdict, 'unknown');
  assert.equal(e.may_have_submitted, true);
  assert.equal(readInflight(rig.home), null, 'marker cleared once recorded');
  assert.deepEqual(rig.driverCalls(), [], 'the stranded job is never auto re-applied');
  assert.match(r.stderr, /unrecorded attempt/);
});

test('驱动已吐完结局、只是记账人没跑：按驱动的结局补记', () => {
  const rig = makeBatchRig('mrw-inflight-finished-');
  const [row] = rig.addJobs([{ company: 'Pika', title: 'Ops Intern', apply_url: gh('pika', 1) }]);
  strand(rig, row, `${JSON.stringify({ outcome: 'submitted', verdict: { verdict: 'submitted', confirmHits: ['x'], denyHits: [] } })}\n`);
  const r = rig.run([]);
  assert.equal(r.status, 0, r.stderr);
  const [e] = readAll(rig.home);
  assert.equal(e.outcome, 'submitted');
  assert.equal(e.verdict, 'submitted');
});

test('结果文件都没了（临时目录被清）：同样补记 recovered_inflight', () => {
  const rig = makeBatchRig('mrw-inflight-nofile-');
  const [row] = rig.addJobs([{ company: 'Pika', title: 'Ops Intern', apply_url: gh('pika', 2) }]);
  strand(rig, row, null);
  const r = rig.run([]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readAll(rig.home)[0].reason, 'recovered_inflight');
});

test('账本其实已记（死在清标记之前）：只清标记，不重复记账', () => {
  const rig = makeBatchRig('mrw-inflight-recorded-');
  const [row] = rig.addJobs([{ company: 'Runway', title: 'Ops Intern', apply_url: gh('runway', 1) }]);
  const first = rig.run([row]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(readAll(rig.home).length, 1);
  strand(rig, row, 'irrelevant\n');
  const r = rig.run([]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readAll(rig.home).length, 1, 'no second line for the same attempt');
  assert.equal(existsSync(inflightPath(rig.home)), false);
});

test('本批记账失败：停止派单并保留标记；下次开跑补记也失败 → 响亮退出、驱动 0 次', () => {
  const rig = makeBatchRig('mrw-inflight-recfail-');
  const rows = rig.addJobs([
    { company: 'A', title: 'Intern', apply_url: gh('a', 1) },
    { company: 'B', title: 'Intern', apply_url: gh('b', 2) },
  ]);
  rig.script({ [rows[0].apply_url]: { outcome: 'skip', reason: 'legacy_word' } }); // contract violation → recorder exits 1
  const r = rig.run(rows);
  assert.deepEqual(rig.driverCalls(), [rows[0].apply_url], 'the batch stops at the unrecorded attempt');
  assert.ok(readInflight(rig.home), 'the marker survives until the attempt is recorded');
  assert.equal(r.summary.stopped_by, 'record_failed');

  const again = rig.run([rows[1]]);
  assert.notEqual(again.status, 0, 'recovery that cannot record must stop the run');
  assert.deepEqual(rig.driverCalls(), [rows[0].apply_url]);
});
