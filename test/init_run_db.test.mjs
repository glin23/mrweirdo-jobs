// 一次性工作库（restart-apply DESIGN §3 initRunDb / ADR-S1 / ADR-S3）：行号从
// seqFloor 往上续编，保证工作库行号全局不重复（账本按 job_id 认岗）。
// 未明点 11：sqlite_sequence 预置在 node:sqlite 下是否生效——本文件第一条证明。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initRunDb } from '../shared/local_db.mjs';

test('initRunDb：新建库 + 全套表结构，第一行行号 = seqFloor + 1', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'mrw-rundb-')), 'run', 'work.db');
  initRunDb({ path: p, seqFloor: 100000 });
  const db = new DatabaseSync(p);
  db.prepare(`INSERT INTO jobs(company, title, apply_url) VALUES ('A', 'T', 'https://boards.greenhouse.io/a/jobs/1')`).run();
  db.prepare(`INSERT INTO jobs(company, title, apply_url) VALUES ('B', 'T', 'https://boards.greenhouse.io/b/jobs/2')`).run();
  assert.deepEqual(db.prepare('SELECT id FROM jobs ORDER BY id').all().map((r) => r.id), [100001, 100002]);
  assert.ok(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'feedback'`).get(), 'same schema as the legacy DB');
  db.close();
  assert.equal(statSync(p).mode & 0o777, 0o600, 'work DB holds scores for this run: owner only');
});

test('initRunDb：路径已存在就响亮拒绝（绝不在旧库/历史库上续编）；seqFloor 必须是正整数', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mrw-rundb-'));
  const p = join(dir, 'jobs.db');
  writeFileSync(p, '');
  assert.throws(() => initRunDb({ path: p, seqFloor: 100000 }), /already exists/);
  assert.throws(() => initRunDb({ path: join(dir, 'x.db'), seqFloor: 0 }), /seqFloor/);
  assert.equal(existsSync(join(dir, 'x.db')), false);
});
