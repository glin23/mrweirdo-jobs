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
Updated: 2026-09-26
Iterations: 5
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
