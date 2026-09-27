// 真投 2026-09-27：ElevenLabs Social Growth、Suno 卡在缺信息，拍板人要求「表单小问题不要转给我答」。
// 每道题的答案只来自档案里写死的字段（shared/references/truthfulness.md）；字段没值 → 照挂起，
// 并带上自己的 note，让缺口报告问对问题、写对位置。点评对方账号这类题由 main agent
// 起草（agent_drafts.json），驱动只负责把起草好的原文填上。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, statSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { matchAnswerBucket } from '../shared/answer_buckets.mjs';
import { pickYearsOption, isCompanyCritiqueQuestion } from '../shared/answer_routing.mjs';
import { socialAccountsAnswer } from '../shared/answer_templates.mjs';
import { addDraft, readDrafts, draftFor } from '../shared/agent_drafts.mjs';
import { fillBasisVersion } from '../shared/seen_log.mjs';
import { answerWritePaths } from '../shared/missing_field_questions.mjs';
import { PII_TARGETS } from '../shared/state_file_lock.mjs';
import { loadDriver, BASE } from './ashby_driver_harness.mjs';
import { runGapReport, categoryOf } from './helpers.mjs';

const ROOT = join(import.meta.dirname, '..');
const REAL_GEO = { primary_country: 'US', relocation_policy: 'anywhere_primary_country', willing_to_relocate_for_internship: true, countries_open_to: ['US'] };
const INTENT = { search_intent: { geographic_preference: REAL_GEO } };
const SUNO = 'https://jobs.ashbyhq.com/suno/11111111-1111-1111-1111-111111111111/application';
const ELEVEN = 'https://jobs.ashbyhq.com/elevenlabs/22222222-2222-2222-2222-222222222222/application';

const Q_NYC = 'Are you willing to work 5 days/week from our NYC office?';
const Q_HEAR = 'How did you hear about ElevenLabs?';
const Q_YEARS = 'How many years of social media community management experience do you have?';
const Q_BRANDS = 'Which brand(s) have you done social media community management for?';
const Q_LINKS = 'Share links to the social accounts or platforms you have managed, and tell us your specific role on each.';
const Q_CRITIQUE = 'Look at our social accounts. Pick two from ElevenLabs or ElevenCreative across YouTube, TikTok, and X, and tell us what is working and what is not.';
const Q_MORE = 'What type of content should we be doing more of that we are not doing today? Give an example.';
const Q_OTHERS = 'What other brands or accounts in the AI creative space do social really well? Pick one or two and tell us what is good about what they do.';

const ACCOUNTS = [
  { brand: 'Acme Video', platform: 'TikTok', url: 'https://www.tiktok.com/@acmevideo', role: 'Ran the account day to day: posting, comments and DMs.' },
  { brand: 'My own AI video account', platform: 'X', url: 'https://x.com/example', role: 'Creator and sole operator.' },
];
const withQa = (qa) => ({ ...BASE, standard_qa: { ...(BASE.standard_qa || {}), ...qa } });

function rules(list) {
  globalThis.__MRW_EVAL_RULES = list;
  globalThis.__MRW_CDP = [];
}
const typed = () => globalThis.__MRW_CDP.filter((a) => a[0] === 'typetext').map((a) => a[3]);
function reset() {
  delete globalThis.__MRW_EVAL_RULES;
}

// ------------------------------------------------------------ RTO (NYC) ----

test('RTO：「5 days/week from our NYC office」有答案桶，且是到岗承诺题（交给全美可搬判断）', () => {
  const b = matchAnswerBucket(Q_NYC, { rtoAns: 'Yes', pna: 'x' });
  assert.ok(b, 'no bucket at all — this is why 0b93ac2 never reached it');
  assert.equal(b.relocationCommitment, true);
  assert.equal(b.choice, 'Yes');
});

test('RTO：驱动上全美可搬 + 点名 NYC → 答 Yes；点名伦敦 → 照问', async () => {
  const d = await loadDriver(BASE, { searchIntent: INTENT, applyUrl: SUNO });
  rules([{ match: 'no_container', result: { ok: true, picked: 'Yes', mode: 'btn_widget' } }]);
  try {
    const yes = await d.answerMissing('tab-1', Q_NYC);
    assert.equal(yes.ok, true, JSON.stringify(yes));
    const london = await d.answerMissing('tab-1', 'Are you willing to work 5 days/week from our London office?');
    assert.equal(london.ok, false);
    assert.equal(london.pending_for_main_claude, true);
  } finally {
    reset();
  }
});

