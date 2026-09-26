const INTERN_RE = /\b(intern|internship|co-?op)\b/i;
const PART_TIME_RE = /\b(part[\s-]?time|working student|student assistant|student worker|campus ambassador|brand ambassador)\b/i;
const NEW_GRAD_RE = /\b(new\s?grad|new\s?graduate|university\s?grad|university\s?graduate|early\s?career|recent\s?graduate)\b/i;
// Senior title markers. "Manager" is deliberately NOT one: at these startups an
// entry full-time role is often「X Manager」(Community / Affiliate / Field
// Marketing Manager) — restart-apply-2 BUG_REPORT; "Senior Manager" is caught
// by "senior". "Chief" matches "Chief of Staff" too (not an entry role).
// A people manager of engineers / designers / researchers is senior too (verify
// 第 13 轮 P2); "Lead Generation" is a job, not a rank.
const SENIOR_RE = /\b(senior|sr\.?|staff|principal|lead(?!\s*gen)|director|head|vp|chief)\b|\b(engineering|design|research)\s+manager\b/i;
// A non-intern title with no employment field (Greenhouse gives none) counts as
// full-time unless something says temporary (a "Summer … Fellowship Program" is not a job).
// Even with a full-time employment field, a title saying (Freelance) / (Contract)
// is not a full-time job (seen on ElevenLabs boards).
// "Contract" as a kind of job, not the thing a Contract Manager manages.
const CONTRACT = 'contract(?!\\s*(?:manager|management|specialist|administrator|analyst|negotiat))';
const NOT_FULL_TIME_TITLE_RE = new RegExp(`\\b(${CONTRACT}|contractor|freelance|temp|temporary|seasonal|fixed[\\s-]?term)\\b`, 'i');
const NOT_PERMANENT_RE = new RegExp(`\\b(${CONTRACT}|contractor|temp|temporary|seasonal|summer|fellowship|fixed[\\s-]?term|freelance|volunteer)\\b`, 'i');
const FULL_TIME_RE = /\b(full[\s-]?time|fulltime|permanent|regular employee)\b/i;
// Structured employment_type / schedule values that describe a *permanent*
// role. Used only to flag a conflict (intern-titled but employment looks
// permanent); never to hard-reclassify, because many real internships report
// full-time HOURS via these same fields.
const PERMANENT_EMPLOYMENT_RE = /\b(full[\s-]?time|fulltime|permanent|regular)\b/i;
// Any signal that a role really is short-term / student-oriented. If present
// anywhere (title or structured fields) there is no conflict to surface.
const TEMP_SIGNAL_RE = /\b(intern|internship|co-?op|temp|temporary|contract|seasonal|fixed[\s-]?term|part[\s-]?time|working student|student)\b/i;

export function normalizeRoleType(value) {
  const v = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (v === 'internship') return 'intern';
  if (v === 'full_time' || v === 'fulltime' || v === 'new_grad' || v === 'new_grad_ft') return 'new_grad_FT';
  if (v === 'part_time' || v === 'parttime') return 'part_time';
  if (v === 'intern' || v === 'new_grad_FT') return v;
  return null;
}

export function roleTypesFromSearchIntent(search = {}, envTargets = process.env.MRWEIRDO_ROLE_TYPE_TARGETS) {
  const explicit = envTargets
    ? envTargets.split(',')
    : (search.role_type_targets || search.target_role_types || []);
  const normalized = explicit.map(normalizeRoleType).filter(Boolean);
  if (normalized.length) return [...new Set(normalized)];

  const seniority = search.seniority || 'intern';
  // Legacy profiles sometimes used "both" before the questionnaire had a
  // hard role-type multi-select. Do not silently widen auto-submit to
  // full-time; new-grad/full-time must now be selected explicitly.
  if (seniority === 'both') return ['intern', 'part_time'];
  if (seniority === 'intern_or_part_time') return ['intern', 'part_time'];
  const one = normalizeRoleType(seniority);
  return one ? [one] : ['intern'];
}

