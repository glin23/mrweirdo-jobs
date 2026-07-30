// submissions.jsonl — 唯一正典账本（阶段 1 设计 §14 数字变真 / ADR-13）。
// 账本纪律（验收 V6）：只许追加、改错走 correction 行、rebuild 默认 dry-run、
// --apply 幂等；唯一写账人是 record_apply_outcome（此处顺带验漏斗接线与
// 「answers 落账本不落 jobs 表」的 V8）。全程假家目录，零真实数据。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  append,
  appendCorrection,
  effectiveByJob,
  ledgerPath,
  readAll,
  rebuild,
  sqliteTs,
} from '../shared/submission_ledger.mjs';
import { onboardTestEnv } from './helpers.mjs';

const mode = (p) => statSync(p).mode & 0o777;

function baseEntry(jobId, verdict = 'submitted', extra = {}) {
  return {
    era: 'v2',
    job_id: jobId,
    company_key: 'acme',
    title_key: 'ops intern',
    ats: 'ashby',
    outcome: verdict === 'submitted' ? 'submitted' : 'not_submitted',
    verdict,
    evidence: null,
    answers: [],
    work_auth_provenance: null,
    ...extra,
  };
}

test('append：补全 id/ts、校验形状、落盘即 600/700，追加不重写（前缀哈希不变）', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-ledger-append-'));
  const first = append(home, baseEntry(1));
  assert.ok(first.id && first.ts, 'id/ts filled');
  const path = ledgerPath(home);
  assert.equal(mode(path), 0o600, 'ledger born locked');
  assert.equal(mode(join(home, 'log')), 0o700, 'log dir locked');

  const afterOne = readFileSync(path);
  const prefixHash = createHash('sha256').update(afterOne).digest('hex');
  append(home, baseEntry(2, 'not_submitted'));
  const afterTwo = readFileSync(path);
  assert.ok(afterTwo.length > afterOne.length, 'file only grows');
  assert.equal(
    createHash('sha256').update(afterTwo.subarray(0, afterOne.length)).digest('hex'),
    prefixHash,
    'append-only: the existing bytes are never rewritten'
  );

  assert.throws(() => append(home, baseEntry(3, 'nonsense')), /verdict/);
  assert.throws(() => append(home, { ...baseEntry(3), era: 'v3' }), /era/);
  assert.throws(() => append(home, { ...baseEntry(3), job_id: 'three' }), /job_id/);
  assert.throws(() => append(home, { ...baseEntry(3), correction_of: 'led_x' }), /appendCorrection/);
  assert.equal(readAll(home).length, 2, 'rejected entries never half-land');
});

test('readAll：坏行响亮报错并带行号——账本是机器写的，坏行=有人绕过写账人', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-ledger-corrupt-'));
  append(home, baseEntry(1));
  appendFileSync(ledgerPath(home), 'not json at all\n');
  assert.throws(() => readAll(home), /line 2/);
});

test('correction：必须带证据、必须指向存在的行；effectiveByJob 让更正覆盖原行', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-ledger-correction-'));
  const original = append(home, baseEntry(7, 'submitted'));
  assert.throws(() => appendCorrection(home, original.id, { verdict: 'not_submitted' }), /evidence/);
  assert.throws(() => appendCorrection(home, 'led_ghost', { verdict: 'not_submitted' }, 'shot.png'), /no ledger entry/);

  appendCorrection(home, original.id, { verdict: 'not_submitted', outcome: 'not_submitted', reason: 'screenshot_states_failure' }, 'log/screenshots/directive_304.png');
  const entries = readAll(home);
  assert.equal(entries.length, 2, 'correction is a new line, the original is untouched');
  assert.equal(entries[0].verdict, 'submitted', 'original line never edited in place');

  const eff = effectiveByJob(entries);
  assert.equal(eff.get(7).verdict, 'not_submitted', 'correction wins');
  assert.equal(eff.get(7).id, original.id, 'effective entry keeps the original identity');
  assert.ok(eff.get(7).corrected_by, 'and records which line corrected it');
});

test('effectiveByJob：同一岗位多行取最后一行（file order = 时间序）', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-ledger-last-'));
  append(home, baseEntry(9, 'not_submitted'));
  append(home, baseEntry(9, 'submitted'));
  assert.equal(effectiveByJob(readAll(home)).get(9).verdict, 'submitted');
});

