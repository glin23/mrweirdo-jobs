// 关卡 3（拍板人 2026-09-26）：「只投递 AI 视频创业公司相关岗位」。
// search_intent.sourcing_mode = "watchlist_only" 时即找即投只扫名单公司
// （search_intent.target_companies），轮转池一次都不调；新岗不够就如实少投。
// 名单公司合格的沿用 D10：held、第 1 行列「公司·岗位 链接」给拍板人看；拍板人点名的
// 用 `start --release <链接>` 投，照过投前权威闸、经唯一写账人记账。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { append, readAll } from '../shared/submission_ledger.mjs';
import { jobFingerprint } from '../shared/job_identity.mjs';
import { scoringBasisVersion } from '../shared/seen_log.mjs';
import { attemptIndex } from '../shared/apply_guard.mjs';
import { makeStreamRig, job, ghUrl, INTENT } from './stream_run_harness.mjs';

const ONLY = { sourcing_mode: 'watchlist_only' };
const LIST = [
  { ats: 'greenhouse', slug: 'pika', label: 'Pika' },
  { ats: 'greenhouse', slug: 'runway', label: 'Runway' },
  { ats: 'greenhouse', slug: 'heygen', label: 'HeyGen' },
];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function seedAttempt(home, i, company, url) {
  append(home, {
    era: 'v2', job_id: 100001 + i, apply_url: url, company_key: company, title_key: `seed ${i}`, ats: 'greenhouse',
    outcome: 'submitted', verdict: 'submitted', may_have_submitted: true, reason: null, evidence: null, answers: [], work_auth_provenance: null,
  });
}

test('只扫名单：轮转来源零调用；名单合格岗全部 held、第 1 行逐条「公司·岗位 链接」（链接两侧留空，可点）；第 3 行如实说新岗不够、只扫了名单', async () => {
  const rig = await makeStreamRig('mrw-stream-wlonly-');
  try {
    rig.targets(LIST, ONLY);
    const fit = [job('pika', 1, { fit: true }), job('pika', 2, { fit: true }), job('runway', 3, { fit: true }), job('heygen', 4, { fit: true }),
      job('heygen', 5, { fit: true }), job('runway', 6, { fit: true }), job('pika', 7, { fit: true })];
    rig.board({ watchlist: [...fit, job('pika', 8), job('runway', 9)], rotation: [job('Other', 10, { fit: true })] });

    const r = await rig.run(5, { startArgs: [] });
    assert.deepEqual(rig.discoverCalls().map((c) => c.kind), ['watchlist'], 'rotation source called zero times');
    assert.deepEqual(rig.driverCalls(), [], 'held list jobs are not applied to on their own');
    assert.equal(r.start.sourcing_mode, 'watchlist_only');
    assert.equal(r.finish.held.length, 7, 'every eligible list job is listed, none dropped');
    for (const j of fit) {
      assert.match(r.finish.lines[0], new RegExp(`${esc(j.company)}·${esc(j.title)} ${esc(j.apply_url)}(\\s|$)`), `clickable link for ${j.apply_url}: ${r.finish.lines[0]}`);
    }
    assert.match(r.finish.lines[2], /新岗不够：这次看了 9 个新岗，合适的只有 7 个（其中 7 个是名单公司、等你过目），没凑到 5 个/);
    assert.match(r.finish.lines[2], /只扫了名单公司 3 家/);
    assert.equal(r.finish.sourcing_mode, 'watchlist_only');
  } finally {
    await rig.close();
  }
});

test('只扫名单、名单里没有新岗：第 3 行说没有新岗、只扫了名单；轮转仍零调用', async () => {
  const rig = await makeStreamRig('mrw-stream-wlonly-empty-');
  try {
    rig.targets(LIST, ONLY);
    rig.board({ watchlist: [], rotation: [job('Other', 1, { fit: true })] });
    const r = await rig.run(3, { startArgs: [] });
    assert.deepEqual(rig.discoverCalls().map((c) => c.kind), ['watchlist']);
    assert.match(r.finish.lines[2], /^没有新岗/);
    assert.match(r.finish.lines[2], /只扫了名单公司 3 家/);
    assert.deepEqual(rig.driverCalls(), []);
  } finally {
    await rig.close();
  }
});

test('开关关（默认 / watchlist_first）：行为不变，名单扫完照常扫轮转', async () => {
  const rig = await makeStreamRig('mrw-stream-wlfirst-');
  try {
    rig.targets(LIST, { sourcing_mode: 'watchlist_first' });
    rig.board({ watchlist: [], rotation: [job('Other', 1, { fit: true })] });
    const r = await rig.run(3);
    assert.deepEqual(rig.discoverCalls().map((c) => c.kind), ['watchlist', 'rotation']);
    assert.deepEqual(rig.driverCalls(), [ghUrl('other', 1)]);
    assert.doesNotMatch(r.finish.lines[2], /只扫了名单/);
  } finally {
    await rig.close();
  }
});

test('只扫名单开关的错用都响亮拒绝：名单为空 / 值拼错 / 同时给 --max-windows', async () => {
  const rig = await makeStreamRig('mrw-stream-wlonly-bad-');
  try {
    rig.targets(null, ONLY);
    let r = await rig.step(['start', '--target', '3']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /watchlist_only.*target_companies/);

    rig.targets(LIST, { sourcing_mode: 'list_only' });
    r = await rig.step(['start', '--target', '3']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /sourcing_mode "list_only"/);

    rig.targets(LIST, ONLY);
    r = await rig.step(['start', '--target', '3', '--max-windows', '1']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--max-windows.*watchlist_only/);
    assert.deepEqual(rig.discoverCalls(), []);
  } finally {
    await rig.close();
  }
});

