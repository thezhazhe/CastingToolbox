# PHASE V2.0-P1-R6 · S0 基线核实（阶段验收）

> 输入 `150.txt` §一 / §九·S0。**本阶段未修改任何产品代码、测试代码或资源**（只读盘点 + 一次只读探针，探针已删）。
> 依据文档：`PHASE_V2.0-P1-R4_WORKBENCH3.md`（146）、`…R5_UI_DESIGN_PROPOSAL.md`（147，方案 D）、
> `…R5_S1_CONTENT_RESTORATION.md`（149 S1）、`…R5_S0_ENGINEERING_AUDIT.md`（148）。
> ⚠ `docs/PHASE_V2.0-P1-R5_S2_IMPLEMENTATION_PLAN.md` **不存在** —— 147 只出了方案，没有出 S2 计划；本轮以 `150.txt` 为准。

---

## 0. 结论：S0 通过，可以进入 S1

四条依据：

1. **基线干净**：`main` / `da1c822`，10 个冻结指纹逐位未变，测试基线 874/1（唯一失败为历史遗留）。
2. **字段与帮助资源清单已建立且完整**（§3 / §4）：20 个可编辑字段 + 5 个只读项 + 8 块帮助内容 + 8 处结果页内联入口 + 1 处左栏入口，**逐条有行号**。
3. **依赖与红线已查清**（§5）：`#dc_view3dBox` = OrbitControls 的 domElement + ResizeObserver 观察目标；`#dc_paramDlg` 是常驻元素（与 `#dc_results` 同属 `.dc-body` 直接子节点）。
4. **发现 1 个既有真缺陷 + 1 批"真空通过"的断言**（§6），二者都不构成阻断，但 R6 必须正面处理。

---

## 1. 基线（§一 要求的第一组）

| 项 | 实测值 |
|---|---|
| 分支 / HEAD | `main` / `da1c822`（= V1.1.0 发布后的纯文档提交，**21 个阶段未提交**） |
| 工作区 | **107 项** = 36 个 `M` + 71 个 `??`（含本轮之前的全部 V2.0 阶段成果） |
| 版本号 | `js/version.js` → `1.1.0`（远端 main 也停在 v1.1.0，**P0-22 起的所有改动都没上传**） |

### 1.1 冻结文件指纹（10 个，逐位未变）

```
5cfcfef3  calcs/riser.js                    efdc2301  calcs/riserDreq.js
c1d3ec3c  calcs/calcManifest.js             d774532a  js/engine/v3/hotspotV3.js
8d61d26d  js/engine/v3/peakRegion.js        5957831c  js/engine/v3/sampling.js
48488b13  js/engine/v3/modulusField.js      80a763ef  js/engine/v3/configV3.js
5af64ae4  js/engine/meshValidation.js       1e3d96cc  js/engine/v3/v3ViewAdapter.js
```
9 个 sha256 与交接书 §3.2 逐字一致；`riser.js` / `riserDreq.js` / `calcManifest.js` / `hotspotV3.js` 的 md5
亦与 149-S1 开工时逐位一致。

### 1.2 测试基线（**未重跑昂贵全量**，沿用 149-S1 收尾的串行干净结果）

| 套件 | 结果 | 退出码 |
|---|---|---|
| `node tests/runner.mjs`（全量，84 个文件） | **874 通过 / 1 失败** | 1 |
| `browser_s1_test.mjs`（149 S1 新增 27 条） | ✅ 全部通过 | 0 |
| `browser_p78_test.mjs`（51 条） | ✅ 51 ✓ / 0 ✗ | 0 |
| `browser_dc_715_test.mjs`（146 验收） | ✅ 全部通过 | 0 |
| `browser_dc_r3_test.mjs`（P0-1/P0-2） | ✅ 全部通过 | 0 |
| `browser_responsive_test.mjs`（三档视口） | ✅ 全部通过 | 0 |
| `scripts/browser_i18n_audit.mjs` | ⚠ 核心页遗留 **7 处** | 1 |

**已知历史失败（唯一）**：`tests/phase24_test.mjs :: T5 关键真实 STL 热结数量零回归`
（`ALHR4510…stl 热结数应=5，实际 2`）。874 = 861（V2.0 基线）+ 13（149 S1 新增）。

