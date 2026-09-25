// 岗位指纹：从投递链接推「平台:岗位编号」（restart-apply DESIGN §3 签名约束 /
// ADR-S2）。纯函数；规则就是 architect 实测 950/950 可推的那 4 条，按顺序第一条
// 命中即返回；fp 小写、不含 board（实测同一编号从不跨板）。都不中返回 null。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobFingerprint, companyTitleKey } from '../shared/job_identity.mjs';

const UUID = '0B1C2D3E-4F50-6172-8394-A5B6C7D8E9F0';

test('greenhouse 板链接：boards / job-boards 两种域名，带查询串也认', () => {
  assert.deepEqual(jobFingerprint('https://boards.greenhouse.io/heygen/jobs/4567890'), { ats: 'greenhouse', job_id: '4567890', fp: 'greenhouse:4567890' });
  assert.deepEqual(jobFingerprint('https://job-boards.greenhouse.io/Descript/jobs/123?gh_src=abc'), { ats: 'greenhouse', job_id: '123', fp: 'greenhouse:123' });
});

test('greenhouse 自定义域名：gh_jid 查询参数', () => {
  assert.deepEqual(jobFingerprint('https://careers.example.com/open-roles/?gh_jid=987654'), { ats: 'greenhouse', job_id: '987654', fp: 'greenhouse:987654' });
  assert.deepEqual(jobFingerprint('https://example.com/jobs?utm=x&gh_jid=55'), { ats: 'greenhouse', job_id: '55', fp: 'greenhouse:55' });
});

test('ashby：uuid 转小写；/application 后缀也认', () => {
  const want = { ats: 'ashby', job_id: UUID.toLowerCase(), fp: `ashby:${UUID.toLowerCase()}` };
  assert.deepEqual(jobFingerprint(`https://jobs.ashbyhq.com/synthesia/${UUID}`), want);
  assert.deepEqual(jobFingerprint(`https://jobs.ashbyhq.com/Synthesia/${UUID}/application?src=x`), want);
});

test('lever：uuid', () => {
  assert.deepEqual(jobFingerprint(`https://jobs.lever.co/acme/${UUID}/apply`), { ats: 'lever', job_id: UUID.toLowerCase(), fp: `lever:${UUID.toLowerCase()}` });
});

test('规则顺序：greenhouse 板路径优先于 gh_jid', () => {
  assert.equal(jobFingerprint('https://boards.greenhouse.io/x/jobs/1?gh_jid=2').fp, 'greenhouse:1');
});

test('认不出的链接一律 null（ashby 不带 uuid、workday、空值）', () => {
  assert.equal(jobFingerprint('https://jobs.ashbyhq.com/acme/1'), null);
  assert.equal(jobFingerprint('https://jobs.ashbyhq.com/acme'), null);
  assert.equal(jobFingerprint('https://acme.wd5.myworkdayjobs.com/en-US/careers/job/123'), null);
  assert.equal(jobFingerprint(''), null);
  assert.equal(jobFingerprint(null), null);
  assert.equal(jobFingerprint(undefined), null);
});

test('companyTitleKey = 公司归一::标题归一（双键的第二把钥匙）', () => {
  assert.equal(companyTitleKey('Acme, Inc.', 'Growth Internship'), 'acme::growth intern');
});
