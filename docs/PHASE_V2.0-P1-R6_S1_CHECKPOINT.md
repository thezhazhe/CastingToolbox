# PHASE V2.0-P1-R6 · S1 基础布局重构（阶段验收 / 断点交接）

> 输入 `150.txt` §九·S1 + §十（阶段验收与停止规则）。
> 前置：`PHASE_V2.0-P1-R6_S0_BASELINE.md`（S0 基线，已通过）。
> **本文件是压缩/换会话后的续做依据** —— 只靠本文件 + 仓库即可继续，不依赖任何对话上下文。

---

## 1. S1 做了什么

| # | §九·S1 要求 | 实际落地 |
|---|---|---|
| 1 | 建立顶部流程导航 | 新增 `.dc-flowbar`（`#dc_flowbar`），**5 节点**：①模型 ②分析条件 ③工艺参数 ④分析 ⑤结果。状态**全部由真实数据判定**（`flowSteps()`） |
| 2 | 取消常驻左侧栏 | `.dc-rail` **DOM 与 CSS 全部删除**；原两块内容迁入右侧 `#dc_taskPanel` |
| 3 | 保留中央三维工作区 | `.dc-stage` **一字未动**；`#dc_view3dBox` 仍是 OrbitControls 的 domElement |
| 4 | 建立按需任务面板 | `#dc_taskPanel` **默认收起**（`data-task="closed"`）；展开后 360px 定宽 |
| 5 | 面板开/关/返回行为 | 打开：`openTaskPanel()`；关闭：`closeTaskPanel()` / `#dc_taskClose` / 再点 `#dc_taskToggle`。**只改 `state.taskStep` + `data-task`** |
| 6 | 三维控制与相机不被破坏 | 面板开合**只改 CSS 列宽** ⇒ 由 `#dc_view3dBox` 上的 ResizeObserver 驱动画布跟随；**不重建 3D 容器**（实测画布恒为 1） |

**未删任何旧功能**（§九 S1 明文）：20 个参数字段、5 个只读项、8 块帮助、热结勾选、逐热结改 Mc、↺ 恢复自动值、
参数草稿/保存语义 —— **全部原样可用**，参数窗口 `#dc_paramDlg` 本阶段仍按原样工作（S2 才把字段搬进面板）。

---

## 2. 流程条 5 节点与真实状态的对应（§3.2 逐条对账）

`flowSteps()` 的判据**只取自既有函数**，不新造状态机：`workflowState()` / `paramIssues()` /
`hotspots.status` / `process.mcHotspot` 的来源 / `state.stale` / `state.results`。

| 节点 | 状态判据 | §3.2 对应禁令 |
|---|---|---|
| ① 模型 | 无 mesh→`todo`；`geomStatus==='INVALID'`→`bad`；否则 `ok` | — |
| ② 分析条件 | `paramIssues()` 非空→`bad`（并列出缺什么）；无 STL→`lock` | **不把"有 STL"当"参数已确认"** |
| ③ 工艺参数 | 前置未满足→`lock`；`LOW_CONFIDENCE`/`INSUFFICIENT_RESOLUTION` 且无用户 Mc→**`bad`**（自动冒口被阻止）；`ok` 且自动 Mc 未确认→`warn` | **不把"有热结候选"当"检测可靠"** |
| ④ 分析 | 计算中→`busy`；`lastRun.ok===false`→`bad`；无结果→`todo`；`stale`→`warn`；否则 `ok` | **不把"已发起"当"已成功"** |
| ⑤ 结果 | 无结果→`lock`；`stale`→`warn` | 结果失效要标出来 |

**§3.2 第一条**（不能仅凭按钮点过显示完成）：`flowSteps()` **不读任何"点过没"标志**。
状态点**不靠颜色单独表意**：符号 `✓ ! ✕ ⋯ ○ 🔒` + 每个节点带 `title` 说明原因。

点击行为：`model`→展开面板；`cond`→参数窗口并定位到材料大类；`param`→参数窗口；
`run`→与主按钮**同一份逻辑**（`handleRunButton()`，单一来源）；`result`→结果视图；
前置未满足时弹 toast 说明原因（**不静默**）。

---

## 3. 修改文件（S1）

