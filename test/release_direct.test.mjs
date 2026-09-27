// restart-apply-3（拍板人 2026-09-27「行，先改，这两个先投」）：`stream_run start --release <链接>`
// 以前只在名单扫描里找被放行的岗；不属于名单公司的链接（Prior Labs / Sequence）永远「没找到」。
// 现在：名单扫描没遇到的放行链接，按链接直接从公开接口（Ashby posting-api / Greenhouse
// boards-api）按岗位编号取这一个岗，再走同一条路：硬筛 → 去重闸 → 打分 → 投前权威闸 →
// 唯一写账人。替身板，不碰网络、不碰真实家目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fetchReleased } from '../shared/sourcing/release_source.mjs';
import { discoverAll } from '../shared/sourcing/dispatcher.mjs';
import { readAll } from '../shared/submission_ledger.mjs';
import { onboardTestEnv } from './helpers.mjs';
import { makeStreamRig, job } from './stream_run_harness.mjs';

const ROOT = join(import.meta.dirname, '..');
const FAKE_FETCH = join(ROOT, 'test', 'fixtures', 'watchlist_fake_fetch.mjs');
const PRIOR = 'https://jobs.ashbyhq.com/prior-labs/1e0d43ae-26b1-4b59-a28f-cb1f35a8b576';
const SEQUENCE = 'https://jobs.ashbyhq.com/sequence/a755e204-d28e-4894-8364-b849664766c5';
const BOTH = { role_type_targets: ['intern', 'new_grad_FT'] }; // the two jobs are entry full-time
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('fetchReleased：按链接的板 slug 取板、按岗位编号挑出这一个；同板只取一次；公司名 = slug', async () => {
  const calls = [];
  const errors = [];
  const fetchers = {
    ashby: async (slug) => {
      calls.push(`ashby:${slug}`);
      return [
        { company: slug, title: 'Founder Associate (NYC)', apply_url: `${PRIOR}/application` },
        { company: slug, title: 'Other', apply_url: 'https://jobs.ashbyhq.com/prior-labs/00000000-0000-0000-0000-0000000000a2/application' },
      ];
    },
    greenhouse: async (slug) => {
      calls.push(`greenhouse:${slug}`);
      return [{ company: slug, title: 'Marketing Intern', url: `https://job-boards.greenhouse.io/${slug}/jobs/5` }];
    },
  };
  const jobs = await fetchReleased([PRIOR, `${PRIOR}/application`, 'https://job-boards.greenhouse.io/heygen/jobs/5', 'https://boards.greenhouse.io/heygen/jobs/999'],
    { fetchers, reportError: (e) => errors.push(e) });
  assert.deepEqual(calls, ['ashby:prior-labs', 'greenhouse:heygen'], 'one fetch per board');
  assert.deepEqual(jobs.map((j) => [j.company, j.title]), [['prior-labs', 'Founder Associate (NYC)'], ['heygen', 'Marketing Intern']]);
  assert.deepEqual(errors, [], 'a job missing from its board is not an error — the run reports it as not found');
});

test('fetchReleased：Lever 暂停、没有板 slug 的 gh_jid 链接、板接口报错 → 带链接进 errors，不静默', async () => {
  const errors = [];
  const fetchers = { ashby: async () => { throw new Error('Ashby sequence: HTTP 500'); }, greenhouse: async () => [] };
  const jobs = await fetchReleased(['https://jobs.lever.co/acme/00000000-0000-0000-0000-000000000001', 'https://acme.com/careers?gh_jid=123', SEQUENCE],
    { fetchers, reportError: (e) => errors.push(e) });
  assert.deepEqual(jobs, []);
  assert.deepEqual(errors.map((e) => [e.apply_url, e.error]), [
    ['https://jobs.lever.co/acme/00000000-0000-0000-0000-000000000001', 'lever_paused'],
    ['https://acme.com/careers?gh_jid=123', 'no_board_in_link'],
    [SEQUENCE, 'Ashby sequence: HTTP 500'],
  ]);
  await assert.rejects(fetchReleased([PRIOR], { fetchers }), /reportError is required/);
});

