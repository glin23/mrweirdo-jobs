// Loads the REAL Lever driver for tests — not a re-implementation of it.
// Sibling of test/ashby_driver_harness.mjs / test/greenhouse_driver_harness.mjs,
// same rules and same reasons（照建，阶段 1 设计 §14.10 提交 4 的驱动替身测试）.
//
// lever_apply_driver.mjs is a CLI entry point whose last line is
// `emitOutcome(await main());`. The harness strips ONLY that final emission and
// exports main — main() RETURNS the outcome object by design, so tests assert
// the returned contract object directly and validate it through the real
// validateOutcome. Only the browser boundary (cdp / evalInTab) is stubbed.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = join(ROOT, 'shared');
const DRIVER_SRC = readFileSync(join(SHARED, 'lever_apply_driver.mjs'), 'utf8');

const BROWSER_FNS = ['cdp', 'evalInTab'];

const STUBS = `
// ---- test harness: browser boundary only ----------------------------------
function cdp(...args) {
  (globalThis.__MRW_CDP ||= []).push(args);
  for (const r of (globalThis.__MRW_CDP_RULES || [])) {
    if (args.some((a) => typeof a === 'string' && a.includes(r.match))) {
      return typeof r.result === 'function' ? r.result(args) : r.result;
    }
  }
  if (args[0] === 'goto') return { code: 0, stdout: '{"id":"tab-under-test"}', stderr: '' };
  return { code: 0, stdout: '{"ok":true}', stderr: '' };
}
async function evalInTab(tab, js) {
  for (const r of (globalThis.__MRW_EVAL_RULES || [])) {
    if (js.includes(r.match)) return typeof r.result === 'function' ? r.result(js) : r.result;
  }
  return { ok: false };
}
export { main };
`;

let seq = 0;

// Loads the shipped driver against `profile` in a throwaway fake home. No
// ~/.mrweirdo-jobs access, no browser, no network. Returns { driver, home }.
export async function loadDriver(profile, { resume = true } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'mrw-lever-driver-'));
  writeFileSync(join(home, 'profile.json'), JSON.stringify(profile, null, 2));
  if (resume) writeFileSync(join(home, 'resume.pdf'), '%PDF-fake');
  const EMIT_TAIL = 'emitOutcome(await main());';
  assert.ok(DRIVER_SRC.includes(EMIT_TAIL), 'harness stale: final emitOutcome(await main()) not found in the driver');
  let src = DRIVER_SRC.replace(EMIT_TAIL, '');
  // No real waits under test (guarded: fails loudly if the declaration drifts).
  const SLEEP_DECL = 'const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));';
  assert.ok(src.includes(SLEEP_DECL), 'harness stale: sleep declaration not found in the driver');
  src = src.replace(SLEEP_DECL, 'const sleep = () => Promise.resolve();');
  for (const fn of BROWSER_FNS) {
    const decl = `function ${fn}(`;
    assert.ok(src.includes(decl), `harness stale: ${decl} not found in the driver`);
    src = src.replace(decl, `function __unused_${fn}(`);
  }
  src = src.replace(/from '\.\//g, `from '${SHARED}/`) + STUBS;
  const file = join(home, `lever_under_test_${seq++}.mjs`);
  writeFileSync(file, src);

  const prevHome = process.env.MRWEIRDO_HOME;
  const prevRepo = process.env.MRWEIRDO_REPO_ROOT;
  const prevArgv = process.argv.slice();
  process.env.MRWEIRDO_HOME = home;
  process.env.MRWEIRDO_REPO_ROOT = ROOT;
  process.argv[2] = 'https://jobs.lever.co/testco/00000000-0000-0000-0000-000000000000';
  process.argv[3] = '77';
  try {
    return { driver: await import(file), home };
  } finally {
    if (prevHome === undefined) delete process.env.MRWEIRDO_HOME; else process.env.MRWEIRDO_HOME = prevHome;
    if (prevRepo === undefined) delete process.env.MRWEIRDO_REPO_ROOT; else process.env.MRWEIRDO_REPO_ROOT = prevRepo;
    process.argv = prevArgv;
  }
}

export const BASE = {
  personal: {
    first_name: 'Test', last_name: 'User', email: 't@example.com', phone: '+1 555 0100',
    address_city: 'Boston', address_state: 'MA', address_country: 'United States',
    linkedin: 'https://linkedin.com/in/test',
  },
  education: { school: 'Babson College', major: 'Business Analytics', degree: "Bachelor's degree", graduation_date: '2027-05' },
};
