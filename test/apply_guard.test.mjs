// 投前权威闸（restart-apply DESIGN §3 checkDispatch / ADR-S6 / ADR-S7）。
// 「投过」唯一口径 = may_have_submitted===true，重投拦截、同公司 60 天、日额度
// 三处共用；点提交前失败按单一常量限次重试。纯函数，全部用构造的账本行。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TIERS,
  COMPANY_MAX_60D,
  PRE_SUBMIT_RETRIES_60D,
  attemptIndex,
  isAttempted,
  dailyTier,
  budgetLine,
  checkDispatch,
  preSubmitFailCount,
  priorApplicationToCompany,
  breaker,
  readInflight,
  writeInflight,
  clearInflight,
} from '../shared/apply_guard.mjs';
import { append, appendCorrection, readAll } from '../shared/submission_ledger.mjs';

const TZ = 'America/New_York';
const NOW = new Date('2026-09-25T18:00:00Z'); // 14:00 EDT
const DAY = 24 * 3600 * 1000;
const ago = (days) => new Date(NOW.getTime() - days * DAY).toISOString();
const gh = (n) => `https://boards.greenhouse.io/acme/jobs/${n}`;

let seq = 0;
function entry(over = {}) {
  seq += 1;
  return {
    id: `led_${seq}`,
    ts: ago(1),
    era: 'v2',
    job_id: 100000 + seq,
    apply_url: gh(seq),
    company_key: 'acme',
    title_key: `role ${seq}`,
    ats: 'greenhouse',
    outcome: 'submitted',
    verdict: 'submitted',
    may_have_submitted: true,
    reason: null,
    correction_of: null,
    ...over,
  };
}
// For append(): no id/ts/correction_of — the ledger fills them.
function fresh(over = {}) {
  const { id: _i, correction_of: _c, ...rest } = entry(over);
  return rest;
}
const job = (over = {}) => ({ apply_url: gh(999999), company: 'Other Co', title: 'Growth Intern', ...over });
const budget = (over = {}) => ({ target: 10, tier: 10, attempted_today: 0, max_attempts: 10, ...over });

test('isAttempted 只认 may_have_submitted===true；缺字段的行让索引响亮报错', () => {
  assert.equal(isAttempted(entry()), true);
  assert.equal(isAttempted(entry({ may_have_submitted: false })), false);
  const { may_have_submitted: _m, ...bare } = entry();
  assert.throws(() => attemptIndex([bare], NOW, TZ), /may_have_submitted/);
});

test('规则 2：指纹命中「投过」→ already_attempted_fp（公司标题都不同也拦）', () => {
  const prior = entry({ apply_url: gh(42) });
  const idx = attemptIndex([prior], NOW, TZ);
  const v = checkDispatch(job({ apply_url: 'https://job-boards.greenhouse.io/other/jobs/42?x=1' }), idx, budget(), NOW);
  assert.deepEqual(v, { ok: false, reason: 'already_attempted_fp', ref_ledger_id: prior.id });
});

test('规则 3：公司+标题命中「投过」→ already_attempted_company_title（重发换编号也拦）', () => {
  const prior = entry({ company_key: 'otherco', title_key: 'growth intern', ts: ago(400) });
  const idx = attemptIndex([prior], NOW, TZ);
  const v = checkDispatch(job({ company: 'OtherCo, Inc.', title: 'Growth Internship' }), idx, budget(), NOW);
  assert.equal(v.reason, 'already_attempted_company_title');
});

test('反例：可能已提交=false 的行不算投过——同指纹、同公司标题都放行', () => {
  const idx = attemptIndex([entry({ apply_url: gh(42), company_key: 'other', title_key: 'growth intern', outcome: 'crashed', verdict: 'unknown', may_have_submitted: false, reason: 'resume_upload_failed' })], NOW, TZ);
  assert.deepEqual(checkDispatch(job({ apply_url: gh(42) }), idx, budget(), NOW), { ok: true, reason: null, ref_ledger_id: null });
});

