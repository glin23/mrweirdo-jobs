import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Every node -e child preloads the system-CA read, like our entries (no exit-time SIGSEGV with NODE_USE_SYSTEM_CA=1).
const PRELOAD = `--import=${new URL('../shared/preload_system_ca.mjs', import.meta.url).href}`;

test('progress helper writes to stderr, never stdout', () => {
  const result = spawnSync(process.execPath, [
    PRELOAD,
    '--input-type=module',
    '-e',
    "import { progress } from './shared/progress.mjs'; progress('test', 'hello');",
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /\[mrweirdo\] test hello/);
});

test('MRWEIRDO_QUIET suppresses progress output', () => {
  const result = spawnSync(process.execPath, [
    PRELOAD,
    '--input-type=module',
    '-e',
    "import { progress } from './shared/progress.mjs'; progress('test', 'hello');",
  ], {
    cwd: process.cwd(),
    env: { ...process.env, MRWEIRDO_QUIET: '1' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});
