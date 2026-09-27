---
Status: done
Owner: arnold-verify
Type: verify_report
Mode: daily
Continues: docs/active/2026-09-26_restart-apply-2_VERIFY_REPORT.md（第 11-20 轮在那份；那份 Iterations 到 11 时被钩子封存，第 21 轮正文落在本档）
Task: docs/active/2026-09-27_restart-apply-3_TASK.md
Reads:
  - 6696eb2 / a5b6496 / fba2a0f 全 diff；shared/ashby_apply_driver.mjs、shared/greenhouse_apply_driver.mjs 提交循环；shared/cdp.mjs cmdClickwatch；test/submit_click_received.test.mjs
Updated: 2026-09-27
Iterations: 5
Living_doc: docs/specs/restart-apply-3.md
---

# 第 21 轮 — 砍掉自动再点（6696eb2 a5b6496 fba2a0f）

## 验收范围

lead 裁决：砍掉「自动再点」。builder 按裁决改了三处：
- 页面对这次点击没有任何回答（既没报缺字段，也读不出结果）时，任何路径都不再点。一律记 unknown、算可能投过，并截图。
- clickwatch 在观察窗口内断连或出错时，报「判不出」。
- 新增守卫测试。

保留不变的是原来的填表流程：页面明确报了缺字段，就补完再提交。

本轮重点：
- ① 用第 20 轮的 TCP 代理掐断场景复跑。
- ② 守卫测试是否覆盖了所有路径，尤其是补字段之后的再提交。
- ③ builder 自报的遗留问题：补字段再提交后，如果页面还显示旧的报错，会记 needs_user、不算投过。
- ④ 有没有绕过检测的改动；逐提交跑 CI。

没有真投，没有 push。真实家目录在 14:01 改了 `search_intent.json`，这是 lead 按拍板人的决定改的，见旧 TASK 第 62 行，不是本轮写的。

## 5 维高危区评估

- **① 重复投递 / 漏记（最高）**：自动再点砍掉之后，驱动里剩下的唯一一次「再点提交」就是「补字段后再提交」。所以这一轮最坏意图打的就是这一步。
- **② 平台边界**：diff 里没有任何新的页面操作。
- **④ 集成点**：用真 Chrome 复跑断连场景。
- **⑤ 主流程**：3 行报告删掉了「点了没收到」那一行，其余不变。
- **③ 真实性**：本轮不涉及答案内容。

## 7 类测试

| 技术 | 次数 | 用在哪 |
|---|---|---|
| 等价类 | 2 | 补字段后再提交：页面上的报错和上次一样（原样残留）；只剩一部分（部分残留） |
| 边界值 | 1 | 再提交之后只读 1 次页面（重读循环只在「没有报错」时才跑） |
| 决策表 | 1 | 两驱动 × 两种残留：最后是什么结局、点了几次、算不算投过 |
| 状态迁移 | 1 | 被拒 → 补字段 → 再提交 → 页面仍是旧报错 → 走哪个出口 |
| 用例测试 | 1 | 真 Chrome 的断连场景，以及点击后立即发出请求的场景 |
| pairwise | 1 | Ashby / Greenhouse × 两种残留 |
| 风险驱动 | 2 | 全量列出驱动里所有「点提交」的位置；diff grep 绕过检测的写法 |

## 5 轮回归循环记录

**1. 断连场景复跑（真 Chrome + TCP 代理）** [实测]

- 点击后 2 秒掐断连接：CDP 那边现在报 `watch.ok:false, error:"connection closed during watch"`，不再是「0 条请求」。
- 点击后立即发出请求：2ms 就能看到。
- 更关键的一点：驱动已经不读这个结论来决定要不要再点。页面没回答就一律记 unknown，所以断连场景下结构上就不可能出现第二次点击。✅

**2. 所有「点提交」的位置** [读码]

- 两个驱动里，提交按钮只在 `submitAndCheck` 里点。它只被 `submitOnce` 调用，`submitOnce` 又只在 attempt 循环里每轮调用一次。
- 能进入下一轮的前提是：页面列出了缺字段，而且这次列出的和上次不一样。
- 其他的 `.click()` 都是点单选、Yes/No 按钮和下拉选项。Ashby 的页面没有 `<form>`，所以按回车也不会提交。

**3. 守卫测试的覆盖**

- 覆盖到的：
  - 两驱动 × 5 种「页面没回答」的情况，都断言只点 1 次、记 unknown、有截图。
  - 源码守卫确认已经没有 reclick 分支，也没有 submit_click_not_registered。
- 没覆盖到的：
  - 测试名叫「单次运行点击 ≤1」，但它只在「第 1 次点击后页面没回答」这种情况下成立。
  - 补字段后的再提交本来就允许第 2、3 次点击，守卫没把这些点击计进去，也没有测「再提交后页面还残留旧报错」。

**4. 最坏意图：补字段再提交后，页面残留旧报错** [实测，驱动替身]

前提：第 2 次点击其实已经提交成功，只是服务端回得比 7 秒慢。再提交之后驱动只读 1 次页面，这时页面上还是旧报错。

| 场景 | Ashby | Greenhouse |
|---|---|---|
| 原样残留（[LinkedIn] → 补 → 仍是 [LinkedIn]） | needs_user / stuck_on_same_missing，点 2 次，**may_have_submitted=false** | 同左 |
| 部分残留（[LinkedIn, Website] → 补 → 剩 [Website]） | 再补 Website、**点第 3 次**，最后 needs_user，may=false | 同左，点 3 次 |

