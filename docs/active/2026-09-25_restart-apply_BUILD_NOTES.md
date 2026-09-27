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
  - （第 3 次召唤）DESIGN 第 2 轮 §3/§4/§7/§10、VERIFY_REPORT 第 2-3 轮挂账（规则 6、P3 slug/锁、P4 跨午夜）
  - （第 4 次召唤 S5）DESIGN §10 S5 行 / §3 / §4 / §7、定稿 docs/specs/restart-apply.md、PRODUCT_SPEC 第 2 轮、VERIFY_REPORT 第 5 轮（RACE / PID 复用）
Blocks: restart-apply 小修包的 verify 验收；S1+S2 的 verify 验收；S3+S4 的 verify 验收；S5 的 verify 验收；lead 对真实家目录跑 backfill-legacy --apply 与 retire_jobs_db --apply
Updated: 2026-09-26
Iterations: 6
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

---

# 第 3 次召唤：即找即投 S3 + S4（2026-09-25）

> 按 DESIGN 第 2 轮 §10（拆分清单）第 2 次召唤施工。10 个提交 `10d78de`..`e0b763a`，未 push。真实 `~/.mrweirdo-jobs/` 零写入：`jobs.db` 前后 mtime/size 都是 1782006129 / 1728512，`log/` 下仍没有 `submissions.jsonl` / `seen.jsonl`，`run-tmp` 下没有 `stream-*` [实测]。没有真投，没有 push。

## 实现摘要（S3+S4）

生产代码 +约 900 行（新模块 4 个：`stream_run` 465、`seen_log` 189、`inflight_recovery` 65、`watchlist_source` 49），测试 +约 1000 行。greenhouse 驱动 1894 → 1880（净减 14），ashby 驱动 1149 不变。

| 设计项 | 提交 | 改了什么 |
|---|---|---|
| S3 看过记录 | `10d78de` | 新 `shared/seen_log.mjs`：`recordSeen` / `readSeen` / `seenIndex` / `lookupSeen` / `stillSeen` / `compact` / `jdHash` / `scoringBasisVersion` / `fillBasisVersion`。只存 9 个字段（V13），双钥匙（指纹或公司+标题），同键以最后一行为准，60 天压缩（临时文件 + 原子改名，600） |
| S2 推迟项：规则 6 | `cee6e48` | `apply_guard` 抽出 `identityBlock`（规则 2-6），打分前去重闸和投前闸调同一个函数；规则 6 = 上次卡在缺信息、填表依据没变 → `needs_info_unchanged`。`checkDispatch` 必须带 seen 上下文，漏传响亮报错 |
| VERIFY P4 跨午夜 | `cee6e48` | `budgetLine` 记 `started_at`；规则 1 的「本次目标」改数开跑以来的尝试，不再用「今日数 − 快照」 |
| S3 `initRunDb` | `49173b2` | 新建工作库 + 全套表结构，`sqlite_sequence` 预置为 seqFloor（未明点 11：node:sqlite 下实测生效，第一行 = seqFloor+1）；路径已存在就拒绝；文件 600 |
| S3 store 写看过 | `634d1a8` | 打分不合格 → `not_fit`（reason = 不合格原因代码）或 `visa_blocked`（`visa_compatible ≤ 2`），带 JD 指纹和打分依据版本 |
| S3 greenhouse 两处写死路径 | `52ef827` | 「你以前投过我们吗」改调 `apply_guard.priorApplicationToCompany`（问账本）；链接看不出公司时按行号查 `dbPath()`（本次工作库），顺带把 `sqlite3` 命令行换成 `node:sqlite` 只读 |
| S4 名单优先 | `9b3e2b4` | 新 `sourcing/watchlist_source.mjs`；dispatcher 注册 `watchlist`，单家错误经 `reportError` 带 slug 汇进 `errors`；`discover_candidates` 把 search_intent 传给来源；`intent_schema` 加可选 `target_companies`；预置名单 `sourcing/data/watchlist_ai_video.json`（21 家） |
| S3 apply_batch 接线 | `efcf38d` | `--stream-run <id>` 流式模式；陈旧锁自动接管（VERIFY P3）；崩溃恢复抽成 `shared/inflight_recovery.mjs`（apply_batch 和 stream_run 共用）；supervisor 转发 `--stream-run` / `--confirm-tier-over-30` |
| S3 状态机 | `d8ff260` | 新 `shared/stream_run.mjs`：`start` / `next` / `submit-scores` / `finish`，含 `pre_submit_fail_cap`、下架与缺信息写看过、历史前置检查、崩溃恢复、3 行报告、删运行目录 |
| 沙箱试跑发现的问题 | `e0b763a` | 还有没打分的新岗就收工时，报告不再说成「没有新岗」 |

**名单 slug 实测**（公开接口只读 GET，2026-09-25）：22 家里 **21 家可用**（Ashby 17：runway、lumaai、synthesia、elevenlabs、higgsfieldai、mirage、pika、suno、hedra、tavus、genmo、creatify、opusclip、krea、ideogram、viggle、black-forest-labs；Greenhouse 4：heygen、descript、stabilityai、lightricks），岗位链接 100% 推得出指纹。跳过：Kapwing（Lever，暂停中）；Captions / VEED / InVideo / D-ID / Arcads / Moonvalley 在两个平台都 404。试过但 404 的写法都记在文件 `_meta` 里（如 `higgsfield`、`luma-ai`、`blackforestlabs`）。

**沙箱真实数据试跑** [实测，真实家目录拷贝，跑完已删]：
1. 没迁历史时 `start` 拒绝开跑，提示先跑 `backfill-legacy`；
2. 拷贝上 `backfill-legacy --apply` 核数 `{ok:true, submitted_in_db:182, legacy_unverified_in_ledger:182, fingerprints_match:true}`；
3. 把 21 家名单写进拷贝的 search_intent，`start --target 2 --no-submit --max-windows 0` → `next`：21 块板 19 秒扫完、0 个错误，过硬过滤后 6 个候选，**1 个被历史账本拦下（already_attempted_fp）**，5 个进第一批；
4. 直接 `finish` 暴露了报告误说「没有新岗」，已修（`e0b763a`）。

## TDD 落地证据（S3+S4）

每一步都先写测试、跑红、确认红的原因对，再实现转绿。

- `seen_log.test.mjs`（9 条）。**红**：模块不存在（`ERR_MODULE_NOT_FOUND`）。**绿** 9/9。说明：这一步的实现写在跑红之前，红是事后把模块挪开跑出来的，如实写明。
- `apply_guard.test.mjs` 新增 3 条（规则 1 按开跑以来计数、跨午夜、规则 6），另把全部调用补上 seen 上下文。**红**：没有 `identityBlock` 导出。**绿** 18/18。
- `init_run_db.test.mjs`（2 条）。**红**：没有 `initRunDb` 导出。**绿** 2/2。
- `store_scored_seen.test.mjs`（1 条）。**红**：看过记录为空（`actual: []`）。**绿**。实现后 `usable_apply_url.test.mjs` 1 条转红：夹具的 Ashby 链接不是 UUID、推不出指纹，`recordSeen` 抛错。改成「推不出指纹不写、计数 `seen_unrecordable` 并在进度里响亮打出」，见偏离 9。
- `greenhouse_driver_paths.test.mjs`（3 条，走出货驱动源码 harness）。**红**：3 条都按预期错（账本有历史答 No、只有 jobs.db 有答 Yes、公司查成 `wrong-co`）。**绿** 3/3。
- `watchlist_source.test.mjs`（5 条，含 dispatcher 真板接口模块 + 替身 fetch、`discover_candidates --sources watchlist` 真 CLI + `--import` 预载替身 fetch、预置名单形状）。**红**：模块不存在。**绿** 5/5。
- `apply_batch_stream.test.mjs`（4 条）。**红** 3/4：流式模式下拦下的行仍占名额（驱动 0 次）、缺省 jobs.db 没拒绝、陈旧锁拒绝开跑。**绿** 4/4。
- `stream_run_e2e.test.mjs`（13 条）。**红**：模块不存在。第一次实现后 3 条红，原因见试过的错误方向 1、2。**绿** 13/13。
- **V1 硬指标测试结果**：假板 30 岗（8 合适）、N=10 连跑两次。第 1 次打分 30、驱动 8、账本 8 行，报告「投出 8 个 … / 看了 30 个新岗，合适的只有 8 个，没凑到 10 个」；第 2 次**打分器 0 次、驱动 0 次、账本仍 8 行**，报告「没有新岗」，打分前被拦的明细是 `already_attempted_fp` 8 + `seen_not_fit` 22；轮转窗口第 1 次 offset 0、第 2 次 offset 1000。
- 全量：`npm test` **409 → 448**（新增 39 条，0 fail）。项目没有覆盖率工具，没有覆盖率数字。

## 自审记录（S3+S4）

- 「投过」仍只有 `isAttempted` 一份；打分前去重闸和投前闸共用 `identityBlock`，规则 6 只有一处实现。
- 本次运行的计数（已尝试、点提交前失败）每批之后从账本重算，不做累加，重复调用不会多数。
- 看过记录只存 9 个字段，e2e 用暗号断言 JD 正文和表单答案都不进文件（V13）；跑完家目录只多 `log/seen.jsonl`、`log/submissions.jsonl`、`source_cursor.json` 三个文件，运行目录删干净（V12）。
- 新增 catch 两处，都有注释、都不压异常：陈旧锁读不懂就不接管、交给原来的 `wx` 打开去响亮拒绝；崩溃恢复里判断日志行是不是 JSON。
- 派单路径和打分前去重闸上推不出指纹都响亮报错；只有 store 写看过记录这一处推不出指纹时降级为「计数 + 进度警告」，理由是看过记录只是记忆，缺一行只多花打分钱，不会重投。

## 偏离 DESIGN（S3+S4，均申报，未擅改设计意图）