// ---- 漏斗接线：record_apply_outcome 是唯一写账人 -----------------------------

function makeFunnelHome(prefix) {
  const home = mkdtempSync(join(tmpdir(), prefix));
  const env = onboardTestEnv(home);
  spawnSync(process.execPath, ['shared/init_db_cli.mjs'], { cwd: process.cwd(), env, encoding: 'utf8' });
  const db = new DatabaseSync(join(home, 'jobs.db'));
  db.prepare(`
    INSERT INTO jobs(company, title, apply_url, status, ats_platform)
    VALUES ('Acme', 'Ops Intern', 'https://jobs.ashbyhq.com/acme/1', '🤖 AI sourced', 'ashby')
  `).run();
  const rowId = db.prepare('SELECT id FROM jobs').get().id;
  db.close();
  return { home, env, rowId, dbPath: join(home, 'jobs.db') };
}

function record(env, rowId, home, outcomeObj) {
  const resultFile = join(home, `result-${rowId}.jsonl`);
  writeFileSync(resultFile, `${JSON.stringify(outcomeObj)}\n`);
  return spawnSync(process.execPath, [
    'shared/record_apply_outcome.mjs', '--row-id', String(rowId), '--result-file', resultFile,
  ], { cwd: process.cwd(), env, encoding: 'utf8' });
}

test('漏斗：每次投递先落账本行——成的、没成的、崩的各一行，verdict/answers 如实', () => {
  const { home, env, rowId } = makeFunnelHome('mrw-ledger-funnel-');
  const r1 = record(env, rowId, home, {
    outcome: 'submitted',
    verdict: { verdict: 'submitted', confirmHits: ['ashby_success'], denyHits: [] },
    post_url: 'https://x/ok',
    answers: [{ label: 'Are you authorized to work?', value: 'Yes', source: 'profile', widget: 'combobox' }],
  });
  assert.equal(r1.status, 0, r1.stderr);
  const r2 = record(env, rowId, home, { outcome: 'not_submitted', reason: 'page_states_failure' });
  assert.equal(r2.status, 0, r2.stderr);
  const r3 = record(env, rowId, home, {}); // no structured outcome → crashed synth
  const entries = readAll(home);
  assert.equal(entries.length, 3, `one ledger line per attempt, got ${entries.length}; r3=${r3.stdout}${r3.stderr}`);
  assert.deepEqual(entries.map((e) => e.verdict), ['submitted', 'not_submitted', 'unknown']);
  assert.deepEqual(entries.map((e) => e.outcome), ['submitted', 'not_submitted', 'crashed']);
  assert.equal(entries[0].answers[0].value, 'Yes', '全问答落盘 (ADR-16)');
  assert.ok(entries.every((e) => e.era === 'v2' && e.job_id === rowId && e.ats === 'ashby'));
  assert.equal(mode(ledgerPath(home)), 0o600);
});

