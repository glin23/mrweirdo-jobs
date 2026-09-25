export const SUBMITTED_STATUSES = new Set(['✅ 已投', '✅ 已确认']);

// 「投了几家」唯一谓词（阶段 1 设计 §14 数字变真 / ADR-13）：所有读点（看板 /
// 队列诊断 / 队列 / 报告）数「已投」一律拼这一条 WHERE 片段；rebuild 保证它与
// submitted_at 非空互为充要。第二份手写状态清单 = 下一个 158/182/183。
// Constant statuses only — no user input reaches this SQL.
export const SUBMITTED_WHERE_SQL = `status IN (${[...SUBMITTED_STATUSES].map((s) => `'${s}'`).join(',')})`;

export function normalizeCompany(s = '') {
  let n = String(s)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

  n = n.replace(/\b(inc|llc|ltd|corp|corporation|company|co)\b/g, '').trim();
  n = n.replace(/\s+/g, '');
  return n.replace(/(jobs|careers)$/g, '');
}

export function normalizeTitle(s = '') {
  return String(s)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\u00a0/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(internship)\b/g, 'intern')
    .replace(/\b(co op|coop)\b/g, 'intern')
    .replace(/\bintern\s+intern\b/g, 'intern')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sameCompanyTitle(a = {}, b = {}) {
  return normalizeCompany(a.company) === normalizeCompany(b.company) &&
    normalizeTitle(a.title) === normalizeTitle(b.title);
}

// 岗位指纹（restart-apply DESIGN §3 / ADR-S2）：从投递链接推「平台:岗位编号」。
// Four rules, first hit wins — exactly the ones measured 950/950 on the legacy
// pool. fp carries no board: the same id never appeared under two boards, and a
// gh_jid link has no board to give. Anything else → null; on a dispatch path
// null is a bug and callers must throw (we only apply on these three ATSs).
const UUID_SRC = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const FINGERPRINT_RULES = [
  ['greenhouse', /greenhouse\.io\/[^/?#]+\/jobs\/(\d+)/i],
  ['greenhouse', /[?&]gh_jid=(\d+)/i],
  ['ashby', new RegExp(`ashbyhq\\.com/[^/?#]+/(${UUID_SRC})`, 'i')],
  ['lever', new RegExp(`lever\\.co/[^/?#]+/(${UUID_SRC})`, 'i')],
];

export function jobFingerprint(url) {
  if (!url || typeof url !== 'string') return null;
  for (const [ats, re] of FINGERPRINT_RULES) {
    const m = url.match(re);
    if (m) {
      const jobId = m[1].toLowerCase();
      return { ats, job_id: jobId, fp: `${ats}:${jobId}` };
    }
  }
  return null;
}

// The second key of the dual identity: same company + same title = same job.
export function companyTitleKey(company, title) {
  return `${normalizeCompany(company)}::${normalizeTitle(title)}`;
}
