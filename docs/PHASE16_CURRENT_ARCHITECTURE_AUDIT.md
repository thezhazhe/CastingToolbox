# PHASE 16 当前架构审计报告（完整代码审计）

日期：2026-08-23 ｜ 命令：16.txt 第一阶段 ｜ 性质：只读审计，**零代码修改**

审计方式：全量阅读代码确认（`index.html` / `js/app.js` / `js/views/*` / `js/model/CastingProject.js` / `js/context.js` / `calcs/*` / `js/engine/*`），不依赖假设。

---

## 0. 核心问题答案（16.txt 二 特别强调）

> **"现在的工艺计算到底是在调用现有计算器，还是实际上又实现了一套新的计算逻辑？"**

**答案（代码确认）：是调用现有计算器——计算核心单一，不存在第二套计算逻辑。**

三条调用链全部指向同一批 `calcs/` 纯函数：

| 入口 | 调用方式 | 证据 |
|---|---|---|
| 旧独立计算器视图（`views/gatingView.js` 等） | 直接 import `calcs/gating.js` 的 `runGating` 等 | `gatingView.js:6` `riserView.js:6` `smallCalcs.js:6-12` `chargeCalc.js:6` |
| 设计中心（`views/designCenter.js`） | `CALC_MANIFEST[i].calculate()` → 同一批纯函数 | `calcManifest.js:11-18` import，`calculate` 内 `runGating/runRiser/resolveYield/runChill/runSandbox/runShakeout/runCharge/rmaRange` |
| 工艺向导（`views/wizard.js`） | 直接 `runGating` + `runRiser` | `wizard.js:9-10` |

数据表同样单一：`data/chill_calc.js`、`data/sandbox_calc.js`、`data/charge_calc.js`、`data/shakeout_calc.js` 被视图与 calcs 共享。

**唯一的"重复"**：材质族→计算器材料键的映射（`matKeyOf`）在 `calcManifest.js`、`designCenter.js`、`wizard.js` 各有一份小拷贝——属映射表重复（3 处、各 5 行），**不是计算逻辑重复**，统一成本低。

---

## 1. 当前页面结构

单页应用（`index.html` + `js/app.js` hash 路由），6 个视图：

| 视图 | 路由 | 内容 |
|---|---|---|
| 首页 | `#/home` | 搜索 + 入口 |
| 计算工具 | `#/calculators[/id]` | 13 个计算器卡片网格 → 详情（专用视图） |
| 工艺设计中心 | `#/designCenter` | **STL 导入 + 8 任务勾选 + 参数 + 执行 + 结果中心**（工作台主体） |
| 工艺向导 | （无导航项，计算器 next 链接进） | 6 步独立引导，仅 gating+riser，HTML 报告下载 |
| 知识库 | `#/knowledge` | 开发者模式解锁后可见 |
| 搜索 | `#/search` | 全局搜索 |

侧栏导航：首页 / 计算工具 / 工艺设计中心 / 捐助；顶栏全局搜索 + 生产场景条（`context.js` localStorage 共享：材料/造型线/生产方式/铸造方法）。

## 2. 当前 STL 数据流（designCenter 导入链路）

```
文件选择/拖拽
 → parseSTL（Binary/ASCII，本地）
 → validateMesh（网格验证，warning 不阻塞）
 → buildMesh（three + BVH）
 → ModelView3D 显示（居中坐标系）
 → analyzeGeometrySliced（V2 距离场：volume/area/size/wallMax/wallAvg/wallMain）[分片防冻结]
 → writeGeometryToProject（写 CastingProject，SRC=STL_GEOMETRY_ANALYSIS）
 → analyzeHotspotsSliced（engine/hotspot.js = V2 引擎）⚠️ 非 V3
 → writeHotspotsToProject（hotspots.items + mcUsed 覆盖）
 → diagnoseSTL（STL 诊断）
 → renderParams（manifest 缺失参数判定）+ renderHotspotList + renderGeomInfo
```

**STL 数据位置**：内存 `state.mesh`（视图状态）+ `CastingProject`（localStorage `ct-project` 持久化）。

## 3-4. 计算器清单与输入输出

### 13 个计算器（`calcs/registry.js` 确认，非假设）

