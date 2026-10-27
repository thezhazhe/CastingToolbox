# V2.0 · 工作台第三轮（145.txt）：三处 P0 修复 + 信息架构重定 + 明暗主题

日期：2026-10-15 · 范围：**工艺设计中心（`#/designCenter`）+ 三维视口主题** · **本轮不发布 V2.0**

基线：`docs/PHASE_V2.0-P1-R2_WORKBENCH.md`（固定视口工作台）

---

## 1. P0-1 · 冒口形状与尺寸显示

### 复现（先记录现象，再定位根因）

用四种形状跑真实参数（cube50 / 球铁 / Mc 由热结检出值决定），逐形状抓结果页：

| 形状 | 修复前：尺寸卡 | 修复前：速览卡 |
|---|---|---|
| 圆柱形 | 冒口直径 D ⌀100 mm · 冒口高度 H 100 mm | D ⌀100 / H 100 |
| 球顶圆柱 | 冒口直径 D ⌀100 mm · 冒口高度 H 100 mm | D ⌀100 / H 100 |
| 球形 | 冒口球径 ⌀100 mm · **冒口高度 H 100 mm** | D ⌀100 / H 100 |
| 正方柱 | 冒口边长 a 100 × 100 mm · 冒口高度 H 100 mm | a 100 × 100 / H 100 |

⇒ 用户报的"**尺寸显示似乎始终不变**"完全属实：速览卡四项 D/H/Mr_actual/Mr_target
**在四种形状下逐字相同**；"直径、半径等字段显示相同数值"也属实：球形把**同一个几何量**
（球径）同时显示成"冒口球径 ⌀100"和"冒口高度 H 100"两个字段。

### 根因（数值探针，只读 `calcs/riser.js`）

```
runRiser({ mat:'球铁', cast_wt:50, mc_mode:'direct', mc:13.8333, shape:k, hd_ratio:1.0 })
  cyl          D=100.000  H=100.00  Vr=785.4 cm³  eff=0.14  Mr_act=16.667
  sphere_head  D=100.000  H=100.00  Vr=654.5 cm³  eff=0.25  Mr_act=16.667
  sphere       D=100.000  H=100.00  Vr=523.6 cm³  eff=0.20  Mr_act=16.667
  square       D=100.000  H=100.00  Vr=1000.0 cm³ eff=0.14  Mr_act=16.667
  M(83,83):  cyl 13.8333( = D/6 ) · sphere_head 13.8333 · sphere 13.8333 · square 13.8333
```

**设计中心固定以 `hd_ratio = 1.0` 调用 runRiser**（`calcs/calcManifest.js:280`），
而四种形状的模数式在该口径下**全部化简为 M = D/6**：
`cyl`/`square` 的 `a·H/(2a+4H)` → D/6 · `sphere_head` 的 V/A → D/6（V=5πD³/24, A=5πD²/4）· `sphere` 本就是 D/6。
⇒ `DfromM` 反求出的 **D 与 H 对四种形状必然完全相同**。**这是引擎事实，不是缺陷**；
换形状真正改变的是 **Vr（785/654/524/1000 cm³）与补缩效率（14/25/20/14 %）**。

### 真缺陷（**全部在显示映射层**，冻结计算链一行未动）

1. 视图**没有使用引擎已经提供的** `RISER_SHAPES[k].label(D,H)`（四形状各自的规范尺寸写法），
   自己拼了一套残缺版本 ⇒ 圆柱 / 球顶圆柱 / 正方柱**标签与数值长得几乎一样**；
2. `sphere` 把"球径"与"高度 H"当两个字段重复展示（对球来说 H ≡ D，不是独立尺寸）；
3. `sphere_head` 的**球顶半径 R 从不显示**（引擎 `label()` 里本来就有 `（R50）`）；
4. 速览卡只放 D/H/Mr —— 恰好是四者**完全相同**的四项 ⇒ 切换形状时"屏幕上什么都没发生"。

### 修复

* `shapeSizeCells(it)`：尺寸文本全部取自 `RISER_SHAPES[k].label()`（单一来源）；
  按形状给**字段集**：圆柱/球顶圆柱/正方柱 = 尺寸 + 高度（球顶圆柱另加 **球顶半径 R**），
  **球形只有一个尺寸字段**（几何只有一个自由度）。
