import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { parseMachineSummary } from '../shared/job_report.mjs';
import { onboardTestEnv } from './helpers.mjs';
import { PII_TARGETS } from '../shared/state_file_lock.mjs';

test('job_report writes markdown, machine summary, and report_path only', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrweirdo-report-'));
  const env = onboardTestEnv(home);
  assert.equal(spawnSync(process.execPath, ['shared/init_db_cli.mjs'], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  }).status, 0);

  const dbFile = join(home, 'jobs.db');
	  const db = new DatabaseSync(dbFile);
	  db.prepare(`
	    INSERT INTO jobs(company, title, apply_url, location, source, status, fit_score,
	                     recommended, key_alignment, key_gaps, role_type_match, dim_scores,
	                     legitimacy, legitimacy_signals, ats_platform, outcome_status)
	    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	  `).run(
	    'Acme',
	    'Marketing Intern',
    'https://boards.greenhouse.io/acme/jobs/1',
    'New York, NY',
    'greenhouse',
	    '🤖 AI sourced',
	    8,
	    1,
	    'brand internship aligns with marketing role',
	    'SQL not visible / Tableau missing',
	    'intern',
    JSON.stringify({ role_fit: 8, location_fit: 9 }),
    'caution',
    JSON.stringify(['salary not listed']),
    'greenhouse',
    'pending'
  );
  const rowId = db.prepare(`SELECT id FROM jobs`).get().id;
  db.close();

  const result = spawnSync(process.execPath, ['shared/job_report.mjs', '--row-id', String(rowId), '--json'], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.paths.length, 1);
  assert.ok(existsSync(parsed.paths[0]));

	  const markdown = readFileSync(parsed.paths[0], 'utf8');
	  assert.match(markdown, /岗位快照 \/ Job Snapshot/);
	  assert.match(markdown, /匹配摘要 \/ Fit/);
	  assert.match(markdown, /brand internship aligns with marketing role/);
	  assert.match(markdown, /安全信号 \/ Safety/);
	  assert.match(markdown, /提交记录 \/ Submission/);
	  const summary = parseMachineSummary(markdown);
  assert.equal(summary.row_id, rowId);
  assert.equal(summary.company, 'Acme');
  assert.deepEqual(Object.keys(summary).sort(), [
    'ats_platform',
    'company',
    'dim_scores',
    'fit_score',
    'gap_fields',
    'legitimacy',
    'outcome_status',
    'row_id',
    'submitted_at',
    'title',
  ].sort());

  const after = new DatabaseSync(dbFile);
  const row = after.prepare(`SELECT status, report_path FROM jobs WHERE id = ?`).get(rowId);
  assert.equal(row.status, '🤖 AI sourced');
  assert.equal(row.report_path, parsed.paths[0]);
  after.close();
});

// 回炉第 1 轮（VERIFY_REPORT 第 2 轮 P2）：表单答案只许进 600 的账本一处。
test('job_report：驱动结果里的表单答案原文不进报告；报告文件 600、目录 700', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrweirdo-report-pii-'));
  const env = onboardTestEnv(home);
  assert.equal(spawnSync(process.execPath, ['shared/init_db_cli.mjs'], { cwd: process.cwd(), env, encoding: 'utf8' }).status, 0);
  const db = new DatabaseSync(join(home, 'jobs.db'));
  db.prepare(`INSERT INTO jobs(company, title, apply_url, status, fit_score, ats_platform)
    VALUES ('Acme', 'Ops Intern', 'https://boards.greenhouse.io/acme/jobs/7', '✅ 已投', 8, 'greenhouse')`).run();
  const rowId = db.prepare('SELECT id FROM jobs').get().id;
  db.close();
  const secrets = ['PII_MARKER_essay_fills_the_gap_in_my_experience', 'PII_MARKER_missing_nothing_salary_90k', 'PII_MARKER_required_sponsorship_yes'];
  mkdirSync(join(home, 'run-tmp'), { recursive: true });
  writeFileSync(join(home, 'run-tmp', `apply-result-${rowId}.jsonl`), `${JSON.stringify({
    outcome: 'needs_user',
    reason: 'stuck_on_same_missing',
    missing: ['Street address is required'],
    answers: secrets.map((value, i) => ({ label: `Question ${i} (required)`, value, source: 'derived', widget: 'textarea' })),
  })}\n`);
  const r = spawnSync(process.execPath, ['shared/job_report.mjs', '--row-id', String(rowId), '--append-submission'], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const path = r.stdout.trim().split('\n').pop();
  const md = readFileSync(path, 'utf8');
  for (const s of secrets) assert.ok(!md.includes(s), `answer text leaked into the report: ${s}`);
  assert.match(md, /Street address is required/, 'the page\'s own gap list is still reported');
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(statSync(join(home, 'reports', 'jobs')).mode & 0o777, 0o700);
  assert.ok(PII_TARGETS.some((t) => t?.dir === 'reports/jobs'));
});
