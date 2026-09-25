// 历史投递迁入账本（restart-apply DESIGN ADR-S9 / 未明点 4，lead 裁决：跳过行
// 只迁驱动真跑过的）。默认 dry-run 不写文件；--apply 追加 legacy 行并当场核数；
// 幂等；有一条已投推不出指纹就整批拒绝，一行不落。全程沙箱库，零真实数据。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backfillLegacy, ledgerPath, readAll } from '../shared/submission_ledger.mjs';
import { onboardTestEnv } from './helpers.mjs';

const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

function legacyHome(prefix, { badSubmittedUrl = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), prefix));
  const env = onboardTestEnv(home);
  const init = spawnSync(process.execPath, ['shared/init_db_cli.mjs'], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const dbPath = join(home, 'jobs.db');
  const db = new DatabaseSync(dbPath);
  const ins = db.prepare(`INSERT INTO jobs(company, title, apply_url, status, ats_platform, submitted_at, auto_submitted_at, updated_at, skip_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const ids = {};
  const add = (key, ...vals) => { ids[key] = Number(ins.run(...vals).lastInsertRowid); };
  add('sub_sqlite', 'Acme', 'Ops Intern', 'https://boards.greenhouse.io/acme/jobs/111', '✅ 已投', 'greenhouse', '2026-05-26 02:11:11', null, '2026-05-27 00:00:00', null);
  add('sub_auto_iso', 'Beta', 'Growth Intern', `https://jobs.ashbyhq.com/beta/${uuid(2)}`, '✅ 已投', 'ashby', null, '2026-05-26T21:09:12.303Z', '2026-05-27 00:00:00', null);
  add('sub_confirmed', 'Gamma', 'PM Intern', badSubmittedUrl ? 'https://gamma.wd5.myworkdayjobs.com/x/job/9' : 'https://gamma.com/careers?gh_jid=333', '✅ 已确认', null, null, null, '2026-06-14T21:26:36Z', null);
  add('skip_driver', 'Delta', 'Ops Intern', `https://jobs.ashbyhq.com/delta/${uuid(4)}`, '⚠️ 跳过未投', 'ashby', null, null, '2026-06-01 10:00:00', 'stuck_on_same_missing');
  add('skip_dedupe', 'Eps', 'Ops Intern', 'https://boards.greenhouse.io/eps/jobs/555', '⚠️ 跳过未投', 'greenhouse', null, null, '2026-06-01 10:00:00', 'duplicate_same_company_title_keep_id_1');
  add('skip_nofeedback', 'Zeta', 'Ops Intern', 'https://boards.greenhouse.io/zeta/jobs/666', '⚠️ 跳过未投', 'greenhouse', null, null, '2026-06-01 10:00:00', 'not_retry_for_demo_known_blocker_or_poor_fit');
  add('pending', 'Eta', 'Ops Intern', 'https://boards.greenhouse.io/eta/jobs/777', '🤖 AI sourced', 'greenhouse', null, null, '2026-06-01 10:00:00', null);
  const fb = db.prepare('INSERT INTO feedback(job_id, ts, outcome, reason, detail) VALUES (?, ?, ?, ?, ?)');
  // The funnel truncated long details to 600 chars + '...': not valid JSON any more.
  fb.run(ids.skip_driver, '2026-06-01 09:00:00', 'skip', 'stuck_on_same_missing', `${JSON.stringify({ outcome: 'skip', reason: 'stuck_on_same_missing', missing: ['Why us?'.repeat(100)] }).slice(0, 597)}...`);
  fb.run(ids.skip_driver, '2026-06-01 09:30:00', 'requeued', 'missing_info_followup_answered', JSON.stringify({ gap_report: 'x.json' }));
  fb.run(ids.skip_dedupe, '2026-06-01 09:00:00', 'skip', 'duplicate_same_company_title_keep_id_1', JSON.stringify({ keep_id: 1, company: 'eps' }));
  db.close();
  return { home, env, dbPath, ids };
}

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

test('dry-run：列出迁入计划，不建账本文件、不改库', () => {
  const { home, dbPath, ids } = legacyHome('mrw-backfill-dry-');
  const before = sha(dbPath);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const report = backfillLegacy(home, db, { apply: false });
  db.close();
  assert.equal(report.applied, false);
  assert.equal(report.submitted.count, 3);
  assert.deepEqual(report.attempts.rows.map((r) => r.job_id), [ids.skip_driver]);
  const notMigrated = Object.fromEntries(report.not_migrated.map((r) => [r.job_id, r.why]));
  assert.equal(notMigrated[ids.skip_dedupe], 'no_driver_outcome_in_feedback');
  assert.equal(notMigrated[ids.skip_nofeedback], 'no_feedback_rows');
  assert.equal(ids.pending in notMigrated, false, 'pending rows are not history');
  assert.deepEqual(report.unfingerprintable, []);
  assert.equal(existsSync(ledgerPath(home)), false, 'dry-run writes nothing');
  assert.equal(sha(dbPath), before);
});

test('--apply：追加 legacy 行、字段逐字对齐设计、当场核数通过', () => {
  const { home, dbPath, ids } = legacyHome('mrw-backfill-apply-');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const report = backfillLegacy(home, db, { apply: true });
  db.close();
  assert.equal(report.applied, true);
  assert.equal(report.appended, 4);
  assert.deepEqual(report.verify, { ok: true, submitted_in_db: 3, legacy_unverified_in_ledger: 3, fingerprints_match: true });

  const byJob = new Map(readAll(home).map((e) => [e.job_id, e]));
  const s = byJob.get(ids.sub_sqlite);
  assert.equal(s.era, 'legacy');
  assert.equal(s.verdict, 'legacy_unverified');
  assert.equal(s.outcome, 'legacy_submitted');
  assert.equal(s.may_have_submitted, true);
  assert.equal(s.apply_url, 'https://boards.greenhouse.io/acme/jobs/111');
  assert.equal(s.company_key, 'acme');
  assert.equal(s.title_key, 'ops intern');
  assert.equal(s.ats, 'greenhouse');
  assert.equal(s.ts, '2026-05-26T02:11:11.000Z', 'sqlite UTC time → ISO');
  assert.equal(byJob.get(ids.sub_auto_iso).ts, '2026-05-26T21:09:12.303Z', 'submitted_at null → auto_submitted_at');
  assert.equal(byJob.get(ids.sub_confirmed).ts, '2026-06-14T21:26:36.000Z', 'both null → updated_at');
  assert.equal(byJob.get(ids.sub_confirmed).ats, 'greenhouse', 'ats falls back to the fingerprint');

  const a = byJob.get(ids.skip_driver);
  assert.equal(a.outcome, 'legacy_attempt');
  assert.equal(a.verdict, 'unknown');
  assert.equal(a.may_have_submitted, true, 'a driver ran: never auto re-apply');
  assert.equal(a.reason, 'stuck_on_same_missing');
  assert.equal(a.ts, '2026-06-01T09:00:00.000Z', 'last driver-produced feedback time');
  assert.equal(byJob.has(ids.skip_dedupe), false);
  assert.equal(statSync(ledgerPath(home)).mode & 0o777, 0o600);
});

test('幂等：再跑一次 --apply 追加 0 行，核数照样通过', () => {
  const { home, dbPath } = legacyHome('mrw-backfill-idem-');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  backfillLegacy(home, db, { apply: true });
  const again = backfillLegacy(home, db, { apply: true });
  db.close();
  assert.equal(again.appended, 0);
  assert.equal(again.verify.ok, true);
  assert.equal(readAll(home).length, 4);
});

test('有一条已投推不出指纹：dry-run 列出来，--apply 整批拒绝、一行不落', () => {
  const { home, dbPath, ids } = legacyHome('mrw-backfill-bad-', { badSubmittedUrl: true });
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const dry = backfillLegacy(home, db, { apply: false });
  assert.deepEqual(dry.unfingerprintable.map((r) => r.job_id), [ids.sub_confirmed]);
  assert.throws(() => backfillLegacy(home, db, { apply: true }), /fingerprint/);
  db.close();
  assert.equal(existsSync(ledgerPath(home)), false);
});

test('CLI：backfill-legacy 默认 dry-run，只读打开库、不建账本', () => {
  const { home, env, dbPath } = legacyHome('mrw-backfill-cli-');
  const before = sha(dbPath);
  const run = spawnSync(process.execPath, ['shared/submission_ledger.mjs', 'backfill-legacy'], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.applied, false);
  assert.equal(report.submitted.count, 3);
  assert.equal(existsSync(ledgerPath(home)), false);
  assert.equal(sha(dbPath), before);
  const applied = spawnSync(process.execPath, ['shared/submission_ledger.mjs', 'backfill-legacy', '--apply'], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(applied.stdout).verify.ok, true);
  assert.equal(readAll(home).length, 4);
});
