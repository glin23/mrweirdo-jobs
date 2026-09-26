// 拍板人手投登记（lead 派遣第 4 项）：拍板人自己在浏览器里投过的岗，记进账本，
// 以后 agent 不再投这些岗、同公司 60 天计数也算上。
//   node shared/submission_ledger.mjs record-manual --url U --company C --title T [--at YYYY-MM-DD] [--apply]
//   node shared/submission_ledger.mjs record-manual --file list.json [--apply]
// 默认试跑（只打印计划），--apply 才写。全程假家目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { append, readAll } from '../shared/submission_ledger.mjs';
import { attemptIndex, localDay } from '../shared/apply_guard.mjs';
import { onboardTestEnv } from './helpers.mjs';
import { makeStreamRig, job } from './stream_run_harness.mjs';

const URL1 = 'https://jobs.ashbyhq.com/pika/00000000-0000-0000-0000-000000000001';
const URL2 = 'https://boards.greenhouse.io/heygen/jobs/4001';

function cli(home, args) {
  return spawnSync(process.execPath, ['shared/submission_ledger.mjs', 'record-manual', ...args], { cwd: process.cwd(), env: onboardTestEnv(home), encoding: 'utf8' });
}
const newHome = () => mkdtempSync(join(tmpdir(), 'mrw-manual-'));

test('默认试跑：打印计划，账本不动', () => {
  const home = newHome();
  const r = cli(home, ['--url', URL1, '--company', 'Pika', '--title', 'Growth Intern']);
  assert.equal(r.status, 0, r.stderr);
  const plan = JSON.parse(r.stdout);
  assert.equal(plan.applied, false);
  assert.equal(plan.to_append.length, 1);
  assert.deepEqual(readAll(home), []);
});

test('--apply：写一行「投过」——verdict submitted、outcome manual_submitted、行号 ≥100001、日期按本地当天', () => {
  const home = newHome();
  const r = cli(home, ['--url', URL1, '--company', 'Pika', '--title', 'Growth Intern', '--at', '2026-09-24', '--apply']);
  assert.equal(r.status, 0, r.stderr);
  const [e] = readAll(home);
  assert.equal(e.era, 'v2');
  assert.equal(e.verdict, 'submitted');
  assert.equal(e.outcome, 'manual_submitted');
  assert.equal(e.may_have_submitted, true);
  assert.equal(e.apply_url, URL1);
  assert.equal(e.company_key, 'pika');
  assert.equal(e.title_key, 'growth intern');
  assert.equal(e.ats, 'ashby');
  assert.ok(e.job_id >= 100001);
  assert.equal(localDay(new Date(e.ts)), '2026-09-24', 'a bare date is that day on this machine, not UTC midnight');
  assert.deepEqual(e.answers, []);
});

test('幂等：同一链接再登记不重复写；行号接在账本最大号之后', () => {
  const home = newHome();
  append(home, {
    era: 'v2', job_id: 100050, apply_url: URL2, company_key: 'heygen', title_key: 'x', ats: 'greenhouse',
    outcome: 'submitted', verdict: 'submitted', may_have_submitted: true, reason: null, evidence: null, answers: [], work_auth_provenance: null,
  });
  assert.equal(cli(home, ['--url', URL1, '--company', 'pika', '--title', 'Growth Intern', '--apply']).status, 0);
  const again = cli(home, ['--url', URL1, '--company', 'pika', '--title', 'Growth Intern', '--apply']);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(JSON.parse(again.stdout).already_recorded.length, 1);
  const lines = readAll(home);
  assert.equal(lines.length, 2);
  assert.equal(lines[1].job_id, 100051);
});

test('--file 批量；坏链接整批拒收、一行不写', () => {
  const home = newHome();
  const list = join(home, 'list.json');
  writeFileSync(list, JSON.stringify([
    { url: URL1, company: 'pika', title: 'Growth Intern' },
    { url: URL2, company: 'heygen', title: 'GTM Intern' },
  ]));
  assert.equal(cli(home, ['--file', list, '--apply']).status, 0);
  assert.equal(readAll(home).length, 2);

  const home2 = newHome();
  const bad = join(home2, 'bad.json');
  writeFileSync(bad, JSON.stringify([{ url: URL1, company: 'pika', title: 'x' }, { url: 'https://example.com/job/1', company: 'x', title: 'y' }]));
  const r = cli(home2, ['--file', bad, '--apply']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /example\.com.*no job fingerprint/);
  assert.deepEqual(readAll(home2), []);
});

test('有运行在进行（运行锁 / 派单锁在）→ 拒绝写，免得和工作库行号撞', () => {
  const home = newHome();
  mkdirSync(join(home, 'locks'), { recursive: true });
  writeFileSync(join(home, 'locks', 'stream_run.lock'), JSON.stringify({ run_id: 'stream-x' }));
  const r = cli(home, ['--url', URL1, '--company', 'pika', '--title', 'Growth Intern', '--apply']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /stream_run\.lock/);
  assert.deepEqual(readAll(home), []);
});

test('登记后算「投过」：同公司 60 天计数 +1；即找即投不再打分不再投', async () => {
  const rig = await makeStreamRig('mrw-manual-e2e-');
  try {
    const mine = job('Pika', 1, { fit: true });
    const r = spawnSync(process.execPath, ['shared/submission_ledger.mjs', 'record-manual', '--url', mine.apply_url, '--company', 'pika', '--title', mine.title, '--apply'], { cwd: process.cwd(), env: rig.env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(attemptIndex(readAll(rig.home)).byCompany.get('pika').length, 1);
    rig.board({ rotation: [mine] });
    const run = await rig.run(5);
    assert.deepEqual(run.scored, []);
    assert.deepEqual(rig.driverCalls(), []);
    assert.equal(run.finish.skipped_before_scoring.already_attempted_fp, 1);
  } finally {
    await rig.close();
  }
});

// verify 第 6 轮 R6：公司身份从链接里的招聘板 slug 推（与找岗、投前闸同一口径）；
// --company 只作核对，写成展示名（Runway ≠ runway-ml）响亮拒绝，一行不写。
test('公司按链接推：不写 --company 取 slug；写了但对不上 → 拒绝；看不出 slug 的链接必须写', () => {
  const runway = 'https://jobs.ashbyhq.com/runway-ml/00000000-0000-0000-0000-000000000009';
  const home = newHome();
  const bad = cli(home, ['--url', runway, '--company', 'Runway', '--title', 'Growth Intern', '--apply']);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /runway-ml/);
  assert.doesNotMatch(bad.stderr, /\n\s+at /, 'a refusal, not a stack trace');
  assert.deepEqual(readAll(home), []);

  assert.equal(cli(home, ['--url', runway, '--title', 'Growth Intern', '--apply']).status, 0);
  assert.equal(readAll(home)[0].company_key, 'runwayml', 'the same key the rotation scan gives runway-ml');

  const custom = 'https://careers.example.com/open?gh_jid=4242';
  const noSlug = cli(home, ['--url', custom, '--title', 'Ops Intern', '--apply']);
  assert.notEqual(noSlug.status, 0);
  assert.match(noSlug.stderr, /--company/);
  assert.equal(cli(home, ['--url', custom, '--company', 'examplecorp', '--title', 'Ops Intern', '--apply']).status, 0);
  assert.equal(readAll(home).length, 2);
});
