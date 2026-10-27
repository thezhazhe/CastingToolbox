# PHASE V2.0-P1-R6 · S2 迁移任务与交互（阶段验收 / 断点交接）

> 输入 `150.txt` §九·S2 + §四 + §十（阶段验收与停止规则）。
> 前置：`PHASE_V2.0-P1-R6_S0_BASELINE.md`（S0）→ `…_S1_CHECKPOINT.md`（S1）。
> **本文件是压缩/换会话后的续做依据** —— 只靠本文件 + 仓库即可继续。

---

## 1. S2 做了什么

**一句话：把 `#dc_paramDlg` 浮层窗口整个删掉，20 个参数字段搬进右侧按需任务面板的 ② / ③ 两个步骤。**

| # | §九·S2 要求 | 实际落地 |
|---|---|---|
| 1 | 迁移分析条件 / 冒口 / 浇注参数编辑 | 面板新增两个步骤容器：`#dc_condStep`（A 模块 4 字段 + 5 只读）、`#dc_paramStep`（B 冒口 3 字段 + 热结区 / C 浇注 13 字段） |
| 2 | ③ 内部两个子模块 | `#dc_paramTabs` 页签，状态 = `state.paramTab`（146 起就是个只写不读的死变量，**本轮复活**，没有新造状态） |
| 3 | 热结列表及逐热结编辑 | `hotspotPickHtml()` **原样复用**（ID / 检出模数 / 区域 / 逐热结 Mc / ↺ 改回检出值），只是宿主换成面板 |
| 4 | 自动值恢复 | `state.draftRestore` + `restoreRowHtml()` + `saveParamDraft` 里的 `proj.restoreAutoValue()` **一字未改** |
| 5 | 所有帮助内容 / 图片 / 来源标签 | 图例、参数共享说明、`gatingDiagramSvg`、比例适用范围、Mc 四估法、排气规则、工程原则五条 —— 生成函数全部复用，只是渲染位置变了 |
| 6 | 分析前检查 + 分析状态 | 流程条 ②（`paramIssues()`）④（`state.lastRun` / `stale`）已在 S1 接好；S2 补上**页脚实时提示**与**保存按钮真实禁用条件** |
| 7 | 连接流程导航与真实状态 | ② 流程节点 → 面板 ②（定位到材料大类）；③ 节点 → 面板 ③。**③ 的状态是 `lock` 但动作保留**（见 §4 第 1 条） |
| 8 | 面板 ↔ 三维联动 | 面板开合**只改 CSS 列宽**，靠既有 ResizeObserver 驱动画布 ⇒ 不重建 3D 容器（实测画布恒为 1，相机不动） |

**浮层相关的死代码一并清掉**：`.dc-dlg / .dc-dlg-card / .dc-dlg-head / .dc-dlg-title / .dc-dlg-x / .dc-dlg-body / .dc-dlg-foot / @keyframes dcDlgIn` 全部删除；
字段级样式（`.dc-dlg-sec / -grid / -fld / -note / -warn / -help / -ro / -hint`）**保留并复用**。

---

## 2. 草稿语义（§四 10 条验证项，逐条对账）

草稿的生命周期从"浮层开着"改成"**面板停在 ②/③ 的整段会话**"：

| 事件 | 行为 |
|---|---|
| 打开 ②/③ | 若 `state.paramDraft` 为 `null` 才起稿（会话起点）；**② ↔ ③ 来回切、B ↔ C 切 tab 都不重新起稿** |
| 改字段 | 写 `state.paramDraft[path]`，**不写项目**；改回原值 = 删掉草稿键（不留幽灵修改） |
| 点 ↺ | 只写 `state.draftRestore`，**不写项目**；再动手改同字段 = 放弃恢复意图 |
| **保存** | `saveParamDraft()`：先 `restoreAutoValue()` → 按 `paths` 落盘 → `refreshWeight()` → `markChangedStale()` → 重渲染面板（**面板不关**）→ `autoRecompute` |
| **取消 / ✕** | 有改动先 `window.confirm` 一次；确认后清草稿 + **清空编辑区 DOM** |
| 切到结果页 | **不丢草稿**（面板整体被 CSS 隐藏，任务步骤与草稿都保留；切回来原样）—— 进结果页前 `revealResults()` 会明确问一次 |
| 换 STL / 重进视图 | `closeParamPanel()` 直接终结草稿（数据已被整体替换，草稿已无意义，**不问**） |

**"分析只吃已保存的值"**：`startAnalysis()` 在 `dlgDirty()` 时不静默用旧值算、也不静默替用户保存 ——
toast 说清缺什么，并 `openParamAt(firstDirtyPath())` 把人带回那一步。

---

## 3. 修改文件（S2）

