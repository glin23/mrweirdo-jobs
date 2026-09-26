import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const skill = () => readFileSync('.claude/skills/mrweirdo-onboard/SKILL.md', 'utf8');

test('onboard output templates use one consistent progress language', () => {
  const text = skill();
  assert.match(text, /## Output Presentation Rules/);
  for (const step of ['0', '1', '3', '4', '5', '6', '7']) {
    assert.match(text, new RegExp(`\\[Step ${step}\\/7\\]`));
  }
  assert.match(text, /Do not paste raw JSON, database rows, or unformatted command output/);
  assert.match(text, /开跑 \/ Start/);
  assert.match(text, /补缺口 \/ Missing info/);
  assert.match(text, /本轮完成 \/ Batch report/);
});

// restart-apply 即找即投（拍板人关卡 1 / D8 / D10 / D11）：不出清单、不建岗位库、
// 结束只给 3 行；名单公司合格的不自动投、交拍板人过目。
test('Steps 4-7 drive the stream run: start → next/score/submit-scores → finish, no queue gate, no prune', () => {
  const text = skill();
  for (const cmd of ['stream_run.mjs start --target', 'stream_run.mjs next --run', 'stream_run.mjs submit-scores --run', 'stream_run.mjs finish --run']) {
    assert.ok(text.includes(cmd), cmd);
  }
  assert.doesNotMatch(text, /回复"开始"执行/, 'no queue gate: 「跑 N 个」 is the start');
  assert.doesNotMatch(text, /prune_discovered_jobs|retry_gap_rows|apply_report\.mjs/, 'no job pool to prune or requeue');
  assert.match(text, /只给这 3 行/);
  assert.match(text, /--release/, 'held list jobs can be released in one sentence');
  assert.match(text, /record-manual/, 'hand-made applications can be written into the ledger');
});

test('parse window keeps the identity line; the company list is written only after the user agrees', () => {
  const text = skill();
  assert.match(text, /将以以下身份提交：<name> \/ <email> \/ <phone> \/ <visa 状态>/);
  assert.match(text, /install_watchlist\.mjs --apply/);
  assert.match(text, /only after the user says yes/);
});
