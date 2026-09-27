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
Updated: 2026-09-27
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

---

# BUG_REPORT 第 2 章（2026-09-27）— 真投 3 个 Ashby 岗结局 unknown / no_errors_no_success 且无截图

只查不修。读：`submit_r3.log`、`submit_r2.log`（scratchpad）、账本末 8 行、`shared/ashby_apply_driver.mjs`、`shared/greenhouse_apply_driver.mjs`、`shared/lever_apply_driver.mjs`、`shared/driver_contract.mjs`、`shared/submission_evidence.mjs`、`git show 7ef0ac3`、DESIGN §13.7（投递留证设计段）。
Chrome（CDP 远程调试接口 localhost:9222）只用 `Runtime.evaluate`（在页面里执行只读 JS）读取 URL、文字、表单值、`performance` 资源记录（浏览器自带的网络请求时间表）；**零点击、零输入、零刷新**。脚本：scratchpad `ro_read*.mjs`。

## 现场（What happened）

run stream-2026-09-27T03-41-01-577Z-7047。三条行为完全一致 [实测，日志]：`Upload resume… → Fill name/email… → Submit attempt 1… → missing fields:（空）`，驱动再读 4 次页面仍无成功/失败字样 → 结局 unknown，账本 `may_have_submitted=true`、`evidence=null`。

| 行 | 标签页（仍开着） | 页面现状 [实测 CDP 只读] |
|---|---|---|
| 100007 OpusClip AI PM Intern | A4FC0C47… | 仍停在投递表单；姓名/邮箱/简历已填；**LinkedIn（必填）、AI 开放题（必填）是空的**，Location、工作许可、RTO 也没答；页面**没有任何报错**（没有「Your form needs corrections」） |
| 100009 Creatify PM Intern | 223A84DC… | 仍停在投递表单；表单只有姓名/邮箱/简历三项，**全部已填且合法**；无报错、无成功字样 |
| 100005 ElevenLabs Marketing Ops | AA638641… | 仍停在投递表单；LinkedIn（必填）空；无报错 |

三页的 reCAPTCHA（谷歌人机验证）回执 `g-recaptcha-response` 都是空的，人机验证框没有重新加载过（`ar=1`）。

## 根因（Why it happened）

### 1. 提交按钮点了，但 Ashby 根本没接住 —— 什么都没发出去 [实测 + 推断]

**实测（网络记录）**：同一轮里「点一次提交」在 Ashby 页面上会留下固定痕迹：`seondnsresolve.com`（反欺诈指纹）→ `recaptcha/api2/clr` → `non-user-graphql`（提交请求），人机验证框里还会多一条 `api2/reload`。Suno、ElevenLabs Social 两页每点一次都有这一组（各 3 组 = 3 次尝试）。
**这 3 页在简历上传那串请求（约 6.5–7.9 秒）之后，一条请求都没有**：没有反欺诈、没有人机验证、没有提交请求；人机验证框里也 0 条 `reload`。页面资源记录总数 20–22 条，远没到 250 上限，不存在被截断。
→ **结论 [实测]：这 3 家的投递从未离开浏览器。**「点了提交但页面没反应」≠「可能投出去了」。

**为什么没接住 [推断，时间线强相关，未做对照复现]**：驱动流程是「打开 → 睡 6 秒 → 传简历 → 填姓名邮箱 → 立刻点提交」，中间**不等简历上传的后续请求走完**。按账本时间戳倒推，三条都是打开后约 7.5 秒点的提交：

| | 上传那串请求最后结束 | 点提交（推算 / 实测） | 结果 |
|---|---|---|---|
| Suno | 7.09s | ≈7.3s（clr 7.38s 实测） | 接住了 |
| ElevenLabs Social | 7.36s | ≈7.5s（clr 7.65s 实测） | 接住了 |
| OpusClip | **7.64s** | ≈7.5s（推算） | 没接住 |
| Creatify | **7.94s** | ≈7.5s（推算） | 没接住 |
| ElevenLabs MktOps | **7.81s** | ≈7.5s（推算） | 没接住 |