| id | 名称 | 类别 | 有无 manifest（设计中心） | 计算核心 |
|---|---|---|---|---|
| gating | 浇注系统设计 | 计算 | ✅ | `calcs/gating.js runGating` |
| riser | 冒口设计 | 计算 | ✅ | `calcs/riser.js runRiser` |
| yield | 出品率与铁水重量 | 计算 | ✅ | `calcs/yield.js resolveYield` |
| chill | 冷铁计算 | 计算 | ✅ | `calcs/chill.js runChill` |
| sandbox | 3D砂型吃砂量 | 计算 | ✅ | `calcs/sandbox.js runSandbox` |
| machining | 加工余量 | 计算 | ✅ | `calcs/machining.js rmaRange` |
| charge | 熔炼加料计算 | 计算 | ✅ | `calcs/charge.js defaultCharge/runCharge` |
| shakeout | 开箱时间 | 计算 | ✅ | `calcs/shakeout.js runShakeout` |
| shrinkage | 线收缩率 | 计算 | ❌（无 manifest，不进设计中心） | `calcs/shrinkage.js calcShrinkage` |
| castability | 铸件结构工艺性 | 知识/查询 | ❌ | `calcs/castability.js suggestCastability` |
| ct | 尺寸公差 CT | 知识/查询 | ❌ | `calcs/ct.js`（视图 `ctCalc.js`） |
| principles | Campbell 十规则 | 知识/展示 | ❌ | 视图 `principlesCalc.js` |
| defect_finder | 缺陷查找 | 知识/诊断 | ❌ | 视图 `defectFinder.js` |

**各计算器输入输出**（manifest requiredInputs/outputs，`calcManifest.js`）：

| 计算器 | 必需输入（共享参数路径） | 输出 |
|---|---|---|
| gating | material.family / geometry.weightKg / production.cavities / process.wallUsed / process.pourPos / process.Ho / process.ph | G 浇注重量 / t 浇注时间 / A 阻流截面 / D_sp 直浇道 / L_g 内浇道长 / L_r 横浇道长 |
| riser | material.family / geometry.weightKg / process.mcUsed | D 冒口直径 / H 高度 / Mr_act / Vr / d_neck |
| yield | material.family / geometry.weightKg | castWt / pourWt / runnerWt / riserWt（依赖 gating.G、riser.Vr） |
| chill | material.family / process.mcUsed（T=2×Mc） | thickness / mid / warnings |
| sandbox | geometry.size（useMax）/ geometry.weightKg | minWall / wall / warning |
| machining | material.family / geometry.size（useMax） | min / max / mid / grades |
| charge | material.family / 铁水总重（取 yield.pourWt 或 gating.G） | result 成分 / sug 补料建议 |
| shakeout | material.family / geometry.weightKg / process.wallUsed | timeRange / shakeTemp / warnings |

## 5-9. 参数来源分布

### ① 来自 STL（自动）——`writeGeometryToProject` + `writeHotspotsToProject`

geometry.size（X×Y×Z）/ volumeCm3 / areaCm2 / wallMax / wallAvg / wallMain→process.wallUsed / weightKg（体积×密度派生）/ triCount / meshIssues / hotspots.items（Mc、区域体积、代表点）/ process.mcUsed（先=wallMain/2，热结分析后=主热结 Mc 覆盖）

### ② 来自前置计算

- geometry.weightKg = 体积×密度（`refreshWeight`，SRC=DERIVED）
- yield.pourWt/runnerWt ← gating.G（results 对象传参）
- yield.riserWt ← riser.Vr
- charge 铁水总重 ← yield.pourWt 或 gating.G
- material.density / yieldMin/Max/Sug ← material.family 联动（GATING_MATS 数据）
- process.mcUsed ← wallMain/2（DERIVED，热结后 STL 值覆盖）

### ③ 必须用户输入

material.family（生产场景可预填）、production.cavities / qty / line、process.pourPos / Ho / ph、wallUsed（STL 已填可改）。手动模式（无 STL）：体积/重量/壁厚/Mc 全部手填。

**传递机制**：结构化数据对象（CastingProject 共享参数 + results 对象），**无"UI 文本解析"** ✓（16.txt 十五要求已满足）。

## 10-11. 计算核心共享与重复代码

- **共享**：`calcs/` 10 个模块为唯一计算核心，三条调用链共用（见第 0 节表格）。
- **重复**：① `matKeyOf` 家族映射 3 份拷贝（calcManifest/designCenter/wizard）；② `familyOf` 前缀映射 2 份（context.js / wizard.js）；③ 各视图内联的 showToast/esc/fmt 小工具。均为非计算逻辑的映射/工具重复，合并风险低。

## 12. 当前 Workflow 的问题（代码确认）

