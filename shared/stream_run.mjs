#!/usr/bin/env node
// stream_run.mjs — 即找即投状态机（restart-apply DESIGN §1.2 新数据流 / §4.1 正常路 / ADR-S1）.
//
// One run = find → dedupe gate → score a batch → apply the fit ones → … until
// N applied, N×10 looked at, supply exhausted or a stop signal — then a 3-line
// report, and the run's scratch (work DB, batches, driver results) is deleted.
// Scoring happens in the main agent's conversation, so the loop is a CLI state
// machine the agent drives; everything else is here:
//
//   start --target N [--no-submit] [--confirm-tier-over-30] [--max-windows K]
//         [--release <apply_url>]… [--abandon <run_id>]
//   next --run ID                    → {action:'score', batch_file, scored_file} | {action:'done', reason}
//   submit-scores --run ID --batch k --scored FILE → {…, gap_report}
//   finish --run ID                  → { lines: [3], held, … }
//
// Each command prints ONE JSON object on stdout; child output goes to stderr.
// What persists across runs is only the ledger, the seen log and the rotation
// cursor (PM V12); the dedupe gate reads the first two before anything is
// scored, so a job already applied to or already judged costs nothing again.

import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { atsHome } from './paths.mjs';
import { onboardTmpDir } from './onboard_tmp.mjs';
import { initRunDb } from './local_db.mjs';
import { effectiveEntries, maxJobId, readAll } from './submission_ledger.mjs';
import { attemptIndex, budgetLine, dailyTier, identityBlock, isAttempted, readInflight } from './apply_guard.mjs';
import { compact, fillBasisVersion, jdHash, lookupSeen, readSeen, recordSeen, scoringBasisVersion, seenIndex, stillSeen } from './seen_log.mjs';
import { recoverInflight } from './inflight_recovery.mjs';
import { companyTitleKey, jobFingerprint, normalizeCompany } from './job_identity.mjs';
import { lockDir, lockFile } from './state_file_lock.mjs';
import { batchLockHolder, liveBatchHint } from './lock_holder.mjs';
import { installSafeExit } from './safe_exit.mjs';

installSafeExit(); // exit codes here decide what the caller does (see safe_exit.mjs)

const repoRoot = process.env.MRWEIRDO_REPO_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const home = atsHome();
export const BATCH_SIZE = 50;
const SEQ_FLOOR_MIN = 100000; // legacy row ids stay far below; v2 ids never meet them
const ROTATION_SOURCES = ['greenhouse_bulk', 'ashby_bulk']; // the only auto-apply platforms
const RUN_PREFIX = 'stream-';

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}
const hasArg = (name) => process.argv.includes(name);
const log = (m) => console.error(`[stream-run] ${m}`);
function die(message) {
  console.error(`[stream-run] ${message}`);
  process.exit(1);
}
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
function writePrivate(f, data) {
  writeFileSync(f, JSON.stringify(data), { mode: 0o600 });
  lockFile(f);
}

// ---- run state -------------------------------------------------------------

const runDirOf = (runId) => join(onboardTmpDir(), runId);
function loadState(runId) {
  if (!runId || !runId.startsWith(RUN_PREFIX)) die(`--run <${RUN_PREFIX}…> is required`);
  const f = join(runDirOf(runId), 'state.json');
  if (!existsSync(f)) die(`no run ${runId} (${f} missing) — start a new run`);
  return readJson(f);
}
const saveState = (st) => writePrivate(join(st.run_dir, 'state.json'), st);
const loadPool = (st) => readJson(join(st.run_dir, 'pool.json'));
const savePool = (st, pool) => writePrivate(join(st.run_dir, 'pool.json'), pool);

function childEnv(st) {
  return { ...process.env, MRWEIRDO_DB_PATH: st.work_db, MRWEIRDO_ONBOARD_TMP_DIR: st.run_dir };
}

