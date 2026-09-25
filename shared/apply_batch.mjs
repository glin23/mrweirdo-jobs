#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atsHome } from './paths.mjs';
import { blockingProfileGaps } from './personal_fact_gate.mjs';
import { workAuthSources } from './answer_provenance.mjs';
import { formatMaxRows, limitRows, resolveMaxRows } from './batch_limit.mjs';
import { progress, sleepWithProgress } from './progress.mjs';
import { onboardTmpDir } from './onboard_tmp.mjs';
import { lockDir, lockFile } from './state_file_lock.mjs';
import { dbPath } from './local_db.mjs';
import { readAll } from './submission_ledger.mjs';
import { PRE_DISPATCH_STAGE } from './driver_contract.mjs';
import {
  attemptIndex,
  breaker,
  budgetLine,
  checkDispatch,
  clearInflight,
  dailyTier,
  readInflight,
  writeInflight,
} from './apply_guard.mjs';

const repoRoot = process.env.MRWEIRDO_REPO_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const home = atsHome();
const tmpDir = onboardTmpDir();

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

function hasArg(name) {
  return process.argv.includes(name);
}

const maxRows = resolveMaxRows();
const roleTargets = argValue('--role-targets') || process.env.MRWEIRDO_ROLE_TYPE_TARGETS || '';
const dryRun = hasArg('--dry-run');
const skipLiveness = hasArg('--skip-liveness') || process.env.MRWEIRDO_SKIP_LIVENESS === '1';
const paceMinMs = Math.max(0, Number(argValue('--pace-min-ms') || process.env.MRWEIRDO_APPLY_PACE_MIN_MS || 30000));
const paceMaxMs = Math.max(paceMinMs, Number(argValue('--pace-max-ms') || process.env.MRWEIRDO_APPLY_PACE_MAX_MS || 90000));
const batchRunId = `batch_${new Date().toISOString().replace(/[:.]/g, '-')}_${process.pid}`;

// L3 日档位（restart-apply ADR-S7）: read and validated before anything runs; a
// tier above 30 without the user's explicit flag stops here, loudly.
let tier;
try {
  tier = dailyTier(process.env, hasArg('--confirm-tier-over-30'));
} catch (e) {
  console.error(`[apply-batch] ${e.message}`);
  process.exit(1);
}

const env = {
  ...process.env,
  MRWEIRDO_MAX_AUTO_APPLY: maxRows == null ? '0' : String(maxRows),
  ...(roleTargets ? { MRWEIRDO_ROLE_TYPE_TARGETS: roleTargets } : {}),
};

function runNode(args, opts = {}) {
  const { env: extraEnv = {}, ...spawnOpts } = opts;
  const r = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env: { ...env, ...extraEnv },
    encoding: 'utf8',
    ...spawnOpts,
  });
  return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function fail(label, result) {
  if (result?.stdout) process.stdout.write(result.stdout);
  if (result?.stderr) process.stderr.write(result.stderr);
  console.error(`[apply-batch] ${label} failed`);
  process.exit(1);
}

function parseJsonLines(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      // Pretty-printed JSON spans multiple lines; parseLastJson handles it.
    }
  }
  return rows;
}

function parseLastJson(text) {
  const rows = parseJsonLines(text);
  if (rows.length) return rows[rows.length - 1];
  try {
    return JSON.parse(String(text || '').trim());
  } catch {
    return null;
  }
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function jitterMs() {
  if (paceMaxMs <= paceMinMs) return paceMinMs;
  return Math.floor(paceMinMs + Math.random() * (paceMaxMs - paceMinMs + 1));
}

function runTee(args, outPath, extraEnv = {}) {
  return new Promise((resolve) => {
    // mode here + lockFile on close: the driver result file holds every answer
    // the driver typed into the form. Born 600 even if the file pre-exists.
    const out = createWriteStream(outPath, { flags: 'w', mode: 0o600 });
    out.on('open', () => lockFile(outPath));
    const child = spawn(process.execPath, args, { cwd: repoRoot, env: { ...env, ...extraEnv } });
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      out.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      out.write(chunk);
    });
    child.on('close', (code) => {
      out.end();
      resolve(code ?? 1);
    });
  });
}

