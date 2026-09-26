---
Topic: restart-apply
Created: 2026-09-25
Status: in_progress
Owner: arnold-lead
Updated: 2026-09-25
Type: audit
Parent_task: docs/active/2026-07-23_product-blueprint_TASK.md
Depends_on: none
Blocks: none
Spawned_subtasks: none
---

# TASK — 重启投递：现状盘点 + 能投出去的改进报告

## 阶段 1 — lead-用户对话

- Round 1: 用户原话：「现在我想把我这个找工作这个 agent 再重新启动起来，之前做哪里了？之前是不是都投不出去？……现在我还是想把它能投递出去，这个是最重要的，然后现在我自己也在找工作，所以我需要这个 agent 来帮我投递，然后用那个 Arnold 小队看看我现在代码是什么样子的，然后需要什么样的进步，用 PM 做一些完整的调研报告给我，然后我们继续做这个。」
- 目标重排：第一判据从「有人用」变为「**能替拍板人本人真投出去**」（他本人即第一个真用户，方向：美国 AI 视频公司实习/工作，F-1 需 sponsorship）。

## lead 启动实查（2026-09-25）

- 上次停在：五阶段总计划（docs/specs/master-plan.md）阶段 1「数字变真」包 2 已施工（tip `1880fd0`，325/325 绿），verify 第 7 轮已派但无结果回报；本地领先 origin 5 提交未推。
- jobs.db：已投 182 / 跳过未投 61 / AI sourced 707。daily_count 最后一条真投 **2026-06-14**（angi）——**三个多月零投递**。182 条中约 7 条已证实假成功，其余大多为 legacy_unverified。

## 阶段 2 — bug ‖ architect 并行盘点 → pm 汇总调研报告

- Round 2: 派 arnold-bug（为什么投不出去，逆向追因，禁真投）‖ arnold-architect（代码现状 vs「今天能替用户投出去」差距）。二者完成后派 arnold-pm 出完整调研报告。
- Round 2 (arnold-bug 回报): 产物 `docs/active/2026-09-25_restart-apply_BUG_REPORT.md`。停投的主因是没人再跑。今天照原样跑结果为 0：队列 18 条里 16 条已下架（实测）。另查出两处真 bug：存活检查对 Ashby 失明（活岗、死岗、不存在的岗一律判 bot_challenge，而这个状态不拦）；`ashby_apply_driver.mjs:1045,1053` 还在吐旧词 skip，记账被拒，这一行永远留在队列里重试。6/15 以来驱动链多处改动，一次真表单都没跑过，需要活 Chrome 小样本验证。
- Round 2 bug 另报需拍板人输入：工具内简历仍是 5 月版、找岗方向仍是 6 月产品/增长实习（无 AI 视频、无应届全职）；AI 视频公司多用 Ashby（Synthesia/Pika/ElevenLabs）、HeyGen/Descript 用 Greenhouse。
- Round 2 (arnold-architect 回报): 产物 `docs/active/2026-09-25_restart-apply_ARCH_AUDIT.md`。325/325 绿，底子好。纠正 lead 情报：verify 第 7 轮已完成（VERIFY_REPORT :2620-2750，4/5 可推，1 个 P2：投递问答整段抄进 jobs.db feedback 表 `record_apply_outcome.mjs:160,214`，恢复投递前必修）。只有 GH/Ashby 进自动队列；Lever 三处无条件 Yes 被排除；其余平台半成品。22 家 AI 视频公司 17 Ashby / 4 GH，今日实习约 6 个——只投 AI 视频每天 10 家做不到，范围需拍板。差距：岗位库过期、search_intent 过期、找岗不认目标公司名单、日上限/爬坡/60 天 2 次未落地。
- Round 3: 派 arnold-pm 汇总两份产物 + 拍板人新目标，出完整调研报告。
- Round 3 (arnold-pm 回报): 产物 `docs/active/2026-09-25_restart-apply_PRODUCT_SPEC.md`。最短路径：0 拍板人交新简历 PDF + 答 D1-D7 ‖ 1 builder 小修包（P2 隐私、Ashby 存活检查、Ashby 旧词 skip、demo:check Mac 假 0）→ verify → 推 → 2 重新找岗打分 → 3 试投 2 条（GH+Ashby 各 1，圈 3，拍板人在场）→ 4 日上限 / 60 天 / 目标公司名单 → 放到 10/天。市场：AI 视频约 22 家、实习约 6 个、H-1B 记录薄 → 三圈（AI 视频优先，余量 相邻:泛 AI = 4:6）。反驳：小众赛道内推为主、工具为辅。D6/D7 推翻总计划阶段 2 原定项。
- 关卡 1：D1-D7 + 小修包开工，待拍板人拍板。

