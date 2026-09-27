---
Status: done
Owner: arnold-verify
Type: verify_report
Mode: daily
Continues: docs/active/2026-09-25_restart-apply_VERIFY_REPORT.md（第 1-10 轮在那份；那份因 Iterations 钩子上限封存，文件头已写 Iterations: 11，但正文只到第 10 轮，第 11 轮正文在本档）
Task: docs/active/2026-09-26_restart-apply-2_TASK.md
Living_doc: docs/specs/restart-apply.md（本 topic 是 restart-apply 的续档，定稿结论沉在父 topic 的定稿文档；是否另建 restart-apply-2.md 由 lead 定）
Reads:
  - （第 11 轮）2171bee / 736f97b / 7de0026 全 diff；safe_exit / preload_system_ca / entry_preload_guard 测试；说明书与 .sh 里的 node 调用
  - （第 12 轮）TASK Round 23-24；10ec8b7 / 029d522 / f828014 全 diff；submission_ledger（correct / appendCorrection / effectiveEntries）、apply_guard（attemptIndex / identityBlock / checkDispatch）；ledger_correct 测试；真实家目录拷贝
  - （第 13 轮）restart-apply-2 TASK / BUG_REPORT；BUILD_NOTES「第 5 次召唤追加 3」「第 6 次召唤」；b75cb6e…b89cec2 全 diff；role_types / location_gate / discover_candidates / store_scored_jobs / eligibility / recompute_auto_apply_eligibility / validate_auto_row / job_identity；真实家目录拷贝（r13/home）
Updated: 2026-09-27
Iterations: 11
---

# VERIFY_REPORT（续）— restart-apply 第 11、12 轮

> 本档续写 `2026-09-25_restart-apply_VERIFY_REPORT.md`。那份档案的迭代轮数到了钩子上限，没法再改，所以 lead 决定第 11、12 轮的正文落在这里。本档 Iterations 记为 2，对应这两轮。
> 标注：[实测] 真跑过；[读码] 读代码推出。

---

# 第 11 轮 — 所有入口都预加载系统证书 + 修第 10 轮 P3/P4（2171bee / 736f97b / 7de0026）

## 验收范围

复验 builder 在第 10 轮之后的 3 个提交：
- 2171bee：57 个入口接入 safe_exit，另加守卫测试；
- 736f97b：修第 3 行文案和第 2 行链接；
- 7de0026：施工记录。

验 5 项：
1. 守卫测试对「入口」的判定是不是全；
2. 抽 5 个入口，在 CA=1 下各循环 200 次；
3. P3/P4；
4. 逐提交 CI；
5. 57 个文件是不是只加了一行 import。

纪律：没有真投。真实家目录收工时比对 sha，0 差异。没有 push，没有提交代码。

## 5 维高危区评估

- ① 核心业务逻辑（中）：736f97b 只改报告文案，派单、投前闸、记账都没动。要确认它提前 return 时不会吞掉第 1、2 行。
- ② 安全边界（低）：import safe_exit 只改本进程的 NODE_OPTIONS，并提前读证书。
- ③ 性能（低）：每个入口启动时多读一次钥匙串证书，而且只在 CA=1 时读。
- ④ 集成点（中）：给库文件（local_db / cdp / 各 board_api）加副作用 import，会影响所有 import 它们的进程，要确认没有改变行为。
- ⑤ 用户体验主流程（高）：退出时崩溃会被当成「记账失败 / 可能已提交」，还会停批，所以要实测崩溃率。

## 7 类测试

- 等价类（2 组）：
  - 按退出码分 0 / 1 / 2 三类，每类都挑了入口；
  - 按文件类型分 shebang / main 守卫 / 库文件三类。
- 边界值（1 个）：NODE_OPTIONS 清空，模拟用户在自己的 shell 里直接 `node <file>`。
- 决策表（1 张）：第 3 行的分支。
  - 没扫描且额度满；
  - 没扫描且是别的原因；
  - 扫描过（走原有分支）。
- 状态迁移：不适用，这批没有新状态。
- 用例测试（1 条）：在真实拷贝上重走一遍「扫名单 → held → 额度满时 release → 正常 release 加一条编造链接 → 重复 release」。
- pairwise（1 组）：入口 × 新旧代码，做崩溃对照。
- 风险驱动（3 个变异）：
  - 把 stream_run 回退到 a089260；
  - 删掉 tracker_cli 的 import；
  - 全仓统计还有哪些文件没接入。

## 5 轮回归循环记录（第 11 轮）

**1. 崩溃对照** [实测]
条件：5 个入口 × 200 次，8 路并发，CA=1，NODE_OPTIONS 清空。

| 入口 | 新代码 7de0026 | 旧代码 a089260 |
|---|---|---|
| submission_evidence --tab x | exit 2 ×200 | 195 次正常 + **SIGSEGV 5** |
| tracker_cli | exit 1 ×200 | 196 次正常 + **SIGSEGV 4** |
| state_file_lock | exit 0 ×200 | 0 ×200 |
| upskill_report | 0/1 混合，**0 SIGSEGV** | 同左，0 SIGSEGV |
| queue_diagnostics | 0/1 混合，**0 SIGSEGV** | 同左，0 SIGSEGV |

- 合计：新代码 0/1000 崩溃，旧代码 9/1000。
- 表里的 exit 1 不是这批的问题：8 个进程同时初始化同一个临时家目录的 jobs.db，报 `database is locked`。串行跑 40 次是 0 失败，新旧代码表现一样，是我这边的测试造出来的并发。

**2. 红测试** [实测]
- 把 stream_run 换回 a089260 版本，e2e 加新测试共有 7 条变红。其中包括「开跑后没找岗就 finish：第 3 行说本次未扫描」「--release 遇今日额度已满」。
- 删掉 tracker_cli 的 import 后，守卫测试变红，并点名这个文件。

**3. 逐提交 CI** [实测]
- 2171bee：503/503；
- 736f97b：504/504；
- 7de0026：504/504；
- 另外三步都是 0，没有被取消的测试。

**4. 真实拷贝重走**（HEAD 7de0026）[实测]
- 额度满：第 3 行是「今日额度已满，本次未扫描」，第 2 行是「放行的 1 个没投： <链接> （daily_cap_reached）」。
- 编造链接：「没找到（可能已下架）： <链接> 」，链接两边是半角空格。
- 重复 release：报 already_attempted_fp，驱动 0 次。
- held 行和第 10 轮一样。

**5.** 无回炉。

## 结论明细（第 11 轮）

### ✅ 通过

**① 入口判定是全的**：在我能找到的调用方式里，没有漏网的。[实测 + 读码]
- 判定规则：有 shebang，或者含 `process.argv[1]` / `import.meta.main`，就算入口。实际扫出 70 个入口，没接入的是 0 个。
- 反查一：从 skills、scripts、.sh、package.json、.github、docs/specs 里收集到 97 个被引用的 .mjs 路径。其中没接入的 25 个都是纯库文件（不读 argv，没有顶层 main），没有一个被 `node <file>` 直接执行。
- 反查二：在没接入的文件里找顶层的 `main()` 或 `process.exit`，只找到 paths.mjs 的 refuse()。它只会在已经引过 safe_exit 的入口进程里被调用。
- 57 个文件里 safe_exit 都是**第一条 import**，逐个核过。
- 说明书里的 `node -e "import(…/local_db.mjs)"`（confirm / cherry-pick 两个技能）：本批已经给 local_db 加了 import，会被间接覆盖。
- **_unwired 目录**：6 个文件没有任何地方引用，是死代码。它们带 main 守卫，所以被守卫算作入口。加这一行没坏处，以后重新接线也能自然覆盖，没必要排除，也不是必须加。

**③ P3/P4 已修**：红测试和真实拷贝两边都确认了。

**⑤ diff 核对** [实测]
- shared + scripts 下 57 个文件，每个都是 +1/-0。新增的 57 行**全部**是 `import '…/safe_exit.mjs'; // first: …`，没有别的行。
- bin 是就地写的 7 行读证书，因为发布包里不带 shared/。
- test 下 3 个驱动夹具把正则扩成能改写副作用 import；preflight 夹具复制了 safe_exit。这些都是测试适配。
- 行为影响：库文件被 import 时，如果 CA=1，会往本进程的 NODE_OPTIONS 里追加预加载。这个机制 f4a5fce 已经在用，本批只是扩大覆盖面，没有新的行为类型。

### ❌ 真 bug

无。

### ⚠️ 风险 / P4

- bin 里的就地判断只看 `NODE_USE_SYSTEM_CA`，不像 systemCaOn() 那样也认 `--use-system-ca` 这个启动参数。bin 用 shebang 启动，平时不会带这个参数，影响可以忽略。
- 第 3 行「本次未扫描（<stop_reason>）」在不是额度满的情况下会露出英文原因码。这和第 10 轮 P4 说的原因码难读是同一类问题，不单独升级。

## Quinn 重构 / 质量指标 / 老坑（第 11 轮）

- Quinn 重构：无。
- 覆盖率：本项目没有覆盖率工具。守卫测试加 3 个变异都能打红。崩溃对照：新代码 0/1000，旧代码 9/1000。
- `verify_self_miss_rate: 0%`（0/0）。
- 真 bug：0。P4 观察 2 条。
- 老坑清单：项目没定义。
- main_chain：拷贝上重走通过。
- schema_upgrade_path / isolation_field：没填，这两条铁律不启用。

## 覆盖度评估（第 11 轮）

**质量分 5/5 —— 可推。**
- 5 项全部实测：
  - 入口判定正向、反向都查过，没有漏网；
  - 5 个入口 × 200 次，新代码 0 崩溃，旧代码 9/1000，说明对照组确实能跑出崩溃；
  - P3/P4 有红测试，也在真实拷贝上确认；
  - 逐提交 CI 全绿，没有被取消的测试；
  - 57 个文件逐行核过，每个只加了一行 import。
- 真实家目录零写入。
- 没覆盖到的：Linux（那边没有这个竞态）；真实驱动（禁止真投）。

## 试过的错误方向（第 11 轮）

- **挑循环入口时，直接串行试跑了 scripts/dashboard.mjs**：它是常驻进程，不会自己退出，探测循环被卡住直到超时。后来每个候选入口先加 `timeout 10` 探一次，只挑几秒内能退出的。
- **看到 upskill_report 并发时出现 exit 1，一开始以为是新代码引入的**：和旧代码对照，旧代码也一样；stderr 是 `database is locked`，串行跑 40 次是 0。原因是我的 8 路并发共用了同一个临时家目录，不是这批的问题。

---

# 第 12 轮 — 账本更正命令 correct（10ec8b7 / 029d522 / f828014）

## 验收范围

验收 builder 的 3 个提交（都没推）：
- 10ec8b7：新增 `submission_ledger.mjs correct --of <行id> --verdict <v> --evidence "<文字>"`，默认试跑，加 `--apply` 才写；
- 029d522：说明书和 CHANGELOG；
- f828014：施工记录。

这个命令的用途：拍板人要重投 Creatify PM Intern。它在账本里是行 `led_1790453329601_169_3799e7`，5 月 26 日，legacy_unverified。Gmail 里没有这个岗的确认邮件，而同一天同平台投的 OpusClip 有。

验 6 项：
1. 更正前这个岗被拦；更正后放行，而且不算进 Creatify 的 60 天次数；
2. 只能更正存在的行、必须带证据、原行不删；
3. 对真投过的岗（OpusClip b3ac1b13）乱写更正会怎样；
4. 锁；
5. 600 权限；
6. 逐提交 CI。

纪律：
- 真实家目录今天已经更新了 profile 和 search_intent（只扫名单，21 家），这次只在它的拷贝上操作（排除 chrome-profile）。
- 收工时 sha 比对，0 差异。
- 没有真投，没有 push，没有提交代码。

## 5 维高危区评估

- ① 核心业务逻辑（高）：更正是唯一能把「投过」改成「没投过」的口子。改错就等于放行重复投递，而「零重复投递」是这个产品的第一红线。所以正向放行、反向误用、能不能撤回都要实测。
- ② 安全边界（中）：账本必须保持 600；更正行会把目标行的 answers 一起复制过去，不能打到终端上。
- ③ 性能（低）：每次更正读一遍全账本，规模几百行，可以忽略。
- ④ 集成点（中）：几道闸（去重、投前权威闸、60 天同公司、日档位）和看板、「以前投过我们吗」这道表单题都读有效行，要确认它们口径一致。
- ⑤ 用户体验主流程（中）：更正完之后，要能走通「扫描 → held → release → 投 → 记账」。