builder 自报的遗留成立，而且比自报的更严重：
- 原样残留时是漏记：账本记成没投过，以后会重投。
- 部分残留时，驱动会在这次运行里就对一份可能已经交上去的表单再点一次。

**5. 绕过检测**：diff 新增的代码行里 0 命中。这次只删了逻辑，并给 cdp 加了断连监听。✅

**6. 逐提交 CI**：6696eb2、a5b6496、fba2a0f 都是 636/636，smoke、gate、语法检查全部为 0。

## 结论明细

### ✅ 通过

- 页面没回答时，任何路径都不再点：结构上已经没有这条路，真 Chrome 断连场景也确认了。
- clickwatch 断连时报「判不出」。
- 3 行报告的口径一致。
- 没有绕过检测的改动，CI 全绿。

### ❌ 真 bug

**P2（命中维度 ① 重复投递 / 漏记）：补字段再提交后，如果服务端慢于约 7 秒，旧报错会被当成这次的回答。**

- 原样残留时记 needs_user、不算投过，以后会重投；部分残留时会再点一次。两个驱动都有，复现见第 4 条。
- **最小修法**（交 builder；约 5-10 行，两个驱动一样改）：
  - 第 2 次及以后的点击之后，如果页面仍列出缺字段，而且全部是上一轮已经补好的（recordFill 成功过），就判不出这次有没有交上去。这时记 unknown、算可能投过、截图、不再点。
  - 只要仍缺的字段里有一个是上一轮没填的（挂起了或填不了），页面就一定是被拒了：必填项还空着，服务端不可能收下。这种情况照原样走 needs_user，或者继续补。
  - 这样改，常见的「开放题挂起给主 agent 起草」不受影响。
  - 代价：少数「填了但控件没吃进去」的情况会变成 unknown，占一次名额，需要 lead 去邮箱核对。这符合「宁可漏投、不可重投」。
- **更彻底的修法（可选）**：clickwatch 看到请求后，继续等这些请求回来（Network.loadingFinished / loadingFailed），回来了再读页面；窗口内没等到就记 unknown。这样还能顺带收掉第 20 轮的 P4（点击约 19 秒后才发的请求会漏看）。
- **补测试**：上面两种残留 × 两个驱动，断言记 unknown、算可能投过、点击次数不再增加。

### ⚠️ 风险

- 守卫测试的名字写的是「单次运行 ≤1 次点击」，实际只守住了「页面没回答」这一类。建议改名，或者按上面补上再提交的测试。

## Quinn 重构 / 质量指标 / 老坑

- Quinn 重构：无。修法涉及判定逻辑，超出 1-3 行。
- `verify_self_miss_rate: 0%`（上轮漏检 0 / 本轮问题 2）。
- 真 bug：1 个（P2）。
- 老坑清单：项目没定义。

## 覆盖度评估

**质量分 3/5，回炉。**

- 自动再点已经砍干净了，断连场景也过了。
- 但「补字段再提交」是现在唯一剩下的再点路径。服务端慢时它会漏记，或者多点一次，违反「宁可漏投、不可重投」。
- 最小修法约 5-10 行，修完补上测试就能推。
- 覆盖：真 Chrome 断连场景、驱动替身 4 组、点提交位置全量读码、3 个提交逐一跑 CI。

## 试过的错误方向

- **一开始以为守卫测试守的是「单次运行 ≤1 次点击」**：读了测试才发现，它只在第 1 次点击后页面没回答时断言；补字段后的再提交不在守卫范围里。
- **一开始把残留旧报错只看成「漏记」**：实测部分残留时，驱动会补完再点第 3 次。后果从「以后会重投」升级成「这次运行就会重投」。
- **一开始怀疑 14:01 search_intent.json 的变化来自本轮 CI**：查了旧 TASK 第 62 行，是 lead 改的；而且前面 7 次逐提交 CI 都没碰过这个文件。

# 第 22 轮 — 补字段再提交最多 1 次（5bb409c f03a2ff）

## 验收范围

复验 builder 对第 21 轮 P2 的修复（未推），两个驱动都改了：
- 一次运行里最多点 2 次提交。
- 第 1 次被页面拒了，必须把列出的缺字段全部补上，才会点第 2 次；有任何一项补不上，就记 needs_user、停下。
- 第 2 次之后，看页面列出的缺字段：
  - 全是本轮已经补过的（原样残留或部分残留）：记 unknown、截图、停下。
  - 出现了本轮没填过的新字段：记 needs_user、停下。
- 原来的 rate_limited / max_attempts_exceeded 出口删掉了。

本轮没有真投、没有 push。真实家目录 14:05 之后没有文件变化。

## 5 维高危区评估

- **① 重复投递 / 漏记（最高）**：两件事。一是任何路径都不能出现第 3 次点击。二是「新字段 → needs_user」在账本里记 may_have_submitted=false；如果第 2 次其实已经交上去了，以后会重投。
- **② 平台边界**：确认没有绕过检测的改动。
- **④ 集成点**：CDP 断连叠加补字段路径。
- **⑤ 主流程**：两个驱动的提交循环整体重写了。
- **③ 真实性**：本轮不涉及答案内容。

## 7 类测试

