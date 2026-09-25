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
Updated: 2026-09-25
Iterations: 1
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
