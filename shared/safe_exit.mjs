// safe_exit.mjs — no exit-time SIGSEGV on macOS with system CAs on, for this
// process and every node process it starts.
//
// Why: see preload_system_ca.mjs. Measured under load (verify 第 8 轮): an exit
// racing the Keychain read crashed 33/800 (process.exit) and 17-22/400
// (uncaught exception); reading the store at startup, 0 for both. The first
// version only wrapped process.exit and only in five entry points — a cover
// letter child still crashed on its successful exit(0) (19/200), and an
// uncaught exception was never covered.
//
// Importing this module (1) reads the store now, in this process, and (2) adds
// `--import <preload_system_ca.mjs>` to NODE_OPTIONS in process.env, which every
// child we spawn inherits ({...process.env} everywhere), so grandchildren are
// covered as well. Both only when system CAs are on. installSafeExit() is kept
// for the existing call sites; the import alone does the work.

import { systemCaOn } from './preload_system_ca.mjs';

const PRELOAD = `--import=${new URL('./preload_system_ca.mjs', import.meta.url).href}`;

if (systemCaOn() && !(process.env.NODE_OPTIONS ?? '').includes(PRELOAD)) {
  process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, PRELOAD].filter(Boolean).join(' ');
}

export function installSafeExit() {
  // The module's import already did everything; nothing to wrap.
}