test('只扫名单 + --release：拍板人点名的岗照常投，经唯一写账人记账（链接 / 可能已提交 / 指纹）；再放行同一岗被投前闸拦下并说原因', async () => {
  const rig = await makeStreamRig('mrw-stream-wlonly-release-');
  rig.env.MRWEIRDO_DAILY_TIER = '25';
  try {
    rig.targets(LIST, ONLY);
    const a = job('pika', 1, { fit: true });
    const b = job('runway', 2, { fit: true });
    rig.board({ watchlist: [a, b], rotation: [job('Other', 3, { fit: true })] });
    const first = await rig.run(5, { startArgs: [] });
    assert.equal(first.finish.held.length, 2);

    const rel = await rig.run(1, { startArgs: ['--release', a.apply_url] });
    assert.deepEqual(rig.driverCalls(), [a.apply_url], 'only the released job is applied to');
    assert.match(rel.finish.lines[0], /^投出 1 个：pika·Growth Intern 1$/);
    const line = readAll(rig.home).find((e) => e.apply_url === a.apply_url);
    assert.ok(line, 'ledger line written');
    assert.equal(line.may_have_submitted, true);
    assert.ok(attemptIndex(readAll(rig.home), new Date()).byFp.has(jobFingerprint(a.apply_url).fp), 'the ledger line is found by fingerprint (what the gate reads)');
    assert.equal(line.company_key, 'pika');
    assert.ok(rig.discoverCalls().every((c) => c.kind === 'watchlist'), 'rotation never called');

    const again = await rig.run(1, { startArgs: ['--release', a.apply_url] });
    assert.deepEqual(rig.driverCalls(), [a.apply_url], 'never applied twice');
    assert.match(again.finish.lines[1], new RegExp(`放行的 1 个没投：${esc(a.apply_url)}（already_attempted_fp）`));
  } finally {
    await rig.close();
  }
});

test('只扫名单 + --release 被 60 天同公司 2 次拦下：驱动不碰，报告说原因', async () => {
  const rig = await makeStreamRig('mrw-stream-wlonly-cool-');
  try {
    rig.targets(LIST, ONLY);
    seedAttempt(rig.home, 0, 'runway', ghUrl('runway', 900));
    seedAttempt(rig.home, 1, 'runway', ghUrl('runway', 901));
    const b = job('runway', 2, { fit: true });
    rig.board({ watchlist: [b] });
    const r = await rig.run(1, { startArgs: ['--release', b.apply_url] });
    assert.deepEqual(rig.driverCalls(), []);
    assert.match(r.finish.lines[1], new RegExp(`放行的 1 个没投：${esc(b.apply_url)}（company_cooldown_60d）`));
  } finally {
    await rig.close();
  }
});

test('--release 遇今日额度已满：不扫不投，报告说额度满，不谎称「没找到（可能已下架）」', async () => {
  const rig = await makeStreamRig('mrw-stream-wlonly-cap-');
  try {
    rig.targets(LIST, ONLY);
    for (let i = 0; i < 10; i += 1) seedAttempt(rig.home, i, `d${i}`, ghUrl(`d${i}`, i + 1));
    const a = job('pika', 1, { fit: true });
    rig.board({ watchlist: [a] });
    const r = await rig.run(1, { startArgs: ['--release', a.apply_url] });
    assert.deepEqual(rig.driverCalls(), []);
    assert.doesNotMatch(r.finish.lines[1], /没找到/);
    assert.match(r.finish.lines[1], new RegExp(`放行的 1 个没投：${esc(a.apply_url)}（daily_cap_reached）`));
  } finally {
    await rig.close();
  }
});

test('--release 的岗重新打分不合格：不投，报告明说（不静默吞掉拍板人点名的岗）', async () => {
  const rig = await makeStreamRig('mrw-stream-wlonly-refit-');
  try {
    rig.targets(LIST, ONLY);
    const a = job('pika', 1, { fit: false });
    rig.board({ watchlist: [a] });
    const r = await rig.run(1, { startArgs: ['--release', a.apply_url] });
    assert.deepEqual(rig.driverCalls(), []);
    assert.match(r.finish.lines[1], new RegExp(`放行的 1 个没投：${esc(a.apply_url)}（scored_not_eligible）`));
  } finally {
    await rig.close();
  }
});

test('sourcing_mode 只管扫哪里、不管怎么打分：切换开关不作废「不合适」判断（依据版本不变）', async () => {
  const rig = await makeStreamRig('mrw-stream-wlonly-basis-');
  try {
    rig.targets(LIST);
    const before = scoringBasisVersion(rig.home);
    rig.targets(LIST, ONLY);
    assert.equal(scoringBasisVersion(rig.home), before);
    writeFileSync(join(rig.home, 'search_intent.json'), JSON.stringify({ search_intent: { ...INTENT.search_intent, target_companies: LIST.slice(1), ...ONLY } }));
    assert.notEqual(scoringBasisVersion(rig.home), before, 'other intent fields still count');
  } finally {
    await rig.close();
  }
});
