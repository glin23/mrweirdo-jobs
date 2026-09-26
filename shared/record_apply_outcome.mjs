#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dbPath, initDb } from './local_db.mjs';
import { companyTitleKey, jobFingerprint, normalizeCompany, normalizeTitle, SUBMITTED_STATUSES } from './job_identity.mjs';
import { onboardTmpPath } from './onboard_tmp.mjs';
import { deriveMayHaveSubmitted, validateOutcome } from './driver_contract.mjs';
import { append as ledgerAppend, readAll, sqliteTs } from './submission_ledger.mjs';
import { attemptIndex } from './apply_guard.mjs';
import { workAuthSources } from './answer_provenance.mjs';
import { atsHome } from './paths.mjs';
import { installSafeExit } from './safe_exit.mjs';

// Its exit code decides whether apply_batch keeps going or files a crash: it must
// never be lost to an exit-time SIGSEGV (see safe_exit.mjs).
installSafeExit();

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

function usage() {
  console.error('usage: node shared/record_apply_outcome.mjs --row-id <id> --result-file <driver-output.log>');
  process.exit(2);
}

const rowId = Number(argValue('--row-id') || process.env.ROW_ID || 0);
const resultFile = argValue('--result-file');
if (!rowId || !resultFile) usage();

const MANUAL_REVIEW_PATH = onboardTmpPath('manual_or_unsupported.json');
const MANUAL_REVIEW_REASONS = new Set([
  'cover_letter_required_not_generated',
  'cover_letter_file_required',
  'cover_letter_generation_failed',
  'cover_letter_input_not_found',
  'cover_letter_upload_failed',
]);

function parseOutcome(text) {
  const parsed = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const jsonStart = line.indexOf('{');
    const jsonEnd = line.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) continue;
    try {
      const obj = JSON.parse(line.slice(jsonStart, jsonEnd + 1));
      if (obj && typeof obj === 'object') parsed.push(obj);
    } catch {
      // Driver logs include human-readable lines; ignore non-JSON output.
    }
  }
  return parsed.reverse().find((obj) => typeof obj.outcome === 'string') || null;
}

function compactDetail(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 600 ? `${text.slice(0, 597)}...` : text;
}

function appendManualReviewRow(reason, detail) {
  if (!MANUAL_REVIEW_REASONS.has(reason)) return;
  try {
    mkdirSync(dirname(MANUAL_REVIEW_PATH), { recursive: true });
    let existing = [];
    if (existsSync(MANUAL_REVIEW_PATH)) {
      const parsed = JSON.parse(readFileSync(MANUAL_REVIEW_PATH, 'utf8') || '[]');
      existing = Array.isArray(parsed) ? parsed : [];
    }
    const withoutDuplicate = existing.filter((item) => Number(item.row_id || item.id || 0) !== rowId);
    withoutDuplicate.push({
      row_id: rowId,
      id: rowId,
      company: row.company,
      title: row.title,
      reason,
      manual_apply_required: true,
      source: 'auto_apply_driver',
      detail,
      added_at: new Date().toISOString(),
    });
    writeFileSync(MANUAL_REVIEW_PATH, JSON.stringify(withoutDuplicate, null, 2));
  } catch {
    // The DB skip reason remains visible; the manual review file is best-effort.
  }
}

const output = readFileSync(resultFile, 'utf8');
// A driver that died without a structured line is a CRASH, recorded as such —
// not a routine skip. 旧名 driver_no_structured_outcome 换名归入 crashed，语义
// 保留（ADR-15：静默空转是 AIHawk 被骂最凶的死法，必须响）。
let outcome;
try {
  outcome = validateOutcome(parseOutcome(output) || {
    outcome: 'crashed',
    reason: 'driver_died_without_outcome',
    detail: 'no structured outcome line found in the driver result file',
  });
} catch (e) {
  // Contract violation = producer bug. Loud exit, row untouched, no bucketing.
  console.error(JSON.stringify({ ok: false, reason: 'driver_outcome_contract_violation', row_id: rowId, error: e.message }));
  process.exit(1);
}
initDb();
const db = new DatabaseSync(dbPath());
const row = db.prepare('SELECT id, company, title, status, ats_platform, apply_url FROM jobs WHERE id = ?').get(rowId);
if (!row) {
  console.error(JSON.stringify({ ok: false, reason: 'row_not_found', row_id: rowId }));
  process.exit(1);
}

// The ledger line comes FIRST — before any DB write, for every attempt, 成没成
// 都记 (ADR-13 唯一正典 / ADR-16 全问答落盘). If the ledger cannot be written,
// the throw below stops the recorder before the cache (DB) diverges from it.
const pageVerdict = outcome.verdict && typeof outcome.verdict === 'object' ? outcome.verdict.verdict : outcome.verdict;
const ledgerEntry = ledgerAppend(atsHome(), {
  era: 'v2',
  job_id: rowId,
  apply_url: row.apply_url,
  company_key: normalizeCompany(row.company),
  title_key: normalizeTitle(row.title),
  ats: row.ats_platform || null,
  outcome: outcome.outcome,
  // Page verdict wins when present. Without one, a claimed failure may stand as
  // failure (the dangerous direction is only unbacked SUCCESS — that one throws
  // in validateOutcome); anything else is honestly unknown.
  verdict: ['submitted', 'not_submitted'].includes(pageVerdict) ? pageVerdict
    : outcome.outcome === 'not_submitted' ? 'not_submitted' : 'unknown',
  // 「投过」唯一口径（ADR-S6）：只在 driver_contract 推导，这里不写第二份规则。
  may_have_submitted: deriveMayHaveSubmitted(outcome),
  reason: outcome.reason ?? null,
  evidence: outcome.evidence ?? null,
  answers: Array.isArray(outcome.answers) ? outcome.answers : [],
  work_auth_provenance: workAuthSources(atsHome()),
});

