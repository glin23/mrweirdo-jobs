// verify 第 8 轮 P3：safe_exit 只包了 process.exit、只装在 5 个入口。apply_batch 起的
// cover letter 生成子进程（materialize_cover_letter，成功路径 print → exit(0)）不装它，
// NODE_USE_SYSTEM_CA=1 下照样偶发 SIGSEGV → 成功被当失败 → 要 cover letter 的岗被搁置；
// 未捕获异常的退出路径也包不住。改为启动时先读完系统证书，并让我们起的所有 node
// 子进程经 NODE_OPTIONS 预加载同一件事。这里用真实父进程（引入 safe_exit，和
// apply_batch 一样用 process.env 起子进程）并发起 200 个不引任何模块的最小替身子进程：
// 一种成功 exit(0)，一种抛未捕获异常，统计退出码丢失（signal）次数。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SAFE_EXIT = pathToFileURL(join(process.cwd(), 'shared', 'safe_exit.mjs')).href;

function parentRun(childSource, runs = 200) {
  const dir = mkdtempSync(join(tmpdir(), 'mrw-segv-kids-'));
  const child = join(dir, 'child.mjs');
  writeFileSync(child, childSource);
  const parent = join(dir, 'parent.mjs');
  writeFileSync(parent, `
import '${SAFE_EXIT}';
import { spawn } from 'node:child_process';
let next = 0; const codes = {};
const worker = async () => { while (next < ${runs}) { next += 1;
  const r = await new Promise((res) => { const c = spawn(process.execPath, [${JSON.stringify(child)}], { env: process.env, stdio: 'ignore' }); c.on('close', (code, signal) => res(signal || code)); });
  codes[r] = (codes[r] || 0) + 1; } };
await Promise.all(Array.from({ length: 8 }, worker));
console.log(JSON.stringify(codes));
`);
  const r = spawnSync(process.execPath, [parent], { env: { ...process.env, NODE_USE_SYSTEM_CA: '1' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

test('子进程成功 exit(0)（cover letter 生成同款）：200 次全部是 0，无 SIGSEGV', () => {
  const codes = parentRun("console.log(JSON.stringify({ ok: true, path: '/x.pdf' }));\nprocess.exit(0);\n");
  assert.deepEqual(codes, { 0: 200 });
});

test('子进程未捕获异常：200 次全部是 1，无 SIGSEGV', () => {
  const codes = parentRun("throw new Error('boom');\n");
  assert.deepEqual(codes, { 1: 200 });
});
