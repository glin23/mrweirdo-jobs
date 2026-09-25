// Runs the REAL shared/apply_batch.mjs against a throwaway home, with only the
// machinery around it stubbed. apply_batch spawns its steps as
// `node shared/<step>.mjs` from MRWEIRDO_REPO_ROOT, so the harness builds a fake
// repo root whose shared/ is a mirror of the real one (symlinks — the real
// record_apply_outcome, ledger and guard run), with these replaced by stubs:
//   drivers         → emit the outcome scripted for their apply_url, log the call
//   auto_apply_queue→ print the rows this test queued
//   validate/dedupe/recompute/preflight/liveness/reports/cover letter → no-ops
// No browser, no network, no ~/.mrweirdo-jobs.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { onboardTestEnv } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REAL_SHARED = join(ROOT, 'shared');

// Every stubbed step notes its own name in MRW_TEST_STEP_LOG, so a test can
// assert which steps a mode runs and which it skips.
const STEP = `import { appendFileSync as __a } from 'node:fs';
if (process.env.MRW_TEST_STEP_LOG) __a(process.env.MRW_TEST_STEP_LOG, process.argv[1].split('/').pop() + '\\n');
`;
const NOOP = `${STEP}console.log(JSON.stringify({ ok: true, stub: true }));\n`;
export const STUBS = {
  'dedupe_jobs.mjs': NOOP,
  'recompute_auto_apply_eligibility.mjs': NOOP,
  'supervisor_preflight.mjs': NOOP,
  'liveness_gate.mjs': NOOP,
  'job_report.mjs': `${STEP}console.log('/tmp/stub-job-report.md');\n`,
  'apply_report.mjs': `${STEP}console.log('/tmp/stub-apply-report.html');\n`,
  'apply_gap_report.mjs': NOOP,
  'queue_diagnostics.mjs': `process.exit(1);\n`,
  'materialize_cover_letter.mjs': `console.log(JSON.stringify({ ok: false, reason: 'stub_no_cover_letter' })); process.exit(1);\n`,
  'validate_auto_row.mjs': `console.log(JSON.stringify({ ok: true }));\n`,
  'auto_apply_queue.mjs': `
import { readFileSync } from 'node:fs';
for (const row of JSON.parse(readFileSync(process.env.MRW_TEST_QUEUE, 'utf8'))) console.log(JSON.stringify(row));
`,
};
export const DRIVER_STUB = `
import { appendFileSync, readFileSync } from 'node:fs';
const url = process.argv[2];
appendFileSync(process.env.MRW_TEST_DRIVER_LOG, url + '\\n');
const script = JSON.parse(readFileSync(process.env.MRW_TEST_DRIVER_SCRIPT, 'utf8'));
const out = script[url] ?? { outcome: 'submitted', verdict: { verdict: 'submitted', confirmHits: ['stub'], denyHits: [] } };
if (out === 'die') process.exit(1); // killed mid-run: no structured line
const codes = { submitted: 0, crashed: 1, needs_user: 2, not_submitted: 2, unknown: 2, captcha_blocked: 3, rate_limited: 4 };
console.log(JSON.stringify(out));
process.exit(codes[out.outcome]);
`;

export function makeBatchRig(prefix) {
  const base = mkdtempSync(join(tmpdir(), prefix));
  const home = join(base, 'home');
  const repo = join(base, 'repo');
  mkdirSync(home, { recursive: true });
  mkdirSync(join(repo, 'shared'), { recursive: true });
  for (const name of readdirSync(REAL_SHARED)) {
    const target = join(repo, 'shared', name);
    if (STUBS[name] != null) writeFileSync(target, STUBS[name]);
    else if (/_apply_driver\.mjs$/.test(name)) writeFileSync(target, DRIVER_STUB);
    else symlinkSync(join(REAL_SHARED, name), target);
  }
  const env = onboardTestEnv(home, {
    MRWEIRDO_REPO_ROOT: repo,
    MRW_TEST_QUEUE: join(base, 'queue.json'),
    MRW_TEST_DRIVER_LOG: join(base, 'driver_calls.log'),
    MRW_TEST_DRIVER_SCRIPT: join(base, 'driver_script.json'),
    MRW_TEST_STEP_LOG: join(base, 'steps.log'),
    MRWEIRDO_QUIET: '0',
  });
  delete env.MRWEIRDO_DAILY_TIER;
  delete env.MRWEIRDO_MAX_AUTO_APPLY;
  const init = spawnSync(process.execPath, [join(REAL_SHARED, 'init_db_cli.mjs')], { cwd: ROOT, env, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  writeFileSync(env.MRW_TEST_DRIVER_SCRIPT, '{}');
  let nextId = 1;
  let runDbs = 0;
  const rig = {
    base,
    home,
    env,
    // Inserts job rows into the current DB and returns them in queue shape.
    // Ids are unique across every DB this rig creates — the S3 per-run work DB
    // numbers its rows above the ledger's max for the same reason.
    addJobs(jobs) {
      const db = new DatabaseSync(env.MRWEIRDO_DB_PATH);
      const ins = db.prepare(`INSERT INTO jobs(id, company, title, apply_url, status, ats_platform) VALUES (?, ?, ?, ?, '🤖 AI sourced', ?)`);
      const rows = jobs.map((j) => {
        const ats = j.ats || (j.apply_url.includes('ashbyhq') ? 'ashby' : 'greenhouse');
        const id = nextId++;
        ins.run(id, j.company, j.title, j.apply_url, ats);
        return { id, company: j.company, title: j.title, apply_url: j.apply_url, ats_platform: ats };
      });
      db.close();
      return rows;
    },
    // A fresh DB for the next run, like S3's one-off work DB: the same job can
    // be found again (jobs.apply_url is UNIQUE within one DB).
    newRunDb() {
      runDbs += 1;
      env.MRWEIRDO_DB_PATH = join(base, `run-${runDbs}.db`);
      const r = spawnSync(process.execPath, [join(REAL_SHARED, 'init_db_cli.mjs')], { cwd: ROOT, env, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
    },
    script(map) {
      writeFileSync(env.MRW_TEST_DRIVER_SCRIPT, JSON.stringify(map));
    },
    steps() {
      return existsSync(env.MRW_TEST_STEP_LOG) ? readFileSync(env.MRW_TEST_STEP_LOG, 'utf8').split('\n').filter(Boolean) : [];
    },
    driverCalls() {
      return existsSync(env.MRW_TEST_DRIVER_LOG) ? readFileSync(env.MRW_TEST_DRIVER_LOG, 'utf8').split('\n').filter(Boolean) : [];
    },
    run(queueRows, args = [], extraEnv = {}) {
      writeFileSync(env.MRW_TEST_QUEUE, JSON.stringify(queueRows));
      const r = spawnSync(process.execPath, [join(REAL_SHARED, 'apply_batch.mjs'), '--pace-min-ms', '0', '--pace-max-ms', '0', ...args], {
        cwd: ROOT, env: { ...env, ...extraEnv }, encoding: 'utf8',
      });
      let summary = null;
      const start = r.stdout.lastIndexOf('\n{\n');
      if (start >= 0) summary = JSON.parse(r.stdout.slice(start + 1));
      return { ...r, summary };
    },
  };
  return rig;
}

export const gh = (board, n) => `https://boards.greenhouse.io/${board}/jobs/${n}`;
export const ashby = (board, n) => `https://jobs.ashbyhq.com/${board}/00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