function generateCoverLetter(row) {
  const result = runNode(['shared/materialize_cover_letter.mjs', '--row-id', String(row.id), '--json']);
  const parsed = parseLastJson(result.stdout) || {};
  if (result.code !== 0 || !parsed.ok || !parsed.path) {
    progress('apply', `cover letter generation unavailable for row ${row.id}; driver will manualize if the form requires it`);
    return {
      ok: false,
      reason: parsed.reason || 'cover_letter_generation_failed',
      detail: parsed,
    };
  }
  progress('apply', `cover letter generated for row ${row.id}: ${parsed.path}`);
  return parsed;
}

function markCoverLetterUsed(row, coverLetter, resultFile) {
  if (!coverLetter?.path) return;
  const result = runNode([
    'shared/materialize_cover_letter.mjs',
    '--mark-used',
    '--row-id',
    String(row.id),
    '--path',
    coverLetter.path,
    '--result-file',
    resultFile,
    '--json',
  ]);
  if (result.code !== 0) {
    progress('apply', `cover letter used audit failed for row ${row.id}; continuing`);
    if (result.stderr) process.stderr.write(result.stderr);
  }
}

function driverFor(row) {
  if (row.ats_platform === 'greenhouse') return 'shared/greenhouse_apply_driver.mjs';
  if (row.ats_platform === 'ashby') return 'shared/ashby_apply_driver.mjs';
  if (row.ats_platform === 'lever') return 'shared/lever_apply_driver.mjs';
  throw new Error(`unsupported platform: ${row.ats_platform}`);
}

function acquireBatchLock() {
  const locksDir = join(home, 'locks');
  const lockPath = join(locksDir, 'apply_batch.lock');
  mkdirSync(locksDir, { recursive: true });

  const payload = `${JSON.stringify({
    pid: process.pid,
    started_at: new Date().toISOString(),
    max_rows: formatMaxRows(maxRows),
    role_targets: roleTargets || '(from search_intent)',
  })}\n`;

  let fd;
  try {
    fd = openSync(lockPath, 'wx');
    writeFileSync(fd, payload);
  } catch (e) {
    let existing = '';
    try {
      existing = readFileSync(lockPath, 'utf8').trim();
    } catch {
      existing = '(unable to read existing lock)';
    }
    console.error(`[apply-batch] another apply batch appears to be running: ${lockPath}`);
    console.error(`[apply-batch] existing lock: ${existing}`);
    console.error('[apply-batch] stop the other run first; if it crashed, remove the stale lock file manually.');
    process.exit(1);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      unlinkSync(lockPath);
    } catch {
      // Best-effort cleanup; a missing lock is already safe.
    }
  };

  process.once('exit', release);
  process.once('SIGINT', () => {
    release();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    release();
    process.exit(143);
  });

  console.error(`[apply-batch] lock=${lockPath}`);
}

// 崩溃恢复（ADR-S8）: a marker left behind means a driver may have clicked
// Submit and nobody recorded it. Record it FIRST (as the driver's own outcome
// if it got that far, else crashed/recovered_inflight = may have submitted) —
// before any new dispatch can re-apply to the same job. Recording failure
// stops the run: an unrecorded attempt must be resolved, not stepped over.
function recoverInflight() {
  const m = readInflight(home);
  if (!m) return;
  console.error(`[apply-batch] ⚠️ found an unrecorded attempt from ${m.run_id}: row ${m.row_id} ${m.apply_url} (started ${m.started_at}) — recording it before anything else`);
  const alreadyRecorded = readAll(home).some((e) => e.job_id === m.row_id && e.apply_url === m.apply_url && e.ts >= m.started_at);
  if (!alreadyRecorded) {
    const text = existsSync(m.result_file) ? readFileSync(m.result_file, 'utf8') : '';
    let resultFile = m.result_file;
    if (!parseJsonLines(text).some((o) => typeof o.outcome === 'string')) {
      resultFile = join(tmpDir, `recovered-inflight-${m.row_id}-${Date.now()}.jsonl`);
      writeFileSync(resultFile, `${JSON.stringify({
        outcome: 'crashed',
        reason: 'recovered_inflight',
        detail: { run_id: m.run_id, started_at: m.started_at, result_file: m.result_file, result_file_present: text !== '' },
      })}\n`, { mode: 0o600 });
      lockFile(resultFile);
    }
    const rec = runNode(['shared/record_apply_outcome.mjs', '--row-id', String(m.row_id), '--result-file', resultFile], {
      env: { MRWEIRDO_DB_PATH: m.work_db },
    });
    if (rec.stdout) process.stdout.write(rec.stdout);
    if (rec.code !== 0) fail(`inflight recovery for row ${m.row_id} (marker kept at locks/inflight.json)`, rec);
  }
  clearInflight(home);
}

