// restart-apply-3 BUG_REPORT 第 4 章（2026-09-27 Reevo ×2 needs_user / stuck_on_same_missing）：
//   ① 城市多选题「Which location(s) would you be open to working from?」（San Francisco / Santa Clara /
//      Both 三个勾选框）被当成是/否题去找 Yes 按钮 → 补不上。按档案的可搬迁 / 城市规则勾选；外国城市照问。
//   ② 薪资是数字框，驱动往里打了英文句子还报成功。数字框只填从档案解析出的数字，单位对不上 / 解析不出就挂起；
//      打完回读框里的值，没进去就报补不上。
//   ③ 这个出口的缺项字段叫 missing，不是 still_missing：读的一方统一用 pageMissingOf。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salaryNumberFor, isWorkLocationChoiceQuestion, pickWorkLocations } from '../shared/answer_routing.mjs';
import { pageMissingOf, deriveMayHaveSubmitted } from '../shared/driver_contract.mjs';
import { loadDriver, BASE } from './ashby_driver_harness.mjs';

const REEVO_Q = 'This role is primarily in-office. Which location(s) would you be open to working from?';
const SALARY_Q = 'What are your base salary expectations for this position?';
const HOURLY = { work_authorization: { salary_expectation_usd: '$20/hr' } };
const INTENT_US = { search_intent: { geographic_preference: { primary_country: 'US', relocation_policy: 'anywhere_primary_country', willing_to_relocate_for_internship: true, remote_acceptable: true, excluded_locations: ['Singapore'] } } };
const INTENT_STAY = { search_intent: { geographic_preference: { primary_country: 'US', willing_to_relocate_for_internship: false } } };

// ---------------------------------------------------------------- 薪资数字

test('薪资：档案是时薪 $20/hr、题目问 base salary（年薪）→ 单位对不上，不编年薪，挂起', () => {
  const r = salaryNumberFor(SALARY_Q, HOURLY);
  assert.equal(r.ok, false);
  assert.equal(r.note, 'salary_unit_mismatch');
});

test('薪资：题目问时薪 → 填 20', () => {
  assert.deepEqual(salaryNumberFor('What is your expected hourly rate?', HOURLY), { ok: true, value: '20', unit: 'hour' });
});

test('薪资：题目没说单位（compensation expectations）→ 用档案的数', () => {
  assert.equal(salaryNumberFor('Compensation expectations', HOURLY).value, '20');
});

test('薪资：年薪写法 $85,000 / 85k 都解析成 85000', () => {
  assert.equal(salaryNumberFor(SALARY_Q, { work_authorization: { salary_expectation_usd: '$85,000' } }).value, '85000');
  assert.equal(salaryNumberFor(SALARY_Q, { standard_qa: { salary_expectation_usd: '85k' } }).value, '85000');
});

test('薪资：档案里没有 → salary_number_unset；只有文字没有数字 → 同样挂起', () => {
  assert.equal(salaryNumberFor(SALARY_Q, {}).note, 'salary_number_unset');
  assert.equal(salaryNumberFor(SALARY_Q, { work_authorization: { salary_expectation_usd: 'Negotiable' } }).note, 'salary_number_unset');
});

test('薪资：档案字段缺时读 essay_profile 的 expected_salary_number（与 Lever 同一顺序）', () => {
  const r = salaryNumberFor('Hourly pay expectation', {}, { factual_gap_fields: { compensation_acceptance: { expected_salary_number: '$20/hr' } } });
  assert.equal(r.value, '20');
});

test('薪资：用户回答过这道题（缺口报告写进 custom_facts，键 = 题目）→ 下次直接用这个数，不再问', async () => {
  const { customFactKey } = await import('../shared/missing_field_questions.mjs');
  const profile = { ...HOURLY, standard_qa: { custom_facts: { [customFactKey(SALARY_Q)]: '$95,000' } } };
  assert.deepEqual(salaryNumberFor(SALARY_Q, profile), { ok: true, value: '95000', unit: 'year' });
});

// ---------------------------------------------------------------- 城市多选

test('城市多选：识别「Which location(s) would you be open to working from?」这类题', () => {
  assert.equal(isWorkLocationChoiceQuestion(REEVO_Q), true);
  assert.equal(isWorkLocationChoiceQuestion('Which office would you prefer to work from?'), true);
  assert.equal(isWorkLocationChoiceQuestion('Which of our locations are you interested in?'), true);
  assert.equal(isWorkLocationChoiceQuestion('What is your current location?'), false);
  assert.equal(isWorkLocationChoiceQuestion('Are you willing to work from our NYC office 5 days a week?'), false);
});

