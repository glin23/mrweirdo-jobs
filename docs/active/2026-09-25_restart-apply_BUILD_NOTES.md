---
Status: done
Owner: arnold-builder
Type: build_notes
Reads:
  - docs/active/2026-09-25_restart-apply_TASK.md（关卡 1 决策 ④）
  - docs/active/2026-09-25_restart-apply_BUG_REPORT.md
  - docs/active/2026-07-23_product-blueprint_VERIFY_REPORT.md :2620-2750（第 7 轮验收 P2）
  - shared/driver_contract.mjs（统一退出契约）
  - .claude/arnold/roles/builder.md
  - （第 2 次召唤）docs/active/2026-09-25_restart-apply_DESIGN.md 第 2 轮全文、docs/specs/restart-apply.md、PRODUCT_SPEC 第 2 轮 V1-V13、VERIFY_REPORT §5
Blocks: restart-apply 小修包的 verify 验收；S1+S2 的 verify 验收；lead 对真实家目录跑 backfill-legacy --apply
Updated: 2026-09-25
Iterations: 3
---

# BUILD_NOTES — restart-apply 小修包（4 项）

> 标注：**[实测]** 真跑过命令看到输出；**[读码]** 读代码推出；**[猜]** 未验证推测。
> 派遣单写的文件名是 `_BUILD.md`，项目段名表钩子要求 `_BUILD_NOTES.md`，按钩子落名。

## 实现摘要

四项各一个提交，均未 push。改动净增 +377/-20 行（含测试），另加 CHANGELOG 四条。

| # | 提交 | 改了什么 | 生产文件 |
|---|---|---|---|
| 1 P2 隐私 | `072f203` | 账本落行后派生一份去掉 answers 的 `auditOutcome`，feedback 表（6 条写入路径）和人工清单文件一律用它；answers 只进 600 权限的账本 | `shared/record_apply_outcome.mjs` |
| 3 Ashby 旧词 | `7cd693c` | `ashby_apply_driver.mjs` 的「表单没加载出来」「简历传不上」两处从 `console.log({outcome:'skip'})`+return 改走 `emitOutcome` → `crashed` / exit 1（和 Greenhouse 的 `resume_upload_failed` 用同一个词） | `shared/ashby_apply_driver.mjs` |
| 2 Ashby 存活 | `d326b17` | `jobs.ashbyhq.com/<slug>/<uuid>` 这类行改问 Ashby 公开 posting API：ID 在板上判 live；不在，或板子 404，判 expired；接口报错或 URL 里没有 ID 判 uncertain（不拦）。同一批里同一家公司只请求一次，复用 `sourcing/ashby_board_api.fetchJobs` | `shared/liveness_gate.mjs` |
| 4 demo:check | `29e6147` | preflight 和 demo_check 结尾的 `process.exit` 改成 `process.exitCode`，让 stdout 排空；demo:check 读不懂 preflight 输出时新增失败项 `supervisor_preflight_output_readable`，`ready_rows` 记 null，不再记 0 | `shared/supervisor_preflight.mjs`、`scripts/demo_check.mjs` |

实地复验（全部在 scratchpad 的家目录拷贝上跑，真实 `~/.mrweirdo-jobs/jobs.db` 前后 mtime/size 都是 1782006129 / 1728512，没有变）：
- 第 2 项 [实测]：真实库拷贝跑 `liveness_gate --batch`，结果 expired 16 / live 3。**8 条 Ashby 全部判 expired**（修之前全判 bot_challenge）。抽查 julius / pebl / lambda / mubi 四块板子，都不是空板（4 / 30 / 90 / 2 条）；再拿 lambda 板上一条现役岗位去问，判 live。
- 第 4 项 [实测]：同一份家目录拷贝，修之前 `demo:check` 显示「ready rows: 0」，修之后显示「ready rows: 18 / eligible 215」，和 bug 报告直接跑 preflight 得到的 18 一致。
- 第 1 项 [实测，只读]：真实 jobs.db 的 feedback 表 292 行里，含 `"answers"` 的 0 行，不需要清理历史数据。

