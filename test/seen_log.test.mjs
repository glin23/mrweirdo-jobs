// 看过记录（restart-apply DESIGN §3 SeenLog / ADR-S5）。
// 记忆不是正典：丢了只多花打分钱、不会重投。只存最小字段（V13：不存 JD 正文、
// 不存答案），同一个键以最后一行为准，60 天压缩。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SEEN_RELPATH,
  compact,
  fillBasisVersion,
  jdHash,
  lookupSeen,
  readSeen,
  recordSeen,
  scoringBasisVersion,
  seenIndex,
  stillSeen,
} from '../shared/seen_log.mjs';

const NOW = new Date('2026-09-25T18:00:00Z');
const DAY = 24 * 3600 * 1000;
const ago = (d) => new Date(NOW.getTime() - d * DAY).toISOString();
const gh = (n) => `https://boards.greenhouse.io/acme/jobs/${n}`;
const home = () => mkdtempSync(join(tmpdir(), 'mrw-seen-'));
const rec = (over = {}) => ({
  ts: ago(1), code: 'not_fit', apply_url: gh(1), company: 'Acme', title: 'Growth Intern',
  jd_hash: 'aaaa', basis_version: 'b1', reason: 'fit_below_threshold', ...over,
});
const cand = (over = {}) => ({ apply_url: gh(1), company: 'Acme', title: 'Growth Intern', description: 'x', ...over });

test('recordSeen：只写最小字段（fp / company_key / title_key 由链接和名字推），文件 600', () => {
  const h = home();
  recordSeen(h, rec({ description: 'FULL JD TEXT', answers: [{ value: 'secret' }] }));
  const line = readFileSync(join(h, SEEN_RELPATH), 'utf8');
  assert.doesNotMatch(line, /FULL JD TEXT|secret|description|answers/);
  const [r] = readSeen(h);
  assert.deepEqual(Object.keys(r).sort(), ['apply_url', 'basis_version', 'code', 'company_key', 'fp', 'jd_hash', 'reason', 'title_key', 'ts']);
  assert.equal(r.fp, 'greenhouse:1');
  assert.equal(r.company_key, 'acme');
  assert.equal(statSync(join(h, SEEN_RELPATH)).mode & 0o777, 0o600);
});

test('recordSeen：未知 code、推不出指纹、缺依据版本都响亮失败', () => {
  const h = home();
  assert.throws(() => recordSeen(h, rec({ code: 'maybe' })), /code/);
  assert.throws(() => recordSeen(h, rec({ apply_url: 'https://acme.wd5.myworkdayjobs.com/x' })), /fingerprint/);
  assert.throws(() => recordSeen(h, rec({ basis_version: '' })), /basis_version/);
});

test('双钥匙：指纹命中或公司+标题命中都算同一岗位；同键以最后一行为准', () => {
  const idx = seenIndex([rec({ ts: ago(3), code: 'not_fit' }), rec({ ts: ago(1), code: 'expired', reason: null })].map(withKeys));
  assert.equal(lookupSeen(idx, cand()).length, 1);
  assert.equal(lookupSeen(idx, cand())[0].code, 'expired', 'later line wins');
  assert.equal(lookupSeen(idx, cand({ apply_url: gh(77) }))[0].code, 'expired', 'reposted with a new id: company+title still hits');
  assert.equal(lookupSeen(idx, cand({ company: 'Other', title: 'Other' })).length, 1, 'same id, renamed: fingerprint still hits');
  assert.deepEqual(lookupSeen(idx, cand({ apply_url: gh(2), company: 'Other' })), []);
});

test('stillSeen：not_fit / visa_blocked = 60 天内 + JD 没变 + 打分依据没变', () => {
  const basis = { scoring: 'b1', fill: 'f1' };
  for (const code of ['not_fit', 'visa_blocked']) {
    const r = withKeys(rec({ code }));
    assert.equal(stillSeen(r, { jd_hash: 'aaaa' }, basis, NOW), true);
    assert.equal(stillSeen(r, { jd_hash: 'bbbb' }, basis, NOW), false, 'JD changed');
    assert.equal(stillSeen(r, { jd_hash: 'aaaa' }, { ...basis, scoring: 'b2' }, NOW), false, 'resume / intent changed');
    assert.equal(stillSeen(withKeys(rec({ code, ts: ago(61) })), { jd_hash: 'aaaa' }, basis, NOW), false, '60 days passed');
  }
});