| 文件 | 改了什么 |
|---|---|
| `js/views/designCenter.js` | ① DOM：加 `#dc_condStep`/`#dc_paramStep`（内含 `#dc_condEditCard`/`#dc_paramEditCard`）、`#dc_taskFoot`；**删 `#dc_paramDlg`** ② `renderParamDlg`→`renderParamPanel`（渲染目标换成两个 body）③ `openParamDlg`→`openParamPanel`/`openParamAt`、`closeParamDlg`→`closeParamPanel`、`saveParamDlg`→`saveParamDraft`、`refreshDlgFoot`→`refreshTaskFoot` ④ **拆开 `handleRunButton` / 新增 `startAnalysis`**（④ 节点永远"去分析"，主按钮在有结果时"去看结果"）⑤ 页脚监听改**一次性委托**（见 §5.1） |
| `css/app.css` | 新增 `.dc-taskp-step` / `.dc-taskp-sech` / `.dc-param-tabs` / `.dc-param-tab` / `.dc-taskp-foot`；删浮层 6 条死规则；`.dc-taskp-x` 26→**28px**（触摸目标） |
| `js/i18n/en-US.js` | 补 R6 全部新词条（流程条 5 态文案 / 面板标题 / 页脚 / 图例 / 五态状态名 / 调试 title），**中文原文即 key** |
| 测试脚本 ×6 | `browser_dc_715` / `browser_s1` / `browser_p78` / `browser_stl_p22` / `browser_responsive` / `browser_test` / `browser_inspection_test` / `browser_i18n_audit` —— 见 §6 |

---

## 4. S2 顺手修掉/发现的真实问题

1. **③ 流程节点原本"点不进去"**（S1 遗留的产品缺陷）：`paramIssues()` 非空时 `step3.action = null`，
   点 ③ 只弹 toast。但 ③ 里 16 个字段有内容可看可改（冒口形状/浇注方向/浇道尺寸都不依赖材料大类），
   做成"点不进去"用户就只能干等。**改为：状态仍是 `lock`（真实），动作保留 `param`（可进入）；真正的门禁在保存按钮上。**
2. **★ 页脚从不刷新**（`renderParamPanel` 末尾没调 `refreshTaskFoot`）⇒ 实测"保存成功后页脚仍写『有 1 项修改尚未保存』"，
   且 `#dc_pfSave` 永远不进入 `disabled`（必要条件缺失时形同虚设）。已修。
3. **★ 页脚按钮监听堆叠**：`#dc_pfCancel` / `#dc_pfSave` 长在常驻 DOM 上，而 `renderParamPanel` 每渲染一次就被调一次
   ⇒ 直接 `addEventListener` 会累积（**实测点一次保存连跑 6 次 `saveParamDraft`**）。
   与 S1 修掉的 backdrop 堆叠同款。改为绑在 `#dc_taskFoot` 上的一次性委托。
4. **两个入口改同一个参数会静默回退**：① 热结列表的勾选**立即写项目**（146 定的语义，未改），
   ③ 的勾选写**草稿**。先勾 ① 再在 ③ 手动改过 → 保存时草稿里的旧 `hsPick` 会把 ① 的勾选覆盖回去。
   已在 ① 的勾选处理器里**作废同字段草稿**，并在 ① 的提示里把两个入口的保存语义差别写清楚。
5. **调试 title 是裸模板串**（`算法内部：gs=…`）⇒ 英文界面恒为中文。改成词条 + 具名插值。
6. **`hsSourceNote.statusText()` 返回的中文状态名从未被翻译**（它是纯模块、不 import i18n）
   ⇒ 英文界面出现"英文字句夹中文"。在 `mcSourceNote()` 侧对**字符串型插值参数再过一次 `tr()`**（纯模块保持零依赖）。
7. **浮层空白点击关闭的处理器**随浮层一起删除（它当年的 `dataset.backdropBound` 保险已无对象）。

---

## 5. ★ S2 踩到的坑（下阶段必看）

1. **★★ 模板字符串里的注释不能出现反引号** —— **S1 记过、S2 又踩了一次**，这次在**产品文件**里
   （`designCenter.js` 的 DOM 模板注释写了 `` `#dc_overviewCard` ``），`node --check` 这次**报错**了
   （S1 那次在测试脚本里，`node --check` 不报）。**结论：模板字符串的注释里一律不写反引号。**
2. **★ 面板默认收起 ⇒ 针对面板内元素的断言必须先按真实 UI 打开到那一步**。
   六个测试脚本的统一修法是加一个 `openParams(target)` 助手：点 `#dc_paramsBtn` → 找不到该字段就
   点流程条 ③ → 再依次点 B/C 页签（**不在测试里复刻产品的分步规则**，走真实 UI）。