test('dispatcher + discover_candidates --sources release：真板接口模块 + 替身 fetch，两条待投链接取回并过硬筛', async () => {
  const realFetch = globalThis.fetch;
  const { fakeFetch } = await import(FAKE_FETCH);
  globalThis.fetch = fakeFetch;
  try {
    const r = await discoverAll({ sources: ['release'], release_urls: [PRIOR, SEQUENCE] });
    assert.deepEqual(r.jobs.map((j) => [j.company, j.title, j._discovery_source]), [['prior-labs', 'Founder Associate (NYC)', 'release'], ['sequence', 'GTM Associate', 'release']]);
  } finally {
    globalThis.fetch = realFetch;
  }
  const home = mkdtempSync(join(tmpdir(), 'mrw-release-cli-'));
  writeFileSync(join(home, 'search_intent.json'), JSON.stringify({ search_intent: {
    seniority: 'both', role_type_targets: ['intern', 'new_grad_FT'], geographic_preference: { primary_country: 'US', remote_acceptable: true },
    target_function_anchor: { self_reported_target_functions: ['growth', 'GTM'] },
  } }));
  const out = join(home, 'disc');
  mkdirSync(out);
  const cli = spawnSync(process.execPath, ['--import', FAKE_FETCH, 'shared/discover_candidates.mjs', '--run', '--sources', 'release', '--source-window-size', '0',
    '--release-url', PRIOR, '--release-url', 'https://jobs.ashbyhq.com/prior-labs/00000000-0000-0000-0000-0000000000a2', '--release-url', SEQUENCE, '--output-dir', out], {
    cwd: ROOT, env: onboardTestEnv(home), encoding: 'utf8',
  });
  assert.equal(cli.status, 0, cli.stderr);
  const toScore = JSON.parse(readFileSync(join(out, 'to_score.json'), 'utf8'));
  assert.deepEqual(toScore.map((j) => j.title).sort(), ['Founder Associate (NYC)', 'GTM Associate']);
  const dropped = JSON.parse(readFileSync(join(out, 'hard_filter_dropped.json'), 'utf8'));
  assert.deepEqual(dropped.map((d) => [d.apply_url, d.reason]), [['https://jobs.ashbyhq.com/prior-labs/00000000-0000-0000-0000-0000000000a2/application', 'function_mismatch:sales_ae']],
    'every hard-filter drop is written out, so a released job that was dropped can be named');
});

// ---- stream_run end to end (fake board / scorer / drivers) -------------------

const ashbyJob = (slug, uuid, { fit = true, title = 'GTM Associate' } = {}) => ({
  company: slug, title, apply_url: `https://jobs.ashbyhq.com/${slug}/${uuid}/application`, location: 'Remote', description: `JD ${slug}`, fit,
});

test('--release 非名单链接：名单扫描没遇到 → 按链接直取 → 打分 → 投出 → 唯一写账人记账；轮转零调用；再放行被投前闸拦下', async () => {
  const rig = await makeStreamRig('mrw-release-direct-');
  rig.env.MRWEIRDO_DAILY_TIER = '25';
  try {
    const prior = ashbyJob('prior-labs', '1e0d43ae-26b1-4b59-a28f-cb1f35a8b576', { title: 'Founder Associate (NYC)' });
    rig.targets([{ ats: 'greenhouse', slug: 'pika' }], BOTH);
    rig.board({ watchlist: [job('pika', 1, { fit: true })], release: [prior], rotation: [job('Other', 3, { fit: true })] });

    const r = await rig.run(1, { startArgs: ['--release', PRIOR] });
    const calls = rig.discoverCalls();
    assert.deepEqual(calls.map((c) => c.kind), ['watchlist', 'release'], 'rotation never called on a release run');
    assert.deepEqual(calls[1].release_urls, [PRIOR], 'only the link the list scan did not meet is fetched');
    assert.deepEqual(rig.driverCalls(), [prior.apply_url], 'the released job is applied to; the held list job is not');
    assert.match(r.finish.lines[0], /^投出 1 个：prior-labs·Founder Associate \(NYC\)/);
    const line = readAll(rig.home).find((e) => e.apply_url === prior.apply_url);
    assert.ok(line, 'ledger line written by the recorder');
    assert.equal(line.company_key, 'priorlabs');

    const again = await rig.run(1, { startArgs: ['--release', PRIOR] });
    assert.deepEqual(rig.driverCalls(), [prior.apply_url], 'never applied twice');
    assert.match(again.finish.lines[1], new RegExp(`放行的 1 个没投： ${esc(PRIOR)} （被闸拦：already_attempted_fp）`));
  } finally {
    await rig.close();
  }
});

