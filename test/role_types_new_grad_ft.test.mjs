// restart-apply-2（拍板人 2026-09-26「行，3年以上的跳过」）：new_grad_FT 的意思改为
// 「应届能投的全职岗」——普通全职、标题不是资深、JD 没写明要求 3 年及以上经验；
// 不再只认标题写了 New Grad。只要实习的人照旧一个全职都不放（防全职外泄的老护栏）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRoleType, deriveRoleTypeFromJob, passesAllowedRoleType, requiredYears, roleTypeBlockReason } from '../shared/role_types.mjs';

const BOTH = ['intern', 'new_grad_FT'];
const FT = (title, description = '') => ({ title, employment_type: 'FullTime', description });

test('普通全职、非资深、JD 没写 3 年以上 → new_grad_FT，targets 含 new_grad_FT 时放行', () => {
  for (const title of ['Growth Marketer', 'Social Media Community Manager', 'Product Manager', 'Content Creator & Strategist', 'Business Development Representative']) {
    assert.equal(classifyRoleType(FT(title)), 'new_grad_FT', title);
    assert.equal(roleTypeBlockReason(FT(title), BOTH), null, title);
  }
  assert.equal(classifyRoleType(FT('Growth Marketer', '1-2 years of experience in growth; 2+ years with paid social preferred')), 'new_grad_FT');
});

test('没有雇佣类型字段（Greenhouse）且标题无临时/合同信号 → 按全职判', () => {
  assert.equal(classifyRoleType({ title: 'Field Marketing Manager', description: '' }), 'new_grad_FT');
  assert.equal(classifyRoleType({ title: 'Paid Social Creative Strategist (Contract)' }), 'other');
  assert.equal(classifyRoleType({ title: 'Brand Designer', employment_type: 'Contract' }), 'other');
  // 复跑发现：雇佣类型写 FullTime、标题写 (Freelance) 的也不是全职岗
  assert.equal(classifyRoleType({ title: 'Audio Engineering (Freelance)', employment_type: 'FullTime' }), 'other');
});

test('资深标题 → 不算应届：Senior / Sr. / Staff / Principal / Lead / Director / Head / VP / Chief；原因 senior_title', () => {
  for (const title of ['Senior Growth Marketer', 'Sr. Paid Social Manager', 'Sr Product Manager', 'Staff Designer', 'Principal PM', 'Lifecycle Marketing Lead', 'Director of Marketing', 'Head of Growth', 'VP, Marketing', 'Chief of Staff']) {
    assert.equal(classifyRoleType(FT(title)), 'other', title);
    assert.equal(roleTypeBlockReason(FT(title), BOTH), 'senior_title', title);
  }
});

test('Manager 不算资深（创业公司入门岗常叫 X Manager），Senior Manager 才算', () => {
  assert.equal(roleTypeBlockReason(FT('Affiliate Marketing Manager'), BOTH), null);
  assert.equal(roleTypeBlockReason(FT('Senior Marketing Manager'), BOTH), 'senior_title');
});

test('JD 明写要求 ≥3 年 → 跳过并记原因 requires_3plus_years:<年数>', () => {
  const cases = [
    ['3+ years of experience in growth marketing', 3],
    ['You have 3-5 years of experience', 3],
    ['Minimum 4 years of B2B marketing experience', 4],
    ['At least 5 years in product management', 5],
    ['5 or more years of relevant experience', 5],
    ['3 – 5 years experience with lifecycle', 3],
    ['Requirements: 6+ yrs managing paid social', 6],
    ['three or more years of experience', 3],
    ['2+ years of experience required. 5+ years preferred.', 2],
    ['Experience: 1-2 years. Nice to have: 4+ years in AI', 1],
  ];
  for (const [jd, years] of cases) {
    assert.equal(requiredYears(jd), years, jd);
    const reason = roleTypeBlockReason(FT('Growth Marketer', jd), BOTH);
    assert.equal(reason, years >= 3 ? `requires_3plus_years:${years}` : null, jd);
  }
  assert.equal(requiredYears('We were founded 5 years ago. A 4-year degree is a plus.'), null);
  assert.equal(requiredYears(''), null);
});

test('老护栏：只要实习（和兼职）的人，任何全职都不放行', () => {
  for (const job of [FT('Growth Marketer'), FT('Associate Product Manager (APM)'), { title: 'Field Marketing Manager' }]) {
    assert.equal(passesAllowedRoleType(job, ['intern', 'part_time']), false, job.title);
    assert.equal(roleTypeBlockReason(job, ['intern']), 'role_type_not_allowed', job.title);
  }
  assert.equal(passesAllowedRoleType({ title: 'Growth Intern' }, ['intern']), true);
});

