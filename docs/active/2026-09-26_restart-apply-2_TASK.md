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