// Answers belong to the ledger ONLY (600 file, ADR-16). Everything written below
// — feedback.detail in the 644 jobs.db, the manual-review file — gets this copy
// without them (第 7 轮验收 P2: 表单答案含工作授权族，曾随 detail 整段入库).
const { answers: _ledgerOnlyAnswers, ...auditOutcome } = outcome;

function writeFeedback(reason, detail) {
  try {
    db.prepare('INSERT INTO feedback(job_id, outcome, reason, detail) VALUES (?, ?, ?, ?)').run(
      rowId,
      outcome.outcome || 'unknown',
      reason,
      compactDetail(detail)
    );
  } catch {
    // The jobs table update is the source of truth; feedback insert is best-effort.
  }
}

function markSkipped(reason, detail = auditOutcome, action = 'skipped') {
  if (SUBMITTED_STATUSES.has(row.status)) {
    writeFeedback('not_downgrading_submitted_row', { reason, detail, current_status: row.status });
    console.log(JSON.stringify({ ok: true, action: 'unchanged', row_id: rowId, status: row.status }));
    return;
  }
  db.prepare(`
    UPDATE jobs
       SET status = '⚠️ 跳过未投',
           skip_reason = ?,
           bot_note = 'mrweirdo auto-apply skipped after driver verification',
           auto_apply_eligible = 0,
           updated_at = datetime('now')
     WHERE id = ?
	  `).run(reason, rowId);
	  writeFeedback(reason, detail);
	  appendManualReviewRow(reason, detail);
	  console.log(JSON.stringify({ ok: true, action, row_id: rowId, reason }));
	}

if (outcome.outcome !== 'submitted') {
  // essay_pending is a reason inside the needs_user family now (契约词汇表里
  // 没有它单独的席位), but its manual-review semantics are unchanged.
  if (outcome.outcome === 'needs_user' && outcome.reason === 'essay_pending') {
    markSkipped('essay_pending_main_agent_required', auditOutcome, 'essay_pending');
    process.exit(0);
  }
  markSkipped(outcome.reason || outcome.outcome);
  process.exit(0);
}

// 投后查重 → 不变量（restart-apply DESIGN §1.4 难点四）. The dispatch guard
// (apply_guard.checkDispatch, re-reading the ledger before every spawn) is where
// re-applications are stopped. Reaching this line with a prior 投过 on the same
// fingerprint or company+title means one already went out: record the truth
// (the ledger line above, the DB row below says 已投) and fail LOUDLY — never
// relabel a real submission as a skip.
const priorIdx = attemptIndex(readAll(atsHome()).filter((e) => e.id !== ledgerEntry.id));
const priorAttempt = priorIdx.byFp.get(jobFingerprint(row.apply_url).fp)?.at(-1)
  || priorIdx.byCompanyTitle.get(companyTitleKey(row.company, row.title))?.at(-1)
  || null;

if (row.status !== '🤖 AI sourced' && !SUBMITTED_STATUSES.has(row.status)) {
  markSkipped('row_status_changed_before_recording', { current_status: row.status, driver_outcome: auditOutcome });
  process.exit(0);
}

// submitted_at 与账本同源（同一个 ts）——rebuild 重算出来必须逐字节相同，否则
// 「账本是正典、DB 是缓存」只是一句口号（阶段 1 设计 §14.4.1 调用流）。
db.prepare(`
  UPDATE jobs
     SET status = '✅ 已投',
         submitted_at = COALESCE(submitted_at, ?),
         auto_submitted_at = COALESCE(auto_submitted_at, ?),
         confirmation_url = COALESCE(?, confirmation_url),
         skip_reason = NULL,
         bot_note = 'mrweirdo auto-apply verified by driver success check',
         auto_apply_eligible = 0,
         updated_at = datetime('now')
   WHERE id = ?
`).run(sqliteTs(ledgerEntry.ts), sqliteTs(ledgerEntry.ts), outcome.post_url || outcome.url || null, rowId);
if (priorAttempt) {
  writeFeedback('invariant_violation_reapplied', { prior_ledger_id: priorAttempt.id, driver_outcome: auditOutcome });
  console.error(JSON.stringify({
    ok: false,
    reason: 'invariant_violation_reapplied',
    row_id: rowId,
    ledger_id: ledgerEntry.id,
    prior_ledger_id: priorAttempt.id,
    prior_job_id: priorAttempt.job_id,
    error: 'this job had already been attempted, and it was submitted AGAIN — the pre-dispatch guard was bypassed or broken',
  }));
  process.exit(1);
}
writeFeedback('submitted_verified', auditOutcome);
console.log(JSON.stringify({
  ok: true,
  action: 'submitted',
  row_id: rowId,
  confirmation_url: outcome.post_url || outcome.url || null,
}));
