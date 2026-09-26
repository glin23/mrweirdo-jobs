---
Status: done
Owner: arnold-verify
Type: verify_report
Mode: daily
Reads:
  - docs/active/2026-09-25_restart-apply_TASK.md
  - docs/active/2026-09-25_restart-apply_BUILD_NOTES.md
  - docs/active/2026-09-25_restart-apply_DESIGN.md（ADR-S6 may_have_submitted / 看过规则）
  - docs/active/2026-07-23_product-blueprint_VERIFY_REPORT.md :2620-2750（第 7 轮 P2 原判）
  - docs/specs/restart-apply.md
  - .claude/arnold/roles/builder.md、PROJECT_CONTEXT.yaml（ci_smoke）
  - （第 2 轮）DESIGN 第 2 轮 §3 / §4.7 / §5 未明点 7·12·13 / ADR-S3·S6·S8·S9 / §10；PRODUCT_SPEC 第 2 轮 R1-R7、V1-V13；BUILD_NOTES「第 2 次召唤」
  - （第 4 轮）DESIGN 第 2 轮数据结构、失败路 1-6、崩溃与并发决策；PRODUCT_SPEC 第 2 轮去重规则与验收标准 V1-V13；定稿 docs/specs/restart-apply.md；BUILD_NOTES「第 3 次召唤」13 条偏离；stream_run / seen_log / inflight_recovery / apply_guard / apply_batch / store_scored_jobs / watchlist_source / greenhouse 驱动改动
  - （第 6 轮）BUILD_NOTES「第 4 次召唤」12 条偏离与真跑前清单；stream_run / lock_holder / submission_ledger record-manual / supervisor_preflight / retire_jobs_db / install_watchlist / dashboard / watchlist_source 改动；onboard·jobskill·两份 -auto 说明书 diff
Updated: 2026-09-25
Iterations: 8
---

# VERIFY_REPORT — restart-apply 小修包（072f203 / 7cd693c / d326b17 / 29e6147 + 文档 150d1df）

> 标注：[实测] 真跑过；[读码] 读代码推出；[文档] 官方文档佐证未实测。

## 1. 验收范围

四个代码提交 + 一个文档提交，main 本地未推（origin/main=987a4f0，推送将连带阶段 1 包 2 的 5 个提交）。逐项独立复现，没有采信 BUILD_NOTES 的自述：P2 隐私（问答不进 jobs.db）、Ashby 存活检查改走公开接口、Ashby 驱动两处旧词改走 crashed、demo:check 在 Mac 上假报 0。另外评估了 builder 申报的偏离（结局词选 crashed）和 4 条新发现。硬边界：没有真投递；真实 `~/.mrweirdo-jobs/` 只读，840 个条目开工和收工的 stat 快照排序后 diff 为 0，jobs.db 的 mtime/size 前后都是 1782006129/1728512；没有 push；没有提交代码。

## 2. 5 维高危区评估

先定测试密度，再动手测：
- ① 核心业务逻辑（高）：crashed 结局词会影响账本、重试和即找即投的「投过」口径 → 读码追到 DESIGN ADR-S6，加真漏斗实跑。
- ② 安全边界（高）：P2 问答外泄 → 真 CLI 跑遍 8 条出库路径，全表全列扫描，做改前改后对照，再全仓搜同族外泄口（因此挖出 §5 的 essay_pending 问题）。
- ③ 性能（中）：Ashby 接口无超时、preflight 慢 → 真实量级计时，并读 undici 的默认超时。
- ④ 集成点（高）：Ashby 公开接口 → 真网络只读 GET；再用 Ashby 页面自己用的 GraphQL 做**独立判官**交叉验证，而不是拿同一个接口自证。
- ⑤ 主流程（中）：存活检查和 demo:check 在真实库拷贝上跑通；投递本身不跑（禁止真投递）。

## 3. 7 类测试

- ① 等价类（6 次）：存活检查四类结果 live / expired / uncertain（无 ID）/ 板 404，各造一行实跑；记账 8 条出库路径各跑一例。
- ② 边界值（4 次）：URL 大写的 slug + 大写的 UUID（判 live，大小写已归一）；只有公司板没有岗位 ID 的 URL；preflight 输出 66712 字节跨过 64KB 管道边界；接口 HTTP 200 但回的 JSON 没有 jobs 数组。
- ③ 决策表（1 次）：记账人按「结局 × 行状态 × 同公司同岗已投」组成 8 格，全部跑过，每格断言问答零落库、人工清单里零问答、账本 8 行都带问答。
- ④ 状态迁移（1 次）：同一份拷贝先跑真网络（expired/live），再让网络全断（23 行全转 uncertain，不拦），确认每批都会重判、不锁死。
- ⑤ 用例测试（3 次）：demo:check 端到端改前改后（0 → 18 / eligible 215）；liveness `--batch` 端到端；recorder CLI 端到端。
- ⑥ pairwise：N/A。参数空间已经被决策表和等价类穷尽。
- ⑦ 风险驱动（8 处突变）：见 §4。

## 4. 5 轮回归循环记录

1. **写测试**：自写 P2 探针 `scratchpad/vr/p2probe.mjs`，走出货的 recorder CLI。它就是修复前状态的复现：在 1880fd0（修前）上跑 **8 条路径 8 处外泄**，人工清单里也有问答；在 HEAD 上是 **0 / 0**。
2. **全套逐提交干净检出**（独立 worktree，放在 scratchpad 的 `vr-wt-*`，跑完已删；每个提交单独一个假家目录），CI 四步都跑了：

   | 提交 | npm test | role_guard | alpha_gate | node --check |
   |---|---|---|---|---|
   | 1880fd0（基线） | 325/325 | 0 | 0 | 0 |
   | 072f203 | 326/326 | 0 | 0 | 0 |
   | 7cd693c | 329/329 | 0 | 0 | 0 |
   | d326b17 | 333/333 | 0 | 0 | 0 |
   | 29e6147 | 336/336 | 0 | 0 | 0 |
   | 150d1df | 336/336 | 0 | 0 | 0 |

3. **突变验证测试会不会咬人**（8 处，全部复原，worktree 零脏）：
   - Ashby 表单未加载改回旧词 skip → 2 红（行为测试 + 源码守卫）
   - 简历上传改用变量绕过守卫 → 1 红（守卫看不到，行为测试兜住了）
   - 记账 submitted 路径漏问答 → 1 红
   - 记账重复路径漏问答 → 1 红
   - **记账 essay_pending 路径漏问答 → 0 红（没咬住，见 §5）**
   - 存活检查恒判 live → 2 红
   - 接口出错改判 expired → 1 红
   - preflight 改回 process.exit → 2 红（macOS）
4. **修后重跑**：本轮零修改，不适用。
5. **转 bug**：§5 的两个真 bug 转 builder，放在即找即投第 1 包之前。

## 5. 结论明细

### ✅ 通过

- **第 1 项 P2** [实测]
  - jobs.db 里所有写 feedback 的路径都查过：recorder 的 6 条（全仓 grep）；另有 tracker_cli / retry_gap_rows / dedupe / rescore / logFeedback 五处，读码确认都不带问答。
  - 自写探针跑 8 条路径：jobs.db **全表全列**零命中；账本 8 行都完整保留了问答。
  - 真实库只读查询（immutable 模式）：feedback 表 292 行，含 `"answers"` 的 0 行，含 `"label"` 的 0 行。含 authorization / sponsorship 字样的 13 行逐条看过，都是**题面**（missing 列表），不是答案值。历史库确实没有残留。
- **第 2 项 存活检查** [实测]
  - 真实库拷贝里 8 条 Ashby 全判 expired。
  - 独立判官交叉验证：用 Ashby 页面自己用的 GraphQL 问这 8 条，**全部返回 null**。阳性对照（julius 板上现役岗）返回了岗位；阴性对照（编造的 UUID）返回 null。
  - 注入 4 行：现役岗 → live；大写 URL → live；无 ID → uncertain；不存在的板（接口 404）→ expired。
  - 断网（让代理指向死端口）→ 23 行全判 uncertain，exit 0，不拦。
- **第 3 项 Ashby 旧词** [实测 + 读码]
  - 两处都改走了 emitOutcome，结局 crashed，exit 1。
  - apply_batch 对 exit 1 高亮报红、继续跑下一行；recorder 把这行记成跳过（⚠️ 跳过未投），不再每批反复重挑。
- **第 4 项 demo:check** [实测]
  - 同一份家目录拷贝：修前显示「ready rows: 0」，修后显示「18 / eligible 215」。
  - 对照：preflight 直接写文件是 66712 字节，queue=18；走管道被截在 **65536** 字节。病根复现成立。

### ❌ 真 bug（2 个，都不是本包引入，都不阻塞推送）

1. **P2｜维度②安全边界｜essay_pending.jsonl 仍然收到全部问答**
   - [读码，已逐行确认]：两个驱动的 essay_pending 分支里，`rec` 带着 `answers: ANSWERS`（greenhouse_apply_driver.mjs:1844,1883；ashby_apply_driver.mjs:1088-1091,1134-1137），`logEssayPending(rec)` 把整个 rec 原样追加进 `~/.mrweirdo-jobs/essay_pending.jsonl`。
   - 这个文件权限是 **644**，而且**不在 `PII_TARGETS` 里**（state_file_lock.mjs:30-42）。
   - 来源：包 2 的 a7857e1（git blame 确认）。第 7 轮验收只点名了 feedback 表和人工清单，我当时漏掉了这个同族出口（算入漏检率）。
   - 真实文件现在 0 行带问答：a7857e1 之后还没跑过驱动。
   - 本包提交标题和 CHANGELOG 写的是「Answers now go to the 600 ledger only」，这句**过度声称**。
   - 复现步骤：任选一个驱动，走到 essay_pending 分支 → 看 essay_pending.jsonl 最后一行，里面有 `"answers":[...]`。
   - 修法：`logEssayPending` 写之前剥掉 answers，两个驱动各一行，再补一条反向断言。
   - 判定：**不阻塞推送**（推代码不会触发外泄）；**阻塞首批试投**，和第 7 轮 P2 同一条线。
2. **P3｜维度④集成点｜Ashby 接口回 200 但没有 jobs 数组时，判成 expired**
   - [实测，替身 fetch]：`{success:false}` 和 `{}` 都判 expired；HTML 和 429 判 uncertain，这两种是对的。
   - 根因：`ashby_board_api.fetchJobs` 把「板 404」和「回包形状不对」都压成 `[]`。
   - 这违背了本提交自己写的原则「不把自己的失明当死岗」。
   - 今天的影响：要等 Ashby 改回包格式才会触发；每批都会重判，可以自愈。
   - **到即找即投会升级**：DESIGN 的看过规则是「expired：jd_hash 不变就永久算看过」，误判会变成永久漏岗。
   - 修法：fetchRaw 区分 404 和「形状不对」，后者 throw → uncertain。和下面「接口没有超时」是同一个文件，建议一起修，放在即找即投第 1 包之前。

### ⚠️ 风险 / 🟡 不一致

- **🟡 测试缺口**：recorder 的 essay_pending 路径没有反向断言，突变没咬住。我的探针实测这条路径是干净的，所以只算测试缺口，不算 bug。
- **🟡 守卫偏窄**：源码守卫只认同一行里字面的 `console.log(JSON.stringify({outcome:`，用变量绕过就看不到。好在行为测试兜住了，CHANGELOG 的说法略宽。

### builder 申报的偏离：crashed —— 结论是保留，但要改 DESIGN 的推导规则

- **选词本身是对的**：契约里 not_submitted 是「页面明确说没交上」，unknown 是「判了但读不懂」。表单没加载、简历传不上的时候，页面判定根本没发生，选这两个词都是撒谎。
- **账本数字没有失真**：账本里记成 verdict=unknown；已投计数只认 verdict=submitted，不虚增。
- **「跨运行零重复」不受影响**：两处失败都发生在任何字段提交之前，零投出风险。按 DESIGN ADR-S6，crashed、not_submitted、unknown 推导出来**都是** may_have_submitted=true，三个词对去重的效果完全相同。换哪个词都解决不了下面的问题。
- **真正的问题在 DESIGN ADR-S6 的推导规则**：「outcome=crashed → 算投过」太粗。表单未加载、简历传不上（GH 同样有）、cdp_goto_failed、helpers_inject_fail 这些「点提交之前」的 crashed，会被算成投过：
  - 永不重试；
  - 占掉「同公司 60 天 2 次」的名额；
  - 占掉当日额度。
  - 目标公司 22 家里 17 家用 Ashby，影响集中在最想投的那批公司。
- **建议**（交 architect / builder，在即找即投包里落地）：
  - 按 reason 白名单，把点提交前的 crashed 推导为 false，这仍然符合 PM R2「最多重试 1 次」；
  - Ashby 表单没加载时，先认一下「Job not found」页面，归 not_submitted/job_unavailable，和 GH 对齐。

### builder 的 4 条新发现，逐条判定

| 发现 | 严重度 | 阻塞推送 | 阻塞即找即投施工 |
|---|---|---|---|
| Ashby 接口无超时 | P3 | 否 | 否。放第 1 包顺手修，和上面 P3 同文件 |
| 未公开列出的岗位被误判下架 | P4 观察 | 否 | 否 |
| preflight 36 秒 | P3 | 否 | 否。stream_run 落地时要测一次 |
| 第 4 项测试在 Linux CI 上改前也绿 | 信息 | 否 | 否 |

- **Ashby 接口无超时**：[读码] fetchRaw 没传 signal，但 Node fetch（undici）默认有 10 秒连接超时、300 秒头超时、300 秒体超时，所以**不是无限挂起**。最坏每块板约 10 分钟（2 次尝试），每家公司只会挂一次。即找即投的找岗阶段会大量调用这个接口，届时拖慢整次运行。
- **未公开列出的岗位**：[文档] Ashby 官方文档对 isListed 的解释是「false = 只能直链访问」，也就是说接口本来就会返回未公开岗，只是打上标记。今天 8 块板 228 个岗位全是 isListed=true，没法实测证伪，但风险低。
- **preflight 慢**：[实测] 真实 950 行的库 10-13 秒；builder 说的 36 秒是 600 行全合格的合成库。
- **Linux CI 改前也绿**：第 3 条测试（截断替身 → 必须失败，ready_rows 为 null）不依赖管道，任何平台上都能守住「静默显示 0」这个回归。只有「process.exit 截断」这一类回归只在 macOS 上有保护，而拍板人的机器就是 macOS。可以接受。

### 未覆盖（如实）

- 第 3 项在真表单上的行为：没有活 Chrome，也禁止投递，和 BUILD 同样遗留。
- 未公开列出岗位的实测：找不到样本。

## 6. Quinn 重构记录

零重构。两个真 bug 都跨文件或涉及接口语义（essay 日志涉及 2 个驱动；fetchRaw 被找岗模块共用），超出 Quinn 1-3 行的边界，转 builder。

## 7. 质量 3 指标

- 覆盖率：项目没有覆盖率工具，没有数字。改用 8 处突变验证测试真实性：7 处咬住，1 处没咬住（§5 🟡）。
- `verify_self_miss_rate: 33%`（1/3）。本轮 3 个问题项里，essay_pending 外泄是第 7 轮就应该一起挖出来的同族出口，当时漏检了。
- 真 bug 数：2（P2 × 1、P3 × 1，都早于本包）。

## 8. 老坑清单核查

`.claude/arnold/roles/verify.md` 不存在，项目没有定义验收老坑清单。

builder 岗位补充说明里的铁律已逐条核对：
- 测试串行：`--test-concurrency=1`；
- CI 每一步都跑：逐提交跑了四步，见 §4；
- 主流程冒烟：ci_smoke.main_chain 已填，存活检查和 demo:check 这两个环节在真实库拷贝上跑通；投递环节禁止真跑。
- schema_upgrade_path 和 isolation_field 都没填，对应铁律跳过（单用户产品）。