test('城市多选（Reevo）：全美可搬 + 都是美国城市 → 勾「Both」', () => {
  const r = pickWorkLocations(['San Francisco', 'Santa Clara', 'Both'], { searchIntent: INTENT_US, profile: BASE, jobLocation: 'San Francisco or Santa Clara', questionText: REEVO_Q });
  assert.deepEqual(r, { ok: true, picks: ['Both'] });
});

test('城市多选：没有「全部」选项 → 勾所有美国城市', () => {
  const r = pickWorkLocations(['San Francisco', 'New York'], { searchIntent: INTENT_US, profile: BASE, jobLocation: 'San Francisco', questionText: REEVO_Q });
  assert.deepEqual(r, { ok: true, picks: ['San Francisco', 'New York'] });
});

test('城市多选：选项里有外国城市 → 照问（挂起），不替用户勾', () => {
  const r = pickWorkLocations(['San Francisco', 'London', 'Both'], { searchIntent: INTENT_US, profile: BASE, jobLocation: 'San Francisco', questionText: REEVO_Q });
  assert.equal(r.ok, false);
  assert.equal(r.note, 'work_location_needs_user');
  assert.deepEqual(r.unconfirmed, ['London']);
});

test('城市多选：用户不搬家 → 只有档案里确认过的城市算数；别的城市照问', () => {
  const profile = { ...BASE, standard_qa: { work_location_commitments: { 'San Francisco': true } } };
  assert.deepEqual(pickWorkLocations(['San Francisco'], { searchIntent: INTENT_STAY, profile, jobLocation: 'San Francisco', questionText: REEVO_Q }), { ok: true, picks: ['San Francisco'] });
  const r = pickWorkLocations(['San Francisco', 'Santa Clara'], { searchIntent: INTENT_STAY, profile, jobLocation: 'San Francisco or Santa Clara', questionText: REEVO_Q });
  assert.equal(r.ok, false);
  assert.deepEqual(r.unconfirmed, ['Santa Clara']);
});

test('城市多选：认不出的选项（既不在岗位地点里、也不是已知美国地名）→ 照问', () => {
  const r = pickWorkLocations(['San Francisco', 'Springfield Campus Z9'], { searchIntent: INTENT_US, profile: BASE, jobLocation: 'San Francisco', questionText: REEVO_Q });
  assert.equal(r.ok, false);
});

// ---------------------------------------------------------------- 驱动里真走一遍

async function ask(profile, label, rules, opts = {}) {
  const d = await loadDriver(profile, opts);
  globalThis.__MRW_EVAL_RULES = rules;
  try {
    return { res: await d.answerMissing('tab-1', label), cdp: globalThis.__MRW_CDP };
  } finally {
    delete globalThis.__MRW_EVAL_RULES;
    delete globalThis.__MRW_CDP_RULES;
  }
}

test('驱动（Reevo 城市多选）：读出勾选项 → 勾「Both」，不再去找 Yes 按钮', async () => {
  let clicked = null;
  const { res } = await ask(BASE, REEVO_Q, [
    { match: 'mrw_location_choices', result: { ok: true, type: 'checkbox', labels: ['San Francisco', 'Santa Clara', 'Both'] } },
    { match: 'mrw_click_choices', result: (js) => { clicked = JSON.parse(js.match(/const picks = (\[.*?\]);/)[1]); return { ok: true, picked: clicked }; } },
  ], { searchIntent: INTENT_US });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(clicked, ['Both']);
  assert.equal(res.value, 'Both');
});

test('驱动（城市多选）：有外国城市 → pending 给主 agent 问用户，一个都不勾', async () => {
  let clicked = false;
  const { res } = await ask(BASE, REEVO_Q, [
    { match: 'mrw_location_choices', result: { ok: true, type: 'checkbox', labels: ['San Francisco', 'London'] } },
    { match: 'mrw_click_choices', result: () => { clicked = true; return { ok: true }; } },
  ], { searchIntent: INTENT_US });
  assert.equal(res.ok, false);
  assert.equal(res.pending_for_main_claude, true);
  assert.equal(clicked, false);
});

test('驱动（城市多选）：勾了但页面上没勾上 → 报补不上，不报成功', async () => {
  const { res } = await ask(BASE, REEVO_Q, [
    { match: 'mrw_location_choices', result: { ok: true, type: 'checkbox', labels: ['San Francisco', 'Both'] } },
    { match: 'mrw_click_choices', result: { ok: false, note: 'choice_not_checked', picked: [] } },
  ], { searchIntent: INTENT_US });
  assert.equal(res.ok, false);
});

