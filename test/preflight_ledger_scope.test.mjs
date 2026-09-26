// preflight 的「账本↔库一致性」只核本次运行（restart-apply DESIGN §2.2 S5）。
// 即找即投时 preflight 读的是一次性工作库：账本里的历史行、以前运行的行在这个库里
// 本来就没有，不许当成「不一致」拦下整批；本次运行自己的行照旧逐行核。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { append, readAll, sqliteTs } from '../shared/submission_ledger.mjs';
import { initRunDb } from '../shared/local_db.mjs';
import { onboardTestEnv } from './helpers.mjs';

const line = (jobId, url, extra = {}) => ({
  era: 'v2', job_id: jobId, apply_url: url, company_key: 'c', title_key: 't', ats: 'greenhouse',
  outcome: 'submitted', verdict: 'submitted', may_have_submitted: true, reason: null, evidence: null, answers: [], work_auth_provenance: null, ...extra,
});

function streamHome() {
  const home = mkdtempSync(join(tmpdir(), 'mrw-preflight-scope-'));
  writeFileSync(join(home, 'profile.json'), JSON.stringify({ personal: { first_name: 'T', last_name: 'U', email: 't@example.com' } }));
  writeFileSync(join(home, 'search_intent.json'), JSON.stringify({ search_intent: { role_type_targets: ['intern'] } }));
  // history and an earlier run: not in this run's work DB
  append(home, line(42, 'https://boards.greenhouse.io/old/jobs/42', { era: 'legacy', outcome: 'legacy_submitted', verdict: 'legacy_unverified' }));
  append(home, line(100003, 'https://boards.greenhouse.io/prev/jobs/3'));
  const runDir = join(home, 'run-tmp', 'stream-x');
  mkdirSync(runDir, { recursive: true });
  const workDb = join(runDir, 'work.db');
  initRunDb({ path: workDb, seqFloor: 100003 });
  const db = new DatabaseSync(workDb);
  db.prepare(`INSERT INTO jobs(company, title, apply_url, status, ats_platform) VALUES ('Now', 'Intern', 'https://boards.greenhouse.io/now/jobs/4', '🤖 AI sourced', 'greenhouse')`).run();
  const rowId = db.prepare('SELECT id FROM jobs').get().id;
  const e = append(home, line(rowId, 'https://boards.greenhouse.io/now/jobs/4'));
  db.prepare("UPDATE jobs SET status = '✅ 已投', submitted_at = ? WHERE id = ?").run(sqliteTs(e.ts), rowId);
  db.close();
  const env = onboardTestEnv(home, { MRWEIRDO_DB_PATH: workDb, MRWEIRDO_ONBOARD_TMP_DIR: runDir, CDP_HOST: '127.0.0.1:9', MRWEIRDO_LOCK_SWEEP: 'report' });
  return { home, env, workDb, rowId };
}

function consistency(env) {
  const r = spawnSync(process.execPath, ['shared/supervisor_preflight.mjs', '--json'], { cwd: process.cwd(), env, encoding: 'utf8' });
  return JSON.parse(r.stdout).checks.find((c) => c.name === 'submission_ledger_consistent');
}

test('工作库模式：历史行 / 以前运行的行不在本库 → 不算不一致；本次运行的 1 行逐行核过', () => {
  const { env, home } = streamHome();
  assert.equal(readAll(home).length, 3);
  const c = consistency(env);
  assert.equal(c.ok, true, JSON.stringify(c.detail));
  assert.equal(c.detail.checked, 1, 'only this run\'s row is checked');
});

test('本次运行的行被人绕过记账人改了 → 仍然拦下', () => {
  const { env, workDb, rowId } = streamHome();
  const db = new DatabaseSync(workDb);
  db.prepare("UPDATE jobs SET status = '🤖 AI sourced', submitted_at = NULL WHERE id = ?").run(rowId);
  db.close();
  const c = consistency(env);
  assert.equal(c.ok, false);
  assert.deepEqual(c.detail.changes.map((x) => [x.job_id, x.action]), [[rowId, 'set_submitted']]);
});
