// 即找即投端到端（restart-apply DESIGN S3 / PM 第 2 轮 §2.7 V1-V13 中归 S3 的
// V1 V2 V3 V7 V8 V11 V12 V13，外加规则 6、投前失败上限、名单优先、历史前置、崩溃
// 恢复、额度用完）。真 stream_run + 真记账链路；替身只在岗位板、驱动、打分器、
// Chrome 四个边上（见 stream_run_harness.mjs）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { append, readAll } from '../shared/submission_ledger.mjs';
import { SEEN_RELPATH, readSeen } from '../shared/seen_log.mjs';
import { initRunDb } from '../shared/local_db.mjs';
import { writeInflight } from '../shared/apply_guard.mjs';
import { fakeLiveBatch, makeStreamRig, job, ghUrl } from './stream_run_harness.mjs';

// 30 jobs at 30 different companies, 8 of them a fit (V1's board).
const board30 = () => Array.from({ length: 30 }, (_, i) => job(`Co${i}`, i + 1, { fit: i < 8 }));

function filesUnder(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p); else out.push(relative(dir, p));
    }
  };
  walk(dir);
  return out.sort();
}

test('V1 连跑两次（硬指标）：第 1 次投 8、报「合适的只有 8 个」；第 2 次打分 0、派单 0、账本不增', async () => {
  const rig = await makeStreamRig('mrw-stream-v1-');
  try {
    rig.board({ rotation: board30() });
    const first = await rig.run(10);
    assert.equal(first.scored.length, 30);
    assert.equal(rig.driverCalls().length, 8);
    assert.equal(readAll(rig.home).length, 8);
    assert.match(first.finish.lines[0], /^投出 8 个：Co0·Growth Intern 1、/);
    assert.match(first.finish.lines[2], /看了 30 个新岗，合适的只有 8 个，没凑到 10 个/);

    const second = await rig.run(10);
    assert.equal(second.scored.length, 0, 'scorer called 0 times on the second run');
    assert.equal(rig.driverCalls().length, 8, 'driver called 0 times on the second run');
    assert.equal(readAll(rig.home).length, 8, 'ledger did not grow');
    assert.match(second.finish.lines[0], /^投出 0 个/);
    assert.match(second.finish.lines[2], /没有新岗/);
    assert.equal(second.finish.skipped_before_scoring.already_attempted_fp, 8);
    assert.equal(second.finish.skipped_before_scoring.seen_not_fit, 22);
    // Rotation is called by window, and the cursor moves on once a window is drained.
    assert.deepEqual(rig.discoverCalls().map((c) => [c.kind, c.offset, c.size]), [
      ['watchlist', null, '0'], ['rotation', '0', '1000'], ['watchlist', null, '0'], ['rotation', '1000', '1000'],
    ]);
  } finally {
    await rig.close();
  }
});

test('V2 第 2 次有新货 + V3 重发换编号：打分器只收到 5 个新岗、只投 3 个；重发的已投岗不打分不投', async () => {
  const rig = await makeStreamRig('mrw-stream-v2-');
  rig.env.MRWEIRDO_DAILY_TIER = '25'; // two runs on one day share the daily tier; 10 would cap run 2 at 2
  try {
    rig.board({ rotation: board30() });
    await rig.run(10);
    const fresh = Array.from({ length: 5 }, (_, i) => job(`New${i}`, 100 + i, { fit: i < 3 }));
    const reposted = { ...job('Co0', 999, { fit: true }), title: 'Growth Intern 1' }; // Co0·Growth Intern 1 was applied to, new id
    rig.board({ rotation: [...board30(), ...fresh, reposted] });
    const second = await rig.run(10);
    assert.deepEqual(second.scored.sort(), fresh.map((j) => j.apply_url).sort());
    assert.deepEqual(rig.driverCalls().slice(8), fresh.slice(0, 3).map((j) => j.apply_url));
    assert.equal(second.finish.skipped_before_scoring.already_attempted_company_title, 1, '已投过（同公司同岗位）');
  } finally {
    await rig.close();
  }
});

