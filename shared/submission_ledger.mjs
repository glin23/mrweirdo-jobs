#!/usr/bin/env node
// submission_ledger.mjs — 「投出去了没有」这一件事实的唯一正典（阶段 1 设计 §14
// 数字变真 / ADR-13）。
//
// The ledger is ~/.mrweirdo-jobs/log/submissions.jsonl: append-only, one JSON
// line per application attempt (成没成都记). Rules that make it a ledger and
// not just another log:
//   * Only appends. A wrong line is never edited in place — a correction line
//     referencing the original is appended instead (career-ops status-log.tsv
//     体例：账本永不原地改，改错补更正行).
//   * One writer: shared/record_apply_outcome.mjs（唯一写账人，包 3 源码守卫）.
//   * jobs.db 的 status / submitted_at / auto_submitted_at 三列降级为派生缓存，
//     `node shared/submission_ledger.mjs rebuild` 随时从账本重算（默认 dry-run
//     只打印差异，--apply 才写库——与「默认试跑、显式开投」同一条纪律）。
//   * The file carries every answer typed onto real forms — the highest PII
//     density in the repo — so it is locked 600 at every write (B3-a).

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { lockDir, lockFile } from './state_file_lock.mjs';
import { SUBMITTED_STATUSES } from './job_identity.mjs';

export const LEDGER_RELPATH = 'log/submissions.jsonl';
export const LEDGER_ERAS = Object.freeze(['v2', 'legacy']);
export const LEDGER_VERDICTS = Object.freeze(['submitted', 'not_submitted', 'unknown', 'legacy_unverified']);

export function ledgerPath(home) {
  if (!home) throw new Error('ledgerPath: home is required — never guess the state home');
  return join(home, LEDGER_RELPATH);
}

function assertEntryShape(entry) {
  if (!entry || typeof entry !== 'object') throw new Error('ledger entry must be an object');
  if (!LEDGER_ERAS.includes(entry.era)) throw new Error(`ledger entry era "${entry.era}" not in ${LEDGER_ERAS.join('|')}`);
  if (!LEDGER_VERDICTS.includes(entry.verdict)) throw new Error(`ledger entry verdict "${entry.verdict}" not in ${LEDGER_VERDICTS.join('|')}`);
  if (!Number.isInteger(entry.job_id) || entry.job_id <= 0) throw new Error(`ledger entry job_id must be a positive integer, got ${JSON.stringify(entry.job_id)}`);
  if (typeof entry.outcome !== 'string' || !entry.outcome) throw new Error('ledger entry outcome (string) is required');
}

function writeLine(home, entry) {
  const path = ledgerPath(home);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  lockDir(dirname(path));
  appendFileSync(path, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  lockFile(path); // pre-existing file keeps 600 even if it was born looser
  return entry;
}

// Appends one attempt line. id/ts are filled if absent so every line is
// individually addressable (corrections need that).
export function append(home, entry) {
  const full = {
    id: entry?.id || `led_${Date.now()}_${entry?.job_id ?? 'x'}_${randomBytes(3).toString('hex')}`,
    ts: entry?.ts || new Date().toISOString(),
    correction_of: null,
    ...entry,
  };
  assertEntryShape(full);
  if (full.correction_of) throw new Error('append: use appendCorrection for correction lines');
  return writeLine(home, full);
}

// Appends a correction line referencing an existing entry id. The patch is the
// fields that were wrong (typically verdict/outcome); evidence says WHY —
// corrections without evidence are just as untrustworthy as the original error.
export function appendCorrection(home, refId, patch, evidence) {
  if (!refId) throw new Error('appendCorrection: refId (the corrected entry id) is required');
  if (!evidence) throw new Error('appendCorrection: evidence is required — a correction must say why');
  const target = readAll(home).find((e) => e.id === refId);
  if (!target) throw new Error(`appendCorrection: no ledger entry with id ${refId}`);
  const full = {
    ...target,
    ...patch,
    id: `cor_${Date.now()}_${target.job_id}_${randomBytes(3).toString('hex')}`,
    ts: new Date().toISOString(),
    correction_of: refId,
    evidence: evidence ?? target.evidence,
  };
  assertEntryShape(full);
  return writeLine(home, full);
}

// Reads every line. A corrupt line is a data-integrity failure and THROWS with
// its line number — silently skipping ledger lines is how numbers rot.
export function readAll(home) {
  const path = ledgerPath(home);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').split('\n');
  const entries = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch (e) {
      throw new Error(`submissions.jsonl line ${i + 1} is not valid JSON (${e.message}) — the ledger is machine-written; a corrupt line means something bypassed the writer`);
    }
  }
  return entries;
}

