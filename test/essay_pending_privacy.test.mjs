// essay_pending.jsonl 只记「卡在哪几道题」，不记答过什么（restart-apply DESIGN
// 第 2 轮 S1 第 5 项 / 小修包 VERIFY_REPORT §5 真 bug 1）。
// 表单问答（含工作授权族）只许进 600 权限的账本一处；essay 日志原来整条
// JSON.stringify(rec)，answers 跟着落进这个文件。两个驱动各测一遍，用的是
// 出货源码（harness 只换浏览器边界），不是重写。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { loadDriver as loadAshby, BASE as ASHBY_BASE, ROOT } from './ashby_driver_harness.mjs';
import { loadDriver as loadGreenhouse, BASE as GH_BASE } from './greenhouse_driver_harness.mjs';
import { PII_TARGETS } from '../shared/state_file_lock.mjs';

const SECRET = 'ESSAY_PRIVACY_MARKER_authorized_yes_needs_sponsorship';

function pendingRec(jobId) {
  return {
    outcome: 'needs_user',
    reason: 'essay_pending',
    tab_id: 'tab-1',
    job_id: jobId,
    pending: [{ question: 'Why do you want to work here?', selector: '#q_1', tag: 'textarea' }],
    still_missing: ['Why do you want to work here?'],
    company: 'testco',
    url: 'https://jobs.ashbyhq.com/testco/00000000-0000-0000-0000-000000000000',
    answers: [{ label: 'Are you legally authorized to work?', value: SECRET, source: 'profile', widget: 'radio' }],
  };
}

for (const [name, load, base] of [['ashby', loadAshby, ASHBY_BASE], ['greenhouse', loadGreenhouse, GH_BASE]]) {
  test(`${name} 驱动：essay_pending.jsonl 行里没有 answers 键、没有答案原文`, async () => {
    const mod = await load(base);
    const rec = pendingRec('77');
    mod.logEssayPending(rec);
    const lines = readFileSync(mod.ESSAY_PENDING_LOG, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    const logged = JSON.parse(lines[0]);
    assert.equal('answers' in logged, false, 'answers must not be written to essay_pending.jsonl');
    assert.equal(lines[0].includes(SECRET), false, 'no answer text may reach the essay log');
    assert.deepEqual(logged.pending, rec.pending, 'the pending questions are still recorded');
    assert.ok(Array.isArray(rec.answers) && rec.answers.length === 1, 'the in-memory record (stdout → ledger) keeps its answers');
  });
}

test('ashby --list-pending-essays 照常列出剥掉问答后的待写题', async () => {
  const mod = await loadAshby(ASHBY_BASE);
  mod.logEssayPending(pendingRec('88'));
  const home = dirname(mod.ESSAY_PENDING_LOG);
  const r = spawnSync(process.execPath, ['shared/ashby_apply_driver.mjs', '--list-pending-essays'], {
    cwd: ROOT, env: { ...process.env, MRWEIRDO_HOME: home }, encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /job_id=88/);
  assert.match(r.stdout, /Why do you want to work here\?/);
});

test('PII_TARGETS 收录 essay_pending.jsonl（600 锁，和账本同级）', () => {
  assert.ok(PII_TARGETS.includes('essay_pending.jsonl'));
});