test('规则 4：同公司 60 天内投过已满 2 次 → company_cooldown_60d；第 61 天放行', () => {
  const two = [entry({ company_key: 'other', ts: ago(10) }), entry({ company_key: 'other', ts: ago(59) })];
  assert.equal(COMPANY_MAX_60D, 2);
  assert.equal(checkDispatch(job(), attemptIndex(two, NOW, TZ), budget(), NOW).reason, 'company_cooldown_60d');
  const oneOld = [entry({ company_key: 'other', ts: ago(10) }), entry({ company_key: 'other', ts: ago(61) })];
  assert.equal(checkDispatch(job(), attemptIndex(oneOld, NOW, TZ), budget(), NOW).ok, true);
  const oneOnly = [entry({ company_key: 'other', ts: ago(10) })];
  assert.equal(checkDispatch(job(), attemptIndex(oneOnly, NOW, TZ), budget(), NOW).ok, true);
});

test('规则 5：同指纹 60 天内点提交前失败——常量 PRE_SUBMIT_RETRIES_60D=1：失败 1 次放行、2 次拦、最早一次滑出 60 天放行', () => {
  assert.equal(PRE_SUBMIT_RETRIES_60D, 1);
  const fail = (days) => entry({ apply_url: gh(7), outcome: 'crashed', verdict: 'unknown', may_have_submitted: false, reason: 'ashby_form_not_loaded', ts: ago(days) });
  const j = job({ apply_url: gh(7) });
  const once = attemptIndex([fail(3)], NOW, TZ);
  assert.equal(preSubmitFailCount(once, 'greenhouse:7', NOW), 1);
  assert.equal(checkDispatch(j, once, budget(), NOW).ok, true);
  const twice = attemptIndex([fail(3), fail(1)], NOW, TZ);
  assert.equal(checkDispatch(j, twice, budget(), NOW).reason, 'pre_submit_retry_exhausted');
  const slid = attemptIndex([fail(61), fail(1)], NOW, TZ);
  assert.equal(preSubmitFailCount(slid, 'greenhouse:7', NOW), 1);
  assert.equal(checkDispatch(j, slid, budget(), NOW).ok, true);
});

test('点提交前失败不进「今日已尝试」、不进同公司 60 天计数；needs_user 不算点提交前失败', () => {
  const rows = [
    entry({ company_key: 'other', ts: ago(0.1), outcome: 'crashed', verdict: 'unknown', may_have_submitted: false, reason: 'resume_upload_failed' }),
    entry({ company_key: 'other', ts: ago(0.1), outcome: 'crashed', verdict: 'unknown', may_have_submitted: false, reason: 'ashby_form_not_loaded' }),
    entry({ apply_url: gh(8), ts: ago(0.1), outcome: 'needs_user', verdict: 'unknown', may_have_submitted: false, reason: 'fit_below_threshold' }),
  ];
  const idx = attemptIndex(rows, NOW, TZ);
  assert.equal(idx.todayCount, 0);
  assert.equal(checkDispatch(job(), idx, budget(), NOW).ok, true);
  assert.equal(preSubmitFailCount(idx, 'greenhouse:8', NOW), 0);
});

test('规则 1：今日额度用完 → daily_cap_reached；本次目标已满 → run_target_reached', () => {
  const today = Array.from({ length: 3 }, () => entry({ ts: ago(0.1) }));
  const idx = attemptIndex(today, NOW, TZ);
  assert.equal(idx.todayCount, 3);
  assert.equal(checkDispatch(job(), idx, budget({ tier: 3, attempted_today: 0, max_attempts: 10 }), NOW).reason, 'daily_cap_reached');
  assert.equal(checkDispatch(job(), idx, budget({ tier: 10, attempted_today: 1, max_attempts: 2 }), NOW).reason, 'run_target_reached');
  assert.equal(checkDispatch(job(), idx, budget({ tier: 10, attempted_today: 1, max_attempts: 3 }), NOW).ok, true);
});

test('「今日」按本机时区自然日：美东晚 9 点投的仍是今天，不按 UTC 跨日', () => {
  const lateEvening = new Date('2026-09-26T01:30:00Z'); // 21:30 EDT on 09-25
  const idx = attemptIndex([entry({ ts: '2026-09-25T13:00:00Z' }), entry({ ts: '2026-09-24T23:00:00Z' })], lateEvening, TZ);
  assert.equal(idx.todayCount, 1, '09-24 19:00 EDT is yesterday; 09-25 09:00 EDT is today');
});

test('更正行生效：被更正成 may_have_submitted=false 的行不再算投过', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-guard-correction-'));
  const orig = append(home, fresh());
  appendCorrection(home, orig.id, { may_have_submitted: false }, 'proof.png');
  const idx = attemptIndex(readAll(home), NOW, TZ);
  assert.equal(checkDispatch(job({ apply_url: orig.apply_url }), idx, budget(), NOW).ok, true);
});

