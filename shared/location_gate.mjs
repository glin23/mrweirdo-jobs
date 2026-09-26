// location_gate.mjs — the discovery hard filter on where a job is.
//
// restart-apply-2（拍板人 A1：全美可搬 + 美国远程）. Before, a place the word
// lists did not know passed by default, so ~100 jobs in Almaty, the UK,
// "Europe", "UAE " … slipped through (BUG_REPORT 同模式风险). Now every place of
// a job — the primary location, the board's extra locations and, when the board
// gives one, the structured country — is classified US / other country /
// unqualified remote / unknown, and:
//   · any US place (or a country the user is open to)  → pass;
//   · else any foreign place                            → location_mismatch:<place>;
//   · else an unqualified "Remote" and the user takes remote → pass
//     (US startups post US-remote as bare "Remote"; a "Remote" whose other
//     places are all foreign is caught by the line above);
//   · else                                              → location_unrecognized:<place>
//     (never a silent pass; the funnel shows the text so the list can grow).
// No location at all passes: boards often omit it, and the form and scoring see
// the JD.

const US_STATES = [
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida', 'georgia',
  'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland',
  'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire',
  'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania',
  'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington',
  'west virginia', 'wisconsin', 'wyoming', 'district of columbia',
];
const US_STATE_CODES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'];
const US_CITIES = [
  'san francisco', 'sf', 'bay area', 'silicon valley', 'mountain view', 'palo alto', 'menlo park', 'redwood city', 'san mateo',
  'sunnyvale', 'san jose', 'santa clara', 'cupertino', 'oakland', 'berkeley', 'south san francisco', 'burlingame', 'foster city',
  'los angeles', 'santa monica', 'culver city', 'pasadena', 'burbank', 'irvine', 'san diego', 'playa vista',
  'new york', 'nyc', 'new york city', 'brooklyn', 'manhattan', 'queens', 'jersey city', 'hoboken',
  'seattle', 'bellevue', 'redmond', 'kirkland', 'portland', 'boston', 'cambridge, ma', 'somerville', 'austin', 'dallas', 'houston',
  'san antonio', 'denver', 'boulder', 'chicago', 'atlanta', 'miami', 'washington, dc', 'washington dc', 'arlington', 'philadelphia',
  'pittsburgh', 'salt lake city', 'lehi', 'phoenix', 'minneapolis', 'detroit', 'raleigh', 'durham', 'nashville', 'cincinnati',
  'columbus', 'baltimore', 'las vegas', 'san luis obispo', 'princeton', 'new haven', 'ann arbor', 'madison', 'st. louis', 'kansas city',
];
// Not bare "america" ("Latin America") nor "la" / "venice" (other countries use them).
const US_WORDS = ['united states', 'usa', 'u.s.', 'u.s.a', 'us', 'north america', 'americas'];
const CN_PLACES = ['china', 'beijing', 'shanghai', 'shenzhen', 'hong kong', 'guangzhou', 'hangzhou'];
const FOREIGN = [
  // regions
  'europe', 'eu', 'emea', 'apac', 'asia', 'latam', 'latin america', 'middle east', 'africa', 'oceania', 'nordics', 'dach', 'benelux',
  // countries
  'united kingdom', 'uk', 'england', 'scotland', 'wales', 'ireland', 'germany', 'france', 'spain', 'italy', 'portugal', 'netherlands',
  'belgium', 'switzerland', 'austria', 'sweden', 'norway', 'denmark', 'finland', 'iceland', 'poland', 'czechia', 'czech republic',
  'slovakia', 'hungary', 'romania', 'bulgaria', 'greece', 'croatia', 'serbia', 'slovenia', 'estonia', 'latvia', 'lithuania', 'ukraine',
  'georgia (country)', 'armenia', 'turkey', 'türkiye', 'cyprus', 'malta', 'luxembourg', 'kazakhstan', 'uzbekistan', 'russia',
  'israel', 'uae', 'u.a.e', 'united arab emirates', 'saudi arabia', 'qatar', 'kuwait', 'bahrain', 'oman', 'egypt', 'morocco',
  'nigeria', 'kenya', 'south africa', 'ghana', 'india', 'pakistan', 'bangladesh', 'sri lanka', 'nepal', 'china', 'japan', 'korea',
  'south korea', 'taiwan', 'singapore', 'malaysia', 'indonesia', 'philippines', 'thailand', 'vietnam', 'australia', 'new zealand',
  'canada', 'mexico', 'brazil', 'brasil', 'argentina', 'chile', 'colombia', 'peru', 'uruguay', 'costa rica', 'guatemala',
  // cities
  'london', 'manchester', 'edinburgh', 'cambridge, uk', 'oxford', 'dublin', 'berlin', 'munich', 'münchen', 'hamburg', 'frankfurt',
  'cologne', 'freiburg', 'stuttgart', 'paris', 'lyon', 'amsterdam', 'rotterdam', 'brussels', 'zurich', 'zürich', 'geneva', 'vienna',
  'stockholm', 'copenhagen', 'oslo', 'helsinki', 'warsaw', 'krakow', 'kraków', 'prague', 'budapest', 'bucharest', 'lisbon', 'porto',
  'madrid', 'barcelona', 'valencia', 'rome', 'milan', 'athens', 'istanbul', 'kyiv', 'kiev', 'tallinn', 'riga', 'vilnius', 'belgrade',
  'almaty', 'astana', 'tbilisi', 'batumi', 'yerevan', 'tel aviv', 'jerusalem', 'haifa', 'dubai', 'abu dhabi', 'riyadh', 'doha', 'cairo', 'lagos', 'nairobi',
  'cape town', 'johannesburg', 'bangalore', 'bengaluru', 'mumbai', 'delhi', 'new delhi', 'gurgaon', 'gurugram', 'noida', 'hyderabad',
  'pune', 'chennai', 'beijing', 'shanghai', 'shenzhen', 'hong kong', 'guangzhou', 'hangzhou', 'taipei', 'tokyo', 'osaka', 'seoul',
  'singapore', 'kuala lumpur', 'jakarta', 'manila', 'bangkok', 'ho chi minh', 'hanoi', 'sydney', 'melbourne', 'brisbane', 'perth',
  'auckland', 'toronto', 'vancouver', 'burnaby', 'montreal', 'montréal', 'calgary', 'ottawa', 'waterloo', 'mexico city', 'monterrey',
  'guadalajara', 'sao paulo', 'são paulo', 'rio de janeiro', 'buenos aires', 'santiago', 'bogota', 'bogotá', 'medellin', 'lima',
];
const REMOTE_WORDS = ['remote', 'anywhere', 'worldwide', 'global', 'distributed'];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole-word (not inside another word: "us" ≠ "business", "la" ≠ "atlanta").
const wordsRe = (words, flags = 'i') => new RegExp(`(^|[^\\p{L}\\p{N}])(${words.map(escapeRe).join('|')})(?=$|[^\\p{L}\\p{N}])`, `${flags}u`);
const US_RE = wordsRe([...US_WORDS, ...US_STATES, ...US_CITIES]);
// ", CA" after a city; case-sensitive, and only after foreign names were ruled
// out ("Bangalore, IN" is India, not Indiana).
const US_CODE_RE = new RegExp(`,\\s*(${US_STATE_CODES.join('|')})(?=$|[\\s,)])`);
// ", WA" etc. that no country shares — "Vancouver, WA" is US; "Bangalore, IN" /
// "Toronto, CA" are not decided by the code (IN = India, CA = Canada too).
const US_CODE_UNAMBIGUOUS_RE = new RegExp(`,\\s*(${US_STATE_CODES.filter((c) => !['IN', 'CA', 'DE', 'GA', 'AL', 'AR', 'CO', 'ID', 'MA', 'MD', 'ME', 'MN', 'MT', 'NE', 'PA', 'SC', 'VA'].includes(c)).join('|')})\\s*$`);
const US_STATE_RE = wordsRe(US_STATES);
const US_NOT_STATE_RE = wordsRe([...US_WORDS, ...US_CITIES]);
// "overlap with US hours" / "US time zones" says when, not where.
const US_TIME_RE = /\b(u\.?s\.?|us)\s*(hours|business hours|time\s*zones?|timezones?)\b/gi;
const CN_RE = wordsRe(CN_PLACES);
const FOREIGN_RE = wordsRe(FOREIGN);
const REMOTE_RE = wordsRe(REMOTE_WORDS);

