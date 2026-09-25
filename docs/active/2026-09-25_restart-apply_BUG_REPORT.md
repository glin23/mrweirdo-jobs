---
Status: done
Owner: arnold-bug
Type: bug_report
Reads:
  - docs/specs/master-plan.md
  - docs/active/2026-07-23_product-blueprint_TASK.md (Round 55-63)
  - docs/active/2026-07-23_product-blueprint_DESIGN.md §14
  - docs/active/2026-09-25_restart-apply_TASK.md
  - .claude/arnold/roles/builder.md（没有 bug.md）
Blocks: 2026-09-25 restart-apply 的 pm 调研报告
Updated: 2026-09-25
---

# BUG_REPORT — 为什么 6 月 14 日后一条都没投出去；今天让它替用户投，会卡在哪

> 证据标注：**[实测]** = 我今天真跑过命令、看到了输出；**[读码]** = 读代码推出来的，没跑；**[猜]** = 没法验证的推测。
> 安全：没有提交任何申请。所有会写库的命令都在 scratchpad 里的**家目录拷贝**上跑
> （`MRWEIRDO_HOME=<scratchpad>/home*`）。`npm test` 前后真实 `~/.mrweirdo-jobs/jobs.db` 的 mtime/size 没变
> （1782006129 / 1728512）。凡是会启动 Chrome 或会点提交的步骤一律没跑，只读了代码。

## 现场（What happened）

- `daily_count.jsonl` 最后一条是 2026-06-14（angi）。jobs.db 最后写入时间是 2026-06-20（`created_at` 最大值 2026-06-21 01:41 UTC，那天跑找岗新增了 140 行）。**6/20 以后本地家目录里没有任何运行痕迹。** [实测]
- 6/14 那一轮是最后一次真跑：大约 21 次尝试，**驱动自动投成 3 条**（energyhub / billiontoone / spothopper），angi 是主 agent 手动推过去的；其余全挂了：`stuck_on_same_missing` ×8、`profile_specific_answer_required` ×5、`essay_pending_main_agent_required` ×3、`company_relationship_answer_required` / `supplemental_file_required` 各 1。出处：`~/.mrweirdo-jobs/reports/apply-report-2026-06-14T2058.html`。[实测]
- 6/20 的 devlog 记下拍板人的原话大意：「投不出去（报错）、老被缺信息拦、找来 100 个只投出几个」。当天修了填表可靠性（`5f4d2ff`），**但这个修复从没在真实表单上跑过**。[实测，git log + memory devlog]
- 7/21 以后 64 个提交都在做「小队接入 / 阶段 0 身份问答 / 阶段 1 数字变真」，master-plan 里的阶段 2「恢复投递」还没开工。[实测，git log]

**结论：停下来的主因是「没人再跑」，不是某一处代码坏死。** 但如果今天照原样跑，队列会是 0 条可投（原因见下），而且投递链上每个文件从 6/15 以后都改过，却一次真表单都没跑过。

## 用户路径逐步走查（今天照原样跑会怎样）