## 7 类测试

- 等价类（3 组）：
  - verdict 取 not_submitted / unknown / submitted / 非法值；
  - 目标行分原始行和更正行；
  - evidence 分有内容、空白、缺失。
- 边界值（3 个）：
  - `--of` 不给值；
  - `--evidence` 后面紧跟 `--apply`；
  - 账本文件权限被人改松成 644。
- 决策表（1 张）：拒绝条件，包括没证据 / 行不存在 / 更正一条更正行 / 判定非法 / 有锁在，以及它们和 --apply 的组合。
- 状态迁移（1 条）：迁入行（已投）→ 更正成没投 → 放行 → 投出（新 v2 行）→ 再次被拦；另一条是乱更正 → 再更正回 submitted，能恢复拦截。
- 用例测试（1 条端到端）：在真实拷贝上，更正 Creatify → 扫 21 家 → held → release → 投递替身 → 账本 +1 → 重复 release 被拦。
- pairwise（1 组）：更正与否 × 闸的种类（identityBlock / checkDispatch / byCompany 计数 / priorApplicationToCompany）。
- 风险驱动（2 个变异 + 1 个并发）：
  - 让 attemptIndex 不读更正行；
  - 让 patch 里不改 may_have_submitted；
  - 20 个更正并发写。

## 5 轮回归循环记录（第 12 轮）

**1. 真实拷贝上跑正向流程** [实测]

更正前（拷贝里 215 行）：

| 岗位 | identityBlock | checkDispatch | 60 天次数 | 以前投过吗 |
|---|---|---|---|---|
| Creatify PM Intern | already_attempted_fp | already_attempted_fp | 1 | true |
| OpusClip b3ac1b13 | already_attempted_fp | already_attempted_fp | 1 | true |

- 试跑：输出 before（legacy_unverified / may_have_submitted=true），以及将要追加的行（correction_of 指向原行、verdict not_submitted、may_have_submitted=false、公司 / 岗位 / 链接齐全、不带 answers）。账本 cmp 一致，一个字节没动。
- `--apply` 后：
  - 账本 216 行，前 215 行和原来 cmp 一致，原行没删，权限 600；
  - Creatify：identity 和 dispatch 都是 OK，60 天次数 **0**，「以前投过吗」变成 false；
  - OpusClip 不受影响，照样被拦。
- 端到端：
  - 用新的 search_intent（intern + new_grad_FT，只扫名单）扫 21 家；
  - 硬筛后**只剩 3 个岗**（opusclip 501d374d / creatify 4da91083 / pika e135acb1），3 个都 held；
  - `--release <Creatify>`：驱动只调 1 次，第 1 行是「投出 1 个：creatify·Product Manager Intern」，账本多一条 v2 submitted 行；
  - 投完 Creatify 又被 already_attempted_fp 拦住，60 天次数回到 1；
  - 再 release 一次：报「放行的 1 个没投： <链接> （already_attempted_fp）」，驱动 0 次。

**2. 反向误用和边界**（另一份干净拷贝）[实测]
- **乱更正 OpusClip**：`--evidence "x" --apply`，退出码 0，OpusClip 马上被放行（identity OK、60 天次数 0、「以前投过吗」false）。
- **能撤回**：再更正一次成 submitted，又被拦住（后写的更正生效）。
- `--evidence --apply`：退出码 0，**把证据写成了字符串 "--apply"**，并且真的写进了账本。
- evidence 全是空格：拒绝。
- `--of` 不给值：拒绝，但报的是「no ledger entry with id --verdict」，意思能看懂。
- 残留一个 apply_batch.lock：拒绝写入，报错里写了锁的路径。
- 账本被改成 644 后再更正：写完权限回到 600，目录是 700。
- 20 个更正并发写：239 行全部是合法 JSON。

**3. 变异** [实测]
- attemptIndex 改成不读更正行：「投前闸按有效判定读」那条测试变红（fail 1）。
- patch 里不改 may_have_submitted：3 条测试变红。

**4. 逐提交 CI** [实测]：10ec8b7 / 029d522 / f828014 都是 508/508，另外三步都是 0，没有被取消的测试。

**5.** 无回炉。

## 结论明细（第 12 轮）

### ✅ 通过

- 更正前拦、更正后放行、不算进 60 天次数：真实拷贝上正向、反向都过了。
- 口径一致：几道闸、看板（isSubmitted 按 verdict 数）、「以前投过吗」都读有效行。更正行的 outcome 还留着 legacy_submitted，但没有哪个消费方按 outcome 来数「已投」，读码确认过。
- 只能更正存在的行、必须带证据、不能更正一条更正行、原行不删、写错了能再更正回来、有锁拒写、600 权限、并发写：全部实测通过。

### ❌ 真 bug

无。

### ⚠️ 风险（请 lead 定）

- **P3｜① 核心业务逻辑｜乱更正会放行真投过的岗，造成重复投递**
  - 复现：`correct --of led_1790453329609_554_9568f0 --verdict not_submitted --evidence "x" --apply` → OpusClip b3ac1b13 被放行。
  - 为什么代码分不出来：迁入时 Creatify 和 OpusClip 都是 legacy_unverified，账本里没有能区分「真投过」和「没投成」的字段。
  - 现有的防护是人工：默认只试跑，试跑会显示公司 / 岗位 / 链接；更正写错了能撤回。
  - 建议：加一个必填的 `--url <链接>`，和目标行的 apply_url 对不上就拒绝，用来防「复制错行 id」。改动约 3 行，写法和 record-manual 的 `--company` 核对一样。
  - 这次 Creatify 的更正，只要 lead 先看一眼试跑结果，确认链接是 4da91083，就可以执行，不用等这个改动。
- **P4｜证据参数把 --apply 吞进去了**：`--evidence --apply` 会把 "--apply" 当成证据写进账本。建议证据以 `--` 开头时拒绝。
- ⚠️ **观察（和本批无关，供拍板）**：用新的 search_intent 扫 21 家，只有 3 个岗能过硬筛。原因和第 10 轮第 5 项的发现一样：系统只认实习 / 应届，GTM 全职岗进不来。
- ⚠️ **观察**：真实家目录的档案里「现在是否需要 sponsorship」仍是 6 月的旧值 false（TASK Round 24 已经列为待拍板人核对）。真投前需要确认，因为投递表单会按这个值填。

## Quinn 重构 / 质量指标 / 老坑（第 12 轮）

- Quinn 重构：无。`--url` 核对属于业务防护，交给 builder。
- 覆盖率：本项目没有覆盖率工具。2 个变异都能打红；决策表的拒绝分支全部实测。
- `verify_self_miss_rate: 0%`（0/2）。
- 真 bug：0。P3 1 条、P4 1 条，另有观察 2 条。
- 老坑清单：项目没定义。
- main_chain：真实拷贝上走通「更正 → 扫描 → held → release → 投（替身）→ 记账 → 报告」。
- schema_upgrade_path / isolation_field：没填，这两条铁律不启用。

## 覆盖度评估（第 12 轮）

**质量分 4/5 —— 可推。**
- 正向（Creatify 被拦 → 更正 → 放行 → 投出 → 再次被拦）在真实数据拷贝上完整走通。
- 拒绝、锁、600 权限、并发、撤回都实测过。
- 2 个变异都能打红；逐提交 CI 全绿。
- 真实家目录零写入。
- 扣 1 分：乱更正会放行真投过的岗，只靠人工试跑把关（P3）。
- 没覆盖到的：真实驱动（禁止真投）。

## 试过的错误方向（第 12 轮）

- **一开始想在同一份拷贝上接着测 OpusClip 乱更正**：那份拷贝已经做过 Creatify 的更正和投递，两个场景的账本状态会互相影响，判断不出结果是谁造成的。后来从干净快照另拷一份（h12o）单独测反向场景。
- **一开始以为 `--of` 不给值时会误写**：实测是把 `--verdict` 当成了行 id，查不到这一行就拒绝了，没写任何东西。所以只记为报错措辞的问题，不列为 bug。

---

# 第 13 轮 — correct P3/P4 修复 + 应届全职口径 + 地点筛（b75cb6e 8151f81 2e7b9f2 / c805b93 1e43bfc e18a39b 46cde61 b89cec2）

## 验收范围

- **A. correct 子命令 P3/P4**：b75cb6e（必填 `--url` 且和目标行是同一个岗、证据至少 10 个字、参数值以 `--` 开头就拒）、8151f81 与 2e7b9f2（文档）。第 12 轮已验的 10ec8b7 / 029d522 / f828014 一并纳入逐提交 CI。
- **B. 应届全职口径 + 地点筛**：c805b93（new_grad_FT 改为「标题不资深，且 JD 没写要求 ≥3 年」）、1e43bfc（地点只放美国和美国远程）、e18a39b（FullTime 但标题写 Freelance/Contract 的不算全职）、46cde61 与 b89cec2（文档）。依据是拍板人原话「行，3年以上的跳过」。
- 环境：真实家目录 rsync 拷贝到 scratchpad/r13/home（不含 chrome-profile 和 run-tmp）。21 家招聘看板只做公开接口的只读 GET。没有真投，没有 push。真实家目录收尾前后的 sha 对比一致。

## 5 维高危区评估

- **① 核心业务逻辑（最高）**：B 决定哪些岗进打分、哪些能自动投。这里一旦漏网，就会替拍板人投「要 5 年经验」的岗，直接违背拍板。所以测试密度最高：21 家真实数据逐条分桶，并把「打分 → 入库 → 重算资格 → 投前校验」整条链路跑通。
- **② 安全边界**：A 是防止重复投递的最后一道人工闸，按最坏意图设计了 11 种乱用方式。
- **③ 性能**：85 个岗全部进打分的花费，只做估算（打分由主 agent 完成，没有实测数据）。
- **④ 集成点**：Ashby 的 secondaryLocations 和结构化国家字段、Greenhouse 的 offices，都在真实接口数据上验证。
- **⑤ 主流程**：main_chain 的「各平台找岗 → 大批量一键投递」这一段，用真实拷贝上的发现 + 打分入库 + 投前校验来代跑。真驱动禁止真投，没有跑。

## 7 类测试

| 技术 | 次数 | 用在哪 |
|---|---|---|
| 等价类 | 6 | 地点五类（美国 / 中国 / 外国 / 远程 / 未知）；岗位类型的实习、全职、合同、兼职 |
| 边界值 | 9 | 证据 9 个字 / 10 个空格 / 10 个字；年限 1-3、2-5、3-5、3-5+、2 or 3；MAX_ENTRY_YEARS 变异 |
| 决策表 | 2 | correct 的 id × url × 证据 × 参数取值共 12 格；地点「任一美国 / 任一外国 / 远程 / 未知 / 空」 |
| 状态迁移 | 1 | 入库时 eligible=0 → recompute 后 eligible=1 → validate 返回 ok（这里发现 P1） |
| 用例测试 | 2 | Creatify 正确更正整条走通；21 家真实发现 601 → 85 |
| pairwise | 1 | 地点 × 远程开关 × 结构化国家两两组合（例：Remote + London + 国家 US / UK） |
| 风险驱动 | 3 | 85 个岗逐条人工分桶；65 个「≥3 年」淘汰逐条读 JD 原文；6 个变异 |

## 5 轮回归循环记录（第 13 轮）

**1. A：最坏意图 11 条全部拒绝，账本 sha 不变** [实测]

- OpusClip 行 id（led_…9568f0，真投过）分别配上：Creatify 的 url、不给 url、空 url、example.com、OpusClip 的另一个 uuid、证据 "x"、证据是 9 个字加空格、证据是 10 个空格、`--evidence --apply`、`--url --verdict`、`--of --url`。全部 exit 1，账本没有变。
- Creatify 行 id 配 OpusClip 的 url：同样拒绝。
- **正向**：Creatify 用不带 `/application` 的 url 做试跑，没有写账；加 `--apply` 后多出一行 cor_…，文件权限 600。

**2. B：独立复跑 21 家** [实测]

- 601 → 85（实习 3 + 应届全职 82），和 builder 的结果完全一致。
- 按顺序记第一个命中的筛子：排除词 193、地点 154、资深标题 93、≥3 年 65、类型不符 11。
- 每道筛子单独跑全部 601 个：排除词 193、地点 233、资深 173、≥3 年 179、类型不符 15。

**3. 85 个进打分的岗逐条分桶** [实测 + 人工判读]