// One place → 'us' | 'cn' | 'foreign' | 'remote' | 'unknown'. A place naming both
// a US place and a foreign one ("Remote - US or Canada") counts as US.
export function classifyPlace(text) {
  const t = String(text || '').replace(US_TIME_RE, ' ').trim();
  if (!t) return 'unknown';
  if (US_CODE_UNAMBIGUOUS_RE.test(t)) return 'us';
  // A foreign city with only a US *state* name is the foreign one
  // ("Tbilisi, Georgia"); a US city or "United States" still wins.
  if (US_STATE_RE.test(t) && !US_NOT_STATE_RE.test(t) && FOREIGN_RE.test(t)) return 'foreign';
  if (US_RE.test(t)) return 'us';
  if (CN_RE.test(t)) return 'cn';
  if (FOREIGN_RE.test(t)) return 'foreign';
  if (US_CODE_RE.test(t)) return 'us';
  if (REMOTE_RE.test(t)) return 'remote';
  return 'unknown';
}

function classifyCountry(country) {
  const c = String(country || '').trim();
  if (!c) return null;
  if (/^(united states|usa|us|united states of america)$/i.test(c)) return 'us';
  return CN_RE.test(c) ? 'cn' : 'foreign';
}

// A place the title itself names ("Consumer Support Specialist - London",
// "… (Berlin)"): the job is there, whatever the location fields add (verify
// 第 13 轮: Remote + London with a US country slipped through).
function titlePlace(title) {
  const t = String(title || '');
  const m = t.match(/(?:\s[-–—|]\s*|[([])([^-–—|()[\]]{2,40})[)\]]?\s*$/);
  return m ? m[1].trim() : null;
}

