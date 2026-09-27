---
Topic: restart-apply-2
Created: 2026-09-26
Status: in_progress
Owner: arnold-lead
Updated: 2026-09-26
Type: feature
Parent_task: docs/active/2026-09-25_restart-apply_TASK.md
Depends_on: none
Blocks: none
Spawned_subtasks: none
---

# TASK — 重启投递（续）：首跑前收尾

续 `docs/active/2026-09-25_restart-apply_TASK.md`（该档 VERIFY_REPORT 已到 11 轮上限，后续验收记在本 topic 的 VERIFY_REPORT）。

## 现状（2026-09-26）
- 真跑前清单 1-4 步、0 步（重新引导）、6 步（名单 21 家 + watchlist_only）已完成；拍板人确认解析窗口中。
- 账本 `correct` 子命令（10ec8b7 029d522 f828014）verify 4/5 可推，另报 P3（更正可指向真投过的行，建议 `--url` 核对）、P4（`--evidence --apply` 吞参）。
- **阻塞**：新 search_intent 下 21 家硬筛只剩 3 个岗（此前按岗位类别粗分增长/市场/运营/产品有 154 个）。

## Round 1
- 派 arnold-bug 查硬筛为何只剩 3 个；派 arnold-builder 修 correct 的 P3/P4。verify 第 11、12 轮正文补记到 `docs/active/2026-09-26_restart-apply-2_VERIFY_REPORT.md`。
- [arnold-bug] 硬筛只剩 3 查清：21 家 601 岗 → 排除词 193 / 地点 99 / 岗位类型 306 → 3（复核一致；再过去重闸实际 0）。主因 role_types.mjs:52 普通全职判 other，new_grad_FT 只认标题含 New Grad；配置改不动，需改代码（放宽后美国增长类约 16 个）；另发现地点筛放行约 100 个非美国岗。详见 `docs/active/2026-09-26_restart-apply-2_BUG_REPORT.md`。
- Round 1 结果 (arnold-builder，correct P3/P4): `b75cb6e` correct 必填 `--url`（按岗位指纹与目标行比对，对不上拒绝）、证据 ≥10 字；参数值缺失或以 `--` 开头即拒（record-manual 共用）。`8151f81` 说明书 + CHANGELOG。红测试 2 条先红后绿。全量连跑 3 次 510/510，CI 另三步 0，未推，真实家目录零写入。本行未提交。
- 关卡 1（拍板人 2026-09-26）：原话「行，3年以上的跳过」——应届全职口径放宽为「非资深普通全职且 JD 未要求 ≥3 年」，≥3 年跳过。派 builder 改 role_types 口径 + 地点筛（非美国岗放行约 100 个）。
- 拍板人确认解析窗口（原话「是的」）：6 月旧值 requires_sponsorship_now=false、salary_expectation_usd=$20/hr 保留不改。
- builder 完成 correct P3/P4（b75cb6e 8151f81 2e7b9f2，510 绿，未推）；接着做 role_types 口径 + 地点筛。
- Round 2 结果 (arnold-builder，应届全职口径 + 地点筛): `c805b93` new_grad_FT = 非资深全职且 JD 未写 ≥3 年（Manager 不算资深，依据 BUG_REPORT 16 岗名单；无雇佣类型字段按全职；下游经 role_types 一处自动一致；旧断言 6 处改动见 BUILD_NOTES 第 6 次召唤）；`1e43bfc` 地点筛只放美国/美国远程，外国一律拦、认不出的拦（location_unrecognized）、附加地点与结构化国家纳入，裸 Remote 放行（其他地点全在国外则拦）；`e18a39b` FullTime+Freelance 不算全职；`46cde61` 文档。真实拷贝复跑：601 → 进打分 **85**（非预期 16：硬筛不看方向，按标题粗分增长/市场/产品类约 31）；首个命中：排除词 193、地点 154（全外国，未知 0）、资深 93、≥3 年 65、类型不符 11。全量连跑 3 次 526/526，CI 另三步 0，未推。待决：是否加方向预筛省打分额度。本行未提交。
- [arnold-ops] 推送：origin/main ef4119d → 2e7b9f2（快进，无 force；c805b93 之后未推）。
- [arnold-ops] Creatify 更正：追加 cor_1790465143311_169_6ce81b（更正 led_1790453329601_169_3799e7 → not_submitted），账本 215→216，前 215 行未变；投前闸只读检查：Creatify 放行、60 天次数 0；OpusClip b3ac1b13 仍被 already_attempted_fp 拦。本行未提交。
- Round 3 结果 (arnold-builder，concierge 偶发 exit null): `f215d49` 根因 = node -e 引 paths.mjs 走 exit(3) 与读证书抢（CA=1 8/400，关掉 0/400）；paths.mjs 引 safe_exit，守卫扩到含 process.exit 的模块 + 测试 node -e 子进程必须预加载；该测试 CA=1 循环 200 次 0 失败。全量连跑 3 次 528/528，CI 另三步 0，未推。本行未提交。
- Round 4 结果 (arnold-builder，B 回炉 verify 第 13 轮): 年限补「3-5+ / 5–10+ / 2 or 3 / , ideally」、preferred 只认紧挨标注与 Nice to have 段；store_scored_jobs 入库记否决（打分器或带 JD 重判为 other 即 other），derive 视库里 other 为否决——Luma PM Growth 链路 store→recompute→validate 全拒；排除词不分连字符、excluded_functions 的工程/研究在硬筛拦、带人经理算资深、标题点名外国城市即拦。真实拷贝复跑 601 → 进打分 **45**（实习 3 + 应届 42），较 85 去掉 40 = 工程研究 27 + 资深 12 + 非美国 1，应届 42 零误杀。首个命中：排除词 270、地点 140、资深 77、≥3 年 60、类型 9。全量连跑 3 次 543/543，CI 另三步 0，未推。本行未提交。
- Round 5 结果 (arnold-builder，B 回炉第 2 轮 verify 第 14 轮): `08d8f5d` 打分器标签入库前规范化，非法值（senior 等）记 other、不可投、原因 role_type_label_invalid；senior/full_time/Other × 5–10+ 年链路全拒，full_time+应届照常可投。`20fda73` 年限区间不跨行；标题市场词在有具体美国地点时不当上班地，New Mexico / Lima, Ohio 判美国。真实拷贝复跑 601 → 45（与上轮集合完全一致，42 应届零误杀）。全量连跑 3 次 551/551，CI 另三步 0，未推。待拍板：UX Researcher / Prompt·Automation·Martech Engineer 是否放行。本行未提交。
- lead 复验 tip `c1b3b36`：全量连跑 3 次 551/551，CI 另三步 0。verify 第 15 轮可推 4/5。挂账 P3（lead 定：暂不修，下一包带上）：打分器标 part_time 时 recompute 翻回可投，但投前校验拦下记「需要你处理」，不会真投。
- [arnold-ops] 推送：文档提交 `f42ef11`（TASK/BUG_REPORT/VERIFY_REPORT + 09-25 TASK）；fetch 无分叉（领先 17 落后 0），普通 push，origin/main `2e7b9f2` → `f42ef11`；隐私扫描（邮箱/电话/签证号）0 命中。本行未提交。
- Round 2（首次真环境试跑，--no-submit，拍板人批准）：run stream-2026-09-27T01-31-59-257Z-91384，21 家 601 → 45 进打分 → 合格 8；0 投递，账本仍 216 行。3 行报告正常。发现：--no-submit 模式 finish 的 held 列表为空（合格名单岗不列链接），lead 从公开接口补链接。合格 8：OpusClip AI PM Intern 8、ElevenLabs Social Growth Strategist 7、Tavus Vibe Growth Marketer 7、Creatify PM Intern 7、Synthesia Marketing General Application 6、Suno Social Media Community Manager 5、ElevenLabs Marketing Operations 5、Tavus BDR 5。
- 关卡 2（拍板人 2026-09-27）：真投递批准——「8 个全投」（含 ElevenLabs、Tavus 各 2 个，用满其 60 天名额）；先投 OpusClip AI PM Intern + Tavus Vibe Growth Marketer 2 个、拍板人在 Chrome 前看，确认成功再投其余 6 个。另提问 networking（联系 manager/员工加 LinkedIn）。
- Round 3（首次真投尝试，release OpusClip + Tavus Vibe Growth）：submit-scores 时 apply_batch 的 supervisor_preflight 失败——role_guard_smoke.mjs:173 期望 validate_auto_row row 2 失败却通过（疑继承真实环境 MRWEIRDO_ROLE_TYPE_TARGETS=intern,new_grad_FT）。**0 派单、0 提交，账本 216 行不变**；已 finish 关闭运行。派 builder 修 smoke 环境隔离。
- Round 6 结果 (arnold-builder，首次真投 preflight 阻塞): `2bff44b` 根因 = role_guard_smoke 继承调用方 MRWEIRDO_ROLE_TYPE_TARGETS=intern,new_grad_FT（带变量 exit 1 / 不带 0）；smoke 开头清掉全部 MRWEIRDO_* 再设沙箱变量，回归测试 4 组调用方环境旧码全红→绿；preflight 其他项本意读真实环境，无同类问题。真实拷贝带 role targets 跑 preflight：role_guard_smoke OK（仅 queue_nonempty 因空探针库失败，预期）。全量连跑 3 次 555/555，CI 另三步 0，未推。本行未提交。
- Round 4（首次真投，smoke 修复 2bff44b/7f11e9d 后；lead 复验 555/555 ×2，verify 第 16 轮可推 4/5）：run stream-2026-09-27T02-11-48-602Z-28171。结果 **投出 0**：
  - OpusClip AI PM Intern：needs_user（essay_pending）——2 题未答：RTO/办公地点（note relocation_commitment_policy_unset）、AI 作品开放题（no_bucket）。账本 unknown / may_have_submitted=false，可重试。附件 cover letter 已生成。
  - Tavus Vibe Growth Marketer：not_submitted——截图为 Ashby「We couldn't submit your application — flagged as possible spam」。账本 may_have_submitted=true（按设计 not_submitted 算投过），该岗被永久封、占 Tavus 60 天 1 次。**结构性风险**：Ashby 反垃圾/机器人检测拦自动提交，名单 21 家中 17 家用 Ashby；绕过检测属禁止事项，不做。
  - 报告第 2 行把 Tavus 写成「判不确定」，与页面明说失败不符（P3）。
  - 剩余 6 个（均 Ashby）暂停自动投，待拍板人定策略。