1. **下架（expired）和缺信息（needs_info）的看过记录由 `stream_run` 在每批投完后写**，设计写的是 `apply_batch` 写。原因：`expired` 需要 JD 指纹，JD 正文只在本批的批次文件里，工作库的 jobs 表没有正文列，加列就要改表结构。后果：旧流程（不经 stream_run 直接跑 apply_batch）不写这两类记录，规则 6 只在流式运行里生效；旧流程的「补信息再投」回路本来就靠 retry_gap_rows，不受影响。
2. **没有加 `--no-cursor-advance`**。`discover_candidates` 现有语义是「显式给 offset 就不动游标」，stream_run 轮转时显式传 offset，名单扫描传 `--source-window-size 0`；游标由 stream_run 在 `finish` 时写：窗口里的候选都用完了就挪到下一窗，还有剩下就停在本窗，下次接着看。
3. **`initRunDb({ path, seqFloor })` 多了显式 `path`**（设计写 `{ seqFloor }`），路径已存在就拒绝。`seqFloor = max(账本最大 job_id, 100000)` 由 stream_run 算。
4. **`checkDispatch(job, idx, budget, now, seen)` 多一个必填参数**，并抽出 `identityBlock`；`budgetLine` 返回值多 `started_at`（VERIFY P4 的修法）。
5. **apply_batch 流式模式另外跳过了三样会把分数留在家目录的报告**：`job_report`（`reports/jobs/*.md`，含分数和差距）、`apply_report`、队列诊断 HTML。缺口报告保留（它写在运行目录里，随运行删掉）。流式模式也不预截断队列：闸按开跑以来计数，拦下的行不占名额。
6. **VERIFY P3 两条挂账一并做了**：陈旧锁自动接管（`process.kill(pid, 0)` 报 ESRCH 才接管，并响亮说明）；名单来源公司名一律用 slug（和轮转来源同一写法）。
7. **崩溃恢复抽成共享模块**，记账人的输出改写到 stderr（stream_run 的 stdout 只放一个 JSON）。
8. **派单前校验失败的行（`stage=pre_dispatch`）也记成 needs_info**。账本行里没有 `stage` 字段，和页面拒收分不开。后果：这种行要等档案变了才会再看。流式模式下队列只有刚打完分、刚判合格的行，这种情况很少。
9. **store 遇到推不出指纹的链接不写看过记录，计数 `seen_unrecordable`**（见自审最后一条）。
10. **打分依据版本不计入 `feedback.jsonl` 最近 20 条**（派遣单裁定，符合 DESIGN 未明点 5 / ADR 原意：计入的话每次运行都会让「不合适」作废重看）。也没计入 `company_list.user.json`（它只影响 `quota_guarded` 一个原因）。
11. **轮转只扫 `greenhouse_bulk` + `ashby_bulk`**（只有这两个平台能自动投）；「扫完一整圈」缺省 = `ceil(最长名单 / 窗口大小)` 个窗口，`--max-windows` 可覆盖（测试和试跑用）。
12. `held_for_review` 的 7 天规则写进了 `stillSeen`，但本包没有写入方（D10 名单公司投前过目，归 S5）。
13. 预置名单放成数据文件，**不会被自动使用**，要由 S5 的引导步骤写进用户的 `search_intent.target_companies` 才生效（不做静默兜底）。

## 发现的旧 bug / 新观察（S3+S4，没修，列出待决）

1. **真实家目录的 search_intent 还是 6 月方向**：沙箱试跑里 ElevenLabs 的 3 个自由职业翻译 / 配音岗过了硬过滤进入候选。换新简历、重做找岗方向归 S5 / 重新引导。
2. **跑到目标数就停，同批里剩下的合格岗下次会被重新打分**：分数不许过夜（V12），所以这是设计上的代价，只多花钱，不会重投。
3. **一整圈轮转很慢**：Greenhouse 板接口限速每秒 1 次，1000 块板一个窗口约 17 分钟，一整圈 9 个窗口。多数运行会先碰到「投满」或「看满」停下；新岗稀少的日子会很长。建议试投时记下耗时再定窗口大小。
4. 驱动里「投过我们吗」的答题备注还叫 `prior_application_found_in_db`，现在其实是查账本，只是名字过时，不影响行为。
5. **同一天跑两次共用当日档位**：档位 10 时，第 1 次投了 8 个，第 2 次最多再投 2 个，看的上限也跟着变成 20。这符合设计，但拍板人可能会觉得第二次「怎么这么少」，报告第一行会写清楚。

## 遗留事项（S3+S4）

- **放量前置仍有两条**：① lead 在拍板人点头后对真实家目录跑 `backfill-legacy --apply`（stream_run 在那之前会拒绝开跑，已实测）；② S5 编排改写（onboard 第 4-7 步改成 start → next/打分/submit-scores → finish，把名单写进 search_intent，看板改数账本，两份 -auto 说明书删 daily_count 一句，D10 名单公司过目）。
- **规则 6 已落地**：VERIFY 第 2-3 轮挂的「S3 规则 6 落地前不得在工作库模式下放量」这一条的前提已满足，e2e 覆盖了「卡缺信息 → 下次不打分不派 → 补档案 → 重新进候选并投出」。
- 真表单行为仍然没有验证：驱动全是替身。首批试投（拍板人在场）时用 `stream_run start --target 2`，投完立刻用 `--no-submit` 再跑一次做真环境复验。
- `PRE_SUBMIT_RETRIES_60D` 保持单一常量 1，没动，等拍板人确认。
- 旧观察 1-5 交 lead 决定放待解还是一起做。

## 性能硬指标自查（S3+S4）

- 不涉及 HTTP 端点，p95 不适用。
- 名单 21 家实测 19 秒扫完（每秒 1 次限速）。e2e 单次完整运行（30 岗、8 次派单）约 1.5-2 秒。
- 每次打分前去重闸读一次账本和看过记录；每行派单前现读账本和看过记录。一年约 4000 行账本的耗时没有实测，沿用设计推断。
- 覆盖率：项目没有覆盖率工具，没有数字。

## API 接口 8 契约自查（S3+S4）

本轮不新增、不修改任何 HTTP 端点，不适用。对外只读调用仍只有 Ashby / Greenhouse 公开板接口（名单来源复用现有的两个板接口模块，没有新的网络代码）。

## 本项目铁律对照（S3+S4）

- 测试串行：`npm test`（`--test-concurrency=1`）✓；新测试全部用临时家目录，e2e 连 Chrome 都用本进程里的替身 CDP 端点。
- CI 每一步本地跑 [实测，`e0b763a` 之上]：① `npm test` exit 0，448/448 ② `node scripts/role_guard_smoke.mjs` exit 0 ③ `node scripts/public_alpha_gate.mjs` exit 0 ④ shared + scripts 全部 `node --check` exit 0 ✓
- 主流程冒烟（找岗 → 投递 → 报告）：e2e 走真 stream_run → 真 discover 接口约定（替身板）→ 真 store → 真 supervisor → 真 apply_batch → 真队列 / 校验 / 记账人 / 账本 → 3 行报告；另在真实家目录拷贝上跑通了「历史迁入 → 名单真接口扫描 → 去重闸 → 出批次 → 收工」。不能真投。

## 交付自查清单（S3+S4）

- [x] TDD：每步先红后绿，红因已核对（seen_log 一步是事后挪走模块跑红，已如实写明）
- [x] 全绿 448/448；CI 四步本地全过
- [ ] 覆盖率 ≥80%：项目没有覆盖率工具，没有测
- [x] V1 连跑两次端到端离线测试：第二次打分 0、派单 0、账本不增
- [x] 没有压异常的空 catch；生产代码里没有 mock
- [x] 偏离 13 条全部标注；旧观察只列不修
- [x] 两个超档驱动：greenhouse 净减 14，ashby 不变
- [x] `PRE_SUBMIT_RETRIES_60D` 仍是单一常量
- [x] 真实 `~/.mrweirdo-jobs/` 零写入；没有真投递；没有对真实家目录跑 backfill --apply；没有 push
- [x] CHANGELOG 顶部加了 Added 三条、Fixed 两条

## 试过的错误方向（S3+S4）

1. **e2e 的 V2 / V8 一开始按「每次运行都有满额」写期望**：结果第 2 次只投了 2 个、只看了 20 个。原因是同一天的两次运行共用档位 10，第 1 次已经尝试了 8 个。这是正确行为，测试写错了；改成在这两条里把档位设成 25，并在测试里注明原因（也记进了旧观察 5）。
2. **崩溃恢复第一版沿用 apply_batch 的写法，把记账人的输出写到 stdout**：stream_run 的 stdout 约定只放一个 JSON，恢复时多出一行，`start` 的结果解析失败。改成写 stderr。
3. **store 写看过记录第一版对推不出指纹的链接直接抛错**：旧流程的一个测试夹具因此崩溃。整批入库因为一行记忆写不进去而失败，代价不成比例；改成计数并响亮打出。
4. **考虑过让 apply_batch 在流式模式下把闸拦下的行在工作库里标成跳过**，免得下一批又被拦一次。没有做：被拦的行在后续批次里只是被再拦一次，不花钱也不出错，多写一处库状态反而多一个要维护的地方。

> **回炉第 1 轮（S3+S4，verify 第 4 轮 3/5）**：5 个提交 `5af0d81` `e80046e` `033f48f` `8865f00` + 口径测试提交，重投逻辑没动。① 并发（BUG-1）：新增 `locks/stream_run.lock`，从 start 持有到 finish；有没收尾的运行就响亮拒绝开跑，放弃要显式 `--abandon <run_id>`；派单锁的持有进程还活着时一律拒绝（`--abandon` 也不行），不再删对方目录、不再把对方在投的一单补记成可能已提交。先写了 L / X / 放弃三条红测试。② 名单（BUG-2）：`runway` 板是财务规划软件公司 Runway；按官网 runwayml.com/careers 链接改成 `runway-ml`（Ashby 200，44 岗，JD 自述 world models），错的板记进 `_meta.not_found_slugs_tried`。其余 20 家逐家抽岗位标题 + JD 开头的公司自述核对：全部是对的公司（Luma / Synthesia / ElevenLabs / Higgsfield AI / Mirage / Pika / Suno / Hedra / Tavus / Genmo / Creatify / OpusClip / Krea / Ideogram / Viggle / Black Forest Labs / HeyGen / Descript / Stability AI / Lightricks-LTX）。③ 名单板 404（BUG-3）：板接口加 `notFound: 'throw'`，只有名单来源用，404 进 errors、报告第 2 行列公司名；轮转照旧当空板。④ 开跑补记的「可能已提交」（BUG-4）写进第 2 行：「上次中断的运行有 1 家可能已提交：…，永不自动重投，请你核对邮箱或页面」。**lead 裁决（verify Y1）按 B**：不加任何「合格未投」记录（那等于把拍板人否掉的岗位队列重新引进来），合格但没轮到投的岗下次重新打分可以接受；验收口径改为「零重复投递 + 已判不合适的零重复打分」，新增一条 e2e 固定这个口径（第 2 次运行只重打那 5 个合格未投的岗，驱动 6 次、没有重复网址）。这条是刻画测试，写完直接绿，如实说明。测试 448→453，CI 四步 exit 0，真实家目录零写入，未推。

# 第 4 次召唤：即找即投 S5 编排改写 + 退役 + D10 + 运行锁 P3 ×2（2026-09-25）

