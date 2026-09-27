// 首次真投（2026-09-26）投出 0 的三处，逐一在真驱动上复现（ashby_driver_harness 载入的是出货源码）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRunDb } from '../shared/local_db.mjs';
import { DatabaseSync } from 'node:sqlite';
import { loadDriver, BASE } from './ashby_driver_harness.mjs';

// 真实拷贝 search_intent 的 geographic_preference（全美可搬）。
const REAL_GEO = { primary_country: 'US', preferred_metros: ['Anywhere US', 'Bay Area', 'San Francisco', 'New York', 'Remote-US'], remote_acceptable: true, countries_open_to: ['US'], relocation_policy: 'anywhere_primary_country', willing_to_relocate_for_internship: true, excluded_locations: ['Singapore'] };
const RTO = 'Do the office location and RTO requirements work for you?';
const OPUS = 'https://jobs.ashbyhq.com/opusclip/501d374d-7d4f-4889-bc53-0a1fd16253ea/application';

function workDbWith(location) {
  const dir = mkdtempSync(join(tmpdir(), 'mrw-ashby-db-'));
  const path = join(dir, 'work.db');
  initRunDb({ path, seqFloor: 100000 });
  const db = new DatabaseSync(path);
  const id = Number(db.prepare(`INSERT INTO jobs(company, title, apply_url, location, status, ats_platform) VALUES ('opusclip', 'AI Artist', ?, ?, '🤖 AI sourced', 'ashby')`).run(OPUS, location).lastInsertRowid);
  db.close();
  return { path, id };
}

async function askRto(location) {
  const { path, id } = workDbWith(location);
  const clicks = [];
  const d = await loadDriver(BASE, { searchIntent: { search_intent: { geographic_preference: REAL_GEO } }, dbPath: path, jobId: id, applyUrl: OPUS });
  globalThis.__MRW_EVAL_RULES = [{ match: RTO.toLowerCase().slice(0, 30), result: (js) => { clicks.push(js); return { ok: true, picked: 'Yes' }; } }];
  try {
    return await d.answerMissing('tab-1', RTO);
  } finally {
    globalThis.__MRW_EVAL_RULES = [];
  }
}

test('① 全美可搬 + 岗位在 Mountain View：RTO 题不再 relocation_commitment_policy_unset，答 Yes', async () => {
  const res = await askRto('Mountain View');
  assert.notEqual(res?.note, 'relocation_commitment_policy_unset', JSON.stringify(res));
  assert.equal(res.ok, true, JSON.stringify(res));
});

test('① 岗位在国外（London）：仍然照问，不替用户承诺', async () => {
  const res = await askRto('London');
  assert.equal(res.note, 'relocation_commitment_policy_unset');
});

// ② OpusClip 开放题：「用 AI 做过 / 试过什么」。
const AI_Q = 'Tell us about something you’ve built, tested, or experimented with using AI. What were you trying to achieve or learn, and what did you discover?';
const STORY = {
  problem: 'Wanted to learn which AI video models hold up for short-form content.',
  what_user_did: 'Ran 27+ controlled AI video experiments with pass/fail criteria, comparing models side by side (Seedance, Wan, Veo); distilled reusable prompt packs and shotlists.',
  result_or_learning: 'A 3M-view hit converted only ~100 followers; pivoted to vertical AI-video breakdowns and grew from 200 to 1,000+ followers in 3 days.',
  use_for: ['ai_experiment'],
};

test('② 驱动：essay_profile 有 AI 实验故事 → 按故事逐字起草；没有任何 AI 故事 → 不起草（照旧挂起）', async () => {
  const withStory = await loadDriver(BASE, { essayProfile: { project_stories: [STORY] } });
  const out = withStory.essayAnswerFor(AI_Q);
  assert.ok(out && out.includes(STORY.what_user_did) && out.includes(STORY.result_or_learning), out);
  const without = await loadDriver(BASE, { essayProfile: { project_stories: [{ problem: 'p', what_user_did: 'Recruited mentors.', result_or_learning: 'l', skills: ['community building'] }] } });
  assert.ok(!without.essayAnswerFor(AI_Q), 'no AI story → no answer, never an invented one');
});
