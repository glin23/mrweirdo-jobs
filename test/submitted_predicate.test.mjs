// 「三个数变一个数」的读点面（阶段 1 设计 §14 数字变真 / ADR-13，验收 V1 的
// 包 2 部分）：所有出口的「已投」计数一律走 job_identity 的唯一谓词
// SUBMITTED_WHERE_SQL——谁也不许自带第二份状态清单来数数。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SUBMITTED_STATUSES, SUBMITTED_WHERE_SQL } from '../shared/job_identity.mjs';
import { onboardTestEnv } from './helpers.mjs';

test('SUBMITTED_WHERE_SQL 与 SUBMITTED_STATUSES 互为表里', () => {
  for (const s of SUBMITTED_STATUSES) {
    assert.ok(SUBMITTED_WHERE_SQL.includes(s), `${s} in predicate`);
  }
  assert.match(SUBMITTED_WHERE_SQL, /^status IN \(/);
});

// 构造一个三列互相打架的库：
//   A: 已投 + submitted_at 今天           （三格齐）
//   B: 已确认 + submitted_at 今天         （老 bug：dashboard 今日计数丢掉它）
//   C: 已投 + submitted_at NULL           （历史错位：只有 auto_submitted_at）
//   D: 跳过未投 + auto_submitted_at 有值  （绝不许被数进「已投」）
// 唯一谓词下的正确答案：总已投 = 3（A/B/C），今日已投 = 2（A/B）。
function makeDivergentHome() {
  const home = mkdtempSync(join(tmpdir(), 'mrw-predicate-'));
  const env = onboardTestEnv(home);
  spawnSync(process.execPath, ['shared/init_db_cli.mjs'], { cwd: process.cwd(), env, encoding: 'utf8' });
  const db = new DatabaseSync(join(home, 'jobs.db'));
  const today = new Date().toISOString().slice(0, 10);
  const ins = db.prepare(`
    INSERT INTO jobs(company, title, apply_url, status, submitted_at, auto_submitted_at, ats_platform, fit_score)
    VALUES (?, ?, ?, ?, ?, ?, 'ashby', 7)
  `);
  ins.run('A Co', 'Intern A', 'https://x/a', '✅ 已投', `${today} 10:00:00`, `${today} 10:00:00`);
  ins.run('B Co', 'Intern B', 'https://x/b', '✅ 已确认', `${today} 11:00:00`, null);
  ins.run('C Co', 'Intern C', 'https://x/c', '✅ 已投', null, '2026-06-01 09:00:00');
  ins.run('D Co', 'Intern D', 'https://x/d', '⚠️ 跳过未投', null, '2026-06-02 09:00:00');
  db.close();
  return { home, env };
}


// dashboard 不再读 jobs.db（restart-apply S5 改数账本），它的今日 / 总数口径
// 由 test/dashboard_ledger.test.mjs 守。

test('apply_report：Submitted total 与同一条谓词一个数', () => {
  const { home, env } = makeDivergentHome();
  const outPath = join(home, 'report.html');
  const run = spawnSync(process.execPath, ['shared/apply_report.mjs', '--since', '2000-01-01', '--output', outPath], {
    cwd: process.cwd(), env, encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  const html = readFileSync(outPath, 'utf8');
  const m = html.match(/<strong>(\d+)<\/strong>Submitted total/);
  assert.ok(m, 'funnel card exists');
  assert.equal(Number(m[1]), 3, 'Submitted total under the single predicate = 3');
});

test('源级守卫：三个读库的点数「已投」一律引 SUBMITTED_WHERE_SQL，不自带第二份清单', () => {
  for (const rel of ['shared/queue_diagnostics.mjs', 'shared/auto_apply_queue.mjs', 'shared/apply_report.mjs']) {
    const src = readFileSync(join(process.cwd(), rel), 'utf8');
    assert.ok(src.includes('SUBMITTED_WHERE_SQL'), `${rel} must import/use the single predicate`);
    assert.ok(
      !/status IN \('✅ 已投','✅ 已确认'\)/.test(src),
      `${rel} still carries a hand-rolled submitted-status list`
    );
  }
});