## 9. 13 维深查

日常模式，不适用。

## 10. 覆盖度评估

**质量分 4/5 —— 放行（可推）。**

四项修复全部独立复现，都有改前改后的对照：
- P2：8 条路径 8 处外泄 → 0，历史库确实干净；
- 存活检查：拿独立判官 GraphQL 交叉验证 8 条死岗，另有阳性和阴性对照；
- demo:check：0 → 18，截断点正好是 65536 字节；
- 逐提交干净检出 CI 四步全绿（325 → 336），8 处突变咬住 7 处。

扣 1 分的原因：
- 「问答只进账本」的声称不完整（essay_pending.jsonl 这个同族出口还开着，不过不是本包引入的）；
- essay 路径缺反向断言；
- 存活检查在「回包形状不对」时违背了自己声明的原则。

**必做**（排在首批试投之前）：
1. essay_pending.jsonl 剥掉问答，并补测试；
2. fetchRaw 区分 404 和回包形状不对，并加超时；
3. DESIGN ADR-S6 把点提交前的 crashed 推导为 may_have_submitted=false。

## 试过的错误方向

- **差点拿「同一个接口判 expired」当存活检查正确的证据**：接口说不在，只证明代码读对了接口，证明不了岗位真的死了。改用 Ashby 页面自己用的 GraphQL 做独立判官，并加阳性和阴性对照，才收下这个证据。
- **一度把 home 快照 diff 出几十行当成家目录被写了**：查下来是 find 两次遍历顺序不同，排序后 diff 为 0，jobs.db 的 mtime/size 也没变。没有据此误报。

---

# 第 2 轮 — 即找即投 S1+S2（07abffd..22bc56e 九个代码提交 + 文档 0638a41）

> Mode: daily。标注：[实测] 真跑过；[读码] 读代码推出；[推断] 未实测的推理。硬边界：没有真投递；真实 `~/.mrweirdo-jobs/` 只读（840 个条目开工/收工 stat 快照排序后 diff 为 0，jobs.db mtime/size 仍为 1782006129/1728512，`log/` 下仍无 submissions.jsonl，`locks/` 为空）；backfill 只在 scratchpad 拷贝上跑；没有 push；没有提交代码。

## 验收范围

S1 七项（岗位指纹、账本两个永久字段、出口表与唯一推导处、历史迁入、essay_pending 剥问答并锁 600、Ashby 接口回包形状与 15 秒超时）和 S2 投前权威闸（重投 / 同公司 60 天 2 次 / 日档位 / 点提交前重试上限、每行现读账本、在途标记与崩溃恢复、熔断、投后查重改不变量）。逐项独立复现，不采信 BUILD_NOTES 自述。重点评估 builder 申报的 8 条偏离，其中偏离 1（「出口表外一律算可能已提交」）按派遣单要求给出明确判断。

## 5 维高危区评估

- ① 核心业务逻辑（最高）：「投过」口径决定永不重投、日额度、60 天三件事，而且账本格式是永久的 → 读码追到三个驱动的每个出口，用真 apply_batch + 真记账人 + 真账本跑最坏场景，再做 16 处突变。
- ② 安全边界（高）：表单问答外泄 → 全仓追 `answers` 的所有下游（记账人、job_report、apply_report、gap_report、batch 汇总、essay 日志），并用带暗号的问答实跑 job_report。
- ③ 性能（中）：每行现读账本；215 行的真实迁入账本上闸的耗时在单测里看不出差别，没单独计时（和 builder 一样没有实测 4000 行量级）。
- ④ 集成点（中）：Ashby 接口形状与超时已由替身测试覆盖，本轮没有再打真网络。
- ⑤ 主流程（高）：main_chain 的「大批量一键投递 → 投递报告 → 持续跟进」一段，重点查「缺信息 → 问用户 → 放回队列 → 再投」这条已上线的跟进回路还通不通。

## 7 类测试

- ① 等价类（6 次）：出口四类（点提交前 crashed / 点提交后 needs_user / 派单前校验失败 stage=pre_dispatch / 带页面判定）各跑一例；迁入三类（已投 / 驱动跑过的跳过行 / 纯去重跳过行）在真实库拷贝上核分类。
- ② 边界值（4 次）：重试常量「失败第 1 次放行、第 2 次放行、第 3 次拦」（V6 + 突变 M6 验证不是差一）；同公司第 2 / 第 3 家；档位 10 投满后第 11 家；legacy 时间戳全部落在 5/26-6/14，今天的 60 天窗口里 0 家公司被占。
- ③ 决策表（1 次）：checkDispatch 六条规则 × 命中/不命中，靠 16 处突变逐条确认每条规则都有测试咬住（16/16 被杀）。
- ④ 状态迁移（3 次）：在途标记「写 → 驱动中被真 SIGKILL → 下次补记 → 清除」；「needs_user → 用户补答 → retry_gap_rows 放回 AI sourced → 再派」；backfill「dry-run → apply → 重跑 apply」。
- ⑤ 用例测试（2 次）：真实库拷贝上 backfill 全流程端到端；两个 apply_batch 真并发开跑。
- ⑥ pairwise：N/A。本包参数（结局 × 原因 × 阶段）已被决策表和等价类覆盖，没有需要两两组合的独立开关。
- ⑦ 风险驱动（6 个最坏意图场景）：同岗换编号、同岗标题改写、同公司不同写法、gh_jid 链接与板链接同号、崩溃在途恢复、并发两次运行，结果见 §5。

## 5 轮回归循环记录（第 2 轮）

1. **写测试（先红）**：探针 `vr2-probe/test/zz_verify_probe.test.mjs`（未提交，跑完已删）。复现偏离 1 的两处后果，两条都是红的：
   - 「GH 点提交后被必填项拦下 → 用户补答 → retry_gap_rows 放回队列 → 第 2 次」：第 2 次被 `already_attempted_fp` 拦下，驱动只被调用 1 次（期望 2 次）。
   - 「10 家全卡缺信息」：当日 10/10 额度被这 10 家吃光，第 11 家合格岗被 `daily_cap_reached` 挡住。
2. **链上逐提交干净检出**：每个提交一个独立 worktree（scratchpad 的 `vr2-wt-*`，跑完已删），每个提交用单独的假 HOME，CI 四步全跑。

   | 提交 | npm test | role_guard | alpha_gate | node --check |
   |---|---|---|---|---|
   | 0b51484（基线） | 336/336 | 0 | 0 | 0 |
   | 07abffd | 340/340 | 0 | 0 | 0 |
   | 98883a8 | 349/349 | 0 | 0 | 0 |
   | 5eecbfd | 356/356 | 0 | 0 | 0 |
   | e6e7b9e | 364/364 | 0 | 0 | 0 |
   | 2e89862 | 368/368 | 0 | 0 | 0 |
   | f793114 | 373/373 | 0 | 0 | 0 |
   | 652afbc | 389/389 | 0 | 0 | 0 |
   | a0b7359 | 391/391 | 0 | 0 | 0 |
   | 22bc56e | 404/404 | 0 | 0 | 0 |
   | 0638a41 | 404/404 | 0 | 0 | 0 |

3. **突变（16 处，全部复原，worktree 零脏）**：16/16 被杀。包括：忽略 stage、删「带页面判定即 true」、出口表删一行、关同公司 60 天、needs_user 计入重试次数、重试上限差一、关投后不变量、backfill 去掉幂等、跳过崩溃恢复、闸不现读账本、关公司+标题键、「今日」改 UTC、essay 日志把问答放回、关 job_id 撞号检查、关熔断、`isAttempted` 恒真。每处 1-8 条测试变红。
4. **红了辨析**：两条探针红都是**真问题，不是测错**（见 §5 P1）。其余探针的结果是风险记录，不算 bug。
5. **转交**：P1 修法见 §5，需要 builder 施工；本轮不自己修（涉及业务口径，超出 Quinn 边界）。

## 5. 结论明细（第 2 轮）

### ✅ 通过

- **账本永久格式**[实测]：真实库拷贝迁入后，每行键集合**只有一种**：`id, ts, correction_of, era, job_id, apply_url, company_key, title_key, ats, outcome, verdict, may_have_submitted, reason, evidence, answers, work_auth_provenance`，和 ADR-S3 `LedgerEntry` 逐字一致。`append` 缺 `apply_url`、推不出指纹、`may_have_submitted` 不是布尔都会响亮 throw；同 `job_id` 换链接也会 throw。
- **backfill-legacy**[实测，scratchpad 拷贝]：
  - dry-run 不写任何文件：已投 182、驱动跑过的跳过行 33、不迁 28、推不出指纹 0。
  - `--apply` 追加 215 行，核数 `{ok:true, submitted_in_db:182, legacy_unverified_in_ledger:182, fingerprints_match:true}`；账本权限 600；源库 md5 前后一致（只读打开）。
  - 重跑 `--apply` 追加 0、`already_migrated 215`，幂等。
  - 215 个指纹零重复；ts 范围 2026-05-26 至 06-14，今天的 60 天窗口里没有任何公司被占，今日计数 0。
- **33/28 的分类合理**：不迁的 28 行是 24 行纯去重（它们的「本尊」要么已迁入，要么本来就没投过）+ 4 行没有任何 feedback（`not_retry_for_demo_*` ×3、`job_unavailable_closed` ×1）。迁入的 33 行里，29 行是「缺信息」类（stuck 13、profile_specific 5、essay 4、supplemental 2、ashby_validation_loop 2、company_relationship 1、原因为空 1 等），1 行 `ashby_form_not_loaded`，3 行 `not_retry_for_demo_*` / `user_skip_*` 但驱动确实跑过。全部记 `may_have_submitted:true`，是 lead 裁决（未明点 4）的忠实实现。注意：按下文对偏离 1 的判断，这 29 行「缺信息」其实公司没收到；它们是 6 月的旧岗、大多已下架，保持 true 的代价很小，**不建议为此改迁入**，将来需要时可以用更正行改。
- **偏离 2（`stage=pre_dispatch` 不算投过）——正确**：这一行根本没启动驱动，算投过就是让「分数不够」「校验没过」吃掉当日额度。它的 outcome 是 needs_user，也不进点提交前重试计数，所以不会耗掉重试机会。三个驱动都不输出 `stage` 字段[读码 grep 0 处]。小建议（不阻塞）：加一条源码守卫，禁止驱动输出 `stage`，因为推导函数无条件信任这个字段。
- **偏离 3（`PRE_SUBMIT_RETRIES_60D=1`）——正确**：「失败次数 > 1 就拦」，也就是第 1、2 次放行、第 3 次拦，和设计的「满 2 次拦」等价（V6 实跑驱动 2 次，突变 M6 改成差一会被抓住）。builder 解释了为什么不用「最多失败几次」：那种写法改成 0 会一次都不让试，这个理由成立。
- **投前闸最坏意图场景**[实测，真 apply_batch + 替身驱动]：
  - 同岗换编号、同标题：被 `already_attempted_company_title` 拦下。「Product Intern (Summer 2027)」和「Synthesia Ltd / Product Internship – Summer 2027」被认成同一个岗。
  - `?gh_jid=777` 链接和 `boards.greenhouse.io/x/jobs/777` 同号：被 `already_attempted_fp` 拦下。
  - 崩溃在途：驱动跑到一半，apply_batch 被**真 SIGKILL**。孤儿驱动随后吐出了 submitted，但管道已断、没写进结果文件。下次开跑补记为 `crashed/recovered_inflight/true`，驱动 0 次重派。结论是宁可漏记为「可能已提交」，不重投，符合设计。
  - 并发两次运行：两个 apply_batch 同时开跑，一个 exit 1（锁），一个 exit 0；驱动 1 次，账本 1 行。
- **essay_pending**：两个驱动都已剥掉 `answers`（突变 M13 被抓住）；每次 preflight 时 `sweep` 会把它锁成 600。真实家目录历史上的 essay_pending.jsonl（99 行）和其他任何 json/jsonl/md 里都没有 `"answers"` 键[实测 grep，只读]。

### ❌ 真 bug

**P1 ×1 —— 偏离 1：卡在缺信息（needs_user）的岗位被算成「投过」**（命中维度：① 核心业务逻辑、⑤ 主流程；本批引入）

- **现象**[实测]：见 §4 第 1 步的两条探针。
  - 已上线的跟进回路（onboard SKILL :434-443：问用户 → `record_profile_answers` → `retry_gap_rows --apply` → `apply_supervisor --real`）被闸挡死：放回队列的行一律 `already_attempted_fp`。
  - 另外，每一次缺信息都占 1 格当日额度和 1 格同公司 60 天名额。
  - 用户走 essay 流程补答后直接重跑驱动、投成的那一次，记账人会报 `invariant_violation_reapplied` 并 exit 1，是一次假警报[读码]。
- **复现**：`makeBatchRig` → 驱动返回 `{outcome:'needs_user', reason:'stuck_on_same_missing', missing:[...]}` → 把该行 status 改回 `🤖 AI sourced` → 再跑 → 驱动调用次数仍为 1。
- **前端校验拦下时，服务器会不会收到？** 结论：页面列出了必填项错误，就说明表单被拒了，公司那边没有生成申请。唯一的例外是驱动读错页面。依据：
  - [读码] GH 的 `missing` 来自 `.helper-text--error`「This field is required」，Ashby 的来自「Missing entry for required field」。两个驱动都**先**判 `verdict==='submitted'`，判不中、而且页面还留在表单上列着错误时，才会走到 needs_user。
  - [推断，未实测平台行为] 不管校验是在浏览器里做的还是服务器做的，申请都没有被创建。
  - [实测，历史库] 历史上 73 个岗位卡过缺信息，其中 41 个后来重投成功（GH 27、Ashby 14），**0 个**出现过「已经申请过」的提示。而 Ashby 在 Directive 那一例里是会提示重复申请的。这是旁证，不是证明。
- **对「能投出去」的代价**[实测，历史库]：
  - 驱动真跑过的 141 个岗位里，73 个（52%）至少卡过一次缺信息，涉及 62 家公司。
  - 历史 182 条已投里，41 条（22.5%）来自「先卡住、补完再投」。
  - 按偏离 1，这 41 条会永久丢掉。日档位 10 时，按历史比例大约一半额度会耗在被拒的表单上，同一家公司卡两次就锁 60 天。目标名单里 17/22 是 Ashby，损失会集中在最想投的公司。
- **违不违背定稿**：
  - 违背 PRD R5「卡在缺信息的……补上之后自动重新进入候选」，也违背 R1「投过 = submitted 或 unknown」。
  - 违背 DESIGN §3 推导规则 4（needs_user → false），以及 ADR-S6 否决过的方向「会把 needs_user 也算进日额度」。
  - 定稿「投过（含 unknown）永不再投」字面上不包括 needs_user。
  - 但 DESIGN 未明点 7 自己写了「点击后的出口一律改判 true」，设计本身前后矛盾。builder 选了更保守的一边，并且如实申报了，**流程上没有错**；问题出在「点没点过提交」这个判别标准太粗。
- **判断：改。** 改法约 10 行，只动 `driver_contract.mjs` 一处，加测试，驱动不用改：
  ```js
  // 规则 3.5（放在出口表查询之后、兜底 true 之前）：点过提交，但页面留在表单上、
  // 列出了必填项错误 → 表单被拒，公司那边没有收到。按证据判，不按 reason 字符串判
  // （GH 的 reason 是动态生成的，这样就不用去列全）。
  const pageErrors = valid.missing ?? valid.still_missing ?? valid.last_missing;
  if (['needs_user', 'rate_limited'].includes(valid.outcome) && Array.isArray(pageErrors) && pageErrors.length > 0) return false;
  ```
  - 测试：GH/Ashby 每个 needs_user 出口（stuck、classifyUnsubmitted 的各个 reason、essay_pending、manual_required）和 `rate_limited:max_attempts_exceeded` 各一例 → false；needs_user 不带错误清单 → true；本轮两条探针转绿。
  - **连带要求**：S3 的规则 6（needs_info + 填表依据没变就拦）必须和一次性工作库同包落地，否则工作库模式下每次运行都会把同一个缺信息的岗重派一遍。S2 期间全局库里这一行会被标成「跳过未投」，只有 retry_gap_rows 才会把它放回队列，不会循环。
  - `rate_limited` 判成 false 以后会进点提交前重试计数（最多重试 1 次），这个结果可以接受。