| # | 步骤 | 判定 | 证据 |
|---|---|---|---|
| 0 | 技能入口 `/mrweirdo-jobskill` → onboard，技能链接 | **能过** | doctor 16 过 / 0 警告 / 0 失败，Claude 和 Codex 的技能链接都在 [实测] |
| 0 | `scripts/preflight.sh`（Node 版本 + concierge 守卫 + CDP） | **Chrome 这项未知** | 现在 9222 没有 CDP 在监听（`curl` 退出码 7）[实测]。脚本会用 `open -na` 自己拉起 Chrome（`shared/chrome-cdp-launcher.sh:68`）；Chrome 已经从 149 升到 153（chrome-profile 的 `Last Version`）；从 agent 沙箱里能不能拉起图形界面、升级以后 CDP 还正不正常，**都需要活的 Chrome 才能验** |
| 1-3 | 简历 / 档案 / 硬边界问答 | **能过，但内容过期** | profile 校验通过，工作许可门 ok，F-1 和 sponsorship 字段都填了 [实测]。但工具用的 `resume.pdf` 是 5 月那份（116287 字节，和 `~/Areas/Career/Resume/Lee_Lin_Resume.pdf` 5/11 那份一样大），9/13-14 的新简历（含现在的 AI 视频实习经历）没进来。`search_intent.json` 还是 6 月的：只有 intern/part_time、`target_cycle` 是 Summer/Fall 2026、`available_until` 2027-01，**没有 AI 视频或内容运营方向，也没有 new_grad_FT** [实测] |
| 4 | 找岗 `discover_candidates --run` | **能过** | 在沙箱里真跑：发现 1015 → 过硬筛 483 → 平台支持自动投 401 → 进打分 300（Greenhouse 207 / Ashby 74 / 其他 19），另有 82 条人工清单（81 条是 Lever）[实测] |
| 4 | 打分（主 agent 按 `score_prompt.md` 每 50 条一批） | **未验证** | 靠 LLM 在对话里打分，300 条要跑 6 批，花时间也花钱；没法离线验证 [读码] |
| 5 | 可投资格判定 + dry-run 预览 | **能过，但预览出来的全是死岗** | supervisor preflight 在拷贝上：13 项里只有 `cdp` 失败，队列 18 条 [实测]。我拿公开的岗位板 API 逐条核了这 18 条：**16 条已经下架**，剩下 2 条 nice 跳到 nice.com 的通用页面，无法确认 [实测] |
| 5→真跑 | `apply_batch` 真跑前的门：dedupe → recompute → preflight → liveness | **会漏** | 存活检查在拷贝上的结果：Greenhouse 8 条识别为过期（正确）；**Ashby 8 条全被判成 `bot_challenge`，而这个状态不拦**（`shared/constants.mjs:7` 只拦 `expired`）。所以死掉的 Ashby 岗会原样放进驱动 [实测] |
| 6 | Ashby 驱动 | **会挂（有真 bug）** | 岗位下架时表单加载不出来，驱动在 `shared/ashby_apply_driver.mjs:1045` / `:1053` 用 `console.log` 吐出旧词 `outcome:'skip'`，然后以退出码 0 结束。记账人 `validateOutcome` 拒收这个旧词（我实测它会抛错）→ `record_apply_outcome.mjs:97-100` 以 exit 1 退出 → 这一行**不记账本、也不改库**，留在队列里，下一批还会再挑到它 [实测契约函数 + 读码] |
| 6 | Greenhouse / Ashby 驱动填表和提交 | **未知，风险高** | 6/15 以来：ashby 驱动 8 个提交（+79/-84 行），greenhouse 3 个（+69/-92），cdp.mjs 3 个（+125/-13），apply_batch 6 个，record_apply_outcome 2 个；**这些改动一次真表单都没跑过**（阶段 1 的 V9 因为没有活 Chrome 被跳过）。上一次真跑驱动自动成功率大约 3/21。两个驱动都没有验证码识别分支 [实测 git + 读码] |
| 6 | Greenhouse 邮箱验证码 | **[猜]** | 代码里完全没有处理「security code / 邮箱验证」这类步骤（grep 零命中）。Greenhouse 现在会不会对部分岗位弹这一步，我没法验证 |
| 7 | 判定成功 + 记账 | **能过** | `npm test` 325/325 通过 [实测]；账本一致性检查只核账本里有的行，不会被 182 条历史行误报（`submission_ledger.mjs:134-187`）[读码] |

## 根因（Why it happened）

按严重程度排：