| 技术 | 次数 | 用在哪 |
|---|---|---|
| 等价类 | 4 | 第 2 次之后页面列出的缺字段：原样残留 / 部分残留 / 全新字段 / 残留加新字段 |
| 边界值 | 1 | 每次都能补上、页面每次都报新字段（第 4 次序列）：看会不会点第 3 次 |
| 决策表 | 1 | 7 种场景 × 两驱动：结局、点击次数、may_have_submitted、有没有截图 |
| 状态迁移 | 2 | 被拒 → 全补 → 再提交 → 各出口；被拒 → 补不上 → 停 |
| 用例测试 | 1 | 复跑第 21 轮两驱动的实测场景（原样残留、部分残留） |
| pairwise | 1 | CDP 断连（点击结果读不出 / 只是观察断了）× 补字段路径 × 两驱动 |
| 风险驱动 | 2 | 「新字段」在第 2 次其实成功时会不会出现；diff grep 绕过检测的写法 |

## 5 轮回归循环记录（第 22 轮）

**1. 驱动替身实测：7 种场景 × 两驱动** [实测]

Greenhouse 那边用的是它的替身能填上的题（Gender / Veteran status）。

| 场景 | Ashby | Greenhouse |
|---|---|---|
| 原样残留 [A] → 补 → [A] | unknown / resubmit_page_lists_only_answered_fields，点 2 次，may=true，有截图 | 同左 |
| 部分残留 [A,B] → 补 → [B] | 同上，点 2 次 | 同上，点 2 次 |
| 新字段 [A] → 补 → [新] | needs_user，点 2 次，may=false | needs_user，点 2 次，may=false |
| 残留加新 [A] → 补 → [A,新] | needs_user，点 2 次，may=false | 同左 |
| 第 2 次点击结果读不出（CDP 断连） | unknown / submit_click_result_unreadable，点 2 次，may=true | 同左 |
| 第 2 次只是观察断了，页面也没回答 | unknown / no_errors_no_success，点 2 次，may=true | 同左 |
| 每次都能补上、页面每次报新字段（4 轮序列） | 点 1 次就停（新字段挂起给主 agent） | 点 2 次停，needs_user |

- 第 21 轮的两个复现场景（原样残留、部分残留），现在都记 unknown、算可能投过，而且不会点第 3 次。✅
- 7 种场景 × 两驱动，都没有第 3 次点击。循环写死了 `attempt <= 2`，第 2 次之后的每条分支都会直接出结局。✅
- CDP 断连叠加补字段路径时，都记 unknown、算可能投过。上一轮用真 Chrome 实测过，这轮 clickwatch 没有改动。✅

**2. 最坏意图：第 2 次其实成功了，页面却列出「新字段」** [读码 + 推演]

- 账本口径：needs_user 带着非空的缺字段清单时，`deriveMayHaveSubmitted` 按第 4 条规则返回 **false**，不算投过。所以一旦误判，以后会重投。
- 要误判，前提是：第 2 次交上去之后，页面上出现了本轮没填过的缺字段报错。
- **Ashby**：缺字段只从「Missing entry for required field: X」这种报错文字里取。这类报错是服务端对某一次提交的回复。第 1 次的旧报错全部补过了；页面上出现没补过的新报错，只能是第 2 次提交的新回复，也就是被拒了。所以判 needs_user 是对的。
- **Greenhouse**：报错是页面自己在提交前做的校验（没填的必填项会被页面直接拦下，不发出去）。报出新的必填项，说明表单没通过校验。所以判 needs_user 也是对的。
- **剩余的理论缝隙（P4）**：Greenhouse 从报错往上找最近的 label，靠这个认出是哪道题。如果填表之后页面结构变了，同一条旧报错可能被认成另一个题目名，被误当成「新字段」。这只是推演，没有复现；真实页面上还没见过这种情况。

**3. 绕过检测**：diff 新增的代码行 0 命中。唯一的 `Math.random` 是原来就有的挂起字段 id 代码，只是挪了位置。✅

**4. 逐提交 CI**：5bb409c 和 f03a2ff 都是 646/646，smoke、gate、语法检查全是 0。

## 结论明细（第 22 轮）

### ✅ 通过

- 第 21 轮 P2 修好了：旧报错残留时记 unknown、算可能投过。
- 零第 3 次点击，两个驱动一致。
- CDP 断连叠加补字段路径时，都记 unknown。
- 「新字段 → needs_user」：新报错只可能来自第 2 次提交的新回复（Ashby），或页面自己的必填校验没通过（Greenhouse），两种都说明被拒了。所以记不算投过，是对的。
- 没有绕过检测的改动，CI 全绿。

### ❌ 真 bug

无。

### ⚠️ 风险

- **P4**：Greenhouse 从报错往上找 label 来认题目。如果填表之后页面结构变了，同一条旧报错可能被认成另一个题目名，被误判成新字段（记不算投过）。这是推演，没有复现。建议以后真投时如果出现「第 2 次后报新字段」，先人工看截图再重投。
- **观察**：第 20 轮的 P4（点击约 19 秒之后才发出的请求会漏看）已经没有影响了。现在驱动在任何情况下都不再看网络结论来决定再点。
- **代价**：真实页面上「补一轮又冒出新题」的情况，现在最多只补 1 轮就停，交给主 agent 或用户补齐之后，下次运行再投。这是按 lead 的裁决，用吞吐换安全。

## Quinn 重构 / 质量指标 / 老坑（第 22 轮）

- Quinn 重构：无。
- `verify_self_miss_rate: 0%`（上轮漏检 0 / 本轮问题 1）。
- 真 bug：0。
- 老坑清单：项目没定义。

## 覆盖度评估（第 22 轮）

**质量分 4/5，可推。**
- 覆盖：7 种场景 × 两驱动，共 14 组替身实测；账本口径推演；两驱动缺字段来源读码；grep；逐提交 CI。
- 扣 1 分：真驱动没有在真 ATS 上跑（禁止真投），服务端慢的时候页面怎么表现没法实测；另外还有一个 Greenhouse 认题名漂移的 P4 推演。