mkdirSync(tmpDir, { recursive: true });
// The transit files written below (apply-result-*.jsonl, batch summaries) carry
// what was actually typed into real forms（阶段 1 设计 §14.5 未明点 1，lead 裁决
// 并入本批上锁）. A 700 directory protects them wholesale; each write below
// also locks its own file (write-side trigger).
lockDir(tmpDir, { recursive: true });

// Dry-run counts the gate but does not stop on it. The point is that the queue
// gate can show the gap while the user is still reading the queue, instead of
// preflight rejecting the batch one second after they type 开始. The real run
// still fails hard, in supervisor_preflight.
function readProfileForGate() {
  try {
    return JSON.parse(readFileSync(join(home, 'profile.json'), 'utf8'));
  } catch {
    return {};
  }
}
const gateProfile = readProfileForGate();
const profileGate = blockingProfileGaps(gateProfile, {
  work_auth_sources: workAuthSources(home),
});
if (!profileGate.ok) {
  // Closed means exactly one thing since ADR-11: the funnel never ran. There is
  // no "asked but still closed" state any more, so the only right move is to
  // ask — the three places-to-look live next to Q4 now, not on this gate.
  progress('apply', `profile gate: unanswered ${profileGate.missing_paths.join(', ')}`);
  progress('apply', `profile gate: ${profileGate.blocked_because}`);
  progress('apply', `profile gate: ask "${profileGate.question}"`);
  progress('apply', `profile gate: ${profileGate.what_happens_next}`);
  progress('apply', `profile gate: then run ${profileGate.remediation_command}`);
}

progress('apply', `repo=${repoRoot}`);
progress('apply', `home=${home}`);
progress('apply', `max=${formatMaxRows(maxRows)} role_targets=${roleTargets || '(from search_intent)'} dry_run=${dryRun} skip_liveness=${skipLiveness}`);

if (!dryRun) {
  acquireBatchLock();
  recoverInflight();

  const dedupe = runNode(['shared/dedupe_jobs.mjs', '--apply']);
  if (dedupe.code !== 0) fail('dedupe', dedupe);
  if (dedupe.stdout) process.stdout.write(dedupe.stdout);
  if (dedupe.stderr) process.stderr.write(dedupe.stderr);

  const recompute = runNode(['shared/recompute_auto_apply_eligibility.mjs', '--apply']);
  if (recompute.code !== 0) fail('recompute_auto_apply_eligibility', recompute);
  if (recompute.stdout) process.stdout.write(recompute.stdout);
  if (recompute.stderr) process.stderr.write(recompute.stderr);

  const preflight = runNode(['shared/supervisor_preflight.mjs', '--json']);
  if (preflight.stdout) process.stdout.write(preflight.stdout);
  if (preflight.stderr) process.stderr.write(preflight.stderr);
  if (preflight.code !== 0) fail('supervisor_preflight', preflight);

  if (!skipLiveness) {
    const liveness = runNode(['shared/liveness_gate.mjs', '--batch', '--json']);
    if (liveness.stdout) process.stdout.write(liveness.stdout);
    if (liveness.stderr) process.stderr.write(liveness.stderr);
    if (liveness.code !== 0) fail('liveness_gate', liveness);
  } else {
    progress('apply', 'liveness gate skipped by --skip-liveness');
  }
}

