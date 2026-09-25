// Runs the REAL shared/stream_run.mjs end to end against a throwaway home —
// real work DB, real store_scored_jobs, real apply_supervisor → apply_batch →
// auto_apply_queue / validate_auto_row / record_apply_outcome, real ledger and
// seen log. Stand-ins only at the edges (PM 第 2 轮 §2.7 测试环境):
//   · discover_candidates → a fake job board (the same jobs every call unless
//     the test changes the board), logging every scan;
//   · drivers → scripted outcomes, logging every dispatch;
//   · the main agent's scoring → a counting fake scorer in the test process;
//   · Chrome → a fake CDP /json/version endpoint so the real supervisor passes;
//   · preflight / reports / cover letter → no-ops (apply_batch_harness STUBS).
// No browser, no network, no ~/.mrweirdo-jobs.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STUBS, DRIVER_STUB } from './apply_batch_harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REAL_SHARED = join(ROOT, 'shared');

const DISCOVER_STUB = `
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const sources = arg('--sources');
const kind = sources === 'watchlist' ? 'watchlist' : 'rotation';
appendFileSync(process.env.MRW_TEST_DISCOVER_LOG, JSON.stringify({ kind, sources, offset: arg('--source-window-offset'), size: arg('--source-window-size') }) + '\\n');
const board = JSON.parse(readFileSync(process.env.MRW_TEST_BOARD, 'utf8'));
const out = arg('--output-dir');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'to_score.json'), JSON.stringify(board[kind] || []));
writeFileSync(join(out, 'discovery_funnel.json'), JSON.stringify({ errors: (board.errors || {})[kind] || [] }));
console.log(JSON.stringify({ ok: true, to_score: (board[kind] || []).length }));
`;

// Liveness stand-in: marks the rows the test says are taken down, like the
// real gate writes liveness_status into the (work) DB.
const LIVENESS_STUB = `
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const expired = JSON.parse(readFileSync(process.env.MRW_TEST_EXPIRED, 'utf8'));
const db = new DatabaseSync(process.env.MRWEIRDO_DB_PATH);
for (const url of expired) db.prepare("UPDATE jobs SET liveness_status = 'expired' WHERE apply_url = ?").run(url);
console.log(JSON.stringify({ ok: true, expired: expired.length }));
`;

const REAL_FOR_STREAM = new Set(['auto_apply_queue.mjs', 'validate_auto_row.mjs']);

export const INTENT = {
  search_intent: {
    seniority: 'intern',
    role_type_targets: ['intern'],
    geographic_preference: { primary_country: 'US', remote_acceptable: true },
  },
};

export const ghUrl = (board, n) => `https://boards.greenhouse.io/${board}/jobs/${n}`;

// A board job. fit decides what the fake scorer says about it.
export function job(company, n, { fit = false, title = `Growth Intern ${n}`, description = `JD for ${company} #${n}` } = {}) {
  return { company, title, apply_url: ghUrl(company.toLowerCase(), n), location: 'Remote', description, fit };
}