### 1.3 ⚠ 退出码口径（本轮必须用对，否则会误判）

| 事实 | 影响 |
|---|---|
| `tests/hotspot_v2_test.mjs` **没有 `export const tests`** | runner 会 import 并执行它，但它的 pass/fail **不计入 874/1** |
| 它内部有 mini-runner 打印自己的「结果：N 通过 / M 失败」 | 这个数字**不是** runner 的统计，别混用 |
| 它末尾 `process.exitCode = fail ? 1 : 0` | 即使 runner 零失败，进程也可能带 1 退出 |
| 它有 `性能 < 8s` 门限（`:95`） | **机器负载敏感**：并行跑两个全量套件时实测 9397ms 报红，单独跑正常 |

⇒ 报告里**必须分清**「runner 统计内的失败」与「mini-runner 自己打印的红」。

---

## 2. 主要页面入口

| 路由 | 视图 | 入口 |
|---|---|---|
| `#/home` | `js/views/home.js` | `index.html:43` |
| `#/calculators`（15 个子路由） | `js/views/calculators.js` | `index.html:47` |
| `#/knowledge` | `js/views/knowledge.js` | `index.html:51`（hidden） |
| **`#/designCenter`** | **`js/views/designCenter.js`** | `index.html:55` ← 本轮重构对象 |
| `#/inspection` | `js/views/inspectionCenter.js` | `index.html:61` |
| `#/donate` | `js/views/donateView.js` | `index.html:65` |

* `js/app.js:28` `VIEWS` 表 → `:77` `VIEWS[view].render(viewEl, params)`；`:72` 给 `<body>` 加 `view-dc`。
* `designCenter.js` **全文件只有一个 export**：`render(container)`（`:366`）。**没有任何 view/model/engine import 它**。
* 切语言时 `js/app.js:239` 会 `relocalizeView(... () => render(...))` ⇒ **`render()` 会重跑 ⇒ `container.innerHTML` 整体重写 ⇒ `#dc_view3dBox` 换新元素**（这是 3D 生命周期的关键触发点）。

---

## 3. 字段清单（§一.3 / §4.1 的核查依据）

### 3.1 参数窗口可编辑字段 = **20 个**（`paramFields()`，`designCenter.js:575-628`）

| # | mod | path | 标签 | kind | 单位 | 标志 |
|---|---|---|---|---|---|---|
| 1 | cond | `material.family` | 材料大类 | select×5 | — | **required** |
| 2 | cond | `geometry.unit` | 模型单位 | select×4 | — | system:'unit' |
| 3 | cond | `process.wallUsed` | 主体壁厚（浇注时间用） | number | mm | **restore** |
| 4 | cond | `geometry.blankWeightKg` | 毛坯重量（含加工余量，计算口径） | number | kg | **required + restore** |
| 5 | riser | `process.mcHotspot` | 热节模数 Mc（冒口设计依据） | number | mm | mcRow + restore + mcHowto |
| 6 | riser | `process.riserShape` | 冒口形状 | select（RISER_SHAPES） | — | shapeRow |
| 7 | riser | `process.riserHeight` | 冒口高度 RH | number | mm | — |
| 8 | gating | `process.pourPos` | 浇注位置 | select×3 | — | **diagramRow** |
| 9 | gating | `process.Ho` | 内浇道至上箱面距离 Ho | number | mm | placeholder |
| 10 | gating | `process.ph` | 铸件高度（浇注方向）ph | number | mm | placeholder |
| 11 | gating | `process.ratioKey` | 浇注系统比例（直:横:内） | select | — | ratioRow + ratioHelp |
| 12 | gating | `process.gateThk` | 内浇道厚度 | number | mm | placeholder |
| 13 | gating | `production.ingateN` | 内浇道个数 | number | 个 | placeholder |
| 14 | gating | `process.runnerThk` | 横浇道厚度 | number | mm | placeholder |
| 15 | gating | `production.runnerN` | 横浇道条数 | number | 条 | placeholder |
| 16 | gating | `process.ventD` | 排气孔直径 | number | mm | placeholder |
| 17 | gating·prod | `production.cavities` | 型腔数（一模件数） | number | 件 | group:'prod' |
| 18 | gating·prod | `material.yieldSug` | 预估出品率 | number | % | group:'prod' |
| 19 | gating·prod | `production.line` | 造型线 | select×3 | — | group:'prod' |
| 20 | gating·prod | `production.method` | 铸造方法 | select×6 | — | group:'prod' |