// L1 run target folded into today's tier; this is the user's first line.
const budget = budgetLine(attemptIndex(readAll(home)), maxRows ?? tier, tier);
progress('apply', budget.line);

const queueRun = runNode(['shared/auto_apply_queue.mjs', '--summary']);
if (queueRun.stderr) process.stderr.write(queueRun.stderr);
if (queueRun.code !== 0) fail('auto_apply_queue', queueRun);
const rows = limitRows(parseJsonLines(queueRun.stdout), maxRows);
progress('apply', `queue_rows=${rows.length}`);
if (maxRows != null && rows.length < maxRows) {
  const diag = runNode(['shared/queue_diagnostics.mjs', '--json']);
  if (diag.code === 0) {
    const parsed = parseLastJson(diag.stdout) || {};
    progress('apply', `ready rows below requested batch: requested=${maxRows}, eligible=${rows.length}`);
    if (parsed.by_reason) progress('apply', 'queue reasons', parsed.by_reason);
    if (parsed.near_misses) {
      const rescoreCount = parsed.near_misses.rescore_candidates_fit_one_below?.count ?? 0;
      const platformCount = parsed.near_misses.platform_expansion_candidates?.count ?? 0;
      progress('apply', `review hints rescore_fit_${(parsed.min_fit ?? 5) - 1}_to_${parsed.min_fit ?? 5}=${rescoreCount} unsupported_platform_fit_ge_${parsed.min_fit ?? 5}=${platformCount}`);
    }
    const reviewArgs = ['shared/queue_review_report.mjs'];
    if (dryRun) reviewArgs.push('--output', join(tmpDir, `queue-review-dry-run-${Date.now()}.html`));
    const review = runNode(reviewArgs);
    if (review.code === 0) {
      progress('apply', `queue review HTML: ${review.stdout.trim().split(/\r?\n/).filter(Boolean).pop()}`);
    } else {
      progress('apply', 'queue review HTML generation failed; continuing');
      if (review.stderr) process.stderr.write(review.stderr);
    }
    const readinessArgs = ['shared/apply_readiness_plan.mjs', '--target', String(maxRows)];
    if (dryRun) readinessArgs.push('--output', join(tmpDir, `readiness-plan-dry-run-${Date.now()}.html`));
    const readiness = runNode(readinessArgs);
    if (readiness.code === 0) {
      progress('apply', `readiness report HTML: ${readiness.stdout.trim().split(/\r?\n/).filter(Boolean).pop()}`);
    } else {
      progress('apply', 'readiness report generation failed; continuing');
      if (readiness.stderr) process.stderr.write(readiness.stderr);
    }
  }
}