export function classifyRoleType(job = {}) {
  const title = String(job.title || '');
  const employment = String(
    job.employment_type || job.employmentType || job.schedule || job.commitment || ''
  ).toLowerCase();
  const combined = `${title} ${employment}`;
  const explicitIntern = INTERN_RE.test(combined);
  const explicitFullTime = FULL_TIME_RE.test(combined);

  if (PART_TIME_RE.test(combined)) return 'part_time';
  if (NEW_GRAD_RE.test(combined)) return 'new_grad_FT';
  if (explicitFullTime && !explicitIntern) return NOT_FULL_TIME_TITLE_RE.test(title) || fullTimeEntryBlock(job) ? 'other' : 'new_grad_FT';
  if (explicitIntern) return 'intern';
  if (!employment.trim() && !NOT_PERMANENT_RE.test(title)) return fullTimeEntryBlock(job) ? 'other' : 'new_grad_FT';
  return 'other';
}

// restart-apply-2（拍板人 2026-09-26「行，3年以上的跳过」）: new_grad_FT means a
// full-time role a new graduate can take — not a senior title, and a JD that
// does not state 3 or more years of required experience. Before, it meant only
// titles saying "New Grad", which startups never write.
export const MAX_ENTRY_YEARS = 2;

// Why a full-time job is not an entry job, or null. The years rule needs the JD;
// rows without one (DB rows downstream) were already checked at discovery.
function fullTimeEntryBlock(job) {
  if (SENIOR_RE.test(String(job.title || ''))) return 'senior_title';
  const years = requiredYears(job.description);
  if (years != null && years > MAX_ENTRY_YEARS) return `requires_3plus_years:${years}`;
  return null;
}

const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const N = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)';
// Not the upper end of a range ("3-5 years" is 3, never 5).
const NOT_RANGE_END = '(?<!(?:\\d|one|two|three|four|five|six|seven|eight|nine|ten)\\s*(?:-|–|—|to|or)\\s*)';
const YEARS_RES = [
  new RegExp(`${NOT_RANGE_END}\\b${N}\\s*\\+\\s*(?:years|yrs)\\b`, 'gi'),
  // "3-5 years", "3-5+ years", "5–10+ years", "2 or 3 years" → the lower end
  new RegExp(`\\b${N}\\s*(?:-|–|—|to|or)\\s*${N}\\s*\\+?\\s*(?:years|yrs)\\b`, 'gi'),
  new RegExp(`\\b(?:minimum|min\\.?|at least)\\s*(?:of\\s*)?${N}\\s*(?:years|yrs)\\b`, 'gi'),
  new RegExp(`${NOT_RANGE_END}\\b${N}\\s*(?:or more|and above|plus)\\s*(?:years|yrs)\\b`, 'gi'),
  new RegExp(`${NOT_RANGE_END}\\b${N}\\s*(?:years|yrs)\\s*(?:of\\s*)?(?:professional\\s*|relevant\\s*|related\\s*|work\\s*|industry\\s*|hands-on\\s*)?experience\\b`, 'gi'),
];
// Preferred only when the marker qualifies the years themselves: "3+ years
// preferred", "(3+ years is a plus)", "Preferred: 3+ years", "ideally 3+ years".
// NOT "5+ years in X, ideally in Y" — there "ideally" qualifies the field
// (verify 第 13 轮 P1: that reading let 4 senior jobs through).
const PREFERRED_RE = /^\s*(?:of\s+[\w\s/&-]{0,25}?)?(?:experience\s*)?[\s(,-]*(?:is\s+|are\s+)?(?:preferred|a plus|nice to have|bonus)\b/i;
// Same line only: "(NY or CA preferred)" ending the bullet above says nothing about these years.
const PREFERRED_BEFORE_RE = /\b(preferred|nice to have|bonus|ideally|plus)\b[ \t:(-]*$/i;
// A heading line (not a bullet, short) opening a nice-to-have section: its
// bullets are not requirements until the next heading.
const HEADING_RE = /^(?![-•*·●▪◦]|\d+[.)])[^\n]{1,60}$/;
const PREFERRED_HEADING_RE = /\b(nice[\s-]to[\s-]haves?|preferred|bonus|pluses|good to have|extra credit)\b/i;

function requiredText(text) {
  const lines = text.split('\n');
  if (lines.length < 2) return text;
  let preferred = false;
  const keep = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (HEADING_RE.test(line) && !/\byears?\b|\byrs\b/i.test(line)) {
      preferred = PREFERRED_HEADING_RE.test(line);
      continue;
    }
    if (!preferred) keep.push(line);
  }
  return keep.join('\n');
}
const toNum = (t) => (/^\d+$/.test(t) ? Number(t) : NUM_WORDS[t.toLowerCase()]);

