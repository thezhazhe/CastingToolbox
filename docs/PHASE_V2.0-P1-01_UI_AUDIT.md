# PHASE V2.0 · P1-01 工艺设计中心 UI 现状调查（只读）

> 命令文件 `140.txt` §四。**本阶段未修改任何 UI 代码、未调整任何计算逻辑。**
> 依据 = **当前工作区实际代码**（P0-22 冻结状态，指纹见 `docs/PHASE_V2.0-P0-22_FREEZE.md` §4）。
> 所有结论附 `文件:行号`；无法从代码确认的一律标 **【待确认】**。

---

## 0. 结论摘要（先读这段）

**现状一句话**：工艺设计中心是**单列纵向流** —— 3D 工作区在上、参数面板在下，结果是**下方独立的页签区**（`#dc_results`）。
参数**输入即写入** `CastingProject` 单例并落 localStorage（**没有"保存"按钮**）；计算由唯一的「🚀 开始工艺分析」触发，
之后改参数会 **600ms 防抖自动重算**。页面滚动是**文档级**的，3D 会随页面滚出视口。

**与计划 UI 的差距（详见 §6）**：

| 计划 | 现状 |
|---|---|
| A 近全屏 3D 主工作区 | 3D 是页面中一段 `min(64vh, 720px)` 的区块，**会随页面滚动移出视口** |
| B 左侧栏（导入前引导 / 导入后信息+步骤+入口） | **没有左栏**；概览卡与参数面板都在 3D 下方 |
| C 顶部工具栏（模型管理/工艺参数/冒口/浇注/结果） | 顶部只有 chips + 3 个按钮；功能靠**页内页签**切换 |
| D 分模块填写与保存、结果失效判断 | 冒口/浇注**共用同一个 `#dc_params` 容器**；**无"保存"概念**；`state.stale` 是**死代码**（无 UI 消费者） |
| E 不改公式/默认值/单位/契约 | 现状可直接沿用（本报告 §2 已把契约逐条列清） |

**改造前必须先解决的 3 个技术前提（§7 高风险）**：

1. **3D 画布没有 `ResizeObserver`**（全库 grep 为空），只监听 `window.resize` ⇒ 一旦改成左栏/全屏布局，**画布尺寸会算错**。
2. **换 STL / 重进视图时旧 canvas 被 append 进新容器**，但 `ModelView3D.container` 仍指向**已脱离 DOM 的旧元素** ⇒ 窗口 resize 时 `setSize(0)`，且旋转/缩放/热结拾取全部失效。
3. **`#dc_params` 每次整体 `innerHTML=` 重建**，且冒口/浇注两组共用一个容器 ⇒ 拆成"独立参数面板"时必须保证**值不丢、焦点不丢**。

---

## 1. 当前页面结构

### 1.1 入口与路由

| 项 | 位置 |
|---|---|
| 侧栏入口 | `index.html:55-58`（`data-view="designCenter"`） |
| 路由注册 | `js/app.js:33`（`designCenter: designCenterView`）；hash 解析 `js/app.js:58-62` |
| 渲染容器 | `#view`（`index.html:116`，写入 `js/app.js:74`） |
| 视图模块 | `js/views/designCenter.js:276` → `render(container)` |
| 切视图行为 | 仅替换 `#view` 的 `innerHTML`；`window.scrollTo(0,0)`（`js/app.js:67,74`） |

### 1.2 DOM 分区（`js/views/designCenter.js:281-368`）

```
.page-head
└─ .dc-ws                       （纵向 flex，css/app.css:960）
   ├─ .dc-topbar                (:288)  chips + 按钮（见 §4.3）
   ├─ #dc_castCard              (:301)
   ├─ .dc-main                  (:303)  ★ 恒定单列（css/app.css:969）
   │  ├─ .dc-stage              (:305)
   │  │  ├─ #dc_importZone      (:306)  拖拽/选择 STL
   │  │  ├─ #dc_validate        (:312)
   │  │  ├─ #dc_progress        (:314)  分阶段进度条
   │  │  ├─ #dc_hsBadge         (:318)
   │  │  └─ #dc_view3d          (:319) → #dc_view3dBox(:320) + .dc-view-controls(:324)
   │  └─ .dc-panel#dc_panel     (:346)
   │     ├─ #dc_overviewCard    (:347)
   │     ├─ #dc_hotspotsCard    (:351)
   │     └─ #dc_paramsCard      (:356) → #dc_params(:358) + #dc_run(:360)
   └─ #dc_results               (:366)  ★ 默认 hidden，结果显示区
```

★ **滚动发生在文档级**（body/window）：`.view` 只有 padding + `max-width:1080px`（`css/app.css:157-163`），
**没有任何内部滚动容器**，body 无 overflow 限制（`css/tokens.css:158-168`）。
⇒ 3D 区块会随页面滚动离开视口，这正是 A 项要解决的问题。

