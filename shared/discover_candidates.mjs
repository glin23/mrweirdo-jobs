#!/usr/bin/env node
import './safe_exit.mjs'; // first: no exit-time SIGSEGV with system CAs on (preload_system_ca.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { discoverAll, DEFAULT_SOURCES } from './sourcing/dispatcher.mjs';
import { discoveryApplyBucket, isAutoSupportedCandidate } from './sourcing/apply_url_classification.mjs';
import { hasUsableApplyUrl } from './sourcing/usable_apply_url.mjs';
import { roleTypeBlockReason, roleTypesFromSearchIntent, roleTypeConflict } from './role_types.mjs';
import { locationVerdict } from './location_gate.mjs';
import { excludeKeywordMatch, functionExcludeKeywords } from './title_excludes.mjs';
import { functionMismatchReason } from './function_prefilter.mjs';
import { atsHome } from './paths.mjs';
import { unusableAutoApplyReason } from './eligibility.mjs';
import { progress } from './progress.mjs';
import { onboardTmpDir } from './onboard_tmp.mjs';

const HOME = atsHome();
const TMP_DIR = onboardTmpDir();
const ALWAYS_EXCLUDE_ROLE_KEYWORDS = [
  'BCBA',
  'cashier',
  'barista',
  'server',
  'waiter',
  'waitress',
  'bartender',
  'line cook',
  'cook',
  'driver',
  'delivery driver',
  'warehouse associate',
  'picker',
  'packer',
];
const CONTEXTUAL_EXCLUDE_ROLE_GROUPS = [
  {
    name: 'licensed_clinical',
    allowWhen: [
      /\bnursing\b/i,
      /\bpre[-\s]?med\b/i,
      /\bmedicine\b/i,
      /\bmedical school\b/i,
      /\bclinical\b/i,
      /\btherapy\b/i,
      /\btherapist\b/i,
      /\bphysical therapy\b/i,
      /\boccupational therapy\b/i,
      /\bpharmacy\b/i,
      /\bveterinary\b/i,
      /\bdental\b/i,
    ],
    keywords: [
      'CNA',
      'LPN',
      'RN',
      'medical assistant',
      'dental assistant',
      'occupational therapist',
      'physical therapist',
      'speech therapist',
      'therapist',
      'clinician',
      'clinical supervisor',
      'registered nurse',
      'nurse',
      'pharmacist',
      'physician',
      'veterinarian',
      'sonographer',
      'radiologic technologist',
    ],
  },
  {
    name: 'education_care',
    allowWhen: [
      /\beducation\b/i,
      /\bteaching\b/i,
      /\bteacher\b/i,
      /\btutor\b/i,
      /\bpedagogy\b/i,
      /\bchildhood\b/i,
    ],
    keywords: [
      'teacher',
      'assistant teacher',
      'substitute teacher',
      'tutor',
      'coach',
      'after school',
      'childcare',
      'caregiver',
      'counselor',
      'social worker',
      'LCSW',
      'LPCC',
      'residential rehabilitation',
      'rehabilitation educator',
    ],
  },
  {
    name: 'retail_service',
    allowWhen: [
      /\bretail\b/i,
      /\bhospitality\b/i,
      /\brestaurant\b/i,
      /\bfashion merchandising\b/i,
      /\bstore operations\b/i,
      /\bfood service\b/i,
    ],
    keywords: [
      'retail sales',
      'retail associate',
      'store associate',
      'sales associate',
      'front desk',
      'receptionist',
      'stylist',
      'merchandiser',
      'brand ambassador',
    ],
  },
  {
    name: 'security_legal',
    allowWhen: [
      /\bcriminal justice\b/i,
      /\blaw\b/i,
      /\blegal\b/i,
      /\bparalegal\b/i,
      /\bsecurity\b/i,
    ],
    keywords: [
      'security guard',
      'security officer',
      'police',
      'attorney',
      'paralegal',
    ],
  },
];

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function parseNonNegativeInt(value, fallback = null) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function collectStrings(value, out = []) {
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
  return out;
}

function intentText(intentDoc = {}) {
  return collectStrings(intentDoc).join(' ').toLowerCase();
}

function profileAllows(intentDoc, patterns) {
  const text = intentText(intentDoc);
  return patterns.some((pattern) => pattern.test(text));
}