function runChild(st, args) {
  const r = spawnSync(process.execPath, args, { cwd: repoRoot, env: childEnv(st), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.stdout) process.stderr.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return { code: r.status ?? 1, stdout: r.stdout || '' };
}

// Last pretty-printed JSON object in a child's stdout (store / apply_batch).
function lastJsonBlock(text) {
  const at = text.lastIndexOf('\n{\n');
  return JSON.parse(at >= 0 ? text.slice(at + 1) : text);
}

function seenContext() {
  return { index: seenIndex(readSeen(home)), basis: { scoring: scoringBasisVersion(home), fill: fillBasisVersion(home) } };
}

// ---- start -----------------------------------------------------------------

// ADR-S9: the gate only knows what the ledger knows. With the legacy jobs.db
// still here and none of its history migrated, every June application would
// look new — refuse until backfill-legacy --apply has run.
function refuseWithoutHistory() {
  if (existsSync(join(home, 'jobs.db')) && !readAll(home).some((e) => e.era === 'legacy')) {
    die(`${join(home, 'jobs.db')} holds past applications that are not in the ledger yet — run \`node shared/submission_ledger.mjs backfill-legacy\` (dry-run), then with --apply, before the first stream run`);
  }
}

// ---- 运行级互斥（VERIFY 第 4 轮 BUG-1：两个窗口同时跑）------------------------
// A run spans several short CLI calls with no process alive in between, so a
// pid lock alone cannot tell "active" from "abandoned". locks/stream_run.lock
// names the run that owns this home until `finish`; a second start refuses
// loudly unless told which run to abandon. A live apply_batch (driver may be
// mid-form) blocks every start, --abandon included: its in-flight attempt must
// never be recorded as a crash by someone else.
const streamLockPath = () => join(home, 'locks', 'stream_run.lock');
const batchLockPath = () => join(home, 'locks', 'apply_batch.lock');

function readLock(path) {
  try {
    return readJson(path);
  } catch (e) {
    throw new Error(`${path} is not readable JSON (${e.message}) — if no run is going on, delete it and start again`);
  }
}

// The caller has ALREADY created its own run directory: a lock is only ever
// written by a run whose directory exists, so "lock whose directory is gone"
// can only mean a finished or dead run — never another start caught between
// writing its lock and creating its directory (VERIFY 第 5 轮 RACE). The lock
// itself is created with O_EXCL, so of two simultaneous starts exactly one wins.
// Throws the refusal; the caller removes its directory and says it.
// Clearing a stale lock is read → remove → create, and two starts can both
// judge the same lock stale; the later remove then deletes the lock the other
// just created (verify 第 6 轮 STALE2). So the whole check-clear-create runs
// inside a short O_EXCL claim that only one start at a time can hold. A claim
// left by a start that died mid-claim is not cleared automatically (that would
// reopen the same race); it is named, with its age, for the user to delete.
const claimPath = () => join(home, 'locks', 'stream_run.claim');
const STALE_CLAIM_MS = 30000;

function claimHome(runId) {
  mkdirSync(dirname(claimPath()), { recursive: true, mode: 0o700 });
  let fd;
  try {
    fd = openSync(claimPath(), 'wx', 0o600);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let ageMs = null;
    try {
      ageMs = Date.now() - statSync(claimPath()).mtimeMs;
    } catch {
      // released between our open and this stat: someone else is starting
    }
    if (ageMs != null && ageMs > STALE_CLAIM_MS) {
      throw new Error(`${claimPath()} is ${Math.round(ageMs / 1000)}s old — a start died while claiming this home; if no other start is running, delete it and start again`);
    }
    throw new Error('another stream run is starting at this same moment — finish or abandon that one before starting again');
  }
  try {
    claimHomeLocked(runId);
  } finally {
    closeSync(fd);
    rmSync(claimPath(), { force: true });
  }
}

function claimHomeLocked(runId) {
  if (existsSync(batchLockPath())) {
    const { pid } = readLock(batchLockPath());
    const holder = batchLockHolder(pid);
    if (holder === 'alive') {
      throw new Error(`an apply batch is running (pid ${pid}) — refusing to start while a driver may be mid-form; wait for it to finish; ${liveBatchHint(pid, batchLockPath())}`);
    }
    if (holder === 'reused') log(`⚠️ ${batchLockPath()} names pid ${pid} which is alive but not an apply batch (the number was reused) — treating the lock as stale`);
  }
  const abandon = argValue('--abandon');
  if (existsSync(streamLockPath())) {
    const held = readLock(streamLockPath());
    if (!existsSync(runDirOf(held.run_id))) {
      log(`⚠️ stale stream lock for ${held.run_id} (its run directory is gone) — clearing it`);
    } else if (abandon === held.run_id) {
      log(`⚠️ abandoning ${held.run_id} (started ${held.started_at}) as asked — its unscored batch and work DB are dropped`);
    } else {
      throw new Error(`stream run ${held.run_id} is still active (started ${held.started_at}) — finish it with \`finish --run ${held.run_id}\`; if that window is gone for good, start again with \`--abandon ${held.run_id}\``);
    }
    rmSync(streamLockPath(), { force: true });
  } else if (abandon) {
    throw new Error(`--abandon ${abandon}: no active stream run to abandon`);
  }
  mkdirSync(dirname(streamLockPath()), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(streamLockPath(), `${JSON.stringify({ run_id: runId, started_at: new Date().toISOString(), pid: process.pid })}\n`, { mode: 0o600, flag: 'wx' });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    throw new Error('another stream run is starting at this same moment and got the lock first — finish or abandon that one before starting again');
  }
}

function releaseHome(runId) {
  if (existsSync(streamLockPath()) && readJson(streamLockPath()).run_id === runId) rmSync(streamLockPath());
}

// A run directory is named `stream-<time>-<pid of the start that made it>`.
// It is a leftover only once that start process is gone: while it runs it may
// be another start that just created its directory and is about to lock it and
// try for the home — deleting it under that start made the loser crash with
// ENOENT instead of refusing (lead 复验 f3aef0f, RACE 8/100). A start that loses
// removes its own directory; one that finished exited long ago.
function startProcessAlive(name) {
  const pid = Number(name.slice(name.lastIndexOf('-') + 1));
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function cleanOldRuns(keepRunId) {
  const dir = onboardTmpDir();
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(RUN_PREFIX) || name === keepRunId || startProcessAlive(name)) continue;
    rmSync(join(dir, name), { recursive: true, force: true });
  }
}