1. **队列全是 3 个月前的旧岗（主因，今天投不出去的直接原因）。** 队列里 18 条都是 6 月入库的 Summer/Fall 2026 岗，16 条已确认下架。系统没有「岗位太旧自动过期」的机制，`expired_title_year` 只看标题里的年份，2026 年内不会触发。[实测]
2. **存活检查看不见 Ashby 岗位是死是活（真 bug）。** `liveness_gate.mjs:33` 只要页面里出现 `captcha` 这个子串就判 `bot_challenge`，而每个 Ashby 页面都带 `recaptchaPublicSiteKey`。我拿活岗、死岗、根本不存在的 ID 各试了一次，**三个都判 `bot_challenge`**。Ashby 是前端渲染的，HTTP 状态码永远是 200，光抓 HTML 本来就分不出死活。[实测]
3. **Ashby 驱动还在用旧词吐结局（真 bug，阶段 1 包 2 漏迁的两处）。** 契约规定「所有生产者同一个提交里迁完」（`driver_contract.mjs:37-39`），但 `ashby_apply_driver.mjs:1045,1053` 没迁。它和第 2 条叠在一起：死掉的 Ashby 岗 → 表单加载不出来 → 记账失败 → 这行永远留在队列里重试。[实测 + 读码]
4. **投递链改了很多却没有真跑验证。** 这是这次重启最大的未知，只有活 Chrome 加一次有人盯着的小批量才能解决。[实测 git]
5. **预览和真跑不是同一份清单。** dry-run 不跑 dedupe、recompute 和存活检查（`apply_batch.mjs:255-281` 只在真跑时执行），所以用户在关卡里看到的 18 条和真跑时实际处理的不一样。这正是 master-plan 阶段 2 写的「预览=实投」。[读码 + 实测]
6. **次要，但是真问题：**
   - **197 行被锁死**：这些行 fit≥5，但当年打分还没有 `recommended` 字段，被 `recompute_auto_apply_eligibility.mjs` 永久判成 `legacy_recommended_unknown`；`queue_diagnostics` 又把它们算作「eligible 215」，**两个出口口径不一致** [实测]。不过我核了 fit≥5 且 `recommended` 为空的 244 行，只有约 48 行还活着（GH 42 / Lever 5 / Ashby 1），所以实际损失小 [实测]
   - **`demo:check` 在 macOS 上报「ready rows: 0」是假的**：`supervisor_preflight.mjs:293` 输出 84KB 的 JSON 以后，`:321` 立刻 `process.exit`，macOS 上管道是异步写，输出在 65488 字节处被截断，`demo_check.mjs:155` 解析失败，于是显示 0（6/14 devlog 里那条 WARN 可能也是它）。在 Linux 的 CI 上测不出来 [实测]
   - **日上限、60 天同公司最多投 2 次，代码里都没有**：`--max` 默认 `all`（`batch_limit.mjs:13`）；60 天规则 grep 零命中。两条都只停在纸面上 [读码]

## 同模式风险扫描（Where else can it happen）

- 旧词结局：三个驱动全扫过，**只有 Ashby 那 2 处**；Greenhouse 和 Lever 都走 `emitOutcome` / `result()`。`apply_gap_report.test.mjs` 里还有大量 `outcome:'skip'` 夹具，说明缺口报告这个下游可能还在按旧词归类（没深挖）[实测 grep]
- 「靠 HTML 子串判存活」：Greenhouse 靠 `?error=true` 跳转判断，能用；Lever 没进队列，没测。凡是前端渲染的 ATS（Ashby、以后接的 Workday 等）都有同样的盲区 [实测 + 读码]
- `process.exit` 截断管道输出：任何「子进程输出超过 64KB 的 JSON，然后 `process.exit`，父进程拿管道读」的组合都会中招。目前只确认 `demo:check` ← `supervisor_preflight` 这一对；`queue_diagnostics` 49KB 而且不 `exit`，暂时安全 [实测]
- 输入过期：简历和找岗意向都停在 6 月；这不是代码问题，但会直接决定投出去的质量

## 修复方案（How to fix）— 消除根因，不绕症状

