#!/usr/bin/env node
// retire_jobs_db.mjs — jobs.db 退役搬归档（restart-apply ADR-S4，只搬不删）.
//
// After the history is in the ledger (backfill-legacy --apply) and the count
// check holds, the old job DB is MOVED — byte for byte, every row kept — to
// ~/.mrweirdo-jobs/archive/jobs-legacy-<local date>.db. From then on no run
// reads or writes it; stream runs use a one-off work DB each.
//
//   node shared/retire_jobs_db.mjs            # dry-run: count check + where it would go
//   node shared/retire_jobs_db.mjs --apply    # move it
//
// Refuses (nothing moved) when: the ledger does not hold the history yet; the
// archive target exists (never overwrite an archive); a batch lock or an
// in-flight marker says something may still be writing to the DB. SQLite side
// files (-wal / -shm / -journal) move with it under the same new name.

import { chmodSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { atsHome } from './paths.mjs';
import { legacyCountCheck } from './submission_ledger.mjs';
import { localDay } from './apply_guard.mjs';
import { lockDir } from './state_file_lock.mjs';

const SIDE_FILES = ['-wal', '-shm', '-journal'];

function die(message) {
  console.error(`[retire-jobs-db] ${message}`);
  process.exit(1);
}

const apply = process.argv.includes('--apply');
const home = atsHome();
// The legacy DB is the DEFAULT one — a run's work DB is never retired here.
const from = join(home, 'jobs.db');
const archiveDir = join(home, 'archive');
const to = join(archiveDir, `jobs-legacy-${localDay(new Date())}.db`);

if (!existsSync(from)) die(`${from} not found — nothing to retire (already archived?)`);
for (const name of ['apply_batch.lock', 'inflight.json']) {
  const p = join(home, 'locks', name);
  if (existsSync(p)) die(`${p} exists — a batch may still be writing to the DB, or an attempt is unrecorded; finish or recover it first`);
}
if (existsSync(to)) die(`${to} already exists — refusing to overwrite an archive; move it aside by hand if it is stale`);

const db = new DatabaseSync(from, { readOnly: true });
let check;
try {
  check = legacyCountCheck(home, db);
} finally {
  db.close();
}
const sideFiles = SIDE_FILES.map((suffix) => `${from}${suffix}`).filter((p) => existsSync(p));
const plan = { applied: false, from, to, side_files: sideFiles, bytes: statSync(from).size, count_check: check };
if (!check.ok) {
  console.log(JSON.stringify(plan, null, 2));
  die(`count check failed (${check.submitted_in_db} 已投 in the DB vs ${check.legacy_unverified_in_ledger} legacy lines in the ledger) — run \`node shared/submission_ledger.mjs backfill-legacy\` (dry-run), then --apply, before retiring the DB`);
}
if (!apply) {
  console.log(JSON.stringify(plan, null, 2));
  console.error(`[retire-jobs-db] dry-run: would move ${from} → ${to}; re-run with --apply`);
  process.exit(0);
}

mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
lockDir(archiveDir);
renameSync(from, to);
chmodSync(to, 0o600);
for (const p of sideFiles) {
  const dest = `${to}${p.slice(from.length)}`;
  renameSync(p, dest);
  chmodSync(dest, 0o600);
}
if (existsSync(from) || statSync(to).size !== plan.bytes) die(`move did not complete as expected: ${from} → ${to} — check both paths by hand`);
console.log(JSON.stringify({ ...plan, applied: true }, null, 2));
