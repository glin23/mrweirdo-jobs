// driver_contract — 统一退出契约（阶段 1 设计 §14 数字变真 / ADR-15）。
// 五种结局一个词汇表、一张退出码映射表、一个唯一出口；submitted 必须由页面判定
// 推出；旧词（skip/essay_pending/error）响亮拒绝而不是悄悄映射。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTCOMES,
  EXIT_CODES,
  FILL_SOURCES,
  validateOutcome,
  emitOutcome,
  recordFill,
} from '../shared/driver_contract.mjs';

test('契约词汇表与退出码映射：0 成功 / 1 崩溃 / 2 需人看 / 3 验证码 / 4 超限', () => {
  assert.deepEqual([...OUTCOMES].sort(), ['captcha_blocked', 'crashed', 'needs_user', 'not_submitted', 'rate_limited', 'submitted', 'unknown']);
  assert.equal(EXIT_CODES.submitted, 0);
  assert.equal(EXIT_CODES.crashed, 1);
  assert.equal(EXIT_CODES.needs_user, 2);
  assert.equal(EXIT_CODES.not_submitted, 2, 'not_submitted 归 2：需要人看');
  assert.equal(EXIT_CODES.unknown, 2, 'unknown 归 2：需要人看，绝不归 0');
  assert.equal(EXIT_CODES.captcha_blocked, 3);
  assert.equal(EXIT_CODES.rate_limited, 4);
  for (const o of OUTCOMES) assert.ok(o in EXIT_CODES, `outcome ${o} has an exit code`);
});

test('validateOutcome：旧词一律响亮拒绝，不做静默别名', () => {
  for (const legacy of ['skip', 'essay_pending', 'error', 'success', 'SUBMITTED']) {
    assert.throws(() => validateOutcome({ outcome: legacy }), /not in the contract/, `"${legacy}" must throw`);
  }
  assert.throws(() => validateOutcome(null));
  assert.throws(() => validateOutcome('submitted'));
  assert.throws(() => validateOutcome({ reason: 'no outcome key' }));
});

test('validateOutcome：submitted 必须由 verdict submitted 推出（反向不成立）', () => {
  assert.throws(() => validateOutcome({ outcome: 'submitted' }), /verdict/);
  assert.throws(() => validateOutcome({ outcome: 'submitted', verdict: 'unknown' }), /verdict/);
  assert.throws(() => validateOutcome({ outcome: 'submitted', verdict: { verdict: 'not_submitted' } }), /verdict/);
  // 两种合法形态：字符串与判定器完整对象。
  assert.equal(validateOutcome({ outcome: 'submitted', verdict: 'submitted' }).outcome, 'submitted');
  assert.equal(
    validateOutcome({ outcome: 'submitted', verdict: { verdict: 'submitted', confirmHits: ['ashby_success'], denyHits: [] } }).outcome,
    'submitted'
  );
  // 非 submitted 结局不要求 verdict（崩溃时根本没有页面可判）。
  assert.equal(validateOutcome({ outcome: 'crashed', reason: 'driver_died_without_outcome' }).outcome, 'crashed');
});

test('emitOutcome：一行 JSON + 映射退出码，是驱动唯一出口', () => {
  const calls = { logged: [], exited: [] };
  const io = { log: (s) => calls.logged.push(s), exit: (c) => calls.exited.push(c) };

  emitOutcome({ outcome: 'not_submitted', reason: 'page_states_failure', job_id: 7 }, io);
  assert.equal(calls.exited[0], 2);
  assert.equal(JSON.parse(calls.logged[0]).reason, 'page_states_failure');

  emitOutcome({ outcome: 'rate_limited', reason: 'max_attempts_exceeded' }, io);
  assert.equal(calls.exited[1], 4);

  // 非法结局在出口处也拦：说谎话的 JSON 一行都不许打出去。
  assert.throws(() => emitOutcome({ outcome: 'skip', reason: 'x' }, io), /not in the contract/);
  assert.equal(calls.logged.length, 2, 'rejected outcome must not be logged');
});

test('recordFill：FillEntry 四字段齐全、source 只认五种、value 序列化为字符串', () => {
  const answers = [];
  recordFill(answers, { label: 'Are you authorized to work?', value: 'Yes', source: 'profile', widget: 'combobox' });
  recordFill(answers, { label: 'GPA', value: 3.4, source: 'derived', widget: 'text' });
  assert.deepEqual(answers[0], { label: 'Are you authorized to work?', value: 'Yes', source: 'profile', widget: 'combobox' });
  assert.equal(answers[1].value, '3.4', 'numeric values serialize to string');
  assert.deepEqual(FILL_SOURCES, ['profile', 'bank_default', 'derived', 'user_confirmed', 'left_blank']);

  assert.throws(() => recordFill(answers, { label: 'X', value: 'y', source: 'guessed', widget: 'text' }), /source/);
  assert.throws(() => recordFill(answers, { value: 'y', source: 'profile', widget: 'text' }), /label/);
  assert.throws(() => recordFill('not-an-array', { label: 'X', value: 'y', source: 'profile', widget: 'text' }));
  assert.equal(answers.length, 2, 'failed entries must not half-land');
});
