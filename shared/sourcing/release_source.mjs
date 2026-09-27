// release_source.mjs — 放行任意链接（restart-apply-3，拍板人 2026-09-27「这两个先投」）.
//
// `stream_run start --release <link>` names a job the user wants applied to.
// A list company's job is met by the list scan; any other Greenhouse / Ashby
// link is fetched here, straight from the same public board APIs the list
// scan uses, and picked out by its job id (the fingerprint of the link). What
// comes back goes through the same hard filter, dedupe gate, scoring,
// pre-dispatch guard and recorder as every other job.
//
// company = the board slug (ADR-S2), exactly like the list and bulk scans, so
// the ledger's 60-day per-company count cannot be sidestepped by a release.
// A link whose job is not on its board is simply not returned — the run
// reports it as not found. A link we cannot fetch at all is reported through
// reportError with the link, never dropped silently.

import { fetchJobs as fetchAshby } from './ashby_board_api.mjs';
import { fetchJobs as fetchGreenhouse } from './greenhouse_board_api.mjs';
import { boardSlug, jobFingerprint } from '../job_identity.mjs';

const DEFAULT_FETCHERS = {
  ashby: (slug) => fetchAshby(slug, { notFound: 'throw' }),
  greenhouse: (slug) => fetchGreenhouse(slug, { notFound: 'throw' }),
};

export async function fetchReleased(urls, { fetchers = DEFAULT_FETCHERS, reportError } = {}) {
  if (typeof reportError !== 'function') throw new Error('fetchReleased: reportError is required — a link that cannot be fetched must be heard');
  const wanted = new Map(); // board key → Set of fingerprints
  for (const url of urls ?? []) {
    const fp = jobFingerprint(url);
    if (!fp) throw new Error(`fetchReleased: ${url} is not a Greenhouse/Ashby/Lever job link`);
    if (fp.ats === 'lever') {
      reportError({ apply_url: url, error: 'lever_paused' });
      continue;
    }
    const slug = boardSlug(url);
    if (!slug) {
      reportError({ apply_url: url, error: 'no_board_in_link' });
      continue;
    }
    const key = `${fp.ats}:${slug}`;
    if (!wanted.has(key)) wanted.set(key, { ats: fp.ats, slug, fps: new Map() });
    if (!wanted.get(key).fps.has(fp.fp)) wanted.get(key).fps.set(fp.fp, url);
  }
  const jobs = [];
  for (const { ats, slug, fps } of wanted.values()) {
    let board;
    try {
      board = await fetchers[ats](slug);
    } catch (err) {
      for (const url of fps.values()) reportError({ apply_url: url, slug, ats, error: err?.message || String(err) });
      continue;
    }
    for (const j of board) {
      const fp = jobFingerprint(j.apply_url || j.url);
      if (fp && fps.has(fp.fp)) jobs.push({ ...j, company: slug });
    }
  }
  return jobs;
}