const numberBox = { match: 'label_for', result: { ok: true, sel: '#sal', via: 'label_for', type: 'number' } };
const typedInto = (cdp, sel) => cdp.filter((a) => a[0] === 'typetext' && a[2] === sel).map((a) => a[3]);

test('驱动（Reevo 薪资数字框）：档案只有时薪 → 挂起问用户，不往数字框里打英文', async () => {
  const { res, cdp } = await ask({ ...BASE, ...HOURLY }, SALARY_Q, [numberBox]);
  assert.equal(res.ok, false);
  assert.equal(res.pending_for_main_claude, true);
  assert.equal(res.note, 'salary_unit_mismatch');
  assert.deepEqual(typedInto(cdp, '#sal'), []);
});

test('驱动（薪资数字框）：档案有年薪 → 只打数字', async () => {
  const { res, cdp } = await ask({ ...BASE, work_authorization: { salary_expectation_usd: '$90,000' } }, SALARY_Q, [numberBox]);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(typedInto(cdp, '#sal'), ['90000']);
});

test('驱动（薪资文字框）：照旧填文字说明', async () => {
  const { res, cdp } = await ask({ ...BASE, ...HOURLY }, SALARY_Q, [{ match: 'label_for', result: { ok: true, sel: '#salt', via: 'label_for', type: 'text' } }]);
  assert.equal(res.ok, true);
  assert.equal(typedInto(cdp, '#salt').length, 1);
  assert.match(typedInto(cdp, '#salt')[0], /[A-Za-z]/);
});

test('驱动（回读）：打完框里的值不是打进去的 → 补不上（value_not_accepted），不报成功', async () => {
  const d = await loadDriver(BASE);
  globalThis.__MRW_EVAL_RULES = [{ match: 'label_for', result: { ok: true, sel: '#li', via: 'label_for', type: 'text' } }];
  globalThis.__MRW_CDP_RULES = [{ match: 'typetext', result: { stdout: JSON.stringify({ ok: true, value: '', verified: false }), stderr: '' } }];
  try {
    const res = await d.answerMissing('tab-1', 'LinkedIn Profile');
    assert.equal(res.ok, false);
    assert.equal(res.note, 'value_not_accepted');
  } finally {
    delete globalThis.__MRW_EVAL_RULES;
    delete globalThis.__MRW_CDP_RULES;
  }
});

test('驱动（回读）：电话这类带格式的框，数字一致就算进去了', async () => {
  const d = await loadDriver(BASE);
  globalThis.__MRW_EVAL_RULES = [{ match: 'label_for', result: { ok: true, sel: '#ph', via: 'label_for', type: 'text' } }, { match: 'mrw_phone_retry', result: { ok: false } }];
  globalThis.__MRW_CDP_RULES = [{ match: 'typetext', result: { stdout: JSON.stringify({ ok: true, value: '(555) 010-0', verified: false }), stderr: '' } }];
  try {
    const res = await d.answerMissing('tab-1', 'Primary phone');
    assert.equal(res.ok, true, JSON.stringify(res));
  } finally {
    delete globalThis.__MRW_EVAL_RULES;
    delete globalThis.__MRW_CDP_RULES;
  }
});

// ---------------------------------------------------------------- 缺项字段统一读取

test('缺项：stuck 出口的 missing、essay_pending 出口的 still_missing，读的一方拿到同一份清单', () => {
  const stuck = { outcome: 'needs_user', reason: 'stuck_on_same_missing', missing: ['A', 'B'] };
  const essay = { outcome: 'needs_user', reason: 'essay_pending', still_missing: ['C'] };
  assert.deepEqual(pageMissingOf(stuck), ['A', 'B']);
  assert.deepEqual(pageMissingOf(essay), ['C']);
  assert.deepEqual(pageMissingOf({ outcome: 'unknown' }), []);
  assert.equal(deriveMayHaveSubmitted(stuck), false);
  assert.equal(deriveMayHaveSubmitted(essay), false);
});

test('薪资：用户对这道时薪题只答了「25」→ 按题目的单位算，填 25', async () => {
  const { customFactKey } = await import('../shared/missing_field_questions.mjs');
  const Q = 'What is your expected hourly rate?';
  assert.deepEqual(salaryNumberFor(Q, { standard_qa: { custom_facts: { [customFactKey(Q)]: '25' } } }), { ok: true, value: '25', unit: 'hour' });
});
