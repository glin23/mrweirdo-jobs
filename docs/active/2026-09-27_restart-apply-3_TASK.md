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
