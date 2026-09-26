// 看板改数账本（restart-apply DESIGN §2.2 S5 / ADR-S6「今日已尝试」与「已投」两个名字）。
// jobs.db 退役后它不再是任何数字的来源；档位读 MRWEIRDO_DAILY_TIER，不再写死 50。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { append } from '../shared/submission_ledger.mjs';
import { onboardTestEnv } from './helpers.mjs';

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
const now = new Date().toISOString();
let n = 0;
const line = (verdict, extra = {}) => {
  n += 1;
  return {
    era: 'v2', job_id: 100000 + n, ts: now, apply_url: `https://boards.greenhouse.io/co${n}/jobs/${n}`, company_key: `co${n}`, title_key: 'growth intern', ats: 'greenhouse',
    outcome: verdict === 'submitted' ? 'submitted' : 'unknown', verdict, may_have_submitted: true, reason: null, evidence: null, answers: [], work_auth_provenance: null, ...extra,
  };
};

function dashboard(home, extraEnv = {}) {
  const r = spawnSync(process.execPath, ['scripts/dashboard.mjs', '--once'], { cwd: process.cwd(), env: onboardTestEnv(home, extraEnv), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return stripAnsi(r.stdout);
}

test('看板数账本：今日已尝试 = 今天「可能已提交」的行；已投 = submitted + 历史；点提交前失败两个都不算；档位读环境', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-dash-'));
  append(home, line('submitted'));
  append(home, line('unknown')); // may have submitted: counts as attempted, not as 已投
  append(home, line('unknown', { outcome: 'crashed', reason: 'ashby_form_not_loaded', may_have_submitted: false }));
  append(home, line('legacy_unverified', { era: 'legacy', job_id: 7, ts: '2026-06-01T12:00:00.000Z', outcome: 'legacy_submitted' }));
  append(home, line('submitted', { ts: '2026-09-01T12:00:00.000Z', outcome: 'manual_submitted', reason: 'reported_by_user' }));
  // jobs.db is history now: whatever it says must not move a number.
  const db = new DatabaseSync(join(home, 'jobs.db'));
  db.exec("CREATE TABLE jobs(id INTEGER PRIMARY KEY, status TEXT, submitted_at TEXT); INSERT INTO jobs(status, submitted_at) VALUES ('✅ 已投', datetime('now'))");
  db.close();

  const out = dashboard(home, { MRWEIRDO_DAILY_TIER: '25' });
  assert.match(out, /今日已尝试 2\/25/);
  assert.match(out, /已投 3\b/);
  assert.match(out, /co1\s+growth intern/, 'recent attempts come from the ledger');
  assert.doesNotMatch(out, /下一批|queue/i, 'there is no queue any more');
});

test('没有账本 → 空状态，指向「跑 N 个」；缺省档位 10', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-dash-empty-'));
  const out = dashboard(home);
  assert.match(out, /今日已尝试 0\/10/);
  assert.match(out, /还没有任何投递记录/);
});
