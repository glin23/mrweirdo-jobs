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
Blocks: restart-apply 小修包的 verify 验收
Updated: 2026-09-25
Iterations: 2
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