## TDD 落地证据

每项都是先写测试、跑红、确认红的原因对，再改代码转绿。

- 第 1 项：V8 测试里原来写的是 `void feedback`，改成反向断言，再加一条「四条出库路径」测试，覆盖没投成、重复、状态已变、进人工清单。**红**：`answers must not land in the feedback table` 和 `...manual-review file`。**绿**：17/17（ledger + record 契约 + cover letter 三套件）。
- 第 3 项：驱动替身跑出货的 `main()`，两条场景（表单加载超时用假时钟推进；CDP 上传失败），再加一条源码守卫（三个驱动都不许 `console.log(JSON.stringify({outcome:`）。**红**：`main() finished without emitting an outcome`，守卫命中 2 处。**绿**：19/19。
- 第 2 项：夹具 `test/fixtures/ashby_board_synthesia.json` 是真实接口只读 GET 后裁剪的 3 条；测试全程用替身 fetch，不走网络。一共 4 条：病根重现（Ashby HTML 判 bot_challenge）、live/expired/404、问不到时判 uncertain、`runLivenessGate` 集成（同一公司只请求一次，Ashby 页面不再用 HTML 探测，expired 写进库）。**红**：模块里没有 `checkAshbyPosting`。**绿**：8/8。
- 第 4 项：走真实 CLI 和真实管道，共 3 条：preflight 输出超过 64KB 仍能完整解析；demo:check 的 ready_rows 等于 preflight 队列条数；preflight 输出截断时，demo:check 这项必须失败，ready_rows 为 null。**红**（macOS）：`stdout truncated at 65536 bytes`、`unknown is not zero`。**绿**：3/3。注意：Linux 管道是同步写，第一条在 Linux CI 上改前改后都会是绿的，只有 macOS 能先红。
- 全量：`npm test` 从 **325/325 → 336/336**（新增 11 条）。项目没有覆盖率工具，本轮没有覆盖率数字，这里如实写明没有测。

## 自审记录

- 第 1 项：`auditOutcome` 在账本落行之后才派生，账本拿到的仍是完整 answers（测试断言了这一点）。只剥顶层的 `answers`；契约规定 answers 只挂在顶层，如果驱动把答案塞进 `detail` 之类的嵌套字段，这里挡不住 [读码]。
- 第 2 项：接口出错返回 uncertain，符合「不能把自己看不见当成岗位死了」。boardCache 缓存的是 Promise，同一批里多行并发也只请求一次。
- 第 4 项：拿本地假 CDP 服务（keep-alive 开 60 秒）测过，改成 `exitCode` 之后进程不会被挂住：8.05 秒 vs CDP 端口关着时 8.03 秒 [实测]。
- 本轮改动 grep 空 catch，新增 0 处。

## 偏离 DESIGN

- 第 3 项的结局词是我定的：「表单没加载出来」归 `crashed`，没有选 bug 报告里提的 `not_submitted`/`unknown`。理由：契约里 `not_submitted` 的含义是「页面明确说没交上」，`unknown` 是「判了但读不懂」；表单没加载出来说明机器根本没走到表单，属于「机器故障」。死岗现在已经在存活检查这一步被拦下，走到这里的多半是选择器坏了或网络问题，应该报出来。取舍：如果真遇到刚刚下架的岗位，会被报成 crashed，批次汇总里显示成红色，是一次假警报。
- 产物文件名按钩子要求用了 `_BUILD_NOTES.md`，没有用派遣单写的 `_BUILD.md`。
- 其余照 DESIGN §14 统一退出契约和唯一账本设计实现，没有偏离。

## 发现的旧 bug

