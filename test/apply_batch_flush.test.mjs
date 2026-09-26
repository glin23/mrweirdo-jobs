// verify 第 7 轮 FLUSH（P2）：apply_batch 的 runTee 在 out.end() 后立刻返回，驱动的
// 结果文件还没落盘记账人就去读，读不到最后一行结局 → 记成 crashed「可能已提交」
// （永久封岗、占名额），连续 3 次就熔断停批。只有写盘慢时才出现，所以这里用确定性
// 的慢磁盘预加载（test/fixtures/slowfs.cjs）复现，不靠多跑几次碰运气。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readAll } from '../shared/submission_ledger.mjs';
import { makeBatchRig, gh } from './apply_batch_harness.mjs';

const SLOW_DISK = { NODE_OPTIONS: `--require ${join(process.cwd(), 'test', 'fixtures', 'slowfs.cjs')}` };

test('慢磁盘：每家驱动的结局都被记账人读到——不记成 crashed、不熔断，4 家照投', () => {
  const rig = makeBatchRig('mrw-batch-flush-');
  const rows = rig.addJobs(Array.from({ length: 4 }, (_, i) => ({ company: `Co${i}`, title: 'Intern', apply_url: gh(`co${i}`, i + 1) })));
  rig.script(Object.fromEntries(rows.slice(0, 3).map((r) => [r.apply_url, { outcome: 'needs_user', reason: 'stuck_on_same_missing', missing: ['Why us?'] }])));
  const r = rig.run(rows, ['--max', '50'], SLOW_DISK);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /breaker open/);
  assert.equal(rig.driverCalls().length, 4);
  const lines = readAll(rig.home);
  assert.deepEqual(lines.map((e) => e.outcome), ['needs_user', 'needs_user', 'needs_user', 'submitted'], 'the outcome line in each result file was read, not synthesized as crashed');
  assert.ok(lines.every((e) => e.reason !== 'driver_died_without_outcome'));
});