**P2 ×1 —— 表单问答漏进 `reports/jobs/*.md`**（命中维度：② 安全边界；早于本包，不是本批引入）

- `job_report.mjs:102` 用 `collectStrings` 在**整个**结果文件里捞所有匹配 `/required|missing|incomplete|gap/i` 的字符串，写进报告的 `gap_fields`。结果文件里带着 `answers[].value`，所以答案原文会被写进去。报告目录 `reports/jobs/` 按 644 创建，也不在 `PII_TARGETS` 里。apply_batch 每派一单都会调它（`apply_batch.mjs:492`）。
- 复现[实测]：结果文件里放 3 条带暗号的答案，跑 `job_report.mjs --row-id 7 --append-submission`。含 gap 和 missing 字样的 2 条答案原文（essay 一句、薪资一句）出现在 644 的 `reports/jobs/7-acme.md:62`。
- 这和 DESIGN §6「问答只出现在账本一处」相矛盾。真实家目录的历史报告里没有答案（grep 0），所以不用清理历史。
- 修法（交 builder，不到 3 行但属于隐私语义，不当 Quinn 修）：`summarizeSubmission` 先对每个 entry 去掉 `answers` 再做 `collectStrings`，并补一条反向断言测试。**排在首批试投之前。**

### ⚠️ 风险 / 🟡 不一致

- **P3 同公司不同写法会绕过 60 天规则**[实测]：`Pika` ×2 + `Pika Labs` ×1，3 个都派出去了（`pikalabs ≠ pika`）。同理 `Runway / RunwayML / Runway AI`、`HeyGen / Heygen Technologies`。历史库 412 个板里没有一个板对应多个公司键，说明**同一来源内部是一致的**；风险在 S4 名单来源和找岗来源混用的时候。建议 S4 按设计「公司名用 slug」，并把板 slug 当作公司键的别名一起计数。
- **P3 SIGKILL 之后锁文件残留**[实测]：下次开跑会响亮拒绝，提示手动删锁。ADR-S8 写了「持锁进程已经不在就自动接管」（`process.kill(pid,0)`），本批没做，BUILD_NOTES 的偏离清单里也没列。是响亮失败，不危险，建议 S3 补上，或者记为偏离。
- **P4 运行跨过午夜，「本次目标数」会失效**[读码]：`todayCount - attempted_today` 在新的一天会变成负数。S2 期间有 `limitRows(--max)` 兜底，不会超投；S3 的 stream_run 要改成按本次运行自己计数。
- **P4 同岗标题换词序**（`Intern, Product` 和 `Product Intern`）认不出来，会再投一次。这是 PM 方向 9 已经接受的限制，列在这里让大家知情。
- **🟡 定稿字面冲突**（DESIGN 未明点 12）仍然没有请拍板人确认措辞。偏离 1 修完以后，建议定稿一并改成「投过（含可能已提交）永不再投；页面拒收的不算投过」。
- **🟡 偏离 4-8**：4、5、6 移交 S3，理由成立；7（legacy 行也必须推得出指纹）是收紧，真实数据 182/182 都推得出，不受影响；8（投后不变量只看账本）的前提是迁入先跑，这已经写在遗留事项里。**在真实家目录跑 `--apply` 之前不能真跑 apply_batch**，这一条 lead 需要守住。

### 未覆盖（如实）

- 真表单上页面拒收的行为（服务器到底有没有收到）：禁止真投，只能靠读码和历史旁证，需要在首批试投时顺便核实（拍板人在场时故意留一个必填项空着，看公司那边有没有邮件回执）。
- 账本 4000 行量级的性能：没有实测。

## 6. Quinn 重构记录（第 2 轮）

零重构。P1 涉及「投过」的口径，P2 涉及隐私语义，都超出 Quinn 的边界，转给 builder。

## 7. 质量 3 指标（第 2 轮）

- 覆盖率：项目没有覆盖率工具，没有数字。改用突变验证，16/16 被杀；逐提交 CI 四步 11/11 全绿。
- `verify_self_miss_rate: 20%`（1/5）。本轮 5 个问题项里，P2 reports 外泄属于上一轮「全仓搜同族外泄口」本该挖出来的同族出口，上一轮漏检了。
- 真 bug 数：2（P1 ×1 本批引入；P2 ×1 早于本批）。

## 8. 老坑清单核查（第 2 轮）

`.claude/arnold/roles/verify.md` 不存在，项目没有定义验收老坑清单。builder 岗位补充说明里的铁律已逐条核对：测试串行 ✓；CI 每一步本地跑（逐提交）✓；主流程冒烟：投递段用真 apply_batch + 替身驱动跑通，跟进回路（缺信息 → 放回 → 再投）**不通**（即 P1）；投递本身禁止真跑。schema_upgrade_path 和 isolation_field 都没填，对应铁律跳过。

## 9. 13 维深查（第 2 轮）

日常模式，不适用。

## 覆盖度评估

**质量分 3/5 —— 回炉（只回炉偏离 1 这一处，其余可以原样保留）。**

账本格式、迁入核数和幂等、投前闸五条规则、崩溃恢复、并发、熔断、essay 隐私都经过独立复现，16 处突变全部咬住，逐提交 CI 全绿，底子扎实。扣分的原因：偏离 1 让「卡在缺信息」的岗位永久封死，还占额度和同公司名额。它掐断了已经上线的「补信息再投」回路，而历史上 22.5% 的已投来自这条回路，也违背了 PRD R5 和设计的规则 4。这正好撞上拍板人的第一判据「能投出去」，所以不能按 4 分放行。

**回炉内容**（builder，预计约半小时）：按 §5 P1 的改法改 `deriveMayHaveSubmitted`，补出口测试，把本轮两条探针转成正式测试；BUILD_NOTES 撤回偏离 1；DESIGN 未明点 7 的措辞由 architect 同步改。**同时建议修**（不改变本次回炉结论，但要排在首批试投之前）：P2 reports 外泄。**要问拍板人的**：定稿「投过」的措辞（未明点 12）。

## 试过的错误方向（第 2 轮）

- **一开始打算只看代价、不看证据，直接按「宁可漏投不可重投」给偏离 1 放行**：反着想之后去数了历史库，52% 的派单卡过缺信息，22.5% 的已投来自补信息后重投，而且 0 次「已申请过」提示。这才把判断从「保守可接受」改成「必须改」。
- **一度想把修法写成「列一张点击后 needs_user 的 reason 白名单」**：GH 的 reason 是 `classifyUnsubmitted` 动态生成的，builder 已经踩过这个坑（他的错误方向 4）。改成按驱动已经附带的页面错误清单（`missing / still_missing / last_missing`）来判，靠证据，不靠字符串。
- **SIGKILL 探针第一版以为孤儿驱动的 submitted 会被补记成 submitted**：实际管道已断，结果文件里没有结局，补记为 recovered_inflight/true。这是正确的保守行为，没有据此报 bug。

---

# 第 3 轮 — 回炉第 1 轮复验（5284ff5 / 180a640 + 文档 2cc0d76）

> Mode: daily。硬边界同前：没有真投递；真实家目录 stat 快照开工和收工 diff 为 0；没有 push；没有提交代码。探针放在独立 worktree `scratchpad/vr3-probe`，跑完已删。

## 验收范围

复验上一轮的 P1（needs_user / rate_limited 带非空页面错误清单时判「没投过」）和 P2（job_report 先剥掉答案，reports/jobs 锁 600 并加进 PII_TARGETS）。另外做四件事：用最坏意图打反向漏洞（驱动把页面读错、带空的或伪造的错误清单，会不会让其实已经提交的岗被重投）；带暗号的答案全库再扫一遍；判断 Lever 那处没处理的要不要挂账；逐提交跑 CI。

## 5 维高危区评估

- ① 核心业务逻辑（最高）：新规则把一类结局从「投过」挪到「没投过」，方向错了就是重投。所以本轮重点不是「修好了没有」，而是「有没有放过不该放的」。
- ② 安全边界（高）：P2 修法只剥了顶层 `answers`，要查嵌套字段和其他驱动。
- ③ 性能：不涉及。
- ④ 集成点：不涉及真网络。
- ⑤ 主流程（高）：补信息回路（缺信息 → 放回队列 → 再投）要真的通。

## 7 类测试

- ① 等价类（11 次）：outcome × 错误清单形态（空数组、`missing` 为空但 `still_missing` 非空、字符串、对象、null、没有这个字段；以及 unknown / crashed / captcha_blocked / not_submitted 带清单、needs_user 带清单同时带 verdict）→ 全部 true。
- ② 边界值（2 次）：清单里只有 `['']` 或 `['  ']` → false（见 ⚠️）；rate_limited 页面拒收时，重试上限在第 2 次放行、第 3 次拦。
- ③ 决策表：规则顺序是 stage → verdict → 出口表 → 页面证据 → 兜底 true。上面 11 例证明页面证据只对 needs_user / rate_limited 生效，并且排在 verdict 之后。
- ④ 状态迁移（1 次）：needs_user/false → 放回 AI sourced → submitted/true。
- ⑤ 用例测试（2 次）：真 apply_batch + 真记账人跑补信息回路；带暗号答案跑真 job_report。
- ⑥ pairwise：N/A，只新增了一个判定维度。
- ⑦ 风险驱动（2 处突变）：拿掉 P1 那一行，3 条测试变红；拿掉 P2 的剥答案，1 条测试变红。

## 结论明细（第 3 轮）

### ✅ 通过

- **P1 已修**[实测]：
  - 上轮的断路场景：第 2 次派出去并投成，账本记为 `needs_user/false → submitted/true`。
  - 额度场景：10 家缺信息，第 11 家照常投，驱动共调用 11 次。
  - rate_limited 页面拒收：第 3 次运行被拦，驱动共调用 2 次。
- **反向漏洞：没有发现可利用的口子**[实测 + 读码]：
  - 空数组、非数组、null、没有字段都是保守 true。`??` 只在字段不存在时往下找，所以 `missing: []` 时不会去看 `still_missing`，这也是更保守的一侧。
  - 只要带了 verdict（页面读过），就排在前面判 true。
  - unknown、crashed、captcha、not_submitted 带清单也仍然是 true。
  - 驱动真把页面读错的最坏情况：公司已收到，但驱动读出了必填项错误。这要求页面同时满足两点：没被判成提交成功，并且表单还在、上面有可见的字段错误。GH 和 Ashby 提交成功后表单会被整体替换掉，所以这是**残余风险**。它只在「页面读取器出错」时才会发生，没法用单测消除，要在首批试投时核实（上一轮已写）。
- **P2 已修**[实测]：
  - 带暗号的答案跑真 job_report：报告里不再有答案，文件是 600、目录是 700。
  - 用真 apply_batch 跑全家目录扫描：暗号只出现在账本（600）和 run-tmp 里的结果中转文件（600）；feedback 表 0 行。
  - 读码：GH/Ashby 的嵌套字段（`blockers[].detail`、Ashby 的 `detail: a`）只装题目和 note，**不带答案值**。
- **逐提交 CI**（每个提交单独 worktree + 假 HOME）：

  | 提交 | npm test | role_guard | alpha_gate | node --check |
  |---|---|---|---|---|
  | 5284ff5 | 408/408 | 0 | 0 | 0 |
  | 180a640 | 409/409 | 0 | 0 | 0 |
  | 2cc0d76 | 409/409 | 0 | 0 | 0 |

### ⚠️ 风险 / 挂账

- **Lever 填表值 → 挂账（P3，恢复 Lever 前必修，不阻塞本次推送）**：
  - [读码] `lever_apply_driver.mjs:428,480` 的 `fill` / `answer_pass` 里带着填表值。记账人只剥顶层 `answers`，所以这些值会进 feedback 表；job_report 里含 gap/missing 字样的值也会进报告（报告现在已经是 600）。
  - 现在不会被触发：自动队列只收 `SUPPORTED_AUTO_PLATFORMS = {greenhouse, ashby}`（`apply_url_classification.mjs:3`），Lever 不会被派单。
  - 建议写进 TASK 待解，作为「恢复 Lever」的前置条件：Lever 的值统一走 `answers`，或者记账人和 job_report 按白名单保留字段。
- **P4 清单里全是空白串时判 false**：`['']` / `['  ']` 会判 false。GH 的 `addMissing` 会滤掉空串；Ashby 的 `trim` 以后理论上可能是空串，但那一行本身是「Missing entry for required field」这句拒收文案抓到的，证据仍然成立。不改也可以；想更严就改成「至少有一个非空白项」。
- **遗留（同上轮，未变）**：S3 必须同包落地规则 6，否则工作库模式下同一个缺信息的岗每次运行都会被重派，BUILD_NOTES 已写明。另外，同公司不同写法、锁文件残留、跨午夜这 3 条 P3/P4 仍然挂着。

## 5 轮回归循环记录（第 3 轮）

1. 上一轮的两条红探针，builder 已转成正式测试，现在都是绿的，我也在独立 worktree 里复跑了。
2. 逐提交 CI 全绿（见上表）。
3. 2 处突变都被抓住。
4. 没有新的红。
5. 不需要转交。

## 覆盖度评估

**质量分 4/5 —— 可推。** 真 bug 数为 0。

- P1、P2 都独立复现修好了。反向漏洞按最坏意图打了 11 种形态，全部保守；两处修复都有测试咬住；逐提交 CI 全绿。
- 扣 1 分：「驱动读错页面」这类残余风险只能在首批试投时核实；Lever 填表值要挂账。
- 推送以后仍然守住两条：在真实家目录跑 `backfill-legacy --apply` 之前不能真跑 apply_batch；S3 规则 6 落地之前不能在工作库模式下放量。

- `verify_self_miss_rate: 0%`（0/2，本轮 2 个问题项都不是上轮该发现而漏掉的）。
- Quinn 重构：零。

## 试过的错误方向（第 3 轮）

- **第一版 P2 全库扫描用 harness 替换 job_report**：报告根本没生成（harness 的派单行不满足 job_report 的选行条件），扫出 0 处泄露，差点当作「已修」的证据收下。改成直接跑真 job_report 并放入带暗号的结果文件，才确认顶层已剥、嵌套 detail 仍会被收录，再逐个读码核对 GH/Ashby 的嵌套字段里没有答案值。
- **一度把「清单全是空白串判 false」当成反向漏洞**：追到 Ashby 的抓取逻辑，这类行本身就是被「Missing entry for required field」这句拒收文案抓出来的，证据成立，降为 P4 可选加固。

---

# 第 4 轮 — 即找即投 S3+S4（10d78de..e0b763a 十个代码提交 + 文档 9185cb2）

> Mode: daily。硬边界：没有真投；真实 `~/.mrweirdo-jobs/` 只读（`jobs.db` 开工与收工 mtime/size 都是 1782006129 / 1728512，`log/` 下仍无 `submissions.jsonl` / `seen.jsonl`，无 `run-tmp`）；backfill `--apply` 只在沙箱拷贝上跑；没有 push、没有提交代码。独立 worktree 在 `scratchpad/wt`（tip 9185cb2），逐提交 CI 在 `scratchpad/pc_<sha>`，测试一律用假 `MRWEIRDO_HOME`。自写场景 3 个文件（`test/zz_verify_s3s4*.test.mjs`，只在 scratchpad，不入库）。外网只做只读 GET（Ashby / Greenhouse 公开板接口 30 次左右）。

## 验收范围

