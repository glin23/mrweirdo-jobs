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
