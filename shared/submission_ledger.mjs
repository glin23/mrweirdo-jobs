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
//   * One writer per kind of fact: shared/record_apply_outcome.mjs for every
//     driver attempt（唯一写账人，包 3 源码守卫）; this module's own CLI only for
//     history migrated from jobs.db (backfill-legacy) and applications the user
//     made by hand (record-manual).
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
import { SUBMITTED_STATUSES, boardSlug, jobFingerprint, normalizeCompany, normalizeTitle } from './job_identity.mjs';
import { isAttempted } from './apply_guard.mjs'; // 「投过」唯一口径 (circular import, used at call time only)
import './safe_exit.mjs'; // no exit-time SIGSEGV here or in our node children (see preload_system_ca.mjs)

export const LEDGER_RELPATH = 'log/submissions.jsonl';
export const LEDGER_ERAS = Object.freeze(['v2', 'legacy']);
export const LEDGER_VERDICTS = Object.freeze(['submitted', 'not_submitted', 'unknown', 'legacy_unverified']);
// 「已投」(the count the user reads) — not the same thing as 投过 (isAttempted in
// apply_guard, which also holds maybe-submitted lines). DESIGN §8.
export const SUBMITTED_VERDICTS = Object.freeze(['submitted', 'legacy_unverified']);
export const isSubmitted = (e) => SUBMITTED_VERDICTS.includes(e.verdict);

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
  // 账本自带岗位身份（restart-apply ADR-S3，永久格式）：去重只认账本，所以每行
  // 必须能推出指纹；「投过」的唯一口径 may_have_submitted 由 driver_contract
  // 推导后写入，这里只认布尔。
  if (typeof entry.apply_url !== 'string' || !entry.apply_url) throw new Error('ledger entry apply_url (string) is required');
  if (!jobFingerprint(entry.apply_url)) throw new Error(`ledger entry apply_url yields no job fingerprint: ${entry.apply_url}`);
  if (typeof entry.may_have_submitted !== 'boolean') throw new Error(`ledger entry may_have_submitted must be a boolean, got ${JSON.stringify(entry.may_have_submitted)}`);
}