- Round 7 结果 (arnold-builder，首次真投投出 0 的三处): `8259257` 全美可搬 + 岗位在美国 → RTO/搬迁题自动答 Yes（原函数只认 anywhere_legal_work；岗位地点从工作库读，国外/未知仍照问）；`070d7a8` 「用 AI 做过/试过什么」按 essay_profile 故事逐字起草（真实 essay_profile 暂无 AI 视频实验故事，现选 R2W；追加该故事的 JSON 见 BUILD_NOTES，需 lead 在拍板人知情下写入）；`7ef0ac3` 反垃圾拦截即终局 not_submitted/platform_spam_flagged，Ashby 无缺字段时只重读不再点提交；常量 SPAM_FLAGGED_MAY_HAVE_SUBMITTED=false（不占 60 天名额与档位），同岗 60 天不自动重投；报告第 2 行如实写。全量连跑 3 次 570/570，CI 另三步 0，未推。待定：Ashby 出现反垃圾后是否整批停投。本行未提交。
- Round 5: builder 修三件（8259257 RTO / 070d7a8 AI 开放题桶 / 7ef0ac3 spam 横幅终局 platform_spam_flagged、不占名额、同岗不自动重投），570 绿。lead 裁决「出现拦截后是否整批停投」：不整批停（反垃圾是各公司各自设置；既有连续失败熔断兜底），不做任何绕过检测的改动。lead 在拍板人知情下（已看过草稿并说「全部帮我投」）往 essay_profile.project_stories 追加 AI 视频实验故事（逐字取自简历），先备份 .bak.20260927，验证 ok。拍板人：全部自动投、不点任何东西。
- Round 8 结果 (arnold-builder，verify 第 17 轮回炉): `0b93ac2` 题目点名美国以外地点一律照问（伦敦/柏林/多伦多/UK），点名美国按全美可搬答，不点名才看岗位地点；spam 免名额只认判定器 not_submitted，成功+spam 双命中 = unknown 占名额；Greenhouse 无缺字段读不懂时只重读不再点提交。全量连跑 3 次 575/575，CI 另三步 0，未推。本行未提交。
- Round 6（真投 7 个，run stream-2026-09-27T03-41-01-577Z-7047；builder 0b93ac2/98018e6 修 London RTO + spam/成功双命中 + GH 盲点，verify 第 18 轮 4/5，lead 复验 575×2）：
  - **Synthesia Marketing General Application 投成**（截图 + Ashby 确认邮件 04:48 UTC）——重启后第一条真投成功。
  - ElevenLabs Social Growth：needs_user（Location / How did you hear / 管理过的社媒账号与角色 / 点评 ElevenLabs 两个社媒账号）。
  - Suno：needs_user（5 天 NYC 到岗 / 社群管理年限 / 做过哪些品牌）。
  - Tavus BDR：platform_spam_flagged（Tavus 两岗皆被拦）。
  - OpusClip / Creatify / ElevenLabs Marketing Ops：unknown no_errors_no_success **且无截图**；Gmail 无确认邮件。派 arnold-bug 只读查因。
