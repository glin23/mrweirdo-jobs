import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(path, 'utf8');
}

test('materials skill separates manual drafts from D1 auto-apply cover letters', () => {
  const text = read('.claude/skills/mrweirdo-materials/SKILL.md');
  assert.match(text, /Do not use LaTeX/);
  assert.match(text, /Manual materials created by this skill do not enter auto-apply/);
  assert.match(text, /D1 checklist/);
  assert.match(text, /resume\/profile/);
  assert.match(text, /key_alignment/);
  assert.match(text, /shared\/references\/truthfulness\.md/);
  assert.match(text, /source: "d1_onboard_auto"/);
  assert.match(text, /used_in_submission: true/);
  assert.match(text, /manual review instead/);
  assert.match(text, /Keep, soften, or drop/);
  assert.match(text, /manual-draft metadata as `used_in_submission: false`/);
});

// restart-apply D8（拍板人 2026-09-25）：「跑 N 个」这句话本身就是开始，不再出清单等
// 「开始」。cover letter 自动生成的告知挪到开跑前的解析窗口，强度不变。
test('onboard discloses automatic cover-letter generation before the first run starts', () => {
  const text = read('.claude/skills/mrweirdo-onboard/SKILL.md');
  assert.match(text, /Always include this identity line and fixed statement/);
  assert.match(text, /对需要 cover letter 的岗位/);
  assert.match(text, /自动生成并附上 cover letter/);
  assert.match(text, /不会编造个人或公司事实/);
  assert.match(text, /「跑 N 个」这句话本身就是开始/);
});

test('jobskill routes the full run to the stream-run flow, not a queue gate', () => {
  const text = read('.claude/skills/mrweirdo-jobskill/SKILL.md');
  assert.match(text, /跑 N 个/);
  assert.doesNotMatch(text, /queue gate|queue preview|pruning/i);
});

test('the -auto engines no longer mention the retired daily_count.jsonl', () => {
  for (const f of ['.claude/skills/mrweirdo-ashby-auto/SKILL.md', '.claude/skills/mrweirdo-greenhouse-auto/SKILL.md']) {
    const text = read(f);
    assert.doesNotMatch(text, /daily_count/, f);
    assert.match(text, /stream_run/, `${f} names its real caller`);
  }
});

test('expand skill locks sensitive profile areas and requires idempotence', () => {
  const text = read('.claude/skills/mrweirdo-expand/SKILL.md');
  assert.match(text, /second run must be idempotent/);
  assert.match(text, /work_authorization/);
  assert.match(text, /legal attestations/);
  assert.match(text, /demographics/);
});

test('tracker follow-up drafts avoid empty checking-in language', () => {
  const text = read('.claude/skills/mrweirdo-tracker/SKILL.md');
  assert.match(text, /avoid empty phrases like "just checking in"/);
  assert.match(text, /Never send a follow-up/);
  assert.match(text, /--followup-sent/);
});

test('jobskill menu exposes five choice labels without user-facing slash commands', () => {
  const text = read('.claude/skills/mrweirdo-jobskill/SKILL.md');
  for (const label of ['开始找实习 / Onboard', '进度跟踪 / Tracker', '扩充写作画像 / Expand', '技能提升 / Upskill', '起草申请材料 / Materials']) {
    assert.match(text, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const command of ['/mrweirdo-tracker', '/mrweirdo-expand', '/mrweirdo-upskill', '/mrweirdo-materials', '/mrweirdo-greenhouse', '/mrweirdo-ashby', '/mrweirdo-lever']) {
    assert.doesNotMatch(text, new RegExp(command.replace('/', '\\/')));
  }
  assert.doesNotMatch(text, /即将上线/);
});