| 桶 | 数 | 样例 |
|---|---|---|
| 应届能投 | 42（其中方向对口约 17 个） | 对口：tavus Vibe Growth Marketer / BDR / PM；elevenlabs Content Creator & Strategist / Influencer Marketer / Social Growth Strategist / Affiliate Marketing Manager / Marketing Ops；suno Social Media Community Manager（要求 2 年以上）；heygen Online Community Manager；runway Youtube Creator。不对口：客服、IT 支持、应付账款、行政助理、设计 |
| 实习 | 3 | creatify PM Intern、opusclip AI PM Intern、pika Research Intern |
| 明显资深漏网 | **12** | 年限没认出来的 8 个：lumaai PM Growth（5–10+）、runway Creative Support（3-5+）、synthesia Revenue Enablement（3–5+）、elevenlabs PE Partnerships（8–12+）/ Compensation（5+, ideally…）、higgsfield Associate General Counsel（10+, ideally…）、pika Growth Engineer（4+, ideally…）、krea Product Engineer（4+, ideally…）。带人的经理 4 个：synthesia Solutions Engineering Manager ×2、mirage Product Design Manager、suno Engineering Manager |
| 工程 / 研究漏网 | 27 | elevenlabs Full-Stack Engineer ×4 + krea Fullstack（排除词写的是 "full stack"，对不上带连字符或连写的，这是旧问题）、Forward Deployed / IT / Design / Robotics Engineer、krea ML Researcher ×2、tavus AI Researcher |
| 非美国漏网 | 1 | runway「Consumer Support Specialist - London」：地点是 Remote + London，但结构化国家里有 US，所以放行了 |

**4. 「≥3 年」淘汰的 65 个逐条读 JD 原文**：没有发现误杀。

- 「1-3 years」判 1、「2–5 years」判 2，都放行了（runway Consumer Support、pika PM）。
- 真实数据里没有「3+ 写在 nice-to-have 段落」被拦的情况。
- 但是构造用例能打出潜在误杀：`Nice to have:\n- 3+ years` 和 `Preferred Qualifications\n- 3+ years` 都判成 3（换行后看不到小标题）；`2 or 3 years` 判 3。
- 边缘 1 个：tavus Marketer 原文是「typically 4+ years」，而且写了欢迎各种资历，被拦了。

**5. 资深标题 93 个 + 类型不符 11 个**：基本合理。

- 小误杀：「Member of Technical Staff」×3（都是工程岗，本来也不对口）；「Executive Assistant / Senior Executive Assistant」；higgsfield「Contract Manager」（管合同的岗，被当成合同工）。
- 潜在误杀：「Lead Generation Specialist」会被判成资深。

**6. P1 链路实测**（临时 HOME）[实测]

- 构造：lumaai PM Growth（JD 写 5–10+ 年）；打分器给 fit 8、recommended、role_type_match=**other**。
- 入库：store_scored_jobs 得到 eligible 0。但是 :169 用重判结果 new_grad_FT 覆盖了打分器的 other，写进库里。
- 重算：`recompute_auto_apply_eligibility --apply` 把它从 0 翻成 1（eligible）。
- 投前：`validate_auto_row` 返回 ok:true，auto_apply_queue 里也出现了这一条。
- 结论：打分器按新提示词判出「要求 ≥3 年 → other」，这个否决在链路里丢掉了。改动前，全职岗重判的结果是 other，不会发生覆盖。所以这条链路是 c805b93 放宽口径后才打开的。

**7. 复现测试**：scratchpad/r13/years_repro.test.mjs 共 3 条，当前全部红（0/3）：3-5+、5–10+、「, ideally」，以及 PM Growth 能通过 new_grad_FT 闸。

**8. 变异**：6 个变异全部被打红。
- MAX_ENTRY_YEARS 改成 3、删掉 lead、删掉 preferred 判断、只看主地点（2 红）、未知地点放行（2 红）、删掉 Freelance 标题判断。

**9. 逐提交 CI**：8 个提交的 smoke、gate、syntax 全部是 0。npm test 的结果：
- b75cb6e 509/510：stream_run_e2e V2 的顺序断言失败，单独重跑 5/5 绿。
- e18a39b 525/526：concierge_isolation 失败，单独重跑 5/5 绿。lead 已在 f215d49 定性为 SIGSEGV 并修复。
- 其余 6 个提交全绿：510 / 510 / 517 / 526 / 526 / 526。
- 两次失败都是我同时跑变异、机器高负载下出现的偶发失败，涉及的文件本批都没改过，不算本批引入。

**10. 回炉**：P1 和 P2 转 builder。

## 结论明细（第 13 轮）

### ✅ 通过

- **A 全部通过**：P3（错 url 拒）和 P4（吞参拒）都修好了。证据长度、正确更正放行都实测通过。
- **B 地点筛**：外国地点全部拦住。附加地点让 16 个主地点在外国、但也招美国的岗正确放进来。未知地点 0 个。
- **B 其他**：「≥3 年」淘汰真实数据零误杀，Freelance 判断正确，只要实习的用户仍然拿不到全职岗。
- **旧断言改动合理**：6 处都是「普通全职：other → new_grad_FT」的直接推论，同时补了「只要实习 / 兼职时不放行」的断言，防止全职岗漏给实习用户的老护栏没动。

### ❌ 真 bug

- **P1｜① 核心业务逻辑｜要求 ≥3 年的岗可以一路走到自动投**
  - 原因一：requiredYears 认不出两种写法。一是「N–M+ years」（区间上限后面带 +），二是「N+ years … , ideally …」（40 个字以内出现 ideally 或 bonus，就整条当成 preferred）。真实 85 个里漏了 8 个。
  - 原因二：store_scored_jobs.mjs:169 用重判的 new_grad_FT 覆盖打分器给的 other，recompute 再把资格翻成 eligible。打分器这道兜底也就失效了。
  - 复现：见上面第 6、7 条。
  - 修法方向：年限正则允许「N–M+」，并且 preferred 只认紧挨着年限的标注；:169 不能覆盖打分器给出的「不在目标内」。builder 做，改动量超过 Quinn 的上限。

### ⚠️ 风险（请 lead 定）

- **P2｜① 带人的经理岗漏网 4 个**：Engineering / Solutions Engineering / Design Manager。建议把「(Engineering|Design|Research|Solutions Engineering) Manager」算作资深。这 4 个方向也不对口，打分大概率会拦。
- **P3｜排除词对不上 Full-Stack / Fullstack**：漏进 5 个。旧问题，不是本批引入。
- **P3｜「Nice to have / Preferred」小标题换行后的年限会被当成要求**：潜在误杀，真实数据 0 例。
- **P4**：「2 or 3 years」判成 3；「Remote (EU, overlap with US hours)」和「Tbilisi, Georgia」被判成美国；「Vancouver, WA」「London, ON」被判成外国；「Lead Generation」「Contract Manager」被误判；runway 的 London 岗漏网 1 个。
- **待拍板（沿用 builder 提的问题）**：硬筛要不要加方向预筛。85 个里约 52 个方向不对口（27 个工程研究 + 25 个应届但不对口），这些打分额度会白花。

### 85 和 16 为什么差这么多

- BUG_REPORT 的 16 是用自己的粗规则 [推断] 出来的，而且只留了增长 / 市场 / 产品方向。硬筛本来就不看方向，方向要到打分阶段才起作用。所以差的主要是 52 个方向不对口的岗。
- 另外 12 个是资深漏网。
- BUG_REPORT 估算时只看主地点。现在附加地点也纳入判断，多放进来 16 个。
- 我按 85 分桶，方向对口的应届岗约 17 个，加上 2 个对口实习，和 16 基本吻合。

### 花费 / 耗时估算 [推断，没有实测]

- 85 个岗的 JSON 共约 50.6 万字符（JD 占 43 万），约合 13-17 万输入 token。
- 过了去重闸大约剩 82 个，分 2 批（50 + 32）。每批加上约 3K token 的提示词；输出按每岗约 250 token 算，共约 2 万 token。
- 用订阅额度的话，算在主会话的额度里。
- 耗时我没有实测数据。建议首跑时记录每批的 token 和分钟数（第 5 次召唤时 builder 已经提过这个建议）。

## Quinn 重构 / 质量指标 / 老坑（第 13 轮）

- Quinn 重构：无。P1 涉及业务逻辑和跨文件改动，超出范围。
- 覆盖率：本项目没有覆盖率工具。6 个变异全部打红；3 条复现测试全部红。
- `verify_self_miss_rate: 0%`（0/7）。第 12 轮判可推的 correct，这次复验没有发现漏检。本轮问题共 7 个：P1 1 个、P2 1 个、P3 2 个、P4 2 组，另有待拍板 1 个。
- 真 bug：1（P1）。
- 老坑清单：项目没定义。
- main_chain：发现 → 打分入库 → 重算 → 投前校验，在真实拷贝和临时 HOME 上跑过；真驱动因禁止真投没有跑。
- schema_upgrade_path / isolation_field：没填，这两条铁律不启用。

## 覆盖度评估（第 13 轮）

**A：质量分 5/5，可推。** 11 种最坏意图全部拒绝，正向走通，逐提交 CI 全绿（偶发失败已单独重跑定性）。

**B：质量分 3/5，回炉。**
- 数字复现一致，地点筛质量好。「≥3 年」淘汰零误杀，旧断言改动合理。
- 但是有 8 个要求 ≥3 年的岗能进打分。加上 :169 覆盖了打分器的否决，这些岗可以一路走到自动投，违背拍板人「3年以上的跳过」。
- 修复量小（两个正则 + 一行判断），修完后请重跑 21 家，并补 years_repro 3 条测试。
- A 和 B 在同一条线上，如果要先推 A，需要只推到 2e7b9f2 为止。

没覆盖到的：真驱动（禁止真投）；打分花费没有实测。

## 试过的错误方向（第 13 轮）

- **一开始以为漏网的年限岗有打分器兜底**：新提示词已经写了「要求 ≥3 年 → other」，store 的 roleOk 也会把它拦成 eligible 0。后来接着跑 recompute，发现资格被翻回 1，才确认兜底失效，把这条从 P2 升为 P1。
- **一开始把逐提交 CI 的 2 次红当成本批的回归**：失败的测试文件本批都没改过，而且单独重跑 5/5 全绿。时间上正好和我并行跑变异的高负载重合，所以定为偶发。其中 concierge 那条 lead 已经在 f215d49 修了。

---

# 第 14 轮 — B 回炉复验（f215d49 5b3479c d62b28d 541583b 73e71bd fbcb88c d30f91b bdd6feb）

## 验收范围

- builder 针对第 13 轮问题的修复：
  - f215d49：paths.mjs 退出时偶发崩溃（SIGSEGV）。
  - d62b28d：P1「≥3 年」否决链路，包括年限写法、store 不再覆盖、derive 不翻回。
  - 541583b：标题里写外国城市就拦；US hours / Tbilisi / Vancouver, WA 的判定。
  - 73e71bd：排除词不分连字符；在硬筛按用户排除的职能拦工程和 ML 研究岗。
  - fbcb88c：上一条要点末尾的 preferred 不算到这一条。
  - 5b3479c / d30f91b / bdd6feb：文档。
- 环境：新拷一份真实家目录到 scratchpad/r14/home。21 家公开接口只读。没有真投，没有 push。真实家目录前后 sha 一致。

## 5 维高危区评估

- **① 核心业务逻辑（最高）**：重点是「重判把不合格翻回可投」。从打分器可能给出的标签入手，用最坏意图打 store → recompute → validate → queue 整条链，共 10 种标签。release 放行后会重新扫描、重新打分，走同一条链，不单列。
- **① 误杀面**：新增的职能排除词、标题里的地点、标题小标题识别，都可能误拦应届能投的岗。在真实 601 个岗上做新旧逐条对比。
- **②③**：本轮不涉及。
- **④ 集成点**：Ashby 文本型 JD 的小标题和换行结构。
- **⑤ 主流程**：发现 → 入库 → 重算 → 投前校验，用临时 HOME 代跑。

## 7 类测试

