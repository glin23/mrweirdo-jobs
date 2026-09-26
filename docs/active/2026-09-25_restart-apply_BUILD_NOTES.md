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
Blocks: restart-apply 小修包的 verify 验收；S1+S2 的 verify 验收；S3+S4 的 verify 验收；lead 对真实家目录跑 backfill-legacy --apply
Updated: 2026-09-25
Iterations: 4
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
