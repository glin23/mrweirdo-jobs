// verify 第 13 轮：工程 / 研究岗漏进打分 27 个。① 排除词对不上连字符 / 连写
// （"full stack engineer" 对不上 Full-Stack / Fullstack，旧问题）；② 用户 target_function_anchor
// 明写不要的方向（Software Engineering / ML/Research）只在打分时起作用，硬筛不看。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { excludeKeywordMatch, functionExcludeKeywords } from '../shared/title_excludes.mjs';

const LEE = { search_intent: { target_function_anchor: {
  self_reported_target_functions: ['AI video go-to-market', 'growth'],
  resume_supported_functions: ['Growth Marketing', 'Social/Community', 'Content Strategy', 'GTM', 'Product'],
  adjacent_functions: ['Partnerships', 'Marketing Operations', 'Product Marketing'],
  excluded_functions: ['Software Engineering', 'ML/Research', 'Data Science', 'Sales AE', 'Recruiting', 'Legal', 'Finance'],
} } };

test('排除词不分连字符 / 空格 / 连写：full stack engineer 命中 Full-Stack Engineer 与 Fullstack Engineer', () => {
  for (const title of ['Full-Stack Engineer (Back-End Leaning)', 'Fullstack Engineer', 'Full Stack Engineer']) {
    assert.equal(excludeKeywordMatch(title, ['full stack engineer']), 'full stack engineer', title);
  }
  assert.equal(excludeKeywordMatch('Stack Overflow Marketer', ['full stack engineer']), null);
  assert.equal(excludeKeywordMatch('Research Engineer', ['sre']), null, 'whole words only');
});

test('用户明写不要软件工程 / ML 研究 → 工程与研究标题在硬筛就拦（verify 列的漏网样例）', () => {
  const kws = functionExcludeKeywords(LEE);
  for (const title of ['Design Engineer', 'Robotics Engineer', 'IT Support Engineer', 'Junior IT Support Engineer', 'Forward Deployed Engineer', 'Customer Engineer',
    'Engineering - Internal AI Transformation', 'Systems Architect', 'Developer Experience Engineer', 'Website Growth Engineer', 'Product Engineer',
    'ML Researcher - Posttraining', 'AI Researcher (Multimodal Audio/Video Generation)', 'Simulation Researcher/Engineer', 'Detection &  Response Engineer ']) {
    assert.ok(excludeKeywordMatch(title, kws), title);
  }
});

test('不误杀应届能投 / 对口岗（verify 分桶：应届能投 42 + 实习 3 的样例）', () => {
  const kws = functionExcludeKeywords(LEE);
  for (const title of ['Vibe Growth Marketer', 'Business Development Representative', 'Product Manager', 'Content Creator & Strategist', 'Influencer Marketer',
    'Social Growth Strategist', 'Affiliate Marketing Manager', 'Marketing Operations', 'Social Media Community Manager', 'Online Community Manager',
    'Youtube Creator & Educator', 'Creative Workflow Architect (Fluent in Japanese)', 'Forward Deployed Creative [US]', 'Product Design Manager',
    'IT Support', 'Customer Support Associate', 'Product Manager Intern', 'AI Product Management Intern', 'Research Intern (BS/MS/PhD)', 'Analyst Relations',
    'B2B SEO/AEO Expert', 'Partner Programs & Marketplace', 'Brand & Product Designer', 'Technical Program Manager']) {
    assert.equal(excludeKeywordMatch(title, kws), null, title);
  }
});

test('没写不要工程的用户（例如找 SWE 的）：不加这组排除', () => {
  assert.deepEqual(functionExcludeKeywords({ search_intent: { target_function_anchor: { self_reported_target_functions: ['Software Engineering'], excluded_functions: ['Sales'] } } }), []);
  assert.deepEqual(functionExcludeKeywords({}), []);
});