> 按 DESIGN §10 第 3 次召唤（S5）施工，外加 lead 派遣的 D10 第一版、verify 第 5 轮 P3 ×2、拍板人手投登记。11 个提交 `7a7af88`..`f3e260e`，未 push。真实 `~/.mrweirdo-jobs/` 零写入：`jobs.db` 前后 mtime/size 都是 1782006129 / 1728512，`log/` 下仍无 `submissions.jsonl` / `seen.jsonl`，`locks/` 空，没有 `archive/`，`search_intent.json` mtime 1780932205 未变，`run-tmp` 下无 `stream-*` [实测]。没有真投，没有 push。

## 实现摘要（S5）

| 派遣项 | 提交 | 改了什么 |
|---|---|---|
| verify 第 5 轮 P3 RACE | `7a7af88` | `start` 先建自己的运行目录、再以 O_EXCL 建锁（`claimHome` 抛错由 `start` 删目录后响亮退出）。于是「锁在但目录不在」只可能是已收工或已死的运行，另一个 start 不会再把正在建目录的锁当残留清掉；两个 start 同时抢锁，输的一方给出人话拒绝，不吐堆栈。`cleanOldRuns` 跳过自己的目录；拿锁后任何一步失败都放锁、删目录 |
| verify 第 5 轮 P3 PID 复用 | `7a7af88` | 新 `shared/lock_holder.mjs`（30 行）：派单锁的 pid 活着且命令行是 `apply_batch.mjs` 才算活；活着但命令行不是 → 当陈旧锁、响亮说明后接管；读不到命令行 → 保守当活。拒绝提示里写明 `kill <pid>` 和「ps 看不到 apply_batch 就删哪个锁文件」。`stream_run` 和 `apply_batch` 共用。顺带：运行锁 JSON 坏了说删哪个文件（verify 第 5 轮 P4） |
| D10 第一版 | `0959763` `0af61f9` | `submit-scores` 入库后，本批里来自名单扫描的合格行在工作库里标 `auto_apply_eligible=0, skip_reason='held_for_review'`、写看过记录 `held_for_review`（7 天内不重打不重报），不进派单；第 1 行列「公司·岗位·链接」，第 3 行写明「其中 K 个是名单公司、等你过目」。放行：`start --release <链接>`（可重复）→ 只扫名单、重新打分、合格照常派单；放行的岗没找到 / 被闸拦下，第 2 行写明 |
| 第 6 步交接 | `02ce51e` | `submit-scores` 输出 `gap_report`（本批缺信息报告的路径；运行目录收工即删，技能在 finish 前读） |
| 拍板人手投登记 | `11932cb` | `node shared/submission_ledger.mjs record-manual --url --company --title [--at YYYY-MM-DD] [--apply]` 或 `--file <json 数组>`；默认试跑 |
| preflight 只核本次运行 | `d2d3ccf` | `rebuild(…, { onlyRowsInDb })`，preflight 用它：只核库里有的账本行（工作库 = 本次运行） |
| 看板改数账本 | `961a977` | 「今日已尝试 N/档位」（`attemptIndex().todayCount`）+「已投 N」（新导出 `isSubmitted`：submitted + legacy_unverified）；档位读 `MRWEIRDO_DAILY_TIER`，删 `DAILY_CAP=50`；最近 10 条读账本；删「下一批」队列段 |
| 名单写进 search_intent | `60bcbee` | 新 `shared/install_watchlist.mjs`：默认试跑列出要加的公司；`--apply` 合并写入（用户已有的在前、同 ats+slug 不重复），原子改名、600 |
| jobs.db 退役搬归档 | `42e4728` | 新 `shared/retire_jobs_db.mjs`：先核数（抽出 `legacyCountCheck`，backfill 同用），过了才把 `jobs.db`（连 -wal/-shm）改名搬到 `archive/jobs-legacy-<本地日期>.db`，600 / 目录 700；历史没迁、归档已存在、派单锁或在途标记在 → 拒绝 |
| 编排文档 | `e7c2a3d` | onboard 第 3 步保留身份行 + cover letter 告知、名单只在用户说「要」后 `--apply`；第 4-7 步改为 `start → (next → 打分 → submit-scores)… → finish`，无清单、无 prune、无 retry_gap_rows、无 apply_report；`references/run-and-database.md` 改写；jobskill 同步；两份 `-auto` 说明书改认 stream_run、删 daily_count |
| 变更日志 | `f3e260e` | CHANGELOG Changed ×4、Added ×3、Fixed ×1 |

行数：`stream_run.mjs` 523 → 613，`submission_ledger.mjs` 360 → 461，`apply_batch.mjs` 582 → 588，`dashboard.mjs` 271 → 206，onboard `SKILL.md` 496 → 416；新模块 3 个（lock_holder 30、install_watchlist 61、retire_jobs_db 78）。两个超档驱动没碰。

**沙箱真实数据走查**（真实家目录拷贝到 scratchpad，CDP 指向关闭的端口 9，跑完留在 scratchpad，未触真实家目录）[实测]：
1. 未迁历史 → `start` 拒绝并指向 backfill-legacy；
2. `backfill-legacy` 试跑 182 + 33 → `--apply` 核数 `{ok:true, 182, 182, fingerprints_match:true}`，账本 215 行；
3. `retire_jobs_db` 试跑 → `--apply`：`jobs.db` 搬到 `archive/jobs-legacy-2026-09-25.db`，核数同上；
4. `install_watchlist` 试跑「would add 21」→ `--apply` 共 21 家；
5. `start --target 2 --no-submit --max-windows 0` → `next`：21 块板 602 岗，过滤后 6 个，1 个被历史拦下（already_attempted_fp），5 个进第 1 批 → 全判不合适 → `finish`：「试跑不提交：看了 5 个新岗，合适的 0 个」，运行目录删净、锁已放；
6. 清掉沙箱看过记录，真模式 `start --target 2 --max-windows 0`，把 2 个实习判合格：两个都是名单公司 → 全部 held，**派单进程 0 次**（stderr 无 apply-batch），第 1 行列出 opusclip / pika 两条链接。第 3 行原来写「合适的只有 2 个，没凑到 2 个」，读起来像漏投 → 修成带「其中 2 个是名单公司、等你过目」（`0af61f9`）。

## TDD 落地证据（S5）

- `stream_run_lock.test.mjs`（3 条，新）。**红**：RACE 第 0 轮输家吐 `EEXIST` 堆栈；把旧版 `stream_run.mjs` 换回来、去掉堆栈断言单跑，第 2 轮「两个都开跑」（`got 2`）；PID 复用被拒；活派单进程的拒绝里没有 `kill`。**绿** 3/3。
- `apply_batch_stream.test.mjs` +1 条、改 1 条（活锁改用真实命令行为 `apply_batch.mjs` 的替身进程）。**红**：PID 复用拒绝开跑、拒绝提示无 kill。第一次实现后 PID 用例仍红：测试进程自己的命令行里有 `apply_batch_stream.test.mjs`，子串 `apply_batch` 命中 → 改为匹配 `apply_batch.mjs`。**绿**。
- `stream_run_e2e.test.mjs`：并发 X 改用替身活派单进程（原来用测试进程 pid，新判法下它是「复用」）；「名单优先」断言改为名单岗被 held、驱动 0 次（D10 改变的行为，如实改）；新增 D10 用例（held → 下次不重打不重报 → --release 投出 → 放行链接不存在报「没找到」）**红**：驱动照投名单岗；新增第 3 行 held 说明断言**红**；规则 6 用例加 `gap_report` 断言**红**。**绿** 18/18。
- `ledger_manual.test.mjs`（6 条，新）。**红**：CLI 不认 record-manual（6/6）。**绿** 6/6。
- `preflight_ledger_scope.test.mjs`（2 条，新，走真 preflight CLI）。**红**：历史行和以前运行的行报 `ledger_row_without_db_row`。**绿** 2/2。
- `dashboard_ledger.test.mjs`（2 条，新）。**红** 2/2。**绿** 2/2。`submitted_predicate.test.mjs` 的看板用例移交此文件，源级守卫名单去掉 dashboard（它不再读库）。
- `install_watchlist.test.mjs`（3 条，新）。实现和测试同一步写成，**红是事后把模块挪走跑出来的**（0/3），如实写明。**绿** 3/3。
- `retire_jobs_db.test.mjs`（4 条，新）。**红** 4/4（模块不存在）。**绿** 4/4。
- `onboard_presentation.test.mjs` / `phase3_skill_policy.test.mjs`：文档契约随拍板 D8（说跑即开始）改口径——「回复"开始"执行」queue gate 断言换成「跑 N 个」、四条 stream_run 命令、无 prune / retry_gap_rows / apply_report、`--release`、`record-manual`、身份行保留、名单只在用户说要之后 `--apply`；另加 jobskill 与两份 -auto 说明书的断言。**红** 6 条。**绿**。
- 全量：`npm test` **453 → 477**，0 fail。项目没有覆盖率工具，没有覆盖率数字。

## 自审记录（S5）

- 「投过」仍只有 `isAttempted` 一份；「已投」新增 `isSubmitted` 一份（DESIGN §8 口径），看板两者都只调共享定义。手投登记查重也用 `isAttempted`（`submission_ledger` ↔ `apply_guard` 循环 import，只在调用时用，ESM 下安全，已跑通）。
- held 只改本次运行的工作库和看过记录，不写账本：held 不算投过，不占日额度、不占 60 天名额。
- 新 catch 1 处（apply_batch 拒绝提示里解析锁 JSON 失败 → 用原来的通用提示），有注释，不压异常。
- 真实家目录的所有写入口（backfill / retire / install_watchlist / record-manual）默认试跑，`--apply` 才写，本轮一次都没对真实家目录执行。

## 偏离 DESIGN（S5，均申报）

