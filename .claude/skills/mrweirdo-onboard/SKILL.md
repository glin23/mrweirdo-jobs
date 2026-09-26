---
name: mrweirdo-onboard
description: Main entry skill for Mr. Weirdo Jobs after install. Trigger for first-run setup, resume intake, optional self-introduction intake, and 「跑 N 个」 find-and-apply runs (find, score and apply on the spot, 3-line report; no job list, no queue gate). Uses one intake prompt, one hard-boundary AskUserQuestion call, a soft parse correction window; the user saying "跑 N 个" is the start of each run. Do NOT trigger for a single URL/manual application; route those internally to the dedicated ATS skill.
---

# Mr. Weirdo Jobs Onboard

This is the main local skill after install. Every run belongs to the person
running the skill; all state stays on this machine.

State defaults and run artifacts are in `references/run-and-database.md`. The
flow is: intake -> parse soft window -> 「跑 N 个」 start -> find, score and
apply on the spot (one stream run) -> 3-line report -> missing-info questions.
There is no job list and no queue gate: the user saying "跑 N 个" is the
confirmation for that run (restart-apply D8「说跑即开始」). Nothing but the
submission ledger, the seen log and the rotation cursor stays on disk between
runs.

## Trigger

Use this skill when:

- first-run sentinel `~/.mrweirdo-jobs/.first_run` exists and the user asks how
  to start, says "start", "next step", "找实习", "投实习", or similar;
- user explicitly invokes `/mrweirdo-onboard` or `/mrweirdo-jobskill`;
- user says "跑 N 个" / "run N" / wants the find-score-apply run.
- user says "投" + a link from a run report's held list (release it, Step 7).

When invoked with no concrete request yet, show a single AskUserQuestion main
menu with exactly these five choices and no slash commands:

1. `开始找实习 / Onboard` (recommended): continue directly into the full
   onboard flow, starting at Step 0/Step 1, with no command for the user to type.
2. `进度跟踪 / Tracker`: route internally to `mrweirdo-tracker`.
3. `扩充写作画像 / Expand`: route internally to `mrweirdo-expand`.
4. `技能提升 / Upskill`: route internally to `mrweirdo-upskill`.
5. `起草申请材料 / Materials`: route internally to `mrweirdo-materials`.

Do not show ATS platform commands in this menu. The one-off ATS skills,
confirmation sync, quota cherry-pick, doctor preflight, and `*-auto` engines
remain available for internal routing, but are not user-facing menu items.

Do not use this skill for:

- one URL/manual apply: route internally to the dedicated one-off ATS skill;
- large-company quota slots: route internally to `mrweirdo-cherry-pick`;
- install readiness only: route internally to `mrweirdo-doctor`;
- Gmail confirmation sync only: route internally to `mrweirdo-confirm`.

## Defaults And Safety

