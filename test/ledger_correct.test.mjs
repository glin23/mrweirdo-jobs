// 账本更正（拍板人要重投 Creatify PM Intern：5 月迁入的 legacy_unverified 行，Gmail 无确认邮件，
// lead 判当时没投成）。账本永不原地改，改错补更正行：
//   node shared/submission_ledger.mjs correct --of <行 id> --url <该行的岗位链接> --verdict not_submitted --evidence "<为什么>" [--apply]
// 默认试跑只打印将追加的行；必须带证据、指向存在的原始行；原行不删。
// 关键：投前权威闸 / 去重闸 / 60 天同公司计数都按「更正后的有效判定」读账本——
// 更正为未投出后放行；没更正的同类行照拦。全程假家目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { append, effectiveEntries, isSubmitted, ledgerPath, readAll } from '../shared/submission_ledger.mjs';
import { attemptIndex, checkDispatch, budgetLine, identityBlock } from '../shared/apply_guard.mjs';
import { seenIndex } from '../shared/seen_log.mjs';
import { onboardTestEnv } from './helpers.mjs';

const CREATIFY = 'https://jobs.ashbyhq.com/creatify/4da91083-999a-4bf8-b53d-92a179073af2/application';
const CREATIFY2 = 'https://jobs.ashbyhq.com/creatify/00000000-0000-0000-0000-0000000000c2';
const OPUS = 'https://jobs.ashbyhq.com/opusclip/00000000-0000-0000-0000-0000000000a1';
const DAY = 24 * 3600 * 1000;
const EV = 'Gmail 无确认邮件，lead 已核';
const NO_SEEN = { index: seenIndex([]), basis: { scoring: 's', fill: 'f' } };

function legacyLine(id, jobId, url, company, title, daysAgo) {
  return {
    id, ts: new Date(Date.now() - daysAgo * DAY).toISOString(), era: 'legacy', job_id: jobId, apply_url: url, company_key: company, title_key: title,
    ats: 'ashby', outcome: 'legacy_submitted', verdict: 'legacy_unverified', may_have_submitted: true, reason: null, evidence: null, answers: [], work_auth_provenance: null,
  };
}

function homeWithHistory() {
  const home = mkdtempSync(join(tmpdir(), 'mrw-correct-'));
  append(home, legacyLine('led_creatify_pm', 169, CREATIFY, 'creatify', 'product manager intern', 20));
  append(home, legacyLine('led_creatify_2', 170, CREATIFY2, 'creatify', 'growth intern', 25));
  append(home, legacyLine('led_opus', 171, OPUS, 'opusclip', 'product intern', 20));
  return home;
}

const cli = (home, args) => spawnSync(process.execPath, ['shared/submission_ledger.mjs', 'correct', ...args], { cwd: process.cwd(), env: onboardTestEnv(home), encoding: 'utf8' });
const job = (url, company, title) => ({ apply_url: url, company, title });
const gate = (home, j) => identityBlock(j, attemptIndex(readAll(home)), new Date(), NO_SEEN);

test('默认试跑：打印将追加的更正行，账本一个字节不动', () => {
  const home = homeWithHistory();
  const before = readFileSync(ledgerPath(home), 'utf8');
  const r = cli(home, ['--of', 'led_creatify_pm', '--url', CREATIFY, '--verdict', 'not_submitted', '--evidence', 'Gmail 无 Creatify 确认邮件']);
  assert.equal(r.status, 0, r.stderr);
  const plan = JSON.parse(r.stdout);
  assert.equal(plan.applied, false);
  assert.equal(plan.correction.correction_of, 'led_creatify_pm');
  assert.equal(plan.correction.verdict, 'not_submitted');
  assert.equal(plan.correction.may_have_submitted, false);
  assert.equal(readFileSync(ledgerPath(home), 'utf8'), before);
});

test('拒绝：没证据 / 行不存在 / 判定不在允许值 / 更正一条更正行 / 有运行在跑——都不写', () => {
  const home = homeWithHistory();
  const before = readFileSync(ledgerPath(home), 'utf8');
  const cases = [
    [['--of', 'led_creatify_pm', '--url', CREATIFY, '--verdict', 'not_submitted', '--apply'], /--evidence/],
    [['--of', 'led_nope', '--url', CREATIFY, '--verdict', 'not_submitted', '--evidence', EV, '--apply'], /no ledger entry with id led_nope/],
    [['--of', 'led_creatify_pm', '--url', CREATIFY, '--verdict', 'legacy_unverified', '--evidence', EV, '--apply'], /--verdict/],
    [['--of', 'led_creatify_pm', '--url', CREATIFY, '--verdict', 'nope', '--evidence', EV, '--apply'], /--verdict/],
  ];
  for (const [args, msg] of cases) {
    const r = cli(home, args);
    assert.equal(r.status, 1, `${args.join(' ')} → ${r.stderr}`);
    assert.match(r.stderr, msg);
  }
  assert.equal(readFileSync(ledgerPath(home), 'utf8'), before);

  assert.equal(cli(home, ['--of', 'led_creatify_pm', '--url', CREATIFY, '--verdict', 'not_submitted', '--evidence', EV, '--apply']).status, 0);
  const corr = readAll(home).find((e) => e.correction_of === 'led_creatify_pm');
  const again = cli(home, ['--of', corr.id, '--url', CREATIFY, '--verdict', 'submitted', '--evidence', EV, '--apply']);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /is itself a correction/);

  mkdirSync(join(home, 'locks'), { recursive: true });
  writeFileSync(join(home, 'locks', 'stream_run.lock'), '{}');
  const locked = cli(home, ['--of', 'led_opus', '--url', OPUS, '--verdict', 'not_submitted', '--evidence', EV, '--apply']);
  assert.equal(locked.status, 1);
  assert.match(locked.stderr, /stream_run\.lock/);
});