* 速览卡改为：**冒口规格**（引擎 label）· **冒口体积 Vr** · **补缩效率** · Mr_actual · Mr_target
  —— 前两项正是随形状变化的那两项。
* 新增一行如实说明（**不新增工程结论，只陈述工具自身口径**）：
  「本工具按 hd = H/D = 1 反求尺寸；四种形状的模数式在该口径下均化简为 M = D/6，
  因此**换形状不改变 D/H**。真正随之改变的是**冒口体积 Vr 与补缩效率**，可补缩量 = Vr × 补缩效率。」
* 详细表把 `冒口体积 Vr`（含"可补缩 N cm³"）拆成两行：`冒口体积 Vr` 与 `可补缩量（体积 × 补缩效率）`。

### 回归

`scripts/browser_dc_r3_test.mjs` 两组断言：
**① 引擎事实被钉住**（直接 import `calcs/riser.js` 调 runRiser，不靠 DOM 反推）：
四形状 D 相同、H 相同、**Vr 必须不同**、`shapeKey` 逐形状正确回传、界面尺寸 = 引擎反求值；
**② 显示层逐形状正确**：字段集（球形无高度 / 球顶圆柱有 R）、每个尺寸字段都带 `mm`、
规格写法逐形状不同且球顶圆柱带 R。

---

## 2. P0-2 · 结果页无法返回工作台

### 复现与根因

`#dc_again`（"↩️ 返回修改参数"）的处理器是：

```js
state.results = null;      // ← 把已完成的工艺分析结果**丢掉**
box.hidden = true;         // ← 同时隐藏结果区（但 DOM 没清）
container.querySelector('#dc_run').scrollIntoView(...)
```

⇒ 返回之后：再点「分析结果」会被判"尚未产生分析结果"并弹提示；步骤卡退回"未完成"；
**用户想再看结果必须重新点开始分析重跑一遍**；而 `#dc_results` 的 DOM 又没清空，
屏幕上形成"看不见但还在"的不一致状态。这正是 §二 P0-2 三条禁忌的合集。

### 修复

* 按钮改为**只切视图**：`setWorkspaceView(container, 'model')`——STL / 三维 / 结果 / 参数一律保留。
* 文案 `返回修改参数` → **`⤡ 返回三维工作台`**（新架构下"返回修改参数"已无意义）。
* 入口从页面底部移到**结果视图页首右侧**（§五：必须明显）；底部只留「生成工艺计算报告 / 打开独立计算器」。
* 结果视图内主按钮不再显示"查看分析结果"（那是死按钮）——由 `setWorkspaceView` 统一刷新为「重新分析」。

### 回归（`browser_dc_r3_test.mjs`）

起点 → 返回 → **结果长度不变、`#dc_results` 仍可见**→ 再进入立即回到同一份结果（无需重跑）→
往返 5 轮后画布唯一 / 结果长度不变 / `scrollY===0` / 页面无整体滚动 → 结果视图内主按钮 = 重新分析。

---

## 3. P1 · 信息架构重定（§三）

### 3.1 固定三步流程 + 五状态

```
1 导入 STL 模型 → 2 开始工艺分析 → 3 查看分析结果
状态只由**真实状态**判定：A 未导入(mesh 为空) · B 已导入未分析(results 为空) · C 正在分析(state.busy)
                          · D 完成(results 非空) · E 失败/条件不足(state.lastRun.ok === false)
状态写进 `#dc_ws[data-flow]`，顶部**唯一主操作按钮** `#dc_run` 的文案与动作随状态变化：
  A 「📥 选择 STL 文件」→ B 「▶ 开始工艺分析」→ C 「⏳ 正在分析…」(禁用)
  → D 「📋 查看分析结果」（结果视图内则变「🔁 重新分析」）→ E 「🔁 重新分析」
状态 D 的模型视图另给一个「🔁 重新分析」ghost 按钮（与"看结果"是**两件事**，不是重复按钮）。
```

### 3.2 移除手动参数输入入口与手动输入模式

**删掉的 UI**：参数对话框（`#dc_panel` / `#dc_dlgLayer` / `#dc_dlg*`）、参数区（`#dc_params`）、
模块页签（`#dc_modTabs` / `[data-modpanel]`）、草稿与保存（`[data-mod-save]` / `[data-mod-discard]` /
`#dc_draftWarn`）、`.dc-src-legend`、`.dc-link-hint`、「✎ 改 Mc」弹窗（`#dc_hsModal`）、
手动输入模式（`#dc_manualLink` / `#dc_backToStl`）、浇注方向示意图（`.dc-gating-diagram`）。