test('--release 名单岗 + 非名单岗一起：名单那条由名单扫描找到、不再直取；两条都投', async () => {
  const rig = await makeStreamRig('mrw-release-mixed-');
  try {
    const dream = job('pika', 1, { fit: true });
    const seq = ashbyJob('sequence', 'a755e204-d28e-4894-8364-b849664766c5');
    rig.targets([{ ats: 'greenhouse', slug: 'pika' }], BOTH);
    rig.board({ watchlist: [dream], release: [seq] });
    await rig.run(2, { startArgs: ['--release', dream.apply_url, '--release', SEQUENCE] });
    assert.deepEqual(rig.discoverCalls()[1].release_urls, [SEQUENCE]);
    assert.deepEqual(rig.driverCalls().sort(), [dream.apply_url, seq.apply_url].sort());
  } finally {
    await rig.close();
  }
});

test('--release 非名单链接取不到 / 板接口报错 / 被硬筛拦：不投，第 2 行逐条说原因', async () => {
  const rig = await makeStreamRig('mrw-release-why-');
  try {
    const gone = 'https://jobs.ashbyhq.com/gone/00000000-0000-0000-0000-00000000dead';
    const broken = 'https://jobs.ashbyhq.com/broken/00000000-0000-0000-0000-00000000beef';
    const ae = 'https://jobs.ashbyhq.com/prior-labs/00000000-0000-0000-0000-0000000000a2';
    rig.targets([{ ats: 'greenhouse', slug: 'pika' }], BOTH);
    rig.board({
      watchlist: [], release: [],
      errors: { release: [{ source: 'release', apply_url: broken, error: 'Ashby broken: HTTP 500' }] },
      dropped: { release: [{ apply_url: `${ae}/application`, reason: 'function_mismatch:sales_ae' }] },
    });
    const r = await rig.run(1, { startArgs: ['--release', gone, '--release', broken, '--release', ae] });
    assert.deepEqual(rig.driverCalls(), []);
    assert.match(r.finish.lines[1], new RegExp(`放行的 1 个公开接口取不到（疑似下架）： ${esc(gone)} `));
    assert.match(r.finish.lines[1], new RegExp(`${esc(broken)} （取岗出错：fetch_failed:Ashby broken: HTTP 500）`));
    assert.match(r.finish.lines[1], new RegExp(`${esc(ae)} （被闸拦：hard_filter:function_mismatch:sales_ae）`));
  } finally {
    await rig.close();
  }
});