// ------------------------------------------------------ How did you hear ----

test('How did you hear：取 profile standard_qa.how_did_you_hear，先试下拉，不再默认填 LinkedIn', async () => {
  const d = await loadDriver(withQa({ how_did_you_hear: 'Company website / job board' }), { applyUrl: ELEVEN });
  const order = [];
  rules([
    { match: 'no_combobox_in_question', result: () => { order.push('combobox'); return { ok: true, sel: '#hear' }; } },
    { match: 'no_option_match', result: (js) => (js.includes('"company website"') ? { ok: true, picked: 'Company website' } : { ok: false, note: 'no_option_match' }) },
    { match: 'label_for', result: () => { order.push('text'); return { ok: true, sel: '#hear_txt', via: 'label_for' }; } },
  ]);
  try {
    const r = await d.answerMissing('tab-1', Q_HEAR);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(order[0], 'combobox', `a dropdown must be tried before typing into a text box: ${order}`);
    assert.ok(!typed().includes('LinkedIn'), `LinkedIn is not a fact from the profile: ${typed()}`);
    assert.deepEqual(typed().slice(0, 2), ['Company website / job board', 'Company website']);
  } finally {
    reset();
  }
});

test('How did you hear：profile 没写 → 挂起 how_did_you_hear_unset，什么都不填', async () => {
  const d = await loadDriver(BASE, { applyUrl: ELEVEN });
  rules([]);
  try {
    const r = await d.answerMissing('tab-1', Q_HEAR);
    assert.equal(r.ok, false);
    assert.equal(r.note, 'how_did_you_hear_unset');
    assert.equal(r.pending_for_main_claude, true);
    assert.deepEqual(typed(), []);
  } finally {
    reset();
  }
});

// ----------------------------------------------------------------- Years ----

test('年限选项：按真实年数挑区间，挑不到就不挑', () => {
  const opts = ['Less than 1 year', '1-2 years', '3-5 years', '5+ years'];
  assert.equal(pickYearsOption(opts, '1'), '1-2 years');
  assert.equal(pickYearsOption(opts, '0.5'), 'Less than 1 year');
  assert.equal(pickYearsOption(opts, '6'), '5+ years');
  assert.equal(pickYearsOption(['0-1', '1-3', '3+'], '2'), '1-3');
  assert.equal(pickYearsOption(['Yes', 'No'], '2'), null);
  assert.equal(pickYearsOption(opts, 'a couple'), null, 'not a number → no guess');
});

test('年限：profile 有 years_social_media_experience → 文本框填这个数；没有 → 挂起 years_experience_unset', async () => {
  const d = await loadDriver(withQa({ years_social_media_experience: '1' }), { applyUrl: SUNO });
  rules([{ match: 'label_for', result: { ok: true, sel: '#years', via: 'label_for' } }]);
  try {
    const r = await d.answerMissing('tab-1', Q_YEARS);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(typed(), ['1']);
  } finally {
    reset();
  }
  const empty = await loadDriver(BASE, { applyUrl: SUNO });
  rules([]);
  try {
    const r = await empty.answerMissing('tab-1', Q_YEARS);
    assert.equal(r.note, 'years_experience_unset');
    assert.equal(r.pending_for_main_claude, true);
    assert.deepEqual(typed(), []);
  } finally {
    reset();
  }
});

test('年限：不是文本框而是单选 → 读选项、按年数挑区间去点', async () => {
  const d = await loadDriver(withQa({ years_social_media_experience: '1' }), { applyUrl: SUNO });
  let clickedWith = null;
  rules([
    { match: 'label_for', result: { ok: false } },
    { match: 'mrw_choice_labels', result: { ok: true, labels: ['Less than 1 year', '1-2 years', '3+ years'] } },
    { match: 'no_preferred_match', result: (js) => { clickedWith = js; return { ok: true, picked: '1-2 years', mode: 'multichoice' }; } },
  ]);
  try {
    const r = await d.answerMissing('tab-1', Q_YEARS);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(clickedWith.includes('"1-2 years"'), 'the radio click must target the picked range');
    assert.ok(!clickedWith.includes('"< 1"'), 'the answer-bank default "< 1" is not his fact');
  } finally {
    reset();
  }
});

// -------------------------------------------------- Brands / links ----