S3（看过记录 seen_log、规则 6、一次性工作库 initRunDb、store 写看过、greenhouse 两处写死路径、apply_batch 流式模式 + 陈旧锁接管 + 崩溃恢复共享、stream_run 状态机、收工报告修正）+ S4（名单优先 watchlist 来源 + 21 家预置名单）。重点按派遣单 7 条：跨运行零重复（自写端到端场景，不只信 builder 的 V1）、13 条偏离逐条判、feedback.jsonl 不计入打分依据版本、greenhouse 写死路径残留、watchlist 实测、隐私落盘、逐提交干净检出跑 CI。

## 5 维高危区评估

- ① 核心业务逻辑（最高，测试密度最大）：跨运行零重复投递 / 零重复打分 = 拍板人硬指标。风险点在「两道闸（打分前去重闸、派单前闸）口径是否一致」「崩溃窗口」「同岗不同写法」「依据版本作废」。本轮 15 个自写场景里有 11 个打这一维。
- ② 安全边界（高）：看过记录、运行目录、崩溃恢复的合成文件会不会把 JD 正文 / 问答 / 分数留在家目录；文件权限。
- ③ 性能（中）：一次性工作库 + 每行现读账本；名单 21 家扫描耗时（builder 实测 19 秒），本轮只抽样不压测。
- ④ 集成点（高）：名单 slug 是否真是那家 AI 视频公司、接口 404 / 挂掉会不会被当成「没岗位」。
- ⑤ 主流程（高）：找岗 → 去重 → 打分 → 投 → 报告 → 删运行目录，在真实数据拷贝上走一遍（不提交）。

## 7 类测试

- ① 等价类（6 次）：候选按「账本已尝试 / 看过不合适 / 看过下架 / 看过缺信息 / 全新 / 本次运行内重复」分类，各至少一例进 gate；结局按 submitted / unknown / needs_user(带清单) / not_submitted:job_unavailable / crashed:出口表 / 进程被杀 分类。
- ② 边界值（5 次）：合适数 = N、合适数 > N（N=3、8 个合适）、N 超档位（N=50、档位 10）、批次 50 条边界（60 / 70 / 120 岗）、JD 只改空白 vs 改一个字。
- ③ 决策表（1 张）：identityBlock 规则 2-6 × 两道闸，用 C / G / H / E 场景逐格核对（指纹命中、公司+标题命中、公司 60 天满 2、投前失败超 1、缺信息且档案没变）。
- ④ 状态迁移（4 次）：stream_run 的 start → next → submit-scores → finish，及异常迁移：submit 后不 finish 就重开（B1）、驱动中途整组 SIGKILL（B2）、批次发出未交分就 finish（F）、另一会话中途 start（L / X）。
- ⑤ 用例测试（2 次）：真实家目录拷贝上「未迁历史拒绝开跑 → backfill 核数 182=182 → 名单 4 家 + 1 家假 slug 真接口扫描 → 去重闸 → 出批次 → 收工」；以及全链路假板连跑两次（A）。
- ⑥ pairwise（1 次）：档案变化维度 {profile 字段顺序变, essay_profile 变, search_intent 变} × 看过类别 {not_fit, needs_info}，取 3 组两两覆盖（Jd、E）。
- ⑦ 风险驱动（3 处突变）：删掉 gate 的看过命中 → V1 变红；afterBatch 不写 needs_info → 规则 6 变红；identityBlock 去掉公司+标题键 → V2/V3 变红。3/3 被测试咬住。

## 5 轮回归循环记录（第 4 轮）

1. 写测试：自写 15 个场景（A、B1、B2、C、Jd、E、F、G、H、I、J、L、M、N、W、X、P，见下表），其中 L / X / N / B2 在现代码上**复现了问题**（断言写成打印，结论见 ❌ / 🟡）。
2. 全套：tip 上 builder 448 条 + 我 17 条；逐提交 CI 见下表。
3. 辨析：L / X 为真 bug（并发）；N 为设计与定稿字面冲突；B2 报告缺一行为真 bug；另有 2 处由接口实测发现（runway slug、404 静默）。
4. 修后重跑：本轮不修（都超出 Quinn 1-3 行界限或涉及设计选择）。
5. 转交：4 个真 bug + 1 个设计决定转 lead。

**跨运行零重复 —— 自写场景结果**（真 stream_run + 真记账链路，替身只在岗位板 / 驱动 / 打分器 / Chrome）：

| 场景 | 做法 | 结果 |
|---|---|---|
| A 多批投满即停连跑两次 | 120 岗、12 合适、N=5 | 两次共派 10 次，**0 个网址被派两次**；第 2 次打分 50 个，与第 1 次交集 0 |
| B1 跑到一半被杀 | 第 1 批投完后不 finish，直接开新运行 | 第 2 次打分 0、派单 0；旧运行目录被清 |
| B2 驱动中途整组 SIGKILL | 在途标记留着、锁文件残留 | 新运行先把该岗补记 `crashed/recovered_inflight/可能已提交`，陈旧锁被接管，**该岗不再派**；只派了没轮到的那一家 |
| C 同公司不同写法 | 账本「HeyGen, Inc.·Growth Marketing Internship」、「Stability AI」×2、「Black Forest Labs」；板上 `heygen·Growth Marketing Intern`（新编号）、`stabilityai·Intern C`、`black-forest-labs·Research  Intern` | 三个都拦下（公司+标题 2、公司 60 天 1），换了标题的 HeyGen 新岗照常投（公司第 2 次，合规） |
| G 历史不重投 | 账本 legacy 行，板上同编号 + 同公司同标题新编号 | 打分 0、派单 0 |
| H unknown / 60 天 2 次 | 第 1 次 unknown；同公司再挂 2 个；另一家挂 3 个 | unknown 不重投且算 1 次（只再投 1 个）；3 个合适只投 2 个 |
| I / W 投前失败 | 出口表 `crashed:ashby_form_not_loaded` | 同一运行内下一批**不会**马上重试；第 2 次运行重试 1 次；第 3 次不打分不派 |
| Jd JD 变 / 方向变 | JD 只改空白、改一个字；再改 search_intent | 只改空白不重看；改字只重看那 1 个；改方向后 5 个不合适全重看，已投的不重打不重投 |
| E 档案变 | 缺信息岗；profile 字段换顺序；再改 essay_profile | 换顺序不算变（不重看）；essay_profile 变 → 重进候选并投出 |
| F 没打完就收工 | 批次发出未交分 + 池里剩 20 | 第 3 行写「还有 70 个新岗没打分就收工了」；游标不前进；第 2 次 70 个全部打分 |
| J 额度封顶 | 档位 10、N=50、40 个合适 | 第一行「你要 50，今天档位 10，今天已尝试 0/10，本次最多投 10」；投 10 |
| P 投完到写看过之间崩 | 删掉 needs_info / expired 两行看过记录再跑 | 这 2 个岗重打分 + 重派 1 次，结局仍是页面拒收 / 已下架（都判「没投过」），**没有重复提交**；代价 = 2 次打分 + 2 次驱动 |
| N 合适数多于 N | 20 岗、8 合适、N=3，第 2 次用 `--no-submit` | **第 2 次重打分 5 个，与第 1 次交集 5**（见 🟡） |
| L / X 两会话并发 | A 跑到一半，B `start` | 见 ❌ BUG-1 |
| M 落盘 | 带暗号 JD 与答案跑一遍 | 见隐私 |

**结论：跨运行零重复投递 —— 在全部场景里成立**（含崩溃、被杀、重发换编号、不同写法、历史、unknown）。**零重复打分 —— 在「本批合适数 ≤ 剩余目标数」时成立；合适数多于剩余目标数时不成立**（见 🟡 Y1）。

**逐提交 CI**（每个提交单独 worktree + 假 HOME，CI 四步）：

| 提交 | npm test | role_guard | alpha_gate | node --check |
|---|---|---|---|---|
| 10d78de | 418/418 | 0 | 0 | 0 |
| cee6e48 | 420/420 | 0 | 0 | 0 |
| 49173b2 | 422/422 | 0 | 0 | 0 |
| 634d1a8 | 423/423 | 0 | 0 | 0 |
| 52ef827 | 426/426 | 0 | 0 | 0 |
| 9b3e2b4 | 431/431 | 0 | 0 | 0 |
| efcf38d | 435/435 | 0 | 0 | 0 |
| d8ff260 | 447/447 | 0 | 0 | 0 |
| e0b763a | 448/448 | 0 | 0 | 0 |
| 9185cb2 | 448/448 | 0 | 0 | 0 |

## 结论明细（第 4 轮）

### ✅ 通过

**V1-V13 逐条**：

| # | 结论 | 证据 |
|---|---|---|
| V1 连跑两次 | ✅（附条件，见 Y1） | builder V1 + 我 A / B1：第 2 次派单 0、账本不增 |
| V2 第 2 次有新货 | ✅ | builder V2 在 tip 与逐提交全绿 |
| V3 重发换编号 | ✅ | builder V2/V3 + 我 C（不同写法也拦） |
| V4 历史不重投 | ✅ | 我 G；沙箱真实数据 backfill 核数 182=182 |
| V5 unknown 不重投 | ✅ | 我 H |
| V6 投前失败重试 1 次 | ✅ | 我 I / W |
| V7 JD 变只重看那 1 个 | ✅ | builder V7 + 我 Jd（空白不算变） |
| V8 换简历 / 方向作废 | ✅ | builder V8（简历）+ 我 Jd（方向） |
| V9 同公司 60 天 2 次 | ✅ | 我 H |
| V10 额度封顶 | ✅ | 我 J |
| V11 看的上限 | ✅ | builder V11 全绿 |
| V12 不存岗位库 | ✅ | 我 M：家目录只多 `log/seen.jsonl`(600)、`log/submissions.jsonl`(600)、`source_cursor.json`；运行目录删净。沙箱真实数据收工后 `run-tmp` 为空 |
| V13 隐私 | ✅ | 我 M：JD 暗号 0 处；答案暗号只在账本（定稿明写账本存「当时填的答案」，600） |

**13 条偏离逐条判**：

1. **看过记录（下架 / 缺信息）由 stream_run 每批投完后写** —— 接受。崩溃在「投完」与「写看过」之间的代价实测（场景 P）：只多 2 次打分 + 2 次驱动，结局都是「没投过」，不会重复提交；账本是「投过」的唯一口径，看过记录丢一行只花钱。旧流程不写这两类，本来就靠 retry_gap_rows，不受影响。
2. **没加 `--no-cursor-advance`** —— 接受。场景 F 实测：窗口没用完游标不动，下次接着看。
3. **`initRunDb` 多显式 path、已存在就拒** —— 接受，更安全。
4. **`checkDispatch` 必带 seen** —— 接受，漏传响亮报错（读码 `apply_guard.mjs:144`）。
5. **流式模式跳过 job_report / apply_report / 队列诊断 HTML** —— 接受，与定稿「不存岗位库 / 分数」一致。读码：`reports/jobs` 的消费方只有 apply_batch / supervisor_preflight / demo_check，流式模式下无人依赖；投递报告由 3 行报告（拍板 ⑥）替代。无功能损失；「持续跟进」今后读账本属 S5（看板改数账本）。
6. **陈旧锁自动接管** —— 接受，场景 B2 实测 SIGKILL 留下的锁被接管、下一次运行正常。
7. **崩溃恢复抽成共享模块，输出改 stderr** —— 接受，B2 实测。
8. **pre_dispatch 失败也记 needs_info** —— 接受，流式模式下几乎不出现。
9. **推不出指纹不写看过、计数报警** —— 接受。
10. **打分依据版本不计入 feedback.jsonl** —— **合理，接受**。[实测] 真实 `feedback.jsonl` 126 行，每次投递 / 跳过都会追加（`cover_letter_materials.mjs:322,350` 等），计入的话每次运行都会让全部「不合适」作废重看，硬指标直接失效。代价：拍板人新加的「跳过」偏好不会让已判不合适的岗重看——方向是更严，不会多投错岗；方向类大改走 search_intent，会作废。company_list.user.json 不计入只影响 `quota_guarded` 一个原因，接受。
11. **轮转只扫 GH + Ashby** —— 接受（只有这两个能自动投）。
12. **held_for_review 无写入方** —— 接受，归 S5。
13. **预置名单不自动生效** —— 确认：全库只有测试文件引用 `watchlist_ai_video.json`，要等 S5 写进 search_intent。

**greenhouse 两处写死 jobs.db 路径** —— 已修且无残留。全库 grep：`shared/` 下的 `jobs.db` 字样只剩 `local_db.dbPath()` 默认值、apply_batch 流式防呆、stream_run 历史前置、doctor 体检、注释；所有驱动里 0 处；`sqlite3` 命令行调用 0 处。附带语义变化：「投过我们吗」由查 jobs.db 改成查账本（含迁入历史、含 unknown），更保守，接受。技能说明书（`.claude/skills/*-auto/SKILL.md`、tracker、confirm 等）仍写着 jobs.db，属 S5 编排改写范围，列入待办。

**沙箱真实数据主流程**：拷贝家目录（13M，不含 chrome-profile）→ 未迁历史 `start` 拒绝（提示 backfill）→ 拷贝上 `backfill-legacy --apply`：`submitted_in_db 182 / legacy_unverified 182 / fingerprints_match true`，共追加 215 行 → 名单 5 家（含 1 家假 slug）真接口扫描 56 岗，硬过滤后 1 个进批次 → `finish` 第 3 行「还有 1 个新岗没打分就收工了」，运行目录删净。遗留 legacy 公司名与链接 slug 核对：161 条 GH/Ashby 已投里，归一后公司名与 slug **0 处不一致**，所以名单 / 轮转用 slug 不会绕过 60 天规则。

### ❌ 真 bug（4 个；都不会造成重复投递）

**BUG-1（P2，命中 ① 核心 / 并发）两个会话同时跑，后开的会话会删掉先开的运行，并把对方正在跑的派单当成崩溃补记**
- 读码：`stream_run.mjs` 的 `start` 无条件 `recoverInflight` + `cleanOldRuns`（删掉所有 `stream-*` 目录），都不看 `locks/apply_batch.lock` 的持有进程是否还活着。
- 复现 L：A `start` → `next`（批次待交分）；B `start` → A 的运行目录被删；A `submit-scores` 报「no run … start a new run」退出 1。
- 复现 X：A 的驱动正在跑（在途标记在、锁被 A 持有），B `start` → B 把 A 的这一单记成 `crashed / recovered_inflight / 可能已提交`，删 A 的目录；A 的 apply_batch 写批次摘要时 ENOENT 崩溃。账本只有 B 补记的那一行，A 那一单的真实结局（6 秒后 submitted）丢了，A 剩下的合格岗没派。
- 后果：不会重投（补记是「可能已提交」），但一次真实提交被记成「不确定」、当次运行中断。与 DESIGN §4.5「两个会话工作库互相独立」和 §4.2 不变量相违。
- 修法方向（交 bug / builder）：`start` 先看 apply_batch.lock 持有进程是否活着，活着就拒绝开跑（或跳过恢复与清理）；`cleanOldRuns` 只清「持有锁的进程已不在」的运行。约 10-20 行，跨两个文件。
- 拍板人会同时开 Claude Code / Codex 两个窗口，这不是纸面场景。**首批试投前必修。**

**BUG-2（P2，命中 ④ 集成点）预置名单里的 `runway` 是另一家公司**
- [实测] `api.ashbyhq.com/posting-api/job-board/runway` 返回 4 个岗，JD 开头都是「Runway is a collaborative business planning platform」——这是做财务规划软件的 Runway，不是 AI 视频的 Runway（RunwayML）。`runwayml` 在 Ashby / Greenhouse 都是 404。其余 20 家逐家抽 JD 核对，都是对的公司。
- 后果：S5 把名单写进 search_intent 后，名单第一家会去扫、打分、按「名单公司」待遇处理一家无关的公司；真正的 Runway 没被覆盖。
- 修法：把 runway 移进 `skipped` 并写明原因，Runway 的真实招聘渠道另查。**S5 之前必修。**