// Round 3 真实运行（stream-2026-09-27T20-44-00-192Z-98439）：`start --target 2 --release <prior> --release <sequence>`，
// 打分额度 2×10=20 被 20 个待重打的名单岗用光，两条放行岗没进批次；报告却说「可能已下架」。
// 修法：release 运行只处理点名的链接（名单扫描只用来找名单里的放行岗，其余名单岗不进打分、不占额度），
// 额度至少为放行条数；第 2 行区分 没打到分 / 公开接口取不到（疑似下架）/ 打分不合格 / 被闸拦。
test('Round 3 复现：两条非名单放行 + 20 个名单岗待重打 → 只打这两条、两条都投；名单岗不重打、不 held', async () => {
  const rig = await makeStreamRig('mrw-release-round3-');
  try {
    const prior = ashbyJob('prior-labs', '1e0d43ae-26b1-4b59-a28f-cb1f35a8b576', { title: 'Founder Associate (NYC)' });
    const seq = ashbyJob('sequence', 'a755e204-d28e-4894-8364-b849664766c5');
    const list = Array.from({ length: 20 }, (_, i) => job('pika', i + 1, { fit: i % 3 === 0 }));
    rig.targets([{ ats: 'greenhouse', slug: 'pika' }], BOTH);
    rig.board({ watchlist: list, release: [prior, seq] });
    const r = await rig.run(2, { startArgs: ['--release', PRIOR, '--release', SEQUENCE] });
    assert.deepEqual(r.scored.sort(), [prior.apply_url, seq.apply_url].sort(), 'only the named links are scored');
    assert.deepEqual(rig.driverCalls().sort(), [prior.apply_url, seq.apply_url].sort());
    assert.deepEqual(r.finish.held, [], 'list jobs are not re-scored or held in a release run');
    assert.match(r.finish.lines[0], /^投出 2 个/);
    assert.doesNotMatch(r.finish.lines[1], /放行/, 'every named link went out');
  } finally {
    await rig.close();
  }
});

test('放行额度至少为放行条数：--target 1 放行 12 条 → 12 条都打分', async () => {
  const rig = await makeStreamRig('mrw-release-budget-');
  try {
    const jobs = Array.from({ length: 12 }, (_, i) => ashbyJob(`co${i}`, `00000000-0000-0000-0000-0000000001${String(i).padStart(2, '0')}`, { fit: false }));
    rig.targets([{ ats: 'greenhouse', slug: 'pika' }], BOTH);
    rig.board({ watchlist: [], release: jobs });
    const r = await rig.run(1, { startArgs: jobs.flatMap((j) => ['--release', j.apply_url.replace(/\/application$/, '')]) });
    assert.equal(r.scored.length, 12);
    assert.match(r.finish.lines[1], /放行的 12 个没投：.*（打分不合格：scored_not_eligible）/);
  } finally {
    await rig.close();
  }
});

test('第 2 行分类：公开接口取不到（疑似下架）/ 取岗出错 / 被闸拦 / 没打到分，各说各的', async () => {
  const rig = await makeStreamRig('mrw-release-labels-');
  try {
    const gone = 'https://jobs.ashbyhq.com/gone/00000000-0000-0000-0000-00000000dead';
    const broken = 'https://jobs.ashbyhq.com/broken/00000000-0000-0000-0000-00000000beef';
    const ae = 'https://jobs.ashbyhq.com/prior-labs/00000000-0000-0000-0000-0000000000a2';
    rig.targets([{ ats: 'greenhouse', slug: 'pika' }], BOTH);
    rig.board({
      watchlist: [], release: [],
      errors: { release: [{ source: 'release', apply_url: broken, error: 'Ashby broken: HTTP 500' }] },
      dropped: { release: [{ apply_url: `${ae}/application`, reason: 'function_mismatch:sales_ae' }] },
    });
    const r = await rig.run(1, { startArgs: ['--release', gone, '--release', broken, '--release', ae] });
    assert.match(r.finish.lines[1], new RegExp(`放行的 1 个公开接口取不到（疑似下架）： ${esc(gone)} `));
    assert.match(r.finish.lines[1], new RegExp(`${esc(broken)} （取岗出错：fetch_failed:Ashby broken: HTTP 500）`));
    assert.match(r.finish.lines[1], new RegExp(`${esc(ae)} （被闸拦：hard_filter:function_mismatch:sales_ae）`));
  } finally {
    await rig.close();
  }
});