★ **`70%/30%` 的注释已过时**：`designCenter.js:304` 与 `css/app.css:959` 仍写"70%/30% 分栏"，
但 `css/app.css:969` 已是 `grid-template-columns: minmax(0,1fr)`（PHASE 78 起不再宽屏分栏）。
**UI 改造时不要被这两处注释误导。**

### 1.3 3D 工作区

| 项 | 值 | 位置 |
|---|---|---|
| 技术 | three.js **r160**，本地 `vendor/`（无 CDN） | `vendor/three.module.js:6`；importmap `index.html:205` |
| 组件 | `js/views/components/modelView3D.js` | 容器 `#dc_view3dBox` |
| 容器高度 | `min(64vh, 720px)`（生效值）；基础样式 300px 被覆盖 | `css/app.css:971` / `:909` |
| 交互 | OrbitControls 旋转/缩放/平移（含触摸，阻尼开） | `modelView3D.js:47-49` |
| 渲染 | **按需 rAF**（`_needsRender` 标志，静止不重绘） | `modelView3D.js:113-120` |
| 尺寸来源 | 构造时读 `container.clientWidth/clientHeight` | `modelView3D.js:45,52` |
| 尺寸更新 | `resize()`；**唯一触发 = `window.resize`** | `modelView3D.js:122-128,106` |
| 全屏 | **未实现**（无 Fullscreen API 调用） | — |
| 显示模式 | 实体/线框/透明 | `modelView3D.js:531` |
| 视角预设 | 7 个（前/后/左/右/顶/底/等轴） | `modelView3D.js:516` |
| 热结拾取 | pointerdown 即时选中 + 回调 | `modelView3D.js:108`；`designCenter.js:717-718` |
| 网格拾取 | `pickMode`（pointerup 且位移 <4px） | `modelView3D.js:98-103,353` |

**参数面板折叠不影响 3D**：折叠只切 `#dc_paramsWrap` 显隐（`designCenter.js:399-405`），
单列布局下 3D 宽度不变，故当前不调 `resize()` 也没出问题 —— **改成左右分栏后这条前提就没了**。

---

## 2. 各模块：输入 / 默认值 / 自动提取 / 计算入口 / 输出 / 依赖

### 2.0 总览

设计中心执行的任务集是**固定**的：`FIXED_CALC_TASKS = ['shrinkage','machining','riser','gating','yield']`
（`designCenter.js:40`），顺序由 `RUN_ORDER` 决定（`calcs/calcManifest.js:578`，riser 前置 gating）。

| 模块 | 是否在设计中心内 | 计算入口（`calcs/calcManifest.js`） | 结果页位置 |
|---|---|---|---|
| 结构工艺性分析 | ✅ 恒在 | 无 calcs 入口（`calcs/castability.js` 供底层） | Page ① |
| 线收缩率 | ✅ 仅 Page① 卡片 | `calculate` `:90-97` → `calcs/shrinkage.js:48` | 卡片 + 报告 |
| 加工余量 | ✅ 仅 Page① 卡片 | `:486-509` → `calcs/machining.js:54,67` | 卡片 + 报告 |
| **冒口设计** | ✅ | `:176-341` → `calcs/riser.js runRiser` | **Page ②** |
| **经典浇注系统** | ✅ | `:100-174` → `calcs/gating.js runGating` | **Page ③** |
| 出品率 | ⚠ **算但不显示** | `:355-378` → `calcs/yield.js:45` | **已从设计中心剔除**（`resultsCenter.js:7,472-474`），仅报告/浇注页引用 |
| 冷铁/砂型/加料/开箱 | ❌ 不执行 | 声明在 manifest，**不在** `FIXED_CALC_TASKS` | 无（真实位置＝独立计算器） |
| Campbell / 垂直线浇注 / CT / 缺陷 / 原理 | ❌ 未进设计中心 | — | `#/calculators` |

### 2.1 结构工艺性分析

- **输入**：`material.family`（默认 `''` 未选，`CastingProject.js:59`）；`production.qty`（默认 1000，`CastingProject.js:71`）
- ⚠ **`qty` 在设计中心没有任何输入框**：已从 gating 声明删除（`calcManifest.js:123`），
  `renderParams` 也不含它（`designCenter.js:1095-1117,1234-1240`）⇒ **实际固定用 1000**。
- **自动提取**：`geometry.size/volumeCm3/areaCm2/wallMax/wallAvg/wallHist`（`designCenter.js:925-932`）、
  主体壁厚 → `process.wallUsed`（`:816-822`）、`process.wallHot = bodyRef/2`（`:824-827`）、
  `hotspots.items/status/reason`（`:796-809`）
- **入口/输出**：`buildPage1Data(pack)`（`processPage1.js:90`）→ `page1Html`（`:272`），输出 `{A,B,C,risks,notes,statusChip,hsStatus,...}`（`:265-266`）
- **依赖**：geometry + hotspots（STL）、material.family、`results.shrinkage/machining`
- **状态**：全部读 `CastingProject`，无自有存储；内存态 `sampling/bodyRef` 在 `designCenter.js:120-134`

### 2.2 线收缩率