以下都**没有修**，放进待解，交 lead 决定：
1. **supervisor_preflight 很慢** [实测]：600 行的库一次要 36 秒，30 行要 3 秒左右。行数上去以后「即找即投」每次运行都会被它拖慢。建议派 bug 查原因。
2. **Ashby 接口请求没有超时** [读码]：`ashby_board_api.fetchRaw` 的 fetch 没带超时，接口挂住会卡住整个存活检查。
3. **posting API 可能不返回「未公开列出」的岗位** [猜]：这类岗位只能靠直链进入，会被误判为 expired。今天实测到的返回里 `isListed` 全部是 true，没法证实也没法证伪。
4. bug 报告提过 `apply_gap_report.test.mjs` 里还有大量 `outcome:'skip'` 夹具，下游缺口报告可能还在按旧词分类。本轮没有深挖。

## 遗留事项

- **第 3 项的真表单行为没有验证**：这几项修复都只在替身和拷贝上跑过，GH/Ashby 驱动 6/15 以后一次真表单都没跑过（bug 报告 F4），要在拍板人在场时小样本试投才能闭环。
- **第 4 项的第一条测试在 Linux CI 上起不到保护作用**：管道同步写，重现不了。
- 旧 bug 1-3 需要 lead 决定「放待解还是一起做」。
- 拍板人还欠一个决定：jobs.db 要不要进 `PII_TARGETS`，目前是 644 权限（第 7 轮验收提出，本轮不涉及）。
- TASK 档案这一轮我没写（并行成员也在写，避免互相覆盖），请 lead 把本轮小结写进去。

## 性能硬指标自查

- 本包不涉及端点，p95 不适用。
- 存活检查：Ashby 行由每行一次 HTML GET 改成每家公司一次 API GET（接口模块自带每秒 1 次限速）。同一公司多个岗位时请求数下降。
- 覆盖率：项目没有覆盖率工具，没有数字，未达「贴真实数字」的要求，如实列出。

## API 接口 8 契约自查

本包不新增、不修改任何 HTTP 端点。只新增了一处对外只读调用（Ashby 公开 posting API 的 GET，无鉴权），不适用 8 契约。

## 本项目铁律对照

- 测试必须串行：全量用 `npm test`（`--test-concurrency=1`）✓
- 交活前 CI 每一步本地全绿 [实测]：① `npm test` exit 0，336/336 ② `node scripts/role_guard_smoke.mjs` exit 0 ③ `node scripts/public_alpha_gate.mjs` exit 0 ④ shared+scripts 全部 `node --check` exit 0 ✓
- 主流程冒烟（ci_smoke.main_chain）：本包涉及「大批量一键投递」前面的存活检查和记账两个环节，已在真实库拷贝上跑通存活检查和 demo:check；投递本身不能真跑（禁止真投递）。

## 交付自查清单

- [x] TDD：四项都是先红后绿，红的原因已核对
- [x] 全绿 336/336；CI 四步本地全过
- [ ] 覆盖率 ≥80%：项目没有覆盖率工具，没有测
- [x] 没有压异常的空 catch，生产代码里没有 mock
- [x] 偏离已标注（第 3 项的结局词、产物文件名）
- [x] 没有顺手修旧 bug，旧 bug 列在上面待解
- [x] 真实 `~/.mrweirdo-jobs/` 没有被写（mtime/size 前后一致）；没有真投递
- [x] CHANGELOG 顶部加了四条
- [x] 没有 push

## 试过的错误方向

1. **第 4 项的「读不懂」测试，一开始想用损坏的 jobs.db 或坏掉的 search_intent 把 preflight 弄出非 JSON 输出**：结果 preflight 两种情况都能优雅降级，照样输出合法 JSON（ok:false、queue:[]），造不出截断。改成复制出货的 demo_check.mjs 到临时仓库根目录，放一个只输出半截 JSON 的替身 preflight。
2. **第 4 项的测试夹具一开始用 600 行**：确实超过了 64KB，但 preflight 每次要跑 36 秒，3 条测试加起来超过 1 分钟。改成 30 行、每行加长字段，输出同样超过 64KB，每次约 3 秒（附带发现了旧 bug 1）。
3. **第 2 项考虑过把 bot_challenge 加进拦截名单**（bug 报告也否掉了这个方向）：这样活的 Ashby 岗也会被一刀切掉，等于停掉整个平台。没有采用。