**每个字段都有 `hint`**（渲染在 `.dc-dlg-note`，常驻）—— 这是 R6 最容易丢的东西之一。

### 3.2 只读项 = **5 个**（`readonlyRows()`，`:631-647`）

外形尺寸 / 体积 / 最大壁厚 / 净重（体积 × 固态密度）/ 热结数量 —— 每项带 chip「STL 自动识别」。

### 3.3 热结选择区（`hotspotPickHtml()`，`:1095-1128`）

每热结一行：勾选框 `data-dlg-hs` · `H{i}` · 检出模数 · 区域 cm³ · 置信度 ·
**逐热结 Mc 输入框 `data-dlg-hs-mc`**（未勾选时 `disabled`）· **`↺ 改回检出值` `data-dlg-hs-mc-reset`** ·
状态说明 `data-hs-pick-note`。

### 3.4 `#dc_paramDlg` **之外**的编辑入口（**必须全部保留**）

**A. 结果页内联 8 处**（`resultsCenter.js`，全部**即改即算、无草稿**）：

| id | 参数路径 | 行 |
|---|---|---|
| `#dc_riserShape` | `process.riserShape` | `:198-208` / 绑定 `:668` |
| `#dc_gtEdit` | `process.gateThk`（>0 才写） | `:264` / `:670` |
| `#dc_gcEdit` | `production.ingateN` | `:267` / `:671` |
| `#dc_gtReset` | 上面两个 = 0（回推荐值） | `:272` / `:672-675` |
| `#dc_rtEdit` | `process.runnerThk` | `:292` / `:679` |
| `#dc_rcEdit` | `production.runnerN` | `:295` / `:680` |
| `#dc_rtReset` | 上面两个 = 0 | `:301` / `:681-684` |
| `#dc_ventD` | `process.ventD` | `:320` / `:677` |

**B. 左栏 1 处**：热结列表「参与冒口」`data-hs-pick`（`:1888-1890` 渲染 / `:1917-1936` 绑定）
—— 写 `process.hsPick` + `SRC.USER_INPUT`，**即改即算**（写项目 → `markAllStale` → `autoRecompute`）。

**C. 全仓写参数只发生在** `designCenter.js` 与 `resultsCenter.js` 两个文件（grep 验证）。

---

## 4. 帮助资源清单（§4.3 的核查依据）

### 4.1 参数窗口内的 8 块帮助

| 块 | 生成函数 | 常驻/折叠 | 数据来源 |
|---|---|---|---|
| 来源图例 `🟢🟡🔵🟠` | 内联（`:807`） | **常驻** | 本文件字面量（i18n key；译在 `en-US.js:1336`） |
| 页脚共享+保存语义 | 内联（`:809-812` / `refreshDlgFoot` `:947-957`） | **常驻** | 同上（译 `en-US.js:1985`） |
| 20 条字段 `hint` | 内联（`:766`） | **常驻** | 本文件 |
| 冒口形状公式 **+ 补缩效率** | `shapeNoteHtml()` `:1005-1011` | **常驻** | import `RISER_SHAPES` / `RISER_EFF` ← `calcs/riser.js` |
| **Mc 来源五态说明** | `mcSourceNote()` `:968-990` | **常驻** | import `hsSourceInfo` ← `js/views/hsSourceNote.js` |
| ↺ 待恢复状态行 | `restoreRowHtml()` `:1077-1083` | 条件常驻 | 本文件 |
| Mc 的 4 种估法 | `mcHowtoHtml()` `:1014-1025` | 折叠 | 本文件（出处标注为独立计算器） |
| 浇注比例 7 条适用范围 + ⓘ | `ratioHelpHtml()` `:1028-1042` | 折叠 | import ← **`gatingView.js`**（`RATIO_APPLIC`/`ratioHelpRows`/`RATIO_HELP_*`） |
| **浇注方向示意图** | `gatingDiagramHtml()` `:1052-1059` | **常驻** | import `gatingDiagramSvg` ← `js/views/gatingDiagram.js` |
| 浇注系统 5 条工程原则 | `gatingEngNotesHtml()` `:1062-1069` | 折叠 | import `ENG_NOTES` ← **`gatingView.js`** |