- **输入**：`material.family`（未选则 `calculate` 直接 `return null`，`calcManifest.js:91-92`）；`geometry.size` 三方向（`:81`；UI `designCenter.js:1198`）
- ⚠ **收缩档位不可选**：`calculate` **硬编码** `'common'`（`calcManifest.js:94`），声明里的 `mode` 是 `param:null`（`:84`）被过滤（`:669`）⇒ 设计中心**无法切** free/restrained
- **表**：`SHRINKAGE`（5 材料 × free/common/restrained + range + note，`calcs/shrinkage.js:13-19`）
- **输出**：`dirs[{size,rate,amount,pattern,idx}] / directional / combined / spread / maxDim / mode / range / modeLabel`（`shrinkage.js:65`）

### 2.3 加工余量

- **输入**：`material.family`；`geometry.size`（取 `Math.max`，`calcManifest.js:487-488`）；可选 `production.method`（默认 `'不指定'`，`CastingProject.js:78`；未指定时**静默回退** `'砂型 · 机器造型/壳型'`，`calcManifest.js:496`）
- **表**：`RMA_TABLE` 13×10（`calcs/machining.js:18-32`）、`METHOD_GRADES`（`:75-81`）
- **输出**：`{min,max,mid,grades,methodLabel}` 或 `{unsupported:true,note}`（`:505-507`）
- **依赖**：geometry.size / material.family / production.method

### 2.4 冒口设计（**P0-22 冻结对象**）

- **进入方式**：内嵌面板「③ 冒口参数」（`designCenter.js:1228-1233`），**不跳转独立页面**
- **用户可填**：
  - 热结勾选列表（有热结时）：`checkbox[data-hs-pick]` + 「✎ 改 Mc」（`:1148-1172`）→ 写 `process.hsPick`（`:1327-1335`）
  - 弹窗 `#dc_hsModal` / `#dc_hsMc`（默认=检出值，`:1414-1450`）
  - 无热结/手动模式：单行 Mc 输入 `#dc_m_mc`，路径由 `mcDisplayPath()` 决定（有热结→`process.mcHotspot`，否则→`process.wallHot`，`:1066,1129-1138`）
  - ⚠ **冒口形状不在参数面板**，在**结果页**的下拉 `#dc_riserShape`（`resultsCenter.js:119-129`），默认 `'cyl'`
- **自动带入**：`process.mcHotspot` ← 最大热结 Mc（`designCenter.js:802-805`）；`process.wallHot` ← 主体壁厚÷2（`:823-827,946-949`）
- **默认骨架**：`mcHotspot/wallHot/riserHeight = 0`（=未填，`CastingProject.js:84-86`）、`hsPick []`（`:88`）、`riserShape 'cyl'`（`:95`）
- **计算入口**：`CALC_MANIFEST.riser.calculate`（`calcManifest.js:278-281` 声明 `mat,cast_wt,mc_mode,mc,shape,hd_ratio,eff,rho`；`:283-320` 多热结路径）
- **输出**：`D / H / Mr_act / Mr_target / targetRatio / d_neck / M_neck / neck_k / Vr / effV / cw / needVol / volOk / modOk / bind / converged / items / mcSrc / level`
  （`resultsCenter.js:59-93`，等级取 `LEVEL_TEXT[r.level]` `:140`，Mc 来源 `r.mcSrc` `:41-57`）
- **回写**：`process.riserHeight`（`designCenter.js:1722-1729`）→ 供 gating 使用
- ⚠ **`param:null` 的私有参数**：`shape` / `hd_ratio` 在设计中心**不渲染、不存储**（`calcManifest.js:185-186`），用声明默认。
  注意 `process.riserShape`（`CastingProject.js:95`）与这个私有 `shape` **不是同一个**。

### 2.5 经典浇注系统

- **参数与默认值**（骨架 → 计算 fallback）：

| 参数 | 默认 | 位置 |
|---|---|---|
| 浇注位置 `pourPos` | `'顶注'` | `CastingProject.js:81` |
| `Ho` 内浇道至上箱面 | 0=未填 → **150** | `:102`；`calcManifest.js:150`；placeholder `designCenter.js:1105` |
| `ph` 铸件高度 | 0 → **100** | `:103`；`calcManifest.js:150` |
| 冒口高度 `riserHeight` | 0，由 riser 回写 | `:86`；`designCenter.js:1722-1729` |
| 比例 `ratioKey` | `''`＝自动推荐 | `:94`；`designCenter.js:1176-1190` |
| 内浇道厚度 `gateThk` | 0 → **max(3, 主体壁厚÷3)** | `:90`；`calcManifest.js:30-33,156` |
| 内浇道个数 `ingateN` | 0 → 2 | `:73`；`calcManifest.js:32,155` |
| 横浇道厚度 `runnerThk` | 0 → 25 | `:92`；`calcManifest.js:38-40,159` |
| 横浇道条数 `runnerN` | 0 → 2 | `:75`；同上 |
| 排气孔直径 `ventD` | 3 mm（孔数自动） | `:98`；`calcManifest.js:47,167` |
| 型腔数 `cavities` | 1 | `:72` |

