// 「可能已提交」推导（restart-apply DESIGN §3 / ADR-S6 第 2 轮）。
// may_have_submitted 是「投过」的唯一口径；推导只在 driver_contract 一处。
// 出口表 PRE_SUBMIT_EXITS 里的（读码确认在第一次点提交之前）判 false，
// 其余一律 true——拿不准宁可少重试一次，也不许重投一次（lead 裁决未明点 7）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRE_SUBMIT_EXITS, PRE_DISPATCH_STAGE, deriveMayHaveSubmitted } from '../shared/driver_contract.mjs';

const [o, r] = [(k) => k.split(':')[0], (k) => k.split(':').slice(1).join(':')];

test('出口表里每一对各判 false（驱动还没点提交）', () => {
  assert.ok(PRE_SUBMIT_EXITS.size >= 8);
  for (const key of PRE_SUBMIT_EXITS) {
    assert.equal(deriveMayHaveSubmitted({ outcome: o(key), reason: r(key) }), false, key);
  }
});

test('出口表的每一行都真实存在于某个驱动的出口上（表不许烂掉）', () => {
  const src = ['greenhouse_apply_driver.mjs', 'ashby_apply_driver.mjs', 'lever_apply_driver.mjs']
    .map((f) => readFileSync(new URL(`../shared/${f}`, import.meta.url), 'utf8')).join('\n');
  for (const key of PRE_SUBMIT_EXITS) {
    assert.ok(src.includes(`outcome: '${o(key)}', reason: '${r(key)}'`), `no driver exit emits ${key}`);
  }
});

test('读过提交后页面（带 verdict）一律 true，即使 outcome:reason 在表里', () => {
  assert.equal(deriveMayHaveSubmitted({ outcome: 'not_submitted', reason: 'job_unavailable', verdict: { verdict: 'not_submitted' } }), true);
  assert.equal(deriveMayHaveSubmitted({ outcome: 'unknown', reason: 'no_errors_no_success', verdict: 'unknown' }), true);
});

test('崩在哪一步说不清的一律 true', () => {
  for (const reason of ['driver_exception', 'driver_died_without_outcome', 'recovered_inflight']) {
    assert.equal(deriveMayHaveSubmitted({ outcome: 'crashed', reason }), true, reason);
  }
  assert.equal(deriveMayHaveSubmitted({ outcome: 'submitted', verdict: 'submitted' }), true);
  assert.equal(deriveMayHaveSubmitted({ outcome: 'not_submitted', reason: 'page_states_failure' }), true);
});

test('出口表外的新 reason 判 true（漏登记只会少重试，不会重投）', () => {
  assert.equal(deriveMayHaveSubmitted({ outcome: 'crashed', reason: 'some_new_exit' }), true);
  assert.equal(deriveMayHaveSubmitted({ outcome: 'crashed' }), true);
});

test('未明点 7：GH/Ashby 的 needs_user / captcha / rate_limited 都在点过提交之后 → true', () => {
  for (const [outcome, reason] of [
    ['needs_user', 'stuck_on_same_missing'],
    ['needs_user', 'essay_pending'],
    ['needs_user', 'cover_letter_required_not_generated'], // GH 点击后；Lever 同名出口在点击前 → 键撞车，保守 true
    ['needs_user', 'profile_specific_answer_required'],
    ['rate_limited', 'max_attempts_exceeded'],
    ['captcha_blocked', 'captcha_detected'],
  ]) {
    assert.equal(deriveMayHaveSubmitted({ outcome, reason }), true, `${outcome}:${reason}`);
  }
});

test('派单前校验没过（驱动根本没启动）→ false', () => {
  assert.equal(PRE_DISPATCH_STAGE, 'pre_dispatch');
  assert.equal(deriveMayHaveSubmitted({ outcome: 'needs_user', reason: 'fit_below_threshold', stage: PRE_DISPATCH_STAGE }), false);
});

test('输入不是合法结局 → 响亮报错，不猜', () => {
  assert.throws(() => deriveMayHaveSubmitted(null), /outcome/);
  assert.throws(() => deriveMayHaveSubmitted({ outcome: 'skip' }), /contract/);
});

// 回炉第 1 轮（VERIFY_REPORT 第 2 轮 P1）：按页面证据判，不按 reason 字符串判。
test('needs_user / rate_limited 带页面错误清单（表单被拒、留在表单上）→ false', () => {
  for (const o of [
    { outcome: 'needs_user', reason: 'stuck_on_same_missing', missing: ['Why us?'] },
    { outcome: 'needs_user', reason: 'profile_full_address_required', blockers: [], missing: ['Street address'] },
    { outcome: 'needs_user', reason: 'essay_pending', pending: [], still_missing: ['Why us?'] },
    { outcome: 'needs_user', reason: 'cover_letter_upload_failed', detail: {}, missing: ['Cover letter'] },
    { outcome: 'rate_limited', reason: 'max_attempts_exceeded', last_missing: ['Phone'] },
  ]) {
    assert.equal(deriveMayHaveSubmitted(o), false, `${o.outcome}:${o.reason}`);
  }
});

test('没有页面错误证据的仍保守 true（空清单、别的结局带清单都不算）', () => {
  assert.equal(deriveMayHaveSubmitted({ outcome: 'needs_user', reason: 'stuck_on_same_missing' }), true);
  assert.equal(deriveMayHaveSubmitted({ outcome: 'needs_user', reason: 'stuck_on_same_missing', missing: [] }), true);
  assert.equal(deriveMayHaveSubmitted({ outcome: 'rate_limited', reason: 'max_attempts_exceeded', last_missing: [] }), true);
  assert.equal(deriveMayHaveSubmitted({ outcome: 'crashed', reason: 'driver_exception', missing: ['x'] }), true);
  assert.equal(deriveMayHaveSubmitted({ outcome: 'unknown', reason: 'no_errors_no_success', missing: ['x'] }), true);
});
