const INTERN_RE = /\b(intern|internship|co-?op)\b/i;
const PART_TIME_RE = /\b(part[\s-]?time|working student|student assistant|student worker|campus ambassador|brand ambassador)\b/i;
const NEW_GRAD_RE = /\b(new\s?grad|new\s?graduate|university\s?grad|university\s?graduate|early\s?career|recent\s?graduate)\b/i;
// Senior title markers. "Manager" is deliberately NOT one: at these startups an
// entry full-time role is often「X Manager」(Community / Affiliate / Field
// Marketing Manager) — restart-apply-2 BUG_REPORT; "Senior Manager" is caught
// by "senior". "Chief" matches "Chief of Staff" too (not an entry role).
const SENIOR_RE = /\b(senior|sr\.?|staff|principal|lead|director|head|vp|chief)\b/i;
// A non-intern title with no employment field (Greenhouse gives none) counts as
// full-time unless something says temporary (a "Summer … Fellowship Program" is not a job).
// Even with a full-time employment field, a title saying (Freelance) / (Contract)
// is not a full-time job (seen on ElevenLabs boards).
const NOT_FULL_TIME_TITLE_RE = /\b(contract|contractor|freelance|temp|temporary|seasonal|fixed[\s-]?term)\b/i;
const NOT_PERMANENT_RE = /\b(contract|contractor|temp|temporary|seasonal|summer|fellowship|fixed[\s-]?term|freelance|volunteer)\b/i;
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
const NOT_RANGE_END = '(?<!(?:\\d|one|two|three|four|five|six|seven|eight|nine|ten)\\s*(?:-|–|—|to)\\s*)';
const YEARS_RES = [
  new RegExp(`${NOT_RANGE_END}\\b${N}\\s*\\+\\s*(?:years|yrs)\\b`, 'gi'),
  new RegExp(`\\b${N}\\s*(?:-|–|—|to)\\s*${N}\\s*(?:years|yrs)\\b`, 'gi'),
  new RegExp(`\\b(?:minimum|min\\.?|at least)\\s*(?:of\\s*)?${N}\\s*(?:years|yrs)\\b`, 'gi'),
  new RegExp(`${NOT_RANGE_END}\\b${N}\\s*(?:or more|and above|plus)\\s*(?:years|yrs)\\b`, 'gi'),
  new RegExp(`${NOT_RANGE_END}\\b${N}\\s*(?:years|yrs)\\s*(?:of\\s*)?(?:professional\\s*|relevant\\s*|related\\s*|work\\s*|industry\\s*|hands-on\\s*)?experience\\b`, 'gi'),
];
const PREFERRED_RE = /^[^.;\n]{0,40}\b(preferred|nice to have|a plus|bonus|ideally)\b/i;
const PREFERRED_BEFORE_RE = /\b(preferred|nice to have|bonus|ideally)\b[^.;\n]{0,30}$/i;
const toNum = (t) => (/^\d+$/.test(t) ? Number(t) : NUM_WORDS[t.toLowerCase()]);

// The highest "at least N years" a JD states as required (N = the lower end of a
// range), or null when it states none. Mentions marked preferred / nice to have
// are not requirements.
export function requiredYears(description) {
  const text = String(description || '');
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
  const stored = normalizeRoleType(job.role_type_match);
  const derived = classifyRoleType(job) || 'other';
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
