// 驱动结局行不许被 process.exit 截断（lead 追加，与 verify 第 7 轮 FLUSH 同类后果）。
// 驱动用 emitOutcome 打一行结局 JSON（带全部问答，可以很长）后立刻退出；macOS 上
// stdout 是管道时写入是异步的，退出会丢掉还没写出去的部分 → 记账人读不到结局 →
// 记成 crashed「可能已提交」。这里用真子进程 + 真管道 + 超长结局行复现。
// （Linux 上管道是同步写，旧码在 Linux CI 上本来就绿；红只在 macOS 上看得到。）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const CONTRACT = pathToFileURL(join(process.cwd(), 'shared', 'driver_contract.mjs')).href;

function fakeDriver(extraBefore = '') {
  const dir = mkdtempSync(join(tmpdir(), 'mrw-emit-'));
  // Named like a driver: the contract treats the process as one.
  const script = join(dir, 'fake_apply_driver.mjs');
  writeFileSync(script, `
import { emitOutcome } from '${CONTRACT}';
${extraBefore}
const answers = Array.from({ length: 400 }, (_, i) => ({ label: 'Why us? ' + i, value: 'x'.repeat(2000), source: 'derived', widget: 'textarea' }));
emitOutcome({ outcome: 'needs_user', reason: 'stuck_on_same_missing', missing: ['Why us?'], answers });
console.log('NOT REACHED');
`);
  return script;
}

function run(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

test('超长结局行（~900KB）+ 立即退出：父进程经管道收到完整一行，退出码照契约，之后的代码不执行', async () => {
  for (let i = 0; i < 3; i += 1) {
    const { code, out } = await run(fakeDriver());
    assert.equal(code, 2, 'needs_user → exit 2');
    const lines = out.trim().split('\n');
    assert.equal(lines.length, 1, 'nothing after emitOutcome runs');
    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(lines[0]); }, `outcome line truncated at ${Buffer.byteLength(out)} bytes`);
    assert.equal(parsed.answers.length, 400);
  }
});

test('结局前已有大段普通输出：结局行仍完整排在最后', async () => {
  const { code, out } = await run(fakeDriver("for (let i = 0; i < 200; i += 1) console.log('progress ' + 'y'.repeat(1000));"));
  assert.equal(code, 2);
  const last = out.trim().split('\n').at(-1);
  assert.doesNotThrow(() => JSON.parse(last), `outcome line truncated (stdout ${Buffer.byteLength(out)} bytes)`);
});