---

# 第 2 次召唤：即找即投 S1 + S2（2026-09-25）

> 按 DESIGN 第 2 轮 §10「建议第 1 次召唤 = S1+S2」施工。未 push。真实 `~/.mrweirdo-jobs/` 零写入：`jobs.db` 前后 mtime/size 都是 1782006129 / 1728512，`log/` 下仍没有 `submissions.jsonl`，`locks/` 为空 [实测]。所有真实数据验证都在 scratchpad 里的库拷贝上做。

## 实现摘要（S1+S2）

9 个代码提交，另 1 个文档提交（本记录 + CHANGELOG）。生产代码 +约 620 行，测试 +约 960 行；两个超档驱动净增 0（1149 / 1894 行不变）。

| 设计项 | 提交 | 改了什么 |
|---|---|---|
| S1-5 essay 日志隐私 | `07abffd` | GH/Ashby `logEssayPending` 写入时去掉 `answers`（各 1 行）；`PII_TARGETS` 加 `essay_pending.jsonl` |
| S1-6/7 Ashby 接口 | `98883a8` | 板 404 才返回 `[]`，200 但没有 `jobs` 数组 throw `ashby_unexpected_shape` → 存活检查判 uncertain；每次请求 15 秒超时（`FETCH_TIMEOUT_MS`） |
| S1-1 岗位指纹 | `5eecbfd` | `jobFingerprint(url)` 四条规则 + `companyTitleKey()` |
| S1-3 推导 + S1-4 出口核对 | `e6e7b9e` | `driver_contract.PRE_SUBMIT_EXITS`（8 个出口）+ `PRE_DISPATCH_STAGE` + `deriveMayHaveSubmitted()` |
| S1-2 字段 + S1-3 记账人 | `2e89862` | 账本 `append` 要求 `apply_url` 推得出指纹、`may_have_submitted` 为布尔；同 job_id 换链接响亮报错；`maxJobId()`；记账人写这两个字段 |
| S1-2 历史迁入 | `f793114` | `backfillLegacy()` + CLI `backfill-legacy [--apply]`，默认 dry-run，幂等，写完当场核数 |
| S2 投前闸 | `652afbc` | 新模块 `shared/apply_guard.mjs`（183 行）：`attemptIndex` / `checkDispatch` 规则 1-5 / `dailyTier` / `budgetLine` / `preSubmitFailCount` / `priorApplicationToCompany` / `breaker` / 在途标记读写清；账本抽出 `effectiveEntries` |
| S2 投后查重 → 不变量 | `a0b7359` | 记账人不再把真实提交标成跳过：读账本发现重投 → 账本照记、库标已投、feedback 记 `invariant_violation_reapplied`、exit 1 |
| S2 apply_batch 接线 | `22bc56e` | 开跑读档位出第一行；每行派单前现读账本过闸；在途标记写/清/开跑恢复；记账失败即停批；熔断；校验失败行带 `stage=pre_dispatch`；停写 `daily_count.jsonl` |

DESIGN 子任务进度：S1 七项全部完成；S2 除「`not_submitted:job_unavailable` 写看过记录 `expired`」和规则 6（needs_info）外完成，这两处依赖 S3 的 `seen_log`，见偏离段。