test('stillSeen：expired 看 JD；needs_info 看填表依据；held_for_review 7 天', () => {
  const basis = { scoring: 'b1', fill: 'f1' };
  const expired = withKeys(rec({ code: 'expired', ts: ago(400) }));
  assert.equal(stillSeen(expired, { jd_hash: 'aaaa' }, basis, NOW), true, 'expired is permanent while the JD is the same');
  assert.equal(stillSeen(expired, { jd_hash: 'cccc' }, basis, NOW), false);
  const needs = withKeys(rec({ code: 'needs_info', jd_hash: null, basis_version: 'f1', ts: ago(300) }));
  assert.equal(stillSeen(needs, { jd_hash: 'zzzz' }, basis, NOW), true);
  assert.equal(stillSeen(needs, { jd_hash: null }, basis, NOW), true, 'dispatch-time check has no JD');
  assert.equal(stillSeen(needs, { jd_hash: 'zzzz' }, { ...basis, fill: 'f2' }, NOW), false, 'profile answered → back in');
  const held = withKeys(rec({ code: 'held_for_review' }));
  assert.equal(stillSeen(held, { jd_hash: 'aaaa' }, basis, NOW), true);
  assert.equal(stillSeen(withKeys(rec({ code: 'held_for_review', ts: ago(8) })), { jd_hash: 'aaaa' }, basis, NOW), false);
});

test('compact：删过期行和被覆盖的行，原子重写，仍 600', () => {
  const h = home();
  recordSeen(h, rec({ ts: ago(70), apply_url: gh(1) }));
  recordSeen(h, rec({ ts: ago(5), apply_url: gh(2), title: 'B' }));
  recordSeen(h, rec({ ts: ago(2), apply_url: gh(2), title: 'B', code: 'expired', reason: null }));
  recordSeen(h, rec({ ts: ago(400), apply_url: gh(3), title: 'C', code: 'expired', reason: null }));
  const report = compact(h, NOW);
  assert.deepEqual(report, { before: 4, after: 2 });
  assert.deepEqual(readSeen(h).map((r) => [r.fp, r.code]), [['greenhouse:2', 'expired'], ['greenhouse:3', 'expired']]);
  assert.equal(statSync(join(h, SEEN_RELPATH)).mode & 0o777, 0o600);
  assert.deepEqual(compact(home(), NOW), { before: 0, after: 0 }, 'no file: nothing to do, nothing created');
});

test('jdHash：空白差异不算变，正文变了才变；16 位', () => {
  assert.equal(jdHash('a  b\n c'), jdHash(' a b c '));
  assert.notEqual(jdHash('a b c'), jdHash('a b d'));
  assert.match(jdHash('x'), /^[0-9a-f]{16}$/);
});

test('scoringBasisVersion：简历字节 / search_intent / 打分提示词变了就变；profile.json 和 feedback.jsonl 不计入', () => {
  const h = home();
  writeFileSync(join(h, 'search_intent.json'), JSON.stringify({ search_intent: { seniority: 'intern', a: 1 } }));
  writeFileSync(join(h, 'resume.pdf'), 'PDF-v1');
  const v1 = scoringBasisVersion(h);
  assert.match(v1, /^[0-9a-f]{12}$/);
  writeFileSync(join(h, 'search_intent.json'), JSON.stringify({ search_intent: { a: 1, seniority: 'intern' } }, null, 2));
  assert.equal(scoringBasisVersion(h), v1, 'key order / formatting is not a change');
  writeFileSync(join(h, 'profile.json'), '{"x":1}');
  writeFileSync(join(h, 'feedback.jsonl'), '{"skip":1}\n');
  assert.equal(scoringBasisVersion(h), v1, 'answering a form question must not void every not_fit');
  writeFileSync(join(h, 'resume.pdf'), 'PDF-v2');
  const v2 = scoringBasisVersion(h);
  assert.notEqual(v2, v1);
  writeFileSync(join(h, 'search_intent.json'), JSON.stringify({ search_intent: { seniority: 'new_grad_FT' } }));
  assert.notEqual(scoringBasisVersion(h), v2);
});

test('fillBasisVersion：profile.json / essay_profile.json 变了就变；search_intent 不计入', () => {
  const h = home();
  writeFileSync(join(h, 'profile.json'), JSON.stringify({ a: 1 }));
  const v1 = fillBasisVersion(h);
  writeFileSync(join(h, 'search_intent.json'), '{"x":2}');
  assert.equal(fillBasisVersion(h), v1);
  writeFileSync(join(h, 'profile.json'), JSON.stringify({ a: 1, gpa: '3.8' }));
  const v2 = fillBasisVersion(h);
  assert.notEqual(v2, v1);
  mkdirSync(join(h, 'x'), { recursive: true });
  writeFileSync(join(h, 'essay_profile.json'), JSON.stringify({ why: 'y' }));
  assert.notEqual(fillBasisVersion(h), v2);
});

// Records as they come back from readSeen (keys derived at write time).
function withKeys(r) {
  const h = home();
  recordSeen(h, r);
  return readSeen(h)[0];
}