## 试过的错误方向（第 22 轮）

- **一开始用 Ashby 的题目（LinkedIn）去测 Greenhouse**：Greenhouse 的替身填不了这道题，结果每次都是「补不上 → 点 1 次就停」，根本没测到再提交。后来照 builder 的测试改用 Gender / Veteran status，才真正测到第 2 次点击。
- **一开始把截图文件名的结尾读成了「submitted」，以为出错了**：实际文件名是 `_after_not_submitted.png`，是我自己按下划线切字符串切错了。页面判定是「没投出」，没有问题。

# 第 23 轮 — 方向预筛 / 年限口径 / release 任意链接（cf5375b 72597d8 9712a37 da981ba）

## 验收范围

验收 builder 第 8 次召唤的 4 个提交（都没推）：
- **① 方向预筛**（cf5375b）：标题明显属于用户不要的专业职能时，在硬筛就拦下，原因记 `function_mismatch:<职能>`，省下打分的钱。这些职能包括客服、设计、财务、法务、招聘、销售 AE、工程、研究、数据、行政、临床、物流。
- **② 年限口径**（72597d8）：提示词写明只有「最低要求 ≥3 年」才算不合格。不合格的行必须写 `reject_reasons`。如果某行只因年限被判不合格，而 JD 的起步年限不到 3 年，就整批拒收、退回重打。
- **③ release 任意链接**（9712a37）：名单扫描没遇到的 Greenhouse / Ashby 链接，按岗位编号从公开板接口直接取，然后走同一套硬筛 → 去重闸 → 打分 → 投前闸 → 唯一写账人。
- da981ba 是文档。

本轮没有真投，没有 push。真实家目录在验收期间有 3 个文件变化：15:03 的 seen / source_cursor 来自 lead 的 --no-submit 试跑 18:56Z；15:40 的 submissions 是 lead 的 record-manual 4 条（见 TASK 末尾）。都不是本轮写的。

## 5 维高危区评估

- **① 核心业务逻辑（最高）**：预筛会不会误杀对口的岗位（钱省了，机会也丢了），会不会漏放；「整批退回」会不会让一批永远重打、卡死运行。
- **② 名额与去重边界**：release 非名单链接能不能绕过去重、60 天、日档位、名单 held。
- **⑤ 主流程**：提交次数守卫有没有被削弱。
- **④ 集成点**：release 走公开板接口。
- **③ 平台边界**：有没有绕过检测的改动。

## 7 类测试

| 技术 | 次数 | 用在哪 |
|---|---|---|
| 等价类 | 3 | 预筛标题分三类：对口 / 专业职能 / 混合（职能词 + 用户领域词） |
| 边界值 | 2 | 年限「3+ preferred, 1+ required」；JD 里一个小年限加一个没被识别的大年限 |
| 决策表 | 1 | `yearsOnlyRejectionConflict`：7 种 JD × 打分器给的最低年限 |
| 状态迁移 | 1 | store 拒收 → 批次挂起 → 重打 → 入库：会不会出不去 |
| 用例测试 | 1 | 用真实 search_intent（只读）跑 85 个标题 |
| pairwise | 1 | 新预筛 × 旧的排除词硬筛，对比同一批标题的结论 |
| 风险驱动 | 3 | release 的 company 口径与闸门；驱动文件 diff 是否为空；grep 绕过检测的写法 |

## 5 轮回归循环记录（第 23 轮）

**1. 预筛误杀和漏放**（真实 search_intent 只读，85 个标题）[实测]

- 放行的有：Founder / Founding / Founder's Associate、GTM Associate、Go-to-Market Strategy、Growth（Marketing / Analyst / Data Analyst）、Marketing Analytics、Community（Manager / Support Specialist / Operations / Head of Community）、Social Media、Content（Creator / Strategist）、Creative、UGC、Marketing Ops、Product（Manager / Marketing / Ops / Analyst / Technical PM）、Operations、BizOps、Strategy & Ops、Chief of Staff、RevOps、Partnerships、BDR、Influencer、PR、Communications、Customer Success Associate (Growth)、Growth Associate, Investments 等。✅
- 拦下的有：GTM Engineer、Growth Engineer、Marketing Engineer、Prompt Engineer、Developer Relations、Developer Advocate、Solutions Engineer、User Researcher。拿旧的排除词硬筛（title_excludes）跑同一批标题，这 8 个**原来就被拦**（命中 engineer / developer / researcher）。所以不是本轮新增的误杀。第 5 轮挂着的「Prompt / Automation / Martech Engineer 是否放行」仍待拍板。
- 本轮**新增**的拦截：Content Designer、Research Associate, Marketing、Customer Success Manager、Strategic Finance Associate、Account Executive、Office Manager、People Ops、Legal Ops。后 6 个属于用户排除的职能，拦下是对的。前 2 个见下面 P3。
- 漏放：Account Executive, Growth 被当成用户的领域放行了（AE 本来是排除的）。这类标题交给打分器判，只多花一点打分钱，不会投错。

**2. 年限口径和「整批退回」** [实测]