3. **`browser_inspection_test.mjs` 自 146 起就崩在中途**：它点 `[data-hs-edit]`（146 删掉的「✎ 改 Mc」按钮），
   null 崩 ⇒ **后面的断言从来没跑过**。本轮把该场景改成当前真实 UI（③ → B 的逐热结 Mc 输入框），
   现在 179 ✓ / 6 ✗ 全部执行。**这是本项目第三次踩「脚本中途崩 ⇒ 通过数看着还行」这个坑。**
4. **测试脚本行尾不统一**：`browser_dc_715_test.mjs` 是 CRLF，`browser_s1_test.mjs` 是 LF。
   批量改脚本前**先 `cat -A` 看一眼**，否则 Python 的 `\n` 替换全部 miss。
5. **写 `\n` 进 JS 字符串时要小心**：经 heredoc 传给 Python 再落盘，`\\n` 可能变成真换行 ⇒ 字符串被截断。
   S2 就把 `en-US.js` 写坏过一次（`SyntaxError: Invalid or unexpected token`），已修。

---

## 6. 测试结果（真实退出码）

| 脚本 | 结果 | exit |
|---|---|---|
| `browser_dc_715_test.mjs` | **92 ✓ / 0 ✗** | 0 |
| `browser_dc_r3_test.mjs` | **35 ✓ / 0 ✗** | 0 |
| `browser_s1_test.mjs` | **29 ✓ / 0 ✗** | 0 |
| `browser_p78_test.mjs` | **53 ✓ / 0 ✗** | 0 |
| `browser_test.mjs` | **174 ✓ / 0 ✗** | 0 |
| `browser_responsive_test.mjs` | **32 ✓ / 0 ✗**（3 视口 × 10 + 2 触摸，零跳过） | 0 |
| `browser_i18n_audit.mjs` | **核心页英文界面无遗漏**（R6 前 67 处） | 0 |
| `browser_stl_p22_test.mjs` | **19 ✓ / 1 ✗** —— 唯一红是**既有** `marker 半径有尺度差异` | 1 |
| `browser_inspection_test.mjs` | **179 ✓ / 6 ✗** —— 6 条全部**既有**（4 条工艺检验中心 UI + 2 条 P0-22 前的旧基线），见 §6.2 | 1 |
| `browser_v2018_test.mjs` | 21 ✓ / 0 ✗ | 0 |
| `browser_stl_test.mjs` | 7 ✓ / 0 ✗ | 0 |

### 6.1 断言更新的性质（旧 → 新，逐条说明「不是放水」）

| 脚本 | 旧断言的载体 | 新断言 | 强度变化 |
|---|---|---|---|
| `dc_715` | "参数窗口打开后含三模块与关键字段"（一次同屏数 20 个字段） | 按真实 UI **逐个走 ②/③/B/C 再取并集** | **不变**（还是那 20 个字段 + 3 个模块标题） |
| `dc_715` | "关闭窗口后 `#dc_paramDlg [data-pf]` 为空" | "关闭后编辑区 DOM **被清空** + 面板回到收起态" | **增强** |
| `dc_715` | "左栏恰好 2 个区域" / "左栏无步骤卡" | 统计范围收到 `#dc_modelStep`（迁过来的那两块） | 载体变更，判据不变 |
| `dc_715` | "无 `#dc_condCard`"（145 那套的 id） | **保留原判据**；新加的编辑卡刻意取名 `#dc_condEditCard` 避让 | 不变 |
| `p78` | 逐热结 Mc 在 `#dc_paramDlg` | 同一输入框，改在 `#dc_paramBody` | 不变 |
| `stl_p22` | "参数编辑走 `#dc_paramDlg`" | "旧参数区不存在 + **浮层 DOM 已彻底删除** + ②/③ 步骤存在" | **增强** |
| `responsive` | `#dc_dlgSave` | `#dc_pfSave` | 不变 |

### 6.2 已知历史失败（**不是本轮引入**，逐条给出判据）

1. `browser_stl_p22_test` · `marker 半径有尺度差异（V3）`（`r=[18.29,18.29]`）—— 交接书记录在案的既有失败。
2. `browser_inspection_test` · 4 条工艺检验中心（`#/inspection`）UI 断言（浇注系统类型默认值 / 出品率占位符 / 速度标准 / 出品率来源）—— R6 未碰该页。
3. `browser_inspection_test` · 2 条 P0-22 **之前的**基线（`⑩⑥ D/H = 147/147、f = 1.75`，实测 101/101/1.2）—— 断言标题自己写着"修复前基线"。
4. `browser_v2015_test`（8 ✗）—— 断言 `#r_results` 里出现「未收敛」，P0-22 删除 f 迭代后该概念不存在；**独立冒口计算器页面，与本轮无关**。
5. `browser_p72_test`（2 ✗）—— 引用 `#dc_p_volume` / `#dc_m_mc` 等 R2 时代的选择器（早已删除）。