test('--apply：追加一行更正（原行原样保留），账本 600；有效判定变为未投出，「已投」少 1', () => {
  const home = homeWithHistory();
  const r = cli(home, ['--of', 'led_creatify_pm', '--url', CREATIFY, '--verdict', 'not_submitted', '--evidence', 'Gmail 无 Creatify 确认邮件（同日 OpusClip 有）', '--apply']);
  assert.equal(r.status, 0, r.stderr);
  const all = readAll(home);
  assert.equal(all.length, 4);
  assert.deepEqual(all[0], { ...legacyLine('led_creatify_pm', 169, CREATIFY, 'creatify', 'product manager intern', 20), ts: all[0].ts, correction_of: null });
  assert.equal(all[3].correction_of, 'led_creatify_pm');
  assert.equal(all[3].evidence, 'Gmail 无 Creatify 确认邮件（同日 OpusClip 有）');
  assert.equal(statSync(ledgerPath(home)).mode & 0o777, 0o600);
  const eff = effectiveEntries(all).find((e) => e.id === 'led_creatify_pm');
  assert.equal(eff.verdict, 'not_submitted');
  assert.equal(eff.may_have_submitted, false);
  assert.equal(effectiveEntries(all).filter(isSubmitted).length, 2);
});

test('投前闸按有效判定读：更正前 Creatify 这岗被 already_attempted_fp 拦；更正后放行、不再计入 Creatify 60 天次数；没更正的同类岗仍拦', () => {
  const home = homeWithHistory();
  const pm = job(CREATIFY, 'creatify', 'Product Manager Intern');
  const other = job('https://jobs.ashbyhq.com/creatify/00000000-0000-0000-0000-0000000000c3', 'creatify', 'Video Intern');
  assert.equal(gate(home, pm).reason, 'already_attempted_fp');
  assert.equal(gate(home, other).reason, 'company_cooldown_60d', 'creatify has 2 attempts in 60 days');

  assert.equal(cli(home, ['--of', 'led_creatify_pm', '--url', CREATIFY, '--verdict', 'not_submitted', '--evidence', 'Gmail 无确认邮件', '--apply']).status, 0);
  const idx = attemptIndex(readAll(home));
  assert.equal(gate(home, pm).ok, true, 'the corrected job may be applied to again');
  assert.equal(gate(home, other).ok, true, 'creatify now counts 1 attempt in 60 days, under the cap of 2');
  assert.equal((idx.byCompany.get('creatify') || []).length, 1);
  const budget = budgetLine(idx, 1, 10);
  assert.equal(checkDispatch(pm, idx, budget, new Date(), NO_SEEN).ok, true, 'the authoritative pre-dispatch gate agrees');

  assert.equal(gate(home, job(OPUS, 'opusclip', 'Product Intern')).reason, 'already_attempted_fp', 'an uncorrected legacy line still blocks');
  assert.equal(gate(home, job(CREATIFY2, 'creatify', 'Growth Intern')).reason, 'already_attempted_fp', 'the other creatify line is untouched');
});

// verify 第 12 轮 P3：对真投过的行（同属 legacy_unverified）随手写个证据就能更正放行。
// 必须同时给出岗位链接，与目标行对得上（按岗位指纹比，/application 尾巴等不算差异）；证据太短拒绝。
test('P3：--url 与目标行对不上 / 没给 --url / 证据少于 10 字——响亮拒绝，账本不动', () => {
  const home = homeWithHistory();
  const before = readFileSync(ledgerPath(home), 'utf8');
  const cases = [
    [['--of', 'led_opus', '--url', CREATIFY, '--verdict', 'not_submitted', '--evidence', EV, '--apply'], /--url .* is not the job of led_opus/],
    [['--of', 'led_opus', '--verdict', 'not_submitted', '--evidence', EV, '--apply'], /--url/],
    [['--of', 'led_creatify_pm', '--url', CREATIFY, '--verdict', 'not_submitted', '--evidence', '没投成', '--apply'], /at least 10 characters/],
  ];
  for (const [args, msg] of cases) {
    const r = cli(home, args);
    assert.equal(r.status, 1, `${args.join(' ')} → ${r.stderr}`);
    assert.match(r.stderr, msg);
  }
  assert.equal(readFileSync(ledgerPath(home), 'utf8'), before);
  const noTail = CREATIFY.replace(/\/application$/, '');
  const ok = cli(home, ['--of', 'led_creatify_pm', '--url', noTail, '--verdict', 'not_submitted', '--evidence', EV]);
  assert.equal(ok.status, 0, `same job, link without /application: ${ok.stderr}`);
});

// verify 第 12 轮 P4：`--evidence --apply` 把「--apply」当证据吞掉。
test('P4：参数值以 -- 开头（漏写了值）→ 响亮拒绝，不当成值、不写账', () => {
  const home = homeWithHistory();
  const before = readFileSync(ledgerPath(home), 'utf8');
  for (const args of [
    ['--of', 'led_creatify_pm', '--url', CREATIFY, '--verdict', 'not_submitted', '--evidence', '--apply'],
    ['--of', '--url', CREATIFY, '--verdict', 'not_submitted', '--evidence', EV, '--apply'],
    ['--of', 'led_creatify_pm', '--url', CREATIFY, '--verdict', '--evidence', EV, '--apply'],
  ]) {
    const r = cli(home, args);
    assert.equal(r.status, 1, `${args.join(' ')} → ${r.stderr}`);
    assert.match(r.stderr, /needs a value/);
  }
  assert.equal(readFileSync(ledgerPath(home), 'utf8'), before);
});