- **计算入口**：`CALC_MANIFEST.gating.calculate`（`calcManifest.js:130-173`；**内部调 `runGating` 两遍**以定排气孔数）
- **输出**：`G/t/A/vFinal/Fg/Fr_act/Fs_act/L_g/L_r/D_sp/D_g/vr/chokePosition/systemType/ventD/ventN/ventNeed`
  （`resultsCenter.js:250-319`，四张 stat 卡 + 尺寸/校核表 + `<details>` 计算过程 `:313-316`）
- **未集成到设计中心的同类工具**：`#/calculators/gating`（`js/views/gatingView.js:58`）、`#/calculators/vertical_gating`、`#/calculators/campbell_gating` —— **三者都不读写 `CastingProject`**

### 2.6 出品率（状态特殊，改造时容易踩）

- **算了但没页面**：`FIXED_CALC_TASKS` 含 `yield`，结果写 `yield.result`（`designCenter.js:1708,1731`）；
  但结果导航 `PAGE_ORDER` 只有 page1/riser/gating，`EXTRA_ORDER` 也不含 yield（`resultsCenter.js:475-480`）
  ⇒ `moduleHtml('yield')`（`:467`）**不可达**。可见处只剩：报告（`reportGenerator.js:155-156`）、
  浇注页的"出品率 yv / 实际出品率 ya"（`resultsCenter.js:257,275`）、参数区"预估出品率"输入（`designCenter.js:1100`）、
  独立计算器（`smallCalcs.js:244+`）、检测中心只读引用（`inspectionCenter.js:611,628`）
- **被 gating 反向依赖**：`yieldSug → 浇注重量`（`calcManifest.js:148`）；riser 的 `Vr` 又进 `riserWt`（`:372-376`）

---

## 3. 实际数据流与状态管理

### 3.1 统一载体

**`CastingProject`** —— ES 模块级**内存单例** + localStorage（键 `ct-project`）。
每个参数是元对象 `{v, src, conf, editable[, orig]}`（`js/model/CastingProject.js:27-29`）。
API：`get/getV`（`:184-194`）、`set`（`:203-229`）、`setResult`（`:242-244`）、`save`（`:251-253`）、
`onChange/notify`（`:254-255`）、`reset`（`:256`）。

### 3.2 数据流节点表

| 节点 | 数据对象 | 存放位置 | 写入者 | 读取者 |
|---|---|---|---|---|
| STL 解析 | `mesh{triCount,…}` | `state.mesh`（模块闭包 `designCenter.js:119-134`） | `importFile` `:609` | 3D、几何/热结分析 |
| 网格校验 | `validation{ok,issues}` | `state.validation` + `geometry.valid/geomStatus/meshIssues` | `validateMesh` `:625` → `writeGeometryToProject` `:917-924` | 门禁、概览、报告 |
| 几何分析 | `analysis` / `bodyRef` | `state` + `geometry.*` | `analyzeGeometrySliced` `:668` | 各 `calculate`、概览 |
| V3 热点 | `hotspots` | `state.hotspots` + `hotspots.*` | `analyzeHotspotsV3Sliced` `:697` → `writeHotspotsToProject` `:792-809` | riser/chill 门禁、结果页、检测中心 |
| **Mc** | `process.mcHotspot` / `wallHot` | 单例 | 自动 `:804,:826` / 用户 `:1322` | riser、chill |
| 工艺参数 | `P()` 元对象集合 | 单例 `material` / `production` / `process` | UI 绑定 `:1506-1543`、结果页内联 `resultsCenter.js:550-553` | 各 `calculate` |
| 计算链 | `results{}` | `state.results`（**内存**） | `runAnalysis` `:1704-1739` | `renderResultsCenter` |
| 结果回写 | `runner.result` / `risers.items` / `yield.result` | 单例（`setResult`） | `:1718-1731` | 报告、检测中心（只读） |
| 生产场景 | `{material,line,prod,method}` | localStorage `ct-context` | 向导 / 场景弹窗 / `exportToContext` `:1741` | 各视图预填 |
| 向导状态 | `state{}` | `wizard.js` 模块闭包（**不持久化**） | 向导各步 | 向导报告 |

### 3.3 公共数据 vs 模块私有

- **跨模块共享（全在 project）**：`geometry.*`、`material.*`、`production.*`、
  `process.*`（`mcHotspot/wallHot/wallUsed/riserHeight/gateThk/ratioKey/riserShape/ventD/hsPick…`）、`hotspots.*`、
  结果槽 `runner.result|risers.items|yield.result|results.summary`（`CastingProject.js:32-115`）
- **模块私有**：`state` 内的 `mesh/geometry(BVH)/analysis/view3d/unit/manual/tasks/results/stale/busy/hsFake/activePage`（`designCenter.js:119-134`）
- **声明为私有但会被别处读**：`shape/hd_ratio`（`param:null` + `scope:'calculator'`，`calcManifest.js:185-186`）

### 3.4 持久化键（全量）

