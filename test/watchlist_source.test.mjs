// 名单优先（restart-apply DESIGN S4 / ADR-S2）：search_intent.target_companies 里的
// 公司每次必扫；公司名一律用板 slug（和轮转找岗同一写法，60 天计数才不会被
// 「Pika / Pika Labs」绕过）；单家挂掉只记进 errors，不连累其他家。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fetchWatchlist } from '../shared/sourcing/watchlist_source.mjs';
import { discoverAll } from '../shared/sourcing/dispatcher.mjs';
import { onboardTestEnv } from './helpers.mjs';

const ROOT = join(import.meta.dirname, '..');
const FAKE_FETCH = join(ROOT, 'test', 'fixtures', 'watchlist_fake_fetch.mjs');
const TARGETS = [
  { ats: 'ashby', slug: 'pika', label: 'Pika Labs' },
  { ats: 'greenhouse', slug: 'heygen', label: 'HeyGen' },
  { ats: 'ashby', slug: 'brokenco', label: 'Broken Co' },
];

test('fetchWatchlist：逐家调板接口；公司名 = slug（label 只用于报错）；单家失败进 errors', async () => {
  const errors = [];
  const calls = [];
  const fetchers = {
    ashby: async (slug) => {
      calls.push(`ashby:${slug}`);
      if (slug === 'brokenco') throw new Error('Ashby brokenco: HTTP 500');
      return [{ company: slug, title: 'Growth Intern', apply_url: `https://jobs.ashbyhq.com/${slug}/00000000-0000-0000-0000-000000000001` }];
    },
    greenhouse: async (slug) => {
      calls.push(`greenhouse:${slug}`);
      return [{ company: slug, title: 'Marketing Intern', url: `https://job-boards.greenhouse.io/${slug}/jobs/5` }];
    },
  };
  const jobs = await fetchWatchlist(TARGETS, { fetchers, reportError: (e) => errors.push(e) });
  assert.deepEqual(calls, ['ashby:pika', 'greenhouse:heygen', 'ashby:brokenco']);
  assert.deepEqual(jobs.map((j) => j.company), ['pika', 'heygen']);
  assert.deepEqual(errors, [{ slug: 'brokenco', ats: 'ashby', label: 'Broken Co', error: 'Ashby brokenco: HTTP 500' }]);
});

test('fetchWatchlist：Lever 暂停 → 不请求、记 errors；缺 slug / 不认识的 ats = 配置 bug，响亮失败', async () => {
  const errors = [];
  const fetchers = { ashby: async () => assert.fail('no fetch'), greenhouse: async () => assert.fail('no fetch') };
  assert.deepEqual(await fetchWatchlist([{ ats: 'lever', slug: 'kapwing', label: 'Kapwing' }], { fetchers, reportError: (e) => errors.push(e) }), []);
  assert.deepEqual(errors, [{ slug: 'kapwing', ats: 'lever', label: 'Kapwing', error: 'lever_paused' }]);
  await assert.rejects(fetchWatchlist([{ ats: 'ashby', label: 'X' }], { fetchers, reportError() {} }), /slug/);
  await assert.rejects(fetchWatchlist([{ ats: 'workday', slug: 'x' }], { fetchers, reportError() {} }), /ats/);
  assert.deepEqual(await fetchWatchlist(undefined, { fetchers, reportError() {} }), [], 'no list = nothing to scan');
});

test('dispatcher：watchlist 已注册；单家错误带 slug 汇进 errors（真板接口模块 + 替身 fetch）', async () => {
  const realFetch = globalThis.fetch;
  const { fakeFetch } = await import(FAKE_FETCH);
  globalThis.fetch = fakeFetch;
  try {
    const r = await discoverAll({ sources: ['watchlist'], intent: { target_companies: TARGETS } });
    assert.deepEqual(r.jobs.map((j) => [j.company, j._discovery_source]).sort(), [['heygen', 'watchlist'], ['pika', 'watchlist'], ['pika', 'watchlist']]);
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0].source, 'watchlist');
    assert.equal(r.errors[0].slug, 'brokenco');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('discover_candidates --sources watchlist：读 search_intent 名单、过硬过滤、不动轮转游标', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-watchlist-cli-'));
  writeFileSync(join(home, 'search_intent.json'), JSON.stringify({
    search_intent: { seniority: 'intern', role_type_targets: ['intern'], geographic_preference: { primary_country: 'US', remote_acceptable: true }, target_companies: TARGETS },
  }));
  const out = join(home, 'disc');
  mkdirSync(out);
  const r = spawnSync(process.execPath, ['--import', FAKE_FETCH, 'shared/discover_candidates.mjs', '--run', '--sources', 'watchlist', '--source-window-size', '0', '--output-dir', out], {
    cwd: ROOT, env: onboardTestEnv(home), encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  const toScore = JSON.parse(readFileSync(join(out, 'to_score.json'), 'utf8'));
  assert.deepEqual(toScore.map((j) => j.company).sort(), ['heygen', 'pika'], 'the Senior role is dropped by the role-type filter');
  const funnel = JSON.parse(readFileSync(join(out, 'discovery_funnel.json'), 'utf8'));
  assert.deepEqual(funnel.errors.map((e) => e.slug), ['brokenco']);
  assert.equal(existsSync(join(home, 'source_cursor.json')), false, 'a watchlist scan never moves the rotation cursor');
});

test('预置 AI 视频名单：21 家，只含可自动投的 Ashby / Greenhouse，slug 不重复', () => {
  const preset = JSON.parse(readFileSync(join(ROOT, 'shared', 'sourcing', 'data', 'watchlist_ai_video.json'), 'utf8'));
  assert.equal(preset.target_companies.length, 21);
  assert.ok(preset.target_companies.every((t) => ['ashby', 'greenhouse'].includes(t.ats) && t.slug && t.label));
  assert.equal(new Set(preset.target_companies.map((t) => t.slug)).size, 21);
  // 「runway」板是一家财务规划软件公司；AI 视频的 Runway 官网招聘页链到 runway-ml（VERIFY 第 4 轮 BUG-2）。
  assert.equal(preset.target_companies.find((t) => t.label === 'Runway').slug, 'runway-ml');
  assert.ok(preset._meta.not_found_slugs_tried.Runway.some((s) => s.startsWith('runway ')), 'the wrong board is recorded, not silently dropped');
});