async function fullRotationWindows(windowSize) {
  if (windowSize === 0) return 1;
  const { loadCompanyList } = await import('./sourcing/greenhouse_bulk_crawl.mjs');
  const { loadTenants } = await import('./sourcing/ashby_bulk_crawl.mjs');
  const longest = Math.max((await loadCompanyList()).length, (await loadTenants()).tenants.length);
  return Math.ceil(longest / windowSize);
}

// D10 放行（lead 裁决）: `--release <apply_url>`, repeatable — a list job held
// for review that the user said to apply to. It is found again by the list
// scan, scored again, and dispatched like any other job instead of held.
function releaseUrls() {
  const urls = process.argv.flatMap((a, i) => (a === '--release' ? [process.argv[i + 1]] : []));
  for (const u of urls) {
    if (!u || !jobFingerprint(u)) die(`--release ${u}: not a Greenhouse/Ashby/Lever job link`);
  }
  return urls;
}

async function start() {
  const target = Number(argValue('--target'));
  if (!Number.isInteger(target) || target <= 0) die('--target N (a positive integer: how many to apply to) is required');
  refuseWithoutHistory();
  let tier;
  try {
    tier = dailyTier(process.env, hasArg('--confirm-tier-over-30'));
  } catch (e) {
    die(e.message);
  }
  const windowSize = Number(process.env.MRWEIRDO_SOURCE_WINDOW_SIZE ?? 1000);
  if (!Number.isInteger(windowSize) || windowSize < 0) die(`MRWEIRDO_SOURCE_WINDOW_SIZE=${process.env.MRWEIRDO_SOURCE_WINDOW_SIZE} is not a window size`);
  const release = releaseUrls();

  const now = new Date();
  const runId = `${RUN_PREFIX}${now.toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  // Directory first, lock second (see claimHome).
  const runDir = runDirOf(runId);
  mkdirSync(runDir, { recursive: true, mode: 0o700 });
  lockDir(runDir);
  try {
    claimHome(runId);
  } catch (e) {
    rmSync(runDir, { recursive: true, force: true });
    die(e.message);
  }
  let st;
  let seenCompact;
  try {
    // An unrecorded attempt from a dead run is recorded before anything else,
    // and only then may old run directories (its work DB) be removed (ADR-S8).
    let recovered = null;
    const m = recoverInflight({ home, repoRoot, env: process.env, tmpDir: onboardTmpDir(), log });
    // The user reads 3 lines, not stderr: a maybe-submitted attempt recovered
    // here must reach the report (VERIFY 第 4 轮 BUG-4 / DESIGN 失败路 1).
    const e = m && effectiveEntries(readAll(home)).filter((l) => l.job_id === m.row_id && l.apply_url === m.apply_url).at(-1);
    if (e && isAttempted(e)) recovered = { apply_url: e.apply_url, name: `${e.company_key}·${e.title_key}`, screenshot: e.evidence?.path || null };
    cleanOldRuns(runId);
    seenCompact = compact(home, now);
    const entries = readAll(home);
    const budget = budgetLine(attemptIndex(entries, now), target, tier, now);
    const workDb = join(runDir, 'work.db');
    initRunDb({ path: workDb, seqFloor: Math.max(maxJobId(entries), SEQ_FLOOR_MIN) });
    // Released jobs are list jobs held for review: they are found by the list
    // scan, so a release-only run needs no rotation window.
    const maxWindows = argValue('--max-windows') != null ? Number(argValue('--max-windows'))
      : release.length ? 0 : await fullRotationWindows(windowSize);
    st = newState({ runId, runDir, workDb, now, budget, maxWindows, windowSize, recovered, release });
  } catch (e) {
    releaseHome(runId);
    rmSync(runDir, { recursive: true, force: true });
    die(e.message);
  }
  saveState(st);
  savePool(st, []);
  console.log(JSON.stringify({ ok: true, run_id: runId, line: st.budget.line, budget: st.budget, seen_compact: seenCompact }));
}

function newState({ runId, runDir, workDb, now, budget, maxWindows, windowSize, recovered, release }) {
  const cursorFile = join(home, 'source_cursor.json');
  return {
    run_id: runId,
    run_dir: runDir,
    work_db: workDb,
    started_at: now.toISOString(),
    budget,
    no_submit: hasArg('--no-submit'),
    confirm_over_30: hasArg('--confirm-tier-over-30'),
    attempted_this_run: 0,
    scored_this_run: 0,
    eligible_this_run: 0,
    pre_submit_fails_this_run: 0,
    expired_this_run: 0,
    batch_no: 0,
    pending_batch: null,
    watchlist_done: false,
    windows_scanned: 0,
    max_windows: maxWindows,
    window_size: windowSize,
    cursor_start: existsSync(cursorFile) ? (readJson(cursorFile).next_offset ?? 0) : 0,
    last_window_offset: null,
    pooled_keys: [],
    skipped_before_scoring: {},
    source_errors: [],
    recovered_inflight: recovered,
    release,
    release_outcome: {},
    held: [],
    stop_reason: budget.max_attempts === 0 ? 'daily_cap_reached' : null,
  };
}

// ---- next ------------------------------------------------------------------

function stopReason(st) {
  if (st.stop_reason) return st.stop_reason;
  // 点提交前失败不减目标数：没有这条上限，表单坏了就会一家接一家崩下去
  // （DESIGN 失败路 6，单次运行上限 max(3, 可投数)）。
  if (st.pre_submit_fails_this_run >= Math.max(3, st.budget.max_attempts)) return 'pre_submit_fail_cap';
  if (!st.no_submit && st.attempted_this_run >= st.budget.max_attempts) return 'target_reached';
  if (st.scored_this_run >= st.budget.max_scored) return 'score_budget_reached';
  return null;
}

function bump(st, key) {
  st.skipped_before_scoring[key] = (st.skipped_before_scoring[key] || 0) + 1;
}

// 去重闸（打分前）: drop what the ledger says was attempted (rules 2-6, the
// same identityBlock the dispatch gate runs) and what the seen log still
// vouches for; only the rest is worth paying to score.
function gate(st, candidates, kind) {
  const now = new Date();
  const idx = attemptIndex(readAll(home), now);
  const seen = seenContext();
  const taken = new Set(st.pooled_keys);
  const release = new Set(st.release.map((u) => jobFingerprint(u).fp));
  const kept = [];
  for (const raw of candidates) {
    const c = { ...raw, apply_url: raw.apply_url || raw.url, _watchlist: kind === 'watchlist' };
    const fp = jobFingerprint(c.apply_url);
    if (!fp) throw new Error(`discovery handed over an auto-apply candidate without a job fingerprint: ${c.apply_url}`);
    const released = release.has(fp.fp);
    c._released = released;
    const ct = companyTitleKey(c.company, c.title);
    if (taken.has(fp.fp) || taken.has(ct)) {
      bump(st, 'duplicate_in_run');
      continue;
    }
    const block = identityBlock(c, idx, now, seen);
    if (!block.ok) {
      bump(st, block.reason);
      if (released) st.release_outcome[fp.fp] = block.reason;
      continue;
    }
    const jd = jdHash(c.description);
    // A release lifts the hold, nothing else: a released job that was since
    // taken down or judged not a fit stays skipped.
    const hit = lookupSeen(seen.index, c).find((r) => !(released && r.code === 'held_for_review') && stillSeen(r, { jd_hash: jd }, seen.basis, now));
    if (hit) {
      bump(st, `seen_${hit.code}`);
      if (released) st.release_outcome[fp.fp] = `seen_${hit.code}`;
      continue;
    }
    if (released) st.release_outcome[fp.fp] = 'pooled';
    taken.add(fp.fp);
    taken.add(ct);
    kept.push(c);
  }
  st.pooled_keys = [...taken];
  // Released first (the user asked for exactly these), then longest JD first.
  return kept.sort((a, b) => (b._released - a._released) || ((b.description?.length || 0) - (a.description?.length || 0)));
}

function scan(st, kind) {
  const outDir = join(st.run_dir, `disc-${kind}-${st.windows_scanned}`);
  const args = ['shared/discover_candidates.mjs', '--run', '--output-dir', outDir, '--cap-to-score', '1000000', '--run-id', st.run_id];
  if (kind === 'watchlist') {
    args.push('--sources', 'watchlist', '--source-window-size', '0');
  } else {
    const offset = st.cursor_start + st.windows_scanned * st.window_size;
    args.push('--sources', ROTATION_SOURCES.join(','), '--source-window-size', String(st.window_size), '--source-window-offset', String(offset));
    st.last_window_offset = offset;
  }
  const r = runChild(st, args);
  if (r.code !== 0) throw new Error(`discovery (${kind}) failed with exit ${r.code}`);
  const funnel = readJson(join(outDir, 'discovery_funnel.json'));
  st.source_errors.push(...(funnel.errors || []).map((e) => ({ kind, ...e })));
  return gate(st, readJson(join(outDir, 'to_score.json')), kind);
}

function next() {
  const st = loadState(argValue('--run'));
  if (st.pending_batch != null) die(`batch ${st.pending_batch} is still waiting for submit-scores`);
  const done = (reason) => {
    st.stop_reason = reason;
    saveState(st);
    console.log(JSON.stringify({ ok: true, action: 'done', reason }));
  };
  const stop = stopReason(st);
  if (stop) return done(stop);
  let pool = loadPool(st);
  while (pool.length === 0) {
    if (!st.watchlist_done) {
      pool = scan(st, 'watchlist');
      st.watchlist_done = true;
    } else if (st.windows_scanned < st.max_windows) {
      pool = scan(st, 'rotation');
      st.windows_scanned += 1;
    } else {
      savePool(st, pool);
      return done('supply_exhausted');
    }
    saveState(st);
  }
  const batch = pool.splice(0, Math.min(BATCH_SIZE, st.budget.max_scored - st.scored_this_run));
  st.batch_no += 1;
  st.pending_batch = st.batch_no;
  const batchFile = join(st.run_dir, `batch-${st.batch_no}.json`);
  writePrivate(batchFile, batch);
  savePool(st, pool);
  saveState(st);
  console.log(JSON.stringify({
    ok: true,
    action: 'score',
    batch: st.batch_no,
    count: batch.length,
    batch_file: batchFile,
    scored_file: join(st.run_dir, `scored-${st.batch_no}.json`),
    prompt: join(repoRoot, 'shared', 'scoring', 'score_prompt.md'),
  }));
}

// ---- submit-scores -----------------------------------------------------------

function runRows(st) {
  const db = new DatabaseSync(st.work_db, { readOnly: true });
  try {
    return db.prepare('SELECT id, company, title, apply_url, liveness_status FROM jobs').all();
  } finally {
    db.close();
  }
}

function runLedgerLines(rows) {
  const ids = new Set(rows.map((r) => r.id));
  return effectiveEntries(readAll(home)).filter((e) => ids.has(e.job_id));
}

// After a batch was applied: recount this run from the ledger (idempotent), and
// write what the ledger cannot remember for the gate — taken down (expired)
// and stuck on missing info (needs_info, rule 6).
function afterBatch(st, batch) {
  const byUrl = new Map(batch.map((c) => [c.apply_url, c]));
  const rows = runRows(st);
  const lines = runLedgerLines(rows);
  st.attempted_this_run = lines.filter(isAttempted).length;
  st.pre_submit_fails_this_run = lines.filter((e) => !isAttempted(e) && e.outcome !== 'needs_user').length;
  const fill = fillBasisVersion(home);
  const scoring = scoringBasisVersion(home);
  for (const row of rows.filter((r) => byUrl.has(r.apply_url))) {
    const e = lines.filter((l) => l.job_id === row.id).at(-1);
    const base = { apply_url: row.apply_url, company: row.company, title: row.title };
    if ((e && e.outcome === 'not_submitted' && e.reason === 'job_unavailable') || (!e && row.liveness_status === 'expired')) {
      recordSeen(home, { ...base, code: 'expired', jd_hash: jdHash(byUrl.get(row.apply_url).description), basis_version: scoring, reason: e ? e.reason : 'liveness_expired' });
      st.expired_this_run += 1;
    } else if (e && e.outcome === 'needs_user' && !isAttempted(e)) {
      recordSeen(home, { ...base, code: 'needs_info', jd_hash: null, basis_version: fill, reason: e.reason });
    }
  }
}

// D10 第一版（lead 裁决 / DESIGN 未明点 6 简化方案）: a list (dream) company
// has two tries in 60 days, so an eligible job there is NOT applied to on its
// own. It is taken out of this run's queue, remembered as held_for_review (so
// it is not scored or reported again for 7 days) and listed in line 1 for the
// user, who applies by hand or releases it with `start --release <link>`.
//
// Held by COMPANY, not by source (verify 第 6 轮 R9): a list company's job can
// also arrive through the rotation scan — e.g. when the list scan of that board
// failed — and must be held all the same.
function listCompanyKeys() {
  const p = join(home, 'search_intent.json');
  if (!existsSync(p)) return new Set();
  const targets = readJson(p).search_intent?.target_companies ?? [];
  return new Set(targets.map((t) => normalizeCompany(t.slug)));
}

function holdListJobs(st, batch) {
  const keys = listCompanyKeys();
  const list = new Map(batch.filter((c) => keys.has(normalizeCompany(c.company)) && !c._released).map((c) => [c.apply_url, c]));
  if (list.size === 0) return 0;
  const db = new DatabaseSync(st.work_db);
  let held = 0;
  try {
    const rows = db.prepare("SELECT id, company, title, apply_url FROM jobs WHERE status = '🤖 AI sourced' AND COALESCE(auto_apply_eligible, 0) = 1").all();
    const scoring = scoringBasisVersion(home);
    for (const row of rows.filter((r) => list.has(r.apply_url))) {
      db.prepare("UPDATE jobs SET auto_apply_eligible = 0, skip_reason = 'held_for_review', updated_at = datetime('now') WHERE id = ?").run(row.id);
      recordSeen(home, { apply_url: row.apply_url, company: row.company, title: row.title, code: 'held_for_review', jd_hash: jdHash(list.get(row.apply_url).description), basis_version: scoring, reason: null });
      st.held.push({ company: row.company, title: row.title, apply_url: row.apply_url });
      held += 1;
    }
  } finally {
    db.close();
  }
  return held;
}

function submitScores() {
  const st = loadState(argValue('--run'));
  const k = Number(argValue('--batch'));
  const scoredFile = argValue('--scored');
  if (st.pending_batch !== k) die(`batch ${k} is not the pending batch (${st.pending_batch ?? 'none'})`);
  if (!scoredFile || !existsSync(scoredFile)) die(`--scored ${scoredFile} not found`);
  const batchFile = join(st.run_dir, `batch-${k}.json`);
  const batch = readJson(batchFile);
  const store = runChild(st, ['shared/store_scored_jobs.mjs', '--to-score', batchFile, '--scored', scoredFile, '--run-id', st.run_id]);
  if (store.code !== 0) die(`store_scored_jobs refused batch ${k} (exit ${store.code}) — fix the scores and submit again; the batch is still pending`);
  const stored = lastJsonBlock(store.stdout);
  st.scored_this_run += batch.length;
  st.eligible_this_run += stored.eligible;
  st.pending_batch = null;
  const held = st.no_submit ? 0 : holdListJobs(st, batch);
  saveState(st);

  let applied = null;
  const remaining = st.budget.max_attempts - st.attempted_this_run;
  if (!st.no_submit && stored.eligible - held > 0 && remaining > 0) {
    const args = ['shared/apply_supervisor.mjs', '--real', '--max', String(remaining), '--stream-run', st.run_id];
    if (st.confirm_over_30) args.push('--confirm-tier-over-30');
    const r = runChild(st, args);
    if (r.code !== 0) die(`apply step for batch ${k} failed (exit ${r.code}) — read the output above; nothing more is dispatched`);
    applied = lastJsonBlock(r.stdout);
    if (['breaker_open', 'record_failed', 'daily_cap_reached'].includes(applied.stopped_by)) st.stop_reason = applied.stopped_by;
  }
  afterBatch(st, batch);
  saveState(st);
  console.log(JSON.stringify({
    ok: true,
    batch: k,
    scored: batch.length,
    eligible: stored.eligible,
    attempted_this_run: st.attempted_this_run,
    stopped_by: applied?.stopped_by ?? null,
    // Step 6 hand-off: the missing-info questions of this batch. It lives in
    // the run directory, which finish deletes — read it before finishing.
    gap_report: applied && existsSync(join(st.run_dir, 'apply-gap-report.json')) ? join(st.run_dir, 'apply-gap-report.json') : null,
  }));
}

// ---- finish ----------------------------------------------------------------

const STOP_TEXT = {
  breaker_open: '同一种故障连续 3 次，已停，请看截图',
  record_failed: '记账失败，已停，请看上面的报错',
  pre_submit_fail_cap: '好几家表单都没打开，像是机器问题，已停，请看截图',
};

function report(st, rows, lines, unscored) {
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const name = (e) => `${rowById.get(e.job_id).company}·${rowById.get(e.job_id).title}`;
  const submitted = lines.filter((e) => e.verdict === 'submitted').map(name);
  const uncertain = lines.filter((e) => isAttempted(e) && e.verdict !== 'submitted');
  const needsInfo = lines.filter((e) => e.outcome === 'needs_user' && !isAttempted(e));
  const preSubmit = lines.filter((e) => !isAttempted(e) && e.outcome !== 'needs_user');
  const failedBoards = st.source_errors.filter((e) => e.kind === 'watchlist').map((e) => e.label || e.slug);

  const line1 = st.no_submit
    ? `试跑不提交：看了 ${st.scored_this_run} 个新岗，合适的 ${st.eligible_this_run} 个`
    : `投出 ${submitted.length} 个${submitted.length ? `：${submitted.join('、')}` : ''}${st.held.length ? `；名单公司 ${st.held.length} 个合格、等你过目（你手投，或说「投」+链接我来投）：${st.held.map((h) => `${h.company}·${h.title}·${h.apply_url}`).join('、')}` : ''}`;
  const parts = [];
  if (uncertain.length) parts.push(`${uncertain.length} 个判不确定（截图：${uncertain.map((e) => e.evidence?.path || '无截图').join('、')}，请你看一眼）`);
  if (needsInfo.length) parts.push(`${needsInfo.length} 个卡在缺信息`);
  if (preSubmit.length) parts.push(`${preSubmit.length} 个表单没打开（没点提交，下次还能再试）`);
  const extras = [];
  const rec = st.recovered_inflight;
  if (rec) extras.push(`上次中断的运行有 1 家可能已提交：${rec.name}（${rec.screenshot || rec.apply_url}，永不自动重投，请你核对邮箱或页面）`);
  if (STOP_TEXT[st.stop_reason]) extras.push(STOP_TEXT[st.stop_reason]);
  if (failedBoards.length) extras.push(`名单里 ${failedBoards.length} 家没扫到：${failedBoards.join('、')}`);
  const releaseMissing = st.release.filter((u) => !st.release_outcome[jobFingerprint(u).fp]);
  const releaseBlocked = st.release.filter((u) => !['pooled', undefined].includes(st.release_outcome[jobFingerprint(u).fp]));
  if (releaseMissing.length) extras.push(`放行的 ${releaseMissing.length} 个没找到（可能已下架）：${releaseMissing.join('、')}`);
  if (releaseBlocked.length) extras.push(`放行的 ${releaseBlocked.length} 个没投：${releaseBlocked.map((u) => `${u}（${st.release_outcome[jobFingerprint(u).fp]}）`).join('、')}`);
  const notSubmitted = uncertain.length + needsInfo.length + preSubmit.length;
  const line2 = [`没投成 ${notSubmitted} 个${parts.length ? `：${parts.join('；')}` : ''}`, ...extras].join('；');

  // Held list jobs are fit but not applied to: say so where the fit count is.
  const fit = `${st.eligible_this_run} 个${st.held.length ? `（其中 ${st.held.length} 个是名单公司、等你过目）` : ''}`;
  let line3;
  if (st.scored_this_run === 0 && unscored > 0) {
    line3 = `这次没打分：还有 ${unscored} 个新岗没打分就收工了`;
  } else if (st.scored_this_run === 0) {
    line3 = '没有新岗：这次找到的都是投过或看过的';
  } else if (!st.no_submit && st.attempted_this_run < st.budget.max_attempts) {
    line3 = `新岗不够：这次看了 ${st.scored_this_run} 个新岗，合适的只有 ${fit}，没凑到 ${st.budget.max_attempts} 个`;
  } else {
    line3 = `这次看了 ${st.scored_this_run} 个新岗，合适的 ${fit}`;
  }
  if (st.stop_reason === 'score_budget_reached') line3 += `（到了看的上限 ${st.budget.max_scored}）`;
  if (st.scored_this_run > 0 && unscored > 0) line3 += `；还有 ${unscored} 个新岗没打分就收工了`;
  return { lines: [line1, line2, line3], submitted, held: st.held };
}

function finish() {
  const st = loadState(argValue('--run'));
  const rows = runRows(st);
  const lines = runLedgerLines(rows);
  // Found but never scored: left in the pool, or handed out and never submitted.
  const pendingCount = st.pending_batch != null ? readJson(join(st.run_dir, `batch-${st.pending_batch}.json`)).length : 0;
  const unscored = loadPool(st).length + pendingCount;
  const { lines: out, submitted, held } = report(st, rows, lines, unscored);

  // Rotation cursor: a window whose candidates were all taken is done; one
  // with candidates left over is where the next run starts.
  if (st.last_window_offset != null) {
    const drained = loadPool(st).length === 0;
    const nextOffset = drained ? st.last_window_offset + st.window_size : st.last_window_offset;
    writeFileSync(join(home, 'source_cursor.json'), `${JSON.stringify({ next_offset: nextOffset, last_offset: st.last_window_offset, window_size: st.window_size, last_run_id: st.run_id, updated_at: new Date().toISOString() }, null, 2)}\n`);
  }

  // The run directory holds this run's scores and every answer typed into a
  // form; it dies with the run — unless an unrecorded attempt still points at
  // it, which the next start must record first（ADR-S8 在途标记不变量）.
  const marker = readInflight(home);
  const keep = Boolean(marker && marker.work_db.startsWith(st.run_dir));
  if (keep) log(`⚠️ ${st.run_dir} kept: locks/inflight.json still points into it; the next start records that attempt first`);
  else rmSync(st.run_dir, { recursive: true, force: true });
  releaseHome(st.run_id);

  console.log(JSON.stringify({
    ok: true,
    run_id: st.run_id,
    lines: out,
    submitted,
    held,
    stop_reason: st.stop_reason,
    scored: st.scored_this_run,
    eligible: st.eligible_this_run,
    attempted: st.attempted_this_run,
    skipped_before_scoring: st.skipped_before_scoring,
    source_errors: st.source_errors,
    run_dir_kept: keep,
  }));
}

const commands = { start, next, 'submit-scores': submitScores, finish };
const cmd = process.argv[2];
if (!commands[cmd]) die('usage: stream_run.mjs <start|next|submit-scores|finish> …');
try {
  await commands[cmd]();
} catch (e) {
  die(e.stack || e.message);
}
