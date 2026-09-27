// verify 第 13 轮 P1：要求 ≥3 年的岗能一路走到自动投。store_scored_jobs 用重判的
// new_grad_FT 覆盖了打分器判的 other 写进库，recompute 再把资格翻成可投、validate 放行。
// 规矩：打分器判 other、或带 JD 重判为 other（资深 / 要求 ≥3 年）的，入库就记 other，
// 之后任何重判（库里没有 JD）都不得把它翻回可投。真 CLI、临时家目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { onboardTestEnv } from './helpers.mjs';
import { deriveRoleTypeFromJob } from '../shared/role_types.mjs';

const ROOT = join(import.meta.dirname, '..');
const url = (n) => `https://jobs.ashbyhq.com/lumaai/00000000-0000-0000-0000-00000000000${n}`;
const dims = { role_fit: 8, skills_match: 8, location_fit: 9, visa_compatible: 8, seniority_match: 8, exclude_check: 10 };
const run = (home, args) => spawnSync(process.execPath, args, { cwd: ROOT, env: onboardTestEnv(home), encoding: 'utf8' });

function storeOne(job, scorerRole) {
  const home = mkdtempSync(join(tmpdir(), 'mrw-veto-'));
  writeFileSync(join(home, 'search_intent.json'), JSON.stringify({ search_intent: { role_type_targets: ['intern', 'new_grad_FT'], geographic_preference: { primary_country: 'US', countries_open_to: ['US'] } } }));
  writeFileSync(join(home, 'to_score.json'), JSON.stringify([job]));
  writeFileSync(join(home, 'scored.json'), JSON.stringify([{ apply_url: job.apply_url, fit_score: 8, recommended: true, role_type_match: scorerRole, legitimacy: 'high', legitimacy_signals: [], dim_scores: dims, key_alignment: ['x'], key_gaps: ['y'], honest_reason: 'r' }]));
  const r = run(home, ['shared/store_scored_jobs.mjs', '--to-score', join(home, 'to_score.json'), '--scored', join(home, 'scored.json')]);
  assert.equal(r.status, 0, r.stderr);
  const db = new DatabaseSync(join(home, 'jobs.db'));
  const row = db.prepare('SELECT id, role_type_match, auto_apply_eligible FROM jobs WHERE apply_url = ?').get(job.apply_url);
  db.close();
  return { home, row, out: r.stdout, err: r.stderr };
}

function afterRecompute(home, id) {
  const re = run(home, ['shared/recompute_auto_apply_eligibility.mjs', '--apply']);
  assert.equal(re.status, 0, re.stderr);
  const db = new DatabaseSync(join(home, 'jobs.db'));
  const row = db.prepare('SELECT role_type_match, auto_apply_eligible FROM jobs WHERE id = ?').get(id);
  db.close();
  return { row, validate: run(home, ['shared/validate_auto_row.mjs', '--row-id', String(id)]) };
}

const LUMA = { company: 'lumaai', title: 'Product Manager, Growth', apply_url: url(1), location: 'Redwood City, CA', employment_type: 'FullTime', description: '- 5–10+ years of product management with a strong growth focus' };

test('打分器判 other（要求 5–10+ 年）：入库记 other、不可投；recompute 不翻回；validate 拒', () => {
  const { home, row } = storeOne(LUMA, 'other');
  assert.equal(row.role_type_match, 'other');
  assert.equal(row.auto_apply_eligible, 0);
  const after = afterRecompute(home, row.id);
  assert.equal(after.row.auto_apply_eligible, 0, 'recompute must not flip a scorer veto back to eligible');
  assert.notEqual(after.validate.status, 0);
});

test('打分器误判 new_grad_FT、但 JD 要求 ≥3 年：入库记 other、不可投，recompute 也不翻', () => {
  const { home, row } = storeOne({ ...LUMA, apply_url: url(2) }, 'new_grad_FT');
  assert.equal(row.role_type_match, 'other');
  assert.equal(row.auto_apply_eligible, 0);
  assert.equal(afterRecompute(home, row.id).row.auto_apply_eligible, 0);
});

test('应届岗（JD 1-2 年）照常可投，recompute 后仍可投', () => {
  const job = { ...LUMA, title: 'Growth Marketer', apply_url: url(3), description: '- 1-2 years in growth marketing' };
  const { home, row } = storeOne(job, 'new_grad_FT');
  assert.equal(row.role_type_match, 'new_grad_FT');
  assert.equal(row.auto_apply_eligible, 1);
  assert.equal(afterRecompute(home, row.id).row.auto_apply_eligible, 1);
});

test('deriveRoleTypeFromJob：库里记的 other 是否决，标题重判不得翻回', () => {
  assert.equal(deriveRoleTypeFromJob({ role_type_match: 'other', title: 'Product Manager, Growth' }), 'other');
  assert.equal(deriveRoleTypeFromJob({ role_type_match: 'new_grad_FT', title: 'Senior Growth Marketer' }), 'other');
});

// verify 第 14 轮 P2：打分器给非规范标签（senior / full_time / Other）时按原始字符串比对，
// JD 重判的 other 被丢掉，库里记了 senior / full_time，derive 规范化后翻回可投。
for (const [n, label] of [[4, 'senior'], [5, 'full_time'], [6, 'Other'], [7, 'New Grad FT']]) {
  test(`打分器标签「${label}」+ JD 5–10+ 年：入库 other、不可投；recompute 不翻；validate 拒`, () => {
    const { home, row } = storeOne({ ...LUMA, apply_url: url(n) }, label);
    assert.equal(row.role_type_match, 'other');
    assert.equal(row.auto_apply_eligible, 0);
    const after = afterRecompute(home, row.id);
    assert.equal(after.row.auto_apply_eligible, 0);
    assert.notEqual(after.validate.status, 0);
  });
}

test('非法标签（senior）：该行不可投、原因 role_type_label_invalid 记进汇总并在 stderr 响亮说', () => {
  const job = { ...LUMA, title: 'Growth Marketer', apply_url: url(8), description: '- 1-2 years in growth' };
  const { home, row, out, err } = storeOne(job, 'senior');
  assert.equal(row.role_type_match, 'other');
  assert.equal(row.auto_apply_eligible, 0, 'an unreadable label is never eligible, even when the JD looks entry-level');
  assert.match(out, /role_type_label_invalid/);
  assert.match(err, /role_type_match "senior"/);
  assert.equal(afterRecompute(home, row.id).row.auto_apply_eligible, 0);
});

test('合法别名 full_time + 应届 JD：规范为 new_grad_FT，照常可投', () => {
  const job = { ...LUMA, title: 'Growth Marketer', apply_url: url(9), description: '- 1-2 years in growth' };
  const { row } = storeOne(job, 'full_time');
  assert.equal(row.role_type_match, 'new_grad_FT');
  assert.equal(row.auto_apply_eligible, 1);
});