test('派单路径上推不出指纹 = bug，响亮报错', () => {
  assert.throws(() => checkDispatch(job({ apply_url: 'https://acme.wd5.myworkdayjobs.com/x' }), attemptIndex([], NOW, TZ), budget(), NOW), /fingerprint/);
});

test('dailyTier：缺省 10；只认 10/25/50；>30 没有确认参数响亮失败', () => {
  assert.deepEqual(TIERS, [10, 25, 50]);
  assert.equal(dailyTier({}, false), 10);
  assert.equal(dailyTier({ MRWEIRDO_DAILY_TIER: '25' }, false), 25);
  assert.throws(() => dailyTier({ MRWEIRDO_DAILY_TIER: '50' }, false), /confirm-tier-over-30/);
  assert.equal(dailyTier({ MRWEIRDO_DAILY_TIER: '50' }, true), 50);
  assert.throws(() => dailyTier({ MRWEIRDO_DAILY_TIER: '12' }, false), /10\|25\|50/);
});

test('budgetLine：max_attempts = min(N, 档位 − 今日已尝试)；看的上限 ×10；人话第一行', () => {
  const idx3 = attemptIndex(Array.from({ length: 3 }, () => entry({ ts: ago(0.1) })), NOW, TZ);
  const b = budgetLine(idx3, 50, 10);
  assert.equal(b.attempted_today, 3);
  assert.equal(b.max_attempts, 7);
  assert.equal(b.max_scored, 70);
  assert.match(b.line, /你要 50.*档位 10.*已尝试 3\/10.*最多投 7/);
  const full = budgetLine(attemptIndex(Array.from({ length: 10 }, () => entry({ ts: ago(0.1) })), NOW, TZ), 5, 10);
  assert.equal(full.max_attempts, 0);
  assert.match(full.line, /本次投 0/);
  assert.match(budgetLine(attemptIndex([], NOW, TZ), 10, 10).line, /本次目标投 10.*今日额度剩 10/);
  assert.throws(() => budgetLine(attemptIndex([], NOW, TZ), 0, 10), /target/);
});

test('priorApplicationToCompany：账本里投过这家（含历史）→ true', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-guard-prior-'));
  assert.equal(priorApplicationToCompany(home, 'Acme Inc.'), false);
  append(home, fresh({ company_key: 'acme', may_have_submitted: false, outcome: 'crashed', verdict: 'unknown', reason: 'resume_upload_failed' }));
  assert.equal(priorApplicationToCompany(home, 'Acme Inc.'), false, 'a pre-submit failure never reached them');
  append(home, fresh({ company_key: 'acme', era: 'legacy', verdict: 'legacy_unverified', outcome: 'legacy_submitted' }));
  assert.equal(priorApplicationToCompany(home, 'Acme Inc.'), true);
});

test('breaker：最近 3 个同为 unknown / crashed / captcha_blocked 才熔断', () => {
  assert.equal(breaker(['crashed', 'crashed']).open, false);
  assert.deepEqual(breaker(['submitted', 'crashed', 'crashed', 'crashed']), { open: true, outcome: 'crashed', count: 3 });
  assert.equal(breaker(['unknown', 'unknown', 'unknown']).open, true);
  assert.equal(breaker(['captcha_blocked', 'captcha_blocked', 'captcha_blocked']).open, true);
  assert.equal(breaker(['crashed', 'unknown', 'crashed']).open, false);
  assert.equal(breaker(['needs_user', 'needs_user', 'needs_user']).open, false);
});

test('在途标记：写入即 600、读回、清除；缺字段响亮报错', async () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-guard-inflight-'));
  assert.equal(readInflight(home), null);
  const m = { run_id: 'r1', work_db: '/tmp/x.db', row_id: 5, apply_url: gh(5), result_file: '/tmp/r.jsonl', started_at: NOW.toISOString() };
  const p = writeInflight(home, m);
  const { statSync } = await import('node:fs');
  assert.equal(statSync(p).mode & 0o777, 0o600);
  assert.deepEqual(readInflight(home), m);
  assert.throws(() => writeInflight(home, { ...m, apply_url: undefined }), /apply_url/);
  assert.throws(() => writeInflight(home, m), /already/, 'a second marker would overwrite an unresolved attempt');
  clearInflight(home);
  assert.equal(readInflight(home), null);
});