- Round 7: arnold-bug 查明 3 个 unknown 一份没发出（简历上传未完成就点提交、Ashby 不接，点击后零网络请求；unknown 分支漏截图 ashby:1124 / gh:1838）。拍板人拒答表单小问题、回「继续」→ 记入记忆：缺信息按简历/已答事实选保守真实默认值、不逐题问。lead 用 correct 把 OpusClip / Creatify / ElevenLabs Mkt Ops 三行 + Tavus Vibe Growth（spam 横幅明说未收到）改 not_submitted（dry-run 后 --apply，带证据）。派 builder 修上传竞态、全分支留证、缺信息题自动作答。
- Round 8: builder fa9c012..03f1255（上传竞态：等上传+请求稳定再点、无回应再点一次、仍无记 submit_click_not_registered；终局全留证；how_did_you_hear / years / social_accounts 答案桶 + NYC 到岗桶 + agent_drafts 起草通道；613×3）。派 verify 第 19 轮 + lead 复验。lead 按记忆「不逐题问」写入 profile（先备份 .bak.20260927b）：how_did_you_hear="Company website / job board"（沿用旧键值）、years_social_media_experience="1"（简历推断，保守）、social_accounts_managed=[X @LeeLinAI123 个人号 / One2X TikTok·IG·X（url 空，未知不编）/ COR 小红书（url 空）]；验证 ok。派 general-purpose 基于 ElevenLabs 公开内容起草 3 道点评题。
- 拍板人（2026-09-27）：开放式问答题要一起写，原话「这个 Eleven Labs 这种的话还是我们一起写吧……如果都是有这种题的话，我就还是自己写一下比较好」→ ElevenLabs Social Growth 暂停自动投（agent_drafts.json 里已存 3 条草稿，下次运行不得 release 该岗，定稿后再投）。已记入记忆。
- verify 第 19 轮 **回炉 3/5**：P2「再点一次」两处可致重复投递（在途请求被判没接住；再点时找不到按钮记 may_have_submitted=false）。**修好前禁止任何真投。** builder 回炉中。
- 关卡 3（拍板人 2026-09-27）：分工改为——目标公司（21 家 AI 视频，尤其 OpusClip/Creatify/ElevenLabs/Suno）拍板人**自己手投、自己写题**；非目标小公司交程序自动投走量。lead 已给 7 条链接；承诺定期查 Gmail 确认邮件自动 record-manual。待拍板人确认非目标范围（推荐：GH/Ashby 上 AI 应用类创业公司的增长/市场/社媒/运营/产品，实习 + 应届，≥3 年跳过，日上限 10），先 --no-submit 试跑再真投。
- verify 第 20 轮再回炉：CDP 断开时 clickwatch 报 0 请求 → 再点，真 Chrome 实测服务端已收到仍再点。「再点一次」连续 3 轮出重投风险，lead 失速自查后裁决：**砍掉自动再点**，一律只点一次，判不出记 unknown（可能已投），保留上传完成闸；unknown 由 lead 查 Gmail 确认邮件后用 correct 兜底。派 builder 执行。
- 拍板人（2026-09-27）「行，按你推荐的范围来」：非目标自动投 = GH/Ashby 上 AI 应用类创业公司的增长/市场/社媒/运营/产品，实习 + 应届，≥3 年跳过，日上限 10。lead 执行：search_intent 备份 .bak.20260927 → install_watchlist --mode watchlist_first --apply（21 家名单仍 held 给拍板人手投）→ industry_targets 加「AI Application Startups」。验证 ok。下一步：自动再点砍除修复验收后，--no-submit 试跑给拍板人看规模。
