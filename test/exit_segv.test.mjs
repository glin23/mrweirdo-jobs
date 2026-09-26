// macOS + Node 24 + NODE_USE_SYSTEM_CA=1（拍板人的 shell 就这么设）：Node 启动时在后台
// 线程里从钥匙串读系统根证书；进程在这条线程读完之前调用 process.exit，退出清理和它
// 抢 OpenSSL，偶发 SIGSEGV（崩溃报告栈：ReadMacOSKeychainCertificates → libcrypto）。
// 退出码随之变成 null——记账人明明记完了账，apply_batch 却当它失败、停批并留下在途
// 标记，下次开跑再补记一条「可能已提交」，把没投成的岗永久封掉。实测负载下 bare
// process.exit 约 4-8% 崩；先把系统证书读完再退出 0/800。
// 这里并发起 200 个短命进程走真实出口（emitOutcome、记账人同款 process.exit），统计崩溃数。
// Linux 不从钥匙串读证书，没有这条竞态，旧码在 Linux 上也绿。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const shared = (f) => pathToFileURL(join(process.cwd(), 'shared', f)).href;

async function crashes(script, runs = 200, parallel = 8) {
  const env = { ...process.env, NODE_USE_SYSTEM_CA: '1' };
  let next = 0;
  const bad = [];
  const worker = async () => {
    while (next < runs) {
      next += 1;
      const r = await new Promise((resolve) => {
        const c = spawn(process.execPath, [script], { env, stdio: ['ignore', 'ignore', 'ignore'] });
        c.on('close', (code, signal) => resolve({ code, signal }));
      });
      if (r.code !== 2) bad.push(r);
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  return bad;
}

test('驱动出口 emitOutcome：系统证书开着时，200 个短命进程退出码全部是契约值，无 SIGSEGV', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mrw-segv-'));
  const script = join(dir, 'fake_apply_driver.mjs');
  writeFileSync(script, `import { emitOutcome } from '${shared('driver_contract.mjs')}';\nemitOutcome({ outcome: 'needs_user', reason: 'stuck_on_same_missing', missing: ['x'] });\n`);
  const bad = await crashes(script);
  assert.deepEqual(bad, [], `${bad.length}/200 exits lost their code`);
});

test('其他 CLI 的 process.exit（记账人同款）：装了安全退出后同样无 SIGSEGV', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mrw-segv-cli-'));
  const script = join(dir, 'cli.mjs');
  writeFileSync(script, `import { installSafeExit } from '${shared('safe_exit.mjs')}';\ninstallSafeExit();\nprocess.exit(2);\n`);
  const bad = await crashes(script);
  assert.deepEqual(bad, [], `${bad.length}/200 exits lost their code`);
});