| 键 | 存储 | 内容 | 版本/迁移 |
|---|---|---|---|
| `ct-project` | localStorage | 全项目参数 + 结果 | `mergeDeep` + `migrateProject`（`CastingProject.js:124-174`）；**无版本号字段**，靠字段存在性迁移 |
| `ct-context` | localStorage | 生产场景 | 无迁移（`js/context.js:9`） |
| `ct-theme` | localStorage | 主题 | 无（`js/app.js:52`） |
| `ct-dev` | localStorage | 开发模式 | 无（`js/devmode.js:9`） |
| `castingToolbox.locale` | localStorage | 语言 | 【待确认】非法值回退分支未逐行核验（`js/i18n/index.js:17`） |
| `ct-stl-fp` | **sessionStorage** | STL 会话指纹（名\|大小） | 无（`designCenter.js:111`） |
| `ct-detail-return` | sessionStorage | 详情返回路径 | 无（`js/app.js:97`） |
| `ct-defect-state` | sessionStorage | 缺陷查找表单快照 | 无（`defectFinder.js:144`） |

**无 `indexedDB`**。**`mergeDeep` 浅合并历史问题已修**（PHASE 78，`CastingProject.js:147-174`，
回归 `tests/phase78_test.mjs:49-80`），现规则：结构层递归、**参数对象/数组整体覆盖**。

### 3.5 参数修改后是否重算

- **首次必须点按钮**：`#dc_run`（`designCenter.js:360,383`）→ `runAnalysis()`（`:1685`）
- **之后自动重算**：`markStale(path)`（`:1547-1552`，依赖 `PARAM_OWNERS` `:44-51`）→ `autoRecompute` **600ms 防抖**重跑（`:1555-1564`），
  前置条件 `if (!state.results) return`
- ⚠ **`state.stale` 是死代码**：全文件仅"写/清"，**没有任何渲染读取**（`:129,1550,1740`）⇒ 页面上**没有"结果已过期"提示**
- ★ 对照：工艺**检测**中心口径不同 —— 输入变就直接**清空检测结果**逼用户重跑（`inspectionCenter.js:155-157`）

### 3.6 切模块 / 刷新 / 关弹窗

- **切模块**：`js/app.js:74` 只换 `#view` 的 innerHTML；模块级 `state` **存活**，回来走 `restore()`（`:415-418`）与 `restoreResults()`（`:539-545`）
- **刷新/新会话**：内存全失 → `stlSessionCheck()`（`CastingProject.js:437-446`；`designCenter.js:408-414`）
  检测到"项目有 STL 数据但内存无 mesh"⇒ 清 STL 绑定数据 + toast
- **关弹窗**：热结 Mc 弹窗挂 `document.body`（`:1439`），取消/点遮罩仅 `remove()` 不写数据（`:1441-1442`）；确认才 `applyPick`（`:1327-1335`）

### 3.7 重新导入 STL 后

`importFile` 先解析成功再清理（`designCenter.js:616-621`）→ `clearStlBoundData()`（`CastingProject.js:342-428`）：

- **无条件清**：geometry 校验/统计、`hotspots.*`、`process.hsPick`、`runner.result/risers.items/yield.result/results.summary`、`meta.stlSession`、全部 `orig` 基准
- **按来源清**：volume/area/wall*/重量（STL 分析来源 → 清；USER_INPUT → 保留）；`wallUsed/mcHotspot/wallHot/riserHeight` 非 USER_INPUT 才清
- **保留**：`material.*`、`production.*`、`process.pourPos/gateThk/runnerThk/ratioKey/riserShape/ventD/Ho/ph` 等与 STL 无关的用户输入

### 3.8 向导 vs 设计中心：**两套并行，互不共享状态**

`js/views/wizard.js` **完全不 import `CastingProject`**（grep 计数 0），自持 `state={}`，每次进入即清空（`:29-37`），
末尾**直接调纯函数** `runGating`（`:426`）/ `runRiser`（`:435`），值经函数参数传递。
**重复实现**：材质族映射 `familyOf/riserMatOf`（`:40-51`）、材料默认值、`G_DEFAULTS`（`:27`）——
与设计中心的 `calcManifest` + `process.*` **并行两套**，仅共享 `calcs/` 纯函数与 `ct-context`。

---

## 4. 当前布局与交互方式

### 4.1 布局

- 单列、文档级滚动、`.view` 上限 `1080px`（`css/app.css:157-163,969`）
- 3D 区块高度 `min(64vh,720px)`（`css/app.css:971`）
- 参数面板三段：概览卡 / 热结卡 / 参数卡（`designCenter.js:347,351,356`），参数卡可折叠（`[data-fold]`，`:357,399`）

### 4.2 结果区

- 页签：`PAGE_ORDER = ① 铸件结构工艺性 / ② 冒口设计 / ③ 经典浇注系统`（`resultsCenter.js:475-479`）
- **多热结是子页签制**（非分页器）：`items.length>1` 时渲 `#dc_hsTabs` + 多个 `.dc-hs-pane`（`:144-153`，点击切 hidden `:575-581`）
- 结果页内联可改参数：riserShape / gateThk / ingateN / ventD / runnerThk / runnerN → `applyParam` → `proj.set` + `onParamChange` → autoRecompute（`:550-573`；`designCenter.js:1766`）

