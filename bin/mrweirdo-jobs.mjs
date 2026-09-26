#!/usr/bin/env node

import { spawn } from 'node:child_process';
import tls from 'node:tls';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The npm package ships bin/ and setup.sh only (no shared/), so this launcher
// cannot import shared/safe_exit.mjs: it does the same read inline — the
// system CA store read to the end first, so no exit can race it (SIGSEGV,
// see shared/preload_system_ca.mjs).
if (/^(1|true)$/i.test(process.env.NODE_USE_SYSTEM_CA ?? '') && typeof tls.getCACertificates === 'function') tls.getCACertificates('system');

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const setupPath = resolve(packageRoot, 'setup.sh');
const args = process.argv.slice(2);

if (!existsSync(setupPath)) {
  console.error('Mr. Weirdo Jobs installer is missing setup.sh.');
  console.error('Try the fallback installer:');
  console.error('  bash <(curl -fsSL https://raw.githubusercontent.com/glin23/mrweirdo-jobs/main/setup.sh)');
  process.exit(1);
}

const child = spawn('bash', [setupPath, ...args], {
  cwd: packageRoot,
  env: process.env,
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(`Could not start bash: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Installer stopped by signal ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
