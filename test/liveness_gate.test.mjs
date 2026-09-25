import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { checkAshbyPosting, classifyLiveness, runLivenessGate } from '../shared/liveness_gate.mjs';
import { eligibleReason } from '../shared/eligibility.mjs';

const base = {
  company: 'Acme',
  title: 'Marketing Intern',
  status: '🤖 AI sourced',
  fit_score: 8,
  recommended: 1,
  ats_platform: 'greenhouse',
};

test('Greenhouse error redirect is expired', () => {
  assert.equal(classifyLiveness({
    status: 200,
    finalUrl: 'https://boards.greenhouse.io/acme/jobs/123?error=true',
    bodyText: '',
  }), 'expired');
});

test('Cloudflare challenge is uncertain, never expired', () => {
  assert.equal(classifyLiveness({
    status: 403,
    finalUrl: 'https://jobs.example.com/role',
    bodyText: '<html>Attention Required! | Cloudflare</html>',
  }), 'uncertain');
});

test('bot challenge classification is non-blocking for eligibility', () => {
  const reason = eligibleReason({ ...base, liveness_status: 'bot_challenge' }, {
    roleType: 'intern',
    allowedRoleTypes: ['intern'],
    submittedKeys: new Set(),
    minFit: 5,
    supportedAuto: new Set(['greenhouse']),
  });
  assert.equal(reason, 'eligible');
});

test('expired liveness is the only blocking liveness state', () => {
  const opts = {
    roleType: 'intern',
    allowedRoleTypes: ['intern'],
    submittedKeys: new Set(),
    minFit: 5,
    supportedAuto: new Set(['greenhouse']),
  };
  assert.equal(eligibleReason({ ...base, liveness_status: 'expired' }, opts), 'liveness_expired');
  assert.equal(eligibleReason({ ...base, liveness_status: 'uncertain' }, opts), 'eligible');
});

// ---- Ashby：按公开岗位接口判死活（2026-09-25 restart-apply 小修包第 2 项）----------
// 每个 Ashby 页面都内嵌 recaptchaPublicSiteKey，且前端渲染永远 HTTP 200——光看
// HTML，活岗 / 下架岗 / 不存在的岗一律被判 bot_challenge（不拦）。改为问 Ashby
// 公开 posting API：岗位 ID 在板上 = live，不在 / 板不存在 = expired，问不到 = uncertain。
// 夹具 ashby_board_synthesia.json 是 2026-09-25 对真实接口只读 GET 后裁剪的 3 条；
// 测试全程替身 fetch，零网络。

const BOARD = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ashby_board_synthesia.json'), 'utf8'));
const LIVE_ID = BOARD.jobs[0].id;
const DEAD_ID = '11111111-2222-4333-8444-555555555555'; // well-formed, never on the board
// What every Ashby job page looks like to a plain GET, live or dead (observed 2026-09-25).
const ASHBY_HTML = '<html><script>window.__appData={"routerPrefix":"/","recaptchaPublicSiteKey":"6LeF_x"}</script></html>';

function fakeFetch(calls) {
  return async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.startsWith('https://api.ashbyhq.com/posting-api/job-board/synthesia')) {
      return new Response(JSON.stringify(BOARD), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.startsWith('https://api.ashbyhq.com/posting-api/job-board/gone-company')) return new Response('', { status: 404 });
    if (u.startsWith('https://api.ashbyhq.com/posting-api/job-board/forbidden-co')) return new Response('', { status: 403 });
    if (u.startsWith('https://api.ashbyhq.com/')) throw new Error(`unexpected API url ${u}`);
    if (u.startsWith('https://jobs.ashbyhq.com/')) return new Response(ASHBY_HTML, { status: 200 });
    return new Response('<html>Apply for this job</html>', { status: 200 });
  };
}

async function withFakeFetch(fn) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = fakeFetch(calls);
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = prev;
  }
}