**沙箱真实数据复验** [实测]：真实岗位库拷贝上 `jobFingerprint` 950/950 可推、零重复指纹；`backfill-legacy` dry-run 计划迁入 182 条已投 + 33 条驱动跑过的跳过行，另 28 条不迁（24 条纯去重、3 条 `not_retry_for_demo_*` 无 feedback、1 条 `job_unavailable_closed` 无 feedback），推不出指纹 0 条；拷贝上 `--apply` 追加 215 行，核数 `{ok:true, submitted_in_db:182, legacy_unverified_in_ledger:182, fingerprints_match:true}`，重跑追加 0，账本 600。

## TDD 落地证据（S1+S2）

每项都是先写测试、跑红、确认红的原因对，再实现转绿。

- 第 5 项：`essay_pending_privacy.test.mjs`（4 条，走出货驱动源码 harness）。**红**：`answers must not be written to essay_pending.jsonl` ×2、`PII_TARGETS` 不含。**绿** 4/4。
- 第 6/7 项：`ashby_board_api_shape.test.mjs`（9 条）。**红**：3 种错形状没 throw、存活检查判 expired；挂起用例一直挂到 60 秒被取消（正是 bug 本身）。**绿** 9/9，挂起用例约 3 秒。
- 第 1 项：`job_fingerprint.test.mjs`（7 条）。**红**：模块没有导出。**绿** 7/7。
- 第 3/4 项：`pre_submit_derivation.test.mjs`（8 条，含「出口表每行都真在某个驱动出口上」源码守卫）。**红**：没有导出。**绿** 8/8。
- 第 2 项字段：`submission_ledger.test.mjs` 新增 4 条（身份字段、行号不变量、maxJobId、点提交前出口记 false）。**红**：没有 `maxJobId` 导出。**绿**。
- 第 2 项迁入：`ledger_backfill.test.mjs`（5 条）。**红**：没有 `backfillLegacy`。**绿** 5/5。另外真实数据 dry-run 抓到第一版判定只认出 15 条（见试过的错误方向 1），夹具随即改成截断 detail，再改实现。
- S2 闸：`apply_guard.test.mjs`（16 条，每条规则一正一反）。**红**：模块不存在。**绿** 16/16。
- S2 不变量：`submission_ledger.test.mjs` 新增 2 条 + 改 P2 ②。**红**：重投时 exit 0。**绿**。
- S2 接线：`apply_batch_guard.test.mjs`（8 条：V4 V5 V6 V9 V10、档位确认、熔断、现读账本）+ `inflight_recovery.test.mjs`（5 条）。真 `apply_batch` + 真记账人 + 真账本，只替换驱动和外围步骤（`test/apply_batch_harness.mjs`）。**红**：8/8、5/5 全红（V9 实际派了 3 次等）。**绿** 13/13。
- 全量：`npm test` **336 → 404**（新增 68 条，0 fail）。项目没有覆盖率工具，没有覆盖率数字，如实写明没有测。

## 自审记录（S1+S2）

- 「投过」口径全仓只有 `isAttempted`（apply_guard）一份，推导只在 `deriveMayHaveSubmitted` 一处；记账人、投前闸、投后不变量都调它们，没有第二份规则。
- 账本缺 `may_have_submitted` 的行会让 `attemptIndex` 响亮报错，不当成 false 放过。
- 派单路径上推不出指纹 → `checkDispatch` throw（设计：null = bug）。
- 本轮新增 catch 只有一处：`dailyTier` 报错时打印并 exit 1，不压异常。`backfill` 判「驱动跑过」用前缀匹配，没有 try/catch。
- 每行派单前现读账本，一年约 4000 行时的耗时没有实测，沿用设计的推断。

## 偏离 DESIGN（S1+S2，均未擅改设计意图，申报给 lead / architect）