**删掉的 JS**（`designCenter.js` 2411 → 1500 行）：`renderParams` / `manifestRow` / `paramRow` /
`bindParam` / `bindManifestParam` / `guardNegative` / `refreshRowBadge` / `srcBadgeHtml` / `openHsMcModal` /
`showManual` / `backToStl` / `linkageHintHtml`，以及 `state.manual` / `state.mod` / `state.draft` /
`state.dlgOpen` / `state.dlgConfirm` 五个状态与整套草稿函数。
删除前 grep 全仓库确认**无其他消费者**；`.dc-src-legend` / `.dc-params-grid` / `.dc-dlg*` / `.dc-modtab*` /
`.dc-hsp*` 等死 CSS 一并清除（45 条规则）。

**参数来源（一字未改）**：

| 类别 | 处理 |
|---|---|
| STL / 已有可靠数据可得 | 照旧自动获取（几何、壁厚、热结、重量…） |
| 有可靠默认值 | **保留原默认值与原计算契约**（Ho=150 / ph=100 / 型腔数 / 出品率 / 浇注系统比例"自动推荐"…） |
| **无可靠默认值的必需项** | **只有一个：材料大类**（STL 识别不出材料）⇒ 作为「分析条件」显式要求指定，未指定时**明确说明无法计算的原因**，主按钮指向"去指定材料"；**绝不猜材料、不偷换默认值** |

**能力变化（如实记录，供拍板）**：随输入窗口移除的手工覆盖入口有 —— Mc、浇注系统比例、
Ho/ph/冒口高度、型腔数、预估出品率、造型线、铸造方法。它们**全部退回既有默认值**（默认值未改），
用户仍可通过「生产场景」影响材料/造型线/生产方式。**结果页的内联参数**（内浇道厚度/个数、
横浇道、排气直径、冒口形状 —— 78/79.txt 产品决策）**保留**，因为它们是"结果细化"而不是"主流程填参"。

### 3.3 左栏按阶段给内容

```
A（未导入）      只显示三步引导 + 导入 CTA（不再用空白信息卡填充页面）
B/C/D/E          设计步骤 → 分析条件（材料必填 + 模型单位）→ ① 分析结果概览 → ② 热结列表
```
* 热结勾选（"参与冒口"）**保留能力**，搬到**左栏热结列表本身**：勾选即写入项目并触发重算，
  没有弹窗、没有草稿/保存两段式。不勾选 = 按主热结 H1 自动设计（**与原默认一致**）。
  勾选取的是 `hotspots.items` 里**已四舍五入到 0.1** 的检出值（与列表显示的数字一致），
  不是 `state.hotspots` 的原始浮点（否则会写出 6.7708333 这种界面上从没出现过的数）。
* 单位选择搬进「分析条件」（`#dc_m_unit`）；切换行为与原实现一致（重写几何派生量 + 全部标过期 + 重算）。
* 概览底部提示改为"由 STL 自动识别（只读）"，**不再指向任何已删除的"去修改"入口**。

---

## 4. P2 · 明暗主题与三维视口协调（§四）

* 原视口背景是**硬编码纯黑 `#0b0f1a`**，亮色主题下"大面积纯白页面 + 纯黑视口"割裂感很强；
  模型本身是浅蓝灰 `0x9fb4d4`，换浅背景又会糊成一片。
* `modelView3D.js` 新增 **`VIEW_THEME`** 成套参数 + `applyTheme()`：
  | | 视口背景 | 模型色 | 环境光 | 半球光 | 平行光 | 坐标轴 |
  |---|---|---|---|---|---|---|
  | 暗色 | `#0F1522` | `0x9fb4d4` | 0.55 | 0.65 | 1.10 | 0.28 |
  | 亮色 | `#E7EDF6` | `0x6d8399` | 0.72 | 0.55 | 1.00 | 0.45 |
* 主题来源 = `data-theme`（`auto` 时跟随系统）；`MutationObserver` + `matchMedia` 监听，
  **在 `dispose()` 里断开**（不破坏既有资源释放纪律）。
* CSS 令牌新增 `--view-bg / --view-ctrl-bg / --view-ctrl-btn-bg / --view-ctrl-fg / --view-ctrl-border`，
  亮暗两套齐全；视口控件浮层与"重置视角"按钮同源。
