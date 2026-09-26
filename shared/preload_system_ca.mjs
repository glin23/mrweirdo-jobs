// preload_system_ca.mjs — read the system CA store to the end at process start.
//
// With NODE_USE_SYSTEM_CA=1 (set in the user's shell) Node 24 on macOS reads
// the Keychain root certificates on a background thread at startup. A process
// that ends before that thread is done — process.exit, an uncaught exception,
// even a fast success — races exit-time OpenSSL cleanup and sometimes dies of
// SIGSEGV, losing its exit code (crash stack: ReadMacOSKeychainCertificates →
// libcrypto). Reading the store synchronously here, first thing, means no exit
// can overlap it. ~50 ms, and only when system CAs are on.
//
// Loaded two ways: imported by shared/safe_exit.mjs (our entry points), and
// preloaded into every node child they start (NODE_OPTIONS=--import, set by
// safe_exit), so child processes that import nothing of ours are covered too.
// No other imports: it must be safe to preload into any node process.

import tls from 'node:tls';

export const systemCaOn = () => /^(1|true)$/i.test(process.env.NODE_USE_SYSTEM_CA ?? '') || process.execArgv.includes('--use-system-ca');

if (systemCaOn() && typeof tls.getCACertificates === 'function') {
  try {
    tls.getCACertificates('system');
  } catch (e) {
    // The store could not be read: nothing to race any more; say it and go on.
    process.stderr.write(`[preload-system-ca] reading system CA certificates failed: ${e.message}\n`);
  }
}