即：上传还没走完就点了，Ashby 在上传进行中静默忽略提交点击 —— 这是 race condition（竞态条件：两件事谁先完成不确定，结果就看运气）。

代码位置：
- `shared/ashby_apply_driver.mjs:342-363` `uploadResume` 只看 `files.length>0` 就返回成功，不等 Ashby 的上传请求结束。
- `shared/ashby_apply_driver.mjs:434-445` `submitAndCheck` 的点击返回值（有没有找到按钮）被丢掉，也不检查点击有没有被页面接住。

### 2. 为什么以前没爆：`7ef0ac3` 把「被掩盖的竞态」变成了终局 [实测 git diff]

`7ef0ac3`（2026-09-26）之前，「没缺字段、也读不出结果」时会 `continue` 再点一次提交，第二次点击通常就接住了——竞态被默默掩盖。首次真投（submit_r2.log）的 Tavus Vibe 就是：第 1 次点击无反应、第 2 次才出反垃圾横幅。
`7ef0ac3` 为防重复投递改成「只重读不再点」（`ashby_apply_driver.mjs:1092-1098`、`:1122-1124`），这个方向对，但它**没区分「点击被接住但结果读不懂」和「点击根本没被接住」**。后者再点一次完全安全（第一次什么都没发出去），却也被一刀切成了 unknown。

### 3. 为什么没截图：代码路径漏调，不是写入失败 [实测代码]

`ashby_apply_driver.mjs:1124` unknown 分支直接 `emitOutcome`，**既不调 `captureEvidence` 也不关标签页**；同文件 submitted（:1108）、not_submitted（:1103、:1119）三处都调了。截图目录里也确实没有这 3 家的文件、没有「截图失败」日志行。DESIGN §13.7 要求 after_submit「先读页面 → 判定 → 整页截图 → 按判定命名」，没有把 unknown 排除在外——unknown 恰恰是最需要留证的一档。

### 修 bug 三问
1. 真根因：提交前不等上传完成 + 不检查点击是否被接住（第 1 条）；unknown 分支漏留证（第 3 条）。账本记成「可能投过」是这两条的下游后果。
2. 同一根因别处会爆吗：见下方同模式扫描。
3. 修法方向是消除根因（等上传、验点击），不是恢复盲点重试。

## 账本记法判断 + 更正建议（只建议，未执行）

- `driver_contract.mjs:162-185` 的规则是「有页面判定（verdict）就算可能投过」——对一个「读不懂的页面」取保守值，**按设计是对的**；错的是上游：驱动在「根本没点成」的时候也交了 verdict。
- 结合 ① 页面网络记录里没有任何提交请求 ② 人机验证从未执行 ③ 页面停在表单、必填项仍空（OpusClip / ElevenLabs 那种状态 Ashby 服务端也不会收）④ Gmail 1 天内无确认邮件（Synthesia 同轮 1 分钟内就到了）——**3 条都建议改成 not_submitted**，以便重投、并释放 ElevenLabs 的 60 天名额：

```
node shared/submission_ledger.mjs correct --of led_1790481531129_100007_e87433 --url https://jobs.ashbyhq.com/opusclip/501d374d-7d4f-4889-bc53-0a1fd16253ea/application --verdict not_submitted --evidence "CDP 只读：点提交后页面 0 条提交请求、reCAPTCHA 未执行，表单停留且必填空；Gmail 无确认邮件（BUG_REPORT 第 2 章）"
node shared/submission_ledger.mjs correct --of led_1790482535211_100009_ef1384 --url https://jobs.ashbyhq.com/creatify/4da91083-999a-4bf8-b53d-92a179073af2/application --verdict not_submitted --evidence "…"
node shared/submission_ledger.mjs correct --of led_1790485464972_100005_104f9c --url https://jobs.ashbyhq.com/elevenlabs/1c1f4cc9-08f7-4fbb-867f-7e87e7fa19d9/application --verdict not_submitted --evidence "…"
```
（先不带 `--apply` 看预演；后两条的 `--evidence` 按第一条写完整原因。）
**重投前提**：修复第 1 条之前重投，仍有同样概率踩中竞态。另注意 OpusClip 还有一个 9-26 首次真投留下的旧标签页（F5F773DE…，停在「Your form needs corrections」），与本次无关。