* **不改**相机、坐标、缩放、旋转、热点定位与计算结果；ResizeObserver / dispose / rAF 生命周期未动。

---

## 5. P3 · 结果视图（§五）

* **第一层 结论速览**（`#dc_coreStrip`）：冒口页 = 规格 / Vr / 补缩效率 / Mr_actual（达标文字）/ Mr_target；
  浇注页 = t / A / 内浇道流速 / 排气比；工艺性页 = 四张详卡结论 + 状态文字。
  **只搬运已算出的值**（与详卡读同一批对象），不在视图层新增工程计算或判级。
* **第二层** `.dc-result-sec` 统一卡片；**第三层** `<details class="dc-note">` 折叠说明
  （旧体积模型参考仍只是**参考诊断**，文案一字未改，不暗示它决定尺寸）。
* 状态一律**文字 + 颜色**双通道。

---

## 6. 顺手修掉的既有缺陷

| # | 缺陷 | 说明 |
|---|---|---|
| 1 | **测试假绿**：`browser_dc_715_test` 的 ALR2510 段路径写死 `tests/golden/`，而该文件实际在 `tests/real-stl/` ⇒ `setFileInputFiles` 静默 no-op，断言读到的是**上一个模型的徽章文本**，恰好蒙对"未检出热结"。 | 改为跨目录解析 + **找不到文件直接抛**。文件真加载后实测该真实件在当前引擎下**检出 2 个热结** ⇒ 断言按实测事实重写。 |
| 2 | **`[hidden]` 被类选择器顶掉（全局）** | 移动端顶栏 `#devLockBtn` 明明 `hidden` 却**真的显示出来**并占 44px；`.btn{display:inline-flex}` 与 `[hidden]` 同权重、作者样式在后。`tokens.css` 加一条全局 `[hidden]{display:none!important}` 一次兜住（`.dc-ws [hidden]` 保留）。 |
| 3 | 工具栏文字被挤成竖排（移动端顶栏） | 动作组不得参与收缩：`.topbar-actions{flex:0 0 auto}` + 子项 `white-space:nowrap`。 |
| 4 | 结果页指向已删入口 | `resultsCenter` / `processPage1` 里 6 处文案仍写"参数与执行条件 → …" ⇒ 全部改为指向现存位置（左栏热结列表 / 独立计算器 / 生产场景）。 |
| 5 | 结果视图主按钮是死按钮 | 在结果视图里还显示"查看分析结果"（点了没新东西）⇒ 由 `setWorkspaceView` 统一刷新为「重新分析」。 |

---

## 7. 测试（真实退出码）

| 脚本 | 结果 | 退出码 |
|---|---|---|
| `node tests/runner.mjs`（全量 83 文件） | **861 通过 / 1 失败** | **1** |
| `scripts/browser_dc_715_test.mjs` | **全部通过** ✅ | 0 |
| `scripts/browser_p78_test.mjs` | **全部通过** ✅ | 0 |
| `scripts/design_center_test.mjs` | **全部通过** ✅ | 0 |
| `scripts/browser_responsive_test.mjs` | **全部通过** ✅ | 0 |
| `scripts/browser_dc_r3_test.mjs`（本轮新增：P0-1 / P0-2 回归） | **全部通过** ✅ | 0 |
| `scripts/browser_stl_p22_test.mjs` | 1 项失败 = **既有** `marker 半径有尺度差异（V3）` `r=[18.29,18.29]` | 1 |

### 7.1 全量 Node 套件

`node tests/runner.mjs` → **861 通过 / 1 失败 / 退出码 1**，与基线（144 轮）**逐字一致**。
唯一失败仍是历史遗留 `phase24_test.mjs :: T5`（ALHR4510 热结应=5 实测 2），本轮未触碰。

### 7.2 改动的既有断言（全部因**契约变更**，强度未降）

* `browser_dc_715_test`：参数区/对话框/草稿（D5/D6）与三按钮导航（D4）整段 → 换成
  **"旧入口必须彻底不存在"的正面断言** + 新 IA 断言（左栏四区、分析条件=材料必填+单位、
  五状态 `data-flow`、主按钮随状态给文案）；热结勾选改到左栏验证；D7 抽屉断言 → 放大态按钮可点；
  D8 单位切换改测 `#dc_m_unit`；ALR2510 段按实测重写。**并修掉了 importStl 的假绿。**