**关卡 1 决策**：🩺 🔒 [用户] 拍板（2026-09-25）——
① 用户否掉「本地岗位库」模式，原话：「我不需要把它存到本地，这些岗位……你看到了投就可以了，你不需要给我任何东西」→ 改为**即找即投**：每次运行现找、现打分、合适当场投，不向用户出清单。
② lead 反驳并获采纳：必须保留一份**投递账本**（投过谁），否则重复投、60 天规则、数字变真都无法兑现。
③ 用户追加硬约束，原话：「保证每次跑不能跑重复的……不能说今天我让你跑 50 个，明天再让你跑 50 个，结果两天跑的是一模一样……又给我重新投」→ **跨运行去重**是验收硬指标。
④ 批准：同时修小修包 4 项。D1-D7 未逐条回答，方案按 PM 推荐默认值设计，定稿前再请拍板人确认。
⑤ 新简历：`/Users/lee/Desktop/Lee_Lin_Resume.pdf`（替换工具内 5 月版的动作留到重新引导步骤，本轮不写 `~/.mrweirdo-jobs/`）。

- Round 4: 并行派 arnold-pm（即找即投产品规格）‖ arnold-architect（即找即投架构设计）‖ arnold-builder（小修包 4 项，文件与设计线不重叠）。
- Round 4 (arnold-pm 回报): PRODUCT_SPEC 追加「第 2 轮：即找即投模式」。关键判断：N = 投 N 个（封顶今日档位，看的上限 N×10）；指纹 = 公司归一+标题归一（防重发换编号）；unknown 算投过永不重投；不合适 60 天不看、JD 变/换简历作废；本地只留账本 + 看过记录 + 轮转位置；账本现按 job_id 认岗、需 architect 改为自带指纹；历史迁入（包 3）由并行提为前置；D7 作废、D2 取消配比、D3 与新原话冲突待重拍（D8-D12 待拍板）。
- Round 4 (arnold-architect 回报): 产物 `docs/active/2026-09-25_restart-apply_DESIGN.md`，已与 PM 第 2 轮对齐。每次运行一次性工作库 → 名单公司优先 → 去重闸（账本 + 看过记录，命中不打分）→ 每 50 条一批打分、合格当场投、派单前现读账本 → 投满 N 或看满 N×10 停 → 3 行报告 → 删工作库。去重双钥匙（平台+岗位编号 / 公司+标题，实测 950 条链接全可推编号、零重号）；崩溃靠在途标记补记 unknown。jobs.db 退役：182 条已投先迁账本核数（正式运行前硬前置），再原样搬归档，不删。5 包约 4-5 天，排在小修包之后；另发现 greenhouse 驱动两处写死 jobs.db 路径，须同包修。待拍板 ADR：S3 账本格式扩展、S4 jobs.db 退役搬家、S9 历史迁入执行。
- 关卡 2：D1-D6、D8-D12、ADR S3/S4/S9 合并请拍板人一次拍。

