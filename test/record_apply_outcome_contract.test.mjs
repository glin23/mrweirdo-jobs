// record_apply_outcome × 统一退出契约（阶段 1 设计 §14 数字变真 / ADR-15）。
// 漏斗侧的四条纪律：① 旧词响亮拒绝 ② 驱动没吐 JSON 合成 crashed（不再是例行 skip）
// ③ 成功路仅在 verdict==='submitted' 时走 ④ essay_pending 族以 needs_user+reason 表达。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { onboardTestEnv } from './helpers.mjs';

function makeHome(prefix) {
  const home = mkdtempSync(join(tmpdir(), prefix));
  const env = onboardTestEnv(home);
  spawnSync(process.execPath, ['shared/init_db_cli.mjs'], { cwd: process.cwd(), env, encoding: 'utf8' });
  const db = new DatabaseSync(join(home, 'jobs.db'));
  db.prepare(`
    INSERT INTO jobs(company, title, apply_url, status)
    VALUES ('Acme', 'Ops Intern', 'https://jobs.ashbyhq.com/acme/1', '🤖 AI sourced')
  `).run();
  const rowId = db.prepare('SELECT id FROM jobs').get().id;
  db.close();
  return { home, env, rowId, dbPath: join(home, 'jobs.db') };
}

function record(env, rowId, resultFile) {
  return spawnSync(process.execPath, [
    'shared/record_apply_outcome.mjs', '--row-id', String(rowId), '--result-file', resultFile,
  ], { cwd: process.cwd(), env, encoding: 'utf8' });
}

test('旧词「skip」被响亮拒绝：非零退出 + 指向契约的报错，不再静默记为跳过', () => {
  const { home, env, rowId, dbPath } = makeHome('mrw-rec-legacy-');
  const resultFile = join(home, 'result.jsonl');
  writeFileSync(resultFile, `${JSON.stringify({ outcome: 'skip', reason: 'stuck_on_same_missing' })}\n`);
  const r = record(env, rowId, resultFile);
  assert.notEqual(r.status, 0, `legacy vocabulary must fail loudly, got exit ${r.status}\nstdout=${r.stdout}`);
  assert.match(`${r.stdout}${r.stderr}`, /not in the contract|contract/i);
  const db = new DatabaseSync(dbPath);
  const row = db.prepare('SELECT status FROM jobs WHERE id = ?').get(rowId);
  db.close();
  assert.equal(row.status, '🤖 AI sourced', 'a rejected outcome must not touch the row');
});

test('驱动没吐 JSON：合成 crashed 记录（AIHawk 教训——坏了不出声是最凶的死法）', () => {
  const { home, env, rowId, dbPath } = makeHome('mrw-rec-crashed-');
  const resultFile = join(home, 'result.jsonl');
  writeFileSync(resultFile, 'TypeError: boom\n  at somewhere\n');
  const r = record(env, rowId, resultFile);
  assert.equal(r.status, 0, r.stderr);
  const recorded = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(recorded.reason, 'driver_died_without_outcome');
  const db = new DatabaseSync(dbPath);
  const row = db.prepare('SELECT status, skip_reason FROM jobs WHERE id = ?').get(rowId);
  const fb = db.prepare('SELECT outcome FROM feedback WHERE job_id = ?').get(rowId);
  db.close();
  assert.equal(row.status, '⚠️ 跳过未投');
  assert.equal(row.skip_reason, 'driver_died_without_outcome');
  assert.equal(fb.outcome, 'crashed', 'the synthesized outcome word is crashed, not unknown/skip');
});

test('成功路仅在 verdict submitted 时走：光喊 submitted 不带页面判定 = 响亮失败', () => {
  const { home, env, rowId, dbPath } = makeHome('mrw-rec-verdictless-');
  const resultFile = join(home, 'result.jsonl');
  writeFileSync(resultFile, `${JSON.stringify({ outcome: 'submitted', post_url: 'https://x/confirmation' })}\n`);
  const r = record(env, rowId, resultFile);
  assert.notEqual(r.status, 0, `verdict-less submitted must fail loudly, got exit ${r.status}\nstdout=${r.stdout}`);
  const db = new DatabaseSync(dbPath);
  const row = db.prepare('SELECT status, submitted_at FROM jobs WHERE id = ?').get(rowId);
  db.close();
  assert.equal(row.status, '🤖 AI sourced', 'no page verdict, no success row');
  assert.equal(row.submitted_at, null);
});

test('带判定的 submitted 正常入账：状态、时间戳、confirmation_url', () => {
  const { home, env, rowId, dbPath } = makeHome('mrw-rec-submitted-');
  const resultFile = join(home, 'result.jsonl');
  writeFileSync(resultFile, `${JSON.stringify({
    outcome: 'submitted',
    verdict: { verdict: 'submitted', confirmHits: ['ashby_success'], denyHits: [] },
    post_url: 'https://jobs.ashbyhq.com/acme/1/success',
  })}\n`);
  const r = record(env, rowId, resultFile);
  assert.equal(r.status, 0, r.stderr);
  const db = new DatabaseSync(dbPath);
  const row = db.prepare('SELECT status, submitted_at, confirmation_url FROM jobs WHERE id = ?').get(rowId);
  db.close();
  assert.equal(row.status, '✅ 已投');
  assert.ok(row.submitted_at, 'submitted_at set');
  assert.equal(row.confirmation_url, 'https://jobs.ashbyhq.com/acme/1/success');
});

test('essay_pending 族 = needs_user + reason：专用 action 与人工复核语义保留', () => {
  const { home, env, rowId, dbPath } = makeHome('mrw-rec-essay-');
  const resultFile = join(home, 'result.jsonl');
  writeFileSync(resultFile, `${JSON.stringify({
    outcome: 'needs_user',
    reason: 'essay_pending',
    pending: [{ question: 'Why us?', selector: 'textarea' }],
  })}\n`);
  const r = record(env, rowId, resultFile);
  assert.equal(r.status, 0, r.stderr);
  const recorded = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(recorded.action, 'essay_pending');
  const db = new DatabaseSync(dbPath);
  const row = db.prepare('SELECT status, skip_reason FROM jobs WHERE id = ?').get(rowId);
  db.close();
  assert.equal(row.status, '⚠️ 跳过未投');
  assert.equal(row.skip_reason, 'essay_pending_main_agent_required');
});

test('not_submitted / unknown / captcha_blocked / rate_limited 逐一落为跳过并保留原因', () => {
  for (const [outcome, reason] of [
    ['not_submitted', 'page_states_failure'],
    ['unknown', 'no_errors_no_success'],
    ['captcha_blocked', 'captcha_detected'],
    ['rate_limited', 'max_attempts_exceeded'],
  ]) {
    const { home, env, rowId, dbPath } = makeHome('mrw-rec-family-');
    const resultFile = join(home, 'result.jsonl');
    writeFileSync(resultFile, `${JSON.stringify({ outcome, reason })}\n`);
    const r = record(env, rowId, resultFile);
    assert.equal(r.status, 0, `${outcome}: ${r.stderr}`);
    const db = new DatabaseSync(dbPath);
    const row = db.prepare('SELECT status, skip_reason FROM jobs WHERE id = ?').get(rowId);
    const fb = db.prepare('SELECT outcome FROM feedback WHERE job_id = ?').get(rowId);
    db.close();
    assert.equal(row.status, '⚠️ 跳过未投', outcome);
    assert.equal(row.skip_reason, reason, outcome);
    assert.equal(fb.outcome, outcome, 'feedback carries the contract word');
  }
});