### 4.3 现有顶部/工具条（**逐个列出，未实现的明确标注**）

| 区域 | 元素 | 位置 |
|---|---|---|
| 设计中心 `.dc-topbar` | `#dc_fileName` / `#dc_metaChip` / `#dc_unitChip` / `#dc_stlStatus`（chips） | `designCenter.js:289-292` |
| | `#dc_replaceStl` 📥导入STL · `#dc_deleteStl` 🗑️删除STL · `#dc_toInspection` 🔍工艺检测中心 · `#dc_manualLink` 📝手动输入 · `#dc_backToStl` 📄改用STL | `:294-298`（绑定 `:385-391`） |
| 3D 控件条 | `#dc_viewReset` ⟳重置视角 · `#dc_dispMode` 实体/线框/透明 · 7 个视角按钮 | `:321-338` |
| 参数区 | `#dc_run` 🚀开始工艺分析 | `:360` |
| 应用级顶栏 | `#globalSearch` · `#langSwitch` · `#themeBtn` · `#devLockBtn`(隐藏) · `#btnAbout` · `#btnSource`；另 `#ctxBar`(默认隐藏) | `index.html:86-104,107-114` |
| 结果页 | `#dc_again` 返回修改参数 · `#dc_report` 生成报告 · `#dc_openCalcs` 打开独立计算器 | `resultsCenter.js:527-529`（绑定 `designCenter.js:1779`） |

**模型管理**：模型列表 / 多模型 / 重命名 / STL 导出 —— **均未实现**（grep 无命中）。
只有：删除单模型（`#dc_deleteStl`，`:558-572`）、替换=重新导入。

### 4.4 导入流程（含进度）

`#dc_pick`（`:308`）或拖拽 `#dc_importZone`（`:376-381`，仅 `.stl`）→ `importFile`（`:609-755`）：
`parseSTL`（`js/engine/stl.js:15`）→ `clearStlBoundData` → `validateMesh`（`js/engine/meshValidation.js:14`）→
`buildMesh`（BVH）→ `ModelView3D` → `analyzeGeometrySliced` → `writeGeometryToProject` →
`analyzeHotspotsV3Sliced`（`js/engine/v3/hotspotV3.js:255`）→ `toViewResult` → `diagnoseSTL` →
`writeHotspotsToProject` → `renderParams/Overview/HotspotList` → `updateHsBadge` + toast。

**分阶段真实进度条** `#dc_progress`（`:314`，阶段表 `:152-162`），分片用 `MessageChannel` 让出主线程（`:654-658`）
⇒ UI 不冻结；`state.busy` + 按钮 disabled 防重入（`:610-613`）。

---

## 5. 保存与状态恢复机制

| 问题 | 事实 | 依据 |
|---|---|---|
| 有"保存"按钮吗 | **没有**（全文件 grep `保存/save` 零命中） | `designCenter.js` |
| 那参数怎么存 | 输入事件里直接 `proj.set(...)`，`set()` 内部 `touch()→save()` 写 localStorage | `:1525-1541,1675-1680`；`CastingProject.js:227,251-252` |
| 计算何时发生 | 首次点 `#dc_run`；之后改参 600ms 防抖自动重算 | `:1685,1555-1564` |
| 关弹窗会丢吗 | 热结 Mc 弹窗：确认才写，取消不写 | `:1441-1448` |
| 切模块会丢吗 | 不丢（模块级 `state` + 单例 + localStorage 三重） | `:415-418,539-545` |
| 刷新会丢吗 | 手填参数**不丢**；**STL 绑定数据被清**并提示 | `:408-414`；`CastingProject.js:437-446` |
| 独立计算器会存吗 | **完全落盘**（riser/gating/vertical/campbell 均不写 `ct-project`），离开视图即丢，只有材质经 `prefillMaterial` 从 `ct-context` 恢复 | `riserView.js:345`；`gatingView.js:744` |

⇒ **计划 D 项"必须区分保存与计算"在现状里完全没有对应物**：现在是"输入即落盘 + 自动重算"，
既没有显式的保存动作，也没有"已保存/未保存"的状态。这是 P1-01 改造中**语义变化最大**的一处。

---

## 6. 与计划 UI 的对应关系

