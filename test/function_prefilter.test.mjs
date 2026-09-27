// restart-apply-3（拍板人 2026-09-27「行，先改」）：非目标轮转池 1000 → 硬筛 208 → 打 49，
// 其中 24 个方向不对口（客服 / 设计 / 财务 / 法务 / 招聘 / 销售 AE …），白花打分钱。
// 方向预筛：打分前按标题认「明显是别的专业职能」的岗，在硬筛拦下，原因 function_mismatch。
// 不许误杀：verify 第 13/14 轮「应届能投 42」里方向对口的那些 + 本次合格的
// Prior Labs Founder Associate、Sequence GTM Associate 必须放行。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { functionMismatchReason } from '../shared/function_prefilter.mjs';
import { onboardTestEnv } from './helpers.mjs';

const ROOT = join(import.meta.dirname, '..');
const FAKE_FETCH = join(ROOT, 'test', 'fixtures', 'watchlist_fake_fetch.mjs');

// The user's real search_intent (2026-09-27), direction fields only.
const LEE = { search_intent: {
  role_categories: ['Growth Marketing', 'Social Media / Community Manager', 'Content Creator / Content Strategist', 'Go-To-Market / GTM',
    'Product Management Intern / APM', 'Influencer / Creator Partnerships', 'Marketing Operations / Growth Operations',
    'Business Development / Partnerships', 'Product Marketing'].map((title_pattern) => ({ title_pattern })),
  function_area: ['Growth/Marketing', 'Content/Community', 'GTM', 'Product'],
  target_function_anchor: {
    self_reported_target_functions: ['AI video go-to-market', 'growth'],
    resume_supported_functions: ['Growth Marketing', 'Social/Community', 'Content Strategy', 'GTM', 'Product'],
    adjacent_functions: ['Partnerships', 'Marketing Operations', 'Product Marketing'],
    excluded_functions: ['Software Engineering', 'ML/Research', 'Data Science', 'Sales AE', 'Recruiting', 'Legal', 'Finance'],
  },
} };

// 必须放行：verify 第 13 轮「应届能投 42」里方向对口的（tavus / elevenlabs / suno / heygen / runway …），
// 本次两个合格岗，和拍板人点名的类别（Founder Associate / GTM Associate / Growth / Community /
// Social / Content / Marketing / Operations / Product）。标题不属于任何已知专业职能的也放行（交给打分）。
const MUST_PASS = [
  'Vibe Growth Marketer', 'Business Development Representative', 'Product Manager', 'Content Creator & Strategist', 'Influencer Marketer',
  'Social Growth Strategist', 'Affiliate Marketing Manager', 'Marketing Operations', 'Social Media Community Manager', 'Online Community Manager',
  'Youtube Creator & Educator', 'Product Manager Intern', 'AI Product Management Intern', 'Technical Program Manager', 'Partner Programs & Marketplace',
  'B2B SEO/AEO Expert', 'Analyst Relations', 'Creative Workflow Architect (Fluent in Japanese)', 'Forward Deployed Creative [US]',
  'Founder Associate (NYC)', 'GTM Associate', "Founder's Associate", 'Founders Associate', 'Founding GTM Lead', 'Growth Associate',
  'Community Manager', 'Social Media Manager', 'Content Strategist', 'Marketing Associate', 'Operations Associate', 'Business Operations Associate',
  'Strategy & Operations Associate', 'Chief of Staff', 'Product Marketing Manager', 'Partnerships Associate', 'Growth Operations Intern',
  'GTM Sales Operations Associate - North America', 'Revenue Operations Associate', 'Market Research Intern', 'Marketing Analytics Associate',
  'Associate Editor, Branded Content', 'Copywriter', 'Visiting Associate Cohort', 'Proposal Manager', 'Sales Development Representative',
  'Partnership Marketing Associate (College Grad 2027)', 'Private Equity Partnerships Associate', 'Community Development Partnership Associate',
  'Strategic Finance and Business Operations Associate', 'Strategic Finance Associate, GTM', 'Community Development & Recruitment Associate',
  'Hardware Product Management Intern - Fall 2026/Winter 2027', 'Associate Video Editor (College Grad 2027)', 'Talent Community (General Application)',
  'Builder - Forward Deployed Generalist (Early Career)', 'Generalist Intern, 2027', 'Associate Consultant (Campus - 2027)', 'Product Manager, Software Platform',
];

