// safe_exit.mjs — process.exit that cannot crash on macOS with system CAs on.
//
// With NODE_USE_SYSTEM_CA=1 (set in the user's shell) Node 24 reads the macOS
// Keychain root certificates on a background thread at startup. A process that
// calls process.exit before that thread is done races exit-time OpenSSL
// cleanup and sometimes dies with SIGSEGV (crash report stack:
// ReadMacOSKeychainCertificates → libcrypto). Its exit code is then lost — the
// recorder that DID write the ledger looks failed, the batch stops, and the
// next start records the same job again as "may have submitted" (lead 复验
// d341de7). Measured under load: bare process.exit 33/800 crashed; reading the
// system store to the end first (tls.getCACertificates('system'), ~50 ms,
// only when system CAs are on) 0/800.
//
// installSafeExit() wraps process.exit once for the whole process, so every
// existing exit path (die(), usage errors, emitOutcome) is covered without
// touching each call site.

import tls from 'node:tls';

const systemCaOn = () => /^(1|true)$/i.test(process.env.NODE_USE_SYSTEM_CA ?? '') || process.execArgv.includes('--use-system-ca');

export function settleSystemCa() {
  if (!systemCaOn() || typeof tls.getCACertificates !== 'function') return;
  try {
    tls.getCACertificates('system');
  } catch (e) {
    // We are about to exit anyway; say it and let the exit go ahead.
    process.stderr.write(`[safe-exit] reading system CA certificates failed: ${e.message}\n`);
  }
}

let installed = false;
export function installSafeExit() {
  if (installed) return;
  installed = true;
  const exit = process.exit.bind(process);
  process.exit = (code) => {
    settleSystemCa();
    return exit(code);
  };
}