test('V7 不合适 + JD 变了只重看那 1 个；V8 换简历：不合适的全部重打，已投的一个都不重打不重投', async () => {
  const rig = await makeStreamRig('mrw-stream-v7-');
  rig.env.MRWEIRDO_DAILY_TIER = '25'; // same day as run 1: tier 10 would cap the look budget at 2×10
  try {
    rig.board({ rotation: board30() });
    await rig.run(10);
    const changed = board30();
    changed[20] = { ...changed[20], description: 'The JD was rewritten.' };
    rig.board({ rotation: changed });
    const v7 = await rig.run(10);
    assert.deepEqual(v7.scored, [changed[20].apply_url]);

    writeFileSync(join(rig.home, 'resume.pdf'), 'PDF-v2');
    const v8 = await rig.run(10);
    assert.equal(v8.scored.length, 22, 'every not-a-fit is judged again against the new resume');
    assert.ok(board30().slice(0, 8).every((j) => !v8.scored.includes(j.apply_url)));
    assert.equal(rig.driverCalls().length, 8, 'nothing applied to twice');
  } finally {
    await rig.close();
  }
});

test('V11 看的上限：1000 个全不合适、N=5 → 打分到 50 就停，报告写实际看了多少，不降线', async () => {
  const rig = await makeStreamRig('mrw-stream-v11-');
  try {
    rig.board({ rotation: Array.from({ length: 1000 }, (_, i) => job(`Big${i}`, i + 1)) });
    const r = await rig.run(5);
    assert.equal(r.scored.length, 50);
    assert.equal(r.batches.at(-1).done, 'score_budget_reached');
    assert.equal(rig.driverCalls().length, 0);
    assert.match(r.finish.lines[2], /看了 50 个新岗，合适的只有 0 个.*看的上限 50/);
  } finally {
    await rig.close();
  }
});

test('V12 不存岗位库 + V13 隐私：跑完家目录只多账本 / 看过记录 / 轮转游标；看过记录不含 JD 正文和答案；运行目录已删', async () => {
  const rig = await makeStreamRig('mrw-stream-v12-');
  try {
    const before = filesUnder(rig.home);
    rig.board({ rotation: board30().map((j) => ({ ...j, description: `SECRET-JD ${j.title}` })) });
    rig.script(Object.fromEntries(board30().slice(0, 8).map((j) => [j.apply_url, {
      outcome: 'submitted', verdict: { verdict: 'submitted', confirmHits: ['x'], denyHits: [] }, answers: [{ label: 'Why?', value: 'SECRET-ANSWER', source: 'profile', widget: 'text' }],
    }])));
    await rig.run(10);
    const added = filesUnder(rig.home).filter((f) => !before.includes(f));
    assert.deepEqual(added, ['log/seen.jsonl', 'log/submissions.jsonl', 'source_cursor.json']);
    const seenText = readFileSync(join(rig.home, SEEN_RELPATH), 'utf8');
    assert.doesNotMatch(seenText, /SECRET-JD|SECRET-ANSWER/);
    assert.deepEqual(readdirSync(join(rig.home, 'run-tmp')), [], 'the run directory (work DB, batches, driver results) is gone');
  } finally {
    await rig.close();
  }
});