- Auto-apply threshold: `fit_score >= 5`.
- Stable batch auto-submit ATS: Greenhouse and Ashby. Lever is paused.
- Daily tier: `MRWEIRDO_DAILY_TIER` (10 / 25 / 50, default 10). Above 30 only
  with the user's own explicit word (`--confirm-tier-over-30`). A run applies
  to at most min(N, what is left of today's tier) and says so in its first line.
- Never twice: a job applied to (or maybe applied to) is never applied to
  again; one company at most 2 times in 60 days. The ledger decides, not you.
- List (dream) companies (`search_intent.target_companies`) are scanned first
  every run; an eligible job there is NOT applied to automatically — it is
  listed for the user（restart-apply D10「梦想公司投前过目」）.
- Per-company quota guard stays on for the user's local `company_list.user.json`.
- LinkedIn, Indeed, Glassdoor, non-GH/Ashby platforms, and
  `legitimacy="suspicious"` rows go to manual review.
- Do not invent personal facts. Visa, GPA, demographic, legal attestation,
  background-check, relocation, and salary-acceptance facts require explicit
  user input or must stay null/blocking.
- Do not run real apply batches in background mode. The user should see row
  progress and have an interrupt window.

## Output Presentation Rules

All user-facing progress, summaries, questions, and final reports should use
the same compact terminal style:

```text
[Step X/7] <短标题> - <正在做什么> (~<大概多久>)
```

Presentation rules:

- Lead with the current step, one-line status, and the user's single next action.
- Put key counts in a compact funnel line or small table before details.
- Keep tables to seven columns or fewer. Put anomalies below the table as short
  tagged lines.
- Do not paste raw JSON, database rows, or unformatted command output to the
  user. Read artifacts, then summarize them.
- Use CN-leaning bilingual labels: short Chinese first, English when it helps
  scanning (for example `自动投 / auto`, `manual 清单 / manual`).
- Prefer calm labels over paragraphs: `状态`, `你要做`, `结果`, `路径`, `下一步`.
- During a run, stay silent between the start line and the 3-line report
  (无事禁言). Speak up only when a command fails or the run stops on a
  breaker.
- Keep the start line and the 3-line report clean. They are the main product
  moments.
- Never change the meaning of the identity line, counts, consent, eligibility,
  thresholds, or apply flow while improving presentation.

## References

Read these only when needed:

- `references/intake-and-profile.md`: hard-boundary questions, profile/search
  JSON shape, adaptive follow-up rules, and parse soft-window rules.
- `references/run-and-database.md`: what stays on disk, the stream run
  commands, the ledger, history migration, and recording user answers.
- `../../../shared/scoring/score_prompt.md`: required scoring rubric.
- `../../../shared/profile.template.json`: runtime `profile.json` shape.
- `../../../shared/intelligence/intent_schema.json`: `search_intent.json` schema.
- `../../../shared/references/truthfulness.md`: truthfulness rules for any
  agent-drafted open-text answer.

## Step 0 - Preflight

Show a short preamble. For first run:

```text
[Step 0/7] 启动 / Ready check - 确认本机环境 (~30 sec)

Mr. Weirdo Jobs 已准备开始。

你只需要给我一件东西：
| 必填 | 内容 |
|---|---|
| 简历 PDF 路径 | 例如 `/Users/you/Resume.pdf` |

可选：再加 1-2 句目标方向/偏好；不写也可以，我会只从简历安全推断。

接下来我会：
1. 读取简历并生成本地 profile。
2. 只问不能安全推断的硬边界问题。
3. 你说「跑 N 个」我才开跑：现找、现打分、合适的当场投，投满 N 个或新岗找完就停。
4. 结束只给你 3 行：投成了哪几家、没投成的原因、新岗够不够。

你要做：发我简历 PDF 的绝对路径。
```

Then run:

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"; export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
cd "$MRWEIRDO_REPO_ROOT"
bash scripts/preflight.sh
```

Stop on any failure and tell the user what to fix.

## Step 1 - Resume, Intro, Hard Boundaries

Ask for one intake message:

```text
[Step 1/7] 简历 intake - 建立本地画像 (~1-2 min)

请发一条消息：

| 类型 | 是否必填 | 说明 |
|---|---:|---|
| 简历 PDF 绝对路径 | 必填 | 用来生成 profile/search intent |
| 目标方向/偏好 | 可选 | 1-2 句即可；不写不阻塞 |

我不会编造未知个人事实；简历里没有、又不能安全推断的内容会留空或后面统一问。
```

Copy the resume:

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"; export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
cd "$MRWEIRDO_REPO_ROOT"
bash scripts/intake_resume.sh "<path from user>"
```

Read `references/intake-and-profile.md`. Use exactly one AskUserQuestion call
with the three hard-boundary questions A0/A1/A2. For A2, the recommended
default is ask/skip sensitive legal questions when a form actually needs them.
Do not require a self-introduction. Treat `self_intro_raw` as optional and allow
it to be empty. Do not ask soft preference questions here unless the answer
would materially change discovery keywords and fits the one adaptive follow-up
call budget.

If `~/.mrweirdo-jobs/documents/` exists and is non-empty, mention that
`/mrweirdo-expand` can enrich writing memory later. Do not block onboarding on
that branch.

## Step 2 - Generate Local JSON

Read the resume PDF in the main agent session. Use any optional self-introduction
only as extra evidence. Generate:

- `$MRWEIRDO_HOME/profile.json`
- `$MRWEIRDO_HOME/search_intent.json` with required `target_function_anchor`
  (`self_reported_target_functions`, `resume_supported_functions`,
  `adjacent_functions`, `excluded_functions`, `rationale`)
- `$MRWEIRDO_HOME/essay_profile.json`

Use `references/intake-and-profile.md`, `shared/profile.template.json`, and
`shared/intelligence/intent_schema.json`. Mark inferred soft fields in your
summary as `[推断，可改]`; do not mark hard-boundary facts as inferred.
When no self-introduction was provided, generate `essay_profile.json` from the
resume only: infer writing voice, positioning, and proof points only where the
resume supports them; put genuinely unknown writing facts in
`dynamic_questions_to_ask_later` and sensitive/unverified claims in
`hard_no_claims`. Do not block onboarding just because `self_intro_raw` is empty.

The required `work_authorization` runtime shape is in
`references/intake-and-profile.md`; do not emit legacy-only keys.

After writing:

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"; export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
cd "$MRWEIRDO_REPO_ROOT"
bash scripts/secure_profile_files.sh
node shared/validate_user_profile.mjs
```

If validation fails, correct the generated JSON before continuing.

## Step 3 - Parse Soft Window

Show a concise parse summary before the first run:

- name, email, phone;
- school, major, graduation date;
- work authorization and sponsorship values;
- top role directions and industries;
- geography and relocation policy;
- writing themes and hard no-claims;
- exclude keywords;
- list (dream) companies, if `search_intent.target_companies` is set.

Always include this identity line and fixed statement in the parse window — it
replaces the old queue gate as the one place the user sees who the forms are
filled as, before anything is submitted:

```text
[Step 3/7] 解析检查 / Parse window - 先给你扫一眼 (~30 sec)

将以以下身份提交：<name> / <email> / <phone> / <visa 状态>（来源 <source>）

| 模块 | 读到的内容 | 备注 |
|---|---|---|
| 学校 | <school> / <major> / <graduation> | [推断，可改] where applicable |
| 工作授权 | <visa> / sponsorship <yes/no> | 不从专业推断 |
| 目标方向 | <functions / role categories> | 跟用户自报 + 简历走 |
| 地点 | <geo / relocation policy> | 影响找岗 |
| 名单公司 | <N 家 / 未设> | 每次先扫；合格的不自动投，列给你过目 |
| 写作素材 | <themes> | 只用有证据的内容 |
| 不写/不投 | <hard no-claims / excluded keywords> | 安全边界 |

对需要 cover letter 的岗位，我会基于你的简历/profile/essay_profile/answer_bank 与岗位匹配证据自动生成并附上 cover letter；不会编造个人或公司事实。
只自动投 Greenhouse / Ashby；同一个岗位永不投第二次，同一家公司 60 天最多 2 次。

你要做：身份或方向不对就直接纠正；都对就说「跑 N 个」（N = 这次投几个）。「跑 N 个」这句话本身就是开始，我不会再给你清单等你点头。
```

If the user corrects identity facts, update the JSON (identity facts through
`shared/record_profile_answers.mjs`, see `references/run-and-database.md`) and
show the identity line again. If they change target direction, update
`search_intent.json`; the next run re-judges earlier「不合适」by itself.

**名单公司 / Company list (first run, once).** If
`search_intent.target_companies` is empty or missing, offer the preset AI-video
company list once. Show what would be added (dry-run, writes nothing):

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"; export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
cd "$MRWEIRDO_REPO_ROOT"
node shared/install_watchlist.mjs
```

Ask one question: 「要把这 N 家设为名单公司吗？名单公司每次先扫；它们合格的岗不自动投，会列出来给你过目。」
Run `node shared/install_watchlist.mjs --apply` only after the user says yes.
If the user says no or names other companies, do not write the preset.

## Step 4 - 「跑 N 个」开跑 / Start

The user saying "跑 N 个" (or "跑 10 个", "run 5") is the start of the run.
If they want a run but give no number, ask one question: 「这次跑几个？」
(recommend today's tier, 10 by default). Do not show a job list first.

Read `references/run-and-database.md`, then:

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"; export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
cd "$MRWEIRDO_REPO_ROOT"
node shared/stream_run.mjs start --target <N>
```

Show the `line` field as the only start message:

```text
[Step 4/7] 开跑 / Start - <line>
```

For example `开始，本次目标投 10；今日额度剩 10`, or `你要 50，今天档位 10，…，本次最多投 10`.
Keep `run_id` for the next steps. If `start` refuses, say why in one line and
stop:

- another run is still active → offer `finish --run <id>` for it, or, if that
  window is gone for good, start again with `--abandon <id>`;
- an apply batch is running → wait; the message spells out how to stop a stuck one;
- the ledger does not hold the old history yet (`backfill-legacy`) → this is a
  one-time migration; show the dry-run to the user and run `--apply` only
  after they agree (see `references/run-and-database.md`).

A verification run that must not submit anything uses
`start --target <N> --no-submit` (finds, dedupes and scores, drives nothing).

## Step 5 - 找岗 → 打分 → 当场投 / Find, score, apply

Loop until `next` says `done`:

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"; export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
cd "$MRWEIRDO_REPO_ROOT"
node shared/stream_run.mjs next --run "$RUN_ID"
```

- `action: "score"` → read `batch_file` (at most 50 new jobs; anything
  applied to or already judged was dropped before you see it), score EVERY
  job with `shared/scoring/score_prompt.md`, and write the JSON array of
  complete score objects to `scored_file`. Then:

  ```bash
  node shared/stream_run.mjs submit-scores --run "$RUN_ID" --batch <batch> --scored "<scored_file>"
  ```

  This stores the batch in the run's one-off work DB, holds eligible
  list-company jobs for the user, and applies to the rest right away
  (liveness check, pre-dispatch guard re-reading the ledger for every job,
  driver, recorder). If its output has a non-null `gap_report`, read that
  file NOW (it is deleted with the run) and keep its
  `condensed_missing_questions` for Step 6.
- `action: "done"` → go to Step 7.

[Step 5/7] runs silently: no per-batch chatter. Speak only if a command exits
non-zero (show the one-line reason) or `stopped_by` is `breaker_open` /
`record_failed` (the run stops; say so and go to Step 7). Do not run real
batches in the background; the user should be able to interrupt.

## Step 6 - Missing Info Follow-Up

After the run (Step 7), if any batch's gap report had
`condensed_missing_questions`, handle open-text answers as agent work per
`references/run-and-database.md` and `shared/references/truthfulness.md`
first; do not invent facts.

Then ask at most four grouped questions in one AskUserQuestion call. Present
them by impact, using `unblocks_n_jobs`, for example `补 <field> 可解锁 <N> 个岗位`.
Ask only facts that cannot be safely inferred from the resume or existing
profile, and do not use a fixed checklist. If a category appears as a
singleton, keep it as its own clear question instead of forcing it into an
unnatural group.

Use this user-facing lead-in before the one AskUserQuestion call:

```text
[Step 6/7] 补缺口 / Missing info - 一次补最有用的信息 (~2 min)

我已经先自动起草开放题；这里只问必须由你确认、且能解锁最多岗位的事实。

| 优先级 | 要补的信息 | 可解锁 | 覆盖哪些原始缺口 |
|---:|---|---:|---|
| 1 | <one grouped question> | <N> 个岗位 | <categories> |
| 2 | <one grouped question> | <N> 个岗位 | <categories> |

你要做：一次性回答下面这些分组问题；不知道的可以留空，我不会编。
```

Never list each job's missing fields line by line for the user. The user should
see the minimal cross-application question set, not a manual application audit.

Record the answers with `shared/record_profile_answers.mjs` (never hand-write
profile.json; see `references/run-and-database.md`):

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"; export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
cd "$MRWEIRDO_REPO_ROOT"
node shared/record_profile_answers.mjs --json '<answers>' --source user_answer --category <category> --asked-by step6
node shared/validate_user_profile.mjs
```

Nothing is requeued by hand: the jobs that got stuck come back as candidates by
themselves on the next "跑 N 个", because the profile they were stuck on changed.

## Step 7 - 3 行报告 / Batch report

```bash
export MRWEIRDO_HOME="${MRWEIRDO_HOME:-$HOME/.mrweirdo-jobs}"; export MRWEIRDO_REPO_ROOT="${MRWEIRDO_REPO_ROOT:-$MRWEIRDO_HOME/repo}"
cd "$MRWEIRDO_REPO_ROOT"
node shared/stream_run.mjs finish --run "$RUN_ID"
```

`finish` deletes the run's work DB and scratch files and returns `lines` — three
lines. Show only these 3 lines (只给这 3 行), verbatim, nothing else:

```text
[Step 7/7] 本轮完成 / Batch report
<lines[0]>   投出 N 个：公司·岗位、…（名单公司合格的会在这里列「公司·岗位·链接」等你过目）
<lines[1]>   没投成 N 个：原因（判不确定的附截图路径，请你看一眼）
<lines[2]>   新岗够不够：这次看了 X 个新岗，合适的 Y 个
```

Then, only if it applies, at most one short line each:

- the finish output has `held` (list-company jobs waiting for review): the user
  either applies by hand, or says 「投」+ the link(s) → start a run with
  `node shared/stream_run.mjs start --target <number of links> --release <link> [--release <link2>]`
  and go through Steps 5 and 7 again (it scans the list only, re-scores, applies);
- the user says they applied to some jobs by hand → write them into the ledger
  so no run applies to them again (dry-run first, then `--apply`):
  `node shared/submission_ledger.mjs record-manual --url <link> --company <board slug> --title "<title>" [--at YYYY-MM-DD]`;
- Step 6 questions were collected → go to Step 6.

The live counts (今日已尝试 / 已投) are in `npm run status`.
