// 引导步骤把预置的 AI 视频名单写进用户 search_intent.target_companies（restart-apply
// S5；BUILD_NOTES S3+S4 偏离 13：预置名单不会被自动使用）。只在引导里、经用户确认后
// 跑 --apply；默认试跑只打印计划。全程假家目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onboardTestEnv } from './helpers.mjs';

const PRESET = JSON.parse(readFileSync('shared/sourcing/data/watchlist_ai_video.json', 'utf8')).target_companies;

function homeWithIntent(targets) {
  const home = mkdtempSync(join(tmpdir(), 'mrw-watchlist-install-'));
  const intent = { search_intent: { seniority: 'intern', role_type_targets: ['intern'], ...(targets ? { target_companies: targets } : {}) }, _note: 'keep me' };
  writeFileSync(join(home, 'search_intent.json'), JSON.stringify(intent, null, 2), { mode: 0o644 });
  return home;
}
const cli = (home, args = []) => spawnSync(process.execPath, ['shared/install_watchlist.mjs', ...args], { cwd: process.cwd(), env: onboardTestEnv(home), encoding: 'utf8' });
const intentOf = (home) => JSON.parse(readFileSync(join(home, 'search_intent.json'), 'utf8'));

test('默认试跑：列出要加的名单公司，文件一个字节不动', () => {
  const home = homeWithIntent();
  const before = readFileSync(join(home, 'search_intent.json'), 'utf8');
  const r = cli(home);
  assert.equal(r.status, 0, r.stderr);
  const plan = JSON.parse(r.stdout);
  assert.equal(plan.applied, false);
  assert.equal(plan.add.length, PRESET.length);
  assert.equal(readFileSync(join(home, 'search_intent.json'), 'utf8'), before);
});

test('--apply：写进 search_intent.target_companies，保留其他字段与用户已有名单，文件 600；再跑一次不重复', () => {
  const mine = { ats: 'greenhouse', slug: 'mycorp', label: 'My Corp' };
  const home = homeWithIntent([mine]);
  const r = cli(home, ['--apply']);
  assert.equal(r.status, 0, r.stderr);
  const doc = intentOf(home);
  assert.equal(doc._note, 'keep me');
  assert.deepEqual(doc.search_intent.role_type_targets, ['intern']);
  assert.deepEqual(doc.search_intent.target_companies[0], mine, 'the user\'s own entries stay first');
  assert.equal(doc.search_intent.target_companies.length, PRESET.length + 1);
  assert.ok(doc.search_intent.target_companies.some((t) => t.slug === 'runway-ml' && t.ats === 'ashby'));
  assert.equal(statSync(join(home, 'search_intent.json')).mode & 0o777, 0o600);
  const again = cli(home, ['--apply']);
  assert.equal(JSON.parse(again.stdout).add.length, 0);
  assert.equal(intentOf(home).search_intent.target_companies.length, PRESET.length + 1);
});

test('还没有 search_intent.json（没做引导）→ 响亮失败，不替用户新建', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-watchlist-none-'));
  const r = cli(home, ['--apply']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /search_intent\.json/);
});
