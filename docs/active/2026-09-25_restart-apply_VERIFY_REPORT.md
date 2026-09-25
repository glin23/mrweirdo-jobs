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
Updated: 2026-09-25
Iterations: 2
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
