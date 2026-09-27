---
Status: done
Owner: arnold-bug
Type: bug_report
Updated: 2026-09-27
Reads: docs/active/2026-09-27_restart-apply-3_TASK.md, docs/active/2026-09-26_restart-apply-2_BUG_REPORT.md, shared/ashby_apply_driver.mjs, shared/page_signals.mjs, shared/submission_evidence.mjs, run50_b2.log, ~/.mrweirdo-jobs/feedback.jsonl, 专用 Chrome 两个仍开着的标签页（只读）, Ashby 公开前端脚本 index-JyJvxh41.js（只读 GET）
Blocks: 50 档非目标自动投恢复运行
---

# BUG_REPORT — Ashby 表单「只填到简历就停」（restart-apply-3 Round 4/5）

标注：[实测] = 本次亲手读到的日志 / 页面 / 代码；[推断] = 由实测推出、未做对照复现。
纪律：只读。未点击、未输入、未刷新任何标签页；未写 `~/.mrweirdo-jobs/`；未改代码、未 commit。

## 现场（What happened）

- Prior Labs（100014，21:11）、Rillet（100037，21:26）：驱动日志只有 `Upload resume… → Fill name/email… → Submit attempt 1… → missing fields:（空）`，结局 `unknown / no_errors_no_success`，`received: {registered:true, via:request_after_click}` [实测 run50_b2.log:866-872, 736；submit_r4.log]。
- 截图：两页除姓名/邮箱/电话/简历外所有必填都空，**页面上没有任何报错**；焦点还停在驱动最后打字的那一格（Rillet 电话、Prior Labs 邮箱）[实测 截图 + 现存标签页 `document.activeElement`]。
- Reevo ×2（100059 / 100057）：第 1 次点击后页面**确实**列出 4 个缺字段，驱动补了 3 个、「办公地点多选」补不上 → `needs_user / stuck_on_same_missing` [实测 run50_b2.log:907-912, 928-933, 742, 745]。
- 同时段 Sequence（Ashby）投成、Prophia（Greenhouse）投成。

## 根因（Why it happened）

### 1. 驱动「不是没去填」，而是设计上就不预先填 —— 它靠「点一次提交、读 Ashby 回来的缺字段清单」再补 [实测代码]

`shared/ashby_apply_driver.mjs` 顶部注释第 8-17 行、`main()` 1241-1382：打开 → 传简历 → 填姓名邮箱电话（`fillStandard` 462-482）→ **点提交** → 读页面里的 `Missing entry for required field: X`（544 行正则）→ 逐个补 → 最多再点 1 次。
所以「必填全空」本身正常；要命的是**第一次点击没换来缺字段清单**。不是扫描题目、选择器、懒加载或句柄失效的问题——驱动根本不扫描题目。

### 2. 第一次点击被 Ashby 自己的「还在保存，请稍后再试」闸吞掉了 —— 提交请求从没发出 [实测，代码证据 + 时间线]

**Ashby 前端的真实逻辑**（公开脚本 `cdn.ashbyprd.com/.../index-JyJvxh41.js`，只读下载后阅读）[实测]：
- 每个文本 / 电话 / 邮箱框，打字后 **500 毫秒防抖**再发 `ApiSetFormValue` 保存到服务器（组件里 `$j(f,500,[a])`）；保存期间通过 `onChangeIsSettingValue(path, loading)` 把该字段放进「正在更新」集合。
- 提交按钮处理函数：`se ? 弹 Warning 提示「We're updating your application (e.g. uploading files), please try again when they're finished.」 : 走人机验证 → 设备指纹 → 发 ApiSubmitSingleApplicationFormAction`。即**有任何字段在保存中，点提交只弹一个会自动消失的提示，什么都不发**。
- 「Missing entry for required field」这句**不在前端脚本里**，是服务端对提交请求的回复 [实测 grep 0 命中；推断其余分包也不含]。→ 提交请求没发出，就永远不会有缺字段清单。

**两个仍开着的标签页的网络记录**（`performance` 资源列表，只读）[实测]：

| 页面 | 字段保存请求（开始–结束，毫秒） | 之后的请求 |
|---|---|---|
| Rillet | 9255–9352、**9541–10175**、10049–10184 | 无。没有 `ApiSubmitSingleApplicationFormAction`，人机验证框内 0 条 `reload` |
| Prior Labs | **9150–9873**、9528–9623、9657–9797 | 同上，无提交请求 |

