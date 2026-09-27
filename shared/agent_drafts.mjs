#!/usr/bin/env node
// agent_drafts.mjs — the main agent's drafted answers to ONE job's open-text
// questions, handed to the driver on the next run (真投 2026-09-27: ElevenLabs
// asked "Look at our social accounts … what is working and what is not" — no
// profile field answers that, and the old hint "type it into the kept-open tab,
// then re-run the driver" lost the text, because a re-run opens a new tab).
//
// Flow: driver pends the question (note agent_draft_required / no_bucket_for:…)
// → gap report files it under agent_open_text ("do not ask the user first") →
// the main agent drafts it under shared/references/truthfulness.md and stores
// it here → this file is part of the fill basis (seen_log.fillBasisVersion), so
// the stuck row comes back next run → the driver types the draft verbatim.
//
// Keyed by job fingerprint + the question text (whitespace/case-insensitive):
// a draft answers only its own question on its own job. Private state: 600.
//
//   node shared/agent_drafts.mjs add --url <apply_url> --question "<exact form label>" --answer "<draft>"
//   node shared/agent_drafts.mjs list
import './safe_exit.mjs'; // first: no exit-time SIGSEGV with system CAs on (preload_system_ca.mjs)
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atsHome } from './paths.mjs';
import { jobFingerprint } from './job_identity.mjs';
import { lockFile } from './state_file_lock.mjs';

export const DRAFTS_FILE = 'agent_drafts.json';

const normQuestion = (q) => String(q ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

function fpOf(url) {
  const f = jobFingerprint(url);
  if (!f) throw new Error(`agent_drafts: "${url}" is not a job link this tool recognizes`);
  return f.fp;
}

export function readDrafts(home) {
  const path = join(home, DRAFTS_FILE);
  if (!existsSync(path)) return { drafts: [] };
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  if (!doc || !Array.isArray(doc.drafts)) throw new Error(`agent_drafts: ${path} has no "drafts" list`);
  return doc;
}

export function addDraft(home, { url, question, answer, now = new Date() }) {
  if (!String(question ?? '').trim()) throw new Error('agent_drafts: --question is required (the exact form label)');
  if (!String(answer ?? '').trim()) throw new Error('agent_drafts: --answer is required and may not be blank');
  const fp = fpOf(url);
  const doc = readDrafts(home);
  const key = normQuestion(question);
  const entry = { fp, apply_url: url, question: String(question).trim(), answer: String(answer).trim(), drafted_at: now.toISOString() };
  doc.drafts = [...doc.drafts.filter((d) => !(d.fp === fp && normQuestion(d.question) === key)), entry];
  const path = join(home, DRAFTS_FILE);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  lockFile(path);
  return entry;
}

// The draft for THIS job's THIS question, or null.
export function draftFor(doc, url, question) {
  const f = jobFingerprint(url);
  if (!f) return null;
  const key = normQuestion(question);
  const hit = (doc?.drafts || []).find((d) => d.fp === f.fp && normQuestion(d.question) === key);
  return hit ? hit.answer : null;
}

function cli(argv) {
  const value = (name) => {
    const i = argv.indexOf(name);
    const v = i >= 0 ? argv[i + 1] : undefined;
    return v === undefined || v.startsWith('--') ? null : v;
  };
  const home = atsHome();
  if (argv[0] === 'add') {
    const entry = addDraft(home, { url: value('--url'), question: value('--question'), answer: value('--answer') });
    console.log(JSON.stringify({ ok: true, fp: entry.fp, question: entry.question, chars: entry.answer.length }));
    return 0;
  }
  if (argv[0] === 'list') {
    console.log(JSON.stringify(readDrafts(home), null, 2));
    return 0;
  }
  console.error('usage: node shared/agent_drafts.mjs add --url <apply_url> --question "<form label>" --answer "<draft>"');
  console.error('       node shared/agent_drafts.mjs list');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exit(cli(process.argv.slice(2)));
  } catch (e) {
    console.error(`[agent_drafts] ${e.message}`);
    process.exit(1);
  }
}