- 7 种 JD：「2+ TikTok；5+ marketing」判 5 年；「1-2 social；至少 4 年」判 4；「3+ preferred；1+ required」判 1；「Minimum of three years」判 3；「Five or more」判 5；「2 SQL；6+ PM」判 6。这些都正确。
- 会不会卡死：store 拒收后，运行会 `die`，这一批留在挂起，等主 agent 改分之后重新提交。它不会自己循环，也不是死锁：打分器把确实只因年限的不合格改成合格，或者改用真实的理由（seniority 等），就能入库。
- 剩余的缝隙（P4）：
  - JD 里如果同时有一个小年限，和一个解析器认不出的大年限（例如「1+ years Figma and a decade of marketing」），规则会判「起步 1 年」。这时打分器只能改判合格，或者换一个理由，否则这一批永远入不了库。
  - 反过来，打分器也可以把理由从 experience_years 改成 other 来绕过这项检查。检查只看理由标签，拦不住换标签。

**3. release 的闸门** [读码 + builder 测试]

- 直取回来的岗位，公司名就是链接里的板 slug。名单扫描和批量扫描也用 slug（ADR-S2），所以 60 天按公司计数不会被分成两家。
- release 只解除 held_for_review，其他的全照原样：去重（identityBlock）、seen、60 天、日档位（投前闸 / apply_batch）。已经投过的岗再 release，会被投前闸拦下（builder 的测试第 97 行）。
- 名单公司的链接由名单扫描找到，不再直取（测试第 123 行）。只有扫描没遇到的链接，才走 `release` 源。
- 取不到的、被硬筛拦下的链接，第 2 行报告会逐条说明原因，不会静默丢掉。✅

**4. 提交次数守卫**：从 5bb409c 到 da981ba，两个驱动、driver_contract、cdp.mjs、submit_click_received 测试的 diff 都是空的，守卫没被削弱。✅

**5. 绕过检测**：diff 新增的代码行 0 命中（fingerprint 命中的只是本项目的岗位指纹函数 `jobFingerprint`）。✅

**6. 逐提交 CI**：cf5375b 650/650，72597d8 654/654，9712a37 660/660，da981ba 660/660。smoke、gate、语法检查全部为 0。

## 结论明细（第 23 轮）

### ✅ 通过

- 预筛对 Founder Associate / GTM / Growth / Community / Social / Content / Marketing / Ops / Product / Chief of Staff / BizOps 这些类别都放行；工程和研究类的拦截是原来就有的。
- 年限口径正确。「整批退回」不会死锁。
- release 没有绕开任何闸门，只解除了 held。
- 提交次数守卫没有被削弱，没有绕过检测的改动，CI 全绿。

### ❌ 真 bug

无。

### ⚠️ 风险

- **P3（预筛新增的误杀，影响小）**：
  - 「Research Associate, Marketing」被当成研究拦下：负向回看只排除了紧挨着的 market / marketing research，词序反过来就认不出。
  - 「Content Designer」被当成设计拦下。它偏 UX 写作，算不算对口，由 lead 或拍板人定。
  - 两个都是本轮新增的拦截，建议 builder 补一条规则：标题里有用户领域词（marketing / content）的研究或设计岗，交给打分器判，不在硬筛拦。
- **P4（年限）**：JD 里有「小年限 + 认不出的大年限」时，整批会一直入不了库，只能靠打分器改理由。反过来，改理由也能绕过这项检查。建议记进老坑：store 拒收 years_misjudged 时，人工看一眼那条 JD。
- **待拍板（第 5 轮挂账）**：GTM / Growth / Prompt / Marketing Engineer 和 DevRel 是否放行。现在旧规则和新规则都会拦。

## Quinn 重构 / 质量指标 / 老坑（第 23 轮）

- Quinn 重构：无。预筛正则改动涉及业务判断，交 builder。
- `verify_self_miss_rate: 0%`（上轮漏检 0 / 本轮问题 2）。
- 真 bug：0。
- 老坑清单：项目没定义。

## 覆盖度评估（第 23 轮）

**质量分 4/5，可推。**
- 覆盖：85 个标题在真实 intent 下跑新旧两套规则对比、7 种 JD 年限、store 拒收路径推演、release 闸门读码加测试、驱动 diff 为空的确认、逐提交 CI。
- 扣 1 分：没有在真实名单拷贝上复核 builder 自报的「45→31、17 个对口应届全放行」这个数；另有 2 个预筛新增误杀（P3）。

## 试过的错误方向（第 23 轮）

- **一开始把 GTM / Growth Engineer、DevRel 被拦算成本轮的误杀**：拿旧的 title_excludes 跑同一批标题对比后，发现旧规则早就在拦它们。所以不算回归，改列为第 5 轮挂账的待拍板项。
- **一开始以为 15:40 的真实账本写入是本轮 CI 写的**：看了账本末行和 TASK 末尾，是 lead 在拍板人手投之后跑的 record-manual；15:03 是 lead 的 --no-submit 试跑。

# 第 24 轮 — release 运行只打点名链接（bc3d070）

## 验收范围

Round 3 真实运行时，2 条非名单的放行链接没进批次：打分额度被 20 个待重打的名单岗用光了。报告还把它们误写成「可能已下架」。

builder 的 `bc3d070`（未推）改了三处：
- release 运行只处理点名的链接。名单扫描只用来找点名的名单岗，其余名单岗不进打分，也不占额度。
- 打分额度至少等于放行条数。
- 第 2 行报告按类写原因：没打到分、公开接口取不到（疑似下架）、打分不合格、被闸拦、合格但没派出。

本轮要验：
- 名单岗 held 解锁还正常吗。
- 点名链接是不是仍然全部经过去重、60 天、日档位、投前闸和唯一写账人。
- 点名重复链接、已投链接、下架链接时，报告怎么写。
- 普通运行受不受影响。
- 提交次数守卫、有没有绕过检测的改动、CI。