1. **D10 放行机制 `--release <链接>` 是我定的**（DESIGN 未明点 6 只写「你回 1 以后，照常走驱动」）。放行运行默认只扫名单（`--max-windows` 缺省 0），被放行的岗排第一批最前、重新打分；拍板人只管说「投 + 链接」，由 agent 翻成命令。
2. **held 的合格岗算进第 3 行的「合适」数，并注明其中几个等过目**；第 1 行在「投出」之后接「名单公司 K 个合格、等你过目：公司·岗位·链接」。DESIGN 没规定位置。
3. **`--no-submit` 不 held**（试跑不派单，held 没有意义，也不写看过记录）。
4. **手投登记不在 DESIGN 里，按最小实现**：放在 `submission_ledger` 的 CLI（和 backfill-legacy 同处，改了文件头「唯一写账人」的说明：驱动尝试仍只由 record_apply_outcome 写，历史迁入与手投由账本模块自己的 CLI 写）；verdict 用设计允许的 `submitted`，来源靠 `outcome: manual_submitted` + `reason: reported_by_user` 标出，**没加新字段**；行号接账本最大号（≥100001）；有运行在进行时拒写（防和工作库行号撞）。**代价**：`--at` 缺省是现在，手投登记会算进「今日已尝试」（同一个口径，不开例外）——登记当天的历史手投请带 `--at` 写实际日期。
5. **preflight 一致性检查的做法**：DESIGN 写「只核本次运行的工作库行」，我实现为「只核库里有的账本行」（`onlyRowsInDb`）。工作库行号全局唯一，等价于本次运行；旧流程跑 jobs.db 时也不再被 v2 行误伤。
6. **看板删掉「下一批」队列段**，最近 10 条改读账本（公司、标题用账本里的归一写法，小写）。
7. **第 6 步不再调 retry_gap_rows**：卡缺信息的岗在档案变了之后由规则 6 自动回到候选，技能里只记答案。为此 `submit-scores` 多输出一个 `gap_report` 路径。
8. **第 7 步删掉「48h 后 /mrweirdo-confirm、/mrweirdo-tracker」**：两者读 jobs.db，退役后看不到新运行（DESIGN 未明点 10），不再推荐。
9. **两份 -auto 说明书还顺带注明 stream 模式跳过 job_report 钩子**（S3 偏离 5 的行为，文档补齐）。
10. **install_watchlist 是新 CLI**（DESIGN 只说引导步骤写进 target_companies，没定机制）；写入 search_intent 会改变打分依据版本，之后第一次运行会把以前的「不合适」重看一遍（S3 已知行为），文件头注明。
11. **retire 脚本固定搬 `<家目录>/jobs.db`**，不跟 `MRWEIRDO_DB_PATH`：退役的是缺省历史库，不是某次运行的工作库。
12. 文档契约测试（onboard_presentation / phase3_skill_policy）随拍板 D8 改口径，旧的 queue gate 断言删除。

## 发现的旧 bug / 新观察（S5，没修，列出待决）

1. **真实家目录的 search_intent 还是 6 月方向、简历还是 5 月版**（S3 观察 1 仍在）：沙箱里 ElevenLabs 三个自由职业岗过了硬过滤。首批试投前需要拍板人按新第 1-3 步重新引导（新简历 `/Users/lee/Desktop/Lee_Lin_Resume.pdf`）。
2. `.claude/settings.json` 没有放行 `stream_run.mjs`，所以每一步都会弹权限框——真投的第二道闸仍在，但 `next` / `finish` 也会弹，体验上啰嗦。要不要放行只读的几步，交 lead 决定（我没改设置）。
3. `record_profile_answers --asked-by` 的枚举里还有 `queue_gate`，现在已经没有这个时刻；无害，未改。
4. verify 第 5 轮 P4 的 GAP（放弃一个其实还活着的窗口）与「store 读不到 --to-score 静默 0 条」仍未修。
5. 放行链接的写法：看过记录里存的是招聘板给的链接（Ashby 带 `/application` 后缀）；`--release` 按指纹比对，带不带后缀都认 [实测 `jobFingerprint` 两种写法得同一个 `ashby:<uuid>`；e2e 只用了 GH 链接]。

## 遗留事项（S5）

- **放量前置**：lead 在拍板人点头后按下面「真跑前清单」执行；清单里所有 `--apply` 都是对真实家目录，本轮一次没跑。
- 驱动真表单行为仍未验证（全是替身），首批试投 2 条时拍板人在场。
- `PRE_SUBMIT_RETRIES_60D` 仍是单一常量 1，没动。
- 新观察 1-4 交 lead 决定放待解还是一起做。

### 真跑前清单（lead 在拍板人点头后按顺序执行）

每条前面都先：`export MRWEIRDO_HOME="$HOME/.mrweirdo-jobs"; unset MRWEIRDO_DB_PATH MRWEIRDO_ONBOARD_TMP_DIR; cd /Users/lee/Projects/mrweirdo-jobs`

0. （前置，拍板人在场）按新第 1-3 步重新引导：`bash scripts/intake_resume.sh "/Users/lee/Desktop/Lee_Lin_Resume.pdf"`，重生成 `search_intent.json`，再 `node shared/validate_user_profile.mjs`。
1. 历史迁入试跑：`node shared/submission_ledger.mjs backfill-legacy` —— 预期 stderr「would append 182 legacy_submitted + 33 legacy_attempt」。
2. 迁入：`node shared/submission_ledger.mjs backfill-legacy --apply` —— 预期 `verify: {ok:true, submitted_in_db:182, legacy_unverified_in_ledger:182, fingerprints_match:true}`，`appended: 215`。
3. 核数：`wc -l ~/.mrweirdo-jobs/log/submissions.jsonl`（= 215）；`node shared/retire_jobs_db.mjs`（试跑，`count_check.ok: true`、182/182，列出 `to: …/archive/jobs-legacy-<日期>.db`）。
4. 归档：`node shared/retire_jobs_db.mjs --apply` —— 之后 `ls ~/.mrweirdo-jobs/jobs.db` 应不存在，`ls -l ~/.mrweirdo-jobs/archive/` 有 `jobs-legacy-<日期>.db`（600，大小 1728512）。
5. 拍板人手投过的岗登记（lead 整理成 `[{url,title,at}]` 的 JSON；公司由链接里的招聘板 slug 自动推，写了 company 且对不上会被拒；`at` 只写 `YYYY-MM-DD`）：`node shared/submission_ledger.mjs record-manual --file <list.json>`（试跑核对）→ 同命令加 `--apply`。
6. 名单：`node shared/install_watchlist.mjs`（试跑，would add 21）→ 拍板人说要 → `node shared/install_watchlist.mjs --apply`。
7. Chrome：`bash shared/chrome-cdp-launcher.sh`；体检用一次性探针库（否则会在家目录重建一个空 jobs.db）：`MRWEIRDO_DB_PATH="$(mktemp -d)/probe.db" node shared/supervisor_preflight.mjs` —— 只看 `cdp` 与 `work_authorization_answered` 须 OK；`queue_nonempty` FAIL 是正常的（没有队列）。跑完 `ls ~/.mrweirdo-jobs/jobs.db` 仍应不存在。
8. 不提交试跑：`node shared/stream_run.mjs start --target 2 --no-submit` → 循环 `next --run <id>` / 打分 / `submit-scores --run <id> --batch <k> --scored <file>` → `finish --run <id>`，核对 3 行。
9. 试投 2 条（拍板人在场；名单公司合格的会被 held，所以实际只投非名单公司，符合 D5 首批只投圈 3）：`node shared/stream_run.mjs start --target 2` → 同上循环 → `finish`。
10. 立刻真环境复验：`node shared/stream_run.mjs start --target 2 --no-submit` → 循环 → `finish`，核对第 2 次打分列表与第 1 次无交集、那 2 家不在候选里；`node scripts/dashboard.mjs --once` 看「今日已尝试 2/10」（`npm run status` 是常驻刷新，不会自己退出）。

## 性能硬指标自查（S5）

- 不涉及 HTTP 端点，p95 不适用。
- 沙箱名单扫描 21 块板 602 岗（本轮没计时；S4 实测 19 秒）；每个 start 多一次 `ps`（毫秒级，只在派单锁存在时）。
- preflight 在流式模式下每批跑一次（约 6 秒，含 role_guard_smoke 和语法检查），沿用既有行为。
- 覆盖率：项目没有覆盖率工具，没有数字。

## API 接口 8 契约自查（S5）

本轮不新增、不修改任何 HTTP 端点，不适用。网络访问只在沙箱走查里对 Ashby / Greenhouse 公开板接口做了只读 GET（复用现有模块）。

## 本项目铁律对照（S5）

- 测试串行：`npm test`（`--test-concurrency=1`）✓；新测试全部用临时家目录。
- CI 每一步本地跑 [实测，`f3e260e` 之上]：① `npm test` exit 0，477/477 ② `node scripts/role_guard_smoke.mjs` exit 0 ③ `node scripts/public_alpha_gate.mjs` exit 0 ④ shared + scripts 全部 `node --check` exit 0 ✓
- 主流程冒烟：e2e 走真 stream_run → 真 store → 真 supervisor → 真 apply_batch → 真队列 / 记账人 / 账本 → 3 行报告（含 D10、放行、手投登记后不再投）；另在真实数据沙箱上跑通「迁入 → 归档 → 装名单 → 名单真接口扫描 → 去重闸 → 打分 → held → 收工」。不能真投。

## 交付自查清单（S5）

- [x] TDD：每步先红后绿；install_watchlist 一步是事后挪走模块跑红，已如实写明
- [x] 全绿 477/477；CI 四步本地全过
- [ ] 覆盖率 ≥80%：项目没有覆盖率工具，没有测
- [x] 并发红测试先行：10 轮同时开跑，旧代码第 2 轮双开，新代码 10/10 只开一个
- [x] 没有压异常的空 catch；生产代码里没有 mock
- [x] 偏离 12 条全部标注；新观察只列不修
- [x] 两个超档驱动未碰；SKILL.md 用精准替换，未整篇覆盖
- [x] 真实 `~/.mrweirdo-jobs/` 零写入；没有真投递；没有对真实家目录跑 backfill / 归档 / 名单 / 手投的 --apply；没有 push
- [x] CHANGELOG 顶部加了 Changed ×4、Added ×3、Fixed ×1

## 试过的错误方向（S5）

1. **RACE 第一版打算只加「锁里 start 进程的 pid 已死才算残留」**（verify 给的修法之一）。放弃：start 进程本来就很快退出，之后 pid 死了但运行还活着，这个判断在 start 之外完全没用，还会引入 pid 复用的同类问题；「先建目录再用 O_EXCL 建锁」让「锁在目录不在」本身就只剩一种含义，更简单。
2. **PID 复用判法第一版用子串 `apply_batch`**：测试进程自己的命令行里有 `apply_batch_stream.test.mjs`，被当成活派单进程；真实场景里任何路径带这个词的进程都会误判。改为匹配 `apply_batch.mjs`。
3. **D10 第一版想在 apply_batch 里按「是否名单公司」拦**：apply_batch 手里只有工作库行，不知道这一行是不是名单扫描来的（工作库没有这一列，加列要改表结构）。改为 stream_run 在入库后、派单前把这些行的资格关掉，信息在批次文件里现成就有。
4. **沙箱走查第一次在 zsh 里用 `time N=$(…)` 包 next**：输出被吞，看起来像 next 什么都没做；单独重跑才看到正常出批。只是走查脚本的问题，不是代码问题。