| 文件 | 改了什么 |
|---|---|
| `js/views/designCenter.js` | ① DOM：加 `#dc_flowbar`，`.dc-rail`→`#dc_taskPanel`（**沿用原 id** `#dc_overviewCard`/`#dc_overview`/`#dc_hotspotsCard`/`#dc_hotspotList`/`#dc_hsHint` ⇒ `renderOverview`/`renderHotspotList` 零改动）② `state.railOpen`→`state.taskStep` ③ 新增 `flowSteps()` / `renderFlowBar()` / `currentFlowKey()` / `openTaskPanel()` / `closeTaskPanel()` / `syncTaskPanel()` / `handleRunButton()` ④ `#dc_railToggle`→`#dc_taskToggle` ⑤ 流程条**事件委托**（注册一次，不随重建累积）⑥ **修掉 backdrop 监听堆叠缺陷**（S0 §6.1） |
| `css/app.css` | `.dc-ws` 加一行流程条；`.dc-body` 改「三维 + 右面板」两列；删 `.dc-rail` 三套规则；`<960px` 面板改全宽浮层（沿用原抽屉机制）；新增 `.dc-flowbar/.dc-flow-node/.dc-taskp*` |
| `scripts/browser_dc_715_test.mjs` | 3 条断言按 §2.3 正式取代（左栏×2、热结点击×1）+ 新增幂等 `openTaskPanel()` 辅助 |
| `scripts/browser_p78_test.mjs` | 布局断言改用 `.dc-body` 列数 + 新增「面板开合不重建画布」断言 |
| `scripts/browser_stl_p22_test.mjs` | 2 条断言改判据载体 + **修脚本自身崩溃**（见 §5） |
| `scripts/browser_test.mjs` | **只改步骤顺序**（断言一字未动）：原「先选材料保存 → 再导 STL」自 146 起不可能成功 |
| `scripts/browser_responsive_test.mjs` | 无需改动（触摸目标问题改在 CSS 侧） |

---

## 4. 测试结果（真实退出码）

| 脚本 | 结果 | exit |
|---|---|---|
| `browser_dc_r3_test.mjs` | 35 ✓ / 0 ✗ 全部通过 | 0 |
| `browser_dc_715_test.mjs` | **92 ✓ / 0 ✗** 全部通过 | 0 |
| `browser_test.mjs` | **174 ✓ / 0 ✗** | 0 |
| `browser_p78_test.mjs` | **53 ✓ / 0 ✗** | 0 |
| `browser_responsive_test.mjs` | **32 ✓ / 0 ✗**（3 视口 × 10 + 2 触摸，**零跳过**） | 0 |
| `browser_s1_test.mjs`（149 S1 的） | **29 ✓ / 0 ✗** | 0 |
| `browser_stl_p22_test.mjs` | **19 ✓ / 1 ✗** —— 唯一红是**既有** `marker 半径有尺度差异`（交接书记录） | 1 |
| `scripts/browser_i18n_audit.mjs` | 未在 S1 重跑（S1 新增文案待 S4 统一补英文覆盖） | — |

**S1 未跑全量 Node 回归**（§一「不要重复执行无关的昂贵测试」）—— 本轮改动全在视图/CSS/脚本层，
`calcs/**` 与 `js/engine/**` 只读；全量留到 **S4 统一验收**跑一次串行干净的。

### 冻结指纹（S1 后复核，10 个逐位未变）

```
5cfcfef3 calcs/riser.js     efdc2301 calcs/riserDreq.js   c1d3ec3c calcs/calcManifest.js
d774532a hotspotV3.js       8d61d26d peakRegion.js        5957831c sampling.js
48488b13 modulusField.js    80a763ef configV3.js          5af64ae4 meshValidation.js
1e3d96cc v3ViewAdapter.js
```

`HEAD=da1c822`（未变）· 工作区 108 项 · **未提交 / 未推送 / 未发布**。

---

## 5. ★ S1 踩到的坑（下阶段必看）

1. **★★ 模板字符串里的注释不能出现反引号。**
   在 `evalJs(\`...\`)` 的**注释**里写 `` `.dc-rail` `` 会**提前闭合模板字符串** ⇒
   脚本在 Node 侧抛 `ReferenceError: rail is not defined`，而且**`node --check` 不报错**（它把后面的文本
   当成了合法的标签模板/表达式）。症状极具误导性：报错行号指向一行**注释**。
   ⇒ 写浏览器侧 `evalJs` 模板时，注释里一律用单引号或去掉引号。