// The highest "at least N years" a JD states as required (N = the lower end of a
// range), or null when it states none. Mentions marked preferred / nice to have
// are not requirements.
export function requiredYears(description) {
  const text = requiredText(String(description || ''));
  let max = null;
  for (const re of YEARS_RES) {
    for (const m of text.matchAll(re)) {
      const after = text.slice(m.index + m[0].length);
      const before = text.slice(Math.max(0, m.index - 40), m.index);
      if (PREFERRED_RE.test(after) || PREFERRED_BEFORE_RE.test(before)) continue;
      const n = toNum(m[1]);
      if (Number.isFinite(n) && n <= 30 && (max == null || n > max)) max = n;
    }
  }
  return max;
}

// Why a job does not pass the role-type gate for these targets, or null. The
// discovery funnel records the reason; passesAllowedRoleType is its boolean.
export function roleTypeBlockReason(job = {}, allowedRoleTypes = ['intern', 'part_time']) {
  const roleType = classifyRoleType(job);
  if (allowedRoleTypes.includes(roleType)) return SENIOR_RE.test(String(job.title || '')) ? 'senior_title' : null;
  if (allowedRoleTypes.includes('new_grad_FT') && roleType === 'other') {
    const why = fullTimeEntryBlock(job);
    const looksFullTime = (FULL_TIME_RE.test(String(job.employment_type || job.employmentType || '')) || !String(job.employment_type || job.employmentType || job.schedule || job.commitment || '').trim())
      && !INTERN_RE.test(String(job.title || '')) && !NOT_PERMANENT_RE.test(String(job.title || ''));
    if (why && looksFullTime) return why;
  }
  return 'role_type_not_allowed';
}

export function deriveRoleTypeFromJob(job = {}) {
  // A stored "other" is a veto made where the JD was visible (scorer / JD-aware
  // recheck at store time); a title-only recheck must never lift it (verify 第
  // 13 轮 P1). Likewise a title that reads senior now is never entry-level.
  if (String(job.role_type_match || '').trim().toLowerCase() === 'other') return 'other';
  const stored = normalizeRoleType(job.role_type_match);
  const derived = classifyRoleType(job) || 'other';
  if (stored === 'new_grad_FT' && SENIOR_RE.test(String(job.title || ''))) return 'other';
  if ((stored === 'intern' || stored === 'part_time') && derived !== stored) return derived;
  return stored || derived;
}

export function passesAllowedRoleType(job = {}, allowedRoleTypes = ['intern', 'part_time']) {
  return roleTypeBlockReason(job, allowedRoleTypes) === null;
}

// Cross-check the structured employment fields against the title to surface
// (but NOT block) suspicious postings. The title remains the strong signal:
// roleType is whatever classifyRoleType decided. A conflict is raised only
// when an intern/co-op-TITLED role carries an employment_type/schedule that
// looks PERMANENT and there is NO temp/intern/student signal anywhere. This
// preserves the legitimate "full-time-HOURS internship" case: such postings
// still carry an intern signal in the title (and usually employment_type
// "Intern"/"Internship"), so the TEMP_SIGNAL_RE in the title cancels the
// flag for the genuine ones — only employment_type values like a bare
// "FullTime"/"Permanent"/"Regular" on an intern title trip the flag for a
// human glance.
export function roleTypeConflict(job = {}) {
  const roleType = classifyRoleType(job);
  const title = String(job.title || '');
  const employment = String(
    job.employment_type || job.employmentType || job.schedule || job.commitment || ''
  );

  if (roleType !== 'intern') {
    return { roleType, conflict: false, reason: '' };
  }

  // Title says intern. Does the structured employment field look permanent
  // while NOTHING (title or employment field) carries a temp/student signal?
  const employmentLooksPermanent = PERMANENT_EMPLOYMENT_RE.test(employment);
  const hasTempSignalInEmployment = TEMP_SIGNAL_RE.test(employment);

  if (employmentLooksPermanent && !hasTempSignalInEmployment) {
    return {
      roleType,
      conflict: true,
      reason: `intern-titled role has permanent employment_type "${employment.trim()}" with no intern/temp signal; verify it is a true internship (not a permanent full-time role an F-1 student cannot take)`,
    };
  }

  return { roleType, conflict: false, reason: '' };
}
