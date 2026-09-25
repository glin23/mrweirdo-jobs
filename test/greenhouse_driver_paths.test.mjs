// greenhouse 驱动两处写死 ~/.mrweirdo-jobs/jobs.db（restart-apply DESIGN §1.4 难点三，
// 必须和一次性工作库同包）：
//   · 「你以前投过我们吗」改问账本（账本里有迁入的历史），不再查 jobs.db；
//   · 链接里看不出公司时，拿行号去当前库（dbPath() = 本次工作库）查公司名，
//     不再拿工作库行号去历史库查到别家公司。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadDriver, BASE } from './greenhouse_driver_harness.mjs';
import { append } from '../shared/submission_ledger.mjs';
import { initRunDb } from '../shared/local_db.mjs';

const PRIOR_Q = 'Have you previously applied to Testco?';

function legacyDb(home, rows) {
  initRunDb({ path: join(home, 'jobs.db'), seqFloor: 1 });
  const db = new DatabaseSync(join(home, 'jobs.db'));
  for (const r of rows) db.prepare(`INSERT INTO jobs(id, company, title, apply_url, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?)`).run(r.id, r.company, 'T', r.url, r.status, r.submitted_at ?? null);
  db.close();
}

async function askPrior(setup) {
  const d = await loadDriver(BASE, { setup });
  globalThis.__MRW_FILLS = [];
  await d.answerMissing('tab-1', PRIOR_Q);
  return globalThis.__MRW_FILLS.map((f) => f.value);
}

test('「投过我们吗」：账本里投过这家（历史迁入行也算）→ Yes', async () => {
  const fills = await askPrior((home) => append(home, {
    era: 'legacy', job_id: 42, ts: '2026-05-20T00:00:00.000Z', apply_url: 'https://boards.greenhouse.io/testco/jobs/9',
    company_key: 'testco', title_key: 'growth intern', ats: 'greenhouse', outcome: 'legacy_submitted', verdict: 'legacy_unverified',
    may_have_submitted: true, reason: null, evidence: null, answers: [], work_auth_provenance: null,
  }));
  assert.deepEqual(fills, ['Yes']);
});

test('「投过我们吗」：只有 jobs.db 里有已投、账本里没有 → No（不再读写死的 jobs.db）', async () => {
  const fills = await askPrior((home) => legacyDb(home, [{ id: 7, company: 'testco', url: 'https://boards.greenhouse.io/testco/jobs/7', status: '✅ 已投', submitted_at: '2026-05-01' }]));
  assert.deepEqual(fills, ['No']);
});

test('链接里没有公司 slug：按行号查当前库（工作库），不去历史 jobs.db 查到别家', async () => {
  let workDb;
  const d = await loadDriver(BASE, {
    argv: ['https://careers.example.com/position?gh_jid=123', '100001'],
    setup(home) {
      legacyDb(home, [{ id: 100001, company: 'Wrong Co', url: 'https://boards.greenhouse.io/wrong/jobs/1', status: '🤖 AI sourced' }]);
      workDb = join(home, 'run-tmp', 'stream-x', 'work.db');
      initRunDb({ path: workDb, seqFloor: 100000 });
      const db = new DatabaseSync(workDb);
      db.prepare(`INSERT INTO jobs(company, title, apply_url) VALUES ('Right Co', 'T', 'https://careers.example.com/position?gh_jid=123')`).run();
      db.close();
      process.env.MRWEIRDO_DB_PATH = workDb;
    },
  });
  delete process.env.MRWEIRDO_DB_PATH;
  assert.equal(d.COMPANY, 'right-co');
});