驱动报 `received: request_after_click`，而 `clickReceived`（`shared/page_signals.mjs:42-52`）只算「点击后开始的任何请求」—— 点击之后开始的只有这些字段保存，所以点击时刻 ≤ 最后一条保存的开始时间（Rillet ≤10049、Prior Labs ≤9657）。那一刻 Rillet 的 9541–10175、Prior Labs 的 9150–9873 **正在保存中** → 命中「正在更新」闸 → 点击被吞 [实测时间 + 代码推出；提示框本身已消失没看到，属推断]。

**驱动为什么会撞上**：`fillStandard` 用 `typetext` 连打姓名/邮箱/电话后直接返回（`ashby_apply_driver.mjs:462-482`），`main` 1242 → 1340 立刻进提交循环，中间**不等字段保存走完**。fa9c012 的「简历上传完成闸」只等简历上传（`waitUploadSettled` 371-382），没覆盖文本框保存 —— 而 Ashby 的闸对二者一视同仁。

**更正上一份报告**：`2026-09-26_restart-apply-2_BUG_REPORT.md` 第 2 章把同一症状（OpusClip / Creatify / ElevenLabs 三条 no_errors_no_success）推断为「简历上传没走完就点」。现在从 Ashby 源码看，真正的闸是「**任何字段**在保存中」，上传只是其中一种。fa9c012 修了一半 [实测代码 + 推断]。

**为什么时好时坏**：纯时间赛跑。Sequence、Reevo、Synthesia 点击那一刻恰好没有保存在途，提交就发出去了 [推断]。**为什么现在才暴露**：6696eb2 / 5bb409c 砍掉了自动再点（防重复投递，正确），以前第 2 次点击会在保存走完后发出、换回缺字段清单，把竞态盖住了 [实测 git log + 推断]。

### 3. 为什么判 unknown 而不是「没投出」（问题 2）[实测代码]

`ashby_apply_driver.mjs:1358-1372`：缺字段清单为空、页面无成功/失败字样 → 一律 `unknown`（可能投过）。漏掉三个能直接判「没发出」的信号：
1. **提交请求本身**：Ashby 只通过 `ApiSubmitSingleApplicationFormAction`（带问卷时 `ApiSubmitMultipleFormsAction`）提交。点击窗口内 CDP 监听（`clickwatch`，已有）没见到这条 = **确定没发出**。现在 `clickReceived` / `clickVerdict`（page_signals.mjs:42-73）把任何请求（含字段保存）都算「接住了」，信号被污染。
2. **必填空着**：页面上 `required` 的输入框值为空（现存标签页实测：Rillet LinkedIn、开放题；Prior Labs 薪资、所在地、开放题均 `required:true, value:""`）。Ashby 服务端对这种表单必回缺字段 → 不可能「投成了只是没显示」。
3. **Ashby 的警告提示**：「please try again when they're finished」会命中 `submission_evidence.mjs:56` 的 `try_again`，但驱动 7 秒后才第一次读页面，提示框已消失 [推断]。

### 4. Reevo 的 stuck_on_same_missing 为什么「still_missing 为空」（问题 3）[实测]

- 驱动**给了**清单：输出字段叫 `missing`（4 条，run50_b2.log:742/745）。`still_missing` 这个键**只在 essay_pending 分支里才有**（1328 行）；stuck 分支（1335 行）用的是 `missing`。读 `still_missing` 的下游（如 `apply_gap_report.mjs:107`）或 apply_batch 汇总行（run50_b2.log:807-825，只留 reason）就看到空。不是清单丢了，是**两个出口字段名不一致**。
- 原因名也误导：这不是「同样的缺项卡了两次」，而是**第 1 次就有一题补不上直接停**（1381-1382 行）。补不上的是「Which location(s) would you be open to working from?」—— 实际是**城市多选框**（San Francisco / Santa Clara / Both），驱动却按「是/否」题去找 `yes / i prefer not to answer` 按钮（`no_choice_match`, `buttons_seen:[]`）。它没标 `pending_for_main_claude`，所以也没进待办问题。
- 附带发现（另一个假成功）：薪资题是 `type=number` 输入框（截图带上下箭头、值为空），驱动往里打了英文句子并报 `ok:true`（`fillTextInQuestion` 592 行打完不回读）。数字框吃不下文字 → 实际空着 [截图实测 + 推断]。即使办公地点补上了，第 2 次提交也会被薪资卡住。

## 同模式风险扫描（Where else can it happen）

