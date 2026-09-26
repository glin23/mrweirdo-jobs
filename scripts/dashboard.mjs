#!/usr/bin/env node
// dashboard.mjs — live terminal dashboard for mrweirdo-jobs.
//
// Reads the submission ledger (~/.mrweirdo-jobs/log/submissions.jsonl) every
// REFRESH_MS and rewrites the screen with ANSI escapes — no external deps
// beyond Node 24 builtins. jobs.db is retired history (restart-apply ADR-S4):
// no number here comes from it.
//
// Usage:
//   node scripts/dashboard.mjs            # default refresh = 1500ms
//   node scripts/dashboard.mjs --refresh 500
//   node scripts/dashboard.mjs --once     # print one snapshot and exit
//
// What it shows (two different names on purpose, ADR-S6):
//   - Header: 今日已尝试 N / 档位 (attempts that may have reached a company
//     today, against MRWEIRDO_DAILY_TIER) · 已投 N (page-confirmed, migrated
//     history and hand-made applications) · last attempt elapsed time.
//   - "最近 / Recent": the last 10 ledger lines, newest first.
//
// Optional "now applying" line — if `~/.mrweirdo-jobs/current.json`
// exists (written by the auto-apply skills when they start a row), the
// dashboard shows it as ⏳ ACTIVE.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { effectiveEntries, isSubmitted, ledgerPath, readAll } from '../shared/submission_ledger.mjs';
import { attemptIndex, dailyTier, isAttempted } from '../shared/apply_guard.mjs';

const HOME = process.env.MRWEIRDO_HOME || path.join(os.homedir(), '.mrweirdo-jobs');
const LEDGER = ledgerPath(HOME);
const CURRENT = path.join(HOME, 'current.json');
// Display only: the >30 confirmation is enforced where a batch starts.
const TIER = dailyTier(process.env, true);

const argv = process.argv.slice(2);
const arg = (k, def) => {
  const i = argv.findIndex((a) => a === `--${k}` || a.startsWith(`--${k}=`));
  if (i < 0) return def;
  return argv[i].includes('=') ? argv[i].split('=')[1] : argv[i + 1];
};
const REFRESH_MS = parseInt(arg('refresh', '1500'), 10);
const ONCE = argv.includes('--once');