| # | 问题 | 证据 | 严重度 |
|---|---|---|---|
| W1 | **V3 热结引擎未接入 UI**——designCenter/结果中心全部走 `engine/hotspot.js`（V2），13-15.txt 验证完毕的 V3（17/20 工程测试、100万 tri 3.7s）与产品 UI 完全隔离 | `designCenter.js:12` `hotspot.js` 头部（V1/V2 逻辑） | **高（功能差距）** |
| W2 | **STL 替换不完整清理**：再次选文件可覆盖（无明确"替换"交互），但 `USER_OVERRIDE` 参数（用户改过的 wallUsed/mcUsed/weightKg）不会被新 STL 更新（`set()` 的来源保护）→ 旧模型值残留到新模型 | `CastingProject.js:109-122`（set 的 src 分支）`designCenter.js:393`（mcUsed 的 USER_OVERRIDE 保护） | **高（16.txt 六/十八 直接违反）** |
| W3 | **STL 删除完全不存在**（无任何清理入口） | `designCenter.js` 全文无删除逻辑 | 高 |
| W4 | **页面刷新后 STL 参数残留污染**：CastingProject localStorage 持久化 geometry.*/hotspots.*/process.*，刷新后 `state.mesh` 丢失（内存）但参数仍显示为"自动获得"——出现"无 STL 但有 STL 数据"状态（16.txt 测试 K 必失败） | `CastingProject.js:85`（localStorage 载入）`designCenter.js:195`（restore 依赖 state.mesh） | 高 |
| W5 | **参数来源不在 UI 显示**：SRC 元数据（🟢STL/🔵派生/🟡用户）完整存储但渲染时丢弃——用户无法一眼知道"这个数字是谁提供的" | `designCenter.js:620-648`（renderParams 无来源徽章） | 中（16.txt 七） |
| W6 | **无完整报告导出**：结果中心只展示不导出；wizard 有 HTML 报告但仅含 gating+riser 两模块、且与 STL 数据无关 | `resultsCenter.js` 全文无导出；`wizard.js:428-437`（报告仅 2 模块） | 中（16.txt 二十） |
| W7 | **模块状态（○◐●⚠）未实现**：任务勾选有，但"已完成/等待输入/有问题"状态不可见 | `designCenter.js:498-520`（renderTasks 无状态） | 中（16.txt 十四） |
| W8 | **结果平铺无模块导航**：一次渲染全部模块结果（长页面），无"左/顶导航 + 当前模块"（16.txt 十三推荐） | `resultsCenter.js:99-197` | 低-中（产品形态选择） |
| W9 | **双入口并存**：设计中心（8 任务 + STL）与工艺向导（6 步 + 2 模块 + 报告）互不相通——wizard 不读 CastingProject、不接 STL、状态不持久 | `wizard.js:26-33`（state 局部变量，进入即重置） | 中（16.txt 十：需明确分工或统一） |
| W10 | 线收缩率（shrinkage）是有计算核心的计算器但无 manifest、不在设计中心——13 工具中唯一"有核无位"的计算型工具 | `registry.js` 有、`calcManifest.js` 无 | 低（16.txt 十排序时处理） |

## 13. 当前 UI 的主要问题

1. 设计中心参数区两栏混排（自动参数 + 缺失参数），无来源徽章、无模块状态——信息层级弱（16.txt 七/十四）
2. 结果中心一次平铺全部模块，长页面无导航（16.txt 十三倾向"模块导航 + 当前模块"）
3. 模型信息卡有雏形（dc_geomCard：尺寸/体积/面积/壁厚/三角面 + 距离场诊断），但**无热结数量/M 汇总、无采样状态 WARNING**（16.txt 五的"采样状态/欠解析警告"缺失）
4. 无 [替换 STL]/[删除 STL] 按钮（16.txt 六）
5. 无 [生成完整报告] 按钮（16.txt 二十）

## 14. 推荐的最小改造方案

**原则（16.txt 一/二十一）：以设计中心为基底扩展（已有 80% 结构），不新建页面，不动计算核心，不重复造轮子。**