本轮没有真投、没有 push。另外，worktree 列表里有一个 `wt-recheck27`，是 lead 并行复验的，不是本轮建的，我没动。

## 5 维高危区评估

- **① 名额与去重（最高）**：点名链接能不能借 release 绕开 60 天、日档位或已投拦截。
- **⑤ 主流程**：名单岗 held 解锁；普通运行（不带 release）的名单扫描、轮转和 held 不能变。
- **① 报告真实性**：第 2 行不能把「没打分」写成「下架」。
- **②③ 平台边界 / 提交守卫**：驱动文件没有改动。
- **④ 集成点**：release 取岗沿用第 23 轮的实现，这次没改。

## 7 类测试

| 技术 | 次数 | 用在哪 |
|---|---|---|
| 等价类 | 4 | 点名的是：名单岗（原本 held）/ 非名单岗 / 重复链接 / 已投链接 |
| 边界值 | 2 | 点名条数大于 target（target 1、点名 17 条）；点名条数大于日档位（target 20、日档位 10） |
| 决策表 | 1 | 同一家公司点名 3 条 × 60 天上限 2 次，连跑 2 轮 |
| 状态迁移 | 1 | 名单岗第 1 轮 held → 第 2 轮 release → 投出 |
| 用例测试 | 1 | 复现 Round 3（builder 的测试）加普通运行对照 |
| pairwise | 1 | 点名链接写法（带 /application / 不带）× 去重 |
| 风险驱动 | 2 | 驱动和守卫文件的 diff 为空；grep 绕过检测的写法 |

## 5 轮回归循环记录（第 24 轮）

用的是 stream_run 替身环境，家目录是沙箱。

- **A 名单岗 held 解锁**：第 1 轮普通运行，名单岗合格后被 held，驱动调用 0 次。第 2 轮 release 它，结果「投出 1 个：pika·Growth Intern 1」。✅
- **B 同一链接点名两次**（带 /application 和不带各一次）：驱动只调用 1 次，投出 1 个，第 2 行没有多余条目。✅
- **C 点名 17 条、target 1**：17 条全都打了分，只投出 1 个，其余 16 条写「合格但没派出：not_dispatched:target_reached」。这说明打分额度被放宽了，但 target 没有被放宽。✅
- **C2 点名 17 条、target 20**：投出 10 个，正好停在日档位 10。其余 7 条写「合格但没派出：not_dispatched:daily_cap_reached」。✅
- **C3 同一家公司点名 3 条，连跑 2 轮**（日档位 25）：
  - 第 1 轮投出 2 个，第 3 条没派出。
  - 第 2 轮三条全部被闸拦：两条是 `already_attempted_fp`，一条是 `company_cooldown_60d`。60 天每家 2 次的上限守住了。✅
  - 但第 1 轮第 3 条写的是「not_dispatched:supply_exhausted」，没有说是同一家公司名额满了（见 P4）。
- **D 普通运行**（不带 release，名单 1 个、轮转 2 个）：打分 3 个，投出 2 个，名单那条照常 held。不受影响。✅
- **下架 / 取岗出错 / 被硬筛拦 / 已投**：builder 的测试已经覆盖了措辞，分别是「公开接口取不到（疑似下架）」「取岗出错：fetch_failed:…」「被闸拦：hard_filter:…」「被闸拦：already_attempted_fp」。✅
- **守卫**：从 da981ba 到 bc3d070，两个驱动、driver_contract、cdp.mjs、submit_click_received 测试的 diff 都是空的。grep 绕过检测的写法，0 命中。✅
- **CI**：bc3d070 663/663，smoke、gate、语法检查都是 0。

## 结论明细（第 24 轮）

### ✅ 通过

- release 运行只打点名的链接，Round 3 的问题修好了。
- 名单岗的 held 解锁正常。
- 点名链接全部经过去重、60 天、日档位、投前闸和唯一写账人。
- 普通运行不受影响。
- 报告不再把「没打分」写成「下架」。
- 守卫没有被动过，没有绕过检测的改动，CI 全绿。

### ❌ 真 bug

无。

### ⚠️ 风险

- **P4（措辞）**：同一家公司点名超过 60 天剩余名额时，多出来的那条在当轮写「合格但没派出：not_dispatched:supply_exhausted」，没有说是「这家 60 天名额满了」。下一轮会正确写成「被闸拦：company_cooldown_60d」。
- **观察（口径，由 lead 定）**：
  - release 运行不会自动把 target 提到放行条数。拍板人点名 N 条、target 却小于 N 时，多出来的会写「合格但没派出：target_reached」。报告如实写了，但拍板人可能以为「点名 = 全投」。建议 lead 发起 release 时让 target 至少等于点名条数，或者由 builder 自动抬高（日档位仍然照常封顶）。
  - release 运行现在不再顺带投普通岗。

## Quinn 重构 / 质量指标 / 老坑（第 24 轮）

- Quinn 重构：无。
- `verify_self_miss_rate: 0%`（上轮漏检 0 / 本轮问题 1）。
- 真 bug：0。
- 老坑清单：项目没定义。

## 覆盖度评估（第 24 轮）

**质量分 4/5，可推。**
- 覆盖：替身环境 6 组场景（held 解锁、重复链接、target 边界、日档位、60 天连跑 2 轮、普通运行对照）；builder 已有的措辞测试；守卫 diff 为空的确认；CI。
- 扣 1 分：没有在真网络上复跑 Round 3（禁止真投）；另有 supply_exhausted 措辞不准的 P4。

## 试过的错误方向（第 24 轮）

