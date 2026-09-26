// lock_holder.mjs — who is behind locks/apply_batch.lock (VERIFY 第 5 轮 P3 PID 复用).
//
// The lock records the batch's pid. "That pid is alive" is not enough: after a
// SIGKILL or a reboot the number can be handed to an unrelated process, and a
// lock judged only by kill(pid, 0) then refuses every start forever. A live
// batch always runs as `node …/apply_batch.mjs`, so its command line is checked
// too. When the command line cannot be read, the answer is 'alive' — refusing
// with a way out beats taking over a lock a live driver may still hold.

import { spawnSync } from 'node:child_process';

export function batchLockHolder(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return 'gone';
  try {
    process.kill(pid, 0);
  } catch (e) {
    if (e.code === 'ESRCH') return 'gone';
    // EPERM: exists under another user — still worth reading its command line.
  }
  const ps = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
  if (ps.error) return 'alive';
  const command = (ps.stdout || '').trim();
  if (ps.status !== 0 && !command) return 'gone'; // exited between the two checks
  return /apply_batch\.mjs\b/.test(command) ? 'alive' : 'reused';
}

// The way out, spelled out, for a refusal on a live holder.
export function liveBatchHint(pid, lockPath) {
  return `if that batch is stuck, stop it with \`kill ${pid}\` and start again; if \`ps -p ${pid} -o command=\` shows no apply_batch, delete ${lockPath}`;
}
