// 2026-09-25 restart-apply 小修包第 4 项：demo:check 在 macOS 上假报「ready rows: 0」。
// 根因：supervisor_preflight --json 打出 >64KB 的 JSON 后立刻 process.exit；macOS 上
// 管道写是异步的，父进程只收到前 65536 字节，JSON.parse 失败，demo:check 把
// 「读不懂」静默显示成 0（Linux 上管道是同步写，CI 测不出来）。
// 这里走真实 CLI + 真实管道；输出必须 >64KB 才算重现了现场（断言里有这一条）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { onboardTestEnv } from './helpers.mjs';

function bigQueueHome(rows) {
  const home = mkdtempSync(join(tmpdir(), 'mrw-preflight-pipe-'));
  const env = onboardTestEnv(home, { CDP_HOST: '127.0.0.1:9' }); // closed port: CDP check fails fast, no real Chrome
  writeFileSync(join(home, 'profile.json'), JSON.stringify({ personal: { first_name: 'T', last_name: 'U', email: 't@example.com' } }));
  writeFileSync(join(home, 'search_intent.json'), JSON.stringify({ search_intent: { role_type_targets: ['intern'] } }));
  const init = spawnSync(process.execPath, ['shared/init_db_cli.mjs'], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const db = new DatabaseSync(join(home, 'jobs.db'));
  const ins = db.prepare(`INSERT INTO jobs(company, title, apply_url, status, fit_score, recommended, role_type_match, auto_apply_eligible, ats_platform)
    VALUES (?, ?, ?, '🤖 AI sourced', ?, 1, 'intern', 1, 'greenhouse')`);
  for (let i = 0; i < rows; i += 1) {
    ins.run(`Company ${i} ${'x'.repeat(900)}`, `Marketing Intern ${i} ${'y'.repeat(900)}`, `https://boards.greenhouse.io/c${i}/jobs/${i}`, i % 10);
  }
  db.close();
  return { home, env };
}

test('supervisor_preflight --json：>64KB 的输出经管道完整到达父进程', () => {
  const { env } = bigQueueHome(30);
  const r = spawnSync(process.execPath, ['shared/supervisor_preflight.mjs', '--json'], {
    cwd: process.cwd(),
    env: { ...env, MRWEIRDO_MAX_AUTO_APPLY: '0', MRWEIRDO_LOCK_SWEEP: 'report' },
    encoding: 'utf8',
  });
  let parsed = null;
  assert.doesNotThrow(() => { parsed = JSON.parse(r.stdout); }, `stdout truncated at ${Buffer.byteLength(r.stdout)} bytes`);
  assert.ok(Buffer.byteLength(r.stdout) > 65536, 'fixture must exceed one pipe buffer, or this test proves nothing');
  assert.ok(Array.isArray(parsed.queue) && parsed.queue.length > 0);
  assert.equal(r.status, parsed.ok ? 0 : 1, 'exit code still follows result.ok');
});

test('demo:check：ready rows 与 preflight 队列同数，不再假报 0', () => {
  const { env } = bigQueueHome(30);
  const pf = JSON.parse(spawnSync(process.execPath, ['shared/supervisor_preflight.mjs', '--json'], {
    cwd: process.cwd(), env: { ...env, MRWEIRDO_MAX_AUTO_APPLY: '0', MRWEIRDO_LOCK_SWEEP: 'report' }, encoding: 'utf8',
  }).stdout);
  const r = spawnSync(process.execPath, ['scripts/demo_check.mjs', '--json'], { cwd: process.cwd(), env, encoding: 'utf8' });
  const out = JSON.parse(r.stdout); // demo:check's own --json carries the preflight too (>64KB)
  assert.equal(out.facts.ready_rows, pf.queue.length);
  assert.ok(out.facts.ready_rows > 0);
});

test('demo:check：preflight 输出读不懂时响亮失败，不静默显示 0', () => {
  // The shipped demo_check.mjs, run from a throwaway repo root whose preflight
  // prints exactly what the parent saw on macOS: JSON cut off mid-way.
  const { env } = bigQueueHome(1);
  const root = mkdtempSync(join(tmpdir(), 'mrw-demo-check-root-'));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'shared'));
  copyFileSync(join(process.cwd(), 'scripts', 'demo_check.mjs'), join(root, 'scripts', 'demo_check.mjs'));
  writeFileSync(join(root, 'shared', 'supervisor_preflight.mjs'), "process.stdout.write('{\"ok\": true, \"queue\": [{\"id\": 1');\n");
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'demo_check.mjs'), '--json'], { cwd: root, env, encoding: 'utf8' });
  const out = JSON.parse(r.stdout);
  assert.equal(out.facts.ready_rows, null, 'unknown is not zero');
  const readable = out.checks.find((c) => c.name === 'supervisor_preflight_output_readable');
  assert.ok(readable && readable.ok === false, `expected a failing readable check, got ${JSON.stringify(out.checks.map((c) => c.name))}`);
  assert.equal(r.status, 1);
});
