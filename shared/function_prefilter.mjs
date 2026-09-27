// function_prefilter.mjs — 方向预筛（restart-apply-3，拍板人 2026-09-27「行，先改」）.
//
// The rotation pool let 208 jobs through the hard filter and 24 of the 49 that
// were paid for were plainly another profession (support, design, finance,
// legal, recruiting, sales AE …). This drops those at the hard filter, before
// scoring, with reason `function_mismatch:<family>`.
//
// It only ever blocks a title that names a SPECIALIST function the user does
// not want. Everything else — marketing / growth / content / community / GTM /
// product / operations / founder's associate, and any title it cannot place —
// passes to the scorer, which judges direction properly. So:
//   · no target functions in search_intent → boundary unknown → never blocks;
//   · a specialist family the user wants (any wanted term names it) → never blocked;
//   · "domain" families (finance, sales AE, support, data, admin) are let through
//     when the title also names one of the user's own domains ("Private Equity
//     Partnerships Associate", "Marketing Analytics"); "role noun" families
//     (engineer, designer, researcher, counsel, recruiter, IT) are not — a
//     "Brand & Product Designer" is a designer whatever the adjective.

const SPECIALIST = [
  // [family, title pattern, pattern that means the user wants it, rescuable by the user's own domain words]
  ['engineering', /\b(engineer|engineering|developer|swe|devops|sre|full[-\s]?stack|embedded|firmware|robotics|naval architect|software (intern|internship|engineer|developer))\b|\(software\)/i, /\b(engineer|engineering|software|swe|developer|devops|robotics)\b/i, false],
  ['design', /\b(designer|design (manager|lead|intern|director)|(brand|graphic|visual|product|motion) design|ux|ui)\b/i, /\bdesign/i, false],
  ['research', /\b(researcher|(?<!data\s)scientist|scientific|quantum|optical|(?<!market\s)(?<!marketing\s)research)\b/i, /\b(research|ml|machine learning|scien)/i, false],
  ['legal', /\b(counsel|attorney|lawyer|paralegal|legal|compliance)\b/i, /\b(legal|law|compliance)\b/i, false],
  ['it_support', /\b(it (support|specialist|administrator|technician)|information technology|enterprise technology|help ?desk|desktop support|system administrator|salesforce administrator)\b/i, /\b(it support|help ?desk|system administration|information technology)\b/i, false],
  ['recruiting_hr', /\b(recruiter|recruiting|recruitment|talent (acquisition|associate|partner|coordinator)|sourcer|people operations|people partner|hr|human resources)\b/i, /\b(recruit|talent|hr|human resources|people)/i, true],
  ['admin', /\b(executive assistant|administrative|office (manager|coordinator|assistant)|receptionist|workplace (experience|coordinator|operations)|facilities)\b/i, /\b(admin|executive assistant|office)/i, true],
  ['customer_support', /\b((customer|client|provider|member|consumer|user) (success|support|experience|service|care)|support (specialist|associate|agent|representative))\b/i, /\b(customer|client) (success|support|experience|service)|\bsupport\b/i, true],
  ['finance', /\b(finance|financial|accounting|accountant|accounts (payable|receivable)|fp&a|controller|tax|audit|auditor|treasury|payroll|credit|risk analyst|investment|investor relations|quant|quantitative|private equity|trader|underwriting|claims|revenue cycle|billing)\b/i, /\b(financ|accounting|fp&a|invest|quant|tax|audit)/i, true],
  ['sales_ae', /\b(account executive|account manager|sales executive|sales representative|inside sales|enterprise sales|sales manager|sales director)\b/i, /\b(sales|account executive|account management)\b/i, true],
  ['data', /\b(data (scientist|science|analyst|analytics|engineer)|analytics|business intelligence|bi analyst)\b/i, /\b(data|analytics|business intelligence)\b/i, true],
  ['clinical', /\b(clinical|mental health|medical (scribe|assistant)|nurse|nursing|therapist|pharmacy|pharmacist|patient care)\b/i, /\b(clinical|nurs|health|medic|therap|pharma)/i, true],
  ['logistics_trades', /\b(supply chain|fulfillment|warehouse|logistics|ehs|fsqa|hvac|plumbing|flight test|hardware test|test associate)\b/i, /\b(supply chain|logistics|operations management|trades?)\b/i, true],
];

// The user's own domains — only used to rescue a "domain" family title.
const DOMAINS = [
  /\b(marketing|marketer|growth|brand|seo|sem|aeo|affiliate|influencer|creator|content|social|community|copywriter|communications|editor|editorial|market research)\b/i,
  /\b(gtm|go[-\s]?to[-\s]?market|business development|bdr|partnerships?|partner)\b/i,
  /\b(product (manager|management|marketing|lead|owner|operations|ops|strategy)|apm)\b/i,
];
// Generalist startup roles rescue a "domain" family title for everyone
// ("Strategic Finance and Business Operations Associate").
const GENERALIST = /\b(business operations|bizops|biz ops|strategy (&|and) operations|chief of staff|founders?'?s? associate)\b/i;

const list = (v) => (Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean) : []);

function wantedTerms(intentDoc = {}) {
  const si = intentDoc.search_intent || intentDoc || {};
  const a = si.target_function_anchor || {};
  const categories = Array.isArray(si.role_categories) ? si.role_categories.map((c) => c?.title_pattern) : [];
  return [...list(a.self_reported_target_functions), ...list(a.resume_supported_functions), ...list(a.adjacent_functions),
    ...list(si.function_area), ...list(categories)];
}

// `function_mismatch:<family>` when the title is plainly a specialist function
// the user does not want; null otherwise (including "cannot tell").
export function functionMismatchReason(title, intentDoc = {}) {
  const t = String(title || '');
  const wanted = wantedTerms(intentDoc);
  if (!t || wanted.length === 0) return null;
  const hits = SPECIALIST.filter(([, re]) => re.test(t));
  if (hits.length === 0) return null;
  const wantedFamily = (w) => wanted.some((term) => w.test(term));
  if (hits.some(([, , w]) => wantedFamily(w))) return null;
  const ownDomain = GENERALIST.test(t) || DOMAINS.filter((d) => wanted.some((term) => d.test(term))).some((d) => d.test(t));
  const blocking = hits.find(([, , , rescuable]) => !(rescuable && ownDomain));
  return blocking ? `function_mismatch:${blocking[0]}` : null;
}
