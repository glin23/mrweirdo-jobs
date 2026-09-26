// title_excludes.mjs — title keyword exclusion for the discovery hard filter.
//
// restart-apply-2 verify 第 13 轮: 27 engineering / research jobs reached scoring
// for a user whose search_intent says he does not want them.
//   ① A keyword matches regardless of hyphen / space / none between its words:
//      "full stack engineer" matches "Full-Stack Engineer" and "Fullstack
//      Engineer" (before: only the exact spelling).
//   ② target_function_anchor.excluded_functions is honoured at the hard filter
//      for the two families whose titles are unambiguous — software engineering
//      and ML research — unless the user's own target functions name them.
//      Other families are left to scoring (function_relevance), as before.

const FAMILIES = [
  {
    when: /\b(software engineering|software engineer|engineering|swe)\b/i,
    keywords: ['engineer', 'engineering', 'developer', 'systems architect', 'software architect'],
  },
  {
    when: /\b(ml|machine learning|research|ai research)\b/i,
    keywords: ['researcher', 'research scientist', 'research engineer', 'machine learning', 'ml engineer'],
  },
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const keywordRe = (kw) => new RegExp(`\\b${String(kw).trim().split(/[\s-]+/).map(escapeRe).join('[\\s-]*')}\\b`, 'i');

export function excludeKeywordMatch(title, excludes) {
  const t = String(title || '');
  return excludes.find((kw) => keywordRe(kw).test(t)) || null;
}

const list = (v) => (Array.isArray(v) ? v.map((x) => String(x || '')).filter(Boolean) : []);

export function functionExcludeKeywords(intentDoc = {}) {
  const anchor = (intentDoc.search_intent || intentDoc).target_function_anchor || {};
  const excluded = list(anchor.excluded_functions);
  const wanted = [...list(anchor.self_reported_target_functions), ...list(anchor.resume_supported_functions), ...list(anchor.adjacent_functions)];
  const out = [];
  for (const f of FAMILIES) {
    if (excluded.some((e) => f.when.test(e)) && !wanted.some((w) => f.when.test(w))) out.push(...f.keywords);
  }
  return out;
}
