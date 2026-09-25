// Offline stand-in for the public Ashby / Greenhouse board APIs. Imported by a
// test (fakeFetch) or preloaded into a child with `node --import <this file>`,
// in which case it replaces globalThis.fetch for the whole process.
const ashbyBoards = {
  pika: [
    { id: 'p1', title: 'Growth Intern', employmentType: 'Internship', location: 'Remote', descriptionPlain: 'Grow Pika.',
      jobUrl: 'https://jobs.ashbyhq.com/pika/00000000-0000-0000-0000-000000000001', applyUrl: 'https://jobs.ashbyhq.com/pika/00000000-0000-0000-0000-000000000001' },
    { id: 'p2', title: 'Senior ML Engineer', employmentType: 'FullTime', location: 'Remote', descriptionPlain: 'Train models.',
      jobUrl: 'https://jobs.ashbyhq.com/pika/00000000-0000-0000-0000-000000000002', applyUrl: 'https://jobs.ashbyhq.com/pika/00000000-0000-0000-0000-000000000002' },
  ],
};
const ghBoards = {
  heygen: [{ id: 5, title: 'Marketing Intern', absolute_url: 'https://job-boards.greenhouse.io/heygen/jobs/5', location: { name: 'Remote' }, content: '&lt;p&gt;Market HeyGen.&lt;/p&gt;' }],
};

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function fakeFetch(input) {
  const url = new URL(String(input));
  if (url.hostname === 'api.ashbyhq.com') {
    const slug = decodeURIComponent(url.pathname.split('/').pop());
    if (slug === 'brokenco') return json(500, { error: 'boom' });
    return ashbyBoards[slug] ? json(200, { jobs: ashbyBoards[slug] }) : json(404, {});
  }
  if (url.hostname === 'boards-api.greenhouse.io') {
    const slug = url.pathname.split('/')[3];
    return ghBoards[slug] ? json(200, { jobs: ghBoards[slug] }) : json(404, {});
  }
  throw new Error(`fake fetch: unexpected network call to ${url.href}`);
}

if (process.execArgv.some((a) => a.includes('watchlist_fake_fetch'))) globalThis.fetch = fakeFetch;