### 4.2 全仓 `gatingDiagramSvg()` 调用点（源码树）

定义 `gatingDiagram.js:36` ← **产品侧只有两处调用**：`designCenter.js:1053`、`gatingView.js:320`。
（`dist/` 下的副本是历史打包产物，不参与本轮。）

### 4.3 结果页有效导航提示

`resultsCenter.js` 结果区：`#dc_resultNav`（三类别）+ `#dc_resultActive` + `#dc_again`（返回工作台，`:643` 自绑）
+ `#dc_report`（生成工艺计算报告）；`designCenter.js:2205` 绑 `#dc_openCalcs`。

---

## 5. 跨模块依赖与红线（§一.6 / §五）

### 5.1 ★ 3D 生命周期红线（146 §5 的根因，重构最容易再踩）

| 事实 | 位置 |
|---|---|
| `#dc_view3dBox` **就是**传给 `OrbitControls` 的 domElement | `modelView3D.js:68` ← `designCenter.js:1472, 1523` |
| OrbitControls 在 pointerdown 对它 `setPointerCapture` | `vendor/controls/OrbitControls.js:1000` |
| ⇒ **落在它内部的按钮，click 处理器永远不会被调用** | 注释原文 `designCenter.js:428-435` |
| 现有浮层控件（`#dc_viewReset` + `.dc-view-controls` 7 键）都是它的**兄弟节点** | `:437` / `:438-453` |
| `ResizeObserver` 观察的就是它 | `modelView3D.js:144-145` |
| ⇒ **面板开合改宽度时，画布自动跟随**（不需要新代码，但必须验收） | 同上 |

**全文件 `dispose()` 3 处**：`deleteStl`（`:1428`）、`restore`（`:1470`，**唯一带承载元素比对**）、`importFile`（`:1518`）。
**新建 2 处**：`restore`（`:1471-1475`）、`importFile`（`:1523-1525`）。两处前置都有 dispose。

### 5.2 布局 DOM 契约（会被 R6 直接改动）

| 契约 | 设置点 | CSS |
|---|---|---|
| `body.view-dc` | `js/app.js:72`（**不在 designCenter 内**） | `app.css:963-973, 1423` |
| `.dc-ws` / `data-wsview` / `data-flow` | `render()` `:381` / `setWorkspaceView()` `:1286` / `syncFlowChrome()` `:1242` | `:975-981, 985, 1012-1013, 1090-1091` |
| `.dc-main`（**当前 `300px minmax(0,1fr)`**） | `render()` `:399` | `:1008-1011`；`<960px` 单列 `:1398` |
| `.dc-rail` | `render()` `:401` | `:1082-1092`；`<960px` 已是抽屉 `:1403-1411` |
| `.rail-open` | `render()` `:519-520` / `renderHotspotList()` `:1912` | `:1411` |
| `#dc_results`（class **`.dc-resview`**，⚠**不是** `.dc-results`） | `render()` `:460` | `:1013, 1054-1079` |
| `#dc_paramDlg`（`.dc-dlg`） | `render()` `:463` 创建 / `:796` 填充 / `:692` 清空 | `:1224-1225`（`position:absolute; inset:0; z-index:72`） |

⚠ **`#dc_paramDlg` 与 `#dc_results` 都是 `.dc-body` 的直接子节点**，而 `.dc-dlg` 的定位依赖
`.dc-body{position:relative}`（`:1007`），`.dc-topbar{z-index:75}` 压住 `.dc-dlg{z-index:72}` ——
"对话框打开时工具栏仍可点"这条契约由**这个结构**决定，重构时不能拆散。

### 5.3 视图间调用关系（全部经 opts 回调，无反向 import）