const summaries = [];
const batchStartedAt = new Date().toISOString();
const dispatchedOutcomes = [];
let breakerState = null;
let stoppedBy = null;
for (let i = 0; i < rows.length; i += 1) {
  const row = rows[i];
  progress('apply', `row ${i + 1}/${rows.length}: ${row.id} ${row.company} - ${row.title}`);

  // 投前权威闸（ADR-S7）: the ledger is re-read for EVERY row, so an attempt
  // recorded a moment ago — by this batch or another session — is seen.
  const guard = checkDispatch(row, attemptIndex(readAll(home)), budget, new Date());
  if (!guard.ok) {
    progress('apply', `guard: row ${row.id} not dispatched — ${guard.reason}${guard.ref_ledger_id ? ` (ledger ${guard.ref_ledger_id})` : ''}`);
    summaries.push({ row_id: row.id, company: row.company, title: row.title, action: 'guard_blocked', reason: guard.reason, ref_ledger_id: guard.ref_ledger_id });
    if (guard.reason === 'daily_cap_reached' || guard.reason === 'run_target_reached') {
      stoppedBy = guard.reason;
      break;
    }
    continue;
  }

  const validate = runNode(['shared/validate_auto_row.mjs', '--row-id', String(row.id)]);
  if (validate.stdout) process.stdout.write(validate.stdout);
  if (validate.stderr) process.stderr.write(validate.stderr);
  if (validate.code !== 0) {
    const validationResult = parseLastJson(`${validate.stdout}\n${validate.stderr}`) || {};
    const reason = validationResult.reason || 'validation_failed';
    if (dryRun) {
      summaries.push({ row_id: row.id, action: 'validation_failed', reason });
      continue;
    }

    const resultFile = join(tmpDir, `apply-result-${row.id}.jsonl`);
    writeFileSync(resultFile, `${JSON.stringify({
      outcome: 'needs_user',
      reason,
      stage: PRE_DISPATCH_STAGE, // no driver ran: may_have_submitted=false
      validation: validationResult,
    })}\n`, { mode: 0o600 });
    lockFile(resultFile);
    const record = runNode(['shared/record_apply_outcome.mjs', '--row-id', String(row.id), '--result-file', resultFile]);
    if (record.stdout) process.stdout.write(record.stdout);
    if (record.stderr) process.stderr.write(record.stderr);
    if (record.code !== 0) {
      progress('apply', `record failed for row ${row.id}; skipping this row, continuing batch`);
      summaries.push({ row_id: row.id, result_file: resultFile, action: 'record_failed', reason: 'record_apply_outcome_nonzero' });
      continue;
    }
    const recorded = parseLastJson(record.stdout) || { action: 'recorded_unknown' };
    summaries.push({ row_id: row.id, result_file: resultFile, ...recorded });
    continue;
  }

  if (dryRun) {
    summaries.push({
      row_id: row.id,
      company: row.company,
      title: row.title,
      fit_score: row.fit_score,
      ats_platform: row.ats_platform,
      location: row.location || null,
      legitimacy: row.legitimacy || 'high',
      action: 'dry_run_validated',
    });
    continue;
  }

  const resultFile = join(tmpDir, `apply-result-${row.id}.jsonl`);
  const coverLetter = generateCoverLetter(row);
  const driverEnv = {
    MRWEIRDO_DISABLE_STATIC_COVER_LETTER: '1',
    ...(coverLetter.ok && coverLetter.path ? { MRWEIRDO_COVER_LETTER_PATH: coverLetter.path } : {}),
    ...(!coverLetter.ok ? { MRWEIRDO_COVER_LETTER_GENERATION_REASON: coverLetter.reason || 'cover_letter_generation_failed' } : {}),
  };
  writeInflight(home, {
    run_id: batchRunId,
    work_db: dbPath(),
    row_id: row.id,
    apply_url: row.apply_url,
    result_file: resultFile,
    started_at: new Date().toISOString(),
  });
  const code = await runTee([driverFor(row), row.apply_url, String(row.id)], resultFile, driverEnv);
  // 契约退出码（ADR-15）：0 提交 / 1 崩溃 / 2 需人看 / 3 验证码 / 4 超限。
  // 2-4 是驱动如实报告的正常结局；1 是机器坏了，必须响。
  if (code === 1) {
    console.error(`[apply-batch] ⚠️ driver CRASHED (exit 1) for row ${row.id}; recorder will file it as crashed`);
  } else if (![0, 2, 3, 4].includes(code)) {
    console.error(`[apply-batch] driver exited non-contract code=${code}; recorder will classify from captured output`);
  }

  const record = runNode(['shared/record_apply_outcome.mjs', '--row-id', String(row.id), '--result-file', resultFile]);
  if (record.stdout) process.stdout.write(record.stdout);
  if (record.stderr) process.stderr.write(record.stderr);
  if (record.code !== 0) {
    // The attempt may be unrecorded: dispatching more would step over it. Keep
    // the in-flight marker (next run records it first) and stop, loudly.
    console.error(`[apply-batch] ⚠️ record failed for row ${row.id} after its driver ran — stopping the batch; locks/inflight.json kept for recovery`);
    summaries.push({ row_id: row.id, company: row.company, title: row.title, result_file: resultFile, action: 'record_failed', reason: 'record_apply_outcome_nonzero' });
    stoppedBy = 'record_failed';
    break;
  }
  clearInflight(home);

  const recorded = parseLastJson(record.stdout) || { action: 'recorded_unknown' };
  const driverOutcome = parseLastJson(readFileSync(resultFile, 'utf8')) || {};
  if (recorded.action === 'submitted' && driverOutcome.cover_letter_uploaded === true) {
    markCoverLetterUsed(row, coverLetter, resultFile);
  }
  let jobReportPath = null;
  if (recorded.action === 'submitted') {
    const jobReport = runNode(['shared/job_report.mjs', '--row-id', String(row.id), '--append-submission']);
    if (jobReport.stdout) process.stdout.write(jobReport.stdout);
    if (jobReport.stderr) process.stderr.write(jobReport.stderr);
    if (jobReport.code === 0) {
      jobReportPath = jobReport.stdout.trim().split(/\r?\n/).filter(Boolean).pop() || null;
    } else {
      progress('apply', `job report generation failed for row ${row.id}; continuing`);
    }
  }
  summaries.push({ row_id: row.id, company: row.company, title: row.title, result_file: resultFile, job_report_path: jobReportPath, driver_outcome: driverOutcome.outcome || null, ...recorded });

  // 连续故障熔断（DESIGN §4.4）: the same machine failure three times running
  // means the machine, not the jobs — stop and ask.
  dispatchedOutcomes.push(driverOutcome.outcome || 'crashed');
  const b = breaker(dispatchedOutcomes);
  if (b.open) {
    console.error(`[apply-batch] ⚠️⚠️ breaker open: ${b.count} dispatches in a row ended ${b.outcome} — stopped dispatching; read the result files / screenshots before running again`);
    breakerState = b;
    stoppedBy = 'breaker_open';
    break;
  }

  if (i < rows.length - 1 && paceMaxMs > 0) {
    const delay = jitterMs();
    await sleepWithProgress(delay, {
      stage: 'apply',
      label: '防风控等待',
      next: `${rows[i + 1].company} (${i + 2}/${rows.length})`,
    });
  }
}