// 必须拦：拍板人点名的不对口职能 + 本次 49 个里方向不对口的真实标题。
const MUST_BLOCK = {
  'Account Executive': 'sales_ae', 'Enterprise Account Executive': 'sales_ae', 'Account Manager, Mid-Market': 'sales_ae',
  'Technical Recruiter': 'recruiting_hr', 'Talent Acquisition Coordinator': 'recruiting_hr', 'People Operations Generalist': 'recruiting_hr',
  'Legal Counsel': 'legal', 'Associate General Counsel': 'legal', 'Associate Commercial Counsel': 'legal', 'Paralegal': 'legal', 'Compliance Analyst': 'legal',
  'Finance Associate': 'finance', 'Accounting Associate': 'finance', 'Accounts Payable Specialist': 'finance', 'FP&A Analyst': 'finance',
  'Credit Risk Associate': 'finance', 'Quantitative Analyst Intern': 'finance', '2027 Investment Services Intern': 'finance', 'Payroll Specialist': 'finance',
  'Brand & Product Designer': 'design', 'Product Designer': 'design', 'Product Design Manager': 'design', 'Graduate Leadership Program - Junior Designer': 'design',
  'Creative Motion Designer': 'design', 'Brand Design': 'design', 'Office Coordinator (NYC)': 'admin',
  'Customer Support Associate': 'customer_support', 'Customer Experience Associate': 'customer_support', 'Customer Success Associate': 'customer_support',
  'Founding Customer Success Manager': 'customer_support', 'Associate Client Success Manager - B2B SaaS': 'customer_support', 'Provider Success Associate': 'customer_support',
  'Consumer Support Specialist': 'customer_support',
  'IT Support': 'it_support', 'IT Support Specialist': 'it_support',
  'Data Scientist': 'data', 'Data Analyst': 'data', 'Graduate Leadership Program - Data Analytics (January Start)': 'data',
  'Research Intern (BS/MS/PhD)': 'research', 'ML Researcher - Posttraining': 'research',
  'Executive Assistant': 'admin', 'Executive Assistant/Customer Success Support Associate': 'admin', 'Workplace Experience Associate': 'admin',
  'Software Engineer': 'engineering', 'Solutions Engineer': 'engineering', 'Full-Stack Intern': 'engineering', 'Embedded Software Intern (Summer 2027)': 'engineering',
  'Summer 2027 Internship (Software)': 'engineering', 'Naval Architect Intern (Summer 2027)': 'engineering',
  'Intern, Quantum Architecture': 'research', 'Scientific Intern': 'research', 'User Research Intern': 'research',
  'Talent Associate': 'recruiting_hr', 'Information Technology Intern (Summer 2027)': 'it_support', 'Associate Salesforce Administrator': 'it_support',
  'Mental Health Associate': 'clinical', 'Medical Scribe Intern, Clinical AI Safety & Evaluation': 'clinical', 'Clinical Operations Associate I (College Grad 2027)': 'clinical',
  'Underwriting Associate': 'finance', 'Associate Claims Adjuster': 'finance', 'NPL/RPL Trader - Analyst/Associate': 'finance', 'Associate, Investor Relations': 'finance',
  '2027 New Graduate - Supply Chain Coordinator': 'logistics_trades', 'Fulfillment Associate': 'logistics_trades', 'EHS Intern (Summer 2027)': 'logistics_trades',
  'Early Career- HVAC & Plumbing': 'logistics_trades', 'Flight Test Intern - Summer 2027': 'logistics_trades',
};

test('方向预筛：拍板人点名的不对口职能与本次 49 个里的不对口真实标题，硬筛就拦，原因 function_mismatch:<职能>', () => {
  for (const [title, family] of Object.entries(MUST_BLOCK)) {
    assert.equal(functionMismatchReason(title, LEE), `function_mismatch:${family}`, title);
  }
});

test('方向预筛不误杀：应届能投 42 里对口的 + Prior Labs Founder Associate + Sequence GTM Associate + 点名放行的类别', () => {
  for (const title of MUST_PASS) assert.equal(functionMismatchReason(title, LEE), null, title);
});

test('用户自己要的职能不拦（找设计 / 找 SWE / 找财务的用户）；没写目标职能的用户一律不拦', () => {
  const wants = (fns) => ({ search_intent: { target_function_anchor: { self_reported_target_functions: fns } } });
  assert.equal(functionMismatchReason('Product Designer', wants(['Product Design'])), null);
  assert.equal(functionMismatchReason('Software Engineer Intern', wants(['Software Engineering'])), null);
  assert.equal(functionMismatchReason('FP&A Analyst', wants(['Finance'])), null);
  assert.equal(functionMismatchReason('Recruiter', wants(['Software Engineering'])), 'function_mismatch:recruiting_hr');
  assert.equal(functionMismatchReason('Account Executive', {}), null, 'no target functions → no boundary known → never block');
  assert.equal(functionMismatchReason('Account Executive', { search_intent: { target_function_anchor: { excluded_functions: ['Sales AE'] } } }), null,
    'only excluded, nothing wanted → unknown boundary → scorer decides');
});

test('discover_candidates：方向不对口的岗在硬筛拦下、漏斗里记 function_mismatch；对口岗照常进打分', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-fnpre-cli-'));
  writeFileSync(join(home, 'search_intent.json'), JSON.stringify({ search_intent: {
    ...LEE.search_intent, seniority: 'intern', role_type_targets: ['intern', 'new_grad_FT'],
    geographic_preference: { primary_country: 'US', remote_acceptable: true },
    target_companies: [{ ats: 'ashby', slug: 'dirco', label: 'Dir Co' }],
  } }));
  const out = join(home, 'disc');
  mkdirSync(out);
  const r = spawnSync(process.execPath, ['--import', FAKE_FETCH, 'shared/discover_candidates.mjs', '--run', '--sources', 'watchlist', '--source-window-size', '0', '--output-dir', out], {
    cwd: ROOT, env: onboardTestEnv(home), encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  const toScore = JSON.parse(readFileSync(join(out, 'to_score.json'), 'utf8'));
  assert.deepEqual(toScore.map((j) => j.title).sort(), ['Founder Associate (NYC)', 'GTM Associate']);
  const funnel = JSON.parse(readFileSync(join(out, 'discovery_funnel.json'), 'utf8'));
  assert.deepEqual(funnel.hard_filter_dropped_by_reason, { 'function_mismatch:sales_ae': 1, 'function_mismatch:customer_support': 1 });
});
