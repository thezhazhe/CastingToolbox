# PHASE 71.5 · STL 自动工艺设计中心一次性整合（75.txt）报告

> 性质：**整合/编排项目**，不是重新开发计算器项目。riser / gating / yield / castability / STL 引擎
> **0 核心逻辑修改**；改动集中在 Design Center 输入区重组、Page1 新增、结果中心三页化、数据模型增量语义。
> 日期：2026-09-09

---

## A. 最终架构（STL → 统一项目数据 → 三页结果的数据流）

```
STL 导入 → STL 自动解析（几何/壁厚/V3 热结）
   │  写出 geometry.* / hotspots.* / process.wallUsed / mcHotspot / wallHot（全部带 SRC+CONF）
   ▼
【统一项目输入区】（CastingProject 单例；§六 同一参数只输入一次）
   ① STL 自动识别（可改；改后 🟠 + 保留 STL 原值 orig + ↺ 恢复）
   ② 基础工艺参数（材料大类——一次输入，冒口/浇注/出品率共用）
   ③ 浇注参数（浇注方向 / 一模件数 / Ho / ph——gating 勾选即常显，STL 无法识别分型面）
   ④ 高级参数（折叠：出品率 / 冒口高度回写 / chill T_hot / 造型方法…，manifest optional 驱动）
   ▼
calcManifest（共享参数缺失判定 + RUN_ORDER：riser → gating（读 riserHeight 回写）→ yield…）
   ▼ 原样调用成熟引擎（runRiser / runGating / resolveYield / …；0 公式改动）
   ▼
【三页结果中心】（默认 ① 页）
   Page1 ① 铸件工艺分析 —— 板块 A（STL 客观数据 + 来源标签 + 状态/置信）
                           板块 B（铸造工艺性：castability.js 复用，参考值可追溯；检测 vs 建议分色）
   Page2 ② 冒口设计      —— riserSection（冻结展示）+ Campbell 提示 + 多热结 V1 说明
   Page3 ③ 经典浇注系统   —— 推荐方案 → 关键尺寸 → 浇注方向示意图(SVG) → 关键计算 → 详细计算（折叠）
   Page4 ④ 出品率与铁水重量
   其余可选模块（chill/sandbox/shrinkage/machining/charge/shakeout）殿后，展示保持原样
```

新增「orig 基准」语义（§八：STL 原始值 / 当前采用值）：CastingProject 参数携带 `orig {v, src, conf}`，
自动写入（STL_GEOMETRY_ANALYSIS/DERIVED）刷新基准；用户覆盖时首次固化；`restoreAutoValue(path)`
一键整体还原（值 + 来源 + 置信度）。UI：🟠 徽章 + 悬浮显示原始值 + ↺ 按钮。

Page1 数据装配在 `js/views/processPage1.js`（纯函数 `buildPage1Data` + `page1Html`，可单测无 DOM）；
V3 采样定性信号（薄区）经 designCenter → resultsCenter ctx 传入（会话内存态；刷新后 STL 会话按既有
stlSessionCheck 清理，无幽灵数据）。

---

## B. 参数映射表（以代码真实 schema 为准，75.txt §四）