test('下游一致：deriveRoleTypeFromJob（DB 行没 employment_type/JD）与发现阶段同口径', () => {
  assert.equal(deriveRoleTypeFromJob({ role_type_match: 'new_grad_FT', title: 'Growth Marketer' }), 'new_grad_FT');
  assert.equal(deriveRoleTypeFromJob({ role_type_match: 'intern', title: 'Growth Marketer' }), 'new_grad_FT', 'a mislabeled intern is still not an intern');
  assert.equal(deriveRoleTypeFromJob({ role_type_match: 'intern', title: 'Growth Intern' }), 'intern');
});

// verify 第 13 轮 P1 复现（scratchpad/r13/years_repro.test.mjs 收进仓库）：区间上限带 + 与
// 「, ideally …」曾让 8 个要求 ≥3 年的岗漏进打分。
test('P1：区间上限带 + 的也是要求（runway / luma / synthesia / elevenlabs）', () => {
  assert.equal(requiredYears('- 3-5+ years in customer-facing technical roles'), 3);
  assert.equal(requiredYears('- 5–10+ years of product management with a strong growth'), 5);
  assert.equal(requiredYears('- Have 8–12+ years of experience in Enterprise AI'), 8);
});
test('P1：「, ideally …」修饰的是方向，不是把年限变成 preferred（elevenlabs / higgsfield / pika / krea）', () => {
  assert.equal(requiredYears('- 5+ years in Compensation or Total Rewards, ideally in a high-growth'), 5);
  assert.equal(requiredYears('- 4+ years of experience, ideally with 1+ years contributing'), 4);
  assert.equal(requiredYears('- 10+ years of legal experience, ideally including in-house'), 10);
});
test('P1：真实漏网 Luma PM Growth 不再过 new_grad_FT 闸', () => {
  const job = { title: 'Product Manager, Growth', employment_type: 'FullTime', description: '- 5–10+ years of product management with a strong growth focus' };
  assert.equal(passesAllowedRoleType(job, ['intern', 'new_grad_FT']), false);
});
test('年限：真正的 preferred 仍不算要求；「1-3 years」「2 or 3 years」取下限放行', () => {
  assert.equal(requiredYears('- 1-3 years in customer support'), 1);
  assert.equal(requiredYears('2 or 3 years of experience'), 2);
  assert.equal(requiredYears('3+ years preferred'), null);
  assert.equal(requiredYears('Preferred: 3+ years in growth'), null);
  assert.equal(requiredYears('What you need\n- 1+ years in marketing\nNice to have\n- 3+ years in AI video\n'), 1);
  assert.equal(requiredYears('Preferred Qualifications\n- 4+ years at a startup\n'), null);
  // 上一条 bullet 末尾的「(NY or CA preferred)」不是这一条年限的 preferred（真实拷贝复跑发现）
  assert.equal(requiredYears(' - J.D. and one U.S. State Bar (NY or CA preferred)\n\n - 8+ years of relevant post-qualification legal experience'), 8);
  assert.equal(requiredYears('Requirements\n- 4+ years at a startup\nNice to have\n- Figma\n'), 4);
});
test('带人的经理算资深：Engineering / Design / Research / Solutions Engineering Manager；Marketing Manager 不算', () => {
  for (const title of ['Engineering Manager - Growth and Revenue', 'Product Design Manager', 'Solutions Engineering Manager', 'Research Manager']) {
    assert.equal(roleTypeBlockReason(FT(title), BOTH), 'senior_title', title);
  }
  for (const title of ['Affiliate Marketing Manager', 'Social Media Community Manager', 'Online Community Manager', 'Lead Generation Specialist', 'Contract Manager']) {
    assert.equal(roleTypeBlockReason(FT(title), BOTH), null, title);
  }
});

// verify 第 14 轮 P3：年限前的「区间上半截」判断跨过了换行——上一行以数字结尾（GA4、URL）
// 时，下一行的「- 3+ years」被当成区间后半截漏认。
test('P3：上一行以数字结尾，下一行的年限照认', () => {
  assert.equal(requiredYears('- Experience with GA4\n- 3+ years in growth'), 3);
  assert.equal(requiredYears('- Read our research at https://example.com/papers/FJOi1\n- 5+ years of ML research experience'), 5);
  assert.equal(requiredYears('Tools: GA4\n3-5 years in lifecycle marketing'), 3);
});
