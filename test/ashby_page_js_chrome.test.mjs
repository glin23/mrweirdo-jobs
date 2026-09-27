// restart-apply-3：驱动注入页面的新 JS 在真 Chrome 的真 DOM 上跑一遍（替身测试只验判断逻辑）。
//   ① Reevo 形状的城市勾选题：读出选项、只勾决定好的那个、回读勾上了
//   ② 必填空框扫描：数字框 / 文本框空着被列出，填了值的不列
// 注入串取自出货驱动本身（经 harness 截下 answerMissing 发出的 JS），不是副本。
// 本机没有 Chrome 时跳过（CI 的 ubuntu 上没有）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyRequiredFields, pageCall } from '../shared/page_signals.mjs';
import { loadDriver, BASE } from './ashby_driver_harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const Q = 'This role is primarily in-office. Which location(s) would you be open to working from?';
const PAGE = `<!doctype html><html><body><form>
<div class="field"><label for="sal">What are your base salary expectations for this position?</label><input id="sal" type="number" required></div>
<div class="field"><label for="nm">Name</label><input id="nm" type="text" required value="Lee"></div>
<div class="field"><label for="li">Linkedin Profile</label><input id="li" type="text" required></div>
<fieldset><div>${Q}</div>
  <div><input type="checkbox" id="c1" name="loc"><label for="c1">San Francisco</label></div>
  <div><input type="checkbox" id="c2" name="loc"><label for="c2">Santa Clara</label></div>
  <div><input type="checkbox" id="c3" name="loc"><label for="c3">Both</label></div>
</fieldset>
<button type="button">Submit Application</button>
</form></body></html>`;

async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

test('真 DOM：城市勾选题只勾「Both」并回读；必填空框扫描列出薪资 / LinkedIn', { skip: !CHROME && 'no local Chrome' }, async () => {
  // 1. Capture the shipped driver's injected JS for this question.
  const d = await loadDriver(BASE, { searchIntent: { search_intent: { geographic_preference: { primary_country: 'US', relocation_policy: 'anywhere_primary_country', willing_to_relocate_for_internship: true } } } });
  const captured = {};
  globalThis.__MRW_EVAL_RULES = [
    { match: 'mrw_location_choices', result: (js) => { captured.read = js; return { ok: true, type: 'checkbox', labels: ['San Francisco', 'Santa Clara', 'Both'] }; } },
    { match: 'mrw_click_choices', result: (js) => { captured.click = js; return { ok: true, picked: ['Both'] }; } },
  ];
  try {
    const res = await d.answerMissing('tab-1', Q);
    assert.equal(res.ok, true, JSON.stringify(res));
  } finally {
    delete globalThis.__MRW_EVAL_RULES;
  }
  assert.ok(captured.read && captured.click);

  // 2. Run it on a real page.
  const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = await freePort();
  const profile = mkdtempSync(join(tmpdir(), 'mrw-chrome-js-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  const env = { ...process.env, CDP_HOST: `127.0.0.1:${port}`, MRWEIRDO_HOME: profile };
  const cdp = (...args) => spawnSync(process.execPath, [join(ROOT, 'shared/cdp.mjs'), ...args], { env, encoding: 'utf8' });
  const evalJs = (tab, js) => {
    const r = cdp('eval', tab, js);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  try {
    let tab = null;
    for (let i = 0; i < 50 && !tab; i += 1) {
      await sleep(200);
      const r = cdp('goto', `http://127.0.0.1:${server.address().port}/`);
      if (r.status === 0) tab = JSON.parse(r.stdout).id;
    }
    assert.ok(tab, 'headless Chrome did not come up');
    await sleep(800);

    const read = evalJs(tab, captured.read);
    assert.deepEqual(read, { ok: true, type: 'checkbox', labels: ['San Francisco', 'Santa Clara', 'Both'] });
    const click = evalJs(tab, captured.click);
    assert.deepEqual(click, { ok: true, picked: ['Both'] });
    const state = evalJs(tab, '[...document.querySelectorAll("input[type=checkbox]")].map(c => c.checked)');
    assert.deepEqual(state, [false, false, true]);

    const req = evalJs(tab, pageCall(emptyRequiredFields));
    assert.deepEqual(req, { ok: true, fields: ['What are your base salary expectations for this position?', 'Linkedin Profile'] });

    // A number box refuses text: this is the Reevo false success, reproduced.
    const typed = JSON.parse(cdp('typetext', tab, '#sal', 'Open to discussion').stdout);
    assert.equal(typed.verified, false);
    assert.equal(typed.value, '');
  } finally {
    chrome.kill('SIGKILL');
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  }
});
