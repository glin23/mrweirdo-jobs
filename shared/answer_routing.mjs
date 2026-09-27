import { classifyPlace, namedPlaces } from './location_gate.mjs';
import { customFactKey } from './missing_field_questions.mjs';
// Pure answer-routing helpers extracted from ashby_apply_driver.mjs so the
// safety-critical decisions can be unit-tested WITHOUT a live browser tab.
// Behavior here is verbatim with the driver's prior inline logic — these are
// extractions, not rewrites. The driver imports them and still performs the
// actual CDP fill/click; only the *decision* lives here.

// --- Specific-city LOGISTICS FACT detection ---------------------------------
// Matches questions that assert the user already RESIDES in / has physical
// TRANSPORT to a NAMED place — a personal fact the tool cannot know. A bare
// named city with no transport/residence verb is NOT caught, so general
// willingness phrasings still flow through to the policy path.
const TRANSPORT_FACT_RE = /reliable transportation|own transportation|have transportation|access to (?:reliable )?transportation|means of transportation|commute (?:to|into)/i;
const RESIDENCE_FACT_RE = /currently (?:live|living|reside|residing|located|based)|do you (?:live|reside)|already (?:live|living|reside|based)/i;

export function isSpecificCityLogisticsFact(label = '') {
  const s = String(label);
  return TRANSPORT_FACT_RE.test(s) || RESIDENCE_FACT_RE.test(s);
}

// Open-ended residence prompts ask the user to STATE where they live, with no
// named metro and no yes/no framing — e.g. "Where do you currently live?",
// "Where do you reside?", "Current city". The answer is the user's real city
// from their profile (a known fact, NOT something the tool cannot know), so
// these are answerable and should bypass the specific-city-fact guard. A NAMED
// yes/no question ("Are you currently located in the Bay Area?") does NOT match
// here and stays guarded.
const OPEN_ENDED_RESIDENCE_RE = /\bwhere (?:do|are) you\b[^?]{0,40}\b(?:live|living|reside|residing|located|based)\b|\bwhat (?:city|town)\b[^?]{0,30}\b(?:live|reside|based|from)\b|\bcurrent (?:city|residence|home (?:city|address))\b|\bcity of residence\b/i;

export function isOpenEndedResidenceQuestion(label = '') {
  return OPEN_ENDED_RESIDENCE_RE.test(String(label));
}

// --- Relocation policy ------------------------------------------------------
// True only when the user explicitly opted into relocating anywhere legally
// workable. Accepts either the whole search_intent.json object or the inner
// geographic_preference object.
// anywhere_primary_country (「全美可搬」) is open for a job located in that
// country — the first real run asked the user about OpusClip's Mountain View
// office although he had said "anywhere in the US" (2026-09-26). A job whose
// location is unknown or abroad is not covered: ask.
//
// The place the QUESTION names comes first (verify 第 17 轮: a job listed in
// London + New York asked about the London office and got Yes): a question
// naming a place outside the US is always asked; one naming a US place is
// covered by 「全美可搬」; only a question naming no place falls back to the
// job's own location.
export function relocationPolicyOpen(searchIntent = {}, { jobLocation = '', questionText = '' } = {}) {
  const geo = searchIntent?.search_intent?.geographic_preference
    || searchIntent?.geographic_preference
    || {};
  if (geo.willing_to_relocate_for_internship !== true) return false;
  const named = namedPlaces(questionText);
  if (named.foreign) return false;
  if (geo.relocation_policy === 'anywhere_legal_work') return true;
  if (geo.relocation_policy === 'anywhere_primary_country') {
    if (String(geo.primary_country || 'US').toUpperCase() !== 'US') return false;
    return named.us || classifyPlace(jobLocation) === 'us';
  }
  return false;
}