> **回炉第 1 轮（S5，verify 第 6 轮 3/5）**：3 个提交 `b669201` `df92547` `dc135e7`，未推。① R9（P2）：D10 held 改按公司认——公司键 ∈ `search_intent.target_companies` 的 slug 归一即 held，与岗位从名单还是轮转进来无关；红测试（名单扫描 pika 500、轮转扫到 pika 合格岗 → 旧码驱动被派）转绿；既有「名单优先」与 D10 用例补上 target_companies（真实环境名单岗必来自 target_companies，行为不变）。② R6（P3）：新 `job_identity.boardSlug`，record-manual 公司键从链接的招聘板 slug 推，`--company` 只核对、不符响亮拒绝（无堆栈）；gh_jid 自有域名链接必须给 `--company`。③ STALE2（P3）：检查—清残留—建锁整段放进 `locks/stream_run.claim`（O_EXCL 认领段），中途死掉留下的认领文件 >30 秒只报路径不自动清；15 轮残留锁并发红测试（旧码第 8 轮双开）转绿。④ 真跑前清单第 5 / 7 / 10 步已改（第 7 步用探针库，沙箱实测跑完不重建 jobs.db；第 10 步改 `--once`）。测试 477→481，CI 四步 exit 0。**新观察（未修，列出）**：机器负载 36 时 `投前失败上限` e2e 偶发 1 次失败——记账子进程已打印 `{"ok":true,"action":"skipped"}` 但 apply_batch 拿到非 0 状态（疑似被信号杀，`spawnSync` status 为 null），按 `record_failed` 停批（保守方向，不会重投）；负载降到 10 后全量 481 全绿，未能再现，交 lead 定是否追。残留理论窗口：`finish` 的放锁不走认领段，与同时开跑的 start 有极窄的读后删竞态（verify 第 6 轮 FIN-START ×10 未触发），未修。真实家目录零写入。

> **回炉第 2 轮（S5，verify 第 7 轮 3/5）**：2 个提交 `ed18bf3` `cfd2584`，未推。① FLUSH（P2）：`apply_batch.runTee` 改为 `out.end(() => resolve(code ?? 1))`，结果文件写完才交记账人，并给写入流加响亮的 error 处理；红测试先行——新 `test/fixtures/slowfs.cjs`（fs.write/writev/open 回调推迟 80ms，经 NODE_OPTIONS 预加载进所有子进程）+ `test/apply_batch_flush.test.mjs`（3 家卡缺信息 + 1 家投成），旧码 3/3 次必红（熔断、记成 crashed），修后 3/3 绿。上轮申报的「高负载误停批」即此根因。② 诊断：apply_batch 两处 record_failed 打出 `exit / signal / spawn_error`；`submission_ledger.test` P2 用例断言信息带同样三项，不改语义。③ 同类排查：全仓只有 `runTee` 一处「写入流 end 后立即交给别的进程读」，已修；`fs/promises.writeFile` 各处都 await，不同源。**另列未修（同症状、不同源）**：`driver_contract.emitOutcome` 是 `console.log(结局 JSON)` 后立即 `process.exit`，stdout 是管道时 macOS 上异步写，结局行很长（带全部问答）时可能在退出前被截断 → 记账人同样读不到结局记成 crashed；与 preflight 64KB 截断同类，交 lead 决定。验证：全量 `npm test` 连跑 3 次 482/482；慢磁盘预加载下全量 1 次 482/482；CI 另三步 exit 0；真实家目录零写入。

> **回炉第 2 轮追加（lead 指派：驱动结局截断）**：`e20e1fc`，未推。`driver_contract` 在驱动进程（`*_apply_driver.mjs`）加载时即把 stdout 设为阻塞写，`emitOutcome` 打印前再保一次；仍同步退出（驱动依赖 emitOutcome 之后的代码不执行），两个超档驱动零改动。**偏离申报**：lead 建议「写入回调里 exit 或设 exitCode」，没采用——那样 emitOutcome 会返回，驱动在它之后的代码（继续填表 / 再点提交）会接着跑，风险更大；阻塞写在退出前把整行写完，效果相同。红测试先行 `test/emit_outcome_flush.test.mjs`：真子进程 + 真管道 + ~900KB 结局行（另一条先打 200KB 进度再出结局），旧码在 macOS 上于 65536 字节处截断（Linux 管道本就同步写，旧码在 Linux CI 上也绿，已在文件头注明）；修后 3/3 绿。全量 `npm test` 连跑 3 次 484/484，CI 另三步 exit 0，真实家目录零写入。

> **回炉第 2 轮追加 2（lead 复验 d341de7：emit_outcome_flush 偶发 exit null）**：`9178eb6`，未推。**根因**：拍板人 shell 设了 `NODE_USE_SYSTEM_CA=1`，Node 24.7（Homebrew，动态 OpenSSL 3.6.1）启动时在后台线程读钥匙串根证书，进程在它读完前 `process.exit` → 退出清理与之抢 OpenSSL → SIGSEGV（`~/Library/Logs/DiagnosticReports/node-*.ips` 栈：`ReadMacOSKeychainCertificates → libcrypto collect_keymgmt`）。与上一提交的阻塞写无关：最小脚本 `process.exit(2)` 在 8 路并发下 30/400 崩；去掉该变量 0/400；自然退出 0/400。**不只是测试问题**：记账人写完账后在退出时崩 → apply_batch 判 record_failed 停批并留在途标记 → 下次开跑补记「可能已提交」永久封掉一个没投成的岗（第 1 轮申报的「高负载误停批」多半就是它）。**修法**：新 `shared/safe_exit.mjs` 的 `installSafeExit()` 包一层 `process.exit`，系统证书开着时先 `tls.getCACertificates('system')` 读完（约 50ms）再退出；在 `driver_contract`（驱动、记账人、apply_batch 都引它）、`record_apply_outcome`、`stream_run`、`apply_supervisor` 安装。交错负载对照：bare exit 33/800 崩 → 先读证书 0/800。**测试**：红测试先行 `test/exit_segv.test.mjs`（200 个短命进程 ×8 并发走 emitOutcome，旧码 6/200 退出码丢失 → 0/200）；`emit_outcome_flush` 循环 50 次（5 路并发，NODE_USE_SYSTEM_CA=1）：旧码 7/50 失败（全是 actual null）→ 修后 0/50；全量 `npm test` 连跑 3 次 486/486，CI 另三步 exit 0；真实家目录零写入。**列出未修**：仓里另有约 43 个文件仍直接 `process.exit`（找岗、报告、各类 CLI），崩了表现为「子进程失败」响亮报错，不会静默写坏账本，未逐个安装；Linux 不从钥匙串读证书，无此竞态（CI 上旧码本来就绿）。