| 技术 | 次数 | 用在哪 |
|---|---|---|
| 等价类 | 4 | 打分器标签：合法值 / 大小写变体 / 别名 full_time / 非法值（senior、空、缺失） |
| 边界值 | 8 | 1-3、1–3+、2 or 3、1 or 2、three to five、at least two；上一行以数字结尾的要点 |
| 决策表 | 1 | 打分器标签 × JD 是否写年限，共 10 格链路结果 |
| 状态迁移 | 10 | 每格都走 store → recompute → validate → queue |
| 用例测试 | 1 | 21 家复跑 601 → 45 |
| pairwise | 1 | 标题里的地点 × 地点字段（Japan Market @ SF、Paris @ NY、Lima @ Ohio 等 12 组） |
| 风险驱动 | 3 | 新旧年限结果不同的 38 个岗逐条读 JD；新旧地点结果不同的逐条看；职能排除词命中的逐条看 |

## 5 轮回归循环记录（第 14 轮）

**1. years_repro**：第 13 轮写的 3 条复现测试，现在 3/3 绿。[实测]

**2. 21 家独立复跑** [实测]

- 601 → **45**（应届 42 + 实习 3），和 builder 的结果一致。
- 按顺序记第一个命中的筛子：排除词 270、地点 140、资深 77、≥3 年 60、类型不符 9。
- 每道筛子单独跑全部 601 个：排除词 270、地点 234、资深 182、≥3 年 188、类型不符 14。

**3. 和第 13 轮的分桶对照**

- 这次拦掉的 40 个，恰好就是第 13 轮我分出来的「资深 12 + 工程研究 27 + 非美国 1」。
- 留下的 42 个应届岗，恰好就是第 13 轮的「应届能投 42」，一个没多一个没少。
- builder 说的「42 个零误杀」按我的分桶成立。

**4. 新旧年限结果不同的 38 个岗，逐条读了 JD**

- 36 个是新规则正确认出来的：3-5+、5–10+、「, ideally」这几种写法，以及 heygen 用平文本写的「Preferred Qualifications 3+」。
- 1-3 years 判 1，2 or 3 判 2，1–3+ 判 1，都没有被误当成 ≥3 年。
- 变成认不出的有 2 个：
  - mirage Technical Recruiter：JD 唯一的资历段落标题就叫「Preferred Qualifications:」。按规则这段算加分项，判对了。
  - **suno Machine Learning Scientist：真漏检**。小标题行被去掉以后，上一行结尾的 URL「…FJOi1」和下一行的「- 5+ years」拼在了一起。年限前面的 lookbehind 能跨过换行，所以把「1 - 5+」当成了一个区间的后半截，这条年限就被跳过了。
  - 构造用例 `- Experience with GA4\n- 3+ years in growth` 同样认不出，结果是 null。这个问题旧代码就有，去掉小标题后更容易触发。
  - 把 lookbehind 改成不跨换行（只允许空格和 tab）以后，全部 601 个岗里只有这 1 个结果变化，而且这个岗是工程方向，本来就被拦。

**5. 标题里的地点、职能排除词有没有误杀**

- **标题地点**：在真实数据里只改变了 1 个岗（runway London），没有误杀。但构造用例能打出潜在误杀：
  - 「Social Media - Japan Market」和「Creator Partnerships - India」，地点字段都是 SF，却被拦了。标题写的是面向哪个市场，不是在哪里上班。
  - 「Sales - New Mexico」和「Field Marketing - Lima」（地点 Lima, Ohio）也会被判成外国。
- **职能排除词**：在 601 个里新命中了 69 个，全部是工程、研究类标题。离增长和 GTM 最近的几个是：GTM Engineer（要求 6 年）、Website Growth Engineer、Martech Engineer、Automation Engineer - Influencers、Prompt Engineer。另外「UX Researcher」会被「researcher」拦下，但 UX 研究不是 ML 研究。

**6. 最坏意图：重判把不合格翻回可投**（Luma PM Growth，fit 8，recommended）[实测]

| 打分器给的 role_type_match | 入库后 | 重算后 | validate | 进投递队列 |
|---|---|---|---|---|
| other / Other | other/0 | 0 | 拒 | 否 |
| new_grad_FT（JD 写 5–10+ 年） | other/0 | 0 | 拒 | 否 |
| intern | other/0 | 0 | 拒 | 否 |
| 空字符串 / 不给 | store 直接拒这一批 | — | — | — |
| **senior** | senior/0 | **1** | **ok** | **是** |
| **full_time** | full_time/0 | **1** | **ok** | **是** |
| new_grad_FT（JD 里的年限删掉） | new_grad_FT/1 | 1 | ok | 是（符合预期） |

- 为什么 senior 和 full_time 会漏：
  - store_scored_jobs 比对打分器标签时用的是原始字符串。「senior」和「full_time」都不在目标列表里，就原样写进库，JD 重判得出的 other 被丢掉了。
  - 到了 derive 这一步，标签会先规范化：「senior」规范不出来，就改用标题重判，得到 new_grad_FT；「full_time」本来就是 new_grad_FT 的别名。于是资格被翻回可投。
  - 入库时的校验（:67）只检查标签是非空字符串，不检查是不是 4 个合法值之一。
- 打分提示词规定只能给 4 个值，所以这条路要打分器输出不守规矩才会触发。但 full_time 是系统自己承认的别名，大模型给出这个值并不离谱。

**7. 逐提交 CI**：8 个提交全部通过。
- npm test 依次是 528、528、537、539、543、543、543、543，全绿。
- smoke、gate、syntax 全部是 0。这次没有并行跑其他负载，没有出现偶发失败。

## 结论明细（第 14 轮）

### ✅ 通过

- 第 13 轮的 P1 主路径已经修好：打分器给 other，或者 JD 能认出 ≥3 年时，入库、重算、投前三步都拒。
- 年限误杀方面，1-3 years 和 2 or 3 years 都不会被误当成 ≥3 年。
- 45 个岗和我的分桶完全吻合。
- 逐提交 CI 全绿，真实家目录零写入。

### ❌ 真 bug

- **P2｜① 核心业务逻辑｜打分器给出非规范标签时，≥3 年的岗仍能走到自动投**
  - 复现：见上面第 6 条，打分器给 senior 或 full_time。
  - 修法方向：store 用 normalizeRoleType 规范化打分器的标签，规范不出来就当 other；或者在 :67 直接拒绝 4 个合法值以外的标签。改动约 1-3 行，但涉及业务逻辑，交 builder。

### ⚠️ 风险（请 lead 定）

- **P3｜年限 lookbehind 跨行**：上一行以数字结尾（GA4、URL）时，下一行的「- 3+ years」会被漏认。真实数据里 1 例，是工程岗，本来就被拦。另外现在有打分器否决兜底（前提是 P2 修好）。建议 lookbehind 里的 `\s*` 改成 `[ \t]*`。
- **P3｜标题里写的是面向哪个市场，也会被当成上班地点**：例如「- Japan Market」「- India」。真实数据 0 例，但 AI 视频公司在美国招本地化增长岗并不少见。
- **P4**：职能排除词会拦掉 UX Researcher，以及 Prompt / Automation / Martech Engineer 这类离增长和 GTM 较近的岗，要不要放行请拍板人定；另外「New Mexico」「Lima, Ohio」会被判成外国。

## Quinn 重构 / 质量指标 / 老坑（第 14 轮）

- Quinn 重构：无。P2 涉及业务逻辑，交 builder。
- `verify_self_miss_rate: 0%`（0/5）。第 13 轮判「A 可推」的范围，这次复验没有发现漏检。
- 真 bug：1 个（P2）。风险：P3 2 个、P4 1 组。
- 老坑清单：项目没定义。
- main_chain：发现 → 入库 → 重算 → 投前校验，在临时 HOME 上跑过；真驱动禁止真投，没有跑。

## 覆盖度评估（第 14 轮）

**质量分 3/5，回炉（小修）。**
- 主路径修好了，45 个岗零误杀，CI 全绿。
- 但「重判翻回可投」这条路还有一个口子：打分器给非规范标签时仍会翻回，结果和第 13 轮的 P1 一样，会替拍板人投出要求 ≥3 年的岗。
- 修复量约 1-3 行，外加决策表里这几格的测试。修完后我只需要复跑第 6 条的决策表。
- A（correct）部分维持第 13 轮结论，可推。
- 没覆盖到的：真驱动。

## 试过的错误方向（第 14 轮）

- **一开始以为 suno ML Scientist 的年限是被「preferred」小标题吞掉的**：打印出所有小标题行，发现没有一个带 preferred 字样。再按字符位置二分截取 JD，才定位到是上一行结尾的数字加上跨行的 lookbehind 造成的。
- **一开始构造的复现用例是绿的**：我写的上一行只有 24 个字，自己被当成小标题删掉了，数字没能挨到下一行。换成超过 60 个字的真实行以后才复现出来。

---

# 第 15 轮 — B 回炉第 2 轮复验（08d8f5d 20fda73 c1b3b36）

## 验收范围

- **08d8f5d**：打分器给的岗位类型标签，入库前先统一写法。认不出的标签一律记为 other（不合格），不可投，并在日志里写明原因。修的是第 14 轮的 P2。
- **20fda73**：
  - 年限区间的判断不再跨行，修第 14 轮的 P3。
  - 标题里写的市场、区域词，不再当成上班地点。
  - 「New Mexico」「Lima, Ohio」判为美国。
- **c1b3b36**：施工记录。
- 环境：新拷一份真实家目录到 scratchpad/r15/home。没有真投，没有 push。真实家目录前后的 sha 一致。

## 5 维高危区评估

- **① 核心业务逻辑（最高）**：这轮最要紧的是「要求 ≥3 年的岗会不会被重判翻回可投」。为此用 20 种打分器标签，打入库 → 重算 → 投前校验 → 投递队列整条链。
- **① 误杀面**：42 个应届岗和第 14 轮逐个比对；另外把 601 个岗的地点、年限判断新旧逐条对比。
- **④ 集成点**：Ashby 文本型 JD 的换行结构。
- **⑤ 主流程**：发现 → 入库 → 重算 → 投前校验，在临时 HOME 上代跑。
- **②③**：本轮不涉及。

## 7 类测试

| 技术 | 次数 | 用在哪 |
|---|---|---|
| 等价类 | 5 | 标签分五类：规范值 / 大小写和空格变体 / 别名 / 未知字符串 / 非字符串（数字、数组、布尔、null、空） |
| 边界值 | 9 | GA4 换行、suno 真实 URL 行、1-3、2 or 3、3-5+、5–10+、1–3+、「3 -\n5」跨行区间 |
| 决策表 | 1 | 20 种标签 × 四步链路 |
| 状态迁移 | 20 | 每种标签都走 store → recompute → validate → queue |
| 用例测试 | 1 | 21 家复跑 601 → 45 |
| pairwise | 1 | 标题里的地点或市场 × 地点字段，共 12 组 |
| 风险驱动 | 2 | 601 个岗在新旧代码下的地点和年限逐条对比；42 个应届岗集合比对 |

## 5 轮回归循环记录（第 15 轮）

**1. 核对第 14 轮 P3 的方向**

- 我第 14 轮报的是「跨行**漏认**」：上一行以数字结尾时，下一行的「- 3+ years」被当成区间的后半截跳过，结果是没认出这条年限要求。
- builder 的修法是 lookbehind 不跨行（只允许空格和 tab），和我当时的建议一致。
- 用我的样例复验 [实测]：
  - `- Experience with GA4\n- 3+ years in growth`：从 null 变成 3，修好了。
  - suno 真实 URL 那一行加「- 5+ years」：从 null 变成 5，修好了。
  - 1-3 判 1、2 or 3 判 2、3-5+ 判 3、5–10+ 判 5、1–3+ 判 1，都没有变化。
  - 「3 -\n5 years」判 5：区间跨了行，不再合并成一个区间。这种写法罕见，影响可以忽略。
- 601 个岗在新旧代码下，年限只变了 1 个：suno ML Scientist 从 null 变成 5。这个岗是工程方向，本来就被排除。

**2. 最坏意图：标签规范化 × 三步路径**（Luma PM Growth，JD 写 5–10+ 年，fit 8，recommended）[实测]

- 下面 14 种标签全部是入库记 other/0、重算后仍是 0、validate 拒、不进队列：other、Other、「 OTHER 」、senior、full_time、Full-Time、New Grad FT、new-grad、INTERN、「 intern 」、unknown、N/A、"null"、new_grad_FT。
- 下面 5 种由 store 直接拒掉整批，不写库：数字 123、数组 ["new_grad_FT"]、true、null、空字符串。
- **例外：打分器给 part_time**。入库是 part_time/0，但重算后变成 **1**，auto_apply_queue 也把它列进了队列。
  - 原因在 deriveRoleTypeFromJob：库里存的是 intern 或 part_time、而标题重判结果不一样时，就改用标题重判。标题重判拿不到 JD，得出 new_grad_FT，于是翻回可投。这条规则早就有，本来是用来纠正打分器把全职错标成实习的。
  - validate_auto_row 拒绝了（role_type_not_allowed）。apply_batch 在派单前逐行调用它，失败时记为 needs_user，并且 stage 是派单前，不会驱动浏览器。
  - 所以这条不会造成真投。但「可投」的计数和队列会多算这一行，投递报告里还会多出一条「需要你处理」。

