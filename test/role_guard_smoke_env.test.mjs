// 首次真投阻塞（2026-09-26）：supervisor_preflight 以 role_targets=intern,new_grad_FT 跑，
// 里面的 role_guard_smoke 子进程继承了调用方的 MRWEIRDO_ROLE_TYPE_TARGETS 等变量，
// 在它自带的沙箱里按调用方的口径判，断言「unexpectedly passed」→ preflight 失败、0 派单。
// CI 没这个变量所以一直绿。smoke 是自带沙箱的自检：调用方的 MRWEIRDO_* 一律不继承。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CALLER_ENVS = [
  { MRWEIRDO_ROLE_TYPE_TARGETS: 'intern,new_grad_FT' },
  { MRWEIRDO_ROLE_TYPE_TARGETS: 'new_grad_FT' },
  { MRWEIRDO_MIN_FIT_SCORE: '9', MRWEIRDO_SKIP_LIVENESS: '1', MRWEIRDO_TARGET_APPLICATIONS: '1' },
  { MRWEIRDO_HOME: mkdtempSync(join(tmpdir(), 'mrw-caller-home-')), MRWEIRDO_ONBOARD_TMP_DIR: '/nonexistent/run-tmp' },
];

for (const extra of CALLER_ENVS) {
  test(`role_guard_smoke 不受调用方环境影响：${JSON.stringify(Object.keys(extra))}`, () => {
    const r = spawnSync(process.execPath, ['scripts/role_guard_smoke.mjs'], { cwd: process.cwd(), env: { ...process.env, ...extra }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });
}