**BUG-3（P3，命中 ④ 集成点）名单公司的招聘板 404 被静默当成「这家没岗」，报告不列名**
- 读码：`ashby_board_api.fetchJobs` 404 → `[]`，`greenhouse_board_api.fetchJobs` 404 → `[]`；`watchlist_source` 只在抛错时 `reportError`。
- 复现：沙箱里加一家 `nonexistent-co-xyz`，`finish` 的 `source_errors` 为 `[]`，第 2 行没有「名单里 1 家没扫到」。
- 后果：违背 PM 次指标「名单 100% 扫到，挂掉的列名」。公司换了招聘系统或改了 slug，名单会悄悄失效。轮转扫几千家时 404 静默是对的，但名单是人工挑的，404 应该报出来。
- 修法：名单来源对 404 单独报错（需要板接口把「404」和「空板」区分开）。S5 之前修。

**BUG-4（P3，命中 ⑤ 用户体验）开跑时补记的「可能已提交」，3 行报告里不出现**
- 复现 B2：新运行补记了上次被杀那一单（unknown），报告第 2 行却是「没投成 0 个」。提示只打在 stderr。
- DESIGN §4.2 写的是「报告『没投成』里列出，请人看截图」。拍板人只看 3 行，会不知道有一家可能投上了。
- 修法：`start` 把补记结果写进 state，`finish` 的第 2 行带上。约 5 行。首批试投前修。

### 🟡 设计不一致（需要 lead 裁决）

**Y1 定稿写的「零重复打分」，在「本批合适数多于剩余目标数」时做不到**
- 复现 N：20 岗、8 个合适、N=3。第 1 次投 3 个后停；第 2 次重新打分那 5 个没投的合适岗（与第 1 次交集 5）。builder 旧观察 2 已申报，理由是分数不许过夜（V12）。
- 影响：
  - 不会重投，只多花打分钱，最多一批。
  - 但定稿 `docs/specs/restart-apply.md` 把「第二次零重复打分」写成硬指标。
  - PM 的真环境复验法「第 2 次打分列表与第 1 次无交集」，在首批「跑 2 个」时只要那一批里有 3 个以上合适岗，就会按字面判失败。
- 两个选项：
  - A. 看过记录加一个短期代码（例如 `fit_unapplied`，7 天，不存分数，只存「合格未投」），下次直接进候选、不重打分。代价：多一个代码，有点像「存了判断」。
  - B. 接受这个代价，把定稿和复验法改成「零重复投递；打分只可能重看上次合格未投的岗」。
- 我倾向 B（成本小，V12 更干净），但这是改定稿措辞，需要拍板人点头。

### ⚠️ 风险 / 挂账

- **一个推不出指纹的候选会让整次运行中断**：`gate` 里会抛错，这是设计上的 Fail Fast。实测：遗留 634/634、名单 21 家、抽 5 个大 GH 板（stripe / airbnb / databricks / robinhood / pinterest，2061 岗）都是 0 个推不出指纹，概率低。首批试投时留意。
- **崩溃恢复的合成结局文件**（`recovered-inflight-*.jsonl`）写在 `run-tmp` 根目录，不在 `stream-*` 里，不会被清理。内容只有 run_id 和路径，没有答案，只是杂物。P4。
- **运行被放弃**（不 finish，也不再开新运行）时，运行目录（含 JD、问答中转文件）会留在 `~/.mrweirdo-jobs/run-tmp`（目录 700、文件 600），直到下一次 `start`。可接受。
- **名单未生效、技能说明书仍写 jobs.db、D10 过目**：都归 S5。
- **真表单行为**：驱动仍全是替身，首批试投时核实（同前几轮）。

### 未覆盖（如实）

- 一整圈轮转（9 个窗口 × 约 17 分钟）没有实跑，只做了窗口 0 与游标逻辑。
- 一年量级（约 4000 行账本）的读账本耗时没压测。
- 真 Chrome、真表单：禁止真投，未覆盖。

## 6. Quinn 重构记录（第 4 轮）

零。4 个 bug 都超出 1-3 行或跨文件或涉及设计选择；runway 那条是数据取舍（换哪家、放哪），交 builder。

## 7. 质量 3 指标（第 4 轮）

- 覆盖率：项目没有覆盖率工具，没有数字。用 3 处突变 3/3 被咬住作为替代证据。
- 真 bug 数：4（P2×2、P3×2），另有 1 个设计不一致。
- `verify_self_miss_rate: 0%`（0/5，本轮 5 个问题项都在本批新代码 / 新数据里，不是上轮该发现而漏掉的）。

## 8. 老坑清单核查（第 4 轮）

岗位补充说明里 verify.md 不存在，项目未定义老坑清单。按 builder.md 家规核了两条：测试串行（逐提交 `npm test` 均为 `--test-concurrency=1`）；CI 四步逐提交全跑。上一轮挂的 3 条（同公司不同写法、锁文件残留、跨午夜）本批已处理：前两条本轮实测通过（C、B2），跨午夜有 builder 测试并在逐提交里全绿。

## 覆盖度评估

**质量分 3/5 —— 回炉（范围小）。**

- 硬指标「跨运行不重复投递」：在 15 个自写场景里全部成立，包括被杀、驱动中途崩、重发换编号、不同写法、历史、unknown。三处关键闸的突变都被测试咬住。逐提交 CI 全绿。代码本体质量好。
- 扣分原因：
  - BUG-1 并发，违背设计承诺，拍板人两个窗口同开时会把一次真实提交记成「不确定」。
  - BUG-2 名单第一家指错公司。
  - Y1 定稿里写明的「零重复打分」硬指标，在一个常见条件下不成立，且首批真环境复验会按字面判失败。
  - 拿不准 3 还是 4，按规矩打 3。
- 回炉清单（都不涉及重投逻辑本身）：
  1. BUG-1（约 10-20 行）；
  2. BUG-4（约 5 行）；
  3. BUG-2（数据文件一行移位）；
  4. BUG-3（S5 前修，可同包也可挂 S5）；
  5. Y1 请拍板人选 A / B。
- 事实补充，供 lead 判断推送：这批代码在 S5 编排改写和真实家目录 backfill 之前不会被任何现有入口调用去真投，推送本身不会触发投递。

## 试过的错误方向（第 4 轮）

- **场景 N 第一版用 `2000+i` 做岗位编号**：标题变成「Growth Intern 2000」，被 `expiredStudentRoleYear` 当成过期年份判不合格，结果「8 个合适 0 个投」，差点当成 bug。查 `eligibility.mjs:58` 才知道是夹具问题，改成 `30000+i` 以后复现出真实现象（重打分 5 个）。这也顺带说明：`expired_title_year` 这类不合格原因也会进看过记录，60 天内不再看，这是对的。
- **一开始以为崩溃窗口（投完到写看过之间）会导致缺信息岗被重投**：实测 P，重派的结局仍是页面拒收（判「没投过」），不是重复提交，代价只有钱。降为接受。
- **一度打算把名单抽样只看 HTTP 200**：200 只能说明板子存在。改成逐家读 JD 开头核对公司身份，才发现 runway 指错了公司。

---

# 第 5 轮 — S3+S4 回炉复验（5af0d81 / e80046e / 033f48f / 8865f00 / c7e5514 + 文档 cac8083）

> Mode: daily。硬边界同前：没有真投；真实家目录开工与收工都是 `jobs.db` 1782006129 / 1728512，`log/` 下无账本和看过记录，`locks/` 为空，无 `run-tmp`；没有 push、没有提交代码。独立 worktree `scratchpad/wt5`（tip cac8083），逐提交在 `scratchpad/p5_<sha>`，测试一律用假 HOME。自写场景 2 个文件（`zz_v5_lock` / `zz_v5_dedupe`，不入库）。外网只做只读 GET（名单 21 家 + 2 个假 slug）。

## 验收范围

复验第 4 轮 4 个 bug 的修法：① 运行级互斥锁（start 占、finish 放；另一窗口开跑响亮拒绝；`--abandon` 放弃；派单进程活着一律拒）② runway 改 `runway-ml` ③ 名单板 404 列名 ④ 开跑补记的「可能已提交」进报告第 2 行。另外按 lead 裁决 B 的新口径（零重复投递 + 已判不合适零重复打分；合格未投的可以重打分），复核零重复。并发锁按最坏意图打：锁文件残留、进程被 kill -9、PID 复用、同时开跑、放弃一个其实还活着的窗口。逐提交跑 CI。

## 5 维高危区评估

- ① 核心业务逻辑（最高）：新锁如果判错，会出两种问题：放进两个运行（又回到 BUG-1），或者永远拒绝（工具卡死）。新口径下仍要保证零重复投递。
- ② 安全边界（中）：锁文件是新增的落盘项，要看权限和残留。
- ③ 性能：不涉及。
- ④ 集成点（高）：runway-ml 是不是那家 AI 视频公司；404 是否真的报出来。
- ⑤ 主流程（高）：被放弃或被杀以后，下一次能不能自救开跑。

## 7 类测试

- ① 等价类（5 次）：
  - 运行锁 × {不存在、指向活运行目录、指向已消失目录、坏 JSON}；
  - 派单锁 × {不存在、pid 已死、pid 活着但是无关进程}。
- ② 边界值（2 次）：
  - `--abandon` 带错运行号 / 没有运行可放弃；
  - 两个 start 在同一时刻发起。
- ③ 决策表（1 张）：claimHome 的「派单锁活? → 运行锁在? → 目录在? → abandon 匹配?」四层逐格核对（K9 / PID / RES / AB）。
- ④ 状态迁移（4 次）：
  - A 驱动中途整组 kill -9 → B 普通 start → B `--abandon`；
  - A 被放弃后再 submit / finish；
  - A 在 store 阶段（还没拿派单锁）被 B 放弃；
  - 同时开跑。
- ⑤ 用例测试（2 次）：
  - 新口径 120 岗连跑三次；
  - 混合场景（不同写法、历史、unknown、60 天 2 次、投前失败）连跑三次。
- ⑥ pairwise：N/A，新增的维度只有锁状态，已在决策表里穷尽。
- ⑦ 风险驱动：并发与自救是本轮唯一新代码面，12 个场景里有 6 个集中打这里。

## 5 轮回归循环记录（第 5 轮）

1. 写测试：8 个自写场景（K9、PID、RES、AB、RACE、GAP、DD、MIX）。
2. 全套：tip 453 条全绿 + 自写 8 条；逐提交 CI 见下表。
3. 辨析：RACE 为真问题（见 ❌）；PID / RES / GAP 为风险，按严重度挂账。
4. 不修（RACE 修法要改锁的判断顺序，超出 Quinn 界限）。
5. 转 lead。

**逐提交 CI**（CI 四步，独立 worktree + 假 HOME）：

| 提交 | npm test | role_guard | alpha_gate | node --check |
|---|---|---|---|---|
| 5af0d81 | 448/448 | 0 | 0 | 0 |
| e80046e | 449/449 | 0 | 0 | 0 |
| 033f48f | 452/452 | 0 | 0 | 0 |
| 8865f00 | 452/452 | 0 | 0 | 0 |
| c7e5514 | 453/453 | 0 | 0 | 0 |
| cac8083 | 453/453 | 0 | 0 | 0 |

## 结论明细（第 5 轮）

### ✅ 通过

- **BUG-1 并发（主体已修）**[实测]：
  - L：窗口 A 没收工时，B 开跑响亮拒绝，并提示 `finish` 或 `--abandon`。builder 的测试也证明 A 能照常收尾。
  - X：派单锁的持有进程活着时，B 开跑连 `--abandon` 也拒绝，不补记、不动在途标记。
  - K9（kill -9 最坏情况）：A 在驱动中途整组 SIGKILL。B 普通 start 被拒；B 用 `--abandon A` 后：
    - 陈旧派单锁被接管；
    - A 那一单补记为 `crashed / 可能已提交`；
    - 只派了没轮到的 1 家，**零重派**；
    - 收工后运行锁已释放。
  - AB：
    - `--abandon` 带错运行号 → 拒；没有运行可放弃 → 拒。
    - 被放弃的 A 再 `submit-scores` / `finish` 都失败退出，且**不会释放 B 的锁**。
    - 之后第三个 start 仍被 B 的锁拒绝。
    - 全程驱动 0 次。
  - RES：运行锁指向已消失的目录 → 自动清；派单锁 pid 已死 → 放行，正常投出 1 个。
- **BUG-4 已修**[实测 K9]：第 2 行为「没投成 0 个；上次中断的运行有 1 家可能已提交：k1·growth intern 50001（链接，永不自动重投，请你核对邮箱或页面）」。
  - 小瑕疵：用的是归一后的小写公司名和标题，可读但不好看，P4。
- **BUG-2 已修**[实测，只读 GET]：`runway-ml` 返回 44 个岗，JD 开头是「We are building AI to simulate the world through merging art and science … world models」，是 AI 视频的 Runway。名单 21 家全部可达，共 602 个岗。
- **BUG-3 已修**[实测]：真 `fetchWatchlist` 加两个假 slug（Ashby / Greenhouse 各一个），两个都进 errors（`board_not_found … (404)`），其余 21 家照常。轮转来源不传 `notFound`，仍保持静默（正确）。
- **新口径零重复**[实测]：
  - DD：120 岗、每 6 个 1 个合适、N=4，同一天连跑三次，共派 12 次。**重复派单 0；已判不合适被重打分 0**；合格未投被重打 7 次（裁决 B 允许）。
  - MIX 连跑三次：
    - 「HeyGen, Inc.」「Stability AI」×2 这两类不同写法都拦住，历史行也拦住；
    - unknown 只派 1 次；
    - 同公司 3 个合适只投 2 个；
    - 投前失败第 2 次运行重试 1 次、第 3 次不再试。
- 定稿 `docs/specs/restart-apply.md` 改为「零重复投递 + 已判不合适零重复打分」，与 c7e5514 固定的测试口径一致。

### ❌ 真问题（1 个）

**RACE（P3，命中 ① 并发）两个 start 几乎同时发起，一半的概率两个都能开跑**
- 复现：两个 `start` 同时发起共 10 轮，其中 5 轮两个都成功（`[1,2,2,2,1,1,2,1,1,1]`）。
- 读码原因：`claimHome` 把「运行锁在，但它指向的运行目录不存在」当成残留自动清掉。可是 A 的 start 是先写锁、隔一段（崩溃恢复 + 清旧目录）才建运行目录，B 正好落在这段空档里，就把 A 的锁当残留清了。A 做崩溃恢复要起记账进程时，这个空档会更长。
- 后果：又回到 BUG-1 的局面，两个运行并存，B 的清旧目录可能删掉 A 的运行。不会重投：每行派单前都现读账本，派单锁也串行。
- 修法（约 1-3 行）：残留判断再加一条「锁里记的 start 进程 pid 已经不在」；或者先建运行目录再写锁。首批试投前修，不阻塞推送。

### ⚠️ 风险 / 挂账

- **PID 复用会卡死（P3）**[实测 PID]：
  - 派单锁里的 pid 已经被一个无关的活进程复用时，start 一直拒绝，提示「wait for it to finish」，`--abandon` 也不行。只能手删 `locks/apply_batch.lock`，而提示里没写这条出路。
  - 方向是安全的（宁可不跑），但会让拍板人卡住。apply_batch 自己的陈旧锁接管也是同样的判断。
  - 建议：提示里写上手删的出路；或者判断时核对进程命令行里有 `apply_batch`。