test('做过哪些品牌 / 账号链接与角色：逐字取自 standard_qa.social_accounts_managed', () => {
  assert.equal(socialAccountsAnswer(ACCOUNTS, 'brands'), 'Acme Video; My own AI video account');
  const links = socialAccountsAnswer(ACCOUNTS, 'links');
  for (const a of ACCOUNTS) {
    assert.ok(links.includes(a.url) && links.includes(a.role) && links.includes(a.platform), links);
  }
  assert.equal(socialAccountsAnswer([], 'brands'), '');
  assert.equal(socialAccountsAnswer(undefined, 'links'), '');
});

test('驱动：品牌题 / 链接题按档案原文填；档案没有 → 挂起 social_accounts_managed_unset', async () => {
  const d = await loadDriver(withQa({ social_accounts_managed: ACCOUNTS }), { applyUrl: SUNO });
  rules([{ match: 'label_for', result: { ok: true, sel: '#t', via: 'label_for' } }]);
  try {
    assert.equal((await d.answerMissing('tab-1', Q_BRANDS)).ok, true);
    assert.equal((await d.answerMissing('tab-1', Q_LINKS)).ok, true);
    assert.equal(typed()[0], 'Acme Video; My own AI video account');
    assert.ok(typed()[1].includes('https://www.tiktok.com/@acmevideo'));
  } finally {
    reset();
  }
  const empty = await loadDriver(BASE, { applyUrl: SUNO });
  rules([]);
  try {
    for (const q of [Q_BRANDS, Q_LINKS]) {
      const r = await empty.answerMissing('tab-1', q);
      assert.equal(r.note, 'social_accounts_managed_unset', q);
      assert.equal(r.pending_for_main_claude, true);
    }
    assert.deepEqual(typed(), []);
  } finally {
    reset();
  }
});

// ------------------------------------------ Critique → main agent drafts ----

test('点评对方社媒类题：认得出来；普通事实题不算', () => {
  for (const q of [Q_CRITIQUE, Q_MORE, Q_OTHERS]) assert.equal(isCompanyCritiqueQuestion(q), true, q);
  for (const q of [Q_BRANDS, Q_HEAR, 'Why are you interested in working at Suno?', 'What is your GPA?']) assert.equal(isCompanyCritiqueQuestion(q), false, q);
});

test('点评题：没有起草稿 → 挂起 agent_draft_required；有这岗这题的起草稿 → 原文填上', async () => {
  const d = await loadDriver(BASE, { applyUrl: ELEVEN });
  rules([]);
  try {
    const r = await d.answerMissing('tab-1', Q_CRITIQUE);
    assert.equal(r.note, 'agent_draft_required');
    assert.equal(r.pending_for_main_claude, true);
  } finally {
    reset();
  }
  const draft = 'On TikTok the short product demos with a clear hook work well; the long X threads get little engagement.';
  const home = mkdtempSync(join(tmpdir(), 'mrw-drafts-'));
  addDraft(home, { url: ELEVEN, question: Q_CRITIQUE, answer: draft });
  const withDraft = await loadDriver(BASE, { applyUrl: ELEVEN, agentDrafts: readFileSync(join(home, 'agent_drafts.json'), 'utf8') });
  rules([{ match: 'no_essay_input', result: { ok: true, sel: '#crit', type: 'textarea' } }]);
  try {
    const r = await withDraft.answerMissing('tab-1', Q_CRITIQUE);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(typed(), [draft]);
    const other = await withDraft.answerMissing('tab-1', Q_MORE);
    assert.equal(other.note, 'agent_draft_required', 'a draft answers only its own question');
  } finally {
    reset();
  }
});

test('起草稿文件：按岗位 + 原题存取、600 上锁、空答案拒收、改了会让缺信息的岗重看', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-drafts-'));
  writeFileSync(join(home, 'profile.json'), '{}');
  const before = fillBasisVersion(home);
  assert.throws(() => addDraft(home, { url: ELEVEN, question: Q_CRITIQUE, answer: '  ' }), /answer/);
  addDraft(home, { url: ELEVEN, question: Q_CRITIQUE, answer: 'Draft one.' });
  addDraft(home, { url: ELEVEN.replace('/application', ''), question: `  ${Q_CRITIQUE} `, answer: 'Draft two.' });
  const drafts = readDrafts(home);
  assert.equal(drafts.drafts.length, 1, 'same job + same question = one draft (latest wins)');
  assert.equal(draftFor(drafts, ELEVEN, Q_CRITIQUE), 'Draft two.');
  assert.equal(draftFor(drafts, SUNO, Q_CRITIQUE), null);
  assert.equal(statSync(join(home, 'agent_drafts.json')).mode & 0o777, 0o600);
  assert.notEqual(fillBasisVersion(home), before, 'a new draft must bring the stuck row back next run');
  assert.ok(PII_TARGETS.includes('agent_drafts.json'));
});

