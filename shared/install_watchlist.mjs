#!/usr/bin/env node
// install_watchlist.mjs — put the preset AI-video company list into the user's
// search_intent.target_companies (restart-apply S5 / 名单优先).
//
// The preset (sourcing/data/watchlist_ai_video.json) is never used on its own:
// scanning a list the user did not agree to would spend his two-per-60-days
// chances at companies he may not want. The onboarding step shows the list,
// the user says yes, and only then this runs with --apply.
//
//   node shared/install_watchlist.mjs            # dry-run: what would be added
//   node shared/install_watchlist.mjs --apply    # write it
//   … --mode watchlist_only  [--apply]           # also: runs scan the list ONLY
//   … --mode watchlist_first [--apply]           # also: list first, then rotation
//
// --mode sets search_intent.sourcing_mode (关卡 3，拍板人 2026-09-26「只投递 AI
// 视频创业公司相关岗位」); without --mode the switch is left as it is.
//
// Merge, never replace: the user's own entries stay (first), preset entries
// already there (same ats + slug) are not added twice. Note: search_intent is
// part of the scoring basis, so the next run re-judges earlier「不合适」once.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atsHome } from './paths.mjs';
import { lockFile } from './state_file_lock.mjs';
import './safe_exit.mjs'; // no exit-time SIGSEGV here or in our node children (see preload_system_ca.mjs)

const MODES = ['watchlist_first', 'watchlist_only'];
const PRESET_PATH = join(dirname(fileURLToPath(import.meta.url)), 'sourcing', 'data', 'watchlist_ai_video.json');

export function planInstall(intentDoc, preset) {
  const current = intentDoc.search_intent?.target_companies ?? [];
  const key = (t) => `${t.ats}:${String(t.slug).toLowerCase()}`;
  const have = new Set(current.map(key));
  const add = preset.filter((t) => !have.has(key(t)));
  return { current, add };
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const apply = process.argv.includes('--apply');
  const modeAt = process.argv.indexOf('--mode');
  const mode = modeAt >= 0 ? process.argv[modeAt + 1] : null;
  if (modeAt >= 0 && !MODES.includes(mode)) {
    console.error(`[install-watchlist] --mode ${mode}: must be one of ${MODES.join(' | ')}`);
    process.exit(1);
  }
  const intentPath = join(atsHome(), 'search_intent.json');
  if (!existsSync(intentPath)) {
    console.error(`[install-watchlist] ${intentPath} does not exist — finish onboarding (Step 2 writes it) before adding the company list`);
    process.exit(1);
  }
  const doc = JSON.parse(readFileSync(intentPath, 'utf8'));
  if (!doc.search_intent || typeof doc.search_intent !== 'object') {
    console.error(`[install-watchlist] ${intentPath} has no search_intent object — fix the file first`);
    process.exit(1);
  }
  const preset = JSON.parse(readFileSync(PRESET_PATH, 'utf8')).target_companies;
  const { current, add } = planInstall(doc, preset);
  const modeBefore = doc.search_intent.sourcing_mode ?? null;
  const modeAfter = mode ?? modeBefore;
  if (apply && (add.length > 0 || modeAfter !== modeBefore)) {
    doc.search_intent.target_companies = [...current, ...add];
    if (mode) doc.search_intent.sourcing_mode = mode;
    const tmp = `${intentPath}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, intentPath);
  }
  if (apply) lockFile(intentPath);
  console.log(JSON.stringify({
    applied: apply,
    add: add.map((t) => `${t.label ?? t.slug} (${t.ats}:${t.slug})`),
    already: current.length,
    total_after: current.length + add.length,
    sourcing_mode_before: modeBefore,
    sourcing_mode_after: modeAfter,
  }, null, 2));
  if (!apply) console.error(`[install-watchlist] dry-run: would add ${add.length} companies${modeAfter !== modeBefore ? ` and set sourcing_mode ${modeAfter}` : ''}; re-run with --apply after the user agrees`);
}