// ANSI helpers
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m', under: '\x1b[4m',
  fg: { red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', blu: '\x1b[34m', mag: '\x1b[35m', cyn: '\x1b[36m', white: '\x1b[37m', gray: '\x1b[90m' },
  bg: { gray: '\x1b[100m', grn: '\x1b[42m', red: '\x1b[41m', yel: '\x1b[43m' },
};
const clear = () => process.stdout.write('\x1b[H\x1b[2J\x1b[3J'); // home + clear + clear scrollback
const cursorHome = () => process.stdout.write('\x1b[H');
const hideCur = () => process.stdout.write('\x1b[?25l');
const showCur = () => process.stdout.write('\x1b[?25h');

// terminal width
const COLS = process.stdout.columns || 80;
const hr = (ch = '─') => ch.repeat(Math.max(COLS - 2, 40));

function relTime(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const dt = Math.floor((Date.now() - t) / 1000);
  if (dt < 60) return `${dt}s ago`;
  if (dt < 3600) return `${Math.floor(dt / 60)}m ago`;
  if (dt < 86400) return `${Math.floor(dt / 3600)}h ago`;
  return `${Math.floor(dt / 86400)}d ago`;
}

function pad(s, n, align = 'l') {
  s = String(s ?? '');
  // crude width — assume CJK chars are width 2
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0x2e80 ? 2 : 1;
  if (w >= n) {
    // truncate by char from end
    let acc = '';
    let aw = 0;
    for (const ch of s) {
      const cw = ch.charCodeAt(0) > 0x2e80 ? 2 : 1;
      if (aw + cw > n - 1) { acc += '…'; break; }
      acc += ch; aw += cw;
    }
    return align === 'r' ? acc.padStart(n) : acc.padEnd(n);
  }
  const pad = ' '.repeat(n - w);
  return align === 'r' ? pad + s : s + pad;
}

function safeReadFile(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function statusBadge(e) {
  if (isSubmitted(e)) return `${C.fg.grn}✅${C.reset}`;
  if (isAttempted(e)) return `${C.fg.yel}? ${C.reset}`; // may have submitted: check the screenshot
  return `${C.dim}⚠ ${C.reset}`; // failed before Submit — nothing reached the company
}

function atsTag(p) {
  if (!p) return `${C.dim}?     ${C.reset}`;
  const colors = { ashby: C.fg.mag, greenhouse: C.fg.grn, lever: C.fg.cyn, workday: C.fg.yel, icims: C.fg.blu, jobvite: C.fg.red, smartrecruiters: C.fg.yel, handshake: C.fg.blu };
  const col = colors[p] || C.fg.gray;
  return `${col}${pad(p, 6)}${C.reset}`;
}

// Every number is derived from the ledger with the shared definitions:
// 今日已尝试 = attemptIndex().todayCount (isAttempted, local day), 已投 =
// isSubmitted. A second, dashboard-only definition is how numbers drift apart.
function ledgerStats(entries) {
  const effective = effectiveEntries(entries);
  const attempted = effective.filter(isAttempted).map((e) => e.ts).sort();
  return {
    attemptedToday: attemptIndex(entries).todayCount,
    submittedAll: effective.filter(isSubmitted).length,
    lastAttempt: attempted.at(-1) ?? null,
  };
}

function ledgerRecent(entries, n = 10) {
  return effectiveEntries(entries).sort((a, b) => String(b.ts).localeCompare(String(a.ts))).slice(0, n);
}

function readCurrent() {
  const raw = safeReadFile(CURRENT);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function header(s) {
  const quotaColor = s.attemptedToday >= TIER ? C.fg.red : (s.attemptedToday >= TIER * 0.8 ? C.fg.yel : C.fg.grn);
  return [
    `${C.bold}mrweirdo${C.reset} ${C.dim}│${C.reset} 今日已尝试 ${quotaColor}${s.attemptedToday}/${TIER}${C.reset} ${C.dim}│${C.reset} 已投 ${C.fg.grn}${s.submittedAll}${C.reset}`,
    `last attempt ${C.fg.grn}${relTime(s.lastAttempt)}${C.reset}  ${C.dim}refresh ${REFRESH_MS}ms · ^C quit${C.reset}`,
    `${C.dim}${hr('━')}${C.reset}`,
  ];
}

function render(entries) {
  cursorHome();
  const lines = header(ledgerStats(entries));
  const cur = readCurrent();

  // ACTIVE
  if (cur && cur.url) {
    const t = relTime(cur.started_at);
    const stage = cur.stage || 'unknown';
    lines.push(`${C.bg.gray}${C.bold} ⏳ ACTIVE ${C.reset} ${C.fg.cyn}${cur.company || '?'}${C.reset} ⚬ ${cur.title || '?'} ${C.dim}|${C.reset} ${atsTag(cur.ats)} ${C.dim}|${C.reset} stage=${C.fg.yel}${stage}${C.reset} ${C.dim}|${C.reset} ${t}`);
    lines.push('');
  }

  lines.push(`${C.bold}最近 / Recent${C.reset}  ${C.dim}(latest 10 ledger lines)${C.reset}`);
  lines.push(`${C.dim}${pad('  status', 10)} ${pad('company', 22)} ${pad('title', 28)} ${pad('ats', 7)} ${pad('time', 12)}${C.reset}`);
  for (const e of ledgerRecent(entries, 10)) {
    const extra = e.reason ? `${C.dim} ${e.reason}${C.reset}` : '';
    lines.push(`  ${statusBadge(e)}  ${pad(e.company_key, 22)} ${pad(e.title_key, 28)} ${atsTag(e.ats)} ${pad(relTime(e.ts), 12)}${extra}`);
  }

  // clear leftover lines (write enough blank lines to clear scrollback)
  const need = process.stdout.rows ? process.stdout.rows - lines.length : 8;
  for (let i = 0; i < need; i++) lines.push('\x1b[K');

  process.stdout.write(lines.join('\n') + '\n');
}

function renderEmptyState() {
  cursorHome();
  const lines = header(ledgerStats([]));
  lines.push('');
  lines.push(`  ${C.fg.yel}⏳${C.reset}  还没有任何投递记录 / No applications yet.`);
  lines.push('');
  lines.push(`  Dashboard polls ${C.bold}${LEDGER}${C.reset} every ${REFRESH_MS}ms.`);
  lines.push(`  It fills in once a run applies: in Claude Code, run ${C.fg.cyn}/mrweirdo-onboard${C.reset} and say 「跑 N 个」.`);
  // clear leftover
  const need = process.stdout.rows ? process.stdout.rows - lines.length : 8;
  for (let i = 0; i < need; i++) lines.push('\x1b[K');
  process.stdout.write(lines.join('\n') + '\n');
}

// The ledger is re-read every tick (it only grows); a corrupt line throws in
// readAll — shown, then retried next tick, never silently skipped.
function tick() {
  let entries;
  try {
    entries = readAll(HOME);
  } catch (e) {
    console.error('ledger unreadable, will retry:', e.message);
    return false;
  }
  if (entries.length === 0) renderEmptyState();
  else render(entries);
  return true;
}

if (ONCE) {
  process.exit(tick() ? 0 : 1);
}

clear();
hideCur();
process.on('SIGINT', () => { showCur(); console.log('\n\nbye.'); process.exit(0); });
process.on('exit', () => { showCur(); });

tick();
setInterval(tick, REFRESH_MS);
