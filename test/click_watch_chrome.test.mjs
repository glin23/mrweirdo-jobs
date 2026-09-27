// verify 第 19 轮 P2 ①（在途请求沙箱复现）：提交请求已经发出、服务端已收到，但 25 秒才回复。
// 浏览器的资源时间表只记走完的请求，旧判断 clickReceived 在 7 / 19 秒都答「没接住」→ 驱动再点
// = 重复投递。新做法：驱动侧用 CDP Network 事件（requestWillBeSent：请求一发出就看得到，页面
// 感知不到，不改页面里的任何东西）在点击的同一个会话里看。
//
// 真 Chrome、真 cdp.mjs、独立用户目录和端口（不碰 9222 / 真实 profile）。本机没有 Chrome 时跳过
// （CI 的 ubuntu 机器上没有），判断逻辑另有替身测试（submit_click_received.test.mjs）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clickReceived, clickVerdict, pageCall } from '../shared/page_signals.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => existsSync(p));

const PAGE = `<!doctype html><html><body><button id="b">Submit Application</button>
<script>document.getElementById('b').addEventListener('click', () => { fetch('/submit', { method: 'POST', body: 'x' }); });</script>
</body></html>`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

test('在途提交请求：旧判断说「没接住」，clickwatch 看得到 → 判接住、不再点', { skip: !CHROME && 'no local Chrome' }, async () => {
  let submits = 0;
  const pending = [];
  const server = createServer((req, res) => {
    if (req.url === '/submit') {
      submits += 1;
      pending.push(res); // held open: the submission is in flight for the whole test
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const site = `http://127.0.0.1:${server.address().port}/`;
  const port = await freePort();
  const profile = mkdtempSync(join(tmpdir(), 'mrw-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  const env = { ...process.env, CDP_HOST: `127.0.0.1:${port}`, MRWEIRDO_HOME: profile };
  const cdp = (...args) => spawnSync(process.execPath, [join(ROOT, 'shared/cdp.mjs'), ...args], { env, encoding: 'utf8' });
  try {
    let tab = null;
    for (let i = 0; i < 50 && !tab; i += 1) {
      await sleep(200);
      const r = cdp('goto', site);
      if (r.status === 0) tab = JSON.parse(r.stdout).id;
    }
    assert.ok(tab, 'headless Chrome did not come up');
    await sleep(1000);

    // The shipped click (same shape as the driver's) through clickwatch.
    const clickJs = `(() => { const btn = [...document.querySelectorAll("button")].find(b => /submit/i.test(b.innerText)); if (!btn) return { ok: false, note: 'no_submit_btn' }; const mark = { t: performance.now(), origin: performance.timeOrigin }; btn.click(); return { ok: true, mark }; })()`;
    const w = cdp('clickwatch', tab, '5000', clickJs);
    assert.equal(w.status, 0, w.stderr);
    const out = JSON.parse(w.stdout);
    assert.equal(out.click.ok, true);
    assert.equal(out.watch.ok, true);
    await sleep(1500);
    assert.equal(submits, 1, 'the server has the submission');

    // The old signal, asked while the request is still in flight: "not received".
    const old = JSON.parse(cdp('eval', tab, pageCall(clickReceived, out.click.mark)).stdout);
    assert.equal(old.registered, false, 'reproduces verify 第 19 轮 #1 (in-flight request is invisible to Resource Timing)');

    // The new decision sees the request that was sent.
    assert.ok(out.watch.requests.some((r) => /\/submit$/.test(r.url)), JSON.stringify(out.watch));
    assert.equal(clickVerdict(out.watch, old).registered, true);
  } finally {
    for (const res of pending) res.destroy();
    chrome.kill('SIGKILL');
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  }
});

// verify 第 20 轮 P2：观察窗口内 CDP 连接断了，旧 clickwatch 仍报「正常、0 条请求」。
// 断开 / 出错必须报「判不出」（watch.ok !== true），绝不能是「看过了、0 条」。
const QUIET_PAGE = '<!doctype html><html><body><button id="b">Submit Application</button></body></html>';

test('clickwatch：窗口内 Chrome 断开 → 判不出，不许报 ok + 0 条请求', { skip: !CHROME && 'no local Chrome' }, async () => {
  const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(QUIET_PAGE); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const site = `http://127.0.0.1:${server.address().port}/`;
  const port = await freePort();
  const profile = mkdtempSync(join(tmpdir(), 'mrw-chrome-cut-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  const env = { ...process.env, CDP_HOST: `127.0.0.1:${port}`, MRWEIRDO_HOME: profile };
  const cdpSync = (...args) => spawnSync(process.execPath, [join(ROOT, 'shared/cdp.mjs'), ...args], { env, encoding: 'utf8' });
  try {
    let tab = null;
    for (let i = 0; i < 50 && !tab; i += 1) {
      await sleep(200);
      const r = cdpSync('goto', site);
      if (r.status === 0) tab = JSON.parse(r.stdout).id;
    }
    assert.ok(tab, 'headless Chrome did not come up');
    await sleep(1000);
    const clickJs = `(() => { const btn = document.querySelector('#b'); const mark = { t: performance.now(), origin: performance.timeOrigin }; btn.click(); return { ok: true, mark }; })()`;
    const child = spawn(process.execPath, [join(ROOT, 'shared/cdp.mjs'), 'clickwatch', tab, '6000', clickJs], { env });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    const done = new Promise((r) => child.on('close', (code) => r(code)));
    await sleep(1500); // the click has happened; the watch is waiting (no request on this page)
    chrome.kill('SIGKILL'); // the connection drops inside the window
    const code = await done;
    const out = stdout.trim() ? JSON.parse(stdout) : null;
    assert.ok(code !== 0 || out?.watch?.ok !== true, `a dropped connection was reported as a clean watch: exit ${code} ${stdout}`);
  } finally {
    chrome.kill('SIGKILL');
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  }
});