| 参数（project 路径） | 来源 | 用户可改 | 消费者 | 备注 |
|---|---|---|---|---|
| material.family | 🟡 用户（生产场景可预填 SCENARIO） | ✅ ② 常显 | 冒口/浇注/出品率/machining/shakeout/chill/shrinkage | **全局单点**，§六核心 |
| geometry.size | 🟢 STL | ✅（只读展示，编辑走 ① 体积/重量） | Page1 工艺性档位 / machining / sandbox / shrinkage | |
| geometry.volumeCm3 | 🟢 STL（手动=用户） | ✅ | 净重派生 / Page1 | 覆盖保留 orig |
| geometry.areaCm2 | 🟢 STL | ✅ | Page1 板块 A | 无计算器消费，仅展示 |
| geometry.netWeightKg | 🔵 体积×固态密度 | ✅（只读框） | 展示校准 | 与 blankWeightKg 语义分开（§七） |
| geometry.blankWeightKg | 🔵 自动=净重；用户可上调 | ✅ | gating.pw / riser.cast_wt / yield.castWt / sandbox / charge / shakeout / machining | **毛坯口径**，全链共享单点 |
| geometry.wallMax | 🟢 STL | ✅ | Page1 / 厚薄比启发 | |
| process.wallUsed（主体壁厚） | 🟢 STL（bodyRefOf 链） | ✅ | gating.wall / shakeout / Page1 圆角档 | 覆盖保留 orig；wallHot 联动 DERIVED |
| process.mcHotspot | 🟢 STL 热结[0] | ✅ | riser Mc / chill 派生 | 无热结时兜底 process.wallHot（壁厚/2） |
| hotspots.status/reason/items | 🟢 STL | — | riser/chill 门禁 + Page1 | 置信度元数据随行 |
| process.pourPos | 🟡 用户（③ 常显，默认 顶注） | ✅ | gating.pos + 示意图 | **原先默认值静默吞掉决策，71.5 起常显** |
| production.cavities | 🟡 用户（③ 常显，默认 1） | ✅ | gating.cav | |
| process.Ho / process.ph | 🟡 用户（③ 常显） | ✅ | gating Hp/静压头（未填走 150/100 兜底，界面明示） | STL 无法识别分型面，不猜（§十一） |
| material.liquidDensity / solidDensity | 🟡 材料表自动（SCENARIO） | ✅ 改后显式覆盖生效 | gating rho / riser rho / 净重 | 28.3-A 双语义已拆分 |
| material.yieldSug / process.riserHeight | 🔵/🟢 默认 + riser 回写 | ✅ ④ 高级 | gating yr/rh | riserHeight 由 riser 结果 CALC_RESULT 回写 |
| production.qty | 🟡 用户 | ✅ | Page1 批量判定（最小铸孔档） | |

**明确不接的字段（§21 纪律：不猜、不造死输入，报告中列出）**：
- **浇注温度**：经典 gating 的 P47 浇注时间公式族按「材料×重量×壁厚」无温度消费者（47.txt 定稿公式）；
  温度属项目级信息（material.pourTemp 字段存在、Campbell/浇注温度工具消费）——设计中心不新增无消费输入。
- **过滤网使用/内浇口数量×厚度/横浇道条数×厚度/出气孔参数**：DC 沿用既有简化默认（gc2×gt15/rc2×rt25/
  排气自动生成，PHASE 29 P1-40「scope:calculator」先例）——独立计算器是完整入口，整合不改引擎默认。
- **型腔数之外的生产节拍/班产**：无计算器消费。
- 以上若需在 DC 内可调，下阶段按 §21 规则逐一以 USER_INPUT 显式加行（本阶段保持与冻结行为一致）。

---

## C. 重复输入消除情况

| 参数 | 此前 | 现在 |
|---|---|---|
| 材料大类 | 仅"缺失时"出现（场景预填后不可见/不可改处） | ② 常显单点，改后密度/出品率区间联动，冒口/浇注/出品率全同步 |
| 铸件重量 | 毛坯重 ① 单点（28.3 已统一） | 不变；手动模式下 ①/② 去重规则防双输入 |
| 浇注方向 | 有默认值即"满足缺失判定"，**用户从未真正选择过** | ③ 常显可改，写入 pourPos，示意图/计算结果随动 |
| Ho/ph | 仅空值才出现（填后消失不可再调） | ③ 常显可改（保焦点不重渲） |
| 热节模数 Mc | ① 单点（hotspot→mcHotspot / 无→wallHot 语义切换） | 不变 + 覆盖后 ↺ 恢复 |
| 手动模式 | ① 列与"需要您提供"列同参重复出现 | ① 已覆盖核心项自动从右侧清单去重 |

---

## D. 三页 UI 组织（输入/输出/示意图/关键结果/详细结果）

- **Page1 铸件工艺分析**：风险条（三信号：厚大热结/薄区/厚薄比）→ 板块 A 表（11 行客观数据，每行尾
  来源标签 🟢/🟡/🔵/🟠 + 悬浮原始值）→ 板块 B 卡片（最小壁厚建议×薄区检测配对 / 圆角参考 / 拔模参考
  JB/T 5105 / 最小铸孔参考（不判当前孔径）/ 厚薄过渡启发 / 结构风险摘要 + 材料提示），底部接「完整铸造
  工艺性工具」入口；热结明细表（Mc/区域体积/代表点）挂 Page1 下。
  诚实性纪律：无精确最小壁厚数值（仅"约 X mm 量级（定性）"或"无法可靠测量"）；无孔/圆角曲率/拔模方向
  检测；NO_HOTSPOT 区分 uniform（真均匀）与 no_candidate（未达阈值 → 保守估算提示，不冒充"均匀属正常"）。