| 计划项 | 现状 | 差距性质 |
|---|---|---|
| **A. 3D 主工作区**（尽可能大、少滚动、考虑全屏） | 3D 是页面中一段 `min(64vh,720px)`，文档级滚动会把它滚出视口；无全屏 | **布局改造**（CSS + DOM 结构） |
| **B. 左侧栏**（导入前引导 / 导入后信息+步骤+入口） | **无左栏**；导入前的引导是拖拽区 + 提示；导入后的信息在 3D 下方的概览卡/热结卡 | **新增结构**；现有卡片可整体迁移 |
| **C. 顶部工具栏**（模型管理/工艺参数/冒口/浇注/分析结果） | 顶部只有 chips+3 按钮；功能靠**页内页签**与**下方参数区** | **新增导航层**；注意"模型管理"当前**未实现**，不得写成已有能力 |
| **D. 分模块填写与保存** | 冒口/浇注**共用 `#dc_params`**（一次 `innerHTML=` 渲染，`:1242-1260`）；无保存按钮；无失效提示 | **语义改造**（最大风险区） |
| **E. 核心原则**（不改公式/默认值/单位/契约） | 契约已逐条列于 §2；`calcs/calcManifest.js` 是声明式适配层，**UI 改造只能调用它** | 约束，不是改造项 |

**能力清单澄清（避免把规划写成现状）**：
"模型管理"＝**未实现**（只有删除/替换）；"参数保存"＝**无按钮、隐式落盘**；
"分析结果失效提示"＝**未实现**（`state.stale` 死代码）；"全屏 3D"＝**未实现**。

---

## 7. 改造风险清单

### 高

| # | 风险 | 证据 | 说明 |
|---|---|---|---|
| H1 | **3D 画布尺寸不会跟随布局变化** | 全库**无 `ResizeObserver`**；唯一触发是 `window.addEventListener('resize')`（`modelView3D.js:106`），`resize()` 读 `container.clientWidth`（`:123`） | 改成左右分栏/全屏后，**窗口不变而容器变了**的每一次都会留下错尺寸画布（含首帧与折叠展开）。必须新增 `ResizeObserver`（或每次布局变化显式调 `resize()`） |
| H2 | **重进视图/换 STL 后 3D 交互失效** | `restore()` 把**旧 canvas** append 进**新 box**（`designCenter.js:592-593`），但 `ModelView3D.container` 仍指旧的、**已脱离 DOM** 的元素（`modelView3D.js:40`）；OrbitControls 与 pointer 监听都绑在旧元素上（`:47,97-108`） | 后果：窗口 resize ⇒ `setSize(0)`；旋转/缩放/热结拾取全部失效。**已有正确范式可抄**：`inspectionCenter.js:2013` 用"承载元素变了 → `dispose()` + 重建"（`state._sceneBox !== box`） |
| H3 | **保存/计算语义改造会与现有自动重算冲突** | 现状：输入即 `proj.set`+落盘（`designCenter.js:1525-1541`）；`autoRecompute` 600ms 防抖（`:1555-1564`）；`state.stale` **无消费者**（`:129,1550,1740`） | D 项要"填写-保存-计算"分离 ⇒ 必须引入草稿态并**关闭或改写 autoRecompute**；否则"保存"按钮形同虚设。**这是唯一会改变数据写入时机的一步，须单独小步做** |

### 中

| # | 风险 | 证据 |
|---|---|---|
| M1 | **两个模块共用一个参数容器**：拆成独立面板时值靠 `proj.set`+读回得以保全，但**焦点/光标**会丢（select 走 `rerenderCb` 整组重渲，数值走 `silentCb` 不重渲） | `designCenter.js:1242-1260,1377-1378,1403` |
| M2 | **旧结果残留**：① `importFile` 换 STL 时 `state.results=null`（`:629`）但**不隐藏 `#dc_results`** ⇒ 新 STL 导入后旧结果仍显示；② 单位下拉切换只 `writeGeometryToProject + renderParams`，**不触发** `markStale/autoRecompute`（`:1262-1266`）；③ `runAnalysis` 早退分支（busy/网格无效/未选材料/毛坯重无效，`:1692-1703`）**不清结果** | 同左 |
| M3 | **三入口并行两套默认值**：独立计算器 `riserView.js` 默认形状 `'sphere_head'`（`:18,84`）≠ 设计中心 `'cyl'`（`CastingProject.js:95`）；向导自持一套 | `wizard.js:27,40-51` |
| M4 | **i18n 是硬门槛**：每个 `tr('中文…')` 字面量都必须有 EN 条目（`tests/phase72_test.mjs` 的 72-T4），EN 值**不得含中文**（T5）⇒ 新增/改写的每一条 UI 文案都要同步 `js/i18n/en-US.js` | `js/i18n/en-US.js` |
| M5 | **已有 2 条死词条**：`'推荐冒口（自动迭代最优解）'`（`en-US.js:432`）、`'自动迭代至模数/体积双通过'`（`:964`）—— 渲染方已改，词条仍留。UI 改造清理文案时**要连带清词条**，否则 72-T4 需要它们存在 | `js/views/riserView.js:231` 注释可见渲染方已改 |

### 低