- **运行锁坏 JSON（P4）**[实测 RES]：start 直接吐一段堆栈退出。会响亮失败，但用户不知道该删哪个文件。
- **放弃一个其实还活着的窗口（P4）**[实测 GAP]：
  - 情形：A 在 `submit-scores` 的打分入库阶段（还没拿派单锁），B `--abandon A` 成功。A 随后 exit 0、入库 0 条、不派单，但会把自己的运行目录重新建出来（下次 start 会清掉）。
  - 没有重投路径：派单锁串行 + 每行现读账本。
  - 顺带发现：`store_scored_jobs` 读不到 `--to-score` 文件时入库 0 条、不报错。这是既存行为，P4。
- **公司键**：`runway-ml` 归一后是 `runwayml`，和手写的「Runway」不是同一个键。实测真实历史 161 条里公司名和 slug 0 处不一致，现在不受影响；今后名单公司名一律用 slug 即可。

## 覆盖度评估

**质量分 4/5 —— 可推。**

- 第 4 轮 4 个 bug 全部实测修好。
- kill -9、锁残留、被放弃窗口复活、错运行号这些最坏意图场景都响亮、可自救，并且零重派。
- 新口径下零重复投递、已判不合适零重复打分都成立。
- 逐提交 CI 全绿。
- 扣 1 分：同时开跑的竞态（RACE）会放进两个运行；PID 复用时会卡死、提示里没有自救办法。两者都不会重投，建议首批试投前一并修（合计约 5 行）。

- `verify_self_miss_rate: 0%`（0/5）。RACE 是新锁代码引入的，第 4 轮时这段代码还不存在。
- Quinn 重构：零。

## 试过的错误方向（第 5 轮）

- **GAP 场景第一版用字符串替换改写 `store_scored_jobs` 的相对 import**：把文件内其他文本也替换坏了，报 SyntaxError，看起来像「A 被放弃后崩溃」。改成一个包装文件（先等 3 秒，再按绝对路径 import 真模块）以后，才看到真实行为：exit 0、入库 0、不派单。
- **一开始把 RACE 预判成「窗口极窄、只是理论问题」**：实测同时发起时一半概率双开，所以升为真问题（P3），不再只是挂账。

---

# 第 6 轮 — S5 编排改写 + 退役 + D10 + 锁 P3 ×2（7a7af88..64bc3c1，12 提交）

> Mode: daily。硬边界：没有真投；真实 `~/.mrweirdo-jobs/` 只读（开工与收工 `jobs.db` 都是 1782006129 / 1728512，`search_intent.json` 1780932205，`log/` 无账本/看过记录，`locks/` 空，无 `archive/`）；没有 push；没有提交代码。独立 worktree `scratchpad/wt6`（tip 64bc3c1），逐提交在 `scratchpad/p6_<sha>`，一律假 HOME。自写场景 3 个文件（`zz_v6_d10` / `zz_v6_d10b` / `zz_v6_lock`，不入库）。真跑前清单在真实家目录的**拷贝**（`scratchpad/sbx/home`，不含 chrome-profile）上逐条走了 1-8 步；外网只做只读 GET（名单 21 家公开招聘板）。

## 验收范围

12 个提交：① 运行锁原子化 + 派单锁 PID 复用自救（7a7af88）② D10 名单公司合格不自动投、`--release` 放行（0959763 / 0af61f9）③ 缺信息报告路径交接（02ce51e）④ 手投登记 `record-manual`（11932cb）⑤ preflight 只核库里有的账本行（d2d3ccf）⑥ 看板改数账本（961a977）⑦ install_watchlist / retire_jobs_db 两个新 CLI（60bcbee / 42e4728）⑧ onboard / jobskill / 两份 -auto 说明书改写（e7c2a3d）⑨ 变更日志与施工记录（f3e260e / 64bc3c1）。另按派遣单：真跑前清单 10 步逐条可执行性、V1-V13 终验、逐提交 CI 四步。

## 5 维高危区评估

- ① 核心业务逻辑（最高）：D10 是拍板人定的「梦想公司投前过目」闸，漏一次 = 用掉这家 60 天 2 次里的 1 次；放行必须只放那一条、仍过投前闸。手投登记写进账本后直接改变以后的去重与 60 天计数，写错比不写更难发现。
- ② 安全边界（高）：真跑前清单全部是对真实家目录的 `--apply`，要确认默认试跑、顺序对、失败响亮；record-manual 的错误输入不能静默写坏账本。
- ③ 性能：每个 start 多一次 `ps`，毫秒级；不涉及。
- ④ 集成点（中）：名单扫描与轮转扫描用同一批公开接口，名单公司同时出现在轮转源里（`greenhouse_companies.json` / `ashby_tenants.json` 都含 heygen、pika、synthesia 等）——D10 只认来源不认公司，这是本轮最该打的点。
- ⑤ 主流程（高）：onboard 第 4-7 步照着说明书能不能跑通；退役后 jobs.db 不该再冒出来。

## 7 类测试

- ① 等价类（6 次）：`--release` × {名单里 held 的岗、已手投的岗、同公司 60 天已满、重打分不合适、非招聘链接、空参数}；record-manual 链接 × {GH、GH 变体 `job-boards…?gh_src`、Ashby、Ashby `/application`、LinkedIn}。
- ② 边界值（4 次）：held 满 7 天（改 ts 为 8 天前）；`--at` × {`2026-13-45`、`2027-01-01`、`9/24`、缺值}；同文件内重复链接；运行锁残留 + 同时开跑。
- ③ 决策表（1 张）：D10「来源=名单? × 被放行? × 看过记录 held? × 重打分合格?」逐格对 holdListJobs + gate 读码，另补「名单扫描失败、轮转扫到同一家」这一格（实测 R9）。
- ④ 状态迁移（4 次）：held → 7 天内再跑（不打分不报）→ 放行 → 投出；held → 过期 → 重打分再列出；运行锁 {无、残留、活} × 同时开跑；A finish 与 B start 同时。
- ⑤ 用例测试（2 次）：真实数据拷贝走清单 1-8 步（迁入 → 归档 → 手投登记 → 装名单 → 名单真接口扫描 → 打分 → 收工）；归档后再跑一次真模式 start/next/finish 看 jobs.db 会不会被重建。
- ⑥ pairwise（1 次）：record-manual 的 {写法变体} × {公司名写法 slug / 展示名}，得出 R6。
- ⑦ 风险驱动：D10 和手投登记是本轮唯一会让「不该投的被投」的新代码，14 个自写场景里 10 个打这两处。

## 5 轮回归循环记录（第 6 轮）

1. 写测试：14 个自写场景（R1-R9、STALE2、RACE3、FIN-START，外加 record-manual CLI 探针与清单沙箱走查）。R9、R6、STALE2 三个是先写成「应当拦住」的断言、跑出来没拦住（红），证据见下。
2. 全套：tip 477 条全绿 + 自写 12 条全过（断言为观测型的 R6 / R9 / STALE2 打印结果）；逐提交 CI 见下表。
3. 辨析：R9 真 bug（P2）；R6、STALE2、清单第 7 步真 bug（P3）；其余 P4。
4. 不修：R9 要改 holdListJobs 的判定依据，R6 要改 record-manual 的公司来源，STALE2 要改锁的清残留路径——都超 Quinn 界限。
5. 转 lead。

**逐提交 CI**（CI 四步，独立 worktree + 假 HOME）：

| 提交 | npm test | role_guard | alpha_gate | node --check |
|---|---|---|---|---|
| 7a7af88 | 457/457 | 0 | 0 | 0 |
| 0959763 | 458/458 | 0 | 0 | 0 |
| 02ce51e | 458/458 | 0 | 0 | 0 |
| 11932cb | 464/464 | 0 | 0 | 0 |
| d2d3ccf | 466/466 | 0 | 0 | 0 |
| 961a977 | 467/467 | 0 | 0 | 0 |
| 60bcbee | 470/470 | 0 | 0 | 0 |
| 42e4728 | 474/474 | 0 | 0 | 0 |
| e7c2a3d | 477/477 | 0 | 0 | 0 |
| 0af61f9 | 477/477 | 0 | 0 | 0 |
| f3e260e | 477/477 | 0 | 0 | 0 |
| 64bc3c1 | 477/477 | 0 | 0 | 0 |

## 结论明细（第 6 轮）

### ✅ 通过

- **锁 P3 ×2 已修**[实测]：
  - RACE：两个 start 同时 ×10 轮（builder 测试）、三个 start 同时 ×10 轮（自写 RACE3）——每轮恰好 1 个开跑，输家响亮拒绝、无堆栈。
  - PID 复用：pid 活着但命令行不是 `apply_batch.mjs` → 当陈旧锁、响亮说明后接管；真派单进程活着 → 拒绝，提示写明 `kill <pid>` 与「ps 看不到 apply_batch 就删哪个锁文件」。
  - FIN-START（A 收工与 B 开跑同时 ×10）：B 要么被拒（A 还在）、要么正常开跑，无异常、无残锁。
- **D10 主体**[实测]：
  - R1：放行运行里又冒出 2 个新的名单合格岗 → 只投放行那 1 条，另 2 条照 held、第 1 行列出。
  - R2：放行但同公司 60 天已 2 次 → 不投，第 2 行「放行的 1 个没投：…（company_cooldown_60d）」。
  - R3：放行一条已手投登记的岗 → 不打分不投，第 2 行写 `already_attempted_fp`。
  - R5：Ashby 放行链接带不带 `/application` 都认。
  - R7：held 满 7 天 → 重打分、再列一次（符合「7 天不重报」）。
  - R8：`--release` 给 LinkedIn 链接或空参数 → 拒绝开跑。
  - 结论：放行只解除 held，不绕过任何投前闸（已投、同公司同标题、60 天 2 次、投前失败上限、规则 6 都还在，派单时 apply_batch 再过一遍）。
- **手投登记**[实测]：默认试跑不建 `log/`；`--apply` 写入、账本 600；同一文件内 GH 变体与 Ashby `/application` 变体按指纹去重；重复登记 → `already_recorded`、不重写；坏链接 / 缺标题 / 坏日期 / 非数组 → 整批不写并报错；运行锁在时 `--apply` 拒绝、试跑放行；登记后的岗再跑 → 拦下（R3），计入 60 天（R2）。
- **preflight 只核库里有的行**[读码 + 实测]：工作库行号从账本最大号往上排，本次运行的行与历史/以前运行不会撞号；本次运行的行照旧逐行核（批 2 的 preflight 核批 1 的行）。放掉的只有「账本行在库里找不到」这一类，在一次性工作库下它本来就恒真，不是该拦的真问题。代价见 ⚠️。
- **说明书**[读码]：onboard 第 4-7 步照着能跑（沙箱按它走通 start → next → submit-scores → finish）；删行核对过：旧 queue gate、prune、retry_gap_rows、apply_report、48h confirm/tracker 推荐都是有意删除（偏离 7/8/12 已申报），身份行与 cover letter 告知搬到第 3 步保留；两份 -auto 与 jobskill 为精准替换，无整篇覆盖。
- **看板 / 名单 / 退役**[实测，沙箱]：看板「今日已尝试 0/10 · 已投 182」、最近 10 条读账本；install_watchlist 试跑不写、`--apply` 只加 target_companies（其他字段逐字节不变）、600、重复 `--apply` 不重复加；retire 在迁入前拒绝（182 vs 0）、迁入后 `--apply` 搬到 `archive/jobs-legacy-2026-09-25.db`（600，1728512 字节，目录 700），再跑提示「已归档」。
- **V1-V13 终验**[实测]：V1 V2 V3 V7 V8 V11 V12 V13 在 `stream_run_e2e`（真 stream_run），V4 V5 V6 V9 V10 在 `apply_batch_guard`，tip 全绿；D10 改动后 V9 对非名单公司不变，名单公司改走 held（设计如此）。V12 / V13：held 写的看过记录只有链接、公司、标题、JD 指纹，不含正文与答案。

### ❌ 真 bug（4 个）

**R9（P2，命中 ① 核心逻辑 + ④ 集成点）名单公司的岗从轮转扫描进来，不 held、直接自动投**
- 复现（`zz_v6_d10b`）：名单扫描 pika 这家失败（HTTP 500），轮转扫描拿到 pika 的合格岗 → 驱动被派 1 次。报告自相矛盾：第 1 行「投出 1 个：pika·Growth Intern 1」，第 2 行「名单里 1 家没扫到：Pika」。
- 原因[读码]：`holdListJobs` 按候选的来源标记 `c._watchlist` 判，不按公司判。而名单 21 家里至少 10 家同时在轮转源里（greenhouse_companies / ashby_tenants）。名单扫描某家失败（限速、超时、瞬时 5xx）或名单接口没返回、轮转接口返回了同一岗，都会漏过去。
- 后果：违反关卡 2 拍板 ③「梦想公司投前过目」，用掉这家 60 天 2 次里的 1 次。不会重复投递。
- 修法建议：held 判定改为「公司键 ∈ search_intent.target_companies 的 slug 归一」（与来源无关）；约 5-8 行 + 1 条测试。

**R6（P3，命中 ① + ② 数据正确性）手投登记的公司名不校验，写成展示名就漏掉 60 天同公司计数**
- 复现：record-manual 两条 `jobs.ashbyhq.com/runway-ml/…`、公司写「Runway」→ 轮转扫到 runway-ml 第 3 个合格岗 → 照投（60 天内同公司第 3 次）。
- 原因：账本公司键 = `normalizeCompany(用户写的名字)`，扫描来的公司键 = slug 归一。名单里「Runway→runway≠runwayml」「Higgsfield→higgsfield≠higgsfieldai」两家会错；GH 驱动的「以前投过我们吗」也按公司键查，会答错。
- 说明书和清单第 5 步都写了「用招聘板 slug」，但工具不拦；而 GH / Ashby 链接里本来就带 slug。
- 修法建议：GH / Ashby 链接一律从链接取 slug 当公司（或与 `--company` 不一致时拒绝）；约 5 行。

**STALE2（P3，命中 ① 并发）运行锁残留时两个 start 同时开跑，15 轮里 3 轮双开**
- 复现（`zz_v6_lock`）：先放一把指向不存在目录的运行锁，再同时发两个 start，结果 `[1,1,1,1,1,1,2,1,2,1,1,1,1,2,1]`。
- 原因[读码]：`claimHome` 清残留是「读到残留 → rmSync → wx 建锁」，两个进程都判残留，后删的一方会把先建好的新锁删掉，然后自己也建成功。O_EXCL 只保护了「没有锁」这一种起点。
- 后果：两个运行并存，后开的 `cleanOldRuns` 会删掉先开的运行目录。派单锁串行 + 每行现读账本，仍不会重投。前提比第 5 轮 RACE 严（要先有一次没收尾的运行 + 同时开跑）。
- 修法建议：清残留改成「把残留锁 rename 到带自己 pid 的名字，rename 成功的一方才继续」，或清残留段外再套一把 O_EXCL 的短锁；约 5-10 行。这条路径第 5 轮就存在，属于我上轮漏检。

**CL7（P3，命中 ⑤ 主流程 / 清单可执行性）真跑前清单第 7 步单独跑 preflight 会重新建出一个空的 `jobs.db`**
- 复现（沙箱）：第 4 步归档后 `jobs.db` 不存在 → 第 7 步 `node shared/supervisor_preflight.mjs` → 家目录出现新的 `jobs.db`（644、0 行），preflight 还因此报 `queue_nonempty` FAIL。
- 原因：preflight 调 `auto_apply_queue --summary` / `queue_diagnostics`，它们 `initDb()` 默认库。stream 运行本身不会重建（实测删掉后真模式 start/next/finish 一轮，jobs.db 没再出现）。
- 后果：退役不再「一次到位」；之后 tracker / confirm 读到的是空库；lead 在第 4 步核过「jobs.db 应不存在」，第 7 步后又出现，会误判归档失败。不影响投递和去重。
- 修法建议：清单第 7 步改为 `MRWEIRDO_DB_PATH=$(mktemp -d)/probe.db node shared/supervisor_preflight.mjs`，并写明只看 `cdp` 与 `work_authorization_answered`、`queue_nonempty` FAIL 是正常；或者让 preflight 在默认库不存在时不建库。

