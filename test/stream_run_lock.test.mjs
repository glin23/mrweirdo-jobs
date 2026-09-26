// 运行锁的两处 P3（VERIFY 第 5 轮）：
//   RACE — 两个 start 同时发起，一个把另一个「先写锁、后建目录」的锁当残留清掉，
//          两个运行并存；
//   PID  — 派单锁里的 pid 被一个无关进程复用，开跑永远被拒、提示里没有出路。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeLiveBatch, makeStreamRig } from './stream_run_harness.mjs';

test('RACE：两个 start 同时发起 10 轮，每轮只能有一个开跑，另一个响亮拒绝（不吐堆栈）', async () => {
  const rig = await makeStreamRig('mrw-lock-race-');
  try {
    for (let round = 0; round < 10; round += 1) {
      const [a, b] = await Promise.all([
        rig.step(['start', '--target', '3', '--max-windows', '0']),
        rig.step(['start', '--target', '3', '--max-windows', '0']),
      ]);
      const ok = [a, b].filter((r) => r.status === 0);
      assert.equal(ok.length, 1, `round ${round}: exactly one start may win, got ${ok.length}\nA: ${a.stderr}\nB: ${b.stderr}`);
      const lost = [a, b].find((r) => r.status !== 0);
      assert.match(lost.stderr, /still active|is starting/, `round ${round}: the loser says why`);
      assert.doesNotMatch(lost.stderr, /\n\s+at /, `round ${round}: no stack trace`);
      const fin = await rig.step(['finish', '--run', ok[0].json.run_id]);
      assert.equal(fin.status, 0, fin.stderr);
    }
  } finally {
    await rig.close();
  }
});

test('PID 复用：派单锁的 pid 活着但不是派单进程 → 当陈旧锁、响亮说明后照常开跑', async () => {
  const rig = await makeStreamRig('mrw-lock-pid-');
  try {
    mkdirSync(join(rig.home, 'locks'), { recursive: true });
    // process.pid = this test runner: alive, and its command line is not apply_batch.
    writeFileSync(join(rig.home, 'locks', 'apply_batch.lock'), JSON.stringify({ pid: process.pid, started_at: '2026-09-25T00:00:00Z' }));
    const r = await rig.step(['start', '--target', '3', '--max-windows', '0']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, new RegExp(`pid ${process.pid} .*not an apply batch`));
    await rig.step(['finish', '--run', r.json.run_id]);
  } finally {
    await rig.close();
  }
});

test('真派单进程活着 → 仍拒绝，提示里写明出路（停掉那个进程的命令）', async () => {
  const rig = await makeStreamRig('mrw-lock-live-');
  const live = fakeLiveBatch(rig.base);
  try {
    mkdirSync(join(rig.home, 'locks'), { recursive: true });
    writeFileSync(join(rig.home, 'locks', 'apply_batch.lock'), JSON.stringify({ pid: live.pid, started_at: '2026-09-25T00:00:00Z' }));
    const r = await rig.step(['start', '--target', '3', '--max-windows', '0']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, new RegExp(`apply batch is running \\(pid ${live.pid}\\)`));
    assert.match(r.stderr, new RegExp(`kill ${live.pid}`), 'the way out is spelled out');
  } finally {
    live.kill();
    await rig.close();
  }
});