```
app.js ──render()──► designCenter.render(container)
designCenter ──import──► resultsCenter.renderResultsCenter(box, results, {
     ctx, active: state.activePage,
     onNav: k => state.activePage = k,
     onParamChange: () => autoRecompute(container),      ← 结果页改参数 → 600ms 防抖重算
     onBack: () => { setWorkspaceView(container,'model'); syncFlowChrome(container); }
   })
designCenter ──import──► processPage1.srcTagHtml(p, hasStl, {restorePath})
designCenter ──import──► hsSourceNote.hsSourceInfo({9 个字段})
designCenter ──import──► gatingView.{RATIO_APPLIC,ENG_NOTES,ratioHelpRows,RATIO_HELP_*}
designCenter ──import──► gatingDiagram.gatingDiagramSvg(pos)
两者都直接读写 proj (CastingProject) —— resultsCenter.js:663/673/682 写
```
**`resultsCenter` 不 import `designCenter`**；`designCenter` 也**不绑** `#dc_again`（由 resultsCenter 重建时自绑，`:643`）。

### 5.4 监听器注册点（堆叠风险核查）

`designCenter.js` 共 **28 处** `addEventListener`，**0 处 `removeEventListener`**。逐个核查结论：

* `render()`（15 处）与 `renderStateChip` / `renderHotspotList` / `renderResults` 的注册目标
  **每次都是新元素**（先 `innerHTML` 重建）⇒ **不堆叠**。
* ★ **唯一确证的堆叠点：`:934`** —— `dlg.addEventListener('pointerdown', …)`，`dlg` = **常驻的 `#dc_paramDlg` 本体**
  （`render():463` 建一次，`renderParamDlg` 只改 innerHTML），而 `renderParamDlg` 在
  **685（开窗）/ 921（点 ↺）/ 927（点撤销）** 三处被调用 ⇒ 每开一次窗或点一次 ↺ 就多挂一个。

---

## 6. 本轮要正面处理的既有问题（S0 只记录，未修改）

### 6.1 ★ 真缺陷（**已实测复现**）：backdrop 关闭监听堆叠

**症状**：打开参数窗口 → 改动任一字段 → 点浮层空白处 → 确认框点「取消」→ **又弹一个确认框，再点再弹**。

**实测证据**（只读探针，跑完即删）：开窗 3 轮后点一次 backdrop ⇒ `window.confirm` 被调用 **4 次**（= 1 初始 + 3 轮）。
**根因**：`:934` 绑在常驻元素上，见 §5.4。
**处置**：R6 重写参数面板时**必然经过这段代码** ⇒ 顺带修掉（属 UI 交互缺陷，不碰计算契约）。

### 6.2 「真空通过」的断言（R6 会合法取代）

| 断言 | 为什么现在会过 |
|---|---|
| `browser_dc_715_test.mjs:300` 「145 · Mc 无手改入口」 | 查的是 `#dc_m_mc` / `[data-hs-edit]` / `#dc_hsModal` —— 149 S1 用的是 **`data-dlg-hs-mc`**，属性名不同 ⇒ **过是因为没查到，不是因为没入口**。该前提已被 149 §四正式取代 |
| `browser_perf_test.mjs:87` / `browser_responsive_test.mjs:100` / `browser_p72_test.mjs:136` 点 `#dc_manualLink` | 元素**已不存在**，靠 `?.` 静默空转；`browser_p72` 的 E 段整段依赖手动模式 ⇒ 已失效 |
| `browser_p72_test.mjs:156,173` 读 `.dc-src-badge` | 元素不存在（现为 `.dc-src-tag`）⇒ 静默得空串 |

**处置**：§2.3 的程序 —— 先确认旧行为已被正式取代 → 保留变更原因说明 → 用新行为断言**完整替代** → 不降覆盖强度 → 报告中说明区别。

### 6.3 少量死代码（R6 顺带清理，**只清确证无消费者的**）

| 项 | 证据 |
|---|---|
| `state.paramTab` | 只在 `:108` 定义、`:681` 赋值，**全文件无读取点** ⇒ 本轮正好用它做面板子模块切换（**复活而非删除**） |
| `state.container` | 只在 `:532` 赋值，**无读取点** |
| `canSaveDraft` | `:958` 恒 `true`，无调用点 |
| 死 import ×4 | `computeBounds`(8)、`analyzeHotspots`(12)、`HS_SRC_KIND`(25)、`methodGradeRec`(28) —— 全文件仅 import 行出现 |
| 半死 import ×2 | `analyzeGeometry`(11)、`resolveYield`(27) —— 仅在注释里被提及 |
| `#dc_stlStatus` | 恒 hidden（147 §1.6 已记） |