test('规则 6：缺信息被页面拒收 → 下次运行不打分不派；补了档案 → 重新进候选并投出', async () => {
  const rig = await makeStreamRig('mrw-stream-r6-');
  try {
    const stuck = job('Stuck', 1, { fit: true });
    rig.board({ rotation: [stuck] });
    rig.script({ [stuck.apply_url]: { outcome: 'needs_user', reason: 'stuck_on_same_missing', missing: ['GPA'] } });
    const first = await rig.run(5);
    assert.equal(rig.driverCalls().length, 1);
    assert.match(first.finish.lines[1], /1 个卡在缺信息/);
    assert.equal(readSeen(rig.home).find((r) => r.fp === 'greenhouse:1').code, 'needs_info');

    const second = await rig.run(5);
    assert.equal(second.scored.length, 0);
    assert.equal(rig.driverCalls().length, 1, 'not re-dispatched while the profile is unchanged');
    assert.equal(second.finish.skipped_before_scoring.needs_info_unchanged, 1);

    writeFileSync(join(rig.home, 'profile.json'), JSON.stringify({ education: { gpa: '3.8' } }));
    rig.script({});
    const third = await rig.run(5);
    assert.deepEqual(third.scored, [stuck.apply_url]);
    assert.equal(rig.driverCalls().length, 2);
    assert.match(third.finish.lines[0], /^投出 1 个：Stuck·Growth Intern 1/);
  } finally {
    await rig.close();
  }
});

test('投前失败上限：单次运行点提交前失败累计 max(3, 可投数) → 停（pre_submit_fail_cap）；岗位已关写看过 expired', async () => {
  const rig = await makeStreamRig('mrw-stream-cap-');
  try {
    const jobs = Array.from({ length: 12 }, (_, i) => job(`Cap${i}`, i + 1, { fit: i < 3 }));
    rig.board({ rotation: jobs });
    rig.script({
      [jobs[0].apply_url]: { outcome: 'crashed', reason: 'resume_upload_failed' },
      [jobs[1].apply_url]: { outcome: 'not_submitted', reason: 'job_unavailable' },
      [jobs[2].apply_url]: { outcome: 'crashed', reason: 'resume_upload_failed' },
    });
    const r = await rig.run(1);
    assert.equal(r.scored.length, 10, 'N=1 → look at most 10');
    assert.equal(rig.driverCalls().length, 3, 'pre-submit failures never count toward the target');
    assert.equal(r.batches.at(-1).done, 'pre_submit_fail_cap');
    assert.match(r.finish.lines[1], /3 个表单没打开/);
    assert.equal(readSeen(rig.home).find((s) => s.apply_url === jobs[1].apply_url).code, 'expired');
  } finally {
    await rig.close();
  }
});

test('名单优先：名单公司的岗排在第一批最前；名单里挂掉的公司列进报告；下架岗写看过 expired', async () => {
  const rig = await makeStreamRig('mrw-stream-watch-');
  try {
    const target = job('pika', 1, { fit: true });
    const other = job('Other', 2, { fit: true });
    rig.board({ watchlist: [target], rotation: [other], errors: { watchlist: [{ source: 'watchlist', slug: 'brokenco', label: 'Broken Co', error: 'HTTP 500' }] } });
    rig.expire([other.apply_url]);
    const r = await rig.run(5);
    assert.deepEqual(r.scored, [target.apply_url, other.apply_url]);
    assert.deepEqual(rig.discoverCalls().map((c) => c.kind), ['watchlist', 'rotation']);
    assert.deepEqual(rig.driverCalls(), [], 'the list job is held for review (D10), the other one is taken down');
    assert.match(r.finish.lines[1], /名单里 1 家没扫到：Broken Co/);
    assert.equal(readSeen(rig.home).find((s) => s.apply_url === other.apply_url).code, 'expired');
  } finally {
    await rig.close();
  }
});

test('历史前置（ADR-S9）：缺省 jobs.db 还在、账本里没有历史行 → 拒绝开跑', async () => {
  const rig = await makeStreamRig('mrw-stream-legacy-');
  try {
    writeFileSync(join(rig.home, 'jobs.db'), '');
    const r = await rig.step(['start', '--target', '5']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /backfill-legacy/);
    assert.equal(existsSync(join(rig.home, 'run-tmp')), false, 'nothing created');
  } finally {
    await rig.close();
  }
});

