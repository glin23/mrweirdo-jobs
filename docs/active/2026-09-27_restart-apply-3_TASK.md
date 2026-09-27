---
Topic: restart-apply-3
Created: 2026-09-27
Status: in_progress
Owner: arnold-lead
Updated: 2026-09-27
Type: feature
Parent_task: docs/active/2026-09-26_restart-apply-2_TASK.md
Depends_on: none
Blocks: none
Spawned_subtasks: none
---

# TASK — 重启投递（续 3）：提交只点一次收口

续 `docs/active/2026-09-26_restart-apply-2_TASK.md`（其 VERIFY_REPORT 到 11 轮上限，第 21 轮起记在本 topic 的 VERIFY_REPORT）。

## Round 1
- verify 第 21 轮回炉 3/5：补字段再提交时服务端慢于 7 秒、页面残留旧报错 → 原样残留记 needs_user 不算投过、部分残留点第 3 次（两驱动实测）；守卫测试未覆盖补字段再提交。修法：第 2 次起，页面所列缺字段全是上轮已补过的 → unknown、不再点。派 builder 修。
- Round 1 结果 (arnold-builder，补字段再提交): `5bb409c` 两驱动总点击 ≤2：第 1 次被拒后全部补上才点第 2 次，补不上直接 needs_user 停；第 2 次后页面只列已补过的字段（原样/部分残留）→ unknown 算可能投过、截图、停，列出新字段 → needs_user 停；不点第 3 次。守卫测试覆盖慢服务端残留、部分残留、新字段、7 种序列。全量连跑 3 次 646/646，CI 另三步 0，未推，真实家目录零写入。
- [arnold-ops] 推送：文档提交 `33e1048`（09-26 BUG_REPORT/TASK/VERIFY_REPORT + 09-27 VERIFY_REPORT + specs restart-apply/restart-apply-3；09-25 restart-apply_* 无改动未入）；隐私扫描邮箱/电话 0 命中（数字命中均为账本行号）；fetch 无分叉（领先 21 落后 0），普通 push，origin/main `f42ef11` → `33e1048`。本行未提交。
- verify 第 22 轮可推 4/5、真 bug 0；lead 复验 f03a2ff 646×2。派 ops 推送（含文档）。建 docs/specs/restart-apply-3.md 指针（结论并入 restart-apply.md「补充拍板」）。
- Round 2: 非目标范围 --no-submit 试跑 run stream-2026-09-27T18-56-11-600Z-3958（watchlist_first，本次最多 9）。第 1 批 41 个为名单公司（search_intent 今天改过 → 依据版本变，名单岗重新打分，符合定稿「方向变则重看」）。
- Round 2 结果：名单 41 打分 → 合格 4（OpusClip AI PM Intern 8 / ElevenLabs Social Growth 7 / Tavus Vibe Growth 7 / Suno 5，均 held 给拍板人）；轮转池 1000 → 硬筛 208 → 本次打 49（打分预算 N×10=100 用尽）→ 合格 2（Prior Labs Founder Associate NYC 6；Sequence GTM Associate 6）。不合格主因：方向不对口 24、非 AI 应用 7、年限 7（打分器把 1-3 年也判了不合格，疑过严，与「≥3 年才跳过」口径不一致）、签证 6、其他 3。0 投递。**结论：非目标自动投产出率约 4%，硬筛放进大量方向不对口岗，打分花费大。**
- 关卡（拍板人 2026-09-27）「行，先改，这两个先投」：派 builder 做 ① 方向预筛（function_mismatch）② 1-3 年不判不合格 ③ release 支持非名单 GH/Ashby 链接（当前 release 只扫名单，Prior Labs / Sequence 无法 release）。两条待投：Prior Labs Founder Associate (NYC) https://jobs.ashbyhq.com/prior-labs/1e0d43ae-26b1-4b59-a28f-cb1f35a8b576；Sequence GTM Associate https://jobs.ashbyhq.com/sequence/a755e204-d28e-4894-8364-b849664766c5。拍板人再次要目标公司链接自己投。
- 关卡（拍板人 2026-09-27）原话「好了，这些我会自己投，然后其他的你就帮我投吧」→ 目标 7 条拍板人手投；**非目标自动投获常设授权**（日档位 10；超 30 仍须拍板人点头；删除仍必问）。修复验收后先投 Prior Labs + Sequence，之后按日跑非目标，跑完报 3 行结果；lead 定期查 Gmail 确认邮件，为拍板人手投的目标岗 record-manual。
- 拍板人手投完成（2026-09-27 19:35-19:39 UTC）：OpusClip AI PM Intern、Tavus Vibe Growth Marketer、Tavus BDR（三封 Ashby 确认邮件）、Creatify PM Intern（拍板人称已投，Gmail 暂无确认）。lead record-manual 4 条（dry-run 后 --apply，账本 229→233）。ElevenLabs ×2、Suno 拍板人还在想开放题，暂未投。Tavus 60 天 2 次名额已满。
- ops 推送（2026-09-27）：文档提交 36fb52b（验收第 23 轮、手投登记记录，隐私扫描 0 命中）；fetch 无分叉（领先 5 / 落后 0），普通 push origin/main 33e1048 → 36fb52b，未 force。
- Round 3（真投 Prior Labs + Sequence，run stream-2026-09-27T20-44-00-192Z-98439；专用 Chrome 此前已关，lead 用 launcher 重开）：**0 投递**。打分预算 20 被 20 个名单岗（提示词改版后重打）用光，两条非名单放行岗未进批次；报告却写「可能已下架」（不实）。名单合格 6 held：ElevenLabs Social Growth / Content Creator & Strategist / Influencer Marketer / Sales Development US、Suno Social Media CM、Runway Customer Education Specialist。派 builder 修 release 优先级与报告措辞。
- Round 4（真投，bc3d070 修 release 后；verify 第 24 轮 4/5，lead 复验 663×2）：run stream-2026-09-27T21-10-13-835Z-26218。**Sequence GTM Associate 投成**（截图 + Ashby 确认邮件 21:13 UTC，邮件称 BDR 岗）。Prior Labs Founder Associate：unknown/no_errors_no_success，截图显示多项必填空着（含反自动化题「Are you an LLM?」）→ lead 以截图为证 correct 为 not_submitted；建议拍板人手投。挂账：驱动为何没填这些字段就判 unknown；「Are you an LLM?」类反自动化探针题应视为平台明确不欢迎自动提交 → 转手投，不自动作答（待 builder）。
- 拍板人（2026-09-27）：① 要求表单遇「Are you an LLM / 你是 AI 吗」答「不是」（理由：agent 代表他本人操作）——**lead 拒绝**：该题是平台用来识别自动化提交的探针，由自动化程序答「不是」属于绕过平台检测，列入禁止事项；改为此类岗转拍板人手投（他本人作答是真实的）。② 原话「你要给我投很多个，投50个」——视为超 30 档的明确点头（本批），按 tier 50 + --confirm-tier-over-30 跑非目标。
- Round 5（50 档真跑 run stream-2026-09-27T21-20-17-963Z-30050，本次最多 44）：批 1 名单 4 → 合格 2 held（Pika PM 6、Luma Talent Community 5）；批 2 轮转 50 → 合格 5（Prior Labs ×2 lead 手动改 recommended=false 转手投〔反自动化探针题〕，Rillet Founders Associate 6、Reevo Forward Deployed ×2 5、Prophia APM 5）→ 自动投中。
- 拍板人要求非目标所有问题直接代答、可用本机知识库。lead 派 general-purpose 从 ~/Areas/知识库、简历、个人 IP、项目 README 整理 essay_profile（12 条故事、hard_no_claims 17 条），备份 .bak.20260927b 后替换，验证 ok。不读 Immigration/Offers/School-Records/Life；不写雇主内部数据。数字冲突待拍板人：R2W 简历 200+ vs 旧 hard_no_claim「拍板人确认只写 100+」；简历「created」百万播放视频，拍板人自述只是选题发布。
- Round 5 结果：**Prophia Associate Product Manager 投成**（Greenhouse，截图 submitted）。Rillet unknown（必填全空，lead correct 为 not_submitted）；Reevo ×2 needs_user/stuck_on_same_missing（still_missing 空）。lead 发现系统性问题：多个 Ashby 表单只填到简历就停（Prior Labs、Rillet 同症状）→ **暂停 50 档运行**（finish，已投 1），派 arnold-bug 只读查因。累计投成：程序 Synthesia / Sequence / Prophia；拍板人手投 OpusClip / Tavus ×2 / Creatify。
- 拍板人（2026-09-27）原话「写200+，修好继续投」：essay_profile R2W 用户数统一 200+，hard_no_claim 改为上限 200+（备份 .bak.20260927c）。
- [arnold-bug] Ashby「只填到简历就停」查因（只读）：根因 = 点提交时文本框自动保存（ApiSetFormValue，500ms 防抖）仍在途，Ashby 前端「正在更新」闸吞掉点击、提交请求从未发出（两现存标签页实测：无 ApiSubmit* 请求、点击时刻有保存在途）；fa9c012 只等简历上传，覆盖一半。unknown 误判因「点击后任何请求都算接住」。Reevo 的 still_missing 空 = stuck 出口字段叫 missing；补不上的是城市多选题，薪资数字框填文字假成功。详见 2026-09-27_restart-apply-3_BUG_REPORT.md。