| 步骤 | 内容 | 对应 16.txt | 风险 |
|---|---|---|---|
| 1 | **V3 接入**：designCenter 的热结调用从 `analyzeHotspotsSliced(V2)` 换为 `analyzeHotspotsV3`（V3 纯引擎已有，API 适配：mc←peakModulus、regionVolumeCm3←regionVolume/1000、坐标不变）；保留 V2 结果对比入口（开发模式） | 十九（V3 黑盒调用） | 低（纯引擎已 17/20 验证；适配层测试） |
| 2 | **STL 会话绑定 + 刷新清理**：sessionStorage 存"当前会话 STL 指纹"；页面加载时若 CastingProject 有 STL 来源参数但无会话指纹 → 清 STL 来源参数（K 测试） | 十八.K | 低 |
| 3 | **STL 替换/删除**：UI 加 [替换 STL][删除 STL]；替换=完整清理 STL/DERIVED 来源参数（保留 USER_INPUT/USER_OVERRIDE 中与 STL 无关项）→ 重新导入分析；删除=同上清理 + 退回手动模式（已有 state.manual 结构） | 六 | 低-中（清理语义测试 C/D/E） |
| 4 | **来源徽章**：renderParams 每参数行读 `P().src` 渲染 🟢STL 自动 / 🔵计算得到 / 🟡用户输入；修改后变 🟡用户修改（src=USER_OVERRIDE 已有） | 七/八 | 低 |
| 5 | **报告导出**：resultsCenter 已有全部数据 → `saveFile` 生成完整 HTML（复用 wizard 报告样式），只含用户勾选模块 + 来源标记 + WARNING 段 | 二十 | 低 |
| 6 | **模块状态**：renderTasks 按 results 判定 ●已完成 / ◐等待输入（缺参数）/ ○未选择 | 十四 | 低 |
| 7 | **Workflow 排序**：输出 `PHASE16_WORKFLOW_ORDER.md`（按真实依赖排序，见 16.txt 十参考但不硬套） | 十 | 纯文档 |
| 8 | **测试**：新增 workflow 测试 11 项（16.txt 十八 A-K）——其中 K（刷新污染）由步骤 2 解决，C/D/E（替换/删除）由步骤 3 解决 | 十八 | — |

**明确不做**：不改 calcs/ 公式（16.txt 一.10）、不改 V3 内核（十六.十九）、不重写 UI 框架（二十二）、不引入状态管理库（十六）。

**预计影响面**：`designCenter.js`（主）、`resultsCenter.js`、`CastingProject.js`（+clearStlParams 辅助）、`calcManifest.js`（+shrinkage manifest 可选）、`tests/`（新增 workflow_test.mjs）。

---

## 附录 A：审计清单 A-P 答案速查

- **A. 计算器**：13 个（见 §3 表）
- **B. 工艺计算入口**：设计中心（主）+ 工艺向导（副，2 模块）
- **C. STL 导入后**：自动几何分析 + 热结分析（V2）+ 参数自动填入
- **D. STL 数据保存**：内存 state.mesh + CastingProject localStorage
- **E. STL 自动提取**：尺寸/体积/面积/壁厚×3/重量/三角面/热结列表/Mc
- **F. 自动填入**：8 个 manifest 计算器的共享参数（weightKg/size/wallUsed/mcUsed/family 场景预填）
- **G. 手动输入**：材料大类（可预填）、一模件数、浇注方向/Ho/ph、造型线等；手动模式全手填
- **H. 计算器间调用**：yield←gating/riser；charge←yield/gating（results 对象结构化传参）
- **I. 工艺计算调用原计算器**：**是（单一核心，见 §0）**
- **J. 重复计算逻辑**：无（仅 3 份家族映射表拷贝，非计算逻辑）
- **K. UI 组织**：侧栏 4 项 + 设计中心 4 段式（任务→参数→热结→模型信息）
- **L. 结果保存**：内存 state.results + proj.setResult（runner.result/risers.items/yield.result）→ localStorage
- **M. 报告机制**：仅 wizard 有 HTML 报告下载（2 模块）；设计中心无
- **N. 换 STL 需重开页面**：不需要（可再次选文件），但清理不完整（W2）
- **O. 删除 STL**：**无**（W3）
- **P. 同 Workflow 重新导入**：可，但旧值残留（W2/W4）

## 附录 B：已存在的好结构（实施时保留）

1. `CastingProject.js`：P() 来源元数据模型（SRC/CONF/editable）——16.txt 七/八的**数据层已完整**，只缺 UI 展示
2. `calcManifest.js`：manifest 驱动 + missingInputs 自动判定——16.txt 十二"只显示缺失参数"已实现
3. 手动模式（state.manual）——16.txt 四模式 B 已实现
4. 任务勾选 + PARAM_BY_TASK 联动——16.txt 九已实现
5. 共享参数自动复用（yield/charge 依赖链）——16.txt 十五已实现
6. 结构化数据传递（无 UI 文本解析）——16.txt 十五 ✓
7. 分片执行防冻结（MessageChannel yieldFn）——大模型导入体验已处理
8. 生产场景（context.js）预填——跨入口自动带材料/造型线

**结论**：PHASE 16 的骨架（编排层 + 数据层 + 共享核心）在代码中已存在且验证过；本阶段实际工作是 **8 项增量改造**（V3 接入、STL 状态管理、来源徽章、报告导出、模块状态、刷新清理、顺序文档、11 项测试），全部低-中风险，无架构推翻。
