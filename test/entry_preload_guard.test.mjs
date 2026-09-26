// lead 复验 a089260：submission_evidence CLI「缺参 exit 2」测试 1/3 次 actual null
// （被信号杀）——NODE_USE_SYSTEM_CA=1 下退出与后台读钥匙串证书抢 OpenSSL 的 SIGSEGV
// （见 shared/preload_system_ca.mjs）。f4a5fce 只在 12 个入口引了 safe_exit；被人、
// 说明书或测试直接 `node <file>` 起的其他入口没有预加载，也没有上游注入的 NODE_OPTIONS。
// 全覆盖：凡可直接执行的入口（首行 shebang，或有 main 守卫）都必须直接引 safe_exit；
// 本守卫扫描全部入口，漏装即红，防以后新增入口再漏。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAFE_EXIT = join(ROOT, 'shared', 'safe_exit.mjs');
const EXEMPT = new Set(['shared/safe_exit.mjs', 'shared/preload_system_ca.mjs']);

function mjsUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...mjsUnder(p));
    else if (/\.m?js$/.test(name)) out.push(p);
  }
  return out;
}

// An entry = a file meant to be run as `node <file>`: a shebang, or a main guard.
const isEntry = (src) => src.startsWith('#!') || /process\.argv\[1\]|import\.meta\.main/.test(src);

// The npx launcher is published alone (package.json files: bin/, setup.sh), so
// it reads the store inline instead of importing shared/.
const INLINE_OK = new Set(['bin/mrweirdo-jobs.mjs']);

// Imports shared/safe_exit.mjs directly (by relative path, resolved).
function importsSafeExit(file, src) {
  if (INLINE_OK.has(relative(ROOT, file))) return /tls\.getCACertificates\('system'\)/.test(src);
  const specs = [...src.matchAll(/^import\s+(?:[^'"]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]*safe_exit\.mjs)['"]/gm)].map((m) => m[1]);
  return specs.some((s) => resolve(dirname(file), s) === SAFE_EXIT);
}

function entriesMissingPreload() {
  const files = ['shared', 'scripts', 'bin'].flatMap((d) => mjsUnder(join(ROOT, d)));
  const entries = files.filter((f) => !EXEMPT.has(relative(ROOT, f)) && isEntry(readFileSync(f, 'utf8')));
  return { entries, missing: entries.filter((f) => !importsSafeExit(f, readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f)) };
}

test('守卫：shared / scripts / bin 下每个可直接 node 执行的入口都直接引 shared/safe_exit.mjs', () => {
  const { entries, missing } = entriesMissingPreload();
  assert.ok(entries.length >= 60, `entry scan found only ${entries.length} files — the scan itself is broken`);
  assert.deepEqual(missing, [], `entries without the system-CA preload (add \`import '<rel>/safe_exit.mjs';\` as the first import): ${missing.join(', ')}`);
});

test('守卫自检：没引 safe_exit 的入口会被判出来', () => {
  const src = "#!/usr/bin/env node\nimport { x } from './y.mjs';\n";
  assert.equal(isEntry(src), true);
  assert.equal(importsSafeExit(join(ROOT, 'shared', 'z.mjs'), src), false);
  assert.equal(importsSafeExit(join(ROOT, 'shared', 'sourcing', 'z.mjs'), "import '../safe_exit.mjs';\n"), true);
  assert.equal(importsSafeExit(join(ROOT, 'scripts', 'z.mjs'), "import '../shared/safe_exit.mjs';\n"), true);
  assert.equal(importsSafeExit(join(ROOT, 'scripts', 'z.mjs'), "import './safe_exit.mjs';\n"), false, 'must resolve to shared/safe_exit.mjs');
});

test('NODE_USE_SYSTEM_CA=1：submission_evidence CLI 缺参 ×200（8 路并发）每次都是 exit 2，无 SIGSEGV', async () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-entry-preload-'));
  const env = { ...process.env, MRWEIRDO_HOME: home, NODE_USE_SYSTEM_CA: '1' };
  delete env.NODE_OPTIONS; // exactly how a user's shell or the test runner starts it: nothing injected upstream
  const codes = {};
  let next = 0;
  const worker = async () => {
    while (next < 200) {
      next += 1;
      const r = await new Promise((res) => {
        const c = spawn(process.execPath, ['shared/submission_evidence.mjs', '--tab', 'x'], { cwd: ROOT, env, stdio: 'ignore' });
        c.on('close', (code, signal) => res(signal || code));
      });
      codes[r] = (codes[r] || 0) + 1;
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  assert.deepEqual(codes, { 2: 200 });
});
