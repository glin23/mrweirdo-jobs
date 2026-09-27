// 首次真投（2026-09-26 Tavus）：Ashby 反垃圾拦截「flagged as possible spam」。
// 判定：页面明说没收到 → 不算投过（不占同公司 60 天名额、不占今日档位），但同岗不自动重投
// （再自动投一次多半同样被拦；用户可手投后 record-manual）。3 行报告如实说。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveMayHaveSubmitted, SPAM_FLAGGED_MAY_HAVE_SUBMITTED } from '../shared/driver_contract.mjs';
import { submissionVerdict } from '../shared/submission_evidence.mjs';
import { append, readAll } from '../shared/submission_ledger.mjs';
import { attemptIndex, identityBlock } from '../shared/apply_guard.mjs';
import { seenIndex } from '../shared/seen_log.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeStreamRig, job } from './stream_run_harness.mjs';

const PAGE = readFileSync(new URL('./fixtures/submission_pages/deny_tavus_spam_flagged.txt', import.meta.url), 'utf8');
const NO_SEEN = { index: seenIndex([]), basis: { scoring: 's', fill: 'f' } };
const TAVUS = 'https://jobs.ashbyhq.com/tavus/c90f76b1-c2c7-4410-af78-f3f6b126c87d/application';

test('判定器：Tavus 反垃圾横幅原文 → not_submitted，deny 命中 platform_spam_flagged', () => {
  const v = submissionVerdict({ bodyText: PAGE, url: TAVUS });
  assert.equal(v.verdict, 'not_submitted');
  assert.ok(v.denyHits.includes('platform_spam_flagged'));
});

test('投过口径：platform_spam_flagged 按单一常量判（默认 false = 没到对方手里）', () => {
  assert.equal(SPAM_FLAGGED_MAY_HAVE_SUBMITTED, false);
  const v = submissionVerdict({ bodyText: PAGE, url: TAVUS });
  assert.equal(deriveMayHaveSubmitted({ outcome: 'not_submitted', reason: 'platform_spam_flagged', verdict: v }), false);
  assert.equal(deriveMayHaveSubmitted({ outcome: 'not_submitted', reason: 'page_states_failure', verdict: v }), true, 'other page failures unchanged');
});

test('闸：被拦的岗不占同公司 60 天名额和今日档位，但同岗 60 天内不自动重投', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-spam-'));
  append(home, { era: 'v2', job_id: 100001, apply_url: TAVUS, company_key: 'tavus', title_key: 'vibe growth marketer', ats: 'ashby', outcome: 'not_submitted', verdict: 'not_submitted', may_have_submitted: false, reason: 'platform_spam_flagged', evidence: null, answers: [], work_auth_provenance: null });
  const idx = attemptIndex(readAll(home));
  assert.equal(idx.todayCount, 0);
  assert.equal((idx.byCompany.get('tavus') || []).length, 0);
  assert.equal(identityBlock({ apply_url: TAVUS, company: 'tavus', title: 'Vibe Growth Marketer' }, idx, new Date(), NO_SEEN).reason, 'platform_spam_flagged_60d');
  assert.equal(identityBlock({ apply_url: 'https://jobs.ashbyhq.com/tavus/00000000-0000-0000-0000-0000000000b1', company: 'tavus', title: 'Product Manager' }, idx, new Date(), NO_SEEN).ok, true, 'another Tavus job is not blocked');
});

test('3 行报告第 2 行：「被平台当成垃圾申请拦下，没收到」，不说「判不确定」、不算「表单没打开」', async () => {
  const rig = await makeStreamRig('mrw-stream-spam-');
  try {
    const j = job('Tavus', 1, { fit: true });
    rig.board({ rotation: [j] });
    rig.script({ [j.apply_url]: { outcome: 'not_submitted', reason: 'platform_spam_flagged', verdict: { verdict: 'not_submitted', confirmHits: [], denyHits: ['couldnt_submit', 'platform_spam_flagged'] }, evidence: { path: '/tmp/shot.png' } } });
    const r = await rig.run(1);
    assert.match(r.finish.lines[0], /^投出 0 个/);
    assert.match(r.finish.lines[1], /1 个被平台当成垃圾申请拦下，没收到/);
    assert.doesNotMatch(r.finish.lines[1], /判不确定|表单没打开/);
    const line = readAll(rig.home).find((e) => e.apply_url === j.apply_url);
    assert.equal(line.may_have_submitted, false);
    assert.equal(line.reason, 'platform_spam_flagged');
  } finally {
    await rig.close();
  }
});

test('verify 第 17 轮 P2：成功 + spam 双命中 → 判定器 unknown，投过口径 true（占名额）', () => {
  const ok = readFileSync(new URL('./fixtures/submission_pages/confirm_ashby_success.txt', import.meta.url), 'utf8');
  const v = submissionVerdict({ bodyText: `${ok}\n${PAGE}`, url: TAVUS });
  assert.equal(v.verdict, 'unknown');
  assert.equal(deriveMayHaveSubmitted({ outcome: 'not_submitted', reason: 'platform_spam_flagged', verdict: v }), true, 'only a verdict of "not submitted" earns the exemption');
});