// Per job_id: the LAST non-correction line in file order, with corrections
// applied (a correction overrides the entry it references; later corrections
// to the same entry win). §14.3 rebuild 派生规则的实现。
export function effectiveByJob(entries) {
  const corrections = new Map(); // corrected entry id -> latest correction line
  for (const e of entries) {
    if (e.correction_of) corrections.set(e.correction_of, e);
  }
  const byJob = new Map();
  for (const e of entries) {
    if (e.correction_of) continue;
    const c = corrections.get(e.id);
    const effective = c ? { ...e, ...c, id: e.id, ts: e.ts, corrected_by: c.id } : e;
    byJob.set(e.job_id, effective);
  }
  return byJob;
}

// ISO timestamp → sqlite datetime('now') shape (UTC), so rebuild output is
// byte-comparable with what the funnel wrote.
export function sqliteTs(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`ledger ts "${iso}" is not a valid date`);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// Recomputes the derived DB columns from the ledger. Returns the diff; writes
// only with { apply: true }. Rows the ledger has never seen (pre-ledger
// history, until 包 3 backfill) are NOT touched — the ledger only speaks for
// what it witnessed. A correction that flips a submission away revokes the row.
export function rebuild(home, db, { apply = false } = {}) {
  const effective = effectiveByJob(readAll(home));
  const changes = [];
  const report = { checked: effective.size, applied: Boolean(apply), changes };
  for (const [jobId, e] of effective) {
    const row = db.prepare('SELECT id, status, submitted_at FROM jobs WHERE id = ?').get(jobId);
    if (!row) {
      changes.push({ job_id: jobId, action: 'ledger_row_without_db_row', ledger_id: e.id });
      continue;
    }
    if (e.verdict === 'submitted') {
      const wantStatus = SUBMITTED_STATUSES.has(row.status) ? row.status : '✅ 已投'; // never downgrade 已确认
      const wantTs = sqliteTs(e.ts);
      if (row.status !== wantStatus || row.submitted_at !== wantTs) {
        changes.push({
          job_id: jobId,
          action: 'set_submitted',
          from: { status: row.status, submitted_at: row.submitted_at },
          to: { status: wantStatus, submitted_at: wantTs },
        });
        if (apply) {
          db.prepare(`
            UPDATE jobs SET status = ?, submitted_at = ?, skip_reason = NULL, updated_at = datetime('now') WHERE id = ?
          `).run(wantStatus, wantTs, jobId);
        }
      }
      continue;
    }
    if (e.corrected_by && SUBMITTED_STATUSES.has(row.status)) {
      // 更正翻回：the ledger's last word on this attempt is "not submitted",
      // arrived via an evidence-backed correction (ADR-17 的机制面).
      changes.push({
        job_id: jobId,
        action: 'revoke_submitted',
        from: { status: row.status, submitted_at: row.submitted_at },
        to: { status: '⚠️ 跳过未投', submitted_at: null },
        evidence: e.evidence ?? null,
      });
      if (apply) {
        db.prepare(`
          UPDATE jobs
             SET status = '⚠️ 跳过未投',
                 submitted_at = NULL,
                 auto_submitted_at = NULL,
                 skip_reason = ?,
                 updated_at = datetime('now')
           WHERE id = ?
        `).run(e.reason || 'ledger_correction', jobId);
      }
    }
    // Plain non-submitted attempts change nothing: a failed try does not
    // un-submit anything, and the skip columns were written by the funnel.
  }
  return report;
}

// CLI: `node shared/submission_ledger.mjs rebuild [--apply]`
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  const cmd = process.argv[2];
  if (cmd !== 'rebuild') {
    console.error('usage: node shared/submission_ledger.mjs rebuild [--apply]');
    console.error('  (backfill-legacy 属包 3，等拍板人对历史更正点头后才实现)');
    process.exit(2);
  }
  const { atsHome } = await import('./paths.mjs');
  const { DatabaseSync } = await import('node:sqlite');
  const { dbPath, initDb } = await import('./local_db.mjs');
  const apply = process.argv.includes('--apply');
  initDb();
  const db = new DatabaseSync(dbPath(), { readOnly: !apply });
  const report = rebuild(atsHome(), db, { apply });
  console.log(JSON.stringify(report, null, 2));
  if (!apply && report.changes.length > 0) {
    console.error(`[submission_ledger] dry-run: ${report.changes.length} difference(s) between ledger and DB — review above, then re-run with --apply`);
  }
}
