// 运行锁的两处 P3（VERIFY 第 5 轮）：
//   RACE — 两个 start 同时发起，一个把另一个「先写锁、后建目录」的锁当残留清掉，
//          两个运行并存；
//   PID  — 派单锁里的 pid 被一个无关进程复用，开跑永远被拒、提示里没有出路。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
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

test('STALE2（verify 第 6 轮）：先有一把残留运行锁，再两个 start 同时开跑 15 轮 → 每轮只开一个', async () => {
  const rig = await makeStreamRig('mrw-lock-stale2-');
  try {
    for (let round = 0; round < 15; round += 1) {
      mkdirSync(join(rig.home, 'locks'), { recursive: true });
      writeFileSync(join(rig.home, 'locks', 'stream_run.lock'), JSON.stringify({ run_id: `stream-dead-${round}`, started_at: '2026-09-25T00:00:00Z', pid: 1 }));
      const [a, b] = await Promise.all([
        rig.step(['start', '--target', '3', '--max-windows', '0']),
        rig.step(['start', '--target', '3', '--max-windows', '0']),
      ]);
      const ok = [a, b].filter((r) => r.status === 0);
      assert.equal(ok.length, 1, `round ${round}: exactly one start may win over a stale lock, got ${ok.length}\nA: ${a.stderr}\nB: ${b.stderr}`);
      assert.doesNotMatch([a, b].find((r) => r.status !== 0).stderr, /\n\s+at /, `round ${round}: no stack trace`);
      const fin = await rig.step(['finish', '--run', ok[0].json.run_id]);
      assert.equal(fin.status, 0, fin.stderr);
    }
  } finally {
    await rig.close();
  }
});

test('开跑中途死掉留下的认领文件（>30 秒）→ 不自动清（会重开竞态），报出路径让人删', async () => {
  const rig = await makeStreamRig('mrw-lock-claim-');
  try {
    const claim = join(rig.home, 'locks', 'stream_run.claim');
    mkdirSync(join(rig.home, 'locks'), { recursive: true });
    writeFileSync(claim, '');
    const old = new Date(Date.now() - 120000);
    utimesSync(claim, old, old);
    const r = await rig.step(['start', '--target', '3', '--max-windows', '0']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /stream_run\.claim is \d+s old .*delete it/);
  } finally {
    await rig.close();
  }
});