> **回炉第 3 轮（verify 第 8 轮 P3：safe_exit 盖不全）**：`f4a5fce`，未推（在 ops 的 `6fde653` 之上）。改为**启动时**读完系统证书：新 `shared/preload_system_ca.mjs`（仅 `NODE_USE_SYSTEM_CA` 开着时同步 `tls.getCACertificates('system')`，约 50ms，无其他 import）；`safe_exit.mjs` 引入即执行它，并把 `--import=<preload 的 file URL>` 追加进 `process.env.NODE_OPTIONS`——仓里所有起子进程处都用 `{...process.env}`，所以子进程、孙进程全部继承。`installSafeExit()` 保留为空函数（原调用点不动），不再包 `process.exit`。入口：原 driver_contract / record_apply_outcome / stream_run / apply_supervisor，新增 apply_batch、supervisor_preflight、materialize_cover_letter、submission_ledger、retire_jobs_db、install_watchlist、validate_user_profile、record_profile_answers。红测试先行 `test/exit_segv_children.test.mjs`：引 safe_exit 的父进程 ×8 并发起 200 个不引任何模块的替身子进程——成功 `exit(0)`（cover letter 同款）旧码 **19/200 SIGSEGV → 0/200**；未捕获异常旧码红 → 200/200 退出码 1。真实 CLI `validate_user_profile` ×200（CA=1）0 崩。全量 `npm test` 连跑 3 次 488/488，CI 另三步 exit 0，真实家目录零写入。**全库清单**：直接起 node 子进程的点 13 处（apply_batch ×2、stream_run、apply_supervisor、inflight_recovery、supervisor_preflight、supervisor_status、apply_capacity_plan、submission_evidence、三个驱动、sourcing/_executors/ashby_plan_executor；另 scripts/public_alpha_gate、role_guard_smoke 两个 CI 脚本）——流水线上的都由上游入口注入的 NODE_OPTIONS 覆盖；直接调用 `process.exit` 的文件 44 个，其中不在任何已注入进程树下、且由人直接跑的只剩 scripts/*（dashboard、demo_check、CI 脚本）和零散工具 CLI，崩了只是终端报 segfault、不改数据，未逐个加。代价：每个 node 子进程启动多约 50ms（仅 CA 开着时），全量测试变慢，未影响结果。

> **回炉第 4 轮（lead 复验 f3aef0f：RACE 偶发败方崩 ENOENT）**：`4d34c78`，未推。**复现**：RACE 用例循环 100 次（5 路并发）8 次失败，全部是败方在 `lockDir` 扫描/stat 自己刚建的运行目录时 ENOENT。**根因**：胜方拿锁后 `cleanOldRuns` 删掉除自己以外所有 `stream-*` 目录，其中包括败方刚建、还没上锁也还没抢锁的目录（第 5 轮 RACE 修法「先建目录再建锁」引入的窗口）。**修法**：运行目录名末尾就是建它的 start 进程 pid，`cleanOldRuns` 只清该进程已不在的目录（活着的要么正在抢锁、要么输了会自己删）。确定性红测试「活 pid 目录被清」先行转绿；RACE 循环 100 次修后 **0/100**（共 1000 轮同时开跑，每轮恰好一个开跑、败方都是干净拒绝，胜方照常收工）。全量 `npm test` 连跑 3 次 489/489，CI 另三步 exit 0，真实家目录零写入。残留代价：pid 被复用时一个死运行的目录会多留一次，下次再清，不影响正确性。

---

# 第 5 次召唤：关卡 3「只投 AI 视频创业公司」— 只扫名单开关 + 名单岗「列出 → 点名 → release 投」（2026-09-26）

> 派遣范围中途更正（lead 转拍板人原话「投之前给我看一眼那个公司的岗位是什么，然后链接给我」）：原 B 项「填好表单停在提交前」的带闸单岗流程整段取消。本轮**未改动** `mrweirdo-ashby` / `mrweirdo-greenhouse` 任何文件，无需回退。

## 实现摘要

提交 `8594c12`（stream_run 只扫名单 + release 去向）、`e0dd06d`（install_watchlist --mode）、`b4ef9dd`（说明书 + CHANGELOG），未推。净增约 +210 行代码/测试、+68 行文档。
- **开关**：`search_intent.sourcing_mode`，取值 `watchlist_first`（缺省，行为不变）/ `watchlist_only`。开时 `start` 把轮转窗口数钉 0、不加载轮转公司表，`next` 只扫名单；名单为空、值拼错、同时给 `--max-windows K>0` 都响亮拒绝。写开关用 `node shared/install_watchlist.mjs --mode watchlist_only`（默认试跑，`--apply` 才写，600 权限）；`--mode watchlist_first` 关。已登记进 `intent_schema.json`。
- **报告**：开关开时第 3 行末尾加「（只扫了名单公司 K 家，别的公司没扫）」；新岗不够照原文「新岗不够：…没凑到 N 个」如实说。held 第 1 行格式由「公司·岗位·链接」改为「公司·岗位 链接 」（链接两侧空格，终端/Markdown 能点开；中文顿号紧贴链接会被并进链接）。held 列表本就不截断，新增测试锁住 7 条全列。
- **release 核查**：只扫名单下 `--release` 正常投——扫名单 → 放行解 held → 重新打分 → apply_supervisor → 投前权威闸 checkDispatch（重投 / 60 天同公司 2 次 / 日档位）→ 驱动 → 唯一写账人 record_apply_outcome 写 submissions.jsonl（apply_url、may_have_submitted、company_key；指纹由 apply_url 推导、写入时校验）。**修两处去向不明**：① 今日额度已满时放行链接被报成「没找到（可能已下架）」→ 改报 `daily_cap_reached`；② 放行岗重新打分不合格时报告一字不提 → 报 `scored_not_eligible`；另兜齐 `not_scored`、`not_dispatched:<停因>`。
- **依据版本**：`sourcing_mode` 不计入打分依据版本（只管扫哪里，不管怎么判），切换开关不作废「不合适」记录。

## TDD 落地证据

- 红测试先行 `test/stream_run_watchlist_only.test.mjs` 9 条：改前 7 红 2 绿（「开关关行为不变」「60 天同公司拦下」两条本就该绿，作回归护栏）→ 改后 9/9 绿。关键断言：`discoverCalls` 只有 `watchlist`、`driverCalls` 为空、held 7 条每条匹配 `公司·岗位 <链接>(\s|$)`、第 3 行「新岗不够…没凑到 5 个」+「只扫了名单公司 3 家」；release 后账本行 `may_have_submitted=true` 且 `attemptIndex.byFp` 按指纹命中；同链接再放行报 `already_attempted_fp`、驱动不再调。
- `test/install_watchlist.test.mjs` +2 条：`--mode` 试跑不写、`--apply` 写开关+名单、关掉、拼错拒绝、不带 --mode 不碰已有开关。改前 1 红 → 绿。
- 既有 D10 用例一处断言随格式改动同步（`·链接` → ` 链接 `）。
- 全量 `npm test` 串行连跑 3 次：489 → **500/500**（见交付自查清单填的实数）。覆盖率：本项目无覆盖率工具配置（沿用前几次召唤口径），以 e2e 断言覆盖新增分支：开关三值、拒绝三种、release 去向五种中的四种（`not_scored` / `not_dispatched` 未单独造场景，见遗留）。

## 自审记录

- `sourcingMode()`：输入 search_intent.json，输出 {mode, listCount}；未知值 die，不静默当缺省。`--max-windows 0` 与只扫名单不冲突，放行。
- `releaseWhy()`：每条放行链接必有去向——有账本行的在第 1/2 行照常出现；其余一律进第 2 行带原因，无 else 静默分支。
- 无 try/except 压异常、无 mock 进生产代码；held 逻辑、闸、写账人未改一行。

## 偏离 DESIGN

1. **开关放 search_intent 而非 stream_run 参数**：派遣单二选一，选前者——拍板人这是长期决定，放参数每次都要记得带，漏带就会扫轮转池投非名单公司。不回改 DESIGN 结构，只需 architect 在 DESIGN 数据流「名单优先 → 轮转」处补一句开关。
2. **held 第 1 行格式**：定稿写「公司·岗位·链接」，实现改为「公司·岗位 链接」（纯标点、为可点击），请 lead 决定是否同步 docs/specs/restart-apply.md 措辞（我未改定稿）。
3. **打分依据版本剔除 sourcing_mode**：DESIGN §3 依据版本原是 search_intent 整份，现剔一个字段，理由见实现摘要。

## 发现的旧 bug

- （已修，本轮引入范围内）额度满时放行链接被报「可能已下架」：根因 = finish 只看 gate 有没有见过该链接，没区分「扫了没见到」和「根本没扫」。修法见摘要，测试「--release 遇今日额度已满」。
- （已修）放行岗重新打分不合格静默：根因 = gate 记 `pooled` 后 finish 当作已处理。测试「--release 的岗重新打分不合格」。
- （未修，列出）名单某家扫描失败时放行该家的链接会同时报「名单里 N 家没扫到」和「放行的没找到（可能已下架）」——两条并列，后一条措辞不够准；影响仅措辞。

## 遗留事项

1. **看的上限仍是 N×10**：只扫名单模式下名单公司合格岗全部 held、不占投递数，「跑 N 个」最多打分 N×10 个名单新岗，超出的第 3 行报「还有 X 个新岗没打分就收工了」，下次再看。拍板人若要一次看全 21 家，需决定：跑大 N，或给只扫名单模式放宽看的上限（待 lead/拍板人定）。
2. held 7 天内不重报：拍板人一周没点名，第 8 天会再列；点名后已投的永不再列。
3. `not_scored` / `not_dispatched` 两种放行去向没单独造 e2e 场景（代码路径短、与已测两种同构）。
4. 真跑前仍要：ops 的清单 1-4 步完成 → 第 0 步重新引导（新简历）→ 拍板人同意后 `install_watchlist.mjs --mode watchlist_only --apply`。本轮未碰真实 `~/.mrweirdo-jobs/`。

## 性能硬指标自查

无新端点。只扫名单模式少一次轮转公司表加载和所有轮转扫描，运行更快；新增 `releaseWhy` 为 放行数×本次行数 的线性扫，规模个位×百级，可忽略。

## API 接口 8 契约自查

不涉 HTTP 端点，CLI 契约：`start` 输出新增 `sourcing_mode`，`finish` 输出新增 `sourcing_mode`，均为追加字段，旧调用方不受影响。

## 本项目铁律对照

- 串行跑全量、CI 四步本地全跑：是（见下）。
- 主流程冒烟（找岗 → 打分 → 投 → 报告）：stream_run e2e 全绿，含只扫名单全链路与 release 投递记账。

## 交付自查清单

- [x] TDD：红测试先行（7 红 → 绿；install 1 红 → 绿）
- [x] 全量 npm test 串行连跑 3 次全绿（500/500 ×3）+ CI 另三步 exit 0（数字见 TASK 本轮行）
- [x] 无 except-pass、无 mock 入生产
- [x] 带闸技能 mrweirdo-ashby / mrweirdo-greenhouse 零改动（范围更正后确认）
- [x] 说明书 onboard / run-and-database / jobskill 用精准替换同步；CHANGELOG 顶部加条目
- [x] 未真投、未写真实家目录、未 push

## 试过的错误方向

1. **只在 held 行把分隔符「、」换成「，」**：否决——任何全角标点紧贴 URL 都可能被终端/Markdown 并进链接，要空格隔开才稳。
2. **只扫名单时对 `--max-windows` 静默忽略**：否决——显式给了轮转窗口却被吞，违背 Fail Fast，改为响亮拒绝。
3. **切开关后沿用整份 search_intent 当依据版本**：否决——拍板人来回切一次开关会把 60 天内所有「不合适」作废、全部重打分，花钱不带来任何判断变化。

> **第 5 次召唤追加（lead 复验 a089260 偶发 exit null + verify 第 10 轮 P3/P4）**：`2171bee`、`736f97b`，未推。**入口全覆盖**：凡首行 shebang 或有 main 守卫的 .mjs（shared/scripts/bin 共 57 个未装）首个 import 改为引 `shared/safe_exit.mjs`（启动时读完系统证书）；npx 启动器 `bin/mrweirdo-jobs.mjs` 随 npm 包单独发布、不带 shared/，改为就地同步读证书。守卫 `test/entry_preload_guard.test.mjs` 扫描全部入口，漏装即红（另有自检用例）。红测试：NODE_USE_SYSTEM_CA=1 下 `submission_evidence.mjs --tab x` ×200（8 路并发、不带上游 NODE_OPTIONS），旧码 **3/200 SIGSEGV** → 修后 5 轮 **0/1000**。连带：三个驱动测试夹具只改写 `from './`，补改写 side-effect `import './`；demo_check 夹具补拷 safe_exit。**P3**：开跑即额度满、一家未扫时第 3 行改为「今日额度已满，本次未扫描」（其他未扫就收工的情形写「本次未扫描（原因）」），不再说「没有新岗…只扫了名单」。**P4**：第 2 行放行链接、中断补记的链接/截图路径两侧留半角空格。红测试先行（6 红→绿；「没找岗就 finish」一条写在实现之后，未见红）。全量 `npm test` 连跑 3 次 504/504（第 1 次与上一轮全量尾段有约 3 分钟重叠，仍全绿），CI 另三步 exit 0；真实家目录零写入。未修：第 2 行原因码仍为英文（verify P4 附带提及，未列入本次指派）。

> **第 5 次召唤追加 2（账本更正 CLI，Creatify PM Intern 重投）**：`10ec8b7`、`029d522`，未推。`node shared/submission_ledger.mjs correct --of <行 id> --verdict not_submitted --evidence "<为什么>" [--apply]`：默认试跑打印将追加的更正行（答案字段不打到终端），`--apply` 经既有 `appendCorrection` 追加（写 600，原行不动）；拒绝无证据、行不存在、更正「更正行」、判定不在允许值、有 stream_run / apply_batch 锁时写入（与 record-manual 共用）。**取值依据**：verdict 只许 `not_submitted | unknown | submitted`（LEDGER_VERDICTS 去掉只属迁入的 legacy_unverified）；may_have_submitted 按「投过」唯一口径（ADR-S6：只有确知没到对方手里才算没投过）由 verdict 推：not_submitted→false，unknown / submitted→true；reason 写 `corrected_by_user`，原因文字进 evidence；outcome 保留原值（legacy_submitted），不改写历史动作本身。**闸**：`attemptIndex`（投前权威闸 checkDispatch、去重闸 identityBlock、60 天同公司计数、日档位共用）本来就走 `effectiveEntries`，无需改；变异核实：把它改回读原始行，新「投前闸」测试即红。红测试 `test/ledger_correct.test.mjs` 4 条（CLI 缺失时 4 红 → 绿）：更正前 Creatify 该岗 already_attempted_fp、同公司另一岗 company_cooldown_60d；更正后两者放行、Creatify 60 天计数 2→1；未更正的 OpusClip 行与 Creatify 另一行仍拦。附带影响（已核）：`legacyCountCheck` 数原始 legacy_unverified 行，更正后仍 182（迁入保真检查，不应随更正变）；看板「已投」读有效行，会少 1。注意：更正后 not_submitted 行会计 1 次「点提交前失败」，但 Creatify 该行 5-26 已出 60 天窗口，不影响；Creatify 是名单公司，重新扫到会 held，需 `--release <链接>` 才投。全量连跑 3 次 508/508，CI 另三步 exit 0，真实家目录零写入。

> **第 5 次召唤追加 3（verify 第 12 轮 P3/P4，correct 子命令）**：`b75cb6e`、`8151f81`，未推。**P3**：`correct` 新增必填 `--url <该行岗位链接>`，按岗位指纹与目标行 apply_url 比对（Creatify 链接带不带 `/application` 视为同岗），对不上响亮拒绝、不写账——防止拿错行 id 把真投过的 legacy_unverified 行（如 OpusClip）放行；证据去空白后少于 10 个字符拒绝（`MIN_EVIDENCE_CHARS`）。**P4**：CLI 取参数值时，值缺失或以 `--` 开头即报「needs a value」退出 1，`--evidence --apply` 不再把 --apply 吞成证据；record-manual 共用同一取值函数，一并受益。红测试先行 2 条（2 红 → 绿），既有 4 条改为带 --url、证据 ≥10 字。全量连跑 3 次 510/510，CI 另三步 exit 0，真实家目录零写入。lead 执行用法：`node shared/submission_ledger.mjs correct --of led_1790453329601_169_3799e7 --url https://jobs.ashbyhq.com/creatify/4da91083-999a-4bf8-b53d-92a179073af2/application --verdict not_submitted --evidence "Gmail 无 Creatify 确认邮件（同日 OpusClip 有）"`（试跑），确认后加 `--apply`。

> **第 6 次召唤（restart-apply-2：应届全职口径 + 地点筛，拍板人「行，3年以上的跳过」）**：`c805b93`、`1e43bfc`、`e18a39b`、`46cde61`，未推。
> **① new_grad_FT 新口径**（`shared/role_types.mjs` 一处，下游 store_scored_jobs / eligibility / validate_auto_row / supervisor_preflight / recompute 等经 classifyRoleType / deriveRoleTypeFromJob 自动一致）：雇佣类型为全职、或没有雇佣类型字段且标题无合同/临时/暑期/fellowship 信号（Greenhouse 不给雇佣类型，4 家名单公司靠这条）→ 若标题非资深且 JD 未写明要求 ≥3 年 → `new_grad_FT`，否则 `other`。资深标记：Senior / Sr. / Staff / Principal / Lead / Director / Head / VP / Chief。**Manager 不算资深**：依据 BUG_REPORT 的 16 岗预估名单本就含 Affiliate / Field Marketing / Community Manager，这些在创业公司是入门全职；「Senior Manager」由 Senior 拦。年限解析 `requiredYears`：认 `N+ years`、`N-M years`（取下限）、`minimum/at least N years`、`N or more years`、`N years of (relevant…) experience`、英文数字 one–ten；紧跟/紧前 preferred / nice to have / a plus / bonus 的不算要求；多处取最大；「4-year degree」「founded 5 years ago」不算。discovery 丢弃原因细化为 `senior_title` / `requires_3plus_years:N` / `role_type_not_allowed`，漏斗新增按类汇总。年限规则只在有 JD 时生效——DB 行没有 JD，但凡是进了 DB 的都已在发现阶段按 JD 查过，口径一致。另加：雇佣类型写 FullTime 但标题写 Freelance / Contract 的不算全职（真实拷贝复跑时发现 ElevenLabs「Audio Engineering (Freelance)」漏入，红测试先行）。打分提示 score_prompt.md 同步 new_grad_FT 定义（它计入打分依据版本，此后首跑会重判旧「不合适」，符合口径变化）。
> **改动的旧断言（逐条说明）**：`test/role_types.test.mjs` ①「Business Operations Associate + FullTime → other」改为 new_grad_FT（拍板人要投应届全职，普通非资深全职即入门岗），同处补一条 Senior 版仍为 other；②「错标 intern 的该岗 derive → other」改为 new_grad_FT（护栏本意「不被当实习」不变）。`scripts/role_guard_smoke.mjs` ③ APM + Full-time → new_grad_FT，并新增「只要实习/兼职时不放行」断言；④ Fellowship Operations Associate + Full-time → new_grad_FT，同加只要实习不放行；⑤ (b) 纯全职岗 classify → new_grad_FT（仍无冲突标记）；⑥ new_grad_FT 目标下的自动投队列现在含错标为 intern 的 APM 行（按新口径它就是应届全职；只要实习的两道校验仍拒）。防全职外泄老护栏未动：`role_type_targets` 不含 new_grad_FT 时任何全职都拦（新测试锁定）。
> **② 地点筛**（新 `shared/location_gate.mjs`，discover_candidates 的旧 passesLocation 删除）：每个岗的主地点 + 附加地点（Ashby secondaryLocations 按对象读，原代码当字符串读、主地点空时会得到「[object Object]」；Greenhouse offices）+ Ashby 结构化国家，逐个归类 美国 / 中国 / 外国 / 无限定远程 / 未知。任一为美国（或用户开放的国家）→ 放；否则任一外国 → `location_mismatch:<地>`；否则无限定「Remote」且用户接受远程 → 放；否则 `location_unrecognized:<原文>`（不再默认放行）。**无国家限定的 Remote 放行**：BUG_REPORT 未对此单独给建议，我按其「白名单不认识的值不默认放行」原则只对「认不出」拦，而「Remote」是认得出的远程；美国创业公司常把美国远程写成裸 Remote；若该岗其他地点全在国外则拦（测试锁定）。易混处理：不收裸「america」（Latin America）、「la」「venice」；州缩写只认「, CA」形式且在排除外国名之后判（「Bangalore, IN」是印度）。`excluded_locations`（Singapore）仍无代码读取，但 Singapore 在外国表里被拦。
> **③ 真实家目录拷贝复跑**（scratchpad/home，rsync 排除 chrome-profile / run-tmp；21 家公开接口只读 GET，0 报错）：发现 601 → **进打分 85**（intern 3 + new_grad_FT 82）。按固定顺序首个命中：标题排除词 193、地点 154（全部是外国地点：Almaty 31、Europe 12、London 15、Toronto 8、Freiburg 8、UK 10…；未知地点 0）、资深标题 93、JD 要求 ≥3 年 65（3 年 14 / 4 年 9 / 5 年 22 / 6+ 年 20）、岗位类型不符 11（合同/兼职等）。每道筛子单独跑全部 601：地点 233、资深 173、≥3 年 179、类型不符 15。**与预期 16 的差距**：BUG_REPORT 的 16 另外只保留增长/市场/产品方向，而硬筛不看岗位方向（方向由打分阶段 + store_scored_jobs 的方向相关性闸判），85 里按标题粗分属增长/市场/产品/内容/社区/实习的约 31 个，其余是工程、客服、IT、法务等，会在打分被判不合适。**待 lead/拍板人定**：是否在硬筛加「方向」预筛以省打分额度（只扫名单模式 N×10 上限下，「跑 9 个」即可看完 85 个）。另：拷贝里 Creatify PM Intern 仍在账本（未做更正），OpusClip / Pika 两个实习有 held 记录——真跑时这 3 个在打分前会被去重闸跳过。
> 红测试：`test/role_types_new_grad_ft.test.mjs` 7 条、`test/location_gate.test.mjs` 7 条（模块不存在时全红）；Freelance 1 条先红后绿；location「易混」1 条与 Ashby 附加地点 1 条写在实现之后，未见红（后者对旧码必红：旧码不产出 locations 字段）。全量连跑 3 次 526/526，CI 另三步 exit 0；真实家目录零写入（仅 rsync 读取）。

> **第 6 次召唤追加（lead 复验 b89cec2 偶发 concierge exit null）**：`f215d49`，未推。**根因核实**：concierge_isolation 的 print 助手用 `node -e "import('./shared/paths.mjs')…"` 起子进程，入口不是我们的 .mjs、没有上游 NODE_OPTIONS，paths.mjs 的 concierge 拒绝路径自己 `process.exit(3)` → 与后台读钥匙串证书抢 → SIGSEGV。同一调用 ×400（8 路并发）：NODE_USE_SYSTEM_CA=1 **8/400** 崩，关掉 **0/400**。**修法**：paths.mjs 首个 import 引 safe_exit（全库含 `process.exit(` 且未引的只有它和 bin 启动器，后者已就地读证书）；入口守卫扩到「含 process.exit( 的模块」；新增守卫：测试里读退出码的 `node -e` 子进程必须带 `--import=preload_system_ca.mjs`，并给 concierge_isolation / progress_stdout / state_file_lock 三处助手补上（`-e '0'` 只借死 pid 的豁免）。红测试：paths.mjs 拒绝路径 ×400（CA=1）旧码 2-8/400 SIGSEGV → 修后 0/400；原失败测试在 CA=1 下循环 200 次 0 失败。全量连跑 3 次 528/528，CI 另三步 exit 0，真实家目录零写入。

> **第 6 次召唤 B 回炉（verify 第 13 轮 3/5）**：`d62b28d`、`541583b`、`73e71bd`、`fbcb88c`（上一条 bullet 的 preferred）、`d30f91b`，未推。**P1 ① 年限识别**：区间正则允许上限后带 +（「3-5+」「5–10+」「8–12+」）并认「N or M years」（均取下限，「1-3 years」仍 1 放行）；「, ideally …」「(NY or CA preferred)」不再把年限当 preferred——preferred 只认紧挨年限的标注（「3+ years preferred」「Preferred: 3+ years」同一行），外加「Nice to have / Preferred Qualifications / Bonus」小标题下的 bullet 段不算要求（Greenhouse 去 HTML 后无换行，此条只对 Ashby 生效）。**P1 ② 否决链路**：`store_scored_jobs` 入库的 role_type_match 改为「打分器判非目标类型 → 记打分器的；否则记带 JD 的重判」，两者都是目标才记目标类型；`deriveRoleTypeFromJob` 把库里的 `other` 当否决（库里没 JD，标题重判不得翻回），new_grad_FT 遇资深标题判 other。verify 3 条复现收进 `test/role_types_new_grad_ft.test.mjs` 转绿；新 `test/role_type_veto_chain.test.mjs` 用真 CLI 走 store → recompute → validate：打分器判 other 的 Luma PM Growth、打分器误判 new_grad_FT 但 JD 5–10+ 年的，入库都记 other、eligible 0、recompute 不翻、validate 拒；1-2 年的应届岗照常可投。**漏网收紧（逐条）**：① 排除词匹配不分连字符/空格/连写（新 `shared/title_excludes.mjs`；Full-Stack / Fullstack 5 个）；② 用户 `target_function_anchor.excluded_functions` 写了 Software Engineering / ML/Research 且自己的目标方向没提到时，硬筛追加 engineer / engineering / developer / systems architect / software architect 与 researcher / research scientist / research engineer / machine learning / ml engineer（工程研究 27 个全拦；「Creative Workflow Architect」「Research Intern」不受影响——只收 systems/software architect 与 researcher）；③ 资深标记加「Engineering / Design / Research Manager」（带人经理 4 个），「Lead Generation」「Contract Manager」不再误判；④ 地点：标题点名外国城市（「… - London」）即拦（runway London 1 个），「US hours / US time zone」不算美国，外国城市 + 仅美国州名（Tbilisi, Georgia）判外国，「, WA」等无歧义州缩写判美国（Vancouver, WA），IN/CA 等与国家代码撞的不据此判。**真实拷贝复跑**（scratchpad/home，21 家只读 GET 0 报错）：601 → **进打分 45**（实习 3 + 应届全职 42）。首个命中：排除词 270、地点 140、资深 77、≥3 年 60、类型不符 9；各筛单独跑 601：地点 234、资深 182、≥3 年 188、类型不符 14（排除词为第一道，单独=270）。与上一版 85 对比：去掉 40 个 = verify 分桶的工程研究 27 + 资深 12 + 非美国 1，**新增 0、应届能投 42 与实习 3 无一被误杀**（逐条集合比对）。复跑中先出现 1 个新增漏网（elevenlabs Commercial Counsel - US，8+ 年，因上一条 bullet 的「(NY or CA preferred)」被当 preferred），红测试先行修掉。未做：verify P4 的 tavus「typically 4+ years」仍判要求（按拍板「3 年以上跳过」）；「Member of Technical Staff」仍按 staff 判资深。全量连跑 3 次 543/543，CI 另三步 exit 0；真实家目录零写入。

> **第 6 次召唤 B 回炉第 2 轮（verify 第 14 轮 3/5）**：`08d8f5d`、`20fda73`，未推。**P2**：`store_scored_jobs` 入库前把打分器的 role_type_match 规范化——`other/Other` → other，合法别名（full_time、New Grad FT…）经 normalizeRoleType → new_grad_FT 等；规范不出的（senior 等）一律记 other、不可投、原因 `role_type_label_invalid` 进汇总，stderr 点名原标签。再与带 JD 的重判合判（上一轮规则不变）。红测试（verify 决策表各格）：senior / full_time / Other / New Grad FT × JD 5–10+ 年 → 入库 other/0、recompute 不翻、validate 拒；senior + 应届 JD 也不可投；full_time + 应届 JD → new_grad_FT/1 可投。**P3-a**：年限区间与「区间后半截」判断只在同一行内（`[ \t]*` 代替 `\s*`），「GA4\n- 3+ years」、上一行以 URL 数字结尾的 suno 样例都认出。**P3-b**：标题点名的地点只在地点字段没有具体美国地名（远程不算、结构化国家不算）时才当上班地；尾巴含 market / markets / region / localization 的一律不当地点（「Social Media - Japan Market」「Creator Partnerships - India」@ SF 放行，runway「- London」@ Remote 仍拦）；美国州名除 Georgia 外一律判美国（「New Mexico」「Lima, Ohio」），Georgia 与外国城市同现判外国（Tbilisi）。**真实拷贝复跑**：601 → **45**（实习 3 + 应届 42），与上一轮集合逐条比对新增 0、减少 0（42 应届零误杀）；首个命中：排除词 270、地点 140、资深 77、≥3 年 60、类型不符 9；各筛单独：地点 234、资深 182、≥3 年 189（+1 = suno ML Scientist，工程岗本已被排除词拦）、类型不符 14。未改：verify P4 的 UX Researcher / Prompt·Automation·Martech Engineer 放不放由拍板人定。全量连跑 3 次 551/551，CI 另三步 exit 0；真实家目录零写入。

> **第 6 次召唤追加（首次真投阻塞：preflight 的 role_guard_smoke 失败）**：`2bff44b`，未推。**根因核实**：supervisor_preflight 以 `MRWEIRDO_ROLE_TYPE_TARGETS=intern,new_grad_FT` 调起，自带沙箱的 `scripts/role_guard_smoke.mjs` 用 `{...process.env}` 起子进程，沙箱按调用方口径判——新 new_grad_FT 口径下 APM 行合法，:173 断言「unexpectedly passed」。直接复现：带该变量跑 smoke exit 1，不带 exit 0。**修法**：smoke 开头清掉全部 `MRWEIRDO_*`，再设沙箱自己的 HOME / DB_PATH / REPO_ROOT / ONBOARD_TMP_DIR（不改断言）。**回归**：`test/role_guard_smoke_env.test.mjs` 4 组调用方环境（role targets ×2、MIN_FIT/SKIP_LIVENESS/TARGET_APPLICATIONS、调用方 HOME/ONBOARD_TMP_DIR）旧码全红 → 全绿。**顺查**：preflight 里只有 role_guard_smoke 是自带沙箱的自检；syntax 检查不读环境；queue / diagnostics / validate 本意就是按真实运行环境查真实队列，不改。**真实家目录拷贝**（账本 216 行）带 role targets 跑 `supervisor_preflight --json`：role_guard_smoke OK，仅 queue_nonempty 失败（拷贝上用空探针库，没有 release 的工作库行，属预期）。全量连跑 3 次 555/555，CI 另三步 exit 0；真实家目录零写入。

> **第 6 次召唤追加（首次真投投出 0 的三处）**：`8259257`、`070d7a8`、`7ef0ac3`（spam），未推。
> **① OpusClip RTO 题**：根因不是读取路径——`relocationPolicyOpen`（answer_routing.mjs）只认 `relocation_policy === 'anywhere_legal_work'`，拍板人真实配置是 `anywhere_primary_country`（全美可搬）+ `willing_to_relocate_for_internship: true`，所以判不开放。修法：全美可搬在**岗位地点属于美国**时开放（地点用 location_gate.classifyPlace 判）；岗位在国外或地点未知仍照问——驱动从工作库只读取该行 location（无库行的单岗运行 → 空 → 照问，不替用户承诺）。回归：真实拷贝 search_intent 的 geographic_preference 写进测试；真实拷贝文件直接调用：Mountain View / San Francisco → 开放，无地点 → 不开放；驱动级测试 Mountain View 答 Yes、London 仍 policy_unset。
> **② 「用 AI 做过/试过什么」开放题**：答案库新增该类模板 `{{AI_EXPERIMENT_STORY}}`（排在最前），由 `aiExperimentStory(essay_profile)` 逐字取故事字段拼成「What I was trying to learn or achieve / What I did / What I discovered」，只加这三个固定连接标签、不添一个事实；优先 use_for 含 `ai_experiment` 的故事，其次技能写着 AI 的真实项目；都没有 → 整段为空 → 题目照旧挂起问用户（不交空答案、不编）。Ashby / Greenhouse 驱动读 essay_profile 传入。**注意**：真实家目录的 essay_profile 目前**没有** AI 视频实验故事（事实在简历第 39-42 行），按现规则会选 R2W（技能含 AI-assisted building，真实）。若要用 AI 视频实验作答，需 lead 在拍板人知情下往 essay_profile.project_stories 追加一条（字段逐字取自简历）：`{"name":"AI video model experiments (X account)","problem":"A 3M-view viral hit converted only 100 followers, exposing traffic without positioning.","what_user_did":"Ran 27+ controlled AI video experiments with pass/fail criteria, comparing models side by side (Seedance, Wan, Veo); distilled reusable prompt packs and shotlists from wins and postmortems.","result_or_learning":"Pivoted to vertical AI-video breakdowns and grew from 200 to 1,000+ followers in 3 days.","skills":["AI video evaluation","prompt engineering"],"use_for":["ai_experiment"]}`。本轮未写真实家目录。
> **③ Ashby 反垃圾拦截**：Tavus 日志显示 attempt 1 无缺字段、页面未判出结果 → 旧循环 sleep 后**再点一次提交**，attempt 2 才见横幅。修法：判定器新增 deny `platform_spam_flagged`（「flagged as possible spam」，夹具按截图原文转录）；Ashby 驱动在无缺字段且页面读不懂时**只重读页面（最多 4 次、每次 3 秒）、不再点提交**，仍读不懂 → unknown；读到反垃圾横幅即终局 `not_submitted / platform_spam_flagged`。Greenhouse 的同类失败页也标此原因（Greenhouse 的无缺字段重点提交行为本轮未动，列为遗留）。**未对平台反垃圾 / 机器人检测做任何绕过**（无延时伪装、无指纹、无 cookie 操作）。**60 天名额评估与推荐**：页面明说没收到 → 推荐**不算投过**（单一常量 `SPAM_FLAGGED_MAY_HAVE_SUBMITTED = false`，driver_contract.mjs）：不占同公司 60 天两次名额、不占今日档位；但同岗 60 天内**不自动重投**（apply_guard 新规则 `platform_spam_flagged_60d`），理由：自动化再投多半同样被拦，反复被拦对用户在该平台的信誉不利；用户可自行手投再 record-manual。它也不计入「点提交前失败」上限（那是机器故障信号）。3 行报告第 2 行新增「N 个被平台当成垃圾申请拦下，没收到（公司·岗位 截图： … ；不占这家的名额，但不会自动重投，你可以手投）」。**建议 lead 定**：同一批里 Ashby 出现反垃圾拦截后是否整批停投（平台级信号，继续投别家可能连锁被拦）——本轮未做。
> TDD：①②③ 的驱动级、判定、闸、报告测试先红后绿；③ 中判定器与投过口径两条单测写在实现之后（未见红）。全量连跑 3 次 570/570，CI 另三步 exit 0；真实家目录零写入（截图只读）。