function cleanRoleCategoryKeyword(value) {
  return String(value || '')
    .replace(/\b(internship|intern|co-?op|part[\s-]?time|working student|student assistant|new\s?grad|new\s?graduate|early career|associate)\b/ig, ' ')
    .replace(/[()[\]{}*+?|^$\\.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function roleCategoryBases(intentDoc = {}) {
  const searchIntent = intentDoc.search_intent || intentDoc || {};
  const categories = Array.isArray(searchIntent.role_categories) ? searchIntent.role_categories : [];
  const bases = [];
  for (const category of categories) {
    const base = cleanRoleCategoryKeyword(category?.title_pattern);
    if (base && base.length >= 3) bases.push(base);
  }
  return [...new Set(bases)].slice(0, 10);
}

function derivedKeywords(roleTypes, intentDoc = {}) {
  const internKws = ['Intern', 'Internship', 'Co-op', 'Coop', 'Summer'];
  const bases = roleCategoryBases(intentDoc);
  const profilePartTimeKws = bases.flatMap((base) => [
    `${base} Part-time`,
    `Part-time ${base}`,
    `${base} Contractor`,
    `${base} Assistant`,
  ]);
  const partTimeKws = [
    'Working Student',
    'Student Assistant',
    ...profilePartTimeKws,
    ...((bases.length === 0 || process.env.MRWEIRDO_BROAD_PART_TIME === '1')
      ? ['Part-time', 'Part time']
      : []),
  ];
  const fullTimeKws = ['New Grad', 'New Graduate', 'Early Career', 'Associate', 'Graduate'];
  return [
    ...(roleTypes.includes('intern') ? internKws : []),
    ...(roleTypes.includes('part_time') ? partTimeKws : []),
    ...(roleTypes.includes('new_grad_FT') ? fullTimeKws : []),
  ];
}

function excludeKeywordsForIntent(intent = {}, intentDoc = {}) {
  const keywords = [
    ...ALWAYS_EXCLUDE_ROLE_KEYWORDS,
    ...(intent.exclude_role_keywords || []),
    ...functionExcludeKeywords(intentDoc),
  ];
  for (const group of CONTEXTUAL_EXCLUDE_ROLE_GROUPS) {
    if (!profileAllows(intentDoc, group.allowWhen)) keywords.push(...group.keywords);
  }
  return [...new Set(keywords.map((s) => String(s).toLowerCase()).filter(Boolean))];
}

function passesExclude(title, excludes) {
  return !excludeKeywordMatch(title, excludes);
}

function filterWithReasons(jobs, intent, roleTypes, intentDoc = {}) {
  const excludes = excludeKeywordsForIntent(intent, intentDoc);
  const kept = [];
  const dropped = [];

  for (const job of jobs) {
    let reason = null;
    if (!hasUsableApplyUrl(job)) {
      reason = 'unusable_apply_url';
    } else {
      const unusableReason = unusableAutoApplyReason(job);
      const excludedKeyword = excludeKeywordMatch(job.title, excludes);
      // Direction before location / role type: a job of another profession is
      // not worth scoring wherever it is (restart-apply-3 方向预筛).
      const offDirection = functionMismatchReason(job.title, intentDoc);
      if (unusableReason) reason = unusableReason;
      else if (excludedKeyword) reason = `excluded_title_keyword:${excludedKeyword}`;
      else if (offDirection) reason = offDirection;
      else {
        // Reasons carry their detail after ':' (location_mismatch:London,
        // requires_3plus_years:5); by_reason_kind in the funnel groups them.
        const where = locationVerdict(job, intent);
        reason = where.ok ? roleTypeBlockReason(job, roleTypes) : where.reason;
      }
    }

    if (reason) {
      dropped.push({
        reason,
        company: job.company || '(unknown)',
        title: job.title || '(untitled)',
        apply_url: job.apply_url || job.url || '',
        source: job._discovery_source || job.search_source || job.source || 'unknown',
      });
    } else {
      kept.push(job);
    }
  }

  return { kept, dropped, excludes };
}

function hardFilter(jobs, intent, roleTypes, intentDoc = {}) {
  return filterWithReasons(jobs, intent, roleTypes, intentDoc).kept;
}

// Annotate (but never drop) intern-titled candidates whose structured
// employment_type looks permanent. The row stays eligible — we only attach a
// free-text bot_note + a flag so a human can glance before submit. This is the
// only stage where employment_type is available; DB rows don't carry it.
const ROLE_CONFLICT_NOTE_PREFIX = 'role-type conflict:';
function annotateRoleTypeConflicts(jobs) {
  let conflictCount = 0;
  for (const job of jobs) {
    const { conflict, reason } = roleTypeConflict(job);
    if (!conflict) continue;
    conflictCount += 1;
    job.role_type_conflict = true;
    const note = `${ROLE_CONFLICT_NOTE_PREFIX} ${reason}`;
    job.bot_note = job.bot_note ? `${job.bot_note}\n${note}` : note;
  }
  return conflictCount;
}

function countBy(items, getKey) {
  const counts = {};
  for (const item of items || []) {
    const key = String(getKey(item) || 'unknown');
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

const intentDoc = readJson(path.join(HOME, 'search_intent.json'), { search_intent: { seniority: 'intern' } });
const intent = intentDoc.search_intent || {};
const roleTypes = roleTypesFromSearchIntent(intent);
const keywords = derivedKeywords(roleTypes, intentDoc);
const sources = (argValue('--sources') || DEFAULT_SOURCES.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
const outputDir = argValue('--output-dir', TMP_DIR);
const limitPerSource = Math.max(1, Number(argValue('--limit-per-source', '500')));
const concurrency = Math.max(1, Number(argValue('--concurrency', '10')));
const capToScore = Math.max(1, Number(argValue('--cap-to-score', '300')));
const runId = argValue('--run-id', process.env.RUN_ID || `discovery-${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)}Z`);
const sourceCursorFile = path.join(HOME, 'source_cursor.json');
const sourceWindowSizeRaw = argValue('--source-window-size', process.env.MRWEIRDO_SOURCE_WINDOW_SIZE || '1000');
const sourceWindowSize = parseNonNegativeInt(sourceWindowSizeRaw, 1000);
const explicitSourceWindowOffset = argValue('--source-window-offset', process.env.MRWEIRDO_SOURCE_WINDOW_OFFSET || null);
const sourceCursor = readJson(sourceCursorFile, {});
const sourceWindowEnabled = sourceWindowSize > 0;
const sourceWindowOffset = sourceWindowEnabled
  ? parseNonNegativeInt(explicitSourceWindowOffset ?? sourceCursor.next_offset ?? 0, 0)
  : null;
const sourceWindowOffsetSource = !sourceWindowEnabled
  ? 'disabled'
  : explicitSourceWindowOffset != null
    ? 'explicit'
    : 'local_cursor';

const plan = {
  run_id: runId,
  role_type_targets: roleTypes,
  keywords,
  sources,
  limit_per_source: limitPerSource,
  concurrency_per_source: concurrency,
  source_window: {
    enabled: sourceWindowEnabled,
    size: sourceWindowEnabled ? sourceWindowSize : null,
    offset: sourceWindowOffset,
    offset_source: sourceWindowOffsetSource,
    cursor_file: sourceCursorFile,
    advances_cursor_on_run: sourceWindowEnabled && explicitSourceWindowOffset == null,
  },
  output_dir: outputDir,
  output_files: {
    discovered: path.join(outputDir, 'discovered.json'),
    filtered: path.join(outputDir, 'filtered.json'),
    to_score: path.join(outputDir, 'to_score.json'),
    manual_or_unsupported: path.join(outputDir, 'manual_or_unsupported.json'),
    discovery_funnel: path.join(outputDir, 'discovery_funnel.json'),
  },
};

if (hasArg('--help') || hasArg('-h')) {
  console.log(`Usage:
  node shared/discover_candidates.mjs --plan
  node shared/discover_candidates.mjs --run --sources greenhouse_bulk,ashby_bulk --limit-per-source 500
  node shared/discover_candidates.mjs --run --source-window-size 1000
  node shared/discover_candidates.mjs --run --source-window-size 0 # full source lists
  node shared/discover_candidates.mjs --run --run-id "$RUN_ID"

Defaults read ~/.mrweirdo-jobs/search_intent.json and preserve the selected role boundary.
Bulk sources use a local rotating source window by default so each run crawls a new slice.`);
  process.exit(0);
}

if (!hasArg('--run')) {
  console.log(JSON.stringify({ ok: true, mode: 'plan', ...plan }, null, 2));
  process.exit(0);
}

fs.mkdirSync(outputDir, { recursive: true });
progress('discovery', `sources=${sources.length} keywords=${keywords.length} run_id=${runId}`);
const result = await discoverAll({
  keywords,
  intent,
  sources,
  concurrency_per_source: concurrency,
  limit_per_source: limitPerSource,
  source_window_size: sourceWindowEnabled ? sourceWindowSize : null,
  source_window_offset: sourceWindowEnabled ? sourceWindowOffset : 0,
  onProgress: (src, count) => progress('discovery', `${src}: ${count} jobs`),
});

const discovered = result.jobs.map((job) => ({ ...job, discovery_run_id: runId }));
const hardFilterResult = filterWithReasons(discovered, intent, roleTypes, intentDoc);
const filtered = hardFilterResult.kept;
const unusableApplyUrlDropped = hardFilterResult.dropped.filter((row) => row.reason === 'unusable_apply_url').length;
const roleTypeConflicts = annotateRoleTypeConflicts(filtered);
if (roleTypeConflicts > 0) {
  progress('discovery', `role_type_conflicts=${roleTypeConflicts} flagged_for_review`);
}
const manualOrUnsupported = filtered
  .filter((job) => !isAutoSupportedCandidate(job))
  .map((job) => ({ ...job, discovery_apply_bucket: discoveryApplyBucket(job) }));
const autoSupported = filtered
  .filter((job) => isAutoSupportedCandidate(job))
  .map((job) => ({ ...job, discovery_apply_bucket: 'auto_supported' }));
let toScore = autoSupported.slice();
if (toScore.length > capToScore) {
  toScore.sort((a, b) => (b.description?.length || 0) - (a.description?.length || 0));
  toScore = toScore.slice(0, capToScore);
}
const scoreCapDropped = Math.max(0, autoSupported.length - toScore.length);
const discoveryFunnel = {
  run_id: runId,
  role_type_targets: roleTypes,
  keywords,
  counts: {
    discovered: discovered.length,
    hard_filter_kept: filtered.length,
    hard_filter_dropped: hardFilterResult.dropped.length,
    auto_supported: autoSupported.length,
    to_score: toScore.length,
    score_cap_dropped: scoreCapDropped,
    manual_or_unsupported: manualOrUnsupported.length,
    unusable_apply_url_dropped: unusableApplyUrlDropped,
    role_type_conflicts: roleTypeConflicts,
  },
  hard_filter_dropped_by_reason: countBy(hardFilterResult.dropped, (row) => row.reason),
  hard_filter_dropped_by_reason_kind: countBy(hardFilterResult.dropped, (row) => String(row.reason).split(':')[0]),
  hard_filter_drop_examples: hardFilterResult.dropped.slice(0, 10),
  manual_or_unsupported_by_bucket: countBy(manualOrUnsupported, (job) => job.discovery_apply_bucket),
  to_score_by_source: countBy(toScore, (job) => job._discovery_source || job.search_source || job.source),
  to_score_by_role_type: countBy(toScore, (job) => job.role_type),
  discovered_by_source: countBy(discovered, (job) => job._discovery_source || job.search_source || job.source),
  raw_by_source: result.by_source,
  errors: result.errors,
  output_files: plan.output_files,
};

fs.writeFileSync(plan.output_files.discovered, JSON.stringify(discovered, null, 2));
fs.writeFileSync(plan.output_files.filtered, JSON.stringify(filtered, null, 2));
fs.writeFileSync(plan.output_files.to_score, JSON.stringify(toScore, null, 2));
fs.writeFileSync(plan.output_files.manual_or_unsupported, JSON.stringify(manualOrUnsupported, null, 2));
fs.writeFileSync(plan.output_files.discovery_funnel, JSON.stringify(discoveryFunnel, null, 2));
progress('discovery', `funnel discovered=${discovered.length} kept=${filtered.length} to_score=${toScore.length} manual=${manualOrUnsupported.length} dropped=${hardFilterResult.dropped.length}`);

let nextSourceWindowOffset = null;
if (sourceWindowEnabled && explicitSourceWindowOffset == null) {
  nextSourceWindowOffset = sourceWindowOffset + sourceWindowSize;
  writeJson(sourceCursorFile, {
    next_offset: nextSourceWindowOffset,
    last_offset: sourceWindowOffset,
    window_size: sourceWindowSize,
    last_run_id: runId,
    updated_at: new Date().toISOString(),
  });
}

console.log(JSON.stringify({
  ok: true,
  mode: 'run',
  ...plan,
  discovered: discovered.length,
  filtered: filtered.length,
  to_score: toScore.length,
  manual_or_unsupported: manualOrUnsupported.length,
  unusable_apply_url_dropped: unusableApplyUrlDropped,
  role_type_conflicts: roleTypeConflicts,
  score_cap_dropped: scoreCapDropped,
  discovery_funnel: plan.output_files.discovery_funnel,
  hard_filter_dropped_by_reason: discoveryFunnel.hard_filter_dropped_by_reason,
  manual_or_unsupported_by_bucket: discoveryFunnel.manual_or_unsupported_by_bucket,
  to_score_by_source: discoveryFunnel.to_score_by_source,
  by_source: result.by_source,
  errors: result.errors,
  source_window_cursor_next_offset: nextSourceWindowOffset,
}, null, 2));
