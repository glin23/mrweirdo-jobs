# Run And Database Reference

Use this reference during `/mrweirdo-onboard` Steps 4-7.

## Local State Contract

- This is a local skill. State belongs only to the person running it.
- Default state path is `$MRWEIRDO_HOME`, usually `~/.mrweirdo-jobs`.
- There is no job pool. What stays on disk between runs is only:
  - the submission ledger `log/submissions.jsonl` (600) — who was applied to
    (or maybe applied to), the only source of every count and of "never twice";
  - the seen log `log/seen.jsonl` (600) — jobs looked at and not applied to
    (not a fit, visa-blocked, taken down, stuck on missing info, held for
    review), minimal fields only, so they are not paid for again;
  - the rotation cursor `source_cursor.json` — where the next run's scan starts.
- Each run works in a one-off directory `$MRWEIRDO_HOME/run-tmp/stream-<…>/`
  (work DB, batches, scores, driver results, gap report). `finish` deletes it.
- `jobs.db` is retired history. Before the first stream run its 已投 rows are
  migrated into the ledger (`backfill-legacy`); then it is moved, not deleted,
  to `archive/` (`retire_jobs_db.mjs`). No run reads or writes it.
- There is no shared company cache, no remote backend, and no bundled demo corpus.
- Checked-in public board slug lists are source enumerators only, not per-user
  job results and not shared company caches.

## Run Commands (one stream run)

```bash
cd "$MRWEIRDO_REPO_ROOT"
node shared/stream_run.mjs start --target <N> [--no-submit] [--release <link>]… [--abandon <run_id>]
node shared/stream_run.mjs next --run <run_id>
node shared/stream_run.mjs submit-scores --run <run_id> --batch <k> --scored <scored_file>
node shared/stream_run.mjs finish --run <run_id>
```

Each command prints one JSON object on stdout (child output goes to stderr).