- **一开始用 target 1 测日档位**：结果被 target 先挡住了，日档位根本没测到。改成 target 20 才测到日档位 10。
- **一开始想让同一家公司的 3 条和其他 14 条一起跑，看 60 天名额**：结果日档位先满，sequence 那 3 条一条都没派出，60 天没测到。改成只点名 sequence 的 3 条、连跑 2 轮，才测到 60 天。

# 第 25 轮 — Ashby 页面空闲闸 / 只认提交请求 / Reevo 三项（5622208 1aee1d3）

## 验收范围

验收 builder 的 `5622208`（代码）和 `1aee1d3`（文档），都没推。根因见 BUG_REPORT：Ashby 前端在任何字段自动保存进行中时，点提交只会弹一个会自动消失的提示，不发提交请求。改动三项：
- **① 页面空闲闸**：简历上传后，以及每次点提交前，都要等到没有正在进行的请求、且表单请求数稳定。用两个信号一起判断：CDP 的 `netidle` 看还在路上的请求，页面的 `formSettled` 看已完成请求的数量。30 秒内等不到空闲，就记 `crashed/form_saves_not_settled`，不点提交，不算投过。
- **② 点击算不算接住**：只认 `ApiSubmit(SingleApplicationForm|MultipleForms)Action` 这两种提交请求（clickwatch --only）。字段自动保存的请求不再算接住。如果点击后没有提交请求、并且页面上的必填项仍然空着，就判 `not_submitted/submit_request_not_sent`，不算投过。
- **③ Reevo 三项**：缺项字段统一读取（pageMissingOf）；城市多选题走勾选路由；数字薪资框只填数字；打字之后回读确认。

builder 自己说明过：这些改动只在本机的假页面上验证过，没有在真的 Ashby 页面上跑。

本轮没有真投、没有 push。真实家目录只有 `chrome-profile/` 在变，那是投递用的 Chrome 日常活动；我开的无头 Chrome 用的都是 scratchpad 里的独立目录。其余文件在 17:50 之后都没有变化。

## 5 维高危区评估

- **① 名额口径 / 重复投递（最高）**：新的 not_submitted 会让这条不算投过，以后可以再投。一旦把真正投成的判成 not_submitted，就会重复投递。所以要检查这两个条件（没见到提交请求、必填为空）够不够严。
- **④ 集成点**：Ashby 前端的真实行为。可以只读地去看：公开的 JS 脚本、公开投递页的 DOM、页面加载后的网络情况。
- **⑤ 主流程**：空闲闸如果永远等不到，所有 Ashby 岗都会停在点提交之前。
- **② 平台边界**：确认没有绕过检测的改动。
- **③ 真实性**：Reevo 的薪资框和城市勾选题，答案从哪来。

## 7 类测试

| 技术 | 次数 | 用在哪 |
|---|---|---|
| 等价类 | 4 | 点击窗口内看到的请求：只有自动保存 / 有提交请求 / 提交请求名变体 / 什么都没有 |
| 边界值 | 2 | 空闲的安静时长 1.5 秒（Ashby 自动保存的防抖是 500 毫秒）；必填读取失败 |
| 决策表 | 1 | CDP 观察（正常 / 断连）× 页面记录（有 / 无提交请求 / 新页面）× 必填（空 / 满 / 读不出），共 9 种组合 |
| 状态迁移 | 1 | 空闲闸 → 点击 → 判定：接住 / unknown / not_submitted |
| 用例测试 | 2 | 真实 Ashby 公开投递页（ElevenLabs、Suno），只读渲染 DOM 并测网络空闲 |
| pairwise | 1 | CDP 断连 × 必填为空 |
| 风险驱动 | 3 | 下载 Ashby 公开前端 JS，核对提交请求名和 URL 的构成；diff 驱动守卫；grep 绕过检测的写法 |

## 5 轮回归循环记录（第 25 轮）

**1. Ashby 公开前端 JS**（只读 GET：`manifest.json` → `index-JyJvxh41.js`）[实测]

- graphql 请求的地址写死成 `/api/non-user-graphql?op=${operationName}`，操作名在 URL 里，所以按 URL 匹配提交请求是可行的。✅
- 全部以 `ApiSubmit*` 开头的操作共 12 个。跟投递有关的只有 `ApiSubmitSingleApplicationFormAction` 和 `ApiSubmitMultipleFormsAction`，和 builder 写的一致。其余是面试反馈、日程、短信授权、问卷等，不相关。
- 「We're updating your application」这句提示在脚本里出现 2 次，BUG_REPORT 说的前端保存闸确实存在。

**2. 真实 Ashby 投递页 DOM**（ElevenLabs、Suno 各一个公开岗；无头 Chrome 只渲染和读取，不填、不点）[实测]

- 带 `required` 属性的只有：姓名、邮箱、简历（file）、必填的文本框和 textarea。
- 地点下拉框（role=combobox）**没有** required；单选、复选也**没有** required。
- 页面刚打开时，`emptyRequiredFields` 读出来的结果：ElevenLabs 是 Name、Email、LinkedIn、AI 工具开放题；Suno 是 Name、Email、Why Suno。和页面上真正的必填文本项一一对应。
- 结论：「必填为空」这个信号只会盯着纯文本类的必填框。不存在「下拉框已经选了、但读出来是空」这种误判。单选、复选题漏看的话，只会让结果走向 unknown，是安全的方向。✅

**3. 真实页面的网络空闲**（`cdp.mjs netidle 1500 30000`）[实测]