1. **推导规则第 4 条改成「表外一律 true」**。设计 §3 规则 4 写「needs_user / captcha_blocked / rate_limited → false」，同一节又写「出口表外的一律算 true」，两句互相矛盾。未明点 7 逐个核对的结果：GH/Ashby 所有 `needs_user` / `rate_limited` 出口都在第一次 `submitAndCheck` 之后；GH 的 `needs_user` reason 由 `classifyUnsubmitted` 动态生成；Lever 点击前的 `needs_user:cover_letter_required_not_generated` 与 GH 点击后的同名键撞车（键里没有平台）。按 lead 裁决「拿不准按可能已提交」，实现为表外一律 true，Lever 的 needs_user / captcha 点击前出口不入表（Lever 暂停中）。**后果要拍板人知道**：GH/Ashby 卡在缺信息、essay_pending 的岗位算「投过」，占今日额度和同公司 60 天名额，补完信息后流水线也不会再投它（essay_pending 的旧流程是主 agent 在原标签页里补答后直接重跑驱动，不经 apply_batch，不受影响）。
2. **新增 `stage: 'pre_dispatch'` 标记（设计没有）**。`apply_batch` 派单前校验没过时会合成一行 `needs_user` 记账，驱动根本没启动。按第 1 条规则它会被判 true，结果「分数不够」这种行也会吃掉当日额度。所以合成行加了 `stage`，推导第一条判 false。
3. **点提交前重试上限的常量语义**：`PRE_SUBMIT_RETRIES_60D = 1` 表示「失败后 60 天内还允许再试几次」，失败次数 > 它就拦，效果和设计的「满 2 次拦」一样。之所以不定义成「最多失败几次」，是因为那种写法改成 0 会连一次都不让试。若拍板人否决重试，改成 0 的效果是「失败一次后 60 天内不再试」；如果他要的是「永不再试」，需要改的是清空 `PRE_SUBMIT_EXITS`，不是这个常量。
4. **S2 两处推迟到 S3**：`not_submitted:job_unavailable` 写看过记录 `expired`，以及规则 6（needs_info 且填表依据没变）。两处都要用 `seen_log.mjs`，设计把它放在 S3 的新建文件里。
5. **崩溃恢复放在 `apply_batch` 开跑时**（设计写在 `stream_run start`，那是 S3）。原因：S2 起 apply_batch 只认账本拦重投，残留的在途尝试如果不先补记，就可能被再投一次。S3 的 `stream_run` 可以直接复用这段逻辑。
6. **S2 没删 dedupe / recompute 两步，也没改 `limitRows` 预截断**：这两件事要和一次性工作库一起做（设计 1.3 表），现在删掉，全局岗位库上就没有去重了。因此在 S3 之前，闸拦下的行仍会占 `--max` 名额，一批实际派出的可能少于 `--max`。
7. **账本 `append` 对 legacy 行也要求推得出指纹**：设计只写了 v2 行。收紧的理由是去重只认账本，一条推不出指纹的历史行等于没迁。真实数据 182/182 都推得出，所以没有实际影响。
8. 投后不变量只看账本，不再查 jobs.db。在拍板人点头、lead 跑 `--apply` 之前，账本里没有历史，历史重复靠 `validate_auto_row` 的库内查重兜着（它仍在派单前生效）。

## 发现的旧 bug（S1+S2，没修，列出待决）

1. `record_apply_outcome` 的 `row_status_changed_before_recording` 分支会把一次真实提交标成「跳过」（行状态在投递期间被改时）。这个分支在投后不变量之前，所以这种情况下重投不会报警 [读码]。
2. `score_prompt.md` 的输入里有「`feedback.jsonl` 最近 20 条」，这是一个一直在变的输入。S3 的 `scoringBasisVersion` 如果把它算进去，每次运行都会让「不合适」作废；如果不算，打分依据变化就漏记了。需要 architect 定。
3. 两个 `-auto` SKILL.md 里还写着「追加 `daily_count.jsonl`」，按设计放在 S5 删。

## 未明点核对结论（lead 指派）