### 6.4 会因重构而需要更新的断言（预估，S1/S2 逐阶段实测确认）

| 脚本 | 断言 | 原因 |
|---|---|---|
| `browser_dc_715_test.mjs` | `146 §4.3 · 左栏恰好两个主体区域` | **左栏取消** ⇒ 判据要改指右面板 |
| 同上 | `146 §3.1/§3.2/§3.4 · 参数窗口 …` | 参数从模态迁入面板 |
| 同上 | `!#dc_panel` / `!#dc_params` / `!#dc_modTabs` 等一批反断言 | 「不能退回 145 那套」的原意必须**用新结构重新表达**，不是简单删掉 |
| `browser_p78_test.mjs` | `:114` 读 `#dc_rail` bounding rect | 左栏取消 |
| `browser_dc_715_test.mjs` | `热结勾选列表在左栏热结卡内` | 热结列表迁到面板 ① |
| `browser_stl_p22_test.mjs` | 读 `#dc_rail` / `#dc_overviewCard` | 同上 |
| **`tests/phasev20s1_test.mjs`（149 S1 我自己写的）** | `:367-374` 断言 `state.draftRestore` / `canRestorePath` / `mcSourceNote()` 的**具体写法** | 这些是**实现细节绑定**；R6 移动代码后必须改为**行为级**断言（同 §2.3 程序） |

---

## 7. 需迁移的功能与依赖（§九·S0.6）

| 现有物 | 迁移目标 | 依赖 |
|---|---|---|
| `#dc_rail` ① 分析结果概览（12 格 + 采样诊断） | 面板 ①「模型信息」：5 个关键数上移、诊断**折叠** | `renderOverview()` / `samplingDiagHtml()` |
| `#dc_rail` ② 热结列表（勾选 + 点击高亮） | 面板 ① 首要内容 | `renderHotspotList()` / `state.view3d.selectHotspot(i,false)` |
| `#dc_paramDlg` 三模块 20 字段 + 5 只读 + 热结区 + 8 块帮助 | 面板 ②③（A / B+C） | `paramFields()` / `readonlyRows()` / `hotspotPickHtml()` / 8 个 `*Html()` |
| 参数草稿 `state.paramDraft` + `state.draftRestore` | **原样保留**（§4.4） | `dlgValue` / `effValue` / `paramIssues(useDraft)` |
| 底部状态栏 6 chip | 合并进流程条节点状态 + 保留一行 | `renderStatusBar()` / `computeState()` |
| 结果视图（三层 + 返回） | **不动**（R3/R4 成果） | `renderResultsCenter` + 4 个回调 |
| 7 键标准视图 + 重置 + 热结选中不高亮移相机 | **不动** | `#dc_view3dBox` 兄弟节点结构 |

---

## 8. S0 零改动核对

```
HEAD  da1c822（未变）      工作区 107 项（与开工时逐位一致）
10 个冻结指纹           逐位未变（§1.1）
产品/测试/资源代码       未修改任何一行
本轮唯一执行的计算        一次只读探针（§6.1），建在 scripts/ 下、跑完已删除
临时产物                 已删（_probe_stacking.mjs / _edge_profile_probe）
```

**未提交 / 未推送 / 未发布；未执行 `git reset` / `checkout` / `clean` / `stash`。**

---

## 9. 进入 S1 的前置结论

1. **没有阻断**：字段、帮助资源、状态依赖全部可确认（§3/§4/§5）。
2. **布局可以按 `150.txt` §3.1 + R5 方案 D 实施**，且**现有 `<960px` 抽屉机制**（`.dc-rail` translateY + `.rail-open`）
   与 **`data-flow="A"` 隐藏左栏** 两条既有实现可直接改造复用 —— 不必从零写。
3. **S1 的迁移边界**：先把**左栏两块**搬进右面板（这一步就实现了"取消常驻左栏"），
   `#dc_paramDlg` 在 S1 阶段**保持原样可用**；S2 再把 20 个字段从模态搬进面板并删掉模态。
   这样每一阶段都**独立可验收、独立可回退**，且任何一阶段都不会出现"功能暂时不可用"。
4. **必须全程守住的一条**：浮层控件永远在 `#dc_view3dBox` **之外**；面板开合靠 CSS 列宽 + ResizeObserver，
   **不重建 3D 容器**。