test('额度用完：今日已尝试满档 → 开跑即 done(daily_cap_reached)，第一行明说，不找不打分', async () => {
  const rig = await makeStreamRig('mrw-stream-cap-day-');
  try {
    for (let i = 0; i < 10; i += 1) {
      append(rig.home, {
        era: 'v2', job_id: 100001 + i, apply_url: ghUrl(`d${i}`, i + 1), company_key: `d${i}`, title_key: 't', ats: 'greenhouse',
        outcome: 'submitted', verdict: 'submitted', may_have_submitted: true, reason: null, evidence: null, answers: [], work_auth_provenance: null,
      });
    }
    rig.board({ rotation: board30() });
    const r = await rig.run(5);
    assert.match(r.start.line, /今天已尝试 10\/10，本次投 0/);
    assert.equal(r.batches[0].done, 'daily_cap_reached');
    assert.deepEqual(rig.discoverCalls(), []);
  } finally {
    await rig.close();
  }
});

test('崩溃恢复（ADR-S8）：上次运行在途标记还在 → start 先补记「可能已提交」再清旧运行目录；该岗不再打分不再投', async () => {
  const rig = await makeStreamRig('mrw-stream-inflight-');
  try {
    const victim = job('Crash', 1, { fit: true });
    const oldDir = join(rig.home, 'run-tmp', 'stream-old');
    mkdirSync(oldDir, { recursive: true });
    initRunDb({ path: join(oldDir, 'work.db'), seqFloor: 100000 });
    const db = new DatabaseSync(join(oldDir, 'work.db'));
    db.prepare(`INSERT INTO jobs(company, title, apply_url, status, ats_platform) VALUES (?, ?, ?, '🤖 AI sourced', 'greenhouse')`).run(victim.company, victim.title, victim.apply_url);
    db.close();
    writeInflight(rig.home, { run_id: 'stream-old', work_db: join(oldDir, 'work.db'), row_id: 100001, apply_url: victim.apply_url, result_file: join(oldDir, 'gone.jsonl'), started_at: '2026-09-25T10:00:00.000Z' });
    rig.board({ rotation: [victim] });
    const r = await rig.run(5);
    const [line] = readAll(rig.home);
    assert.equal(line.reason, 'recovered_inflight');
    assert.equal(line.may_have_submitted, true);
    assert.equal(existsSync(oldDir), false, 'old run dir cleaned only after the attempt was recorded');
    assert.deepEqual(r.scored, []);
    assert.deepEqual(rig.driverCalls(), []);
    // VERIFY 第 4 轮 BUG-4: the user only reads 3 lines — the recovered maybe-submitted one must be there.
    assert.match(r.finish.lines[1], /上次中断的运行有 1 家可能已提交：crash·growth intern 1（.*boards\.greenhouse\.io\/crash\/jobs\/1.*请你核对邮箱或页面）/);
  } finally {
    await rig.close();
  }
});

test('--no-submit（真环境复验用的试跑开关）：照常找、去重、打分，驱动 0 次；第一行写「试跑不提交」', async () => {
  const rig = await makeStreamRig('mrw-stream-nosubmit-');
  try {
    rig.board({ rotation: board30() });
    const r = await rig.run(10, { startArgs: ['--max-windows', '1', '--no-submit'] });
    assert.equal(r.scored.length, 30);
    assert.deepEqual(rig.driverCalls(), []);
    assert.deepEqual(readAll(rig.home), []);
    assert.match(r.finish.lines[0], /^试跑不提交：看了 30 个新岗，合适的 8 个/);
  } finally {
    await rig.close();
  }
});

test('没打完就收工：finish 时还有没打分的新岗 → 第 3 行如实说，不说成「没有新岗」', async () => {
  const rig = await makeStreamRig('mrw-stream-early-');
  try {
    rig.board({ rotation: board30() });
    const start = await rig.step(['start', '--target', '10', '--max-windows', '1']);
    const next = await rig.step(['next', '--run', start.json.run_id]);
    assert.equal(next.json.action, 'score');
    const fin = await rig.step(['finish', '--run', start.json.run_id]);
    assert.equal(fin.status, 0, fin.stderr);
    assert.match(fin.json.lines[2], /还有 30 个新岗没打分就收工了/);
    assert.doesNotMatch(fin.json.lines[2], /没有新岗/);
  } finally {
    await rig.close();
  }
});

