// store_scored_jobs × 看过记录（restart-apply DESIGN S3 / ADR-S5）：打完分不合格的
// 岗位写一行看过记录（not_fit / visa_blocked，带 JD 指纹和打分依据版本），合格的
// 不写（投没投由账本管）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { onboardTestEnv } from './helpers.mjs';
import { SEEN_RELPATH, jdHash, readSeen, scoringBasisVersion } from '../shared/seen_log.mjs';

const ROOT = join(import.meta.dirname, '..');
const gh = (n) => `https://boards.greenhouse.io/acme/jobs/${n}`;
const dims = (v) => ({ role_fit: 8, skills_match: 8, location_fit: 8, visa_compatible: v, seniority_match: 8, exclude_check: 10 });

test('不合格 → 看过记录 not_fit（原因代码）/ visa_blocked；合格的不写；不落 JD 正文', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-store-seen-'));
  writeFileSync(join(home, 'search_intent.json'), JSON.stringify({ search_intent: { seniority: 'intern', role_type_targets: ['intern'] } }));
  const jobs = [1, 2, 3].map((n) => ({ company: 'Acme', title: `Marketing Intern ${n}`, apply_url: gh(n), location: 'Remote', description: `SECRET-JD-TEXT job ${n}` }));
  const scores = [
    { apply_url: gh(1), fit_score: 8, recommended: true, role_type_match: 'intern', dim_scores: dims(8) },
    { apply_url: gh(2), fit_score: 3, recommended: false, role_type_match: 'intern', dim_scores: dims(8) },
    { apply_url: gh(3), fit_score: 4, recommended: false, role_type_match: 'intern', dim_scores: dims(1) },
  ];
  writeFileSync(join(home, 'to_score.json'), JSON.stringify(jobs));
  writeFileSync(join(home, 'scored.json'), JSON.stringify(scores));
  const r = spawnSync(process.execPath, ['shared/store_scored_jobs.mjs', '--to-score', join(home, 'to_score.json'), '--scored', join(home, 'scored.json')], {
    cwd: ROOT, env: onboardTestEnv(home), encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  const seen = readSeen(home);
  assert.deepEqual(seen.map((s) => [s.fp, s.code, s.reason]), [['greenhouse:2', 'not_fit', 'fit_below_threshold'], ['greenhouse:3', 'visa_blocked', 'fit_below_threshold']]);
  assert.equal(seen[0].jd_hash, jdHash('SECRET-JD-TEXT job 2'));
  assert.equal(seen[0].basis_version, scoringBasisVersion(home));
  assert.doesNotMatch(readFileSync(join(home, SEEN_RELPATH), 'utf8'), /SECRET-JD-TEXT/);
});
