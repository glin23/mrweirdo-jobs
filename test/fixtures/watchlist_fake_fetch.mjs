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
  // release 任意链接（restart-apply-3）：拍板人点名要投的两条，不在名单公司里。
  'prior-labs': [
    { id: '1e0d43ae-26b1-4b59-a28f-cb1f35a8b576', title: 'Founder Associate (NYC)', employmentType: 'FullTime', location: 'New York', descriptionPlain: 'Work with the founders. 1-3 years of experience.',
      jobUrl: 'https://jobs.ashbyhq.com/prior-labs/1e0d43ae-26b1-4b59-a28f-cb1f35a8b576', applyUrl: 'https://jobs.ashbyhq.com/prior-labs/1e0d43ae-26b1-4b59-a28f-cb1f35a8b576/application' },
    { id: 'x2', title: 'Account Executive', employmentType: 'FullTime', location: 'New York', descriptionPlain: 'Sell.',
      jobUrl: 'https://jobs.ashbyhq.com/prior-labs/00000000-0000-0000-0000-0000000000a2', applyUrl: 'https://jobs.ashbyhq.com/prior-labs/00000000-0000-0000-0000-0000000000a2/application' },
  ],
  sequence: [
    { id: 'a755e204-d28e-4894-8364-b849664766c5', title: 'GTM Associate', employmentType: 'FullTime', location: 'San Francisco', descriptionPlain: 'Go to market.',
      jobUrl: 'https://jobs.ashbyhq.com/sequence/a755e204-d28e-4894-8364-b849664766c5', applyUrl: 'https://jobs.ashbyhq.com/sequence/a755e204-d28e-4894-8364-b849664766c5/application' },
  ],
  // 方向预筛（restart-apply-3）：两个对口、两个不对口的应届岗。
  dirco: [
    { id: 'd1', title: 'Founder Associate (NYC)', employmentType: 'FullTime', location: 'New York', descriptionPlain: 'Work with the founders.',
      jobUrl: 'https://jobs.ashbyhq.com/dirco/00000000-0000-0000-0000-0000000000d1', applyUrl: 'https://jobs.ashbyhq.com/dirco/00000000-0000-0000-0000-0000000000d1' },
    { id: 'd2', title: 'GTM Associate', employmentType: 'FullTime', location: 'Remote', descriptionPlain: 'Go to market. 1-3 years of experience.',
      jobUrl: 'https://jobs.ashbyhq.com/dirco/00000000-0000-0000-0000-0000000000d2', applyUrl: 'https://jobs.ashbyhq.com/dirco/00000000-0000-0000-0000-0000000000d2' },
    { id: 'd3', title: 'Account Executive', employmentType: 'FullTime', location: 'Remote', descriptionPlain: 'Close deals.',
      jobUrl: 'https://jobs.ashbyhq.com/dirco/00000000-0000-0000-0000-0000000000d3', applyUrl: 'https://jobs.ashbyhq.com/dirco/00000000-0000-0000-0000-0000000000d3' },
    { id: 'd4', title: 'Customer Support Associate', employmentType: 'FullTime', location: 'Remote', descriptionPlain: 'Help customers.',
      jobUrl: 'https://jobs.ashbyhq.com/dirco/00000000-0000-0000-0000-0000000000d4', applyUrl: 'https://jobs.ashbyhq.com/dirco/00000000-0000-0000-0000-0000000000d4' },
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
