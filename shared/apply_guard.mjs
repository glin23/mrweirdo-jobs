// apply_guard.mjs — 投前权威闸（restart-apply DESIGN §3 / ADR-S6 / ADR-S7 / ADR-S8）。
//
// The last check before an irreversible action. Everything here is derived
// from the ledger (log/submissions.jsonl), which callers re-read before EVERY
// dispatch — no cache, so a line another session just wrote is seen.
//
// 「投过」has exactly one definition: isAttempted(e) = may_have_submitted===true
// (derived once, in driver_contract). The re-application block, the per-company
// 60-day limit and the daily tier all count with it; a second definition is how
// the old 158/182/183 numbers drifted apart.

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { companyTitleKey, jobFingerprint, normalizeCompany } from './job_identity.mjs';
import { effectiveEntries, readAll } from './submission_ledger.mjs';
import { lockDir, lockFile } from './state_file_lock.mjs';

export const TIERS = Object.freeze([10, 25, 50]);
export const DEFAULT_TIER = 10;
export const TIER_CONFIRM_ABOVE = 30; // master-plan 规矩 1：超 30 档须亲自点头
export const WINDOW_DAYS = 60;
export const COMPANY_MAX_60D = 2; // 同公司 60 天最多投 2 次（定稿）
// 点提交前就失败（公司什么都没收到）之后，同一岗位 60 天内还允许再试几次。
// 单一常量，待拍板人确认（DESIGN 未明点 12）：1 = PM R2「最多重试 1 次」；
// 0 = 失败一次后 60 天内不再试。
export const PRE_SUBMIT_RETRIES_60D = 1;
const BREAKER_RUN = 3;
const BREAKER_OUTCOMES = new Set(['unknown', 'crashed', 'captcha_blocked']);

const DAY_MS = 24 * 3600 * 1000;

export function isAttempted(e) {
  return e.may_have_submitted === true;
}

function localTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// Calendar day in the machine's time zone — the daily tier resets at local
// midnight, not at 20:00 EDT (the old todayUtc boundary).
export function localDay(date, tz = localTimeZone()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function fingerprintOrThrow(url, where) {
  const fp = jobFingerprint(url);
  if (!fp) throw new Error(`${where}: apply_url yields no job fingerprint (${url}) — only Greenhouse/Ashby/Lever links can be dispatched`);
  return fp.fp;
}

function pushTo(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

// Index over the ledger's effective attempt lines (corrections applied).
export function attemptIndex(entries, now = new Date(), tz = localTimeZone()) {
  const today = localDay(now, tz);
  const idx = { byFp: new Map(), byCompanyTitle: new Map(), byCompany: new Map(), preSubmitFails: new Map(), todayCount: 0 };
  for (const e of effectiveEntries(entries)) {
    if (typeof e.may_have_submitted !== 'boolean') {
      throw new Error(`ledger line ${e.id} (job_id ${e.job_id}) has no boolean may_have_submitted — every line must say whether it may have reached the company`);
    }
    const fp = fingerprintOrThrow(e.apply_url, `ledger line ${e.id}`);
    if (isAttempted(e)) {
      pushTo(idx.byFp, fp, e);
      pushTo(idx.byCompanyTitle, `${e.company_key}::${e.title_key}`, e);
      pushTo(idx.byCompany, e.company_key, e.ts);
      if (localDay(new Date(e.ts), tz) === today) idx.todayCount += 1;
    } else if (e.outcome !== 'needs_user') {
      pushTo(idx.preSubmitFails, fp, e.ts);
    }
  }
  return idx;
}

function withinWindow(ts, now) {
  return now.getTime() - new Date(ts).getTime() < WINDOW_DAYS * DAY_MS;
}

export function preSubmitFailCount(idx, fp, now = new Date()) {
  return (idx.preSubmitFails.get(fp) || []).filter((ts) => withinWindow(ts, now)).length;
}

export function dailyTier(env = process.env, confirmOver30 = false) {
  const raw = env.MRWEIRDO_DAILY_TIER;
  const tier = raw == null || String(raw).trim() === '' ? DEFAULT_TIER : Number(raw);
  if (!TIERS.includes(tier)) throw new Error(`MRWEIRDO_DAILY_TIER=${raw} is not a tier (${TIERS.join('|')})`);
  if (tier > TIER_CONFIRM_ABOVE && !confirmOver30) {
    throw new Error(`daily tier ${tier} is above ${TIER_CONFIRM_ABOVE}: the user must say so himself — re-run with --confirm-tier-over-30`);
  }
  return tier;
}

// L1 run target folded into the day's remaining tier (ADR-S7); the first line
// the user sees.
export function budgetLine(idx, target, tier) {
  if (!Number.isInteger(target) || target <= 0) throw new Error(`budget target must be a positive integer, got ${JSON.stringify(target)}`);
  const attemptedToday = idx.todayCount;
  const left = Math.max(0, tier - attemptedToday);
  const maxAttempts = Math.min(target, left);
  let line;
  if (maxAttempts === 0) {
    line = `你要 ${target}，今天档位 ${tier}，今天已尝试 ${attemptedToday}/${tier}，本次投 0；升档需要你明说`;
  } else if (target > left) {
    line = `你要 ${target}，今天档位 ${tier}，今天已尝试 ${attemptedToday}/${tier}，本次最多投 ${maxAttempts}`;
  } else {
    line = `开始，本次目标投 ${target}；今日额度剩 ${left}`;
  }
  return { target, tier, attempted_today: attemptedToday, max_attempts: maxAttempts, max_scored: maxAttempts * 10, line };
}

// The authoritative pre-dispatch gate. Checks in order, first hit wins:
//   1. today's tier used up / this run's target reached
//   2. fingerprint already attempted
//   3. company+title already attempted
//   4. company attempted ≥ COMPANY_MAX_60D times in 60 days
//   5. pre-submit failures on this fingerprint in 60 days > PRE_SUBMIT_RETRIES_60D
// (Rule 6 — needs_user with unchanged fill basis — lands with seen_log in S3.)
export function checkDispatch(job, idx, budget, now = new Date()) {
  const fp = fingerprintOrThrow(job.apply_url, 'checkDispatch');
  const no = (reason, ref = null) => ({ ok: false, reason, ref_ledger_id: ref });
  if (idx.todayCount >= budget.tier) return no('daily_cap_reached');
  if (idx.todayCount - budget.attempted_today >= budget.max_attempts) return no('run_target_reached');
  const byFp = idx.byFp.get(fp);
  if (byFp?.length) return no('already_attempted_fp', byFp[byFp.length - 1].id);
  const byCt = idx.byCompanyTitle.get(companyTitleKey(job.company, job.title));
  if (byCt?.length) return no('already_attempted_company_title', byCt[byCt.length - 1].id);
  const recent = (idx.byCompany.get(normalizeCompany(job.company)) || []).filter((ts) => withinWindow(ts, now));
  if (recent.length >= COMPANY_MAX_60D) return no('company_cooldown_60d');
  if (preSubmitFailCount(idx, fp, now) > PRE_SUBMIT_RETRIES_60D) return no('pre_submit_retry_exhausted');
  return { ok: true, reason: null, ref_ledger_id: null };
}

// Answers the form question "have you applied to us before?" from the ledger
// (which holds migrated history too), not from a hard-coded jobs.db path.
export function priorApplicationToCompany(home, company) {
  const key = normalizeCompany(company);
  return effectiveEntries(readAll(home)).some((e) => e.company_key === key && isAttempted(e));
}

// Same machine failure three times in a row → stop dispatching and ask.
export function breaker(recentOutcomes) {
  const tail = recentOutcomes.slice(-BREAKER_RUN);
  const open = tail.length === BREAKER_RUN && BREAKER_OUTCOMES.has(tail[0]) && tail.every((o) => o === tail[0]);
  return open ? { open: true, outcome: tail[0], count: BREAKER_RUN } : { open: false, outcome: null, count: 0 };
}

// ---- 在途标记（ADR-S8）----------------------------------------------------
// Written right before a driver is spawned, cleared once the recorder has
// written the ledger line. A marker found at start = a process died between
// "maybe clicked Submit" and "recorded it": the next run records it first.
const INFLIGHT_FIELDS = ['run_id', 'work_db', 'row_id', 'apply_url', 'result_file', 'started_at'];

export function inflightPath(home) {
  if (!home) throw new Error('inflightPath: home is required');
  return join(home, 'locks', 'inflight.json');
}

export function readInflight(home) {
  const p = inflightPath(home);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function writeInflight(home, marker) {
  for (const f of INFLIGHT_FIELDS) {
    if (marker?.[f] == null || marker[f] === '') throw new Error(`inflight marker: ${f} is required`);
  }
  const p = inflightPath(home);
  if (existsSync(p)) throw new Error(`inflight marker already present at ${p} — an earlier attempt was never recorded; recover it first`);
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  lockDir(dirname(p));
  writeFileSync(p, `${JSON.stringify(marker)}\n`, { mode: 0o600, flag: 'wx' });
  lockFile(p);
  return p;
}

export function clearInflight(home) {
  const p = inflightPath(home);
  if (existsSync(p)) unlinkSync(p);
}