- **未明点 5（打分读不读 profile.json）** [读码 `shared/scoring/score_prompt.md:6-26`]：不读。打分输入只有三样：`search_intent.json`（签证相关的 `user_summary.work_authorization` / `needs_sponsorship` 也在这份文件里）、`~/.mrweirdo-jobs/feedback.jsonl` 最近 20 条、本批岗位。`skills_match` 提到「简历技能」，简历信息通过 search_intent 带进来（主 agent 上下文里可能也有简历）。结论：回答身份问题（写 profile.json）不会让「不合适」作废；但 feedback.jsonl 这一项见旧 bug 2。
- **未明点 7（点击前还是点击后）** [读码]：GH `greenhouse_apply_driver.mjs:1771-1888`、Ashby `ashby_apply_driver.mjs:1038-1143` 所有 `needs_user`、`rate_limited` 出口都在第一次 `submitAndCheck` 之后 → 可能已提交（true）；GH/Ashby 没有 `captcha_blocked` 出口。Lever `lever_apply_driver.mjs:361-461` 的 `needs_user:resume_missing / cover_letter_required_not_generated / incomplete_form / visible_validation_error` 和 `captcha_blocked:captcha_detected` 都在点击前，但因为键撞车没有入表，按 true 保守处理（Lever 暂停中）。`crashed:driver_exception` 仍然是 true（未明点 13）。
- **未明点 4（历史 61 条跳过）**：按裁决只迁驱动真跑过的。判定依据是 feedback 表里该行至少有一条 detail 以 `{"outcome":"` 开头，也就是驱动自己吐出的结局对象。沙箱拷贝上迁 33 条、不迁 28 条，清单在 dry-run 输出的 `attempts.rows` / `not_migrated` 里，**请 lead 在对真实家目录 `--apply` 前先跑 dry-run 过目**。注意 33 条里有 1 条 `ashby_form_not_loaded`（点提交前），按设计也记成 true、永不重投。
- **未明点 12**：常量已单一化，见偏离第 3 条。

## 遗留事项（S1+S2）

- **`backfill-legacy --apply` 没有对真实家目录跑**（按派遣单）。lead 在拍板人点头后执行：`MRWEIRDO_HOME=~/.mrweirdo-jobs node shared/submission_ledger.mjs backfill-legacy` 先看计划，再加 `--apply`；输出里 `verify.ok` 必须是 true。
- **在拍板人点头、lead 跑完迁入之前，不要真跑 apply_batch**：去重闸只认账本，账本没有历史时只剩 `validate_auto_row` 的库内查重兜底，60 天同公司规则也看不到历史。
- 偏离 1 的产品后果（缺信息的岗位算「投过」）需要拍板人知道；如果不接受，就需要让驱动在点提交前后各带一个标记（两个都是超档文件，要等拆分）。
- 偏离 4、5、6 移交 S3；旧 bug 1-3 交 lead 决定放待解还是一起做。
- 真表单行为仍然没有验证：本轮都是替身驱动。首批试投时顺便统计 `driver_exception` 和 `recovered_inflight` 出现的次数。

## 性能硬指标自查（S1+S2）

- 不涉及 HTTP 端点，p95 不适用。
- 每行派单前全量读一次账本：沙箱 215 行时单测整批耗时里看不出差别，没有单独计时；一年 4000 行的量级沿用设计推断（<10ms），**没有实测**。
- Ashby 接口单块板最坏由约 10 分钟降到 15 秒 ×2 + 2 秒退避。
- 覆盖率：项目没有覆盖率工具，没有数字。

## API 接口 8 契约自查（S1+S2）

本轮不新增、不修改任何 HTTP 端点，不适用。对外只读调用仍只有 Ashby 公开 posting API（新增超时）。

## 本项目铁律对照（S1+S2）

