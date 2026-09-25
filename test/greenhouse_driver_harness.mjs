// Loads the REAL Greenhouse driver for tests — not a re-implementation of it.
//
// Why a harness: greenhouse_apply_driver.mjs is a CLI entry point (it reads
// profile.json and argv at import time and calls main() at the bottom), so it
// cannot simply be imported. The harness takes the shipped source verbatim,
// strips ONLY the `main().catch(...)` invocation, and renames the six functions
// that touch the browser (findFieldByLabel / reactSelect / reactSelectOneOf /
// selectNativeOneOf / cdp / evalInTab) so stubs can take their place. Every
// decision under test — label routing, the three-state work-auth branches, the
// location/relocation branches, the blocking guards — is the driver's own code,
// byte for byte.
//
// Extracted from test/greenhouse_work_auth_driver.test.mjs on 2026-07-26 so the
// relocation guard could drive the same shipped code. A second copy of this
// harness would go stale silently the first time the driver's browser boundary
// changed, and only one of the two copies would notice.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = join(ROOT, 'shared');
const DRIVER_SRC = readFileSync(join(SHARED, 'greenhouse_apply_driver.mjs'), 'utf8');

// The only functions the harness replaces: the browser boundary.
const BROWSER_FNS = ['findFieldByLabel', 'reactSelectOneOf', 'reactSelect', 'selectNativeOneOf', 'cdp', 'evalInTab'];

const STUBS = `
// ---- test harness: browser boundary only ----------------------------------
async function findFieldByLabel(tab, labelText) {
  // Greenhouse renders these custom questions as react-select comboboxes, which
  // stays the default. A test may ask for a different control — a plain text
  // input, which is how real forms ask for a GPA — via ask()'s third argument.
  return { ok: true, id: 'question_1', ...(globalThis.__MRW_FIELD || { type: 'select-one', is_react_select: true }) };
}
async function reactSelect(tab, id, value, opts = {}) {
  globalThis.__MRW_FILLS.push({ via: 'reactSelect', value });
  return { ok: true, picked: value };
}
async function reactSelectOneOf(tab, id, values, opts = {}) {
  globalThis.__MRW_FILLS.push({ via: 'reactSelectOneOf', value: values[0], candidates: values });
  return { ok: true, picked: values[0] };
}
async function selectNativeOneOf(tab, id, values) {
  globalThis.__MRW_FILLS.push({ via: 'selectNativeOneOf', value: values[0], candidates: values });
  return { ok: true, picked: values[0] };
}
function cdp(...args) {
  // cdp('typetext', tab, selector, value) is how the driver types into a text
  // input; recording args[3] as \`value\` keeps "what landed on the form" readable
  // the same way it is for the select stubs above.
  (globalThis.__MRW_FILLS ||= []).push({ via: 'cdp', args, value: args[0] === 'typetext' ? args[3] : undefined });
  if (args[0] === 'goto') return { stdout: '{"id":"tab-under-test"}', stderr: '' };
  return { stdout: '{"ok":true}', stderr: '' };
}
// Scriptable eval: rules match a distinctive substring of the injected JS so a
// full main() run can be driven end to end (same shape as the Ashby harness).
async function evalInTab(tab, js) {
  for (const r of (globalThis.__MRW_EVAL_RULES || [])) {
    if (js.includes(r.match)) return typeof r.result === 'function' ? r.result(js) : r.result;
  }
  return { ok: false };
}
// emitOutcome under test: validates via the real contract, records, throws
// instead of process.exit-ing.
import { validateOutcome as __validateOutcome } from '${SHARED}/driver_contract.mjs';
function emitOutcome(obj) {
  __validateOutcome(obj);
  (globalThis.__MRW_EMITTED ||= []).push(obj);
  const e = new Error('__EMIT_OUTCOME__');
  e.emitted = obj;
  throw e;
}
export { answerMissing, main, logEssayPending, ESSAY_PENDING_LOG, COMPANY };
`;

let seq = 0;

// Loads the shipped driver against `profile` in a throwaway fake home. No
// ~/.mrweirdo-jobs access, no browser, no network.
// `opts.setup(home)` runs before import (seed a ledger / DB); `opts.argv` sets
// [apply_url, job_id]; `opts.env` is applied during import only.
export async function loadDriver(profile, opts = {}) {
  const home = mkdtempSync(join(tmpdir(), 'mrw-gh-driver-'));
  writeFileSync(join(home, 'profile.json'), JSON.stringify(profile, null, 2));
  if (opts.setup) opts.setup(home);
  let src = DRIVER_SRC.replace(/\nmain\(\)\.catch\([\s\S]*$/, '\n');
  // No real waits under test (guarded like the Ashby harness).
  const SLEEP_DECL = 'const sleep = (ms) => new Promise((r) => setTimeout(r, ms));';
  assert.ok(src.includes(SLEEP_DECL), 'harness stale: sleep declaration not found in the driver');
  src = src.replace(SLEEP_DECL, 'const sleep = () => Promise.resolve();');
  for (const fn of BROWSER_FNS) {
    const decl = `function ${fn}(`;
    assert.ok(src.includes(decl), `harness stale: ${decl} not found in the driver`);
    src = src.replace(decl, `function __unused_${fn}(`);
  }
  const CONTRACT_IMPORT = "import { emitOutcome, recordFill } from";
  assert.ok(src.includes(CONTRACT_IMPORT), 'harness stale: driver_contract import not found in the driver');
  src = src.replace(CONTRACT_IMPORT, "import { emitOutcome as __shipped_emitOutcome, recordFill } from");
  src = src.replace(/from '\.\//g, `from '${SHARED}/`) + STUBS;
  const file = join(home, `driver_under_test_${seq++}.mjs`);
  writeFileSync(file, src);

  const envOverrides = { MRWEIRDO_HOME: home, MRWEIRDO_REPO_ROOT: ROOT, ...(opts.env || {}) }; // REAL shipped answer_bank.json
  const prevEnv = Object.fromEntries(Object.keys(envOverrides).map((k) => [k, process.env[k]]));
  const prevArgv = process.argv.slice();
  Object.assign(process.env, envOverrides);
  [process.argv[2], process.argv[3]] = opts.argv || ['https://job-boards.greenhouse.io/testco/jobs/1', undefined];
  if (process.argv[3] === undefined) process.argv.length = 3;
  try {
    const mod = await import(file);
    return Object.assign(Object.create(null), mod, { home });
  } finally {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    process.argv = prevArgv;
  }
}

// Asks the shipped driver one real form question. Returns its decision plus
// everything it tried to put on the form. `field` overrides the control the
// question is rendered as, e.g. { type: 'text' } for a free-text answer.
export async function ask(profile, label, field = null) {
  const { answerMissing } = await loadDriver(profile);
  globalThis.__MRW_FILLS = [];
  globalThis.__MRW_FIELD = field;
  try {
    const res = await answerMissing('tab-1', label);
    return { res, fills: globalThis.__MRW_FILLS.slice() };
  } finally {
    globalThis.__MRW_FIELD = null;
  }
}

// A minimal profile with nothing to say about work authorization or relocation.
export const BASE = {
  personal: {
    first_name: 'Test', last_name: 'User', email: 't@example.com', phone: '+1 555 0100',
    address_city: 'Boston', address_state: 'MA', address_country: 'United States',
    linkedin: 'https://linkedin.com/in/test',
  },
  education: { school: 'Babson College', major: 'Business Analytics', degree: "Bachelor's degree", graduation_date: '2027-05' },
};
