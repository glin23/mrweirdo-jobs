---
Status: done
Owner: arnold-bug
Type: bug_report
Reads:
  - docs/active/2026-09-26_restart-apply-2_TASK.md
  - ~/.mrweirdo-jobs/search_intent.json（只读；复现用 scratchpad 拷贝）
  - shared/discover_candidates.mjs / shared/role_types.mjs / shared/sourcing/dispatcher.mjs / shared/sourcing/watchlist_source.mjs / shared/stream_run.mjs / shared/eligibility.mjs
  - test/role_types.test.mjs
Blocks: restart-apply-2 首跑（21 家只剩 3 个岗）
Updated: 2026-09-26
---

# BUG_REPORT — 21 家名单公司 601 个岗，硬筛后只剩 3 个

> 证据标注：**[实测]** = 今天在拷贝上真跑出来的数字；**[读码]** = 读代码得出的结论；**[推断]** = 用我自己写的粗规则估出来的，没有逐条人工核对。
> 安全：真实 `~/.mrweirdo-jobs` 没写过。拷贝放在 `<scratchpad>/home`（没拷 chrome-profile），跑的是
> `MRWEIRDO_HOME=<scratchpad>/home node shared/discover_candidates.mjs --run --sources watchlist --source-window-size 0`，
> 和 stream_run.mjs:428-431 的名单扫描参数一致。只对 Ashby/Greenhouse 公开接口做了 GET。没改代码，没 commit，没投递。

## 现场（What happened）

拍板人把 search_intent 改成只扫名单（watchlist_only）上的 21 家、`role_type_targets: ["intern","new_grad_FT"]` 之后，verify 报告 21 家硬筛后只剩 3 个岗。

**独立复核 [实测]**：21 个招聘看板全部抓取成功（0 个报错），抓到 601 个岗；发现阶段按 apply_url 去重后还是 601，没有重复。硬筛留下 **3 个**，和 verify 的数字一致：

| 留下的 3 个 | 地点 | 打分前去重闸会怎么处理（[实测] 拷贝里的记录） |
|---|---|---|
| creatify / Product Manager Intern | Mountain View | 账本里 2026-05-26 已投过 → 会被拦 |
| opusclip / AI Product Management Intern | Mountain View | seen 日志今天记了 held_for_review（暂扣待看）→ 会被跳过 |
| pika / Research Intern (BS/MS/PhD) | Palo Alto | seen 日志今天记了 held_for_review → 会被跳过 |

所以**如果现在真跑一次，真正进打分的是 0 个**（[读码] stream_run.mjs:382-423 的 gate() 先查账本、再查 seen 日志；stream_run 本身没跑）。

### 各道筛子淘汰了多少 [实测]

硬筛按固定顺序判，一个岗只记第一个命中的原因（discover_candidates.mjs:315-343：先看链接能不能用 → 测试岗/过期年份 → 排除词 → 地点 → 岗位类型）：

| 顺序 | 筛子 | 淘汰数 | 单独拿这一道筛全部 601 个（不看顺序） |
|---|---|---|---|
| 1 | 链接不可用 / 测试岗 / 过期年份 | 0 | 0 |
| 2 | 标题排除词 exclude | **193** | 193 |
| 3 | 地点 location_mismatch | **99** | 158 |
| 4 | 岗位类型 role_type_not_allowed | **306** | 岗位类型分类：other（不属于任何一类）591 / intern 5 / part_time 4 / new_grad_FT 1；另有 124 个标题带资深词 |
| — | 留下 | **3** | |

排除词各项：account executive 57、software engineer 46、research engineer 19、research scientist 13、solutions engineer 13、data scientist 9、security engineer 8、recruiter 6、backend / infrastructure engineer 各 5、machine learning engineer 3、data engineer 3、frontend / ml engineer / legal counsel 各 2。

**增长、市场、社媒、内容、GTM、产品这几类岗位** [推断，按标题关键词粗分，共约 130 个；任务里说的 154 是另一套口径的粗分]：94 个死在岗位类型、28 个死在地点、6 个死在排除词（GTM Recruiter ×2、Tech Recruiter、2 个 Account Executive、Product Legal Counsel），留下 2 个。