### ⚠️ 风险 / 挂账（P4）

- **R4 放行后重打分判不合适 → 报告不说**：三行是「投出 0 个 / 没投成 0 个 / 合适的只有 0 个」，拍板人说了「投这条」却看不到为什么没投。建议放行岗未合格时第 2 行写「放行的 1 个这次判不合适」。
- **`--at` 接受任何 JS 能解析的日期**：`9/24` 被记成 2001-09-24（落到 60 天窗外，同公司计数漏掉；指纹去重仍有效），`2027-01-01` 也照收。建议只收 `YYYY-MM-DD` 且不晚于今天。
- **record-manual 报错带 Node 堆栈**：响亮、整批不写，但读起来吓人。
- **清单第 10 步 `npm run status` 是常驻刷新的看板**，在 Bash 工具里不会自己退出；应写 `node scripts/dashboard.mjs --once`。
- **残文**：`mrweirdo-greenhouse-auto/SKILL.md:145` 仍建议 `datasette serve ~/.mrweirdo-jobs/jobs.db`（归档后不存在）；onboard 菜单仍把「进度跟踪」路由到读 jobs.db 的 tracker（DESIGN 未明点 10，已知）。
- **preflight 一致性检查放宽的代价**：如果哪天 preflight 被指到错的库，它会 `checked: 0, ok: true` 静默通过，而不是像以前那样报一堆 `ledger_row_without_db_row`。建议 `checked === 0` 且本次运行已有派单时打一行 WARN。
- 删掉的「`profile_gate.ok` 为 false 先问那一个问题」：现在工作授权在第 1-3 步必问、清单第 7 步也核 `work_authorization_answered`，apply_batch 仍打印 profile gate 提示；可接受。

### 真跑前清单逐条（沙箱实测 1-8 步）

| 步 | 结论 |
|---|---|
| 0 重新引导 | 可执行：`scripts/intake_resume.sh` 存在、收 1 个 PDF 参数；新简历路径存在。重生成 search_intent 是 agent 按第 1-3 步做，不是命令 |
| 1-2 迁入 | 可执行：输出与清单预期逐字一致（182 + 33、appended 215、verify ok）；重跑 appended 0 |
| 3 核数 | 可执行：215 行；retire 试跑 count_check 182/182。迁入前先跑 retire 会响亮拒绝（安全） |
| 4 归档 | 可执行：搬走、600、1728512、目录 700；再跑提示已归档 |
| 5 手投登记 | 可执行，但**需先修 R6**，或 lead 严格用链接里的 slug 当 company、日期只写 `YYYY-MM-DD` |
| 6 名单 | 可执行：试跑 would add 21；`--apply` 只改 target_companies |
| 7 Chrome + preflight | **需改**（CL7）：会重建空 jobs.db；`queue_nonempty` 必 FAIL 要写明是正常 |
| 8 不提交试跑 | 可执行：名单 21 块板 → 5 个新岗、1 个被历史拦下 → 收工、锁放、运行目录删净 |
| 9 试投 2 条 | 未跑（禁真投）。**需先修 R9**，否则名单公司可能经轮转被自动投 |
| 10 复验 | 需把 `npm run status` 换成 `--once` |

## 6. Quinn 重构记录（第 6 轮）

零。四个真 bug 都超 1-3 行或涉业务逻辑，转 lead。

## 7. 质量 3 指标（第 6 轮）

- 覆盖率：项目没有覆盖率工具，无数字。
- `verify_self_miss_rate: 11%`（1/9）：STALE2 的清残留路径在第 5 轮（033f48f）已存在，上轮只测了单个 start 遇残留，没测残留 + 同时开跑。
- 真 bug：4 个（P2 ×1、P3 ×3），另 P4 ×6。

## 8. 老坑清单核查（第 6 轮）

项目 `.claude/arnold/roles/` 下没有 verify.md，项目未定义老坑清单。ci_smoke 只填了 main_chain：主流程「找岗 → 大批量一键投递 → 投递报告」在 e2e 与沙箱真实数据上跑通到打分/收工，投递本身禁真投未跑；schema_upgrade_path / isolation_field 未填，对应铁律不启用。

## 覆盖度评估

**质量分 3/5 —— 代码可推（推送本身不触发任何投递），真跑前清单不可放行，需回炉一轮小修。**

- 锁 P3 ×2、D10 放行路径、手投登记的去重与计数、preflight 放宽、说明书改写、退役/名单 CLI、V1-V13、逐提交 CI 都实测过关。
- 扣 2 分：R9 让拍板人亲定的「梦想公司投前过目」有一条可漏的路（P2）；R6 手投登记写错公司名会让 60 天计数失效；STALE2 残留锁下仍会双开；清单第 7 步会把退役掉的 jobs.db 重建出来。四处合计约 25-30 行，全部落在「首批试投前」这一步上。
- 放行条件：修 R9 + R6 + CL7（清单改写即可）后，清单 1-10 步可放行；STALE2 可同包修。

## 试过的错误方向（第 6 轮）

- **逐提交 CI 第一版用 `grep "^# pass"` 取测试数**：Node 24 的报告器输出是 `ℹ pass N`，第一版表里测试数全空，差点记成「没跑」。改为按 `ℹ (pass|fail)` 取，并单独记 npm test 的退出码。
- **一开始认为 D10 只要看 `--release` 的放行路径**：放行路径全部过关以后，回头按决策表补「来源 × 公司」这一格，才发现名单公司可以不经名单扫描进来（R9）。
- **R6 起初打算只测 record-manual 的链接变体**：做 pairwise 时把「公司名写法」也拉进来，才看到展示名与 slug 归一后不同的 2 家。

---

# 第 7 轮 — S5 回炉复验（b669201 / df92547 / dc135e7 / 293169c）+ lead 偶发失败定性

> Mode: daily。硬边界同前：没有真投；真实 `~/.mrweirdo-jobs/` 开工与收工都是 `jobs.db` 1782006129 / 1728512、`search_intent.json` 1780932205，`log/` 无账本，`locks/` 空，无 `archive/`；没有 push，没有提交代码（修复只在 scratchpad 副本里试，已还原）。独立 worktree `scratchpad/wt7`（tip 293169c），逐提交在 `scratchpad/p7_<sha>`，假 HOME。

## 验收范围

① 第 6 轮四个真 bug 的修法（R9 名单公司按公司认、R6 手投公司从链接推、STALE2 残留锁并发、清单第 7/10 步）；② lead 在干净 worktree 第一次全量跑出的 2 条失败（`apply_batch_guard.test.mjs:154` 实际 3 期望 11；`submission_ledger.test.mjs:214` P2 answers）要定性：是测试时序不稳，还是产品在负载下真会误停批；③ builder 申报的「高负载 1 次误停批」是否同源；④ 逐提交 CI 四步。

## 5 维高危区评估

- ① 核心业务逻辑（最高）：偶发失败如果是产品问题，真跑时就是「该投的没投、没投成的被记成可能已提交」，直接违背「能替拍板人真投出去」。
- ② 数据正确性（高）：结局记错会永久写进账本（账本只追加），影响 60 天计数和以后永不重投的判断。
- ③ 性能 / 负载（高，本轮新增）：问题只在机器慢的时候出现，要能在慢的条件下稳定复现，不能只靠多跑几次碰运气。
- ④ 集成点：驱动子进程 → 结果文件 → 记账子进程这条交接链。
- ⑤ 主流程：名单公司 held、手投登记、并发开跑这三个修法不能回退。

## 7 类测试

- ① 等价类（3 次）：结果文件写盘 {正常、慢}；手投公司 {不写、写对 slug、写成展示名}；认领文件 {新、>30 秒}。
- ② 边界值（2 次）：残留锁 + 同时开跑 ×20 轮；认领文件 60 秒前（过 30 秒界）。
- ③ 决策表（1 张）：`runTee` 收尾「子进程关闭 × 写入是否已落盘 × 记账人何时读」三格，对照结局（正常 / 记成 crashed / 熔断）。
- ④ 状态迁移（2 次）：名单扫描失败 → 轮转进来 → held → `--release` → 投出；手投登记 → 60 天闸。
- ⑤ 用例测试（2 次）：沙箱清单第 5/7/10 步；全量 481 条在「慢磁盘」下有修 / 无修两遍对照。
- ⑥ pairwise：N/A，本轮变量都已在决策表和等价类里穷尽。
- ⑦ 风险驱动：负载复现是本轮重点。先试 CPU 压满（8 核空转）和磁盘压满（dd 连写），各 12-24 次都没复现；改成确定性地让异步写盘回调晚到 80 毫秒（`--require slowfs.cjs`，模拟慢磁盘），一次就复现。

## 5 轮回归循环记录（第 7 轮）

1. 写测试：`zz_v7_re`（R9 / R6 / STALE2 ×20 / 认领文件，4 条）、`zz_v7_gap`（打印熔断证据）、`repro.mjs`（脱离项目的 200 次最小复现），外加慢磁盘预加载 `slowfs.cjs`。
2. 全套：tip 在慢磁盘下 **469/481，12 条失败**；同一个 tip 只改 1 行（见下）后，在慢磁盘下 **481/481**。
3. 辨析：12 条失败全部同源（见 ❌ FLUSH），是产品 bug，不是测试写法问题。`submission_ledger:214` 不在这 12 条里，复现不了（见 ⚠️）。
4. 不修：这是派单主链路上的业务代码，按 Quinn 界限转 builder。
5. 转 lead。

**逐提交 CI**（CI 四步，独立 worktree + 假 HOME，正常负载）：

| 提交 | npm test | role_guard | alpha_gate | node --check |
|---|---|---|---|---|
| b669201 | 478/478 | 0 | 0 | 0 |
| df92547 | 481/481 | 0 | 0 | 0 |
| dc135e7 | 481/481 | 0 | 0 | 0 |
| 293169c | 481/481 | 0 | 0 | 0 |

## 结论明细（第 7 轮）

### ✅ 通过（第 6 轮四项）

- **R9 已修**[实测]：
  - 名单扫描 pika 返回 500，轮转扫到 pika 的合格岗 → held，只投非名单公司的那一条；第 1 行列出 pika 等你过目。
  - 之后 `--release` 这条 → 照常投出。
  - 公司键用 `search_intent.target_companies` 的 slug 归一。轮转源（GH / Ashby 公开接口与 bulk crawl）的 company 字段也是 slug，读码一致。
- **R6 已修**[实测]：
  - 公司写「Runway」配 `runway-ml` 链接 → 整批拒绝，一行人话、无堆栈。
  - 不写公司 → 从链接推出 `runway-ml`。写 `RUNWAY-ML` → 归一后相符，照收。
  - 登记两条以后，同公司第 3 个合格岗被 60 天闸拦下，驱动 0 次。
- **STALE2 已修**[实测]：
  - 残留锁 + 两个 start 同时开跑 ×20 轮，每轮恰好 1 个开跑。
  - 认领文件残留时：30 秒内提示「另一个正在开跑」；超过 30 秒报出文件路径和存在了多久，请人删除。两种都拒绝开跑、不自动清。
- **清单第 5/7/10 步**[实测，沙箱]：
  - 第 7 步用探针库跑体检：`work_authorization_answered` OK，`queue_nonempty` FAIL（清单已写明这是正常），跑完 `jobs.db` 没有重建。
  - 第 10 步 `dashboard.mjs --once` 打一屏就退出。
  - 第 5 步写错公司名会被拒。

### ❌ 真 bug（1 个）

**FLUSH（P2，命中 ① 核心逻辑 + ② 数据正确性 + ④ 集成点）驱动结果文件还没写完，记账人就去读了：结局被记成 crashed，连续 3 次就熔断停批**

- 位置：`shared/apply_batch.mjs` 的 `runTee`。

  ```js
  child.on('close', (code) => {
    out.end();
    resolve(code ?? 1);
  });
  ```

  `out.end()` 只是「请求收尾」，写入流里排队的内容还没落盘，函数就返回了。紧接着 `runNode`（`spawnSync`）同步起记账子进程，**同步调用期间主进程的事件循环被卡住**，排队的那几段写入要等记账人跑完才能继续。所以记账人读到的结果文件可能缺最后一行 outcome，于是按「驱动死了没留结局」记成 `crashed / driver_died_without_outcome`（`record_apply_outcome.mjs:93`）。apply_batch 随后自己读这个文件，也读不到 outcome，按 `crashed` 推进熔断计数（`apply_batch.mjs:524`）。
- 复现（三层证据）：
  - 最小复现（脱离项目，200 次）：写盘回调晚到时 2/200 次记账人读到空文件；改成 `out.end(() => resolve(...))` 后 0/200。
  - lead 那条失败，慢磁盘下一次就复现：驱动 3 次，stderr 为「breaker open: 3 dispatches in a row ended crashed」；账本三行都是 `crashed/driver_died_without_outcome`。这和 lead 看到的「actual 3 expected 11」逐字一致。
  - 全量对照：慢磁盘下 tip 12 条失败（V1 V2 V6 V7 V10、规则 6、D10 ×2、补信息回路、记账失败、投前失败上限、10 家缺信息），只改这 1 行后 481/481。builder 申报的「投前失败上限 e2e 偶发误停批」就在这 12 条里，是同一个根因。
- 真跑时会怎样：
  - 真驱动一次要跑几十秒，stdout 和 stderr 两路日志都写进同一个结果文件，最后一行 outcome 正好在进程退出前到达，排在别的写入后面。所以真环境比测试更容易踩中，机器越忙越容易。
  - 后果一（记错，而且永久）：页面明确说「缺信息没交上」的岗，被记成 crashed，也就是「可能已提交」。它永不再投，还占掉这家 60 天 2 次里的 1 次，补信息回路也断了。真投成的岗被记成 crashed，报告里说「没投成」，拍板人会去邮箱核对。
  - 后果二（误停批）：连续 3 次 → 熔断停批，后面该投的都没投，报告写 breaker_open。
  - 不会重复投递：crashed 一律按「可能已提交」处理。
- 改法：1 行，`out.end(() => resolve(code ?? 1));`，等写入流 finish 以后再交给记账人。另外建议加 1 条回归测试：测试里用慢磁盘预加载（`--require` 一个把 fs.write / fs.writev / fs.open 回调推迟 80 毫秒的 cjs），跑「10 家全卡缺信息」这一条，先红后绿。这样以后不靠运气也能守住。
- 为什么 lead 单独连跑 3 次都是绿的：只有写盘回调慢到跨过「子进程关闭 → 起记账人」这一瞬间才会出错。全量跑 481 条时机器更忙，偶尔才踩中。CPU 压满不一定会踩中（我压 8 核 12 次都没中），磁盘或线程池排队才是关键。

### ⚠️ 风险 / 未定性

- **`submission_ledger.test.mjs:214`（P2 answers）没能复现，未定性**：
  - 这条测试不经过 `runTee`，直接同步调记账人，读码找不到依赖计时的地方。
  - 慢磁盘 ×11 次、CPU+磁盘满载 ×12 次、并行 ×10 次，全部是绿的。
  - 两个可能：一是同时段机器上还有别的全量测试在跑，子进程被信号打断（`spawnSync` status 为 null）；builder 看到的「记账打印了 ok:true 但状态非 0」也像这一类。二是一个我没找到的问题。
  - 建议：不阻塞。在 `apply_batch.mjs` 的 `record_failed` 分支、以及这条测试的断言信息里打出 `r.signal` / `r.error`，下次再出现就能自己说清楚原因（约 3 行）。
- **FIN-START 残留窗口**（builder 自报）：`finish` 放锁不走认领段。我第 6 轮 ×10 轮没触发，维持 P4。

## 6. Quinn 重构记录（第 7 轮）