- **所有 Ashby 表单第 1 次点击**都在赌「最后一格保存是否已走完」。今天单次点击制度下 Ashby 首次点击 9 次：5 次 no_errors_no_success（OpusClip、Creatify、ElevenLabs、Prior Labs、Rillet）、2 次投成（Synthesia、Sequence）、2 次正常拿到缺字段（Reevo ×2）[实测 feedback.jsonl 计数；早上 3 条归因同一闸为推断]。**影响约一半 Ashby 岗**；Ashby 在本次候选里是最大平台（批 2 里 30 条中占多数，run50_b2.log:171）。
- **补字段后的第 2 次点击**同样会撞：`answerAll` 补完后只 `sleep(1200)`（1383 行）就点，而补的每一格也要 500 毫秒防抖 + 保存，在途概率同样高 [推断]。
- **Greenhouse 驱动**：没有同款「保存中」闸的证据（Prophia 顺利）；未查证。
- **所有「打完不回读」的填法**（`fillTextInQuestion`、`typeIntoQuestion` 等）：遇到数字框、带格式校验的框都会假成功 [推断，未逐个核]。

## 修复方案（How to fix）— 方向，交 builder

修 bug 三问：
1. 真根因：点提交前没等 Ashby 的字段保存走完（不只是简历上传）；以及「点击是否发出」的判据用错了信号（任何请求都算）。
2. 同一根因还会在第 2 次点击、以及所有 Ashby 岗爆。
3. 下面方向是消除根因，不是恢复盲点重试。

1. **点之前等「全部保存」走完**（两次点击前都要）：让最后一格失焦（Ashby 失焦会立刻保存，跳过防抖）后，轮询 `performance` 直到最后一条 `ApiSetFormValue*` / 上传请求结束且安静 ≥1 秒；超时 = crashed 大声报错。可把现有 `waitUploadSettled` 推广成「表单保存已落定」。
2. **「发没发出」只认提交请求本身**：`clickwatch` 窗口内有无 `op=ApiSubmitSingleApplicationFormAction|ApiSubmitMultipleFormsAction`。没有 → 判 `not_submitted / submit_request_not_sent`（确定没投、可安全重试 1 次）；有但页面无回应 → 才是 unknown。字段保存请求不再算「接住了」。
3. **必填空着 + 无成功字样 → 不判 unknown**：点前/点后扫一遍 `required` 空框，作为「Ashby 必拒」证据写进结局。
4. Reevo：统一出口字段（stuck 分支也写 `still_missing`，或下游两个都读）；原因名拆开「第 1 次就补不上」vs「补完仍列同样」；城市多选题走「地点」路由（按档案城市 / 全美可搬规则勾选，勾不了标待办）；`fillTextInQuestion` 打完回读值，数字框只填数字或报补不上。

取舍面：选「等保存 + 看提交请求」（彻底、多几秒/岗）而不是「固定多睡几秒」（简单，但网络慢时照样撞，且掩盖问题）。重试 1 次只在「确定没发出提交请求」时允许，不碰重复投递红线。

## 防回归（How to prevent regression）

- 假 cdp 场景：最后一格保存请求在途时点击 → 断言驱动先等、不点。
- 点击窗口只有 `ApiSetFormValue` 没有 `ApiSubmit*` → 断言结局是 not_submitted 而不是 unknown。
- Reevo 形状：城市多选 + 数字薪资框 → 断言不报假成功、清单进待办。
- 结局字段契约测试：所有 needs_user 出口都带同名缺项清单。

## 教训（What to remember）— 提示 lead 沉淀

- 查「点击为什么没反应」先读**对方平台的前端源码**（公开 JS），比靠时间线猜更准。上一份报告的「上传没完」只对了一半，就是因为停在了推断。
- 「接没接住」要看**那个动作专属的请求**，不能看「有没有任何请求」—— 页面后台一直有自动保存。
- 一个判定信号兼做两件事（安全闸 + 结果判据）时，砍掉自动再点这类改动会把被掩盖的竞态直接变成终局；改闸时要回头扫「以前谁在帮它兜」。

## 试过的错误方向

1. **「上传完成闸之后页面重渲染、字段句柄失效」**：否。驱动根本不预先定位题目句柄；现存页面所有字段都在、`id` 稳定，填好的姓名/邮箱/电话值都还在。
2. **「Ashby 前端校验拦下了但没显示」**：否。前端提交函数里没有必填校验，缺字段文字不在前端脚本中，是服务端回复。
3. **「人机验证（reCAPTCHA）静默失败」**：不能完全排除但证据不支持——人机验证框内 0 条 `reload`、父页面 0 条提交请求，而「保存中」闸在更前面就会返回；配合点击时刻有保存在途的实测时间，闸是更直接的解释。