* `browser_p78_test`：79 联动提示 / B 比例下拉 / E 勾选+弹窗 三段 → 按新契约重写
  （行为保留的部分直接查项目数据；UI 被删的部分写成"已移除"断言，并保留"2 热结分子页签"）。
* `design_center_test`：参数区结构断言 → 新 IA；自动值改从项目读；**手动输入模式整段删除** →
  换成"无手动输入模式"断言 + "独立计算器不依赖 STL"（§一.9）。
* `browser_stl_p22_test`：面板顺序改为新左栏顺序；三条"参数面板/参数网格未溢出"（结构已不存在、
  恒真=等于没测）→ 改为对**现在真实存在的**左栏与三维工作区做同一件事。
* `tests/phase717_test.mjs :: 71.7-T5`：原断言要求结果页"提示示意图在参数区的位置"，
  该入口已删 ⇒ 反转为**不得引用不存在的入口**（悬空指引比缺提示更糟）。

---

## 8. 冻结指纹（`sha256`，逐位不变）

```
5cfcfef3 calcs/riser.js          efdc2301 calcs/riserDreq.js      c1d3ec3c calcs/calcManifest.js
d774532a js/engine/v3/hotspotV3  8d61d26d js/engine/v3/peakRegion  5957831c js/engine/v3/sampling
48488b13 js/engine/v3/modulusField 80a763ef js/engine/v3/configV3  5af64ae4 js/engine/meshValidation
1e3d96cc js/engine/v3/v3ViewAdapter
```

---

## 9. 人工截图验收（§七：实拍 14 张，逐张人眼看过）

`scripts/shot_dc_p1.mjs` → `screenshots/r3_*.png`：
① 明亮未导入 ② 明亮已导入待分析 ③ 暗色三维工作区 ④ 暗色分析完成工作区 ⑤ 结果速览+详细
⑤b 结果冒口详细 ⑥ 返回工作台 ⑦ 四种形状各一张（cyl / sphere_head / sphere / square）
⑧ 移动端暗色 ⑧b 移动端明亮 ⑨ 明亮分析完成。

**人眼检查发现并已修**：移动端顶栏 `#devLockBtn` 明明 hidden 却显示（§6.2）；
结果页文案仍指向已删的"参数与执行条件"（§6.4）。

---

## 10. 实际修改文件

```
js/views/designCenter.js          主重构（-911 行）
js/views/resultsCenter.js         P0-1 尺寸映射 + P0-2 返回入口 + 结果三层
js/views/processPage1.js          多热结提示指向新位置
js/views/components/modelView3D.js  明暗主题成套参数 + applyTheme（含 dispose 清理）
css/app.css                       新 IA 样式；删 45 条死规则；视口浮层用令牌
css/tokens.css                    视口主题令牌（亮/暗各一套）+ 全局 [hidden] 兜底
js/i18n/en-US.js                  145 全部新词条（共 147 条）
scripts/browser_dc_r3_test.mjs    **新增**：P0-1 / P0-2 回归
scripts/shot_dc_p1.mjs            改写为 §七 的 8 个指定状态
scripts/browser_dc_715_test.mjs / browser_p78_test.mjs / design_center_test.mjs /
scripts/browser_stl_p22_test.mjs / tests/phase717_test.mjs   按新契约更新
docs/PHASE_V2.0-P1-R3_WORKBENCH2.md  **新增**：本文
```

## 11. 未解决 / 需拍板

* **能力变化**：Mc / 浇注系统比例 / Ho·ph / 型腔数 / 出品率 / 造型线 / 铸造方法的手工覆盖入口
  已随参数窗口移除（§三 要求），全部退回既有默认值。**是否接受**请确认；若需要，可在结果页
  以内联方式补回（不改计算契约）。
* `browser_stl_p22` 的 `marker 半径` 与 `phase24 T5` 均为**既有**问题，本轮未触碰。
* 视觉验收仍靠人工逐张看；**自动化截图断言仍未做**。
* 结果视图第三层只折了「旧体积模型参考」一处。

## 12. Git

`main` / `da1c822`（未变）· 31 已修改 + 69 未跟踪。**未提交、未推送、未发布**；未执行
`reset`/`checkout`/`clean`/`stash`；未覆盖或删除任何既有工作。