// Cities the user has explicitly confirmed living-in / having logistics for.
// Empty by default so unknown cities always ask-or-skip.
export function confirmedCitiesFrom(profile = {}) {
  const out = new Set(
    (profile?.factual_gap_fields?.onsite_location_logistics?.confirmed_cities || [])
      .map((c) => String(c).toLowerCase())
  );
  const commitments = profile?.standard_qa?.work_location_commitments || {};
  for (const [place, ok] of Object.entries(commitments)) {
    if (ok === true) out.add(String(place).toLowerCase());
  }
  return [...out];
}

export function mentionsConfirmedCity(label = '', confirmedCities = []) {
  const ml = String(label).toLowerCase();
  return confirmedCities.some((c) => c && ml.includes(c));
}

const STATE_NAMES = {
  AL: 'alabama',
  AK: 'alaska',
  AZ: 'arizona',
  AR: 'arkansas',
  CA: 'california',
  CO: 'colorado',
  CT: 'connecticut',
  DC: 'district of columbia',
  DE: 'delaware',
  FL: 'florida',
  GA: 'georgia',
  HI: 'hawaii',
  IA: 'iowa',
  ID: 'idaho',
  IL: 'illinois',
  IN: 'indiana',
  KS: 'kansas',
  KY: 'kentucky',
  LA: 'louisiana',
  MA: 'massachusetts',
  MD: 'maryland',
  ME: 'maine',
  MI: 'michigan',
  MN: 'minnesota',
  MO: 'missouri',
  MS: 'mississippi',
  MT: 'montana',
  NC: 'north carolina',
  ND: 'north dakota',
  NE: 'nebraska',
  NH: 'new hampshire',
  NJ: 'new jersey',
  NM: 'new mexico',
  NV: 'nevada',
  NY: 'new york',
  OH: 'ohio',
  OK: 'oklahoma',
  OR: 'oregon',
  PA: 'pennsylvania',
  RI: 'rhode island',
  SC: 'south carolina',
  SD: 'south dakota',
  TN: 'tennessee',
  TX: 'texas',
  UT: 'utah',
  VA: 'virginia',
  VT: 'vermont',
  WA: 'washington',
  WI: 'wisconsin',
  WV: 'west virginia',
  WY: 'wyoming',
};