- **Page2 冒口设计**：冻结 riserSection（尺寸/效率/所需模数/体积/颈/校核）+ Campbell T 字交叉提示 +
  多热结（N>1）"V1 不做 feed-zone 自动划分、以最大 Mc 为依据"说明 + blocked 门禁原样。
- **Page3 经典浇注系统**：推荐方案统计条 → 关键尺寸表 → 浇注方向示意图 SVG（保留不删，§十二）→
  优化建议/分界点提示 →「详细计算过程」折叠（castingMass/G/Hb/Pv/Hp/fv/A/实际面积/流速/排气/出品率全量）。
- **Page4 出品率**：yieldSection（参考区间按"产品×工艺/材质×工艺"回退链）原样。
- 导航：完成模块按钮顺序 ①→④（未勾选自动跳过）+ 其余模块殿后；默认停在 ① 页。

---

## E. 修改范围

**新增**
- `js/views/processPage1.js` —— Page1 纯逻辑（buildPage1Data/page1Html/批量与厚薄启发阈值），无 DOM
- `tests/phase715_test.mjs` —— 8 项集成/单元测试
- `scripts/browser_dc_715_test.mjs` —— 浏览器验收（无头 Edge + CDP）
- `docs/PHASE715_REPORT.md`（本文档）

**修改（均为编排/展示/元数据层，核心算法 0 改动）**
- `js/model/CastingProject.js` —— `set()` 增加 orig 基准维护；新增 `restoreAutoValue()`（纯增量，旧数据无
  orig 字段安全；既有 set 语义不变）
- `js/views/designCenter.js` —— 参数面板重组（①STL/②基础/③浇注/④高级 + 图例 + 手动去重 + 徽章就地刷新）；
  srcBadgeHtml 增加 orig 悬浮与 ↺ 锚点；renderResults 传 Page1 ctx；NO_HOTSPOT 徽章文案按 reason 分级
- `js/views/resultsCenter.js` —— 三页结果中心（Page1 新增、导航次序、Page3 加示意图与详细折叠、热结明细迁
  Page1、data-calc-link 绑定随重渲染重建）
- `calcs/calcManifest.js` —— **仅 1 处显示文案**：NO_HOTSPOT 的 riser note 区分 uniform/no_candidate（无数值/逻辑改动）
- `css/app.css` —— 新增样式（图例/分组/来源标签/Page1 板块/↺ 按钮）
- `scripts/design_center_test.mjs` —— 选择器随 manifest 时代修正（非本期功能改动）

**未触碰（0 修改，原则 §一）**：`calcs/riser.js`、`calcs/gating.js`、`calcs/yield.js`、`calcs/castability.js`、
全部 `js/engine/*`（stl/geometry/distanceField/meshValidation/hotspotV3…）。

---

## F. 测试结果

| 项目 | 结果 |
|---|---|
| 新增 phase715 单测（orig 语义×3 / 板块 A / 无伪精确 / 板块 B 参考 / 三信号启发 / 引擎锁定） | **8/0** |
| 计算器/model 回归（model + phase28~29 系列 + phase45a~65 + phase715；跳过 STL 重量级套件，历次纪律） | **204/0**（76+128 两组） |
| phase29 门禁矩阵复跑（文案改动后） | 9/0 |
| 浏览器验收（无头 Edge：统一输入区 4 组/覆盖↺恢复/三页导航/Page1 板块 A+B/示意图/详细折叠/ALR2510 诚实口径/console 0 异常） | **全部通过 ✅** |

**注意（诚实报告）**
1. `tests/real-stl/` 下 ALR2510/lShape 的 `*_diag.json` 为旧引擎时期产物（v3.status=ok 且检出热结）；
   当前引擎对这两个文件按默认参数分析为 NO_HOTSPOT(no_candidate)。本阶段未动引擎（冻结纪律），
   界面按新口径如实分级展示（不冒充均匀件）。引擎侧是否回检为独立问题，留给后续阶段评估。
2. Page1 使用 V3 采样信号属会话内存态：刷新后 STL 会话按既有机制清理，需重新导入——与旧行为一致。
3. 「生成工艺计算报告」暂只含已执行计算器模块，未并入 Page1 板块（可作下一阶段增强）。
4. orig 悬浮值在"导入 STL 后切换单位"边界下可能停留在旧单位（自动写入被 USER_OVERRIDE 保护时），
   属罕见路径，报告备案；恢复按钮语义不受影响。