### 6.3 冻结指纹（S2 后复核，10 个逐位未变）

```
5cfcfef3 calcs/riser.js     efdc2301 calcs/riserDreq.js   c1d3ec3c calcs/calcManifest.js
d774532a hotspotV3.js       8d61d26d peakRegion.js        5957831c sampling.js
48488b13 modulusField.js    80a763ef configV3.js          5af64ae4 meshValidation.js
1e3d96cc v3ViewAdapter.js
```

`HEAD=da1c822`（未变）· 工作区 109 项（S1 时 108，差额来自 S1 交接文档落盘时序；**修改过的 traced 文件 = 本轮明确列出的那些 + 既有未提交的 V2.0 工作，无意外文件**）· **未提交 / 未推送 / 未发布**。

### 6.4 真实浏览器截图验收（1440 / 390 × 明暗）

截图已人工看过，看完即删（未入库）。实测结论：
- ② 分析条件：4 可编辑 + 5 只读，页脚常驻；
- ③ B 冒口设计：字段 + 热结行 + 「Mc 怎么估？」折叠 + 保存按钮；
- ③ C 浇注系统：**浇注方向示意图正常渲染且与「浇注位置」字段相邻**（深色主题下保留白底，§二.1 允许）；
- 深色主题：面板/页签/徽标对比度正常；
- 收起面板：三维拿全宽、无残留空白栏；
- **390px 数值体检**：面板 360×484、页脚 y=606 + 高 83（**在视口内**）、取消/保存各 122×210 × 44px（≥28 触摸下限）、长表单可滚到底且末字段可见、页面零横向溢出。

---

## 7. S2 阶段验收结论

**通过。** 逐条对照 §十：

| §十 要求 | 结果 |
|---|---|
| 说明实际改动 | §1 / §3 |
| 列出修改文件 | §3（3 个产品文件 + 8 个测试脚本） |
| 报告专项测试结果和真实退出码 | §6（逐个 exit code，含历史失败分列） |
| 检查冻结文件指纹 | §6.3，10 个逐位未变 |
| 检查工作区是否出现意外改动 | §6.3 |
| 检查关键交互 | 面板 ②/③ 渲染、页签切换不丢草稿、保存/取消、逐热结 Mc 绑定、↺ 恢复、画布唯一、相机不动 |
| 阶段是否通过 | **通过，可进入 S3** |

**§十 停止规则逐条核**：20 字段 + 5 只读 + 8 帮助 + 3 图全部在新位置可用（`dc_715` 逐项断言）·
保存/取消/自动值恢复无异常 · 逐热结无串绑（`p78` E(149) 断言 H1=17.5 且 H2 一字未动）·
3D 交互无回归（`s1` 7 个标准视图真实鼠标点击全过）· 结果与参数状态同步 ·
指纹无变化 · 关键测试无新增失败 · 脚本自身异常已排除 · 未扩大范围或改工程规则。**无一触发。**

---

## 8. 下一步（S3）——直接照此执行

§九·S3 = **结果与流程闭环**。S1/S2 已经把前置做完了（结果视图 `#dc_results` 在 S1 之前就存在，`revealResults`/`setWorkspaceView` 已收敛成单一入口）。S3 要做的是**闭环**，不是重建：

1. **独立结果视图的分类切换**：`#dc_resultNav` 三页（工艺性 / 冒口 / 浇注）已存在，检查它们与流程条 ⑤ 的状态是否一致。
2. **返回工作台**：结果页页首的「⤡ 返回三维工作台」入口（146 §五 加的）—— 确认 S2 的面板改动没有让它失效，
   且**面板在结果视图下被 CSS 隐藏时草稿不丢**（§2 已实现，S3 要补断言）。
3. **返回对应参数模块编辑**（§六 明文）：结果卡里应有"去改这个参数"的入口，点了直接 `openParamAt(path)`。
   这是 S2 新增能力（`openParamAt` 就是为它准备的）——**S3 的主要新增工作在这里**。
4. **结果过期 / 失效指示**：`#dc_staleBar` + `markChangedStale` 已存在；补"改完参数 → 结果标记过期 → 重新分析 → 过期标记消失"的端到端断言。
5. **失败恢复路径**：`state.lastRun.ok === false` 时结果区横幅 + 重算入口（146 D8 已有），补断言。
6. **完整闭环测试**：STL → 结果 → 改参数 → 重新分析 → 结果更新，全程在真实浏览器里跑一遍。

**S3 完成后必须重跑**：`browser_dc_715` / `browser_s1` / `browser_p78` / `browser_test` / `browser_responsive` / `browser_dc_r3`。