export function locationVerdict(job = {}, intent = {}) {
  const geo = intent.geographic_preference || {};
  const named = titlePlace(job.title);
  const namedKind = named ? classifyPlace(named) : 'unknown';
  if (namedKind === 'foreign' || (namedKind === 'cn' && !(geo.countries_open_to || []).map((c) => String(c).toUpperCase()).includes('CN'))) {
    return { ok: false, reason: `location_mismatch:${named}` };
  }
  const openTo = new Set((geo.countries_open_to || [geo.primary_country || 'US']).map((s) => String(s).toUpperCase()));
  const remoteOK = geo.remote_acceptable !== false;
  const places = [...new Set([job.location, ...(Array.isArray(job.locations) ? job.locations : [])].map((p) => String(p || '').trim()).filter(Boolean))];
  const countries = (Array.isArray(job.location_countries) ? job.location_countries : []).map(classifyCountry).filter(Boolean);
  if (places.length === 0 && countries.length === 0) return { ok: true, reason: null };

  const kinds = [...countries, ...places.map(classifyPlace)];
  const open = (k) => (k === 'us' && openTo.has('US')) || (k === 'cn' && openTo.has('CN'));
  if (kinds.some(open)) return { ok: true, reason: null };
  const firstOf = (kind) => places.find((p) => classifyPlace(p) === kind) ?? places[0] ?? job.location_countries?.[0];
  if (kinds.some((k) => k === 'foreign' || k === 'cn' || k === 'us')) return { ok: false, reason: `location_mismatch:${firstOf(kinds.includes('foreign') ? 'foreign' : kinds.includes('cn') ? 'cn' : 'us')}` };
  if (kinds.includes('remote')) return remoteOK ? { ok: true, reason: null } : { ok: false, reason: `location_mismatch:${firstOf('remote')}` };
  return { ok: false, reason: `location_unrecognized:${places[0]}` };
}