export async function makeStreamRig(prefix) {
  const base = mkdtempSync(join(tmpdir(), prefix));
  const home = join(base, 'home');
  const repo = join(base, 'repo');
  mkdirSync(home, { recursive: true });
  mkdirSync(join(repo, 'shared'), { recursive: true });
  for (const name of readdirSync(REAL_SHARED)) {
    const target = join(repo, 'shared', name);
    if (name === 'discover_candidates.mjs') writeFileSync(target, DISCOVER_STUB);
    else if (name === 'liveness_gate.mjs') writeFileSync(target, LIVENESS_STUB);
    else if (STUBS[name] != null && !REAL_FOR_STREAM.has(name)) writeFileSync(target, STUBS[name]);
    else if (/_apply_driver\.mjs$/.test(name)) writeFileSync(target, DRIVER_STUB);
    else symlinkSync(join(REAL_SHARED, name), target);
  }
  writeFileSync(join(home, 'search_intent.json'), JSON.stringify(INTENT));
  writeFileSync(join(home, 'resume.pdf'), 'PDF-v1');

  const cdp = createServer((req, res) => {
    res.writeHead(req.url === '/json/version' ? 200 : 404, { 'content-type': 'application/json' });
    res.end('{"Browser":"fake"}');
  });
  await new Promise((r) => cdp.listen(0, '127.0.0.1', r));

  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('MRWEIRDO_') || k.startsWith('MRW_TEST_')) delete env[k];
  Object.assign(env, {
    MRWEIRDO_HOME: home,
    MRWEIRDO_REPO_ROOT: repo,
    MRWEIRDO_APPLY_PACE_MIN_MS: '0',
    MRWEIRDO_APPLY_PACE_MAX_MS: '0',
    MRWEIRDO_QUIET: '0',
    ATS_CDP_PORT: String(cdp.address().port),
    MRW_TEST_BOARD: join(base, 'board.json'),
    MRW_TEST_EXPIRED: join(base, 'expired.json'),
    MRW_TEST_DISCOVER_LOG: join(base, 'discover.log'),
    MRW_TEST_DRIVER_LOG: join(base, 'driver_calls.log'),
    MRW_TEST_DRIVER_SCRIPT: join(base, 'driver_script.json'),
    MRW_TEST_STEP_LOG: join(base, 'steps.log'),
  });
  writeFileSync(env.MRW_TEST_DRIVER_SCRIPT, '{}');
  writeFileSync(env.MRW_TEST_EXPIRED, '[]');
  writeFileSync(env.MRW_TEST_BOARD, '{}');

  const lines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : []);
  const rig = {
    base,
    home,
    env,
    close: () => new Promise((r) => cdp.close(r)),
    board(b) { writeFileSync(env.MRW_TEST_BOARD, JSON.stringify(b)); },
    script(map) { writeFileSync(env.MRW_TEST_DRIVER_SCRIPT, JSON.stringify(map)); },
    expire(urls) { writeFileSync(env.MRW_TEST_EXPIRED, JSON.stringify(urls)); },
    driverCalls: () => lines(env.MRW_TEST_DRIVER_LOG),
    discoverCalls: () => lines(env.MRW_TEST_DISCOVER_LOG).map((l) => JSON.parse(l)),
    // One CLI step. Async so the fake CDP server in this process can answer.
    step(args) {
      return new Promise((resolve) => {
        const child = spawn(process.execPath, [join(REAL_SHARED, 'stream_run.mjs'), ...args], { cwd: ROOT, env });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });
        child.on('close', (status) => {
          let json = null;
          try { json = JSON.parse(stdout); } catch { json = null; }
          resolve({ status, stdout, stderr, json });
        });
      });
    },
    // A whole run the way the main agent drives it: start → (next → score →
    // submit-scores)* → finish. The scorer counts every job it is shown.
    async run(target, { startArgs = ['--max-windows', '1'] } = {}) {
      const scored = [];
      const start = await rig.step(['start', '--target', String(target), ...startArgs]);
      assert.equal(start.status, 0, start.stderr);
      const runId = start.json.run_id;
      const batches = [];
      for (;;) {
        const next = await rig.step(['next', '--run', runId]);
        assert.equal(next.status, 0, next.stderr);
        if (next.json.action === 'done') {
          batches.push({ done: next.json.reason });
          break;
        }
        const batch = JSON.parse(readFileSync(next.json.batch_file, 'utf8'));
        scored.push(...batch.map((j) => j.apply_url));
        writeFileSync(next.json.scored_file, JSON.stringify(batch.map(fakeScore)));
        const sub = await rig.step(['submit-scores', '--run', runId, '--batch', String(next.json.batch), '--scored', next.json.scored_file]);
        assert.equal(sub.status, 0, sub.stderr);
        batches.push(sub.json);
      }
      const finish = await rig.step(['finish', '--run', runId]);
      assert.equal(finish.status, 0, finish.stderr);
      return { start: start.json, batches, finish: finish.json, scored, runId };
    },
  };
  return rig;
}

function fakeScore(j) {
  const v = j.fit ? 8 : 2;
  return {
    apply_url: j.apply_url,
    fit_score: v,
    recommended: j.fit === true,
    role_type_match: 'intern',
    legitimacy: 'high',
    dim_scores: { role_fit: v, skills_match: v, location_fit: 9, visa_compatible: 5, seniority_match: 9, exclude_check: 10 },
    key_alignment: ['x'],
    key_gaps: ['y'],
    honest_reason: 'fake scorer',
  };
}