- 测试串行：`npm test`（`--test-concurrency=1`）✓；新测试全部用临时 `MRWEIRDO_HOME`。
- CI 每一步本地跑 [实测，提交 `22bc56e` 之上]：① `npm test` exit 0，404/404 ② `node scripts/role_guard_smoke.mjs` exit 0 ③ `node scripts/public_alpha_gate.mjs` exit 0 ④ shared + scripts 全部 `node --check` exit 0 ✓
- 主流程冒烟（找岗 → 投递 → 报告）：投递段用真 apply_batch + 替身驱动跑通（`apply_batch_guard` / `inflight_recovery`）；不能真投。

## 交付自查清单（S1+S2）

- [x] TDD：每项先红后绿，红的原因已核对（3 处红因不对的已修正测试，见下）
- [x] 全绿 404/404；CI 四步本地全过
- [ ] 覆盖率 ≥80%：项目没有覆盖率工具，没有测
- [x] 没有压异常的空 catch；生产代码里没有 mock
- [x] 偏离 8 条全部标注；旧 bug 只列不修
- [x] 账本字段名与设计逐字一致：`apply_url`、`may_have_submitted`、`era`、`verdict`、`outcome`
- [x] 真实 `~/.mrweirdo-jobs/` 零写入；没有真投递；没有 push
- [x] 两个超档驱动净增 0
- [x] CHANGELOG 顶部 Fixed 段加了五条

## 试过的错误方向（S1+S2）

1. **迁入时用 `JSON.parse(feedback.detail)` 判断「驱动跑过」**：夹具全绿，但真实数据拷贝上只认出 15 条。原因是漏斗当年把 detail 截断到 600 字加「...」，长的驱动结局都不是合法 JSON 了。改成匹配前缀 `{"outcome":"` 后认出 33 条，夹具也改成截断后的 detail。
2. **harness 里「第 2 次运行重新找到同一岗位」一开始往同一个 jobs.db 插同链接的新行**：撞上 `jobs.apply_url` 的 UNIQUE 约束。改成每次运行用一个新库、行号全局递增，正好模拟 S3 的一次性工作库和 `seqFloor`。
3. **Ashby 挂起测试第一版在没实现超时的时候就绿了**：断言写在替身 fetch 里面，抛出的 AssertionError 被 `fetchRaw` 的重试 catch 吞掉，消息里恰好含 abort，匹配上了 `/timeout|abort/`。改成在外面计数，断言 `name: 'TimeoutError'`，再跑一次，确认会一直挂着（红）。
5. **（回炉第 1 轮）偏离 1 按 reason 字符串判点没点提交，这个标准太粗**：verify 实测它会让补信息回路断掉。改为看页面证据：needs_user / rate_limited 带非空 missing / still_missing / last_missing（页面列出了必填项错误）判 false，没有证据的仍然 true。提交 `5284ff5`；隐私 P2 的修复是 `180a640`。

> **回炉第 1 轮（2026-09-25）**：`5284ff5` 修了 verify 第 2 轮 P1。新加两条红测试：一条走「补信息 → retry_gap_rows 放回 → 投前闸放行投成」，一条是「10 家全卡缺信息，第 11 家照投」。`180a640` 修了 P2：job_report 先剥掉 answers；reports/jobs 锁成 600/700，并加进 PII_TARGETS。Lever 的 fill/answer_pass 仍可能带值，Lever 暂停中，没有处理。测试 404→409，CI 四步 exit 0。**在 S3 落地「缺信息且档案没变就拦」（规则 6）并启用一次性工作库之前，不得真跑 apply_batch 放量**：页面拒收判 false 以后，同一个缺信息的岗位在工作库模式下每次运行都会被重派；在现在的全局库里，只有 retry_gap_rows 会把它放回队列。

4. **推导规则照设计原文实现「needs_user / captcha / rate_limited 缺省 false，点击后的列一张表改 true」**：GH 的 needs_user reason 是动态生成的，列不全；漏列一个就会判 false，岗位被重投。这是危险方向，所以否决，改成「表外一律 true」（偏离 1）。