零。FLUSH 虽然只改 1 行，但在派单主链路上，按界限转 builder。scratchpad 里试改的副本已 `git checkout` 还原，worktree 已删。

## 7. 质量 3 指标（第 7 轮）

- 覆盖率：项目没有覆盖率工具，无数字。
- `verify_self_miss_rate: 100%`（1/1）：FLUSH 从 S2（22bc56e 接线）起就存在，第 2-6 轮我都没测过慢磁盘下结果文件的交接，这次是 lead 的偶发失败带出来的，如实记为漏检。
- 真 bug：1 个（P2），另有未定性 1 条、P4 1 条。

## 8. 老坑清单核查（第 7 轮）

项目未定义 verify.md 老坑清单。ci_smoke.main_chain 主流程：本轮找到的 FLUSH 正落在「大批量一键投递 → 投递报告」这一段，主流程冒烟在慢磁盘下失败、修后通过。

## 覆盖度评估

**质量分 3/5 —— 回炉 1 行（FLUSH），修后可推；真跑前清单在 FLUSH 修好前不可放行。**

- 第 6 轮四个问题全部实测修好，逐提交 CI 全绿。
- 扣分项：FLUSH 是 P2 产品 bug，不是测试时序问题。真跑时机器一忙，就会把没投成的记成「可能已提交」（永久、占名额），或者误停批，而且真驱动比测试更容易踩中。改法 1 行，已在副本上验证：慢磁盘下 12 条失败 → 0 条。
- 放行条件：builder 提交这 1 行 + 慢磁盘回归测试；lead 复验时在慢磁盘预加载下全量 481（+1）全绿。submission_ledger:214 未定性，不阻塞，建议顺手补上 signal/error 诊断输出。

## 试过的错误方向（第 7 轮）

- **先用 CPU 压满复现**（8 个空转进程 + 6 路并行，12 次）：全绿，差点得出「不稳是测试环境问题」。问题其实出在写盘回调排队，不在 CPU，所以改成确定性推迟 fs 回调，一次就中。
- **再用 dd 连写压磁盘**（12 次）：仍然全绿。页缓存把 dd 的压力吸收掉了，单个小文件写入的回调延迟并不稳定。这也说明「多跑几次没复现」不能当作没问题的证据。
- **怀疑 submission_ledger 失败是 spawnSync 的 1 MiB 输出上限把记账人杀了**：插桩量了 84 次记账调用，stdout 最多 80 字节、stderr 最多 169 字节，排除。

---

# 第 8 轮 — FLUSH 修复 + 驱动 stdout 同步写 + 退出 SIGSEGV（ed18bf3..4450766，7 提交）

> Mode: daily。硬边界同前：没有真投；真实 `~/.mrweirdo-jobs/` 只读（`jobs.db` 1782006129 / 1728512 未变，无账本、无 archive）；没有 push；没有提交代码。worktree `scratchpad/wt8`（tip 4450766），逐提交在 `scratchpad/p8_<sha>`，一律假 HOME。本机环境 `NODE_USE_SYSTEM_CA=1`、node v24.7.0，CI 表就是在这个环境下跑的。外网只读 GET 2 次（Ashby / GH 公开接口）。

## 验收范围

① 独立复现「退出时 SIGSEGV」的根因（有 / 无 `NODE_USE_SYSTEM_CA` 对照），并 grep 全库 `process.exit`，列出 safe_exit 没覆盖到的入口；② 驱动 stdout 改同步写以后，管道满时会不会阻塞或死锁，点提交前后有没有新风险；③ runTee 修复在慢磁盘下复核；④ 第 6/7 轮全部问题终验，判断真跑前清单能否放行；⑤ 逐提交 CI 四步。

## 5 维高危区评估

- ① 核心业务逻辑（最高）：退出码丢了 = 记账人明明记完了账，却被当成失败 → 停批 + 下次开跑补记「可能已提交」，把没投成的岗永久封掉。这和第 7 轮 FLUSH 是同一类后果。
- ② 数据正确性（高）：账本只追加，记错就是永久的。
- ③ 性能 / 负载（高）：SIGSEGV 只在「进程启动后很快就退出」时出现，和负载相关，要做大样本统计，不能靠多跑几次碰运气。
- ④ 集成点（高）：驱动 → 管道 → apply_batch → 结果文件 → 记账人整条交接链，外加 stream_run / apply_batch 起的所有子进程。
- ⑤ 主流程（高）：真跑前清单 1-10 步。

## 7 类测试

- ① 等价类（6 次）：退出方式 × {`process.exit`、自然退出（`exitCode`）、未捕获异常} × {CA 开、CA 关}，外加装了 safe_exit 的两种。
- ② 边界值（2 次）：驱动一次写 2 MB 且父进程暂停读 3 秒；结局行约 900 KB（builder 测试）。
- ③ 决策表（1 张）：全库 45 个会退出的文件 ×「是否在 safe_exit 覆盖链上（静态 import 可达）」×「在不在投递流水线上」×「退出 0 是否被调用方当成功」，逐格读码，结果见 ❌。
- ④ 状态迁移（1 次）：驱动写满管道 → 阻塞 → 父进程恢复读 → 结局照常送达、退出码正确。
- ⑤ 用例测试（2 次）：真实家目录拷贝走清单 1-8 步和第 10 步；慢磁盘下全量。
- ⑥ pairwise（1 次）：{CA 开 / 关} × {真实 CLI：record-manual 试跑、materialize_cover_letter、validate_user_profile}，各 200 次。
- ⑦ 风险驱动：本轮新代码只动「退出」和「交接」这两处，14 组统计实验全部打在这里。

## 5 轮回归循环记录（第 8 轮）

1. 写测试：
   - `segv/run.mjs`：并发 8 路起短命进程，统计收到的信号。
   - `run2.mjs`：同样的统计，但用来起真实 CLI。
   - `pauser.mjs`：父进程先暂停读管道，看驱动会不会卡死。
   - 慢磁盘预加载，跑全量。
   - 两个变异：把 runTee 改回旧写法、把 settleSystemCa 注释掉，看测试能不能抓到。
2. 全套：
   - tip 正常负载 486/486。
   - tip 慢磁盘 486/486（第 7 轮同条件下是 469/481）。
   - 第 7 轮自写的 4 个回归场景全过。
3. 辨析：builder 的 SIGSEGV 根因成立；safe_exit 有覆盖缺口（见 ❌）。
4. 不修：缺口涉及多个文件和子进程的启动方式，超出 Quinn 界限。
5. 转 lead。

**逐提交 CI**（CI 四步，独立 worktree + 假 HOME，本机 `NODE_USE_SYSTEM_CA=1`）：

| 提交 | npm test | role_guard | alpha_gate | node --check |
|---|---|---|---|---|
| ed18bf3 | 482/482 | 0 | 0 | 0 |
| cfd2584 | 482/482 | 0 | 0 | 0 |
| 1b17895 | 482/482 | 0 | 0 | 0 |
| e20e1fc | 484/484 | 0 | 0 | 0 |
| d341de7 | 484/484 | 0 | 0 | 0 |
| 9178eb6 | 486/486 | 0 | 0 | 0 |
| 4450766 | 486/486 | 0 | 0 | 0 |

## 结论明细（第 8 轮）

### ✅ 通过

- **① SIGSEGV 根因独立复现成立**[实测，每格 400 次，8 路并发]：

  | 退出方式 | CA=1 | CA=0 |
  |---|---|---|
  | `process.exit(2)` | SIGSEGV 34 + SIGABRT 1 | 0 |
  | 未捕获异常 | SIGSEGV 22 | 0 |
  | 自然退出（`exitCode`） | 0 | 0 |
  | 装 safe_exit + `process.exit` | 0 | 0 |
  | 装 safe_exit + 自然退出 | 0 | 0 |

  真实 CLI 也会崩（CA=1，各 200 次）：record-manual 试跑 3 次、materialize_cover_letter 2 次、validate_user_profile 10 次；CA=0 时全部 0。
  - 这很可能就是第 7 轮没定性的 `submission_ledger.test.mjs:214`：同步调用记账人，偶发崩溃后 status 为 null [猜，与现象吻合；本机 CA=1]。
  - 变异验证：注释掉 `settleSystemCa()` 后 `exit_segv.test` 两条都变红（1/200、3/200）。但这是概率性的红，单次跑可能漏掉，见 ⚠️。
- **② 驱动 stdout 同步写**[实测 + 读码]：
  - 只对进程名是 `*_apply_driver.mjs` 的驱动打开，另外 `emitOutcome` 在真实输出前再开一次。
  - 父进程暂停读管道 3 秒时，驱动写 2 MB 会阻塞约 3 秒，父进程一恢复读就写完。结局行完整，退出码是 2，没有死锁。
  - 真跑时不会死锁：apply_batch 在驱动运行期间只 `await` runTee，事件循环一直在读；它自己往上游写 stdout 是异步的，不会反压到驱动。所以驱动只会在父进程被挂起（Ctrl+Z）时停下，恢复后继续。
  - 停在点提交之前 → 什么都没发生；停在点提交之后、打结局之前 → 恢复后照常打出结局。父进程如果死了，驱动写入会 EPIPE 退出，改之前异步写也一样。
  - 没发现新的点提交前后风险。
- **③ runTee 修复**[实测]：
  - 慢磁盘下全量 486/486。
  - 把 runTee 改回旧写法，`apply_batch_flush.test` 变红；恢复后变绿。
- **④ 第 6/7 轮终验**[实测]：
  - R9（名单公司岗从轮转进来也 held，放行后投出）、R6（错公司名被拒、公司从链接推、60 天闸生效）、STALE2（×20 轮 0 双开）、认领文件提示——4/4 过。
  - FLUSH 已修，见 ③。
  - 清单在新的沙箱拷贝上逐步走了一遍：
    - 1-2：182 + 33、appended 215、ok；
    - 3：215、182/182；
    - 4：归档 600，jobs.db 不存在；
    - 5：`[{url,title,at}]` 推出 `heygen`，账本 216 行；
    - 6：would add 21 → 21；
    - 7：探针库体检只有 `queue_nonempty` / `cdp` 两项 FAIL（都在预期内），jobs.db 没重建；
    - 8：名单扫描 → 5 个新岗、1 个被历史拦下 → 收工、锁已放；
    - 10：`--once` 显示「已投 183」。
- **⑤ 逐提交 CI** 7/7 全绿（见上表）。

### ❌ 真问题（1 个）

**SAFE-GAP（P3，命中 ① + ④）safe_exit 只包了 `process.exit`，而且只装在 5 个入口；流水线上仍有子进程会因 SIGSEGV 把「成功」变成「失败」**

- 覆盖范围[读码，静态 import 链]：只有 7 个文件在覆盖链上：apply_batch、apply_supervisor、stream_run、record_apply_outcome、三个驱动。全库另外 36 个会退出的文件没装。
- 按后果分三类：
  - **流水线上、退出 0 会被当成失败**：`materialize_cover_letter.mjs`。apply_batch 每行派单前都调它，成功路径是 `print → process.exit(0)`（:36），同一出口实测会崩（2/200）。崩了 apply_batch 就判「cover letter 生成失败」，驱动遇到要求 cover letter 的表单会记 `needs_user:cover_letter_required_not_generated`，按规则 6 在档案变化之前一直卡住（看过记录 needs_info 没有期限）。也就是说，一个本该投成的岗因为一次偶发崩溃被搁置。频率低：它是长一点的进程，崩溃概率低于纯短命进程，没做到精确统计。
  - **流水线上、只在失败时 exit**：validate_auto_row（exit 1/2）、store_scored_jobs（exit 1）、liveness_gate / discover_candidates（只有 help / plan 分支 exit 0）、supervisor_preflight（`exitCode` 自然退出）。崩了也还是非 0，语义不变，无害。
  - **人手动跑的 CLI**：`submission_ledger.mjs`（backfill / record-manual `exit(0)`）、`retire_jobs_db.mjs`（:62 `exit(0)` 在搬完之后）、`install_watchlist`、`validate_user_profile`（实测 10/200）、`record_profile_answers`（第 6 步，`exit(main())`）。崩的时候数据已经写完，只是终端看到「segmentation fault」，lead 或 agent 可能误以为失败、再跑一次。重跑都是幂等的（实测 backfill / retire / record-manual 第二次都是 0 或已处理），record_profile_answers 我没核幂等。
- 另外，未捕获异常这条路不经过 `process.exit`，装了 safe_exit 照样崩（实测 17/400）。结果仍是非 0，语义不变，但说明「包 `process.exit`」这个办法天生盖不全。
- 根治建议（实测有效）：在进程启动时先把系统证书读完，不要等到退出前才读。
  - 做法：preload 文件只写一行 `tls.getCACertificates('system')`。
  - 效果：`NODE_OPTIONS=--import <preload>` 下，裸 `process.exit` 0/400、未捕获异常 0/400。
  - 落点：apply_batch 的 `runNode` / `runTee` 和 stream_run 的 `runChild` 给所有子进程注入这个 NODE_OPTIONS，约 5 行；或者清单和技能说明书里统一 `unset NODE_USE_SYSTEM_CA`。本机不开它，Ashby / GH 公开接口照样 200（实测），它只在公司代理换证书的网络里才需要。

### ⚠️ 风险 / 挂账（P4）

- `exit_segv.test` 靠概率抓崩溃：变异后只红 1/200、3/200，崩溃率再低一点就会漏过。另外 Linux CI 上天生是绿的（测试注释已写明）。它能防回退，但不算硬守卫。
- `emit_outcome_flush.test` 也只在 macOS 上会红，同上。
- FIN-START 残留窗口（builder 自报），维持 P4。

## 6. Quinn 重构记录（第 8 轮）

零。

## 7. 质量 3 指标（第 8 轮）

- 覆盖率：项目没有覆盖率工具，无数字。
- `verify_self_miss_rate: 50%`（1/2）：第 7 轮把 `submission_ledger:214` 判为「未定性」，没查到它其实是本机环境变量引起的 SIGSEGV（本轮找到的根因可以解释它）。SAFE-GAP 是本轮新代码的覆盖缺口，不算漏检。
- 真问题：1 个 P3，另外 P4 3 条。

## 8. 老坑清单核查（第 8 轮）

项目未定义 verify.md 老坑清单。主流程冒烟（ci_smoke.main_chain）在慢磁盘和 CA=1 下都跑通到打分 / 收工，投递本身禁止真投、未跑。

## 覆盖度评估

**质量分 4/5 —— 可推。清单有条件放行：第 9 步首批试投 2 条前，先二选一——①修掉 SAFE-GAP（给所有子进程注入 preload，约 5 行）；②在清单开头的 export 行里加 `unset NODE_USE_SYSTEM_CA`，并请拍板人确认本机不需要它（不走公司代理）。**

- FLUSH、驱动结局截断、SIGSEGV 根因三处修法都实测成立；第 6/7 轮问题全部终验通过；逐提交 CI 全绿；慢磁盘全量全绿；清单 1-8 和 10 在真实数据拷贝上走通。
- 扣 1 分：SIGSEGV 修法只包了 `process.exit`、只装了 5 个入口。流水线上的 cover letter 生成仍会偶发把成功当失败，把可投的岗搁置；未捕获异常这条路也包不住。影响低频，不会重投，但和 FLUSH 是同一类「该投的没投」。
- 驱动 stdout 同步写没有引入新风险。

## 试过的错误方向（第 8 轮）

- **一开始只拿 builder 的「exit(2) 短命脚本」当证据**：它只能证明 `process.exit` 会崩。补做「自然退出」和「未捕获异常」两格对照以后，才看出包 `process.exit` 盖不全，而在启动时先读完证书两种都能盖住。
- **覆盖检查起初只 grep `installSafeExit`**：直接 grep 会漏掉「通过 import driver_contract 间接装上」的文件（比如 cdp、驱动）。改成沿静态 import 链判可达，才得到准确的 7 个 SAFE / 36 个 bare。