### 被淘汰的样例（每桶 ≤10 个）[实测]

- **岗位类型 · 增长/市场（55）**：runway Event Marketing Manager、runway SEO / AEO Manager、lumaai Product Manager, Growth、elevenlabs Growth Marketing - Consumer App Channels、elevenlabs Brand Marketing、elevenlabs Marketing Operations、mirage Growth Marketing Manager、suno Growth Marketing Manager, Conversion、tavus Vibe Growth Marketer、descript Field Marketing Manager
- **岗位类型 · 社媒/社区（14）**：elevenlabs Influencer Marketer、elevenlabs Social Growth Strategist、higgsfield Reddit Community Manager、suno Social Media Community Manager、suno Paid Social Creative Strategist (Contract)、heygen Online Community Manager、lumaai Talent Community (General Application)、suno Sr. Paid Social Manager
- **岗位类型 · 内容/创作者（27）**：runway Youtube Creator & Educator、lumaai Editor + Motion Graphics、elevenlabs AI Creative Producer、elevenlabs Content Creator & Strategist、elevenlabs Creative Strategist, Mobile、higgsfield AI Creator、higgsfield Content Manager、higgsfield Video Editor
- **岗位类型 · GTM/合作/BD（26）**：elevenlabs GTM Enablement - Expansion、elevenlabs Partner Marketing Manager - North America、elevenlabs Partner Programs & Marketplace、tavus Business Development Representative、lumaai GTM Delivery Lead, North America
- **岗位类型 · 产品（18）**：lumaai Product Manager, Core Product / Enterprise / Growth、elevenlabs Growth PM、higgsfield Growth Product Manager (PLG)、higgsfield Product Manager, Lifecycle & Retention、pika Product Manager、tavus Product Manager
- **地点（这几类共 28）**：viggle Growth & Community Intern（Toronto）、synthesia Marketing General Application（London）、elevenlabs B2B Growth Marketer（Canada / Belgium / Italy 等 7 个）、black-forest-labs Field Marketing Manager（Freiburg）

## 根因（Why it happened）

**一句话**：`new_grad_FT` 这个选项在代码里的意思是「标题里写了 New Grad / Early Career 的岗」，不是「应届生能投的全职岗」。AI 视频创业公司几乎不在标题里写 New Grad，所以勾了它也基本放不进岗。

逐条说各个条件是怎么判的 [读码]：

1. **intern（实习）** — role_types.mjs:1, 41-55。标题或 employment_type（雇佣类型）字段里有 intern / internship / co-op 就算实习。这条没问题：5 个实习岗都认出来了（被刷掉的是 Creatify SWE Intern，因为命中排除词；Viggle Growth & Community Intern 在 Toronto）。
2. **new_grad_FT（应届全职）** — role_types.mjs:3, 51-52。只有标题或雇佣类型字段匹配 `new grad | new graduate | university grad | early career | recent graduate` 才算。Ashby 返回的 employment_type 大多是 `FullTime`（601 个里有 551 个 [实测]），而 `FULL_TIME_RE` 命中 `fulltime` 且没有 intern 字样时，**直接判为 other**（role_types.mjs:52）。601 个里只有 1 个被判成 new_grad_FT：Genmo 的 Research Engineer (New Grad)，还因为命中排除词被刷了。现有测试 test/role_types.test.mjs:47, 60 把「普通全职 = other」锁死了，说明这是**当初有意这么设计**的（v2.2.0，6df79ab），不是手滑写错；但这个设计和拍板人说的「投 2027 应届全职」对不上。
3. **seniority: "both"（资历）** — role_types.mjs:24-39。只要填了 role_type_targets，seniority 就**完全不看**。这次两个都填了，seniority 不起作用。另外，资深词过滤 `SENIOR_RE`（role_types.mjs:4, 68）只在岗位类型已经合格之后才判，这次没轮到它出手。
4. **role_categories（9 类岗位方向）** — **硬筛根本不用它**。discover_candidates.mjs:202-236 只把它拿来拼兼职搜索词；名单扫描这条路不看搜索词（dispatcher.mjs:90-95）。所以不存在「按字面子串匹配导致误杀」的问题。岗位方向要到打分阶段才起作用。
5. **exclude（标题排除词）** — discover_candidates.mjs:238-256。用户填的排除词加上内置的一批词，按整词、不分大小写匹配标题。在增长/市场/产品这几类里只命中 6 个，都是真该排掉的（招聘、AE 销售、法务）。**没有误杀。**
6. **地点** — discover_candidates.mjs:258-313。99 个地点淘汰逐个看过，都是美国以外的（伦敦、多伦多、欧洲各城市），属于合理淘汰。**但这道筛子有反方向的漏洞，见下一段。**

