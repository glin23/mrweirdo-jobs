// jobs.db 退役搬归档（restart-apply ADR-S4）：历史已迁进账本并核数无误之后，把整个
// 库原样「搬」到 archive/，不删一行；默认试跑，--apply 才搬。全程假家目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { localDay } from '../shared/apply_guard.mjs';
import { onboardTestEnv } from './helpers.mjs';

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

function legacyHome({ backfill = true } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'mrw-retire-'));
  const env = onboardTestEnv(home);
  assert.equal(spawnSync(process.execPath, ['shared/init_db_cli.mjs'], { cwd: process.cwd(), env }).status, 0);
  const db = new DatabaseSync(join(home, 'jobs.db'));
  const ins = db.prepare("INSERT INTO jobs(company, title, apply_url, status, ats_platform, submitted_at) VALUES (?, 'Intern', ?, ?, 'greenhouse', '2026-06-01 10:00:00')");
  ins.run('Acme', 'https://boards.greenhouse.io/acme/jobs/1', '✅ 已投');
  ins.run('Beta', 'https://boards.greenhouse.io/beta/jobs/2', '✅ 已投');
  ins.run('Gamma', 'https://boards.greenhouse.io/gamma/jobs/3', '🤖 AI sourced');
  db.close();
  if (backfill) {
    const r = spawnSync(process.execPath, ['shared/submission_ledger.mjs', 'backfill-legacy', '--apply'], { cwd: process.cwd(), env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
  return { home, env };
}
const retire = (env, args = []) => spawnSync(process.execPath, ['shared/retire_jobs_db.mjs', ...args], { cwd: process.cwd(), env, encoding: 'utf8' });
const archived = (home) => join(home, 'archive', `jobs-legacy-${localDay(new Date())}.db`);

test('默认试跑：核数通过、列出要搬去哪，库原地不动', () => {
  const { home, env } = legacyHome();
  const before = sha(join(home, 'jobs.db'));
  const r = retire(env);
  assert.equal(r.status, 0, r.stderr);
  const plan = JSON.parse(r.stdout);
  assert.equal(plan.applied, false);
  assert.equal(plan.count_check.ok, true);
  assert.equal(plan.count_check.submitted_in_db, 2);
  assert.equal(plan.to, archived(home));
  assert.equal(sha(join(home, 'jobs.db')), before);
  assert.equal(existsSync(join(home, 'archive')), false);
});

test('--apply：原样搬到 archive/jobs-legacy-<本地日期>.db（字节不变、600、目录 700），原位置不再有库', () => {
  const { home, env } = legacyHome();
  const before = sha(join(home, 'jobs.db'));
  const r = retire(env, ['--apply']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(join(home, 'jobs.db')), false);
  assert.equal(sha(archived(home)), before, 'moved, not rewritten — every row kept');
  assert.equal(statSync(archived(home)).mode & 0o777, 0o600);
  assert.equal(statSync(join(home, 'archive')).mode & 0o777, 0o700);
  const again = retire(env, ['--apply']);
  assert.notEqual(again.status, 0, 'nothing left to retire is said out loud');
  assert.match(again.stderr, /jobs\.db.*not found|already/);
});

test('历史没迁进账本 → 拒绝搬，库原地不动', () => {
  const { home, env } = legacyHome({ backfill: false });
  const r = retire(env, ['--apply']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /backfill-legacy/);
  assert.ok(existsSync(join(home, 'jobs.db')));
});

test('归档目标已存在 / 派单锁或在途标记在 → 拒绝，不覆盖不搬', () => {
  const { home, env } = legacyHome();
  mkdirSync(join(home, 'archive'), { recursive: true });
  writeFileSync(archived(home), 'older archive');
  const r = retire(env, ['--apply']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /already exists/);
  assert.equal(readFileSync(archived(home), 'utf8'), 'older archive');

  const { home: h2, env: e2 } = legacyHome();
  mkdirSync(join(h2, 'locks'), { recursive: true });
  writeFileSync(join(h2, 'locks', 'inflight.json'), '{}');
  const r2 = retire(e2, ['--apply']);
  assert.notEqual(r2.status, 0);
  assert.match(r2.stderr, /inflight\.json/);
  assert.ok(existsSync(join(h2, 'jobs.db')));
});