function wordIncludes(haystack, needle) {
  const clean = String(needle || '').trim().toLowerCase();
  if (!clean) return false;
  return new RegExp(`\\b${clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(String(haystack || ''));
}

export function currentResidenceYesNoAnswer(label = '', profile = {}) {
  const text = String(label || '');
  const lt = text.toLowerCase();
  if (!/\b(?:do you|are you|currently|already)\b.{0,90}\b(?:live|living|reside|residing|located|based)\b.{0,90}\b(?:in|near|within|around)\b/i.test(text)) {
    return null;
  }
  if (/\b(?:willing|open to|relocat|able to work|can work|commute|transportation|travel)\b/i.test(text)) {
    return null;
  }

  const personal = profile?.personal || {};
  const addr = personal.address || {};
  const rawCity = personal.address_city || addr.city || personal.city || '';
  const city = String(rawCity || '').split(',')[0].trim();
  const stateRaw = String(personal.address_state || addr.state || '').trim();
  const stateUpper = stateRaw.toUpperCase();
  const stateName = STATE_NAMES[stateUpper] || stateRaw.toLowerCase();
  const country = String(personal.address_country || addr.country || '').toLowerCase();
  const livesInUnitedStates = /united states|usa|\bu\.?s\.?\b/.test(country);

  if (!city && !stateRaw && !country) {
    return { needs_user_answer: true, note: 'current_residence_required' };
  }

  const yesTokens = [
    city,
    stateName,
    stateUpper.length === 2 ? stateUpper : '',
    country,
    livesInUnitedStates ? 'united states' : '',
    livesInUnitedStates ? 'usa' : '',
  ].filter(Boolean);

  if ((livesInUnitedStates && /\b(?:US|U\.S\.|USA)\b/.test(text)) ||
      yesTokens.some((token) => wordIncludes(lt, token))) {
    return { value: 'Yes', note: 'current_residence_from_profile' };
  }

  const placeMatch = text.match(/\b(?:live|living|reside|residing|located|based)\b.{0,30}\b(?:in|near|within|around)\s+(?:the\s+)?(.+?)\??$/i);
  const askedPlace = String(placeMatch?.[1] || '').trim().replace(/[.?!]+$/, '');
  if (!askedPlace || /^(area|office|location|role|position|job)$/i.test(askedPlace)) return null;

  return { value: 'No', note: 'current_residence_not_matching_profile' };
}

// --- Work authorization answers ---------------------------------------------
// These two profile fields are FACTS ABOUT THE USER'S PERSON and are THREE-STATE:
//   true      -> the user told us yes
//   false     -> the user told us no
//   null/undef-> we never asked
// Reading them with a truthy check collapses "no" and "never asked" into the
// same branch. Before 2026-07-23 that branch fell back to the answer bank's
// yes_no_defaults, which shipped "Yes" for both — so a user who had explicitly
// said "I am NOT authorized to work in the US" still had "Yes" typed onto a
// real application form, and a US citizen was told to claim they need visa
// sponsorship. The bank is deliberately NOT consulted here any more: a shared
// default cannot know a personal fact. "Never asked" returns null and the
// caller must surface the row as a gap (see workAuthGapFor).
// F-1 honesty is unchanged: an OPT user is authorized NOW (Yes) and answers Yes
// to future sponsorship — never the false "I will not require sponsorship".
function threeStateYesNo(value, requiredNote, fromProfileNote) {
  if (value === true) return { value: 'Yes', needsUser: false, note: fromProfileNote };
  if (value === false) return { value: 'No', needsUser: false, note: fromProfileNote };
  return { value: null, needsUser: true, note: requiredNote };
}

export function deriveWorkAuthAnswers(profile = {}) {
  const auth = profile.work_authorization || {};
  const sponsor = threeStateYesNo(
    auth.requires_sponsorship_future,
    'sponsorship_future_required',
    'sponsorship_future_from_profile',
  );
  const authorized = threeStateYesNo(
    auth.authorized_to_work_us,
    'work_authorization_required',
    'work_authorization_from_profile',
  );
  return {
    sponsorAns: sponsor.value,
    authorizedAns: authorized.value,
    sponsorNeedsUser: sponsor.needsUser,
    authorizedNeedsUser: authorized.needsUser,
    sponsorNote: sponsor.note,
    authorizedNote: authorized.note,
  };
}

// Which form questions are answered FROM those two fields. Kept in sync with the
// consuming buckets in answer_buckets.mjs (`authorized to work` / sponsorship /
// `work auth|visa` / "maintain that authorization") and with the driver's own
// combobox branches, so no question that would be filled from a work-auth fact
// can slip past this guard.
const WORK_AUTH_LABEL_RE = /authorized to work|legally.{0,5}work|eligible to work|right to work|authorized.{0,40}work.{0,20}u\.?s|legally authorized.{0,40}u\.?s/i;
// `\bvisas?\b` and not a bare `visa`: measured 2026-07-25, the unbounded token
// also fired on "ad-VISA-ble", pulling unrelated questions into this guard.
const SPONSORSHIP_LABEL_RE = /sponsor|sponsorship|work auth|\bvisas?\b|(?:maintain|commence|continue|begin|support).{0,40}(?:authorization|immigration)|authorization.{0,15}to (?:work|employ|remain)|immigration case/i;
// "…authorized to work WITHOUT sponsorship" has its own explicit-false-only
// derivation in the drivers (authorizedWithoutSponsorship), so it is not routed
// through the two fields above and is left to that path.
const WITHOUT_SPONSORSHIP_LABEL_RE = /(?:authorized|eligible|right|legally).{0,80}work.{0,80}without.{0,50}sponsor|without.{0,50}sponsor.{0,80}(?:work|employment|authorization)|unrestricted.{0,50}(?:work|employment|authorization)/i;

// Q4 关卡 8: he was asked, once, what to do when a form asks the
// work-authorization question, and "don't answer for me" is the default. That
// instruction covers the whole question family (同族一起 defer). It is NOT the
// same thing as "never asked", and the two must never share a note: the correct
// follow-up to never-asked is to ask, the correct follow-up to deferred is to
// hand him the row and NEVER ask again (设计稿 §13.3.3 接缝硬规定 2).
export function workAuthPolicyDefers(profile = {}) {
  return profile.work_authorization?.form_answer_policy === 'defer_to_user';
}

// The right note for a blocked work-auth row: deferred by his own instruction
// (self-serve list, never re-ask) or the caller's never-asked note. Drivers'
// inline work-auth branches use this so a Q4-C profile is honoured everywhere,
// not only on the labels workAuthGapFor recognises.
export function workAuthBlockNote(profile = {}, neverAskedNote) {
  return workAuthPolicyDefers(profile) ? 'work_authorization_deferred_by_user' : neverAskedNote;
}

// "…authorized to work WITHOUT sponsorship / without restriction" — the fact
// is the two sponsorship booleans, read three-state (ADR-12 R2: the visa_status
// regexes both drivers used here turned free text — once the user's own Chinese
// sentence — into Yes/No claims). 'Yes' only when both are false (the citizen /
// green-card signature in the truth table); 'No' when either is true; null when
// unknowable, and the caller must block the row (关卡 2 ③: 无限制授权未知 →
// 阻塞问清楚再投 — 答错双向都伤). No default branch: that was the fabrication.
export function withoutSponsorshipAnswer(profile = {}) {
  const auth = profile.work_authorization || {};
  const now = auth.requires_sponsorship_now;
  const future = auth.requires_sponsorship_future;
  if (now === false && future === false) return 'Yes';
  if (now === true || future === true) return 'No';
  return null;
}

// Pure gap check: returns a blocking descriptor when the form asks about a
// work-authorization fact the profile cannot answer, else null. Mirrors the
// shape used by currentResidenceYesNoAnswer's blocking branch. `note` says
// WHY the cell is empty: never asked (ask him) vs deferred by his own
// instruction (self-serve list, do not ask).
export function workAuthGapFor(label = '', profile = {}) {
  const text = String(label || '');
  if (!text) return null;
  if (WITHOUT_SPONSORSHIP_LABEL_RE.test(text)) return null;
  const defers = workAuthPolicyDefers(profile);
  const { authorizedNeedsUser, sponsorNeedsUser } = deriveWorkAuthAnswers(profile);
  if (authorizedNeedsUser && WORK_AUTH_LABEL_RE.test(text)) {
    return { needs_user_answer: true, note: defers ? 'work_authorization_deferred_by_user' : 'work_authorization_required' };
  }
  if (sponsorNeedsUser && SPONSORSHIP_LABEL_RE.test(text)) {
    return { needs_user_answer: true, note: defers ? 'work_authorization_deferred_by_user' : 'sponsorship_future_required' };
  }
  return null;
}

// --- Years-of-experience choice -----------------------------------------------
// "How many years of X experience do you have?" as a radio list: pick the option
// whose range holds the user's own number (profile standard_qa field). No
// number, or no option that holds it → null and the question stays asked; the
// answer bank's "< 1" default is not a fact about anyone (真投 2026-09-27 Suno).
function yearsRange(label) {
  const t = String(label || '').toLowerCase().replace(/[–—]/g, '-');
  let m;
  if ((m = t.match(/(?:less than|under|fewer than|<)\s*(\d+(?:\.\d+)?)/))) return { min: 0, max: Number(m[1]), inclusive: false };
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*(?:\+|or more|and (?:up|above)|or above)/)) || (m = t.match(/(?:more than|over|above)\s*(\d+(?:\.\d+)?)/))) return { min: Number(m[1]), max: Infinity, inclusive: false };
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)/))) return { min: Number(m[1]), max: Number(m[2]), inclusive: true };
  if (/^\s*(?:none|no experience)\b/.test(t)) return { min: 0, max: 0, inclusive: true };
  if ((m = t.match(/^\s*(\d+(?:\.\d+)?)\s*(?:years?|yrs?)?\s*$/))) return { min: Number(m[1]), max: Number(m[1]), inclusive: true };
  return null;
}

export function pickYearsOption(options = [], years) {
  if (!/^\s*\d+(?:\.\d+)?\s*$/.test(String(years ?? ''))) return null;
  const y = Number(years);
  const ranged = (options || []).map((label) => ({ label, r: yearsRange(label) })).filter((o) => o.r);
  // Half-open first, so a boundary value lands in the range that STARTS there
  // ("1" → "1-3", not "0-1"); a closed range only when nothing else holds it.
  const open = ranged.find(({ r }) => y >= r.min && y < r.max);
  if (open) return open.label;
  const closed = ranged.find(({ r }) => r.inclusive && y >= r.min && y <= r.max);
  return closed ? closed.label : null;
}

// --- Questions that ask for an opinion about the company's own channels --------
// "Look at our social accounts … what is working and what is not", "What type of
// content should we be doing more of", "What other brands … do social really
// well". Nothing in the profile answers these; the main agent drafts them from
// the company's public accounts (shared/agent_drafts.mjs) under
// shared/references/truthfulness.md — no invented facts about the candidate.
const COMPANY_CRITIQUE_RE = /what(?:'s| is) working and what(?:'s| is)? not|what (?:type|kind)s? of content should we|should we be doing more of|what other (?:brands|accounts|companies)\b.{0,80}\bwell|\bdo social (?:really )?well|look at our (?:social|accounts|channels|content)/i;

export function isCompanyCritiqueQuestion(label = '') {
  return COMPANY_CRITIQUE_RE.test(String(label));
}

// --- Salary number for a number-only box (restart-apply-3 BUG_REPORT 第 4 章) ---
// Reevo's "base salary expectations" is <input type=number>: the English
// sentence the driver typed never went in, and the driver said ok. A number box
// gets the profile's own number — same source order as the Lever driver — and
// only when the question's unit (hourly vs annual) matches the profile's. An
// hourly figure is never turned into an annual one: that number was never said.
const HOURLY_RE = /\/\s*h(?:ou)?r\b|per hour|hourly|an hour|\bhr\b/i;
const ANNUAL_RE = /\/\s*y(?:ea)?r\b|per year|per annum|annual|yearly|\bk\b/i;

export function salaryNumberFor(label = '', profile = {}, essayProfile = {}) {
  // The user's own answer to THIS question comes first: the gap report asks it
  // and writes it under custom_facts[customFactKey(label)] (missing_field_questions.mjs).
  const asked = profile?.standard_qa?.custom_facts?.[customFactKey(label)];
  const raw = String(
    (asked !== undefined && asked !== null && asked !== '' ? asked : '')
    || profile?.work_authorization?.salary_expectation_usd
    || profile?.standard_qa?.salary_expectation_usd
    || essayProfile?.factual_gap_fields?.compensation_acceptance?.expected_salary_number
    || '',
  );
  const m = raw.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(k\b)?/i);
  if (!m) return { ok: false, note: 'salary_number_unset' };
  const amount = Number(m[1]) * (m[2] ? 1000 : 1);
  const q = String(label);
  const want = /hour|hourly|\/\s*hr\b|\brate\b/i.test(q) ? 'hour' : (/salary|annual|per year|yearly/i.test(q) ? 'year' : null);
  const answeredHere = asked !== undefined && asked !== null && asked !== '';
  // A bare number the user gave to this very question is in that question's unit.
  const have = HOURLY_RE.test(raw) ? 'hour' : (ANNUAL_RE.test(raw) || amount >= 1000 ? 'year' : (answeredHere ? want : null));
  if (!have) return { ok: false, note: 'salary_unit_unknown', have: raw };
  if (want && want !== have) return { ok: false, note: 'salary_unit_mismatch', have: raw, want };
  return { ok: true, value: String(amount), unit: have };
}

// --- Which-location(s) choice questions (restart-apply-3 BUG_REPORT 第 4 章) ---
// "This role is primarily in-office. Which location(s) would you be open to
// working from?" with San Francisco / Santa Clara / Both checkboxes. It went to
// the RTO yes/no bucket and found no Yes button. The answer is a set of places,
// decided by the same relocation rules as every other location question.
const WORK_LOCATION_Q_RE = /\bwhich\s+(?:of\s+(?:our|the|these)\s+)?(?:locations?|offices?|cit(?:y|ies)|sites?|hubs?)(?:\s*\(s\))?\b/i;

export function isWorkLocationChoiceQuestion(label = '') {
  return WORK_LOCATION_Q_RE.test(String(label));
}

const ALL_OPTION_RE = /^(?:both|all|all of the above|any|either|any location|all locations|open to all|no preference|flexible)\b/i;
const NONE_OPTION_RE = /^(?:none|neither|other|n\/a|not applicable)\b/i;
const REMOTE_OPTION_RE = /\bremote\b/i;

// Returns { ok:true, picks:[option labels] } or { ok:false, note, unconfirmed }.
// Every place option must be covered (a city the user confirmed, or covered by
// the relocation policy — which never covers a foreign place); one uncovered
// place and the whole question goes to the user. An "all / both" option is
// picked alone when every place is covered; otherwise every covered place.
export function pickWorkLocations(options = [], { searchIntent = {}, profile = {}, jobLocation = '', questionText = '' } = {}) {
  const geo = searchIntent?.search_intent?.geographic_preference || searchIntent?.geographic_preference || {};
  const confirmed = confirmedCitiesFrom(profile);
  const refused = Object.entries(profile?.standard_qa?.work_location_commitments || {})
    .filter(([, ok]) => ok === false).map(([place]) => String(place).toLowerCase());
  const jobLoc = String(jobLocation || '').toLowerCase();
  const labels = (options || []).map((o) => String(o || '').trim()).filter(Boolean);
  const meta = labels.filter((o) => ALL_OPTION_RE.test(o));
  const remote = labels.filter((o) => REMOTE_OPTION_RE.test(o) && !ALL_OPTION_RE.test(o));
  const places = labels.filter((o) => !ALL_OPTION_RE.test(o) && !NONE_OPTION_RE.test(o) && !REMOTE_OPTION_RE.test(o));
  const covered = (place) => {
    const p = place.toLowerCase();
    if (refused.some((r) => r && p.includes(r))) return false;
    if (mentionsConfirmedCity(p, confirmed)) return true;
    const named = namedPlaces(place);
    if (named.foreign) return false;
    // A name that is neither a known US place nor part of this job's own
    // location is not something any rule covers.
    if (!named.us && !(jobLoc && jobLoc.includes(p))) return false;
    return relocationPolicyOpen(searchIntent, { jobLocation, questionText: place });
  };
  const unconfirmed = places.filter((p) => !covered(p));
  if (unconfirmed.length) return { ok: false, note: 'work_location_needs_user', unconfirmed, question: questionText };
  if (places.length && meta.length) return { ok: true, picks: [meta[0]] };
  if (places.length) return { ok: true, picks: places };
  if (remote.length && geo.remote_acceptable === true) return { ok: true, picks: remote };
  return { ok: false, note: 'work_location_needs_user', unconfirmed: labels, question: questionText };
}
