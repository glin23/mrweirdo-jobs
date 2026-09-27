import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderAnswerTemplate } from '../shared/answer_templates.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('renderAnswerTemplate fills known tokens and blanks unknown ones', () => {
  const out = renderAnswerTemplate('Hi {{COMPANY_PRETTY}}, I study {{MAJOR}} at {{SCHOOL}}. {{NONEXISTENT}}', {
    profile: { education: { major: 'Business', school: 'Babson College' } },
    companyPretty: 'Acme',
  });
  assert.equal(out, 'Hi Acme, I study Business at Babson College.');
});

// 旧断言（assert.match(out, /F-1 OPT eligible/)）锁住的正是 ADR-12 判定的第 19 处
// 编造：visa_status 被逐字渲染进给雇主的英文。按 ADR-12 R1/R3 改写——与批次 A
// 修改 test/apply_gap_report.test.mjs:135 那条断言同一种情况，改动理由单独写在
// 施工记录里供 verify 复核（不是改测试迁就代码：旧断言锁的行为本身是缺陷）。
test('ADR-12 R1: employer-facing text never carries visa_status — in any language', () => {
  // 设计自己发明的标签不许变成他的自白。
  const label = renderAnswerTemplate('{{WORK_AUTH_SUMMARY}}', {
    profile: { work_authorization: { visa_status: 'student_visa_no_permission_yet', requires_sponsorship_future: true } },
  });
  assert.doesNotMatch(label, /student_visa_no_permission_yet|no_permission|F-?1/i);
  // 用户的中文原话更不许。历史档案的 visa_status 里真出现过中文。
  const chinese = renderAnswerTemplate('{{WORK_AUTH_SUMMARY}}', {
    profile: { work_authorization: { visa_status: '我不知道，学校说要等', requires_sponsorship_future: true, _user_words: '我不知道，学校说要等' } },
  });
  assert.doesNotMatch(chinese, /[一-鿿]/, 'a Chinese sentence must never reach an English employer form');
  // 三态布尔仍然可以诚实地说话。
  assert.match(chinese, /may require future sponsorship/);
});

test('ADR-12 R3: sponsorship reads three-state — null means the clause does not appear', () => {
  const neverAsked = renderAnswerTemplate('{{WORK_AUTH_SUMMARY}}', {
    profile: { work_authorization: { visa_status: 'other_status', requires_sponsorship_future: null } },
  });
  // 两态读法把 null 掉进「不需要担保」——一句他从没说过、入职核验对不上的话。
  assert.doesNotMatch(neverAsked, /does not require/);
  assert.doesNotMatch(neverAsked, /may require/);
  const saidNo = renderAnswerTemplate('{{WORK_AUTH_SUMMARY}}', {
    profile: { work_authorization: { requires_sponsorship_future: false } },
  });
  assert.match(saidNo, /does not require future sponsorship/);
});

test('ADR-12 R1: the availability template no longer volunteers a work-auth self-declaration', () => {
  // 问到岗时间的雇主没有问移民身份，附赠一句是我们自己多说的。
  const bank = readFileSync(join(ROOT, 'shared/answer_bank.json'), 'utf8');
  assert.doesNotMatch(bank, /WORK_AUTH_SUMMARY/, 'answer_bank.json:82 那半句按 lead 裁决删除');
});

test('renderAnswerTemplate tolerates empty/no-token input', () => {
  assert.equal(renderAnswerTemplate('', {}), '');
  assert.equal(renderAnswerTemplate('no tokens here', {}), 'no tokens here');
});

// 首次真投：「Tell us about something you've built, tested, or experimented with using AI…」
// 没有答案桶 → no_bucket_for。这类开放题由系统据 essay_profile 起草、不问用户；内容只能
// 逐字来自 essay_profile 的故事（truthfulness.md：不新增任何事实）。
import { aiExperimentStory } from '../shared/answer_templates.mjs';

const AI_VIDEO = {
  name: 'AI video model experiments',
  problem: 'Wanted to learn which AI video models hold up for short-form content, and what makes AI-video posts grow an audience.',
  what_user_did: 'Ran 27+ controlled AI video experiments with pass/fail criteria, comparing models side by side (Seedance, Wan, Veo); distilled reusable prompt packs and shotlists from wins and postmortems.',
  result_or_learning: 'A 3M-view viral hit converted only ~100 followers, exposing traffic without positioning; pivoted to vertical AI-video breakdowns and grew from 200 to 1,000+ followers in 3 days.',
  skills: ['AI video evaluation'],
  use_for: ['ai_experiment'],
};
const R2W = { name: 'R2W', problem: 'P-r2w.', what_user_did: 'Built the AI MVP via vibe coding.', result_or_learning: 'L-r2w.', skills: ['AI-assisted building'], use_for: ['tell_me_about_a_project'] };
const COR = { name: 'COR', problem: 'P-cor.', what_user_did: 'Recruited mentors.', result_or_learning: 'L-cor.', skills: ['community building'], use_for: ['leadership'] };

test('aiExperimentStory：优先标了 ai_experiment 的故事，全部文字逐字来自 essay_profile', () => {
  const out = aiExperimentStory({ project_stories: [R2W, AI_VIDEO] });
  for (const part of [AI_VIDEO.problem, AI_VIDEO.what_user_did, AI_VIDEO.result_or_learning]) assert.ok(out.includes(part), part);
  const stripped = out.replace(AI_VIDEO.problem, '').replace(AI_VIDEO.what_user_did, '').replace(AI_VIDEO.result_or_learning, '');
  assert.match(stripped.replace(/\s+/g, ' ').trim(), /^What I was trying to learn or achieve: What I did: What I discovered:$/, 'only fixed connective labels are added');
});

test('aiExperimentStory：没有 ai_experiment 标签时用技能里写着 AI 的真实项目；一个都没有 → 空（照旧问，不编）', () => {
  assert.ok(aiExperimentStory({ project_stories: [COR, R2W] }).includes('Built the AI MVP via vibe coding.'));
  assert.equal(aiExperimentStory({ project_stories: [COR] }), '');
  assert.equal(aiExperimentStory({}), '');
});

test('模板里引用的故事为空时整段答案为空（驱动据此挂起而不是交空答案）', () => {
  assert.equal(renderAnswerTemplate('{{AI_EXPERIMENT_STORY}}', { essayProfile: { project_stories: [COR] } }), '');
  assert.ok(renderAnswerTemplate('{{AI_EXPERIMENT_STORY}}', { essayProfile: { project_stories: [AI_VIDEO] } }).includes('27+ controlled AI video experiments'));
});

test('出货答案库有这类题的模板，能匹配首次真投遇到的原题', () => {
  const bank = JSON.parse(readFileSync(join(ROOT, 'shared/answer_bank.json'), 'utf8'));
  const q = 'Tell us about something you’ve built, tested, or experimented with using AI. What were you trying to achieve or learn, and what did you discover?';
  const hit = bank.essay_templates.find((t) => new RegExp(t.match, 'i').test(q));
  assert.ok(hit, 'no essay template matches the question');
  assert.match(hit.answer_template, /\{\{AI_EXPERIMENT_STORY\}\}/);
});