**3. 21 家复跑** [实测]

- 601 → 45（应届 42 + 实习 3）。各道筛子的数字和第 14 轮完全相同：排除词 270、地点 140、资深 77、≥3 年 60、类型不符 9。
- 这 45 个岗和第 14 轮的集合逐个比对，一个不差；里面的 42 个应届岗仍然零误杀。
- 601 个岗的地点判断，新旧代码下 0 个变化。

**4. 地点构造用例** [实测]

- 修好的：「Social Media - Japan Market」和「Creator Partnerships - India」地点在 SF，现在都放行。New Mexico、Lima, Ohio 判美国，Tbilisi 仍判外国，Atlanta, Georgia 判美国。
- 行为变化：「Marketing Manager - Paris」地点在 New York 时，现在放行。只要地点字段里有具体的美国地名，就不看标题里的城市。这个判断合理。
- 潜在漏网：「Growth Marketer - EMEA Market」地点写 Remote，现在放行。原因是标题带了 market 这个词，整段就不再当地点看，而地点字段又只有一个裸 Remote。

**5. 逐提交 CI**：3 个提交全部通过。
- npm test 依次是 549 / 551 / 551，全绿。
- smoke、gate、syntax 全部是 0。

## 结论明细（第 15 轮）

### ✅ 通过

- **P2 修好**：打分器给出的非规范标签，全部记为 other，不可投。
- **P3 两条都修好**：跨行漏认年限、标题里的市场词被当成地点。
- 45 个进打分的岗和上一轮一致，42 个应届岗零误杀，CI 全绿，真实家目录零写入。

### ❌ 真 bug

无。

### ⚠️ 风险（请 lead 定）

- **P3｜打分器给 part_time 时，重算会把资格翻回可投**：
  - 实际后果：最后一道投前校验会拦下，不会真投。但队列和「可投」计数会多算，投递报告里会多出一条「需要你处理」。
  - 这条规则早就有，不是本批引入的。
  - 建议：用户的目标类型里不包含 part_time 时，存的 part_time 不要改用标题重判。约 1 行，交给 builder。
- **P4｜标题带 market 字样、地点字段只写 Remote 时会漏网**：例如「- EMEA Market」。真实数据 0 例。
- 沿用第 14 轮的 P4：职能排除词会拦掉 UX Researcher，以及 Prompt / Automation / Martech Engineer。要不要放行，请拍板人定。

## Quinn 重构 / 质量指标 / 老坑（第 15 轮）

- Quinn 重构：无。
- `verify_self_miss_rate: 0%`（0/2）。
- 真 bug：0。
- 老坑清单：项目没定义。
- main_chain：在临时 HOME 上代跑了发现 → 入库 → 重算 → 投前校验。真驱动禁止真投，没有跑。

## 覆盖度评估（第 15 轮）

**质量分 4/5，可推。**
- 否决链路打了 20 种标签，只有 part_time 一种会在队列这一层漏过去，最后一道投前校验兜住了，不会真投。
- 45 个岗的集合稳定，地点和年限判断在真实数据上只变了预期中的 1 处。
- 逐提交 CI 全绿。
- 扣 1 分：part_time 这条会让队列和计数失真；另外真驱动没有覆盖。

## 试过的错误方向（第 15 轮）

- **一开始把 part_time 翻回可投当成 P1**：看到重算后是 1、队列里也有这一行，第一反应是会真投。接着读了 apply_batch:431，发现派单前会逐行调用 validate_auto_row，失败时记 needs_user，并且标明是派单前、不会驱动浏览器。所以降为 P3。
- **一开始打算重新做全量 21 家分桶**：后来改为直接和第 14 轮的 45 个做集合比对，再把 601 个岗在新旧代码下的地点、年限逐条对比。这样更快，也能精确看出这轮改动影响了哪些岗。

---

# 第 16 轮 — 投前自检里的 smoke 继承了调用方环境（2bff44b 7f11e9d，另含文档 f42ef11）

## 验收范围

- 首次真投时，`supervisor_preflight` 里的 `role_guard_smoke` 继承了调用方的 `MRWEIRDO_ROLE_TYPE_TARGETS=intern,new_grad_FT`，自检失败，一个岗都没派出去。
- builder 的修法（2bff44b）：smoke 一开头就清掉全部 `MRWEIRDO_*` 变量，再设上沙箱自己的；断言不改；另外补了 4 组环境回归测试。
- 7f11e9d 是施工记录。f42ef11 是 lead 的文档提交，只跑了 CI。
- 纪律同前：没有真投，没有 push。真实家目录前后 sha 一致。

## 5 维高危区评估

- **① 核心业务逻辑 / ⑤ 主流程（最高）**：投前自检失败就一个岗都派不出去，主流程直接断在「一键投递」这一步。
- **② 安全边界**：清空变量不能让 smoke 去碰真实家目录。所以专门测了调用方把 HOME 或 DB 指向真实家目录的情况。
- **④ 集成点**：supervisor_preflight 起的每一个子进程，都要判断该不该继承调用方环境。
- **③ 性能**：不涉及。

## 7 类测试

| 技术 | 次数 | 用在哪 |
|---|---|---|
| 等价类 | 5 | 目标类型变量：不设 / 实习+应届 / 只应届 / 空 / 兼职 |
| 边界值 | 1 | 空字符串 `MRWEIRDO_ROLE_TYPE_TARGETS=` |
| 决策表 | 1 | preflight 起的 5 类子进程 ×「该不该继承」 |
| 状态迁移 | N/A | 自检是一次性判定，没有状态 |
| 用例测试 | 1 | 真实家目录拷贝 + 工作库 + 带目标类型，跑完整 supervisor_preflight |
| pairwise | 1 | 全部 18 个 MRWEIRDO_* 变量同时设成恶意值 |
| 风险驱动 | 2 | 旧版 smoke 在调用方环境下复现失败；调用方 HOME 和 DB 指向真实家目录 |

## 5 轮回归循环记录（第 16 轮）

**1. 复现修复前的失败**（临时拷出 c1b3b36 版的 smoke）[实测]
- 不设变量：exit 0。
- 设成 `intern,new_grad_FT`：exit 1，报错「unexpectedly passed」，和真投时的现场一致。
- 设成 `new_grad_FT`：exit 1。

**2. ① 修复后的变量组合** [实测]：7 种组合全部 exit 0。
- 不设、`intern,new_grad_FT`、`new_grad_FT`、空字符串、`part_time`。
- 18 个 `MRWEIRDO_*` 同时设成恶意值：HOME 和 DB 指向真实家目录、REPO_ROOT 和 TMP_DIR 指向不存在的路径、MIN_FIT 设为 10、MAX_AUTO_APPLY 设为 1 等。
- 只把 HOME 和 DB 指向真实家目录。
- 跑完后真实家目录没有生成 jobs.db，sha 也没变。

**3. ② preflight 里起子进程的自检，逐个看有没有同类继承问题**（读 supervisor_preflight.mjs）

| 子进程 | 是否继承调用方环境 | 判断 |
|---|---|---|
| auto_apply_queue --summary | 继承，并显式覆盖 MAX_AUTO_APPLY 和 ROLE_TYPE_TARGETS | 该继承：查的就是这次运行的真实库 |
| queue_diagnostics --json | 同上 | 该继承 |
| validate_auto_row（每一行） | 继承，并覆盖 ROLE_TYPE_TARGETS | 该继承：真实行、真实口径 |
| node --check（32 个文件） | 继承 | 只做语法检查，不受环境影响 |
| role_guard_smoke | 本来继承，现已清空 | 它是唯一自带沙箱的自检，**唯一同类** |

- 另外：cdp、账本一致性、锁扫描都在进程内执行，读的是真实 home，本来就该这样。
- 在 shared/ 和 scripts/ 里 grep「mkdtemp 加起子进程」，只有 role_guard_smoke 这一处。role_guard_smoke 也只被 preflight 调用。

**4. ③ 清空变量会不会把该测的真实行为也清掉** [读码 + 实测]
- smoke 从头到尾只测它自己建的沙箱：临时 HOME、临时 DB，读的是自己写进去的 search_intent。它本来就不读真实家目录。
- 需要特定目标类型的断言，都在调用时显式传 `MRWEIRDO_ROLE_TYPE_TARGETS`（:183-385）。
- 所以清空不会丢掉任何本该测的行为。修复前，调用方的变量反而会污染这些「按默认口径」的断言，这正是这次的故障。
- 模块加载顺序：import 会先于清空语句执行。被 import 的三个模块里，只有 role_types 读了这个变量，而且是函数调用时才读（默认参数），不是加载时读，所以清空能生效。

**5. ④ 在真实家目录拷贝上跑完整 supervisor_preflight** [实测]
- 环境：真实家目录拷贝 + 工作库（里面有 1 行应届可投）+ `MRWEIRDO_ROLE_TYPE_TARGETS=intern,new_grad_FT` + MAX 10。
- 结果：13 项里 12 项 OK，其中 role_guard_smoke、queue_nonempty、queue_validated、submission_ledger_consistent 都是 OK。
- 只有 cdp 失败：我故意把端口指到没有 Chrome 的 59999，这是预期内的。

**6. ⑤ 逐提交 CI**
- npm test：f42ef11 551/551、2bff44b 555/555、7f11e9d 555/555，全绿。
- smoke、gate、syntax 全部是 0。

## 结论明细（第 16 轮）

### ✅ 通过

- 修复前的失败能复现。修复后，所有变量组合下 smoke 都能过。
- preflight 里没有其他同类继承问题，清空变量也没有丢掉真实行为。
- 带目标类型的完整 preflight 在真实拷贝上跑通，除 cdp 外全部 OK。
- 逐提交 CI 全绿，真实家目录零写入。

### ❌ 真 bug

无。

### ⚠️ 风险

- 观察：CI 从来不设这个变量，所以 CI 一直是绿的。这次新增的 4 组环境回归测试已经把这一点锁住了。
- 第 15 轮的 P3、P4 风险照旧，本轮没有变化。

## Quinn 重构 / 质量指标 / 老坑（第 16 轮）

- Quinn 重构：无。
- `verify_self_miss_rate: 100%`（1/1）。这个故障从 smoke 被接进 preflight 起就一直存在。第 11-15 轮的逐提交 CI 我都跑了 smoke，但从来没有在「带目标类型变量」的环境下跑过 preflight，所以没发现。如实记为漏检。
- 真 bug：0。
- 老坑清单：项目没定义。
- 教训：凡是自带沙箱的自检，验收时都要在「调用方真实环境变量」下再跑一遍。

## 覆盖度评估（第 16 轮）

**质量分 4/5，可推。**
- 覆盖面：复现、7 种变量组合、全部子进程排查、完整 preflight、逐提交 CI 都做了。
- 扣 1 分：真驱动（cdp 和真投）仍然没有覆盖，只能等拍板人下一次真跑来确认。

## 试过的错误方向（第 16 轮）

- **一开始以为 preflight 其他子进程也要清空环境**：逐个看过以后发现，queue、diagnostics、validate 查的就是本次运行的真实库和口径，必须继承。如果也清空，就会检查错对象。所以只有自带沙箱的 smoke 该清。
- **一开始担心 import 先于清空语句执行，清空会不生效**：逐个查了被 import 的模块，没有一个在加载时读 MRWEIRDO_*。role_types 读这个变量是在函数调用时，默认参数那时才取值，所以清空是生效的。

---

# 第 17 轮 — 首次真投三处修复（8259257 070d7a8 7ef0ac3 07a65b8）

## 验收范围

首次真投一个都没投出去，builder 针对三处原因做了修复：
- **8259257（RTO / 搬迁题）**：用户选了「全美可搬」、并且岗位在美国时，RTO（到岗办公）/ 搬迁题自动答 Yes。
- **070d7a8（AI 开放题）**：「用 AI 做过 / 试过什么」这类开放题，按 essay_profile 里的真实故事起草；没有故事就照旧停下来问用户。
- **7ef0ac3（反垃圾拦截）**：
  - 页面出现反垃圾横幅，就当作终局；
  - Ashby 表单没有报缺字段时，不再重复点提交；
  - 这种情况记为 may_have_submitted=false，不占这家公司 60 天内的投递名额；
  - 同一个岗 60 天内不自动重投。