test('Ashby 病根重现：只看 HTML 时活岗页面被判 bot_challenge（这就是为什么不能靠 HTML）', () => {
  assert.equal(classifyLiveness({ status: 200, finalUrl: 'https://jobs.ashbyhq.com/synthesia/x', bodyText: ASHBY_HTML }), 'bot_challenge');
});

test('Ashby 接口判活：在板上 → live；ID 不在板上 → expired；公司板 404 → expired', async () => {
  await withFakeFetch(async () => {
    const live = await checkAshbyPosting(`https://jobs.ashbyhq.com/synthesia/${LIVE_ID}/application`);
    assert.equal(live.liveness_status, 'live');
    assert.equal(live.method, 'ashby_posting_api');
    assert.equal((await checkAshbyPosting(`https://jobs.ashbyhq.com/synthesia/${DEAD_ID}`)).liveness_status, 'expired');
    assert.equal((await checkAshbyPosting(`https://jobs.ashbyhq.com/gone-company/${LIVE_ID}`)).liveness_status, 'expired');
    // ID comparison is case-insensitive (UUIDs), query strings are ignored.
    assert.equal((await checkAshbyPosting(`https://jobs.ashbyhq.com/synthesia/${LIVE_ID.toUpperCase()}?utm_source=x`)).liveness_status, 'live');
  });
});

test('Ashby 接口判活：问不到（接口报错 / URL 里没有岗位 ID）→ uncertain，绝不当成 expired', async () => {
  await withFakeFetch(async () => {
    const denied = await checkAshbyPosting(`https://jobs.ashbyhq.com/forbidden-co/${LIVE_ID}`);
    assert.equal(denied.liveness_status, 'uncertain');
    assert.match(denied.error, /403/);
    const noId = await checkAshbyPosting('https://jobs.ashbyhq.com/synthesia');
    assert.equal(noId.liveness_status, 'uncertain');
    assert.equal(noId.reason, 'ashby_url_without_posting_id');
  });
});

test('runLivenessGate：Ashby 行走接口、同一公司板只问一次；Greenhouse 行照旧走页面', async () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-liveness-ashby-'));
  process.env.MRWEIRDO_HOME = home;
  process.env.MRWEIRDO_DB_PATH = join(home, 'jobs.db');
  const { initDb } = await import('../shared/local_db.mjs');
  initDb();
  const conn = new DatabaseSync(join(home, 'jobs.db'));
  const ins = conn.prepare(`INSERT INTO jobs(company, title, apply_url, status, fit_score, auto_apply_eligible, ats_platform)
    VALUES (?, 'Intern', ?, '🤖 AI sourced', 8, 1, ?)`);
  const liveRow = ins.run('Synthesia', `https://jobs.ashbyhq.com/synthesia/${LIVE_ID}`, 'ashby').lastInsertRowid;
  const deadRow = ins.run('Synthesia', `https://jobs.ashbyhq.com/synthesia/${DEAD_ID}/application`, 'ashby').lastInsertRowid;
  const ghRow = ins.run('Acme', 'https://boards.greenhouse.io/acme/jobs/1', 'greenhouse').lastInsertRowid;
  conn.close();

  await withFakeFetch(async (calls) => {
    const summary = await runLivenessGate({ batch: true, delayMs: 0 });
    const byRow = Object.fromEntries(summary.rows.map((r) => [r.row_id, r.liveness_status]));
    assert.equal(byRow[liveRow], 'live');
    assert.equal(byRow[deadRow], 'expired');
    assert.equal(byRow[ghRow], 'live');
    assert.equal(calls.filter((u) => u.includes('api.ashbyhq.com')).length, 1, 'one board fetch per company per run');
    assert.ok(!calls.some((u) => u.startsWith('https://jobs.ashbyhq.com/')), 'Ashby pages are never HTML-probed');
  });
  const check = new DatabaseSync(join(home, 'jobs.db'));
  const stored = Object.fromEntries(check.prepare('SELECT id, liveness_status FROM jobs').all().map((r) => [r.id, r.liveness_status]));
  check.close();
  assert.equal(stored[deadRow], 'expired', 'expired is persisted so the queue drops the row');
});
