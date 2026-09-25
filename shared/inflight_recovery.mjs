// inflight_recovery.mjs — 崩溃恢复（restart-apply ADR-S8）, shared by apply_batch
// (before any dispatch) and stream_run start (before anything else).
//
// A locks/inflight.json left behind means a driver may have clicked Submit and
// nobody recorded it. Record it FIRST — as the driver's own outcome if it got
// that far, else crashed/recovered_inflight (= may have submitted, never
// re-applied) — through the one ledger writer, record_apply_outcome, against
// the work DB the attempt ran in. A recording failure throws and the marker is
// kept: an unrecorded attempt must be resolved, not stepped over.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clearInflight, readInflight } from './apply_guard.mjs';
import { readAll } from './submission_ledger.mjs';
import { lockFile } from './state_file_lock.mjs';

function hasStructuredOutcome(text) {
  return text.split(/\r?\n/).some((line) => {
    const t = line.trim();
    if (!t.startsWith('{')) return false;
    try {
      return typeof JSON.parse(t).outcome === 'string';
    } catch {
      return false; // driver log noise, not an outcome line
    }
  });
}

// Returns null when there was nothing to recover, else the marker handled.
export function recoverInflight({ home, repoRoot, env, tmpDir, log = console.error }) {
  const m = readInflight(home);
  if (!m) return null;
  log(`⚠️ found an unrecorded attempt from ${m.run_id}: row ${m.row_id} ${m.apply_url} (started ${m.started_at}) — recording it before anything else`);
  const alreadyRecorded = readAll(home).some((e) => e.job_id === m.row_id && e.apply_url === m.apply_url && e.ts >= m.started_at);
  if (!alreadyRecorded) {
    const text = existsSync(m.result_file) ? readFileSync(m.result_file, 'utf8') : '';
    let resultFile = m.result_file;
    if (!hasStructuredOutcome(text)) {
      resultFile = join(tmpDir, `recovered-inflight-${m.row_id}-${Date.now()}.jsonl`);
      writeFileSync(resultFile, `${JSON.stringify({
        outcome: 'crashed',
        reason: 'recovered_inflight',
        detail: { run_id: m.run_id, started_at: m.started_at, result_file: m.result_file, result_file_present: text !== '' },
      })}\n`, { mode: 0o600 });
      lockFile(resultFile);
    }
    const rec = spawnSync(process.execPath, ['shared/record_apply_outcome.mjs', '--row-id', String(m.row_id), '--result-file', resultFile], {
      cwd: repoRoot,
      env: { ...env, MRWEIRDO_DB_PATH: m.work_db },
      encoding: 'utf8',
    });
    if (rec.stdout) process.stdout.write(rec.stdout);
    if ((rec.status ?? 1) !== 0) {
      if (rec.stderr) process.stderr.write(rec.stderr);
      throw new Error(`inflight recovery for row ${m.row_id} failed (marker kept at locks/inflight.json)`);
    }
  }
  clearInflight(home);
  return m;
}