- **07a65b8**：施工记录。

纪律：没有真投，没有 push。真实家目录只读，前后 sha 一致。

## 5 维高危区评估

- **① 核心业务逻辑 / 真实性（最高）**：自动答题替用户做了承诺，或者开放题写了用户没说过的事实，都会直接写进投给公司的材料里，事后撤不回来。
- **② 平台边界**：绝不能有任何绕过平台反垃圾或机器人检测的改动。这是硬红线，碰到就判回炉。
- **④ 集成点**：Ashby、Greenhouse、Lever 三个驱动遇到拦截横幅时，行为要一致。
- **⑤ 主流程**：驱动的派单和记账路径。真驱动禁止跑，改用 harness 加载真实出货的驱动源码来测。
- **③ 性能**：只多了一处「重读页面最多 4 次、每次间隔 3 秒」的等待。

## 7 类测试

| 技术 | 次数 | 用在哪 |
|---|---|---|
| 等价类 | 4 | 岗位地点分美国 / 外国 / 远程 / 未知；essay_profile 有 AI 故事 / 没有 |
| 边界值 | 3 | 数据库里没有这一行；地点字段为空；essay_profile 为空对象 |
| 决策表 | 1 | 「全美可搬」开关 × 愿意搬 × 主国家 × 岗位地点，共 13 格 |
| 状态迁移 | 1 | 提交 → 页面读不出 → 只重读、不再点 → 出现反垃圾横幅 → 终局 |
| 用例测试 | 7 | 用 harness 跑真实驱动的 answerMissing：RTO 题 ×4、问伦敦办公室、问是否住在湾区、AI 开放题没有故事 |
| pairwise | 1 | 页面文字「确认投出」×「反垃圾」两两组合，共 3 组 |
| 风险驱动 | 3 | diff 全量 grep 绕过检测的写法；起草出来的草稿逐句回查 essay_profile 原文；三个驱动的拦截路径逐个读 |

## 5 轮回归循环记录（第 17 轮）

**1. ① RTO 题** [实测，用 harness 加载真实驱动]
- 地点为空、Remote、Toronto, ON、数据库里没有这一行：都停下来问（relocation_commitment_policy_unset），没有替用户答。
- 「Are you currently located in the Bay Area?」：仍然由「具体城市事实」这道护栏拦下，停下来问。
- 纯函数：Mountain View、NYC、Palo Alto HQ、US remote 判为可自动答；London、Toronto、Tbilisi 判为要问；用户不愿意搬、或者主国家不是 US 时，一律要问。
- **❌ 发现问题**：岗位地点是 New York City，但题目问「Are you comfortable working in-person at our office in **London**?」时，**自动答了 Yes**。原因是判断只看岗位地点，不看题目里点名的城市。修复前这道题会停下来问，所以这是这次提交引入的回退。

**2. ② AI 开放题** [实测]
- 用真实 essay_profile 起草：三句话逐字都能在 essay_profile.json 里找到（grep 各命中 1 次）。外面只加了「What I was trying to learn or achieve / What I did / What I discovered」三个引导语，没有新增任何事实。
- 草稿没有碰到 hard_no_claims（用户明确不能声称的内容）里的任何一条。
- 没有 AI 故事时，真实驱动的 answerMissing 返回「no_bucket_for… pending_for_main_claude」，也就是停下来问。模板渲染也不会用空内容凑一段话。

**3. ③ 反垃圾拦截**
- **没有绕过检测的改动** [读码 + grep]：diff 里新增的行没有任何 cookie、UA、webdriver、指纹、随机延时的操作。唯一新增的 sleep 是「只读页面、不点击」时固定等 3 秒。Math.random 只在已有代码里用来生成 DOM id，这次没有新增。
- **不再重交是否覆盖所有路径**：
  - Ashby：表单没报缺字段、页面读不出结果时，只重读、不再点提交；看到反垃圾横幅就终局。✅
  - Greenhouse：横幅会映射成 platform_spam_flagged。✅ 但页面读不出结果（没报缺字段、没有确认或拒绝的文字）时，**仍然会每隔 3 秒盲点提交，最多 5 次**（greenhouse_apply_driver.mjs:1825）。Ashby 已经改掉的「盲点可能导致重复投递、也可能触发反垃圾」的问题，在 Greenhouse 上还在。这是旧问题，不是这次引入的；本批只修了 Ashby。
  - Lever：只点一次；横幅会记为 page_states_failure，并按 may_have_submitted=true 计入名额，属于保守方向。名单上 21 家里没有用 Lever 的。
- **「不占名额」是不是只在页面明说没收到时才成立** ❌：
  - isSpamFlagged 只看反垃圾规则有没有命中，不看最终判定结果是什么。
  - 实测：页面同时有「Thank you for applying… submitted」和「flagged as possible spam」时，判定结果是 unknown，但 isSpamFlagged 返回 true。
  - Ashby 驱动先检查反垃圾，后判断是否已投，所以这种页面会被记成 not_submitted、may_have_submitted=false。结果是一个可能已经投出去的岗不占名额，违背「拿不准就当作可能已投」的口径。
  - Greenhouse 那边只在判定为 not_submitted 的分支里才看反垃圾，没有这个问题。

**4. 真实账本（只读）**：首次真投 Tavus 那一行记的是 not_submitted / page_states_failure / may_have_submitted=**true**，属于保守计名额，这次改动不会回头改它。要不要用 correct 更正，由 lead 定。

**5. ④ 逐提交 CI**：4 个提交全部通过。
- npm test 依次是 558、563、570、570，全绿。
- smoke、gate、syntax 全部是 0。

## 结论明细（第 17 轮）

### ✅ 通过

- RTO 题：国外、远程、地点未知时照问，没有误答；问「住在哪」的事实题仍然被拦下来问。
- AI 开放题：草稿逐字取自 essay_profile，没有故事时停下来问。
- 没有任何绕过平台检测的改动。
- Ashby 不再盲目重复点提交；Greenhouse 看到反垃圾横幅会终局。
- CI 全绿，真实家目录零写入。

### ❌ 真 bug

- **P2｜① 真实性｜题目点名外国办公室时仍然自动答 Yes**
  - 复现：岗位地点是 New York City，题目问「in-person at our office in London?」，驱动答了 Yes。
  - 这是这次提交引入的回退：修复前这类题会停下来问。
  - 修法方向：题目里点名的地点也要过 classifyPlace，是外国或认不出来就停下来问。
- **P2｜① 名额口径｜页面同时出现「已投出」和「反垃圾」时，被记成没收到、不占名额**
  - 修法方向：isSpamFlagged 要同时满足 verdict==='not_submitted'。约 1 行。

### ⚠️ 风险（请 lead 定）

- **P2｜Greenhouse 页面读不出结果时，仍然盲点提交最多 5 次**：这是旧问题。Ashby 已经改了，建议 Greenhouse 同样改成「只重读、不再点」。名单上有 4 家用 Greenhouse，下次真投就会用到这个驱动。
- **P4｜Lever 的反垃圾横幅没有单独映射**：按保守方向计名额，名单上也没有用 Lever 的公司。

## Quinn 重构 / 质量指标 / 老坑（第 17 轮）

- Quinn 重构：无。两处修复都涉及业务口径，交给 builder。
- `verify_self_miss_rate: 0%`（0/3）。
- 真 bug：2 个（都是 P2）。另有风险 P2 1 个、P4 1 个。
- 老坑清单：项目没定义。

## 覆盖度评估（第 17 轮）

**质量分 3/5，回炉。**
- 没有绕过检测的改动；RTO 的主路径、AI 开放题的真实性、没有故事时停下来问，都通过了。
- 但有两处会直接写进投给公司的材料或名额记录：
  - 替用户承诺到外国办公室上班；
  - 可能已经投出的岗被记成「没收到」，不占名额。
- 两处都是 1-3 行的小修。建议 Greenhouse 的盲点提交顺手一起改。
- 没覆盖到的：真驱动（禁止真投）。

## 试过的错误方向（第 17 轮）

- **一开始只拿纯函数测 relocationPolicyOpen**：13 格全部符合预期，差点直接判通过。后来想到「岗位在美国」不等于「题目问的办公室在美国」，于是改用 harness 加载真实驱动，拿点名伦敦的题去打，这才复现出问题。
- **一开始以为 Greenhouse 的反垃圾处理和 Ashby 一样完整**：Greenhouse 确实映射了反垃圾原因，但它在「读不出结果」时仍然会重新点提交，而这正是 Tavus 那次触发反垃圾的原因。

---

# 第 18 轮 — 第 17 轮三项回炉复验（0b93ac2 98018e6）

## 验收范围

复验 builder 对第 17 轮三项的修复：
- **RTO 题**：先看题目本身点名的地点。点名美国以外的地方一律停下来问；点名美国的按「全美可搬」答；题目没点名地点时，才看岗位地点。
- **反垃圾免名额**：只有判定器判为「没投出」时才免名额；「已投出」和「反垃圾」两边都命中时算不确定，要占名额。
- **Greenhouse**：没有缺字段、页面读不出结果时，只重读页面，不再点提交。

纪律：没有真投，没有 push。真实家目录前后 sha 一致。

## 5 维高危区评估

- **① 真实性 / 名额口径（最高）**：这些答案会直接写进投给公司的材料，名额的判定也决定会不会重复投递。
- **② 平台边界**：再次确认没有任何绕过平台检测的改动。
- **④ 集成点**：用 Ashby 公开接口只读拿到了两个真实表单的结构，确认题目文本。
- **⑤ 主流程**：Ashby 和 Greenhouse 两个驱动的提交循环。
- **③ 性能**：只是把 Greenhouse 原来的「等 3 秒再点」改成「等 3 秒再读」，时长不变。

## 7 类测试

| 技术 | 次数 | 用在哪 |
|---|---|---|
| 等价类 | 4 | 题目点名美国 / 外国 / 两者都有 / 都没有 |
| 边界值 | 3 | 「US hours」只说时区不算地点；「U.S.」；「join us」里的 us 不算美国 |
| 决策表 | 1 | 岗位地点 4 种 × 题目 10 种，共 40 格 |
| 状态迁移 | 1 | Greenhouse：点提交 → 读不出结果 → 只重读，最多 4 次 → 仍读不出就记 unknown，不再点 |
| 用例测试 | 2 | ElevenLabs Social Growth、Synthesia Marketing General Application 的真实表单 |
| pairwise | 1 | 页面「已投出」×「反垃圾」× 最终判定 × 投过口径 |
| 风险驱动 | 2 | diff 全量 grep 绕过检测的写法；清单里没有的外国城市 |

## 5 轮回归循环记录（第 18 轮）

**1. 两个真实表单**（Ashby 公开 non-user-graphql 接口，只读取表单结构）[实测]

- **Synthesia Marketing General Application**（主地点 London）：只有姓名、邮箱、简历、Cover Letter、LinkedIn、所在地、两道工作许可题，外加一道开放题「想要什么岗位、为什么合适」。**没有 RTO 题。**
- **ElevenLabs Social Growth Strategist**（主地点 United Kingdom）：基本信息、从哪里得知、LinkedIn，外加 4 道社媒开放题。**也没有 RTO 题。**
- 所以这两个岗真实跑时，不会碰到 RTO 题。

**2. 用这两个岗的地点，拿构造的 RTO 题跑 40 格决策表** [实测]

| 题目 | 岗位地点是 UK / London | 岗位地点是 NYC / Mountain View |
|---|---|---|
| 不点名地点（「RTO requirements work for you?」「join us in our office」） | 问 | 答 Yes |
| 点名 New York / Austin, TX / U.S. office | 答 Yes | 答 Yes |
| 点名 London / Munich | 问 | 问 |
| 同时点名 London 和 New York | 问 | 问 |
| 「US hours from our London office」 | 问 | 问 |
| 点名 Belo Horizonte（不在外国城市清单里） | 问 | **答 Yes** |

- 上一轮复现用的那道题（岗位在 NYC、题目问 London 办公室），现在会停下来问。✅
- 「join us」里的 us 没有被当成美国。✅