**关卡 2 决策**：🩺 🔒 [用户] 拍板（2026-09-25）—— 回「行」：九条全按推荐——① 实习 + 2027 应届都投 ② 取消三圈比例，按分高低投、名单公司优先扫 ③ 梦想公司投前过目答案，其余看到就投 ④ JD 明写不办签证/只要公民的跳过 ⑤「跑 N 个」即开始、N 超上限只投到上限并说明 ⑥ 结束列「公司·岗位」 ⑦ 看过不合适 60 天不再看（JD 变 / 简历或方向变则重看） ⑧ 首批试投 2 条拍板人在场、Lever 暂停 ⑨ ADR S3 账本加链接与「可能已提交」字段、S4 jobs.db 迁 182 条入账本核数后原样搬归档不删、S9 历史迁入作为正式运行硬前置。
- 授权范围：小修包完成并验收后，builder 按 DESIGN 5 包接续施工；每包 verify 可推 + lead 干净副本复验全绿即推送并知会（关卡 11 推送规矩）。真投递（含首批 2 条试投）仍每批必问。
- Round 5 (arnold-builder 回报): 小修包 4 提交 `072f203` P2 隐私 / `7cd693c` Ashby 旧词→crashed + 三驱动绕契约守卫 / `d326b17` Ashby 存活改公开接口 / `29e6147` demo:check Mac 假 0；文档 `150d1df`，施工记录 `_BUILD_NOTES.md`。325→336 绿，CI 四步 0。偏离：结局词选 crashed 非 unknown。新发现未修：preflight 36 秒、Ashby 接口无超时、未公开直链 Ashby 岗可能误判下架、第 4 项测试 Linux 上改前也绿。
- Round 5 lead 独立复验：干净 worktree 检出 `150d1df`，npm test **336/336 pass 0 fail**，role_guard_smoke 0、public_alpha_gate 0、node --check 全过。属实。
- Round 5: 派 arnold-verify 验收小修包（含 crashed 偏离判断、新发现定级）。verify 判可推 → 按关卡 11 推送并知会。
- Round 5 推送（arnold-ops）：文档提交 `0b51484`，连同此前 10 个本地提交共 11 个普通推送上 origin/main，`987a4f0` → `0b51484`，推后与远端无领先/落后。
- Round 6 (arnold-architect 回报): DESIGN 第 2 轮修订（Iterations 2）。ADR-S6：点提交前出口表（`driver_contract.PRE_SUBMIT_EXITS`，读码确认）判 `may_have_submitted=false`，不算投过、不占 60 天名额与日额度；同岗 60 天内失败满 2 次两道闸都拦（账本推导，不写看过记录）；单次运行上限 max(3, 可投数)；点提交后崩溃 / `driver_exception` 仍 true 永不再投。S1 并入 essay_pending 剥问答+锁 600、Ashby 回包形状不对→uncertain、Ashby 15 秒超时。与定稿「投过（含 unknown）永不再投」字面冲突，见 DESIGN 未明点 12，待拍板人确认措辞。
- Round 6 (arnold-architect 回报): DESIGN 第 2 轮修订。ADR-S6：确认发生在点提交前的失败不算投过、不占名额；同岗 60 天满 2 次拦下；单次运行累计 max(3, 可投数) 停；点提交后崩溃 / driver_exception 仍「可能已提交」永不再投。S1 最终清单 7 项（含 verify P2 essay_pending、P3 Ashby 回包形状、15 秒超时）。与定稿字面冲突见未明点 12（待拍板人确认）；未明点 6 D10 第一版简化（名单公司合格不自动投、交拍板人）待 S5 前确认。
- Round 7: lead 裁决未明点 4（只迁驱动真跑过的）、5（施工中核对）、7（拿不准按可能已提交）；派 arnold-builder 施工 S1+S2（重试上限做成单一常量，待拍板人确认未明点 12）。
- Round 7 (arnold-builder 回报): S1+S2 共 9 个代码提交 `07abffd`..`22bc56e`，未推。测试 336→404 全绿，CI 四步本地 exit 0。沙箱拷贝上迁入核数 182=182（另迁 33 条驱动跑过的跳过行，28 条不迁）。偏离 8 条已申报，最要紧的一条：推导改为「出口表外一律可能已提交」，所以 GH/Ashby 卡在缺信息的岗位也算投过。常量 `PRE_SUBMIT_RETRIES_60D=1`。真实家目录零写入；`--apply` 等 lead 执行。详见 BUILD_NOTES「第 2 次召唤」。
- Round 8 lead 独立复验 S1+S2：干净 worktree 检出 `0638a41`，npm test **404/404**，role_guard_smoke 0、public_alpha_gate 0、node --check 全过。属实。派 arnold-verify 验收（重点：builder 偏离 1「表外一律可能已提交」致缺信息岗永不再投的代价）。
- Round 9 (arnold-verify 回报): **回炉 3/5**。P1（本批引入）：偏离 1 使缺信息岗算投过，实跑「补信息再投」回路断、10 家卡缺信息吃光当日额度；历史 182 条已投中 41 条（22.5%）是补信息再投成功的。改法：`deriveMayHaveSubmitted` 按页面错误清单证据判 false（约 10 行）。P2（既存）：job_report 把答案原文写进 644 的 reports/jobs/*.md。其余（偏离 2/3、账本字段、迁入 182=182 幂等、最坏意图场景、16/16 突变）全过。
- Round 9: lead 让 builder 回炉第 1 轮（P1 + P2），其余不动。
- Round 8 (arnold-builder 回炉第 1 轮): `5284ff5` 页面列出必填项错误的 needs_user/rate_limited 判未投过（补信息回路、额度两条红测试转绿）；`180a640` job_report 剥掉表单答案、reports/jobs 锁 600。测试 404→409，CI 四步 exit 0，未推。S3 规则 6 落地前不得真跑 apply_batch 放量（BUILD_NOTES 已写明）。
- Round 10 (arnold-ops 推送): 文档提交 `8af3fbe` 推上 origin/main（`0b51484`→`8af3fbe`，共 14 个提交，fast-forward，无 force）。`git status -sb` 无 ahead/behind。本行未提交。
- Round 11 (arnold-builder 第 3 次召唤 S3+S4): 10 个代码提交 `10d78de`..`e0b763a` + 文档提交，未推。测试 409→448，CI 四步 exit 0。V1 端到端离线测试通过：同一批岗连跑两次，第 2 次打分 0、派单 0、账本不增。规则 6（缺信息且档案没变就拦）已落地并有 e2e。名单 slug 公开接口实测 21/22 家可用（Kapwing 是 Lever 跳过；另 6 家两平台都 404）。偏离 13 条已申报，要紧的：下架/缺信息的看过记录由 stream_run 写（JD 指纹只在批次文件里）；流式模式跳过会把分数留在家目录的三样报告。沙箱真实数据试跑：未迁历史拒绝开跑 → 迁入 182=182 → 21 块板 19 秒扫完 → 1 个被历史拦下。放量仍需 lead 跑 backfill-legacy --apply + S5 编排改写。本行未提交（TASK 里有 lead 未提交的改动）。
- Round 12 (arnold-builder S3+S4 回炉第 1 轮): `5af0d81` Runway slug 改为 runway-ml（其余 20 家核对无误）/ `e80046e` 名单板 404 列名 / `033f48f` 运行级互斥（有没收尾的运行或活着的派单锁就拒绝开跑，`--abandon` 显式放弃）/ `8865f00` 补记的可能已提交进报告；按 lead 裁决 B 固定验收口径。测试 448→453，CI 四步 exit 0，未推，本行未提交。
- Round 12 (arnold-verify 第 4 轮): **回炉 3/5**。零重复投递 15 场景全过；真 bug：P2 并发两窗口互删运行、P2 watchlist `runway` 认错公司（财务软件）、P3 名单 404 静默、P3 开跑补记的可能已提交不进报告。「合格未投下次重打分」与定稿「零重复打分」字面冲突。
- Round 12 lead 裁决：选 B——不加「合格未投」记录（等于重建拍板人否掉的岗位队列），定稿措辞改为「零重复投递 + 已判不合适零重复打分」（拍板人原话只针对重复投递）；已改 docs/specs/restart-apply.md。builder 回炉修 4 处。
- Round 12 旁注：拍板人要求先看 22 家岗位，lead 只读拉取公开接口 562 岗、粗筛后给了链接清单供其手投（未含 Runway，故认错公司未波及）。拍板人手投的岗位待其告知后记入账本。
- Round 13 (arnold-ops 推送): 文档提交 `11352e4`（TASK / VERIFY_REPORT / specs 定稿），父提交 = `cac8083`，已推；origin/main `8af3fbe` → `11352e4`（快进，无强推）。本行未提交。
- Round 14 (arnold-builder 第 4 次召唤 S5): 12 个提交 `7a7af88`..`64bc3c1`，未推。测试 453→477，CI 四步 exit 0。① 运行锁：先建目录再 O_EXCL 建锁，10 轮并发红测试（旧码第 2 轮双开）转绿；派单锁按命令行判活，PID 复用当陈旧锁接管，拒绝提示写明 kill / 删锁出路。② D10 第一版：名单公司合格 → held_for_review、第 1 行列「公司·岗位·链接」、7 天不重报；`start --release <链接>` 放行。③ 手投登记 `submission_ledger.mjs record-manual`（默认试跑，outcome manual_submitted / reason reported_by_user，不加新字段）。④ preflight 只核库里有的行（原来真跑会被历史行拦下整批）；看板改数账本；install_watchlist / retire_jobs_db 两个新 CLI 默认试跑；onboard 第 4-7 步改写、jobskill 与两份 -auto 同步。沙箱真实数据走查：迁入 182=182 → 归档 → 装名单 21 家 → 名单扫描 602 岗 → held 2 个、派单 0 次。偏离 12 条申报，真跑前清单 10 步见 BUILD_NOTES「第 4 次召唤」。真实家目录零写入。本行未提交。
- Round 15 (arnold-builder S5 回炉第 1 轮，verify 第 6 轮 3/5): 4 个提交 `b669201`..`293169c`，未推。R9 held 改按公司认（与来源无关）；R6 record-manual 公司从链接 slug 推、--company 只核对；STALE2 清残留锁放进 O_EXCL 认领段，15 轮并发 0 双开；清单第 5/7/10 步改（第 7 步用探针库不重建 jobs.db，第 10 步 --once）。测试 477→481，CI 四步 exit 0。新观察：高负载下 1 次记账子进程被判非 0（疑被信号杀，按 record_failed 停批，不重投），未再现。本行未提交。
- Round 16 (arnold-builder S5 回炉第 2 轮，verify 第 7 轮 3/5): `ed18bf3` runTee 等结果文件写完再交记账人（FLUSH P2，慢磁盘预加载红测试先行，旧码必红→绿）；`cfd2584` 子进程失败打出退出码/信号/起进程错误。全量连跑 3 次 482/482，慢磁盘下全量 482/482，CI 另三步 exit 0。同类只此一处；另列未修：emitOutcome 打印后立即 process.exit，macOS 管道下长结局行可能截断。未推，本行未提交。
- Round 16 追加 (arnold-builder，lead 指派驱动结局截断): `e20e1fc` 驱动进程 stdout 阻塞写，超长结局行不再被 process.exit 在 64KB 处截断（红测试：真管道 ~900KB 结局行，旧码 macOS 截断）；仍同步退出，未采用 exitCode 方案（会让 emitOutcome 之后的代码继续跑）。全量连跑 3 次 484/484，CI 另三步 exit 0。未推，本行未提交。
- Round 16 追加 2 (arnold-builder，lead 复验 d341de7 偶发 exit null): 根因 = NODE_USE_SYSTEM_CA=1 下 Node 24.7 后台读钥匙串证书与 process.exit 抢 OpenSSL → SIGSEGV（最小脚本负载下 30/400，去掉变量 0/400）；也会让记账人写完账后「失败」→ 停批 + 补记可能已提交。`9178eb6` safe_exit：退出前先读完系统证书，驱动/记账人/apply_batch/stream_run/supervisor 安装；对照 33/800 → 0/800。emit_outcome_flush 循环 50 次：旧 7/50 → 0/50；全量连跑 3 次 486/486，CI 另三步 exit 0。未推，本行未提交。