test('并发 L（VERIFY 第 4 轮 BUG-1）：窗口 A 的运行没收工，窗口 B 开跑 → 响亮拒绝，A 的运行目录和批次原样保留、能照常收尾', async () => {
  const rig = await makeStreamRig('mrw-stream-conc-l-');
  try {
    rig.board({ rotation: board30() });
    const a = await rig.step(['start', '--target', '10', '--max-windows', '1']);
    const aNext = await rig.step(['next', '--run', a.json.run_id]);
    assert.equal(aNext.json.action, 'score');
    const b = await rig.step(['start', '--target', '10', '--max-windows', '1']);
    assert.equal(b.status, 1);
    assert.match(b.stderr, new RegExp(`stream run ${a.json.run_id} is still active`));
    assert.match(b.stderr, /--abandon/);
    assert.ok(existsSync(aNext.json.batch_file), 'A keeps its batch');
    const aFin = await rig.step(['finish', '--run', a.json.run_id]);
    assert.equal(aFin.status, 0, aFin.stderr);
    const b2 = await rig.step(['start', '--target', '10', '--max-windows', '1']);
    assert.equal(b2.status, 0, b2.stderr);
    await rig.step(['finish', '--run', b2.json.run_id]);
  } finally {
    await rig.close();
  }
});

test('并发 X：另一个进程正持有派单锁（驱动在跑、在途标记在）→ 开跑拒绝，不补记、不动在途标记（--abandon 也不行）', async () => {
  const rig = await makeStreamRig('mrw-stream-conc-x-');
  const live = fakeLiveBatch(rig.base); // a real batch's command line names apply_batch.mjs
  try {
    mkdirSync(join(rig.home, 'locks'), { recursive: true });
    writeFileSync(join(rig.home, 'locks', 'apply_batch.lock'), JSON.stringify({ pid: live.pid, started_at: new Date().toISOString() }));
    writeInflight(rig.home, { run_id: 'stream-other', work_db: join(rig.home, 'run-tmp', 'stream-other', 'work.db'), row_id: 100001, apply_url: ghUrl('busy', 1), result_file: join(rig.home, 'x.jsonl'), started_at: new Date().toISOString() });
    for (const args of [['start', '--target', '5'], ['start', '--target', '5', '--abandon', 'stream-other']]) {
      const r = await rig.step(args);
      assert.equal(r.status, 1);
      assert.match(r.stderr, new RegExp(`apply batch is running \\(pid ${live.pid}\\)`));
    }
    assert.ok(existsSync(join(rig.home, 'locks', 'inflight.json')), 'the live attempt is not recorded as a crash');
    assert.deepEqual(readAll(rig.home), []);
  } finally {
    live.kill();
    await rig.close();
  }
});

test('放弃一个没收尾的运行：start --abandon <旧运行> → 旧运行目录删掉，新运行照常开', async () => {
  const rig = await makeStreamRig('mrw-stream-abandon-');
  try {
    rig.board({ rotation: board30() });
    const a = await rig.step(['start', '--target', '10', '--max-windows', '1']);
    await rig.step(['next', '--run', a.json.run_id]);
    const wrong = await rig.step(['start', '--target', '10', '--abandon', 'stream-not-that-one']);
    assert.equal(wrong.status, 1, 'abandon must name the active run');
    const b = await rig.step(['start', '--target', '10', '--max-windows', '1', '--abandon', a.json.run_id]);
    assert.equal(b.status, 0, b.stderr);
    assert.equal(existsSync(join(rig.home, 'run-tmp', a.json.run_id)), false);
    await rig.step(['finish', '--run', b.json.run_id]);
  } finally {
    await rig.close();
  }
});