- `start`: refuses while another run is active or an apply batch is alive (the
  message says how to finish, abandon or stop it); records a crashed attempt
  from a dead run first (as maybe submitted, never re-applied); computes the
  budget: at most min(N, today's tier left) applications and N×10 new jobs
  looked at. Its `line` is the only start message.
- `next`: scans the company list first, then the next rotation window; drops
  what the ledger or the seen log already covers BEFORE scoring; hands out up
  to 50 new jobs in `batch_file`, or `done` with a reason (`target_reached`,
  `score_budget_reached`, `supply_exhausted`, `breaker_open`,
  `pre_submit_fail_cap`, `daily_cap_reached`).
- `submit-scores`: stores the batch, writes not-a-fit / visa-blocked to the
  seen log, holds eligible list-company jobs (held_for_review), and applies to
  the rest for real (`apply_supervisor --real` → liveness → pre-dispatch guard
  per row → driver → recorder). Returns `gap_report` when the batch left
  missing-info questions — read it before `finish`.
- `finish`: returns the 3 report lines, `held`, `skipped_before_scoring`, and
  deletes the run directory. Always finish a started run.

Scoring is done by the main agent using `shared/scoring/score_prompt.md` over
`batch_file`, writing the JSON array to `scored_file`. Every job in the batch
needs one complete score object: `apply_url`, numeric `fit_score`, boolean
`recommended`, `role_type_match`, `dim_scores`, `legitimacy`, and
`legitimacy_signals`. The store step fails on partial scoring; the batch then
stays pending — finish scoring and submit again.

Liveness: only `liveness_status='expired'` blocks; `uncertain` and
`bot_challenge` remain eligible because the ATS driver still does the
page-level verification.

`submit-scores` submits real applications. Do not add it (or
`apply_supervisor --real`) to `.claude/settings.json` allow lists; the
permission prompt stays a second spending gate.

## Held list jobs and hand-made applications

- Held: eligible jobs at list companies are not applied to automatically. They
  are listed in line 1 of the report with their links. The user applies by
  hand, or releases them: `start --target <number of links> --release <link>…`
  (list scan only, re-scored, applied like any other job).
- Hand-made: whatever the user applied to by hand goes into the ledger, so no
  run applies to it again and it counts toward the company's 2-in-60-days:

```bash
cd "$MRWEIRDO_REPO_ROOT"
node shared/submission_ledger.mjs record-manual --url <link> --company <board slug> --title "<title>" [--at YYYY-MM-DD]           # dry-run
node shared/submission_ledger.mjs record-manual --url <link> --company <board slug> --title "<title>" [--at YYYY-MM-DD] --apply
node shared/submission_ledger.mjs record-manual --file <list.json> --apply   # [{"url","company","title","at"}]
```

## One-time history migration (before the first stream run)

`start` refuses while `jobs.db` exists and the ledger has no history lines.
With the user's agreement, in this order:

```bash
cd "$MRWEIRDO_REPO_ROOT"
node shared/submission_ledger.mjs backfill-legacy            # dry-run: what would be migrated
node shared/submission_ledger.mjs backfill-legacy --apply    # writes legacy lines + count check
node shared/retire_jobs_db.mjs                               # dry-run: count check + archive path
node shared/retire_jobs_db.mjs --apply                       # moves jobs.db to archive/, deletes nothing
```

## Missing Info

Do not ask the user to write open-text answers such as inline essays,
cover-letter style prompts, or other `agent_open_text` fields when the resume,
optional self-introduction, local profile, `essay_profile.json`, and
`answer_bank.json` contain enough grounded material. Those belong in the agent
work bucket and should be answered or templated before asking. For
`agent_attestation` and `agent_profile_backed`, fill only from the local profile
or driver coverage, and follow `shared/references/truthfulness.md`.

Jobs that got stuck on missing info are not requeued by hand: once the answer is
recorded, the profile they were stuck on has changed and the next run brings
them back as candidates.

## Recording User Answers

Never hand-write `profile.json`. Every answer the user gives — the A0/A2
hard-boundary answers in Step 3 and the Step 6 follow-up answers — goes in
through one command:

```bash
cd "$MRWEIRDO_REPO_ROOT"
node shared/record_profile_answers.mjs \
  --json '{"work_authorization.visa_status": "F-1 OPT",
           "work_authorization.authorized_to_work_us": true,
           "work_authorization.requires_sponsorship_now": false,
           "work_authorization.requires_sponsorship_future": true}' \
  --source onboarding_a0 --category user_work_authorization --asked-by intake
```

- `--json` keys are dotted profile paths. A path is writable only when some
  entry in `QUESTION_TEMPLATES` (`shared/missing_field_questions.mjs`) declares
  it, so the answer set and the write permissions cannot drift apart. To record
  something no question asks for, add the question first.
- `--source` is one of `user_answer`, `onboarding_a0`, `onboarding_a2`,
  `resume_inferred`, `legacy_unverified`.
- `--category` is the gap-report category the answer came from; `--asked-by`
  records which moment asked (`intake`, `queue_gate`, `step6`).
- `--dry-run` prints what would change and writes nothing.

Values are checked, never coerced. `authorized_to_work_us` takes `true` or
`false` — `"true"`, `"Yes"` and `1` are rejected, because a coerced value here
becomes a claim about the user's immigration status typed onto a live form.

Exit codes:

| Code | Meaning | What to do |
|---:|---|---|
| 0 | Written. `changed[]` lists every path that moved. | Continue. |
| 2 | Bad arguments, or a path no question declares. | Fix the path, or add the question template. Nothing was written. |
| 3 | Wrong value type. | Send a real boolean/string. Nothing was written. |
| 4 | The profile validator rejected the file. | `profile.json` is byte-identical to before; read the printed validator output. |

On success the command also updates `$MRWEIRDO_HOME/answer_provenance.json`
(chmod 600), which records, per path, where the answer came from, when, and a
fingerprint of the value — never the value itself. It is read-only context for
the Step 3 identity line and audit; it never affects what gets filled onto a
form. A missing or corrupt provenance file cannot block an application.

## Eligibility

`store_scored_jobs.mjs` marks a row auto-apply eligible only when:

- fit score is at or above the configured threshold, default 5;
- scorer sets `recommended: true`;
- role type matches the user's `role_type_targets`;
- function relevance is not `function_relevance_too_distant` under
  `shared/function_relevance.mjs`; unknown/ambiguous relevance is held as
  non-blocking and left to the scorer/user-visible review path;
- company is not quota-guarded in the user's local `company_list.user.json`;
- `liveness_status` is not `expired`; `uncertain` and `bot_challenge` are
  visible but not blocking;
- ATS is in the stable auto-submit set, currently Greenhouse and Ashby.
- `legitimacy` is not `suspicious`; suspicious rows keep their fit score but
  are held for manual review.

Lever, Workday, SmartRecruiters, iCIMS, JobVite, and Handshake may be
discovered/scored, but are not part of the stable batch auto-submit path unless
a later skill version explicitly changes that. Lever remains available as a
manual/single-URL helper.

## Final Summary

The run report is the 3 lines from `finish`, shown verbatim and nothing else:
what was applied to (「公司·岗位」, plus held list jobs with links), what was
not and why (screenshots for uncertain ones), and whether there were enough new
jobs. Live counts (今日已尝试 / 已投) are in `npm run status`, read from the ledger.
