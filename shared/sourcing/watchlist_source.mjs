// watchlist_source.mjs — 名单优先找岗（restart-apply DESIGN S4 / ARCH_AUDIT ADR-R3）.
//
// search_intent.target_companies = [{ ats, slug, label }] are scanned on EVERY
// run, before the rotating bulk window. Each board is fetched with the existing
// public-API clients; nothing new talks to the network.
//
// company = the board slug, never the label (ADR-S2): the bulk crawls name
// companies by slug too, and the ledger's 60-day per-company count keys on
// normalizeCompany(company) — "Pika" from here and "pika" from the rotation
// must be the same company, or the 60-day rule is bypassed (VERIFY 第 2 轮 P3).
//
// One board failing is reported through reportError and never takes the others
// down; the run report lists the companies that could not be scanned.

import { fetchJobs as fetchAshby } from './ashby_board_api.mjs';
import { fetchJobs as fetchGreenhouse } from './greenhouse_board_api.mjs';

export const WATCHLIST_ATS = Object.freeze(['ashby', 'greenhouse', 'lever']);
const PAUSED_ATS = new Set(['lever']); // Lever 暂停中（拍板 D6，Lever 继续暂停）

const DEFAULT_FETCHERS = {
  ashby: (slug) => fetchAshby(slug),
  greenhouse: (slug) => fetchGreenhouse(slug),
};

export async function fetchWatchlist(targets, { fetchers = DEFAULT_FETCHERS, reportError }) {
  if (typeof reportError !== 'function') throw new Error('fetchWatchlist: reportError is required — a failed board must be heard');
  const list = targets ?? [];
  for (const t of list) {
    if (!t?.slug) throw new Error(`target_companies entry without slug: ${JSON.stringify(t)}`);
    if (!WATCHLIST_ATS.includes(t.ats)) throw new Error(`target_companies ${t.slug}: ats "${t.ats}" not in ${WATCHLIST_ATS.join('|')}`);
  }
  const jobs = [];
  for (const t of list) {
    const report = (error) => reportError({ slug: t.slug, ats: t.ats, label: t.label ?? null, error });
    if (PAUSED_ATS.has(t.ats)) {
      report(`${t.ats}_paused`);
      continue;
    }
    try {
      for (const j of await fetchers[t.ats](t.slug)) jobs.push({ ...j, company: t.slug });
    } catch (err) {
      report(err?.message || String(err));
    }
  }
  return jobs;
}