test('验收口径（lead 裁决 B）：合格但没轮到投的岗下次会重打分；零重复投递 + 已判不合适的零重复打分', async () => {
  const rig = await makeStreamRig('mrw-stream-y1-');
  rig.env.MRWEIRDO_DAILY_TIER = '25';
  try {
    const jobs = Array.from({ length: 20 }, (_, i) => job(`Y${i}`, i + 1, { fit: i < 8 }));
    rig.board({ rotation: jobs });
    const first = await rig.run(3);
    const second = await rig.run(3);
    const unfit = jobs.slice(8).map((j) => j.apply_url);
    assert.ok(second.scored.every((u) => !unfit.includes(u)), 'nothing judged not-a-fit is scored again');
    assert.equal(second.scored.length, 5, 'the 5 fit-but-not-reached jobs are scored again (no fit queue is kept — lead ruling B)');
    const calls = rig.driverCalls();
    assert.equal(calls.length, 6);
    assert.equal(new Set(calls).size, 6, 'zero repeated dispatch');
    assert.equal(first.scored.length, 20);
  } finally {
    await rig.close();
  }
});

// D10 第一版（lead 裁决，DESIGN 未明点 6 简化方案）：名单公司合格时不自动投，
// 标 held_for_review，3 行报告第 1 行列出「公司·岗位·链接」交拍板人过目；held 的
// 岗记进看过记录，下次不重复报；拍板人一句话放行（start --release <链接>）。
test('D10 名单公司合格不自动投：第 1 行列出「公司·岗位·链接」；下次不重打不重报；--release 放行后照常投', async () => {
  const rig = await makeStreamRig('mrw-stream-d10-');
  rig.env.MRWEIRDO_DAILY_TIER = '25'; // three runs on one day share the daily tier
  try {
    const dream = job('pika', 1, { fit: true });
    const dreamUnfit = job('pika', 2);
    const other = job('Other', 3, { fit: true });
    rig.board({ watchlist: [dream, dreamUnfit], rotation: [other] });

    const first = await rig.run(5);
    assert.deepEqual(rig.driverCalls(), [other.apply_url], 'only the non-list job is applied to');
    assert.match(first.finish.lines[0], /^投出 1 个：Other·Growth Intern 3；名单公司 1 个合格、等你过目/);
    assert.ok(first.finish.lines[0].includes(`pika·Growth Intern 1·${dream.apply_url}`), first.finish.lines[0]);
    assert.deepEqual(first.finish.held, [{ company: 'pika', title: 'Growth Intern 1', apply_url: dream.apply_url }]);
    assert.equal(readSeen(rig.home).find((r) => r.apply_url === dream.apply_url).code, 'held_for_review');
    assert.ok(readAll(rig.home).every((e) => e.apply_url !== dream.apply_url), 'held is not an attempt');

    const second = await rig.run(5);
    assert.deepEqual(second.scored, [], 'held, not-a-fit and applied jobs all skip scoring');
    assert.equal(second.finish.skipped_before_scoring.seen_held_for_review, 1);
    assert.doesNotMatch(second.finish.lines[0], /等你过目/, 'not reported again');

    const released = await rig.run(1, { startArgs: ['--release', dream.apply_url] });
    assert.deepEqual(released.scored, [dream.apply_url], 'a release run scans the list only and rescores the released job');
    assert.deepEqual(rig.driverCalls(), [other.apply_url, dream.apply_url]);
    assert.match(released.finish.lines[0], /^投出 1 个：pika·Growth Intern 1$/);

    const gone = ghUrl('pika', 404);
    const missing = await rig.run(1, { startArgs: ['--release', gone] });
    assert.match(missing.finish.lines[1], new RegExp(`放行的 1 个没找到（可能已下架）：${gone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.equal(rig.driverCalls().length, 2);
  } finally {
    await rig.close();
  }
});