// job_id is only an identity if one id never names two jobs. A second line for
// the same job_id with a different apply_url means two runs collided on row
// numbers — refuse loudly instead of silently merging two jobs' histories.
function assertJobIdUnambiguous(home, entry) {
  const clash = readAll(home).find((e) => e.job_id === entry.job_id && e.apply_url && e.apply_url !== entry.apply_url);
  if (clash) {
    throw new Error(`ledger job_id ${entry.job_id} already belongs to ${clash.apply_url} (line ${clash.id}); refusing to record ${entry.apply_url} under it`);
  }
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
  assertJobIdUnambiguous(home, full);
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

// Every attempt line (non-correction) with its corrections applied, in file
// order (a correction overrides the entry it references; later corrections to
// the same entry win). One line = one attempt — the dispatch guard counts these.
export function effectiveEntries(entries) {
  const corrections = new Map(); // corrected entry id -> latest correction line
  for (const e of entries) {
    if (e.correction_of) corrections.set(e.correction_of, e);
  }
  return entries.filter((e) => !e.correction_of).map((e) => {
    const c = corrections.get(e.id);
    return c ? { ...e, ...c, id: e.id, ts: e.ts, corrected_by: c.id } : e;
  });
}

// Per job_id: the LAST effective line in file order. §14.3 rebuild 派生规则的实现。
export function effectiveByJob(entries) {
  const byJob = new Map();
  for (const e of effectiveEntries(entries)) byJob.set(e.job_id, e);
  return byJob;
}

// Highest job_id the ledger has ever used (0 when empty). The per-run work DB
// numbers its rows above this so v2 job_ids never repeat (DESIGN §3 initRunDb).
export function maxJobId(entries) {
  return entries.reduce((max, e) => (Number.isInteger(e.job_id) && e.job_id > max ? e.job_id : max), 0);
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
// onlyRowsInDb: check just the ledger lines whose job row is in THIS database —
// for a stream run's one-off work DB that is exactly this run (row ids are
// globally unique); history and earlier runs are simply not in it.
export function rebuild(home, db, { apply = false, onlyRowsInDb = false } = {}) {
  const effective = effectiveByJob(readAll(home));
  const changes = [];
  const report = { checked: 0, applied: Boolean(apply), changes };
  for (const [jobId, e] of effective) {
    const row = db.prepare('SELECT id, status, submitted_at FROM jobs WHERE id = ?').get(jobId);
    if (!row && onlyRowsInDb) continue;
    report.checked += 1;
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

// Legacy timestamps come in two shapes: sqlite datetime('now') (UTC, no zone)
// and ISO. Anything else is a data problem, not something to guess around.
function legacyIso(value, jobId) {
  const text = String(value ?? '');
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(' ', 'T')}Z` : text;
  const d = new Date(iso);
  if (!text || Number.isNaN(d.getTime())) throw new Error(`backfill-legacy: row ${jobId} has no usable timestamp (${JSON.stringify(value)})`);
  return d.toISOString();
}

// A feedback line was produced by a driver iff its detail is the driver's own
// outcome object, serialized with "outcome" first; dedupe / requeue lines carry
// other shapes ({"keep_id":..}, {"gap_report":..}). Matched as a prefix, not
// parsed: the funnel truncated long details to 600 chars, so most driver lines
// are no longer valid JSON.
const DRIVER_DETAIL_RE = /^\s*\{"outcome":"/;
function driverFeedbackTs(db, jobId) {
  const rows = db.prepare('SELECT ts, detail FROM feedback WHERE job_id = ? ORDER BY ts, id').all(jobId);
  const driverRows = rows.filter((r) => DRIVER_DETAIL_RE.test(String(r.detail ?? '')));
  return { hasFeedback: rows.length > 0, lastDriverTs: driverRows.length ? driverRows[driverRows.length - 1].ts : null };
}

// 历史投递迁入（restart-apply ADR-S9 / 未明点 4 lead 裁决）. Reads the frozen legacy
// jobs.db and appends era:'legacy' lines:
//   * every 已投 / 已确认 row → outcome legacy_submitted, verdict legacy_unverified;
//   * a 跳过未投 row only if a driver actually ran on it (driver outcome in its
//     feedback) → outcome legacy_attempt, verdict unknown. Pure dedupe / manual
//     skips are listed in not_migrated and left out.
// All legacy lines are may_have_submitted:true — never auto re-applied.
// Default is a dry-run plan. apply:true validates EVERY row first (one
// unfingerprintable 已投 = refuse the whole batch, nothing written), skips
// job_ids already migrated (idempotent), then re-reads the ledger and checks
// the count and the fingerprint set against the DB.
export function backfillLegacy(home, db, { apply = false } = {}) {
  const already = new Set(readAll(home).filter((e) => e.era === 'legacy').map((e) => e.job_id));
  const rows = db.prepare(`
    SELECT id, company, title, apply_url, status, ats_platform, submitted_at, auto_submitted_at, updated_at, skip_reason
      FROM jobs WHERE status IN (${[...SUBMITTED_STATUSES, '⚠️ 跳过未投'].map(() => '?').join(',')}) ORDER BY id
  `).all(...SUBMITTED_STATUSES, '⚠️ 跳过未投');
  const planned = [];
  const notMigrated = [];
  const unfingerprintable = [];
  for (const row of rows) {
    const submitted = SUBMITTED_STATUSES.has(row.status);
    let ts;
    let reason = null;
    if (submitted) {
      ts = legacyIso(row.submitted_at ?? row.auto_submitted_at ?? row.updated_at, row.id);
    } else {
      const { hasFeedback, lastDriverTs } = driverFeedbackTs(db, row.id);
      if (!lastDriverTs) {
        notMigrated.push({ job_id: row.id, company: row.company, skip_reason: row.skip_reason, why: hasFeedback ? 'no_driver_outcome_in_feedback' : 'no_feedback_rows' });
        continue;
      }
      ts = legacyIso(lastDriverTs, row.id);
      reason = row.skip_reason || null;
    }
    const fp = jobFingerprint(row.apply_url);
    if (!fp) {
      unfingerprintable.push({ job_id: row.id, company: row.company, apply_url: row.apply_url, status: row.status });
      continue;
    }
    planned.push({
      era: 'legacy',
      job_id: row.id,
      ts,
      apply_url: row.apply_url,
      company_key: normalizeCompany(row.company),
      title_key: normalizeTitle(row.title),
      ats: row.ats_platform || fp.ats,
      outcome: submitted ? 'legacy_submitted' : 'legacy_attempt',
      verdict: submitted ? 'legacy_unverified' : 'unknown',
      may_have_submitted: true,
      reason,
      evidence: null,
      answers: [],
      work_auth_provenance: null,
    });
  }
  const submittedPlan = planned.filter((e) => e.outcome === 'legacy_submitted');
  const report = {
    applied: Boolean(apply),
    submitted: { count: submittedPlan.length },
    attempts: { count: planned.length - submittedPlan.length, rows: planned.filter((e) => e.outcome === 'legacy_attempt').map((e) => ({ job_id: e.job_id, company_key: e.company_key, reason: e.reason })) },
    not_migrated: notMigrated,
    unfingerprintable,
    already_migrated: planned.filter((e) => already.has(e.job_id)).length,
    appended: 0,
  };
  if (!apply) return report;
  if (unfingerprintable.length > 0) {
    throw new Error(`backfill-legacy: ${unfingerprintable.length} row(s) yield no job fingerprint (job_id ${unfingerprintable.map((r) => r.job_id).join(', ')}); nothing written — fix the data first`);
  }
  for (const e of planned) {
    if (already.has(e.job_id)) continue;
    append(home, e);
    report.appended += 1;
  }
  report.verify = legacyCountCheck(home, db);
  if (!report.verify.ok) throw new Error(`backfill-legacy: count check failed ${JSON.stringify(report.verify)}`);
  return report;
}

// 核数 (ADR-S4 step 3): every 已投 row in the legacy DB has exactly one
// legacy_unverified ledger line with the same fingerprint. The DB may only be
// retired to archive/ once this holds.
export function legacyCountCheck(home, db) {
  const rows = db.prepare(`SELECT apply_url FROM jobs WHERE status IN (${[...SUBMITTED_STATUSES].map(() => '?').join(',')})`).all(...SUBMITTED_STATUSES);
  const legacy = readAll(home).filter((e) => e.era === 'legacy' && e.verdict === 'legacy_unverified');
  const dbFps = rows.map((r) => jobFingerprint(r.apply_url)?.fp ?? `unfingerprintable:${r.apply_url}`).sort();
  const ledgerFps = legacy.map((e) => jobFingerprint(e.apply_url).fp).sort();
  const match = dbFps.length === ledgerFps.length && dbFps.every((fp, i) => fp === ledgerFps[i]);
  return { ok: match, submitted_in_db: dbFps.length, legacy_unverified_in_ledger: ledgerFps.length, fingerprints_match: match };
}

// 拍板人手投登记（restart-apply S5 派遣第 4 项）. The user applied to these by
// hand; the ledger must know, or the agent applies to them again and the
// per-company 60-day count misses them. One line each: a real submission as far
// as the user says (verdict submitted), marked as told-not-seen by its outcome
// (manual_submitted) and reason (reported_by_user) — no page verdict exists.
// Refused while a run is going on: its work DB numbers rows from the ledger's
// highest job_id, and a line appended meanwhile would collide with them.
export const MANUAL_OUTCOME = 'manual_submitted';
const V2_ID_FLOOR = 100000; // same floor as stream_run's work DB

// A bare date means that day on this machine (noon, so no zone shifts it).
function manualTs(at) {
  if (at == null || at === '') return new Date().toISOString();
  const text = String(at);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T12:00:00`) : new Date(text);
  if (Number.isNaN(d.getTime())) throw new Error(`record-manual: "${text}" is not a date (YYYY-MM-DD)`);
  return d.toISOString();
}

export function recordManual(home, items, { apply = false } = {}) {
  for (const name of ['stream_run.lock', 'apply_batch.lock']) {
    const p = join(home, 'locks', name);
    if (apply && existsSync(p)) throw new Error(`record-manual: ${p} exists — a run is going on; finish it (or abandon it) first`);
  }
  // The company is the board slug in the link — the same key the scans and the
  // pre-dispatch gate use (verify 第 6 轮 R6: "Runway" ≠ runway-ml would slip
  // past the 60-day company count). --company only double-checks it.
  const bad = [];
  const companyOf = new Map();
  for (const it of items) {
    if (!it?.url || !jobFingerprint(it.url)) {
      bad.push(`${it?.url} (no job fingerprint — Greenhouse/Ashby/Lever job links only)`);
      continue;
    }
    if (!it.title) {
      bad.push(`${it.url} (title is required)`);
      continue;
    }
    const slug = boardSlug(it.url);
    if (slug && it.company && normalizeCompany(it.company) !== normalizeCompany(slug)) {
      bad.push(`${it.url} (company "${it.company}" is not the job board's "${slug}" in the link — leave --company out, or write ${slug})`);
    } else if (!slug && !it.company) {
      bad.push(`${it.url} (the link names no job board — give --company as the company's board slug)`);
    } else {
      companyOf.set(it, slug ?? it.company);
    }
  }
  if (bad.length) throw new Error(`record-manual: nothing written — ${bad.join('; ')}`);
  const entries = readAll(home);
  const recorded = new Set(effectiveEntries(entries).filter(isAttempted).map((e) => jobFingerprint(e.apply_url).fp));
  let nextId = Math.max(maxJobId(entries), V2_ID_FLOOR);
  const plan = [];
  const already = [];
  for (const it of items) {
    const fp = jobFingerprint(it.url);
    if (recorded.has(fp.fp)) {
      already.push({ url: it.url });
      continue;
    }
    recorded.add(fp.fp);
    nextId += 1;
    plan.push({
      era: 'v2',
      job_id: nextId,
      ts: manualTs(it.at),
      apply_url: it.url,
      company_key: normalizeCompany(companyOf.get(it)),
      title_key: normalizeTitle(it.title),
      ats: fp.ats,
      outcome: MANUAL_OUTCOME,
      verdict: 'submitted',
      may_have_submitted: true,
      reason: 'reported_by_user',
      evidence: null,
      answers: [],
      work_auth_provenance: null,
    });
  }
  if (apply) for (const e of plan) append(home, e);
  return {
    applied: Boolean(apply),
    to_append: plan.map((e) => ({ job_id: e.job_id, ts: e.ts, apply_url: e.apply_url, company_key: e.company_key, title_key: e.title_key })),
    already_recorded: already,
  };
}

function cliArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

// CLI: `node shared/submission_ledger.mjs rebuild [--apply]`
//      `node shared/submission_ledger.mjs backfill-legacy [--apply]`
//      `node shared/submission_ledger.mjs record-manual (--url U --company C --title T [--at D] | --file F) [--apply]`
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  const cmd = process.argv[2];
  if (!['rebuild', 'backfill-legacy', 'record-manual'].includes(cmd)) {
    console.error('usage: node shared/submission_ledger.mjs rebuild [--apply]');
    console.error('       node shared/submission_ledger.mjs backfill-legacy [--apply]   (default: dry-run plan)');
    console.error('       node shared/submission_ledger.mjs record-manual --url <link> --title <title> [--company <board slug, to double-check>] [--at YYYY-MM-DD] [--apply]');
    console.error('       node shared/submission_ledger.mjs record-manual --file <[{url,company,title,at}] json> [--apply]');
    process.exit(2);
  }
  const { atsHome } = await import('./paths.mjs');
  const { DatabaseSync } = await import('node:sqlite');
  const { dbPath, initDb } = await import('./local_db.mjs');
  const apply = process.argv.includes('--apply');
  if (cmd === 'record-manual') {
    const file = cliArg('--file');
    const items = file ? JSON.parse(readFileSync(file, 'utf8'))
      : [{ url: cliArg('--url'), company: cliArg('--company'), title: cliArg('--title'), at: cliArg('--at') }];
    if (!Array.isArray(items)) throw new Error('record-manual: --file must hold a JSON array of {url, company, title, at}');
    let report;
    try {
      report = recordManual(atsHome(), items, { apply });
    } catch (e) {
      console.error(`[submission_ledger] ${e.message}`); // a refusal; nothing was written
      process.exit(1);
    }
    console.log(JSON.stringify(report, null, 2));
    if (!apply) console.error(`[submission_ledger] dry-run: would record ${report.to_append.length} hand-made application(s) (${report.already_recorded.length} already in the ledger); re-run with --apply`);
    process.exit(0);
  }
  if (cmd === 'backfill-legacy') {
    // The legacy DB is only ever READ here — no initDb (it would migrate/create).
    if (!existsSync(dbPath())) throw new Error(`backfill-legacy: legacy DB not found at ${dbPath()}`);
    const legacyDb = new DatabaseSync(dbPath(), { readOnly: true });
    const report = backfillLegacy(atsHome(), legacyDb, { apply });
    legacyDb.close();
    console.log(JSON.stringify(report, null, 2));
    if (!apply) console.error(`[submission_ledger] dry-run: would append ${report.submitted.count} legacy_submitted + ${report.attempts.count} legacy_attempt line(s); re-run with --apply`);
    process.exit(0);
  }
  initDb();
  const db = new DatabaseSync(dbPath(), { readOnly: !apply });
  const report = rebuild(atsHome(), db, { apply });
  console.log(JSON.stringify(report, null, 2));
  if (!apply && report.changes.length > 0) {
    console.error(`[submission_ledger] dry-run: ${report.changes.length} difference(s) between ledger and DB — review above, then re-run with --apply`);
  }
}