test('起草稿 CLI：add 写入、list 列出', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrw-drafts-cli-'));
  const env = { ...process.env, MRWEIRDO_HOME: home };
  const add = spawnSync(process.execPath, ['shared/agent_drafts.mjs', 'add', '--url', ELEVEN, '--question', Q_MORE, '--answer', 'More creator collabs.'], { cwd: ROOT, env, encoding: 'utf8' });
  assert.equal(add.status, 0, add.stderr);
  const list = spawnSync(process.execPath, ['shared/agent_drafts.mjs', 'list'], { cwd: ROOT, env, encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /More creator collabs\./);
  const bad = spawnSync(process.execPath, ['shared/agent_drafts.mjs', 'add', '--url', ELEVEN, '--question', Q_MORE], { cwd: ROOT, env, encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  assert.ok(existsSync(join(home, 'agent_drafts.json')));
});

// -------------------------------------------------------------- Location ----

test('Location 下拉：只用档案城市（不再退到学校名），按「城市 + 州」认选项', async () => {
  const profile = { ...BASE, personal: { ...BASE.personal, address_city: 'Waltham', address_state: 'MA' }, standard_qa: { current_location_for_ats: 'Waltham, Massachusetts, United States' } };
  const d = await loadDriver(profile, { applyUrl: ELEVEN });
  const pickers = [];
  rules([
    { match: 'no_combobox_in_question', result: { ok: true, sel: '#loc' } },
    { match: 'no_option_match', result: (js) => { pickers.push(js); return js.includes('"waltham"') ? { ok: true, picked: 'Waltham, MA, USA' } : { ok: false, note: 'no_option_match' }; } },
  ]);
  try {
    const r = await d.answerMissing('tab-1', 'Location');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(!typed().some((t) => /babson/i.test(t)), `a school is not a location: ${typed()}`);
    assert.ok(pickers.at(-1).includes('"massachusetts"') && pickers.at(-1).includes('"ma"'), 'option must be matched on city + state');
  } finally {
    reset();
  }
});

// --------------------------------------------- write paths + gap report ----

test('新字段经 record_profile_answers 可写（问题模板声明），类型写死', () => {
  const w = answerWritePaths();
  assert.equal(w.get('standard_qa.how_did_you_hear')?.value_type, 'string');
  assert.equal(w.get('standard_qa.years_social_media_experience')?.value_type, 'string');
  assert.equal(w.get('standard_qa.social_accounts_managed')?.value_type, 'array');
});

test('缺口报告：新 note 各归各的问题；档案补上后不再问；点评题归 agent 起草', () => {
  const pending = [
    { question: Q_HEAR, note: 'how_did_you_hear_unset' },
    { question: Q_YEARS, note: 'years_experience_unset' },
    { question: Q_BRANDS, note: 'social_accounts_managed_unset' },
    { question: Q_MORE, note: 'agent_draft_required' },
  ];
  const outcome = [{ outcome: 'needs_user', reason: 'essay_pending', job_id: 901, pending, still_missing: pending.map((p) => p.question) }];
  const { report } = runGapReport('mrw-autofill-gap-', BASE, outcome);
  assert.equal(categoryOf(report, Q_HEAR), 'user_how_did_you_hear');
  assert.equal(categoryOf(report, Q_YEARS), 'user_years_experience');
  assert.equal(categoryOf(report, Q_BRANDS), 'user_social_accounts_managed');
  assert.equal(categoryOf(report, Q_MORE), 'agent_open_text');
  const answered = runGapReport('mrw-autofill-gap2-', withQa({ how_did_you_hear: 'Company website', years_social_media_experience: '1', social_accounts_managed: ACCOUNTS }), outcome).report;
  for (const q of [Q_HEAR, Q_YEARS, Q_BRANDS]) assert.equal(categoryOf(answered, q), 'agent_profile_backed', q);
});