**3. 反垃圾免名额** [实测]
- 纯反垃圾横幅：isSpamFlagged=true，may_have_submitted=false。✅
- 「感谢投递」和「反垃圾」同时出现：isSpamFlagged=false。就算有人手工构造一条 not_submitted + platform_spam_flagged 的结果传进来，deriveMayHaveSubmitted 仍然返回 true，也就是照样占名额。两层都拦住了。✅
- 结果里完全没有判定信息时，也返回 true。✅

**4. Greenhouse 读码**
- 提交后，没有缺字段并且判定为 unknown 时，只调用 readSubmitPage 重读，最多 4 次。
- 仍然读不出，就记 unknown / no_errors_no_success，原来的 `if (attempt < 5) continue` 盲点已经删掉。
- 只有页面明确报了缺字段，才会进入「补填后再提交」的分支。✅

**5. 没有绕过检测的改动**：diff 里新增的行 grep cookie、UA、webdriver、指纹、随机、延时、代理、VPN、验证码，零命中。✅

**6. 逐提交 CI**：0b93ac2 和 98018e6 都是 575/575。smoke、gate、syntax 全部是 0。

## 结论明细（第 18 轮）

### ✅ 通过

- 第 17 轮的两个 P2 都修好了。
- Greenhouse 的盲点提交已经改掉。
- 没有绕过检测的改动，CI 全绿，真实家目录零写入。

### ❌ 真 bug

无。

### ⚠️ 风险

- **P4**：外国城市清单里没有的城市（例如 Belo Horizonte），如果题目点名它而岗位在美国，会答 Yes。清单覆盖的是常见城市，真实表单里还没见过这种情况。建议以后补一条：题目里出现「our X office」而 X 认不出时，停下来问。
- **观察**：Synthesia 那道「wish to work in without sponsorship」工作许可题，要靠 profile 的三态字段来答，这是本轮范围外的已有逻辑。

## Quinn 重构 / 质量指标 / 老坑（第 18 轮）

- Quinn 重构：无。
- `verify_self_miss_rate: 0%`（0/1）。
- 真 bug：0。
- 老坑清单：项目没定义。

## 覆盖度评估（第 18 轮）

**质量分 4/5，可推。**
- 覆盖：真实表单结构、40 格决策表、反垃圾两层防护、Greenhouse 读码、逐提交 CI。
- 扣 1 分：真驱动没有跑（禁止真投）；另有清单外外国城市的 P4。

## 试过的错误方向（第 18 轮）

- **一开始打算在真实页面上找 RTO 题来测**：用公开接口拿到两个表单的结构后，发现两个都没有 RTO 题。于是改成用这两个岗的真实地点，配上构造的题目跑决策表。
- **一开始只测了 isSpamFlagged 一层**：后来想到如果调用方手工传入一条 not_submitted + spam 的结果，只靠这一层拦不住。又补测了 deriveMayHaveSubmitted，确认第二层也会判为占名额。

# 第 19 轮 — 点击没接住 / 终局留证 / 缺信息小题（fa9c012 1c6f071 9e469f1 d9fc5bf 03f1255）

## 验收范围

验收 builder 第 7 次召唤的 5 个提交（都没推）：
- **① 点提交前后**（fa9c012，1c6f071 是配套测试替身）：先等简历上传走完（S3 上传和其后的 graphql 都回来、请求数不再涨），30 秒等不到就判 crashed、不算投过；点完问页面「接住了吗」，没接住就再点 1 次，还不接住就记 not_submitted / submit_click_not_registered（不算投过）。Greenhouse 同步改。
- **② 留证**：点过提交之后的各种终局都整页截图，截图文件权限 600。
- **③ 缺信息小题**（9e469f1）：「从哪里得知」「社媒几年经验」「管过哪些账号」三题读档案，档案空就挂起；「每周几天到我们 NYC 办公室」进 RTO 判断；点评对方社媒的开放题走新的 agent_drafts.mjs 起草通道。
- d9fc5bf、03f1255 是文档。

纪律：没有真投、没有 push。我的测试全部用沙箱家目录。真实 `~/.mrweirdo-jobs/` 在验收期间有 3 个文件变了（12:39 profile.json / answer_provenance.json、12:43 agent_drafts.json），核过内容是 lead 写入的 ElevenLabs Social 三条草稿和档案字段，不是本轮写的。

## 5 维高危区评估

- **① 名额口径 / 重复投递（最高）**：「再点一次」只有在第一次点击真的什么都没发出去时才安全。所以本轮重点是：「没接住」这个判断会不会误判。一旦误判，同一家公司会收到两份投递，账本却记成「没投过」，下次运行还会再投。
- **② 平台边界**：确认没有任何绕过反垃圾、反机器人检测的改动。
- **③ 真实性**：新增的答案只能来自 profile、essay_profile 和 agent_drafts；代码里不能写死候选人的任何事实。
- **④ 集成点**：「接住了吗」靠浏览器自带的资源时间表（Resource Timing，浏览器记录每条网络请求的清单）来判断。所以要在真 Chrome 上实测这张清单在最坏情况下的表现。
- **⑤ 主流程**：Ashby 和 Greenhouse 驱动的提交循环，以及 3 行报告。

## 7 类测试

| 技术 | 次数 | 用在哪 |
|---|---|---|
| 等价类 | 3 | 点击后的请求：已完成 / 还在路上 / 失败（连接被拒、域名不存在） |
| 边界值 | 3 | 年限正好落在区间端点（1、2、3）；档案年限为空、null、不是数字 |
| 决策表 | 1 | RTO：8 道题 × 2 个岗位地点，共 16 格 |
| 状态迁移 | 2 | 第 1 次点没接住 → 再点 → 找不到按钮；上传未确认 → crashed，全程不点 |
| 用例测试 | 1 | agent_drafts 命令行：add、list，空答案、非岗位链接、换题、换岗 |
| pairwise | 1 | 草稿命中 × 链接写法（apply 页和岗位页）× 题目的大小写和空格 |
| 风险驱动 | 3 | 真 Chrome 上的「请求还在路上」时序；diff 全量 grep 绕过检测的写法；diff 全量 grep 写死的候选人事实 |

## 5 轮回归循环记录（第 19 轮）

**1. 最坏时序实测：请求还在路上时，「接住了吗」会答「没有」** [实测]

实测方法：在沙箱里开一个无头 Chrome（独立的用户目录、独立端口 9333，没碰真实的 9222）。本地起一个服务，收到提交请求后 25 秒才回复。然后照驱动的原话点按钮，用出货版的 `clickReceived` 去问：

| 点击后多久问 | 服务端是否已收到提交 | clickReceived 的回答 |
|---|---|---|
| 7 秒 | 已收到 | `registered:false`（no_request_after_click） |
| 19 秒 | 已收到 | `registered:false` |
| 27 秒（回复之后） | 已收到 | `registered:true` |

原因是浏览器的资源时间表只记录**已经走完**的请求，还在路上的请求不在表里。`page_signals.mjs:19` 的注释自己也写了这一点，但 `clickReceived` 没有照顾到。

驱动从点击到发问，Ashby 大约 19 秒（等 7 秒，再最多重读 4 次、每次隔 3 秒），Greenhouse 大约 17 秒。只要点击后所有请求（Ashby 是反欺诈、人机验证、提交接口这三条）都超过这个时长还没回来，就会被判成「没接住」，然后再点一次。

对照组：失败的请求（连接被拒、域名不存在）会被记进表里，判「接住了」。这是安全的方向。

**2. 最坏时序的后半段：第二次点时，页面已经换成确认页** [实测，驱动 harness]

复现方法：用出货版 Ashby `main()` 加替身。第 1 次点击成功，`clickReceived` 判「没接住」（相当于上面那种误判）。再点时页面已经没有提交按钮了。

结果是驱动输出 `crashed / submit_button_not_found`，`attempt:1`，截图标成 `before_submit`，`deriveMayHaveSubmitted` 返回 **false**。原因是 `submit_button_not_found` 在「点提交之前」出口表 `PRE_SUBMIT_EXITS` 里（`driver_contract.mjs:149`）。这一行本来是给 Lever 点击前用的，现在 Ashby 和 Greenhouse 在点过之后也会走到这个出口，但出口表没有区分。

后果是：一份其实已经发出去的投递，在账本上记成「没投过」，下次运行会再投。Greenhouse 在 `:1832` 也是同一条路径。

**3. 已有测试覆盖到的部分** [实测]

- 上传一直没确认 → crashed / resume_upload_failed，一次都没点，不算投过。✅
- 两次都没接住 → not_submitted，只点 2 次，有截图，权限 600。✅
- 接住了但页面读不懂 → unknown，只点 1 次，有截图。✅
- 资源记录满了、判断不了 → 按「接住了」处理，不再点。✅

以上都是替身测试。「请求还在路上」这种情况，替身测试没有覆盖。

**4. 缺信息题** [实测]

- **RTO 16 格**：点名 London / Berlin / Toronto 的题一律照问（第 17、18 轮回归通过）；点名 NYC 或 New York 的答 Yes；「work in the country where the office is located」仍走工作许可桶，没有被新的 RTO 正则抢走。✅
  - Belo Horizonte 在岗位位于美国时答 Yes，这是第 18 轮已知的 P4，本轮没变。
- **年限选项**：`pickYearsOption` 在 3 种选项写法 × 7 个值上都对；年限为空、null、非数字时返回 null，题目照问。✅
- **管过的账号**：档案里没有这项时返回空字符串，驱动记 social_accounts_managed_unset，挂起。✅
- **从哪里得知**：档案没填就挂起；模板里原来默认的 LinkedIn 已改成空。✅
- **写死的事实**：diff 全量 grep 学校名、城市名、人名、邮箱、签证词，只在注释里出现（Waltham、Babson 是在讲事故）。代码里零写死。✅

**5. agent_drafts** [实测，沙箱家目录]

- 文件权限 600，并且列进了 PII_TARGETS（隐私文件锁定清单）。
- 空答案、非岗位链接都会报错退出。
- 草稿按「岗位指纹 + 题目」取：换一个岗位、或题目多一个字，都取不到。不会串到别的表单。✅
- 题目的大小写和空格被忽略；apply 页链接和岗位页链接都能命中同一个岗。✅
- 文件坏了会在驱动启动时直接报错，不会被当成「没有草稿」。✅

**6. 没有绕过检测的改动**：diff 新增行 grep cookie、UA、webdriver、指纹、随机、延时、代理、验证码。命中的只有注释和原有的 `sleep`。新增的 sleep 都是「等上传、等页面」，不是为了装得像人。✅

**7. 逐提交 CI**（worktree 分别检出，沙箱 MRWEIRDO_HOME）

| 提交 | npm test | smoke | gate | 语法检查 |
|---|---|---|---|---|
| fa9c012 | 596/597（1 红） | 0 | 0 | 0 |
| 1c6f071 | 597/597 | 0 | 0 | 0 |
| 9e469f1 | 613/613 | 0 | 0 | 0 |
| d9fc5bf | 613/613 | 0 | 0 | 0 |

- fa9c012 单独检出时，`submission_verdict.test.mjs` 里「Directive 失败横幅」那条是红的。原因是测试替身没有给点击加时间标记，1c6f071 补上了。两个提交一起推没问题，但 fa9c012 本身不是一个全绿的提交。
- 03f1255 只改了文档，实跑 613/613，另外三步都是 0。

## 结论明细（第 19 轮）

### ✅ 通过

- 等上传走完再点、上传确认不到就 crashed：做到了。
- 点过之后的终局都截图：做到了。例外见下面 P3。
- 三道缺信息题读档案、档案空就挂起：做到了。
- RTO 点名外国城市照问：回归通过。
- agent_drafts 不会串表单，权限 600。
- 没有任何绕过检测的改动。

### ❌ 真 bug

- **P2（命中维度 ① 名额口径 / ④ 集成点）：「没接住」会误判，而且误判后可能重复投递、账本漏记。**
  - 原因一：`clickReceived` 只看**已经走完**的请求。点击后请求如果都还在路上超过约 19 秒（Greenhouse 约 17 秒），就会被判成 `registered:false`，然后驱动再点一次。第一次的投递可能已经到了公司，于是公司收到两份。
  - 原因二：再点时如果页面已经换成确认页、没有按钮了，驱动会输出 `crashed:submit_button_not_found`。这个出口在 `PRE_SUBMIT_EXITS` 里，所以 `may_have_submitted=false`，下次运行会第三次投。
  - 复现：见第 1、2 条。
  - 触发条件：网络或平台很慢，概率低；但一旦触发，后果就是重复投递。
  - 修法方向，交 builder：
    1. 「接住了吗」要能看到**已经发出但还没回来**的请求。可以在驱动这一侧用 CDP 的 Network 事件（requestWillBeSent，请求一发出就能看到，页面感知不到），或者给出等价的证据；不要改页面里的 fetch。
    2. 点过之后找不到按钮，要换成一个新的 reason（不在 `PRE_SUBMIT_EXITS` 里，算可能投过），或者先读一遍页面再给结论。截图阶段也要跟着改成 after_submit。
    3. 补一条回归测试：「第 1 次点击其实已发出 + 判定为没接住 + 再点时按钮消失」，断言结果算可能投过。