test('验收 V8：answers 只进账本，不进 jobs 表任何列', () => {
  const { home, env, rowId, dbPath } = makeFunnelHome('mrw-ledger-v8-');
  const marker = 'V8_MARKER_only_the_ledger_may_hold_this';
  const r = record(env, rowId, home, {
    outcome: 'submitted',
    verdict: 'submitted',
    answers: [{ label: 'Why us?', value: marker, source: 'derived', widget: 'textarea' }],
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readAll(home)[0].answers[0].value, marker);
  const db = new DatabaseSync(dbPath);
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(rowId);
  const feedback = db.prepare('SELECT * FROM feedback WHERE job_id = ?').all(rowId);
  db.close();
  assert.ok(!JSON.stringify(row).includes(marker), 'answers must not land in the jobs table');
  assert.ok(readAll(home)[0].work_auth_provenance !== undefined, 'work-auth provenance snapshot attached');
  void feedback; // feedback detail carries the driver outcome (audit trail), by design
});

test('验收 V6：rebuild——正常态零差异；绕过漏斗改库被抓；--apply 修复且幂等；不碰账本没见过的行', () => {
  const { home, env, rowId, dbPath } = makeFunnelHome('mrw-ledger-rebuild-');
  const r = record(env, rowId, home, { outcome: 'submitted', verdict: 'submitted', post_url: 'https://x/ok' });
  assert.equal(r.status, 0, r.stderr);

  const db = new DatabaseSync(dbPath);
  // ① 漏斗写完、账本与缓存一致 → 零差异（submitted_at 与账本同源的证明）。
  assert.deepEqual(rebuild(home, db, { apply: false }).changes, [], 'funnel-written DB must be rebuild-clean');

  // ② 有人绕过漏斗把行改回去 → dry-run 抓到、不写库。
  db.prepare("UPDATE jobs SET status = '🤖 AI sourced', submitted_at = NULL WHERE id = ?").run(rowId);
  const dry = rebuild(home, db, { apply: false });
  assert.equal(dry.changes.length, 1);
  assert.equal(dry.changes[0].action, 'set_submitted');
  assert.equal(db.prepare('SELECT status FROM jobs WHERE id = ?').get(rowId).status, '🤖 AI sourced', 'dry-run must not write');

  // ③ --apply 修复；再跑一次差异为空（幂等）。
  rebuild(home, db, { apply: true });
  const fixed = db.prepare('SELECT status, submitted_at FROM jobs WHERE id = ?').get(rowId);
  assert.equal(fixed.status, '✅ 已投');
  assert.ok(fixed.submitted_at);
  assert.deepEqual(rebuild(home, db, { apply: true }).changes, [], 'second --apply finds nothing to do');

  // ④ 账本没见过的历史行（legacy，包 3 才迁）一个字不动。
  db.prepare(`
    INSERT INTO jobs(company, title, apply_url, status, submitted_at, ats_platform)
    VALUES ('Legacy Co', 'Old Intern', 'https://x/legacy', '✅ 已投', '2026-05-26 12:00:00', 'greenhouse')
  `).run();
  const legacyId = db.prepare("SELECT id FROM jobs WHERE company = 'Legacy Co'").get().id;
  assert.deepEqual(rebuild(home, db, { apply: true }).changes, [], 'the ledger only speaks for what it witnessed');
  const legacy = db.prepare('SELECT status, submitted_at FROM jobs WHERE id = ?').get(legacyId);
  assert.equal(legacy.submitted_at, '2026-05-26 12:00:00');
  db.close();
});

test('correction 翻回：有证据的更正让「已投」退回「跳过未投」，已确认行不降级', () => {
  const { home, env, rowId, dbPath } = makeFunnelHome('mrw-ledger-revoke-');
  const r = record(env, rowId, home, { outcome: 'submitted', verdict: 'submitted' });
  assert.equal(r.status, 0, r.stderr);
  const original = readAll(home)[0];
  appendCorrection(home, original.id, { verdict: 'not_submitted', outcome: 'not_submitted', reason: 'screenshot_states_failure' }, 'log/screenshots/proof.png');

  const db = new DatabaseSync(dbPath);
  const dry = rebuild(home, db, { apply: false });
  assert.equal(dry.changes[0].action, 'revoke_submitted');
  rebuild(home, db, { apply: true });
  const row = db.prepare('SELECT status, submitted_at, skip_reason FROM jobs WHERE id = ?').get(rowId);
  assert.equal(row.status, '⚠️ 跳过未投');
  assert.equal(row.submitted_at, null);
  assert.equal(row.skip_reason, 'screenshot_states_failure');
  assert.deepEqual(rebuild(home, db, { apply: true }).changes, [], 'revoke is idempotent too');

  // 已确认（人工确认过收件）永不被 rebuild 降级回「已投」。
  db.prepare("UPDATE jobs SET status = '✅ 已确认', submitted_at = ? WHERE id = ?").run(sqliteTs(original.ts), rowId);
  const entriesNow = readAll(home);
  const eff = effectiveByJob(entriesNow).get(rowId);
  assert.equal(eff.verdict, 'not_submitted');
  db.close();
});

test('CLI：rebuild 默认 dry-run 只读打开数据库，不落一个字节', () => {
  const { home, env, rowId, dbPath } = makeFunnelHome('mrw-ledger-cli-');
  const r = record(env, rowId, home, { outcome: 'submitted', verdict: 'submitted' });
  assert.equal(r.status, 0, r.stderr);
  const before = createHash('sha256').update(readFileSync(dbPath)).digest('hex');
  const run = spawnSync(process.execPath, ['shared/submission_ledger.mjs', 'rebuild'], {
    cwd: process.cwd(), env, encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.applied, false);
  assert.equal(before, createHash('sha256').update(readFileSync(dbPath)).digest('hex'), 'dry-run left the DB byte-identical');
});