**为什么这些都要改在 role_types.mjs 这一个地方**：岗位类型在下游还会被重新判好几次——store_scored_jobs.mjs:168、eligibility.mjs:102/129、validate_auto_row.mjs:64、supervisor_preflight.mjs:117 都会调 classifyRoleType / deriveRoleTypeFromJob。如果只放宽 discover_candidates 这一处，岗位能进打分，但到投递前会再被 `role_type_not_allowed` 拦下来。

## 同模式风险扫描（Where else can it happen）

- **地点筛子会把美国以外的岗放进来** [实测]：通过地点筛的岗位里，约 100 个其实不在美国，包括 Almaty, Kazakhstan 42 个、United Kingdom 25 个、Europe 18 个、"UAE " 7 个（多了个尾随空格，而词表里是 `' uae'`，所以对不上），还有 Munich、Korea、Jerusalem、Burnaby 等。原因是词表里没有这些国家/地区名，查不到的地点一律按「放行」处理（discover_candidates.mjs:312）。现在看不出问题，是因为岗位类型那道筛把它们一起刷掉了；**一旦放宽 new_grad_FT，Higgsfield 在 Almaty 的 Growth Manager、Content Manager 这类岗就会漏进来。**
- **只看主地点，不看附加地点** [实测]：ashby_board_api.mjs:81-82 只取 `location` 字段，`secondaryLocations`（附加地点）只有主地点为空时才用。例如 synthesia 的 Marketing General Application 主地点是 London，附加地点里有 New York City 和 Austin，但还是被判成地点不符；black-forest-labs 的 Field Marketing Manager 附加地点里有 SF、LA、Seattle，也一样。这类岗在这几个方向里约 4-5 个。
- `excluded_locations: ["Singapore"]` 这个配置项在 shared/ 下面没有任何代码读它 [读码]。Singapore 能被刷掉，只是因为它刚好在 foreignCities 列表里。
- 排除词：没有发现同类误杀。

## 修复方案（How to fix）— 本轮只查不修，下面是方向

### A 类：只改 search_intent 配置 → 能多放进的有用岗位 ≈ 0

- role_type_targets 只接受 intern / part_time / new_grad_FT 三个值；填 `full_time` 也会被 normalizeRoleType 转成 new_grad_FT（role_types.mjs:18），意思一样。**配置里没有任何写法能放进普通全职岗。**
- 加上 part_time：能多放进 3 个 ElevenLabs 自由职业岗（配音、翻译、有声书），和目标方向不符。
- 删排除词：只会放进工程师和销售岗，不是想要的。
- 配置这条路唯一真有用的是**往名单里加公司**，但那是扩大范围，不是修筛子。

### B 类：改筛子代码（role_types.mjs，一处改完，下游 5 处自动一致）

方向：把 new_grad_FT 的意思改成「普通全职岗，并且不是资深岗」，而不是「标题写了 New Grad」。具体是：
1. 雇佣类型是 FullTime、标题没有资深词 → 算应届可投。`SENIOR_RE` 建议再加上 `lead` 和 `sr.`（现在 "Sr. Paid Social Manager"、"Lifecycle Marketing Lead" 都能漏过去）。
2. 再加一道按职位描述（JD）要求年限的筛：描述里写了「3 年以上经验」就刷掉 → **这是一个需要拍板的阈值**。
3. 同时修地点筛：查不到的地点不再默认放行，加上 Kazakhstan / United Kingdom / Europe / UAE 等；把附加地点也纳入判断。否则放宽之后会漏进约 100 个美国以外的岗。