- 页面加载完 2.3 秒内就进入空闲。这期间看到 4 个 graphql 请求：ApiJobPosting、2 个 Organization、ApiAutocompleteGeoLocation。
- 再等 5 秒，没有任何周期性请求，1.5 秒就判空闲。
- 所以空闲闸不会因为后台轮询而永远等不到。字段保存一直不停的情况，会在 30 秒后记 crashed，这发生在点击之前，不点、不算投过（builder 测试第 252 行覆盖了）。✅

**4. 判定边界：驱动替身 9 种组合** [实测]

| 场景 | 结局 | 点击 | may_have_submitted |
|---|---|---|---|
| 点击后只有自动保存 + 必填为空 | not_submitted / submit_request_not_sent | 1 | false |
| 看到了提交请求 + 必填为空 | unknown | 1 | true |
| 只在页面记录里看到提交请求（CDP 没看到） | unknown | 1 | true |
| CDP 断连 + 必填为空 | unknown | 1 | true |
| 页面换成了新文档 + 必填为空 | unknown | 1 | true |
| 提交请求名变体（认不出）+ 必填为空 | not_submitted | 1 | false |
| 没有提交请求 + 必填全部已填 | unknown | 1 | true |
| 必填读取失败 | unknown | 1 | true |

- 要判 not_submitted，必须同时满足四件事：CDP 观察正常地看完了整个窗口；页面记录里也没有提交请求；页面没有换成新文档；必填里读出了空项。缺任何一项，都会退回 unknown。
- 提交请求名变体那一行判 not_submitted，我认为是可以接受的：真实页面上有必填文本框为空，Ashby 服务端一定会拒（BUG_REPORT 里那句「Missing entry」就是服务端回的），所以不可能投成。第一次点击时，驱动本来就还没填那些自定义必填项。补字段之后再提交时，页面上仍然为空的必填项同样会被拒。所以「必填为空」这一条本身就足够说明没投成。另一条「没见到提交请求」是加上去的第二道保险。✅
- **剩余的理论缝隙（P4）**：只有在某个字段 DOM 上带 required、但 Ashby 服务端并不要求它时，才可能误判。Ashby 前端的 required 属性就来自同一份字段配置，这种情况没有找到证据。

**5. 守卫和绕过检测**
- 两个驱动的点击循环仍然是 `attempt <= 2`。旧的守卫测试只是把 uploadSettled 改名成 formSettled、放宽了 settle 事件的截取范围，断言本身没有变弱。✅
- Greenhouse 驱动这次没有改动。
- diff 新增代码 grep 0 命中。`netidle` / `clickwatch --only` 只是在浏览器调试端监听网络。✅

**6. 逐提交 CI**：5622208 和 1aee1d3 都是 715/715，smoke、gate、语法检查全是 0。

## 结论明细（第 25 轮）

### ✅ 通过

- 空闲闸在真实页面上能等到空闲，不会被后台请求卡住；一直等不到时，在点击之前就停下，不算投过。
- 「接住」只认提交请求，和 Ashby 公开脚本一致。
- not_submitted 的判定足够严：四个条件缺一个就退回 unknown；真实页面的 required 只挂在纯文本类必填上，不会误报。
- CDP 断连、页面跳转、请求名变体、必填读取失败，都退回 unknown，或者按「服务端必拒」判为 not_submitted。
- 提交次数守卫没有被削弱，没有绕过检测的改动，CI 全绿。

### ❌ 真 bug

无。

### ⚠️ 风险

- **P4**：只有「DOM 上是 required，但服务端不要求」的字段，才可能把真投成的判成 not_submitted。目前没有找到证据。
- **未实测**：真 Ashby 页面上的「填表 → 空闲闸 → 点提交」全流程没有跑过（禁止真投，也不在真实投递页上填写）。第一次真投时，建议 lead 看驱动日志里的 `upload_rounds`、空闲闸轮数，以及结局是不是 submit_request_not_sent 或 unknown；如果出现 not_submitted，去邮箱核对一次。
- Reevo 三项（城市勾选、数字薪资、打字回读）只在假页面上测过，本轮没有单独深挖。builder 的 reevo_form_fixes 测试 206 行都通过了。

## Quinn 重构 / 质量指标 / 老坑（第 25 轮）

- Quinn 重构：无。
- `verify_self_miss_rate: 0%`（上轮漏检 0 / 本轮问题 1）。
- 真 bug：0。
- 老坑清单：项目没定义。建议补一条：Ashby 的提交判定依赖 `op=` 写在 URL 里、依赖 required 只挂在文本类框上。Ashby 前端升级之后，要用 `index-*.js` 和真实页面 DOM 重新核一遍。

## 覆盖度评估（第 25 轮）

**质量分 4/5，可推。**
- 覆盖：Ashby 公开 JS 核对、两个真实投递页的 DOM 和网络空闲（只读）、驱动替身 9 种判定组合、守卫 diff、逐提交 CI。
- 扣 1 分：真实页面上的「填表 → 点提交」全流程没有跑过（纪律不允许）；Reevo 三项只靠 builder 的假页面测试。

## 试过的错误方向（第 25 轮）

- **一开始写的边界替身没有给 netidle 提供结果**：简历上传后的空闲闸一直等不到，每个场景都在点击前 crashed，也就测不到判定逻辑。照 builder 的 ashby_submit_gate 测试，用 `__MRW_CDP_RULES` 把 netidle 设成空闲，才测到点击后的判定。
- **一开始担心地点下拉框选好之后 input 的值是空，会被当成「必填为空」**：去真实页面上看了 DOM，下拉框根本不带 required，所以这个担心不成立。
