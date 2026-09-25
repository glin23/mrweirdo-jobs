// seen_log.mjs — 看过记录（restart-apply DESIGN §3 SeenLog / ADR-S5）。
//
// ~/.mrweirdo-jobs/log/seen.jsonl: jobs looked at and NOT applied to — judged
// not a fit, visa-blocked, taken down, stuck on missing info. It exists so the
// next run does not pay to score the same job again. It is memory, not canon:
// losing it costs scoring money, never a re-application (the ledger owns 投过).
// Hence it may be rewritten (compact), unlike the append-only ledger.
//
// Minimal fields only (PM V13): no JD text, no score detail, no form answers.
// This module is the only reader/writer of the file.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jobFingerprint, normalizeCompany, normalizeTitle } from './job_identity.mjs';
import { lockDir, lockFile } from './state_file_lock.mjs';

export const SEEN_RELPATH = 'log/seen.jsonl';
export const SEEN_CODES = Object.freeze(['not_fit', 'visa_blocked', 'expired', 'needs_info', 'held_for_review']);
const WINDOW_DAYS = { not_fit: 60, visa_blocked: 60, held_for_review: 7 };
const DAY_MS = 24 * 3600 * 1000;
const REPO_SHARED = dirname(fileURLToPath(import.meta.url));

export function seenPath(home) {
  if (!home) throw new Error('seenPath: home is required');
  return join(home, SEEN_RELPATH);
}

// sha256 of the whitespace-normalized JD, first 16 hex. A reworded JD is a
// changed job (R3 ①); a re-wrapped one is not.
export function jdHash(text) {
  const norm = String(text ?? '').replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

export function recordSeen(home, r) {
  if (!SEEN_CODES.includes(r?.code)) throw new Error(`recordSeen: code "${r?.code}" not in ${SEEN_CODES.join('|')}`);
  const fp = jobFingerprint(r.apply_url);
  if (!fp) throw new Error(`recordSeen: apply_url yields no job fingerprint (${r.apply_url})`);
  if (typeof r.basis_version !== 'string' || !r.basis_version) throw new Error('recordSeen: basis_version is required');
  const line = {
    ts: r.ts || new Date().toISOString(),
    code: r.code,
    fp: fp.fp,
    company_key: normalizeCompany(r.company),
    title_key: normalizeTitle(r.title),
    apply_url: r.apply_url,
    jd_hash: r.jd_hash ?? null,
    basis_version: r.basis_version,
    reason: r.reason ?? null,
  };
  const p = seenPath(home);
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  lockDir(dirname(p));
  appendFileSync(p, `${JSON.stringify(line)}\n`, { mode: 0o600 });
  lockFile(p);
  return line;
}

// A corrupt line throws with its number: silently skipping lines is how a
// "never re-score" guarantee quietly rots.
export function readSeen(home) {
  const p = seenPath(home);
  if (!existsSync(p)) return [];
  const out = [];
  const lines = readFileSync(p, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch (e) {
      throw new Error(`seen.jsonl line ${i + 1} is not valid JSON (${e.message})`);
    }
  }
  return out;
}

const ctKey = (companyKey, titleKey) => `${companyKey}::${titleKey}`;

// Latest record per key, for both keys of the dual identity (ADR-S2).
export function seenIndex(records) {
  const byFp = new Map();
  const byCt = new Map();
  for (const r of records) {
    byFp.set(r.fp, r);
    byCt.set(ctKey(r.company_key, r.title_key), r);
  }
  return { byFp, byCt };
}

// Every distinct latest record hit by the candidate's fingerprint OR its
// company+title. An unfingerprintable candidate is a caller bug.
export function lookupSeen(idx, cand) {
  const fp = jobFingerprint(cand.apply_url);
  if (!fp) throw new Error(`lookupSeen: apply_url yields no job fingerprint (${cand.apply_url})`);
  const hits = [idx.byFp.get(fp.fp), idx.byCt.get(ctKey(normalizeCompany(cand.company), normalizeTitle(cand.title)))].filter(Boolean);
  return [...new Set(hits)];
}

function withinDays(ts, days, now) {
  return now.getTime() - new Date(ts).getTime() < days * DAY_MS;
}

// Is this record still a reason not to look again? basis = { scoring, fill }.
export function stillSeen(r, cand, basis, now = new Date()) {
  switch (r.code) {
    case 'not_fit':
    case 'visa_blocked':
      return withinDays(r.ts, WINDOW_DAYS[r.code], now) && r.jd_hash === cand.jd_hash && r.basis_version === basis.scoring;
    case 'expired':
      return r.jd_hash === cand.jd_hash;
    case 'needs_info':
      return r.basis_version === basis.fill;
    case 'held_for_review':
      return withinDays(r.ts, WINDOW_DAYS.held_for_review, now);
    default:
      throw new Error(`stillSeen: unknown code "${r.code}"`);
  }
}

// Drops time-expired lines and lines superseded by a later line for the same
// fingerprint; tmp file + atomic rename, stays 600.
export function compact(home, now = new Date()) {
  const records = readSeen(home);
  if (records.length === 0) return { before: 0, after: 0 };
  const latest = new Map();
  for (const r of records) latest.set(r.fp, r);
  const keep = records.filter((r) => latest.get(r.fp) === r && (!WINDOW_DAYS[r.code] || withinDays(r.ts, WINDOW_DAYS[r.code], now)));
  const p = seenPath(home);
  const tmp = `${p}.tmp-${process.pid}`;
  writeFileSync(tmp, keep.map((r) => `${JSON.stringify(r)}\n`).join(''), { mode: 0o600 });
  lockFile(tmp);
  renameSync(tmp, p);
  return { before: records.length, after: keep.length };
}

// ---- 依据版本（DESIGN §3 / 未明点 5）------------------------------------------
// A "not a fit" judgement is only as good as what it was judged against; when
// that changes, the judgement is void (R3 ②). Scoring reads search_intent.json,
// the resume (via intent / agent context) and score_prompt.md. It also reads the
// last 20 lines of feedback.jsonl — deliberately NOT counted: it changes every
// run, which would void every not_fit every run (跨运行零重复 would be dead).

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function jsonPart(file) {
  if (!existsSync(file)) return 'absent';
  return stableJson(JSON.parse(readFileSync(file, 'utf8')));
}

function bytesPart(file) {
  return existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : 'absent';
}

function version(parts) {
  const h = createHash('sha256');
  for (const p of parts) h.update(`${p}\u0000`);
  return h.digest('hex').slice(0, 12);
}

function resumeFile(home) {
  const cfgFile = join(home, 'config.json');
  const cfg = existsSync(cfgFile) ? JSON.parse(readFileSync(cfgFile, 'utf8')) : {};
  return cfg.resume_path || join(home, 'resume.pdf');
}

export function scoringBasisVersion(home) {
  return version([
    bytesPart(resumeFile(home)),
    jsonPart(join(home, 'search_intent.json')),
    bytesPart(join(REPO_SHARED, 'scoring', 'score_prompt.md')),
  ]);
}

export function fillBasisVersion(home) {
  return version([
    jsonPart(join(home, 'profile.json')),
    jsonPart(join(home, 'essay_profile.json')),
    jsonPart(join(REPO_SHARED, 'answer_bank.json')),
  ]);
}