| 序 | 修什么 | 性质 | 工作量 |
|---|---|---|---|
| F1 | 用新简历 + 新方向（AI 视频 / 内容运营？要不要加 new_grad_FT？）重跑找岗 + 打分，**把旧队列冲掉** | 根因 1；需要拍板人给方向 | 小（主要是 LLM 打分的时间和费用） |
| F2 | 存活检查对 Ashby 改用公开的 posting API（仓库里已经有 `shared/sourcing/ashby_board_api.mjs`），按「岗位 ID 在不在板上」判断；Greenhouse 也可以换 board API，更稳 | 根因 2，在信息最全的地方解决 | 小 |
| F3 | `ashby_apply_driver.mjs:1045,1053` 改成 `emitOutcome`（表单加载不出来 → `not_submitted` 或 `unknown`；简历上传失败 → `crashed`），并补一条源码扫描守卫：驱动里禁止裸 `console.log` 吐 `outcome` | 根因 3 | 小 |
| F4 | 有人盯着的真表单试跑：拍板人点头后，GH 和 Ashby 各挑 1-2 条活岗，`--max 2`，人在屏幕前看；同时补上 V9 整页留证 | 根因 4 | 中（要活 Chrome 和拍板人在场；挂了就接着修驱动，可能涨到大） |
| F5 | dry-run 也跑 recompute（写到临时副本或只读模式）加存活检查，保证预览=实投；`--max` 默认值改成当前档位（10）；把 60 天同公司规则落进队列谓词 | 根因 5 + 规矩落地 | 中 |
| F6 | `queue_diagnostics` 和 recompute 共用同一个判定（含 `legacy_recommended_unknown`）；那约 48 条还活的旧行重新打分 | 次要 | 小 |
| F7 | `supervisor_preflight` 改成设 `process.exitCode`，不再硬 `exit`（或者先等 stdout 写完再退） | 次要 | 小 |

**不建议**：加 `--skip-liveness` 硬冲，或者把 `bot_challenge` 也列进拦截名单。前者是绕开症状；后者会把所有 Ashby 岗一刀切掉（活岗也判 `bot_challenge`），等于停掉一个平台。

## 防回归（How to prevent regression）

本轮只查不修，没加测试。修的时候建议先红后绿：
- F2：拿三种 Ashby 页面各录一份夹具（活 / 下架 / 不存在），断言分别判 live / expired / expired；现在的实现三个都判 `bot_challenge`，测试一定先红
- F3：源码扫描守卫，扫 `shared/*_apply_driver.mjs` 里不经过 `emitOutcome` / `result(` 的 `outcome:` 字面量；现在 ashby 会命中 2 处
- F7：子进程输出超过 64KB 的 JSON 再走管道读回的测试，**必须在 macOS 上跑**，或者直接断言源码里没有 `console.log` 后紧跟 `process.exit`
- F4 本身就是防回归：以后每次改驱动，先在 1-2 条活岗上有人盯着跑一遍，再放大批量

## 教训（What to remember）— 建议 lead 沉淀

1. **「数字变真」做完不等于「能投」**：阶段 1 把判定和账本做干净了，可喂进去的岗位已经放了 3 个月。岗位是会变质的，找岗必须紧挨着投递跑，旧队列应该自动失效。
2. **离线测试全绿，对浏览器驱动几乎不说明问题**：325/325 绿，却有两处驱动出口没迁，存活检查对一整个平台是瞎的。任何驱动改动，都要有一次真表单小样本才算完成。
3. **macOS 上管道是异步的**：`console.log` 大块内容后接 `process.exit` 会截断，Linux CI 测不出来。可以进 builder.md。

## 试过的错误方向

1. **以为 queue_diagnostics 的「eligible 215」就是可投量** → 错。对照 recompute 发现其中 197 条被 `legacy_recommended_unknown` 挡着，真正进队列的只有 18 条；这是两个出口口径不一致，不是有 215 条可投。
2. **以为存活检查的 `bot_challenge` 说明 Ashby 在风控拦截** → 错。拿活岗和不存在的 ID 对照，三个都判 `bot_challenge`，原因是页面里固定带着 `recaptchaPublicSiteKey`，跟风控无关。
3. **以为 `demo:check` 的「ready rows: 0」说明队列空了** → 错。直接跑 preflight 队列是 18 条；用 `spawnSync` 管道原样复现，stdout 在 65488 字节处被截断，是解析失败显示成 0。
4. **起初怀疑账本一致性检查会被 182 条历史行卡住，导致第一次真投以后下一批被拦** → 读 `rebuild` 发现它只核账本里有的行，历史行不参与，这个担心不成立。