| # | 风险 | 证据 |
|---|---|---|
| L1 | **移动端/响应式**：`.view` 上限 1080px、3D `min(64vh,720px)`；浏览器脚本按 390×844 真机视口验过。全屏 3D 会改变移动端布局取舍 | `css/app.css:157-163,971`；`scripts/browser_responsive_test.mjs` |
| L2 | **`[hidden]` 会被 CSS 盖掉**（环境坑）：用 `hidden` 控制新面板显隐时，必须显式写 `[xxx][hidden]{display:none}` | `docs/HANDOFF_2026-10-07.md` §8.3 |
| L3 | **历史兼容不得清洗**：结果卡对旧结果回退 `r.Mr_need`（`resultsCenter.js:77`）、`js/views/riserStatus.js` 的旧结果分支（`bind==='limit'` 回退）—— 改造展示层时**保留** | `resultsCenter.js:77`；`riserStatus.js` |
| L4 | **浏览器测试不在 `npm test` 里**：`tests/runner.mjs` **不含**任何浏览器脚本（grep 无匹配）⇒ UI 改造后必须**手动另跑** `scripts/browser_dc_715_test.mjs` / `design_center_test.mjs` / `browser_stl_p22_test.mjs` / `browser_responsive_test.mjs`，否则**老断言变红没人看见** | `tests/runner.mjs`；`scripts/*.mjs` |

---

## 8. 待项目负责人确认的问题

1. **3D "近全屏"是否包含隐藏参数面板？** 若 3D 全屏时面板消失，用户改参数必须退出全屏 —— 与 E 项"数据完整性优先"如何取舍？
2. **顶部工具栏是"把现有页内页签搬上去"还是"新建一层导航"？** 现有页签（①②③ + EXTRA）已有稳定的 `data-*` 契约与测试。
3. **是否引入显式「保存参数」按钮？** 若引入，`ct-project` 的"输入即落盘"要改成"草稿 → 提交"两段；
   这会改变**已有自动重算**的触发时机（见 H3）。**这是本轮唯一的语义性变更，必须单独立项拍板。**
4. **模块间切换时未保存的草稿如何处理？**（丢弃 / 保留 / 提示）
5. **出品率页是否恢复？** 它当前被明确从设计中心剔除（`resultsCenter.js:472-474` 注"按 77.txt 剔除"），但仍在算。
6. **独立计算器（riser / gating / vertical / campbell）是否在本轮 UI 改造范围内？** 现有用户规则是"显示改动只改该模块"。
7. **`production.qty`（目标产量）输入框是否补回？** 它已从声明删除 ⇒ 结构工艺性分析**固定按 1000 件**评估（§2.1）。
8. **单位切换（`#dc_unitChip`）在改造后放在哪里？** 它当前会触发整组重渲，且**不触发重算**（M2②）。

---

## 9. 建议的小步实施顺序

> 原则：**每一步都保持"计算入口、字段名、id、`data-*` 不变"**，让现有测试与新截图可比对。
> 每步之后必须跑：`node tests/runner.mjs`（专项子集）+ **手动跑浏览器脚本**（L4）+ 截图人工比对。

| 步 | 内容 | 为什么排这个顺序 |
|---|---|---|
| **1** | **先修 H1/H2**（加 `ResizeObserver`；把 `restore()` 的 canvas 复用改成"承载元素变了即 `dispose()`+重建"，照抄 `inspectionCenter.js:2013`） | 纯技术加固，**不改任何 UI**；它是后面所有布局改动的地基。当前只是"没暴露"，一改布局就会集中爆发 |
| **2** | **DOM/ CSS 骨架改双列**：`.dc-main` 从单列改为"左栏 + 3D"，3D 高度由 `min(64vh,720px)` 改为占满可用高度 | 先把"看"的关系摆对；**元素 id 全部保留**，功能零改动，回归面最小 |
| **3** | **把概览卡/热结卡/步骤状态迁进左栏**；导入前的引导态单独做一版 | 信息搬家，仍不动计算与保存语义 |
| **4** | **参数面板分模块化 + 草稿/保存**（先冒口、后浇注）—— 前置：§8.3 拍板 | 唯一动到数据写入时机的一步，必须单独一步、单独验收 |
| **5** | **顶部工具栏导航层**（把 ①②③ 与模块入口收上去） | 依赖第 4 步的面板形态定型 |
| **6** | **3D 全屏/近全屏切换** + 移动端适配 | 最后做，因为它最依赖前面所有布局决定 |

**不建议做的**：一次性重构 `designCenter.js`（该文件已含闭包状态 + 参数渲染 + 分析编排 + 结果页装配四类职责）；
在没有 §8.3 结论前先写"保存"按钮；顺手统一"热节/热结/热点"术语（HANDOFF §7 已明确"单独立项，不要顺手改"）。

---

## 附：本次调查的取证方式与边界

- 四路**只读**代码调查（页面结构/3D、工艺参数模块、冒口+浇注模块、数据流与状态），互不重叠。
- 关键高风险项（H1/H2/L4）**由本人另行逐行复核**：`ResizeObserver` 全库 grep 为空、
  `modelView3D.js:106` 仅 `window.resize`、`designCenter.js:592-593` 的复用分支、
  `inspectionCenter.js:2013` 的对照守卫、`tests/runner.mjs` 不含浏览器脚本。
- **未做**：未运行浏览器、未截图、未做性能测量 —— 涉及运行时行为的判断已标 **【待确认】** 或写明"代码推断"。