**预估能多放进多少（[推断]，年限是我用正则从 JD 里抓的，没有逐条人工核对）**：

| 放宽到什么程度 | 21 家里能多进打分的（美国 / 远程） |
|---|---|
| 只要是全职、标题没有资深词（所有方向都算） | 约 164 个，其中增长/市场/产品这几类约 50 个，其余是客服、工程经理、法务等，要靠打分再刷 |
| 上一行 + 增长/市场/产品这几类 + JD 没写要求 3 年以上 | **约 16 个**（见下方名单） |
| 同上，但「要求 3 年以上」的也交给打分判断 | 约 40 个（多出的 24 个 JD 写了要 3-10 年经验） |

那 16 个 [推断]：elevenlabs Content Creator & Strategist / Influencer Marketer / Marketing Operations / B2B SEO/AEO Expert / Affiliate Marketing Manager；suno Social Media Community Manager（JD 要求 2 年以上）/ Paid Social Creative Strategist (Contract)；tavus Vibe Growth Marketer / Business Development Representative / Product Manager；pika Product Manager（要求 2 年以上）；lumaai Product Manager, Enterprise / Talent Community；runway Youtube Creator & Educator；descript Field Marketing Manager（要求 2-4 年）；mirage Product Design Manager（设计方向，可能不算）。
**需要老实说明**：这几家创业公司的「普通全职岗」，大部分在 JD 里写了要 2-5 年经验。放进打分之后，真正值得投的大概是个位数到十几个，不会回到 154 个的量级。

## 防回归（How to prevent regression）

修的时候建议加上这些测试（先让它失败，再改代码让它通过）：
- `classifyRoleType({title:'Growth Marketer', employment_type:'FullTime'})`，在目标包含 new_grad_FT 时应该放行；`'Sr. Growth Marketing Manager'` 和 `'Lifecycle Marketing Lead'` 应该拒绝。现有测试 role_types.test.mjs:47, 60 要跟着新的定义一起改，**这是在改设计，需要拍板**。
- 地点：`'Almaty, Kazakhstan'`、`'United Kingdom'`、`'UAE '`、`'Europe'` 都应该返回 false；`'London'` 主地点 + 附加地点有 `'New York City'` 的应该返回 true。
- 端到端：用今天 601 个岗的快照做夹具（fixture），断言岗位类型那道筛淘汰数在合理区间，并且地点筛放行的岗里没有非美国的。

## 教训（What to remember）

- **选项名说的意思，要和代码实际做的一致**：`new_grad_FT` 在引导问卷里读起来是「应届全职」，代码实际上是「标题写了 New Grad」。给拍板人看的选项文案和代码逻辑不一致，就会出现「勾了但等于没勾」。建议 lead 把这条沉淀进项目记忆。
- **按白名单判断的筛子，遇到没见过的值不能默认放行**：地点筛对查不到的地点一律放行，平时被岗位类型筛挡着看不出来，一放宽就会漏。
- **现在的筛子报告会误导人**：它只给每个岗记第一个命中的原因，所以「地点刷掉 99 个」其实少算了（单独看地点筛是 158 个）。以后诊断要按每道筛子单独统计。

## 试过的错误方向

1. **怀疑 role_categories 按字面子串匹配导致误杀**：看代码后排除。硬筛根本没用 role_categories，名单扫描也不看搜索词（discover_candidates.mjs:202-236、dispatcher.mjs:90-95）。
2. **怀疑排除词误杀**（比如 "sre"、"ml engineer" 误伤增长类岗位）：把 193 个命中逐个看过，在增长/市场/产品这几类里只命中 6 个，都是招聘、销售、法务，属于合理淘汰。排除。
3. **怀疑 seniority: "both" 把全职岗刷掉了**：role_types.mjs:24-29 显示，填了 role_type_targets 之后 seniority 根本不看。排除。
4. **一开始按硬筛报告的顺序原因来数地点淘汰（99 个）**：这样会少算。改成每道筛子单独跑一遍全部 601 个，得到 158 个，这时才发现地点筛也有反方向的漏洞。