### ⚠️ 风险

- **P3：程序抛异常退出时没有截图。** `driver_exception`（ashby:1358、gh:1938）发生在点过提交之后时，账本里的 evidence 是空的。标签页会留着，还能人工去看，但派遣单要求的「点过之后全覆盖」在这一条上没做到。
- **P3：州缩写匹配不起作用。** `pickComboboxInQuestion` 的 `new RegExp('\\b'…)` 放在页面源码的模板字符串里，到页面上变成了退格符，所以州缩写那一支永远匹配不上。实测「waltham, ma, usa」→ false。前面「整串包含」那一支通常能兜住，所以实际影响小。
- **P3：草稿在答案日志里记错了来源。** agent_drafts 填进去的答案在 `answers` 日志里 source 记成 `derived`，因为 `FILL_SOURCES` 里没有「agent 起草」这一类，看不出这段话是 agent 写的。另外 CLI 不限制题目类型，理论上可以给事实类的题写「草稿」，现在只靠 truthfulness.md 约束。
- **观察**：Greenhouse 驱动不读 agent_drafts。现在点评类的题只在 Ashby 挂 agent_draft_required，所以不算回归。

## Quinn 重构 / 质量指标 / 老坑（第 19 轮）

- Quinn 重构：无。P2 涉及驱动逻辑，P3 的正则改动跨模板转义，都超出 1-3 行的边界，交 builder。
- `verify_self_miss_rate: 0%`（上轮漏检 0 / 本轮问题 4）。
- 真 bug：1 个（P2）。
- 老坑清单：项目没定义。

## 覆盖度评估（第 19 轮）

**质量分 3/5，回炉。**
- 覆盖：真 Chrome 最坏时序实测、驱动 harness 复现、RTO 16 格、年限边界、agent_drafts 沙箱、两类 grep、逐提交 CI。
- 扣分：
  - P2 直接违反这轮的核心要求「再点一次绝不能造成重复投递」，而且误判后账本会记成没投过。
  - 真驱动没有在真 Ashby 上跑（禁止真投），所以 Ashby 点击后请求的真实耗时分布没法测。
- 建议：修好 P2 的两处原因再推。3 个 P3 可以同包修，也可以挂账，由 lead 定。

## 试过的错误方向（第 19 轮）

- **一开始以为失败的请求也看不见，会被误判成「没接住」**：实测发现连接被拒、域名不存在的请求都会进时间表，判「接住了」，是安全的方向。真正的漏洞只有「请求还在路上」这一种。
- **一开始把真实家目录的 hash 变化当成本轮误写**：核对文件时间和内容后确认是 lead 写入的（ElevenLabs Social 三条草稿，12:43；profile 12:39）。本轮的草稿测试写在沙箱里（`Draft A` 在真实文件里 0 命中）。

# 第 20 轮 — 第 19 轮回炉复验（8eaf9c4 2a1117d）

## 验收范围

复验 builder 对第 19 轮 P2 和 3 个 P3 的修复：
- **① 点击后改用 CDP 看网络**：新增 `cdp.mjs clickwatch`。点击和看网络在同一个 CDP 会话里做，听的是 Network.requestWillBeSent（请求一发出就能看到，包括还在路上的）。最后由 `clickVerdict` 下结论：CDP 看到了请求，或者页面自己的请求记录里有，就算接住了；CDP 那边出问题、判断不了，就不再点；只有两边都确定是空的，才会再点一次。
- **② 第一次点击之后**：找不到按钮、或者点击结果读不出来，一律记 unknown，算可能投过，不再走「点提交之前」的出口。
- **P3 三项**：异常退出也截图；州缩写正则的转义；草稿填入的答案来源记成 agent_draft。

Greenhouse 同路径同改。没有真投、没有 push；真实家目录 13:00 之后没有文件变化。

## 5 维高危区评估

- **① 重复投递（最高）**：这轮的核心是确认任何路径都不会把已经发出的提交再点一次。lead 点名了 4 种最坏情况：请求在点击之前就发起了、CDP 事件丢失或连接断开、页面跳转和请求同时发生、Greenhouse 走同一条路径。
- **② 平台边界**：新增的 Network.enable 只在浏览器调试端监听，页面感知不到；userGesture 原来的 eval 就在用，不是这轮新加的。
- **④ 集成点**：需要在真 Chrome 上实测 CDP 网络事件的时序。
- **③ 真实性**、**⑤ 主流程**：只涉及 P3 修复和提交循环，都已回归。

## 7 类测试

| 技术 | 次数 | 用在哪 |
|---|---|---|
| 等价类 | 5 | 真 Chrome 的 5 种场景：点击立刻发出慢请求 / 点击 21 秒后才发 / CDP 连接中途断开 / 表单提交跳转 / 请求在点击之前就发起 |
| 边界值 | 2 | 请求落在观察窗口 19 秒之外；州缩写 ma 对 mass / oklahoma |
| 决策表 | 1 | `clickVerdict`：观察结果（正常 / 出错）× 请求数（0 / >0）× 页面记录（true / false / null） |
| 状态迁移 | 3 | 第一次点击 → 按钮消失 / 结果读不出；首次点击就读不出 |
| 用例测试 | 1 | 复跑第 19 轮在途请求的沙箱 |
| pairwise | 1 | Ashby / Greenhouse × 3 种点击后异常 |
| 风险驱动 | 2 | 断开 CDP 连接用 TCP 代理真实掐断；diff grep 绕过检测的写法 |

## 5 轮回归循环记录（第 20 轮）

**1. 真 Chrome 5 个场景**

沙箱用的是无头 Chrome（端口 9333、独立用户目录）。中间加了一个 TCP 代理（端口 9444），用来掐断 CDP 连接。每个场景都用出货版 `cdp.mjs clickwatch` 点击，按驱动的节奏再用 `clickReceived` 查页面记录，最后交给 `clickVerdict` 下结论。本地服务收到提交后 40 秒才回复。

| 场景 | 服务端收到了提交吗 | CDP 观察结果 | 最终结论 | 会再点吗 |
|---|---|---|---|---|
| 点击后立刻发出慢请求（第 19 轮的 P2） | 收到 | 2ms 就看到了 | 接住了 | 不会 ✅ |
| 表单 POST 跳转 | 收到 | 看到 POST | 接住了（新页面） | 不会 ✅ |
| 请求在点击前发起，点击本身什么也没发 | 只收到背景请求 | 0 条 | 没接住 | 会，这是对的：这次点击确实没发出任何东西 ✅ |
| **点击后 2 秒 CDP 连接断开，第 4 秒才发出提交** | **收到** | **`ok:true`、0 条** | **没接住** | **会 ❌** |
| 点击 21 秒后才发出提交（超出 19 秒窗口） | 收到 | 0 条（窗口已结束） | 没接住 | 会 ⚠️ |

**2. 断连场景的根因** [实测 + 读码]

`cdp.mjs` 的 Session 在连接断开时，只把等待中的命令标成失败。`cmdClickwatch` 等窗口用的是一个单独的计时器，不受断开影响：计时器照常到点，然后报告 `watch.ok:true, requests:[]`。于是「没在听」被当成了「听了 19 秒，什么也没有」。

页面自己的请求记录又看不见还在路上的请求，两边都说「空」，`clickVerdict` 就判 false，驱动再点一次。Greenhouse 用的是同一个 clickwatch，同样中招。

**3. 窗口外的请求** [实测]

如果点击后超过约 19 秒（Greenhouse 约 17 秒）才发出请求，而且下结论时它还在路上，就会漏看。代码里写的窗口 19 秒，大致等于「等 7 秒 + 重读 4 次」，但重读本身也要时间，所以窗口结束到下结论之间还有约 1 秒以上的空档。

真实 Ashby 点击后 0.1 到 0.3 秒就会发出请求（BUG_REPORT 第 2 章的实测），所以这种情况概率极低，列为 P4。

**4. 驱动替身复跑第 19 轮的「按钮消失」** [实测]

- 第一次点击之后按钮消失：Ashby 和 Greenhouse 都记 `unknown / submit_button_gone_after_click`，may_have_submitted=true，截图阶段是 after_unknown。✅
- 第二次点击结果读不出、或者第一次就读不出：都记 `unknown / submit_click_result_unreadable`，算可能投过。✅

**5. P3 三项**
- 州缩写：`waltham, ma, usa` 和 `waltham (ma)` 现在都能匹配；`waltham, mass` 和 `waltham, oklahoma` 不匹配。✅
- 草稿答案的来源记成 agent_draft，并且加进了 FILL_SOURCES。✅
- 异常退出：有 onDriverException，点过提交之后退出会截 after_submit。已有测试覆盖。✅

**6. 绕过检测**：diff 新增行只命中观察窗口用的那个 setTimeout。Network.enable 只在浏览器调试端监听，页面看不到。没有任何绕过检测的改动。✅

**7. 逐提交 CI**：8eaf9c4 和 2a1117d 都是 628/628，smoke、gate、语法检查全是 0。

## 结论明细（第 20 轮）

### ✅ 通过

- 第 19 轮 P2 的两处原因都修好了：请求还在路上也能看到了；第一次点击之后按钮消失、结果读不出都记成可能投过。
- 3 个 P3 已修。
- 页面跳转、请求在点击前发起这两种情况，结论都对。
- 没有绕过检测的改动，CI 全绿。

### ❌ 真 bug

- **P2（命中维度 ① 重复投递 / ④ 集成点）：CDP 连接在观察窗口内断开时，会被当成「没有请求」，驱动会再点一次。**
  - 实测：服务端已经收到了提交，驱动的结论仍是 `would_reclick: true`。
  - 位置：`shared/cdp.mjs` 的 `cmdClickwatch`。连接断开后，计时器照常到点，报 `ok:true`。
  - 修法，交 builder：Session 记下连接是否断开；如果窗口结束之前连接已经断开、或者 Network.enable 之后出过错，就报 `watch.ok=false`，按「判断不了、不再点」处理。补一条测试：窗口内断开 → registered 为 null → 只点 1 次。

### ⚠️ 风险

- **P4：观察窗口之外的请求看不到。** 如果点击后超过约 19 秒才发出请求、而且下结论时还在路上，就会被漏看。另外窗口结束到下结论之间还有约 1 秒以上没人看。
  - 建议：让观察一直持续到下结论那一刻，比如下结论时再用 CDP 看一次，或者把窗口延长到整段重读结束。
  - 真实 Ashby 的请求在点击后 0.1 到 0.3 秒就发出，所以概率极低。可以同包修，也可以挂账。

## Quinn 重构 / 质量指标 / 老坑（第 20 轮）

- Quinn 重构：无。修法涉及 cdp.mjs 的会话状态，超出 1-3 行的边界。
- `verify_self_miss_rate: 0%`（上轮漏检 0 / 本轮问题 2）。
- 真 bug：1 个（P2）。
- 老坑清单：项目没定义。

## 覆盖度评估（第 20 轮）

**质量分 3/5，回炉。**
- 覆盖：真 Chrome 5 个场景，其中断连场景用 TCP 代理真实掐断；驱动替身复跑 6 组；P3 三项；grep；逐提交 CI。
- 扣分：lead 要求「任何路径都不会二次点击已发出的提交」，断连这条路径违反了这个要求，而且已经实测复现。修法很小，修完就可以推。

## 试过的错误方向（第 20 轮）

- **一开始按「点击后 31 秒下结论」来估算观察空档**：后来按驱动实际的节奏重算（等 7 秒，再重读 4 次、每次隔 3 秒，外加读页面的时间），空档只有约 1 秒以上，不是 12 秒。所以把「窗口外的请求」从 P2 降为 P4。
- **一开始想用假的 CDP 服务模拟断连**：项目里没有 WebSocket 服务端库。改成在真 Chrome 前面加一个 TCP 代理，连接建立 2 秒后掐断，更接近真实情况。