// crashed 单列高亮（阶段 1 设计 §14.4.3 失败路 2）：静默空转是同类工具被骂最凶的
// 死法；机器坏了和正常跳过不许混在同一堆数字里。
const crashedRows = summaries.filter((s) => s.driver_outcome === 'crashed' || s.reason === 'driver_died_without_outcome');
if (crashedRows.length > 0) {
  console.error(`[apply-batch] ⚠️⚠️ ${crashedRows.length} driver(s) CRASHED this batch: ${crashedRows.map((s) => `row ${s.row_id}`).join(', ')} — machinery failure, read the result files before trusting the batch numbers`);
}

let reportPath = null;
if (!dryRun) {
  const report = runNode(['shared/apply_report.mjs', '--since', todayUtc()]);
  if (report.stdout) process.stdout.write(report.stdout);
  if (report.stderr) process.stderr.write(report.stderr);
  if (report.code === 0) reportPath = report.stdout.trim().split(/\r?\n/).filter(Boolean).pop() || null;
}

const batchSummary = {
  ok: true,
  dry_run: dryRun,
  profile_gate: profileGate,
  started_at: batchStartedAt,
  finished_at: new Date().toISOString(),
  budget,
  breaker: breakerState,
  stopped_by: stoppedBy,
  rows: summaries,
  report_path: reportPath,
};

const summaryPath = join(tmpDir, `apply-batch-summary-${Date.now()}.json`);
writeFileSync(summaryPath, JSON.stringify(batchSummary, null, 2), { mode: 0o600 });
lockFile(summaryPath);

let gapReport = null;
if (!dryRun) {
  const gaps = runNode(['shared/apply_gap_report.mjs', '--summary', summaryPath]);
  if (gaps.stdout) process.stdout.write(gaps.stdout);
  if (gaps.stderr) process.stderr.write(gaps.stderr);
  if (gaps.code === 0) gapReport = parseLastJson(gaps.stdout);
  else progress('apply', 'apply gap report generation failed; continuing');
}

console.log(JSON.stringify({
  ...batchSummary,
  summary_path: summaryPath,
  gap_report: gapReport,
}, null, 2));