2. **`#dc_paramDlg` 的 backdrop 监听堆叠**（S0 §6.1 实测 4 次 confirm）→ S1 已修：
   用 `if (!dlg.dataset.backdropBound)` 保证只挂一次。
3. **面板默认收起 ⇒ 针对面板内元素的真实鼠标点击会静默失败**（元素 `hidden`、尺寸 0、
   `elementFromPoint` 命不中）。所有涉及面板内元素的浏览器断言**必须先展开面板**。
4. **`browser_stl_p22_test.mjs` 原本会在中途崩溃**：它引用 `#dc_rail` 并直接 `.getBoundingClientRect()`，
   左栏一取消就 `Cannot read properties of null` ⇒ **只跑到 13 条就断**，
   后面几十条断言从来没执行过。修完后 20 条全跑（19 ✓ / 1 既有红）。
   ⇒ **"只错 1 条"的观感可能是假的**（那是崩溃前的最后一条）——本项目第二次踩这个坑。
5. **`browser_test.mjs` 的两条红不是本轮引入**：146 轮起 `geometry.blankWeightKg` 是硬门禁，
   无 STL 时无来源 ⇒ `#dc_dlgSave` 恒 disabled ⇒ 测试原来的「先设材料保存、再导 STL」顺序不可能成功。
   **已用只读探针实测确认**（开窗即「缺 1 项必要条件」，选完材料后仍 disabled）。只改顺序，断言未动。

---

## 6. S1 阶段验收结论

**通过。** 逐条对照 §十：

| §十 要求 | 结果 |
|---|---|
| 说明实际改动 | §1 / §3 |
| 列出修改文件 | §3（2 个产品文件 + 5 个测试脚本） |
| 报告专项测试结果和真实退出码 | §4（逐个 exit code） |
| 检查冻结文件指纹 | §4，10 个逐位未变 |
| 检查工作区是否出现意外改动 | 只动了本文件列出的 7 个；无其他改动 |
| 检查关键交互 | 流程条 5 态、面板开关、画布唯一、相机不动、标准视图 7 键（真实鼠标）均实测 |
| 阶段是否通过 | **通过，可进入 S2** |

**§十 停止规则逐条核**：无参数/帮助资源丢失（S0 清单 20+5+8 项全在）· 保存/取消/恢复行为正常 ·
逐热结无串绑 · 三维交互无回归 · 结果与参数状态同步 · 指纹无变化 · 关键测试无新增失败 ·
脚本自身异常已排除（§5.1 已修）· 未扩大修改范围或改变工程规则。**无一触发。**

---

## 7. 下一步（S2）——直接照此执行

§九·S2 要求 + S0 §9.3 已定的迁移边界：

1. **把 20 个参数字段从 `#dc_paramDlg` 模态搬进 `#dc_taskPanel`**，作为 `taskStep='cond'`（A 模块）
   与 `taskStep='param'`（B+C 模块）。
   * 字段表 `paramFields()` / 只读表 `readonlyRows()` / 热结区 `hotspotPickHtml()` **直接复用**；
     草稿 `state.paramDraft` + `state.draftRestore` + `saveParamDlg` / `paramIssues(useDraft)` **原样保留**。
   * **`state.paramTab` 目前是死变量**（只写不读）⇒ 正好用它做面板内 B/C 子模块切换（复活而非删除）。
   * `.dc-dlg-*` CSS 可复用（面板内字段/网格/只读/警告样式）。
2. 把 `TASK_TITLE` 补上 `cond` / `param`；流程图 ②③ 的 action 从"开模态"改为"开面板对应步骤"。
3. 迁完后再删 `#dc_paramDlg`（**必须最后删**，删之前确认 20 个字段、5 个只读、8 块帮助、
   逐热结编辑、↺ 恢复、草稿语义全部已在新位置可用）。
4. 同步：分析前检查（`paramIssues` 展示）、分析状态（`computeState` 投影到流程条 ④）。
5. 需要的断言更新（预估）：`browser_dc_715_test.mjs` 里所有 `#dc_paramDlg [data-pf]` 断言
   （约 12 条）、`browser_p78_test.mjs` 的 `[data-pf="process.ratioKey"]`、`browser_s1_test.mjs` 的
   `[data-dlg-hs-mc]` / `[data-reset-orig]`、`browser_i18n_audit.mjs` 的 `[data-pf]` 依赖。

**S2 完成后必须重跑**：`browser_dc_715` / `browser_s1` / `browser_p78` / `browser_test` / `browser_responsive`。
