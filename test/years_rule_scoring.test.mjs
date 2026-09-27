// restart-apply-3（拍板人 2026-09-27「行，先改」）：试跑里打分器把 JD 要求 1-3 年的 7 个也判了
// 不合格，与定稿「JD 明写 ≥3 年起步才跳过」和硬筛口径不一致。
// ① 提示词写明：年限只看起步数（区间取下限），1-2 / 1-3 / 2 / 2+ 年不因年限扣分、不判不合格；
// ② 硬规则层：打分结果里不合格的行必须写 reject_reasons；若理由只有年限，而 JD 起步年限 < 3
//   （规则读 JD，读不出时用打分器报的 years_required_min），入库拒收整批、点名这几条要按规则重打
//   ——和「缺分拒收」同一条路：批次仍挂着，主 agent 重打后再交。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { onboardTestEnv } from './helpers.mjs';
import { readSeen } from '../shared/seen_log.mjs';
import { yearsOnlyRejectionConflict } from '../shared/role_types.mjs';

const ROOT = join(import.meta.dirname, '..');
const PROMPT = readFileSync(join(ROOT, 'shared', 'scoring', 'score_prompt.md'), 'utf8');
const gh = (n) => `https://boards.greenhouse.io/acme/jobs/${n}`;
const dims = { role_fit: 8, skills_match: 8, location_fit: 8, visa_compatible: 5, seniority_match: 3, exclude_check: 10 };

test('提示词写明年限口径：只看起步数；1-2 / 1-3 / 2 年不判不合格；不合格必须写 reject_reasons', () => {
  assert.match(PROMPT, /1-3 years/);
  assert.match(PROMPT, /lower end/i);
  assert.match(PROMPT, /3 or more years/);
  assert.match(PROMPT, /"years_required_min"/);
  assert.match(PROMPT, /"reject_reasons"/);
  assert.match(PROMPT, /experience_years/);
});

test('规则：理由只有年限 + JD 起步 < 3 年 → 冲突；起步 ≥ 3 年 / 还有别的理由 / 合格 → 不冲突', () => {
  const job = (description) => ({ title: 'GTM Associate', description });
  const rej = (reasons, extra = {}) => ({ recommended: false, reject_reasons: reasons, ...extra });
  assert.ok(yearsOnlyRejectionConflict(job('1-3 years of experience in growth.'), rej(['experience_years'])));
  assert.ok(yearsOnlyRejectionConflict(job('2+ years of experience'), rej(['experience_years', 'role_type'])));
  assert.ok(yearsOnlyRejectionConflict(job('Some experience a plus.'), rej(['experience_years'], { years_required_min: 1 })), 'rule reads nothing → scorer number decides');
  assert.ok(yearsOnlyRejectionConflict(job('Some experience a plus.'), rej(['experience_years'])), 'no number anywhere → not ≥3 → conflict');
  assert.equal(yearsOnlyRejectionConflict(job('3-5 years of experience'), rej(['experience_years'])), null);
  assert.equal(yearsOnlyRejectionConflict(job('Some experience.'), rej(['experience_years'], { years_required_min: 4 })), null);
  assert.equal(yearsOnlyRejectionConflict(job('1-3 years of experience'), rej(['experience_years', 'direction'])), null);
  assert.equal(yearsOnlyRejectionConflict(job('1-3 years of experience'), { recommended: true, reject_reasons: [] }), null);
  // The rule's reading wins over the scorer's when it read a number (与硬筛同一口径).
  assert.ok(yearsOnlyRejectionConflict(job('1-3 years of experience'), rej(['experience_years'], { years_required_min: 3 })));
});

function store(home, jobs, scores) {
  writeFileSync(join(home, 'to_score.json'), JSON.stringify(jobs));
  writeFileSync(join(home, 'scored.json'), JSON.stringify(scores));
  return spawnSync(process.execPath, ['shared/store_scored_jobs.mjs', '--to-score', join(home, 'to_score.json'), '--scored', join(home, 'scored.json')], {
    cwd: ROOT, env: onboardTestEnv(home), encoding: 'utf8',
  });
}

function freshHome() {
  const home = mkdtempSync(join(tmpdir(), 'mrw-years-'));
  writeFileSync(join(home, 'search_intent.json'), JSON.stringify({ search_intent: { seniority: 'both', role_type_targets: ['intern', 'new_grad_FT'] } }));
  return home;
}

test('入库：1-3 年只因年限被判不合格 → 拒收整批、点名链接、不写看过记录；按规则重打后照常入库', () => {
  const home = freshHome();
  const jobs = [
    { company: 'Acme', title: 'GTM Associate', apply_url: gh(1), location: 'Remote', description: 'Requirements\n- 1-3 years of experience in GTM' },
    { company: 'Acme', title: 'Growth Associate', apply_url: gh(2), location: 'Remote', description: 'Requirements\n- 5+ years of experience' },
  ];
  const wrong = [
    { apply_url: gh(1), fit_score: 4, recommended: false, role_type_match: 'other', dim_scores: dims, reject_reasons: ['experience_years'], years_required_min: 3 },
    { apply_url: gh(2), fit_score: 3, recommended: false, role_type_match: 'other', dim_scores: dims, reject_reasons: ['experience_years'], years_required_min: 5 },
  ];
  const r = store(home, jobs, wrong);
  assert.equal(r.status, 1, 'refused');
  assert.match(r.stderr, /years_misjudged/);
  assert.match(r.stderr, new RegExp(gh(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(r.stderr, /jobs\/2\b/, 'a real 5+ years row is not named');
  assert.deepEqual(readSeen(home), [], 'nothing recorded from a refused batch');

  const fixed = [{ ...wrong[0], fit_score: 7, recommended: true, role_type_match: 'new_grad_FT', dim_scores: { ...dims, seniority_match: 10 }, reject_reasons: [], years_required_min: 1 }, wrong[1]];
  const ok = store(home, jobs, fixed);
  assert.equal(ok.status, 0, ok.stderr);
  const summary = JSON.parse(ok.stdout.slice(ok.stdout.lastIndexOf('\n{\n') + 1));
  assert.equal(summary.eligible, 1);
});

test('入库：不合格的行没写 reject_reasons → 拒收整批（判不出是不是只因年限，不静默放过）', () => {
  const home = freshHome();
  const jobs = [{ company: 'Acme', title: 'GTM Associate', apply_url: gh(1), location: 'Remote', description: 'x' }];
  const r = store(home, jobs, [{ apply_url: gh(1), fit_score: 3, recommended: false, role_type_match: 'new_grad_FT', dim_scores: dims }]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /reject_reasons/);
});