## 同模式风险扫描（Where else can it happen）

- `shared/greenhouse_apply_driver.mjs:1838`：unknown / no_errors_no_success 分支同样**不截图**（0b93ac2 同样改成「只重读不再点」）。Greenhouse 是否也有「上传未完就点」的竞态 **未查证**。
- `shared/lever_apply_driver.mjs:450-489`：提交前、提交后都截图，unknown 也带 evidence —— 无此问题。
- Ashby 其余行：同一驱动、同一时序，**每个 Ashby 岗都有这个概率**；本轮 7 个里中了 3 个。

## 修复方案（How to fix）— 方向，交 builder

1. **点之前等上传走完**（`uploadResume` 之后）：轮询到页面不再有进行中的上传请求（例如 `performance` 里 `loaded-files-*.s3` 及其后的 graphql 请求都已结束，或 Ashby 简历框出现完成态），设超时；超时 = crashed 大声报错，不默默继续。
2. **点完验证「被接住」**：`submitAndCheck` 记下点击时刻，之后读 `performance` 看有没有新的 `recaptcha/api2/clr` / `seondnsresolve` / `non-user-graphql` 请求，或页面报错出现。
   - 没接住（点击后 0 条新请求、无报错）→ 这时再点一次是安全的（上一次什么都没发出去），可有限次重点；多次仍不接 → 新结局 `not_submitted / submit_click_not_registered`（附截图），`may_have_submitted=false`。
   - 接住了但结果读不懂 → 维持 7ef0ac3 的「只重读不再点」+ unknown。
   - 同时把「按钮没找到」变成显式错误（现在返回值被丢掉）。
3. **unknown 分支补 `captureEvidence(phase:'after_submit', verdict:'unknown')`**（Ashby :1124、Greenhouse :1838），与另外三档一致。
4. 取舍面：选「消除根因（等上传 + 验点击）」而非「恢复盲点重试」——后者简单，但会把「点击被接住了只是页面慢」的情况也重点一次，有重复投递风险，正是 7ef0ac3 要堵的。

## 防回归（How to prevent regression）

- 驱动单测（用假 cdp）：点击后资源记录无新增 → 结局不能是 unknown / may_have_submitted=true；应重点或 `submit_click_not_registered`。先红后绿。
- 点击后有 clr+graphql 但页面无字 → 仍 unknown，且**不再点第二次**（守住 7ef0ac3）。
- 源码守卫：Ashby / Greenhouse 驱动里每个 `outcome: 'unknown'` 的 `emitOutcome` 调用都必须带 `evidence`。
- 上传未完成时点击：假 cdp 模拟上传请求未结束，断言驱动先等待。

## 教训（What to remember）— 提示 lead 沉淀

- **「点了」不等于「页面收到了」**。自动化里任何点击，都要有「对方接住了」的可观测证据，否则下游的「可能投过」判断全建在沙子上。
- **收紧重试时，要先分清重试在掩盖什么**。7ef0ac3 去掉盲点重试是对的，但盲点重试原来在默默兜底一个竞态；拆掉兜底前没问「它在兜什么」。
- 留证要覆盖「最说不清」的那一档（unknown），而不是只拍说得清的成功/失败。

## 试过的错误方向

1. **怀疑 reCAPTCHA 弹了图片挑战、卡在那里等人点**：查三页 DOM 和 CDP 目标，没有挑战框（bframe）；人机验证框里 0 条 `reload`，说明验证根本没被触发。排除。
2. **怀疑浏览器原生必填校验拦住了提交（OpusClip / ElevenLabs 有必填空项）**：页面上没有 `<form>`，按钮不在表单里，原生校验不适用；而且 Creatify 表单全部合法也一样没反应；同轮 ElevenLabs Social、Suno 在必填为空时点击照样发出了提交请求并拿回报错。排除。
3. **怀疑是提交了、只是成功字样判定器没认出来**：页面网络记录里没有提交请求，页面停在表单；Gmail 无确认邮件。排除。
