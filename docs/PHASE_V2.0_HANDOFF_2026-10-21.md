# Casting Toolbox V2.0 · 正式项目交接（2026-10-21）

> **★ 2026-10-21 后续更新（S5 已完成，优先于本文件的 S4 时点）**：
> R6-S5（158.txt）已完成：旧体积提示清理、Mc 说明下沉、分析/结果合并并自动跳转、
> 停止展示推算实际出品率、H/D 0.8/1.0/1.2/1.5（默认 1.0，球形 H≡D）。
> 最新报告：`docs/PHASE_V2.0-P1-R6-S5_REPORT.md`；H/D 方案：`docs/PHASE_V2.0_HDRATIO_PLAN.md`。
> 当前 HEAD 仍 `da1c822`，工作区 **138 项**（41 M + 97 ??，未提交）；
> Node 全量 **902/1**（唯一历史 `phase24 T5`）；`calcManifest.js` 指纹 **`3bfc3e16`**
> （S4 出品率字段 + S5 读取 `process.hdRatio`）；`riser.js`、`riserDreq.js`、engine 9 项未变。
> 本文件正文仍是 S4 时点，数字（133 项 / 896/1 / e8d4d9a5）只作历史参考。

> **交接性质**：本文件是给全新 Claude Code 窗口使用的正式交接书，不是功能报告，也不是发布说明。
>
> **信息来源**：
> - 当前真实工作区与 Git 状态（2026-10-21 18:25 左右实测）
> - `docs/PHASE_V2.0-P1-R6-S4_REPORT.md`（本轮 S4 实际执行报告，2026-10-21 13:36 写入）
> - 必要的生产代码抽查（`designCenter.js` / `calcManifest.js` / `riser.js` / `riserView.js`）
>
> **本次交接没有做的事**：
> - 没有修改生产代码或测试代码；
> - 没有重跑全量 Node / 浏览器测试；
> - 没有执行 `git reset / checkout / clean / stash`；
> - 没有提交、推送或发布。
>
> **与旧交接书的关系**：`docs/HANDOFF_2026-10-07.md` 的正文是 2026-10-14 的历史快照，
> 其中的 `840/1`、`116 文件`、`e56deaa0 riser.js` 等数字**已经过期**；该文件顶部保留了
> S4 更新说明，但新窗口应**先读本文件**，再把旧文件当历史资料。

---

## 0. 一分钟结论

- **当前阶段**：V2.0 P1 R6 工作台重构的 **S4（工作台集中打磨与交互优化）已完成**；
  **S4 之后的新阶段尚未开始**。
- **当前代码状态**：分支 `main`，HEAD `da1c822`；工作区有大量未提交修改（交接开始时 **131 项 = 41 个已修改 + 90 个未跟踪**）。
- **S4 实际完成**：保存/分析分离、三维与右面板对齐、P0–P3 提示分层、出品率整模字段最小修复、
  结果页/报告同源、专项测试与 9 张截图。
- **S4 没有完成**：最终实重出品率（仍为 `null`）、设计中心可调 H/D（仍固定 1.0）、
  P0 冒口尺寸主因、真实件基准录入、低压浇注计算器、结果页内联参数的显式分析语义。
- **最重要的风险**：131 项未提交工作只能保护，**不能清理或回滚**；`calcManifest.js` 是唯一
  变更过的冻结文件（仅出品率新增字段）；打开设计中心 H/D 需要再次触碰冻结计算链。
- **新窗口第一步**：读本文件 → 读 `docs/PHASE_V2.0-P1-R6-S4_REPORT.md` → 核对 HEAD/工作区 →
  做最小代码核实 → 输出简短状态确认。**不要重跑已有可靠证据的全量测试。**

---

## A. 项目概况

### A.1 项目定位

Casting Toolbox 是面向铸造工程师的**免费、轻量、开源**工程辅助工具：

- 定位介于 Excel 与 MAGMA / ProCAST 之间；
- 静态 Web 应用（原生 ESM + Node 本地服务器，**无构建步骤**）；
- 原则：简单可靠、工程可用；能从 STL 提取的几何就尽量提取；
- 未知工程参数不编造；
- 明确区分“数学计算正确”“几何计算正确”“铸造工程有效”。

### A.2 当前阶段

| 项 | 当前事实 |
|---|---|
| 产品版本 | `js/version.js` → `VERSION = '1.1.0'`（`VERSION_LABEL = 'v1.1.0'`） |
| 已发布版本 | 历史记录：V1.1.0 已发布到 Release + GitHub Pages；**本次交接未联网复核** |
| V2.0 状态 | P0 冒口可靠性：调查深、主因未动；P1 工作台/UI：R6-S4 已完成一段；P2 低压：未启动 |
| 当前工作阶段 | R6-S4 完成，**下一阶段未开始** |
| 项目路径 | `D:\CDXProject\CCproject\CastingToolbox` |
| 启动方式 | `npm start` → `http://localhost:8090/` |
| 代码入口 | `index.html` → `js/app.js`（`<script type="module">`） |

### A.3 当前 Git 状态（交接时实测）

```text
分支                 main
HEAD                 da1c822
HEAD 提交说明        docs: 新增 V2.0 交接书 HANDOFF_2026-10-07（替掉 09-28 那份，纯文档）
工作区               131 项
  - 已修改（M）       41
  - 未跟踪（??）      90
```

> **写入本交接书和启动指令后**，工作区会多出 2 个未跟踪文档；数量会变为 133。
> 这是交接文档本身，不是代码改动。最终数量以实际 `git status --short | wc -l` 为准。
>
> **绝不能假设 HEAD 仍等于 `da1c822`**。新窗口必须重新核对。

### A.4 重要文档入口

| 文档 | 用途 |
|---|---|
| `docs/PHASE_V2.0-P1-R6-S4_REPORT.md` | **本轮 S4 的实际执行报告**：修改清单、测试结果、截图、未决问题 |
| `docs/PHASE_V2.0-P1-R6-S3.1_REPORT.md` | S3.1：RH 归属、结果/报告同源、提示分级、球形只显示球径 |
| `docs/PHASE_V2.0-P1-R6-S3_WORKBENCH_FLOW_REPORT.md` | S3：工作台流程闭环；**§5 是 H/D 能力评估** |
| `docs/PHASE_V2.0-P1-R6-S2.2_WORKBENCH_FIX_REPORT.md` | S2.2：保存并分析状态语义、形状/RH 修复 |
| `docs/PHASE_V2.0-P1-R6-S2.1_DIAGNOSTIC_REPORT.md` | S2.1：形状/RH/字段归属诊断 |
| `docs/PHASE_V2.0-P0-22_FREEZE.md` | P0-22 冻结边界与 14 条规则（重要） |
| `docs/PHASE_V2.0-P2_LOWPRESSURE_ANALYSIS.md` | P2 低压资料分析（含两处无出处系数） |
| `docs/HANDOFF_2026-10-07.md` | 2026-10-14 历史交接快照；**数字已过期，只作历史参考** |
| `docs/PHASE_V2.0-P1-R6-S0_BASELINE.md` | R6-S0 基线核实 |
| `tests/engineering-generated/BASELINE.md` | 引擎/冻结指纹与各阶段追加基线 |

### A.5 当前是否存在立即阻塞

- **代码层面没有“全部工作无法继续”的阻塞**：现有工作区可继续开发与测试。
- **方向性阻塞有四项**：
  1. H/D 开放需要产品授权并触碰冻结计算语义；
  2. 最终实重出品率需要实测数据/口径决策；
  3. P0 冒口尺寸主因需要真实件基准或工程裁决；
  4. P2 低压需要解决 1.8 / 1.2 两处无出处系数。
- **立即操作风险**：131 项未提交工作（交接文档写入后 133 项）必须保护；
  任何 `clean / reset / checkout / stash` 都可能造成不可恢复的损失。

---

## B. 本次 S4 命令执行结果

> 对应命令文件：`D:\CDXProject\新建 文本文档 (155).txt`
> （“工作台集中打磨与交互优化”）。

### B.1 实际完成的修改

> 详细逐文件说明见 S4 报告 §2；这里只保留交接需要的摘要。

| 文件 | 实际用途 |
|---|---|
| `calcs/calcManifest.js` | **唯一获授权的冻结文件改动**：`yield.calculate` 只新增整模字段；旧字段语义不变 |
| `js/views/designCenter.js` | 参数面板只保存不分析；顶部 ④ 才分析；空保存守卫；250ms 分析去重；共享 chrome 行；提示折叠 |
| `js/views/resultsCenter.js` | 冒口卡长公式移入详情；顶部风险条只留 P0 + 2 条 P1；流速 high 由红改黄；出品率标签改为“反推残差” |
| `js/views/reportGenerator.js` | 报告消费整模新字段；无浇注结果时拒绝单件/整模混账；保留完整依据 |
| `js/views/resultFacts.js` | 账目优先使用整模新字段；设计出品率使用未舍入 `g.ya` |
| `js/views/yieldLedger.js` | 整模账目优先使用核心新字段；`finalYield` 仍固定为 null |
| `js/views/gatingView.js` | 4 段工程原则改为默认折叠；出品率显示使用未舍入值 |
| `js/views/riserView.js` | “工艺出品率”改为“单件（铸件+冒口）出品率” |
| `js/views/smallCalcs.js` | “现场实测出品率”改为“出品率（本厂实绩/预计）” |
| `js/views/inspectionCenter.js` | 3 段长口径说明改为折叠 |
| `js/views/campbellGatingView.js` | 3 段长提示改为折叠 |
| `js/views/hsSourceNote.js` | STL 自动 Mc 主文案压缩；完整说明进详情 |
| `css/app.css` | `.dc-chrome`、8px 列间距、校验折叠、HS 单行省略、P0–P3、`.pi-warnline` |
| `js/i18n/en-US.js` / `zh-CN.js` | 中英文同步；浏览器英文审计 0 遗漏 |

### B.2 实际完成的功能结论

1. **保存/分析分离**
   - 参数面板页脚只保留「保存」；
   - 保存只写 `CastingProject`、清草稿、标记旧结果过期，**不调用 `runAnalysis` / `autoRecompute`**；
   - 顶部 ④「分析」才执行完整分析；
   - 有未保存草稿时点 ④ 会明确确认；取消保留草稿；
   - 空保存不会误把全部结果标脏；
   - 连续分析有 `state.busy` + 250ms 去重。

2. **三维与右面板对齐**
   - STL 校验/进度移入 `.dc-chrome` 共享行，左右列从同一行下开始；
   - `.dc-body` 增加 8px 列间距；
   - 报告实测：1366×900、1200×800 与 ①/②/③ 切换时，三维与面板顶部差 **0.0px**、间距 **8px**；
   - STL 成功/警告/进度仍可见；结果视图隐藏 chrome。

3. **提示分层（P0–P3）**
   - 主界面保留：缺参、分析失败、结果过期、Hp/A 无效、RH 未指定、自动 Mc 需复核、旧体积参考不足、Campbell 一句结论、排气比、STL 摘要；
   - 折叠：四形状 `M=D/6` 推导、H/D 固定原因、Mc 多热结说明、RH 测量图/公式、浇注工程原则、检验中心边界、Campbell 长原理；
   - 删除的只有重复展示，没有删除工程信息；
   - 顶部风险条从最多 6 条 P1 收敛为 P0 + 2 条最高优先 P1；其余 P1 在对应卡片就地显示。

4. **出品率最小核心修复**
   - 新字段：`cavityCount / castingMass / riserUnit / riserWtTotal / gatingWtResidual / designYield / finalYield`；
   - `finalYield` 固定 `null`：没有实测浇注重量或独立浇道实重，不编造；
   - 旧字段 `castWt / pourWt / runnerWt / riserWt` 语义一字未改；
   - 1/2/4 腔实测（球铁、单件 20 kg、预估 65%）：

     | 型腔 | 整模铸件 kg | G kg | 单套冒口 kg | 整模冒口 kg | 反推残差 kg | finalYield |
     |---:|---:|---:|---:|---:|---:|---|
     | 1 | 20 | 30.769 | 1.088 | 1.088 | 9.681 | null |
     | 2 | 40 | 61.538 | 1.088 | 2.176 | 19.362 | null |
     | 4 | 80 | 123.077 | 1.088 | 4.352 | 38.725 | null |

   - 页面/报告不再出现“单件 ÷ 整模 G”造成的 32.5%/16.25% 假出品率；
   - “反推残差”不再伪装成实测浇道重量。

5. **结果页 / 报告一致性**
   - 共用 `js/views/resultFacts.js` 与 `js/views/yieldLedger.js`；
   - 报告保留结果有效性、RH、直/横/内三段、生产条件、整模账目、P0/P1 风险、参数来源和适用边界；
   - 没有 `undefined / NaN / [object Object]`；没有可用实测数据时明确写“暂不能给出”。

6. **测试与视觉证据**
   - S4 专项 Node **5/0**；S4 浏览器 **30/0**；
   - 9 张 S4 截图在 `screenshots/s4_01…s4_09`；
   - S4 报告 §10 给出全部测试结果与退出码；§14 给出截图说明。

### B.3 本次没有完成或只完成一部分的事项

| 事项 | 当前真实状态 | 原因/证据 |
|---|---|---|
| 最终实重出品率 | **不可得**，`finalYield = null` | 核心没有实测浇注重量/独立浇道实重 |
| 设计中心可调 H/D | **未实现**，仍固定 1.0 | `calcManifest.js:280` 硬编码；属冻结计算语义 |
| P0 冒口尺寸主因 | **未处理** | S4 只做工作台与展示；旧体积模型仍使用整件净重口径 |
| 真实件基准 | **0 条数据** | `data/riser-benchmark/cases.csv` 只有表头（37 列） |
| P2 低压浇注计算器 | **未启动** | 资料已找到，但两处系数无出处 |
| 结果页内联参数 | **仍保留 600ms 自动重算** | 不是参数面板的保存动作；S4 未改，见待决策 |
| 全部专用计算器提示统一 | **未逐页完成** | S4 优先覆盖高频页面；垂直线等仍保留技术表格 |
| 提交/推送/发布 | **均未执行** | 用户未授权 |

### B.4 测试结果（来源、退出码、历史/新增）

> **来源说明**：以下数字来自 **S4 阶段报告 §10**，不是本次交接重新运行的结果。
> S4 报告写入于 2026-10-21 13:36；本次交接只重新核对了 Git 状态和 10 个冻结指纹。
> S4 报告记录了结果；本次交接未引用单独归档的原始日志。报告未记录逐条测试的精确开始/结束时刻，
> 报告文件写入时间 2026-10-21 13:36 可作为其上界。新窗口若需要“此刻”的数字，
> 应在空载下重新跑全量，并明确区分历史失败。

| 项目 | 结果 | 退出码 | 说明 |
|---|---:|---:|---|
| Node 全量 `node tests/runner.mjs` | **896 通过 / 1 失败** | **1** | 唯一失败 `phase24 T5`，历史失败 |
| S4 专项 `node tests/runner.mjs phases4` | **5 通过 / 0 失败** | 0 | 整模字段、旧语义、账目、保存契约 |
| S4 浏览器 `node scripts/browser_s4_test.mjs` | **30 项通过 / 0 失败** | 0 | 保存/分析、过期、确认、布局、中英、移动端 |
| `browser_s3_test.mjs` | 全部通过 | 0 | |
| `browser_s22_test.mjs` | 全部通过 | 0 | |
| `browser_s1_test.mjs` | 全部通过 | 0 | |
| `browser_s31_test.mjs` | 全部通过 | 0 | |
| `browser_dc_715_test.mjs` | 全部通过 | 0 | |
| `browser_p78_test.mjs` | 全部通过 | 0 | |
| `browser_dc_r3_test.mjs` | 全部通过 | 0 | |
| `browser_responsive_test.mjs` | 全部通过 | 0 | |
| `browser_test.mjs` | 全部通过 | 0 | |
| `browser_i18n_audit.mjs` | 0 遗漏 | 0 | 中英文 |
| `browser_stl_test.mjs` | 全部通过 | 0 | |
| `browser_inspection_test.mjs` | **183 通过 / 2 失败** | **1** | ⑩④/⑩⑥ 历史失败 |
| `browser_stl_p22_test.mjs` | **19 通过 / 1 失败** | **1** | 历史 marker 尺度差异 |

**历史失败（不是 S4 新引入）**：

1. `phase24_test.mjs :: T5`：`ALHR4510塑料模具v2-2.1.stl` 热结数期望 5，实际 2；
   来源是 V2.0-03 修 `stride³` 后的已知副作用。
2. `browser_inspection_test.mjs` ⑩④/⑩⑥：旧体积归因/旧基线。
3. `browser_stl_p22_test.mjs`：marker 半径尺度差异。

**本轮新增失败：无。**

**容易误读的日志**：

- 日志中会出现嵌套 `hotspot_v2` 自报的 `41 通过 / 1 失败`，其中
  `large thin shell: 性能 < 8s — 9506ms` 是既有性能门限，**不是 runner 汇总**；
- runner 汇总在日志最后；S4 汇总为 **896/1**；
- 在浏览器测试并发运行时，性能项可能假红；最终验证要在空载下重跑。

### B.5 视觉证据

目录：`D:\CDXProject\CCproject\CastingToolbox\screenshots\`

| 文件 | 内容 |
|---|---|
| `s4_01_workbench_param_riser.png` | 1366×900，STL 已导入、③ 冒口设计；顶部对齐、8px 间距 |
| `s4_02_saved_not_analyzed.png` | 改形状后点保存：过期横幅、状态 chip、页脚保存提示；未自动分析 |
| `s4_03_results_riser.png` | 结果页冒口核心卡简洁，长公式在详细信息 |
| `s4_04_results_gating.png` | 结果页浇注三段、风险条、整模账目、RH P1 |
| `s4_05_workbench_param_gating.png` | 浇注参数输入为主、长解释折叠 |
| `s4_06_english_save_analysis.png` | 英文 Save / ④ Analysis / 页脚说明 |
| `s4_07_mobile_panel.png` | 390×844 参数面板全宽浮层、无横向溢出 |
| `s4_08_mobile_workbench.png` | 390×844 三维工作台、热结状态条单行 |
| `s4_09_mobile_results.png` | 390×844 结果页可读 |

> S4 报告记录这 9 张已逐张人工查看；**本次交接没有重复进行人工截图验收**。
> 自动化截图不等于对所有专用计算器的视觉验收。

### B.6 冻结指纹（本次交接重新计算，2026-10-21）

```text
5cfcfef3  calcs/riser.js
efdc2301  calcs/riserDreq.js
e8d4d9a5  calcs/calcManifest.js
d774532a  js/engine/v3/hotspotV3.js
8d61d26d  js/engine/v3/peakRegion.js
5957831c  js/engine/v3/sampling.js
48488b13  js/engine/v3/modulusField.js
80a763ef  js/engine/v3/configV3.js
5af64ae4  js/engine/meshValidation.js
1e3d96cc  js/engine/v3/v3ViewAdapter.js
```

- 与 S4 报告 §11 逐位一致；
- **唯一变化**：`calcManifest.js` 由 `c1d3ec3c` 变为 `e8d4d9a5`，范围仅
  `yield.calculate` 新增整模字段；
- 其余 9 个冻结指纹未变；
- 旧交接书里的 `e56deaa0 riser.js` 是 2026-10-14 历史值，**已过期**。

---

## C. 当前系统结构与关键数据流

### C.1 运行结构

```text
index.html
  └─ js/app.js（路由 / 视图挂载 / i18n / 主题）
       ├─ js/views/designCenter.js        #/designCenter 工作台（3D + 参数面板 + 结果视图）
       ├─ js/views/resultsCenter.js       结果页
       ├─ js/views/reportGenerator.js     工艺计算报告
       ├─ js/views/riserView.js           独立冒口计算器
       ├─ js/views/gatingView.js          独立浇注计算器
       ├─ js/views/inspectionCenter.js    工艺检验中心
       └─ js/views/campbellGatingView.js  Campbell 速算

js/model/CastingProject.js  唯一项目数据模型（localStorage 键 ct-project）
calcs/calcManifest.js       计算器注册表 + RUN_ORDER + 各计算器 calculate()
calcs/riser.js              冒口尺寸/模数/形状公式（冻结）
js/engine/**                热结/模数/采样等引擎（冻结）
js/views/resultFacts.js     页面/报告共用的结果事实
js/views/yieldLedger.js     整模账目唯一实现
```

`RUN_ORDER` 的实际顺序（`calcs/calcManifest.js:608`）：

```text
shrinkage → machining → riser → gating → chill → yield → sandbox → charge → shakeout
```

### C.2 状态与唯一数据源

| 状态 | 作用 | 位置 |
|---|---|---|
| `CastingProject` | 唯一权威参数/结果存储，持久化 `ct-project` | `js/model/CastingProject.js` |
| `state.paramDraft` | 参数面板**会话草稿**，只存改动过的键；不直接写项目 | `designCenter.js` |
| `state.draftRestore` | “恢复自动值”意图；与草稿同生命周期 | `designCenter.js` |
| `state.results` | 最近一次**成功**分析结果 | `designCenter.js` |
| `state.stale` | 唯一“结果与当前参数不一致”标记 | `designCenter.js` |
| `state.lastRun` | 最近一次分析状态（`ok` / 失败原因） | `designCenter.js` |
| `state.busy` | 分析中的互斥标志 | `designCenter.js` |
| `state.wsView` | `workbench` / `results` | `designCenter.js` |

**没有第二套计算状态**。草稿只负责“保存前”；保存后一切以 `CastingProject` 为准。

### C.3 保存 / 分析生命周期（代码事实）

关键代码位置：

- `js/views/designCenter.js:1537` `saveParamDraft()`
- `js/views/designCenter.js:1666` `startAnalysis()`
- `js/views/designCenter.js:2738` `runAnalysis()`
- `js/views/designCenter.js:2744` 250ms 去重

| 动作 | 实际行为 |
|---|---|
| 编辑参数 | 只写 `state.paramDraft`，项目不变 |
| 点「保存」 | 写入 `CastingProject`；清草稿；`markChangedStale()`；重渲染；**不调用分析** |
| 无修改点保存 | 提示“参数未发生变化”；**不会**把全部结果标脏（有显式守卫） |
| 保存失败 | 草稿保留、显式 toast、不触发分析 |
| 有草稿点 ④ | 先确认“保存并分析”还是“返回检查”；取消不会丢草稿 |
| 顶部 ④ / 主按钮重新分析 | `startAnalysis()` → 参数门禁 → `runAnalysis()` |
| 分析成功 | 更新 `state.results`、清空 `state.stale`、`lastRun.ok = true` |
| 分析失败/阻断 | 保留旧结果但 `markAllStale()`；`lastRun.ok = false`；回滚本次写回的共享字段 |
| 保存后不分析 | 旧结果立即显示“已过期”；不会定时自动分析 |
| 连续点分析 | `state.busy` + 250ms 去重；同步计算不会并发 |

**例外（已知且未改）**：结果页内联参数输入仍会直接写项目并触发 600ms
`autoRecompute()`；它不是参数面板的「保存」，S4 为保持现有实时编辑体验未改。
这属于待决策事项，不是遗漏。

### C.4 计算链（与冒口相关的部分）

- `calcManifest.js:176` 冒口计算器入口；
- `calcManifest.js:280` 调用 `runRiser` 时硬编码 `hd_ratio: 1.0`（冻结文件）；
- `calcManifest.js:274` 冒口体积校核的重量输入是
  `geometry.netWeightKg ?? geometry.blankWeightKg`，即**整件净重口径**；
- `RUN_ORDER` 中 riser 在 gating 之前（`calcManifest.js:608`）；冒口计算不依赖浇注结果；
- `riser.js:58-93` 四形状公式；`riser.js:180-182` 缺省 `hd=1.0`；
- `riser.js:217-249` 按 `Mr_target` 反求尺寸，`H = round(D × hd)`（球顶柱另保证 `H ≥ R`）；
- `riser.js:309` 返回 `hd` 等字段。

### C.5 结果页 / 报告同源

- `resultsCenter.js:18-19` 引用 `buildYieldLedger`、`riserItemFacts / gatingFacts / collectRisks`；
- `reportGenerator.js:14-15` 引用同一组函数；
- `resultFacts.js:59` 构造账目；`yieldLedger.js:31` 是唯一账目实现。

因此：**不能只改页面或只改报告**；任何口径变化必须改共享层，并同时跑页面/报告测试。

### C.6 三维布局

- 工作台结构：`.dc-ws` → `.dc-topbar` → `.dc-flowbar` → `.dc-chrome` → `.dc-body`
  （`.dc-main` / `.dc-stage` + `.dc-taskp`）；
- `.dc-chrome` 共享行放 `#dc_validate` / `#dc_progress`，左右列从同一行下开始；
- `.dc-body { column-gap: 8px; }`；
- 结果视图隐藏 chrome；
- HS 状态条单行省略 + `title` 完整说明；
- 面板宽度保持原架构，只缩 `1fr` 三维列。

### C.7 测试结构

- Node runner：`node tests/runner.mjs`，按文件名子串筛选，**非递归**；
- 阶段测试：`tests/phases4_s4_test.mjs`；
- 浏览器测试：`scripts/browser_*_test.mjs`，通过本地服务器 + Edge/CDP；
- 截图脚本：`scripts/shot_s4.mjs`；
- 历史基线：`tests/engineering-generated/BASELINE.md`。

---

## D. 已确认的产品决策（不能随意推翻）

### D.1 总体产品原则

1. **简单可靠、工程可用**优先于功能数量。
2. **未知工程参数不编造**；量不出来就留空 + 原因，不填“看起来合理”的数。
3. 主界面优先显示参数、结果和必要风险；不用大量解释文字占据界面。
4. 普通说明、长篇理论、内部计算过程**默认折叠**。
5. 真正影响结果有效性的问题必须明确显示；关键工程提示不能因精简而被删除。
6. 页面与报告的工程语义必须一致；同一事实不能出现两种口径。

### D.2 冒口计算

1. 目标模数：**`Mr_target = 1.2 × Mc`**。
2. 当前设计中心**固定 `H/D = 1.0`**。
3. 体积验证**不参与**冒口尺寸反求；它只是辅助信息。
4. 不允许因体积校核失败而自动放大冒口。
5. 体积校核失败不能被夸大成“已经证实的工程失效结论”。
6. 没有核实公式、参数和适用范围前，不修改冒口计算算法。
7. **模数达标不等于补缩能力已经得到验证**；结果与报告必须保持这个区分。

### D.3 出品率

1. **单件与整模重量口径必须分开**。
2. **设计预估出品率与实际出品率必须分开**。
3. **不能把反推残差称为实测浇道重量**；当前正确叫法是“反推残差（假设每腔一套冒口）”。
4. 没有必要的实测数据时，**不得虚构最终实际出品率**；`finalYield` 保持 `null`。
5. 出品率问题独立处理，不借机大范围解冻计算核心。
6. 1/2/4 腔展示必须使用整模账目；不得用“单件 ÷ 整模 G”得出假低出品率。

### D.4 H/D 开放计划（**尚未实施，属待决策/待授权**）

用户倾向开放有限 H/D 选项，但当前状态必须说清楚：

| 项 | 当前事实 |
|---|---|
| 设计中心 | **固定 1.0**；`calcManifest.js:280` 硬编码 |
| 独立冒口计算器 | 支持 `0.8 / 1.0 / 1.2 / 1.5`；没有 2.0 选项 |
| 球形冒口 | `H ≡ D`；`hd_ratio` 不改变几何；计算器已**隐藏** H/D 选择器并显示说明 |
| 柱/方/球顶柱 | `runRiser` 接受任意正 `hd_ratio`；`H = round(D × hd)`；球顶柱额外保证 `H ≥ R` |
| 设计中心结果 | 只显示 `H/D = 1.00（只读 · 设计中心固定）` |

**候选比例**：`0.8 / 1.0 / 1.2 / 1.5`，默认 `1.0`（兼容现有行为）。

**若要实施，最小方案是**（详见 S3 报告 §5.3）：

1. 新增 `process.hdRatio`（默认 1.0，来源/恢复语义与其他设计参数一致）；
2. `calcManifest` 的 riser 调用改为读取该参数（缺省 1.0），仍走 `runRiser`；
3. UI 按形状给选项：柱/方/球顶柱可用；球形不提供或只读说明；
4. 结果页/报告显示实际 H/D 与“球形 H≡D”的限制；
5. **重新基线化 49 个历史 riser 用例**（hd≠1 会改变 D/H/Vr）。

**这不是纯 UI 改动**：会触碰冻结文件并改变设计中心计算语义；必须先获得明确授权。

### D.5 交互逻辑

1. 分析条件窗口和工艺设计窗口底部使用「保存」。
2. 保存只保存参数，不执行完整分析。
3. 顶部第四项「分析」执行完整分析。
4. 分析使用最新**已保存**的有效参数；有草稿时先确认，不静默用旧值。
5. 参数变化后旧结果必须标记过期。
6. 分析失败后不能把旧结果伪装成最新有效结果；旧结果保留显示但必须标为过期。
7. 保存失败不得清草稿、不得触发分析。

### D.6 冻结与数据安全

1. `js/engine/**` 7 个文件、`calcs/riser.js`、`calcs/riserDreq.js`、`calcs/calcManifest.js`
   属于冻结边界；只读可以，改动必须明确授权并记录指纹。
2. `calcManifest.js` 的唯一已授权变更：S4 的 `yield.calculate` 新增整模字段；
   当前指纹 `e8d4d9a5`。
3. 不执行任何破坏性 Git 操作；不自动提交/推送/发布。
4. 当前 131 项未提交工作是**必须保护的现有工作**。

---

## E. 待办清单（按优先级）

> 状态标记：**已完成** / **部分完成** / **未开始** / **待决策** / **受阻**。
> 每项说明：已有证据、剩余工作、验收标准、是否涉及冻结文件。

### E.1 必须处理（保护性/基础）

#### E1-1 保护当前工作区

- **状态**：持续要求。
- **证据**：分支 `main`、HEAD `da1c822`、131 项未提交（41 M + 90 ??）。
- **剩余工作**：不清理、不回滚；如需提交/发布，等待用户明确授权。
- **验收**：工作区内容不丢失；新窗口能复述 HEAD 与未提交数量。
- **冻结**：不涉及（但不得用 Git 操作破坏冻结文件）。

#### E1-2 保持冻结边界与测试基线

- **状态**：已完成基线核对（本次指纹重算）。
- **证据**：10 个指纹见 §B.6；`calcManifest` 唯一变更。
- **剩余工作**：后续任何阶段开始前重新核对指纹；出现变化先解释来源。
- **验收**：指纹逐位匹配或有授权记录。
- **冻结**：涉及全部冻结文件。

### E.2 应当处理（产品能力）

#### E2-1 设计中心有限 H/D 开放

- **状态**：**待决策 + 待授权**；当前未实现。
- **证据**：S3 报告 §5；`calcManifest.js:280`；独立计算器 `riserView.js:90-102`；
  球形隐藏逻辑 `riserView.js:208-216`。
- **剩余工作**：产品确认比例与默认值；新增参数；改 riser 调用；UI；结果/报告；49 用例重基线。
- **验收**：默认 1.0 时结果与当前逐位一致；柱/方/球顶柱四档可调；球形无 H/D 输入；
  D/H/Vr/结果/报告一致；模数达标仍不等于补缩验证；回归通过。
- **冻结**：**涉及 `calcManifest.js` + `riser.js` 语义边界**；必须先报告。

#### E2-2 最终实重出品率输入与口径

- **状态**：**待决策 + 缺数据**；当前 `finalYield = null`。
- **证据**：`calcManifest.js:355-407`；S4 报告 §8；`yieldLedger.js`。
- **剩余工作**：决定是否新增实测浇注重量/独立浇道实重输入；定义“最终实重出品率”的公式与来源；
  1/2/4 腔测试；无数据时保持 null。
- **验收**：没有实测数据时绝不给出数字；有数据时单件/整模/设计/实际四分口径清楚；
  页面与报告同源。
- **冻结**：可能涉及 `calcManifest.js`（出品率字段）与展示层；先报告。

#### E2-3 结果页内联参数语义统一

- **状态**：**待决策**；当前保留 600ms 自动重算。
- **证据**：`designCenter.js:2654` `autoRecompute()`；S4 报告 §7.1/§13。
- **剩余工作**：决定是否也改为“只标记过期，必须点 ④”；若改，需要更新浏览器测试与用户习惯。
- **验收**：参数窗口保存与结果页内联行为有明确、可解释的差异，或完全统一；不出现两条隐式规则。
- **冻结**：不涉及计算核心。

#### E2-4 完成剩余高价值页面的提示审计

- **状态**：**部分完成**；S4 覆盖高频页面，未逐页覆盖全部专用计算器。
- **证据**：S4 报告 §3/§13。
- **剩余工作**：垂直线、其他专用计算器、向导、部分知识库页面；按 P0–P3 规则检查重复/长文。
- **验收**：主界面无重复长解释；关键提示保留；中英文同步；仍可通过现有测试。
- **冻结**：不涉及计算核心。

### E.3 可后续处理（P0/P2 长线）

#### E3-1 录入真实件基准（反向案例优先）

- **状态**：**受阻（缺外部数据）**；`data/riser-benchmark/cases.csv` 仅表头，**0 条记录**。
- **证据**：本次读取文件；旧交接书 §4；S4 未改动。
- **剩余工作**：收集 3~5 个真实件的实际冒口 D/H、缩孔检验结果；按 37 列填写；运行
  `scripts/validate_benchmark.mjs`。
- **验收**：至少 3 条可复核真实记录；优先反向案例；不写生产代码。
- **冻结**：不涉及生产计算；数据文件可新增。

#### E3-2 P2 低压浇注计算器

- **状态**：**未启动**；资料已找到。
- **证据**：`docs/PHASE_V2.0-P2_LOWPRESSURE_ANALYSIS.md`；
  `D:\CDXProject\CCproject\1_铸造工艺计算表.xls` 的 `低压压力` / `低压浇铸系统`。
- **剩余工作**：先解决两处无出处系数（浇注重量 ×1.8、入水口直径 ×1.2 的企业依据）；
  再设计输入/输出/校核；只有 1 个铝合金算例，不能当成通用验证。
- **验收**：公式链逐格可复算；系数有出处或明确标注“待确认”；不编造工程结论。
- **冻结**：新增计算器为主；若改共享计算核心需单独授权。

#### E3-3 P0 冒口尺寸主因与体积模型

- **状态**：**未解决**；S4 未触碰。
- **证据**：`calcManifest.js:274` 使用整件净重；旧交接书 §0/§3.3 记录实测偏大。
- **剩余工作**：需要工程裁决：体积校核对象、是否改变约束、是否需要真实件标定。
- **验收**：有明确的工程依据与回归；不得为了让冒口变小而调系数。
- **冻结**：**涉及 `calcManifest.js` / `riser.js` 核心语义；必须先报告**。

### E.4 需要产品或工程决策（不得擅自实施）

1. H/D 比例最终集合与默认值（候选 0.8/1.0/1.2/1.5）。
2. 最终实重出品率的数据来源与公式。
3. 结果页内联参数是否必须显式分析。
4. 体积校核对象与 P0 冒口尺寸修复方向。
5. 低压系数 1.8 / 1.2 的企业依据。
6. 是否提交当前 131 项工作、何时发布（默认：不自动）。

---

## F. 工程风险与禁止事项

### F.1 绝对禁止

- 不执行 `git reset`、`git checkout`、`git clean`、`git stash`。
- 不删除、覆盖或回滚已有未提交工作。
- 不自动提交、推送或发布。
- 不通过删除测试、删断言、跳过测试或改测试期望来“制造通过”。
- 不引入 CDN 或新的外部运行时依赖。
- 不编造实测数据、最终出品率、浇道重量或工程结论。
- 不改写 V1.1 已发布版本的行为。

### F.2 冻结边界

```text
js/engine/**（7 个文件）
calcs/riser.js
calcs/riserDreq.js
calcs/calcManifest.js
```

- 当前 10 指纹见 §B.6；
- 只有 `calcManifest.js` 的 `yield.calculate` 新增字段获过授权；
- 任何其他冻结改动 = 先暂停、说明原因、给方案、等授权；
- “冻结”指“不要动”，不是“历史上从未动过”。

### F.3 数据口径风险

- `cw` / 体积校核使用整件净重，是 P0 冒口偏大的已知根因之一；
- 体积校核是辅助诊断，不是“冒口一定会缩孔”的证明；
- `gatingWtResidual` 是反推残差，不是实测浇道重；
- `finalYield = null` 是正确状态，不是缺陷；
- 1/2/4 腔必须用整模账目；单件/整模混算会产生假低出品率；
- 设计预估（`designYield`）与最终实重（`finalYield`）不能混用；
- 显示设计出品率使用未舍入 `g.ya`，避免 69% vs 68.5% 的显示差异。

### F.4 测试与日志风险

- `phase24 T5`、inspection 2 项、stl marker 1 项是**历史失败**，不是本轮新增；
- 日志里的 `hotspot_v2` 自报 `41/1` 不是 runner 汇总；
- 性能门限 `large thin shell < 8s` 在并发时可能假红；
- 旧交接书的 `840/1`、`891/1` 是历史基线；当前 S4 报告为 **896/1**；
- 交互测试改契约时必须说明“旧行为被新契约取代”，不能悄悄放宽断言。

### F.5 当前代码与产品原则的已知差异

| 原则 | 当前代码事实 | 处理 |
|---|---|---|
| 保存只保存，分析显式 | 参数面板已满足；**结果页内联仍 600ms 自动重算** | 待决策（E2-3） |
| 设计中心 H/D=1 | 已满足（硬编码 1.0） | 若要开放，见 E2-1 |
| 最终实重出品率不编造 | 已满足（`finalYield=null`） | 缺实测数据时保持 |
| 体积失败不放大冒口 | 已满足（体积为诊断） | 不要改回自动放大 |
| 球形不显示无效 H/D | 独立计算器已隐藏；设计中心球形同样不显示可调项 | 已满足 |
| 中文/英文同步 | S4 浏览器 i18n 审计 0 遗漏 | 后续新增词条继续同步 |

---

## G. 下一步建议

### G.1 新窗口首先做什么

1. **只读核对**：读本文件 → 读 S4 报告 → `git branch/HEAD/status` → 核对 10 指纹。
2. **最小代码核实**：只验证与下一步直接相关的结论：
   - `saveParamDraft` 不调用分析；
   - `calcManifest.js:280` 仍硬编码 `hd_ratio: 1.0`；
   - `yield.calculate` 新字段仍在；
   - 球形 H/D 选择器仍隐藏。
3. **输出简短状态确认**（不超过 15 行）：实际进度、已完成、未完成、与交接书不一致处、推荐下一步。
4. 若无关键矛盾，继续推进；涉及冻结/产品/实测数据时先暂停报告。

### G.2 当前推荐的下一个开发主题

**首选：设计中心有限 H/D 开放（先方案，后授权实施）。**

理由：

- 用户已明确倾向开放有限 H/D；
- 候选比例、默认值、球形限制和最小实现路径已经明确；
- 它是当前“工作台可用性”中最清晰、最可见的未完成能力；
- **但它会触碰冻结计算语义**，所以不能直接写代码，必须先获得授权并重新基线化 49 个用例。

建议顺序：

1. 先出 **H/D 最小实现方案 + 影响清单**（不写生产代码）；
2. 明确要改的文件、49 个用例的重基线范围、hd=1 数值不变的验收；
3. 获得用户授权后再实施；
4. 实施后跑专项 + 全量 + 中英文 + 结果/报告一致性。

### G.3 可直接实施（不触碰冻结/无需产品决策）

- 继续完成剩余专用页面的提示审计（纯展示层，保持工程信息）；
- 补 H/D 方案文档和测试计划；
- 补测试证据归档（若用户需要当前时点的全量日志，空载重跑并保存）；
- 整理真实件基准的录入模板（数据仍待用户提供）。

### G.4 必须先报告、不能擅自做

1. 修改 `calcManifest.js` 的 riser 调用或 H/D；
2. 修改 `riser.js` 尺寸/体积算法；
3. 修改 `finalYield` 公式或新增实测输入；
4. 改动体积校核对象；
5. 引入低压系数 1.8/1.2；
6. 任何提交、推送、发布、版本号变更；
7. 任何会删除/回滚未提交工作的操作。

### G.5 建议的验收方式（H/D 实施时）

- `hd=1`：与当前结果逐位一致（含 D/H/Vr）；
- 四形状 × 四比例：D/H/Vr 内部一致，球顶柱 `H≥R`；
- 球形：无 H/D 输入，结果与当前一致；
- 结果页/报告：实际 H/D 一致，不出现“模数达标=补缩已验证”的措辞；
- 页面/报告同源；中英文；移动端；
- 49 个历史 riser 用例重基线并记录原因；
- 全量 Node + 相关浏览器回归；历史失败与新增失败分开。

---

## H. 参考资料索引

### H.1 报告

| 路径 | 用途 |
|---|---|
| `docs/PHASE_V2.0-P1-R6-S4_REPORT.md` | **本轮 S4 实际报告（优先）** |
| `docs/PHASE_V2.0-P1-R6-S3.1_REPORT.md` | S3.1 RH/结果/报告同源、提示分级 |
| `docs/PHASE_V2.0-P1-R6-S3_WORKBENCH_FLOW_REPORT.md` | S3 工作台闭环；**§5 H/D 评估** |
| `docs/PHASE_V2.0-P1-R6-S2.2_WORKBENCH_FIX_REPORT.md` | S2.2 保存/分析状态与形状修复 |
| `docs/PHASE_V2.0-P1-R6-S2.1_DIAGNOSTIC_REPORT.md` | S2.1 诊断 |
| `docs/PHASE_V2.0-P0-22_FREEZE.md` | 冻结规则 |
| `docs/PHASE_V2.0-P2_LOWPRESSURE_ANALYSIS.md` | P2 低压资料与无出处系数 |
| `docs/HANDOFF_2026-10-07.md` | 历史交接（数字过期） |
| `tests/engineering-generated/BASELINE.md` | 指纹与各阶段基线 |

### H.2 关键生产代码

| 文件 | 用途 |
|---|---|
| `js/views/designCenter.js` | 工作台、保存/分析、草稿、布局 |
| `js/views/resultsCenter.js` | 结果页 |
| `js/views/reportGenerator.js` | 工艺计算报告 |
| `js/views/resultFacts.js` | 页面/报告共用事实 |
| `js/views/yieldLedger.js` | 整模账目 |
| `calcs/calcManifest.js` | 计算器注册、H/D 硬编码、出品率新增字段 |
| `calcs/riser.js` | 冒口公式与尺寸搜索（冻结） |
| `calcs/riserDreq.js` | 理论 D_req（冻结，零接入） |
| `js/model/CastingProject.js` | 唯一项目数据模型 |
| `js/views/riserView.js` | 独立冒口计算器（H/D 四档、球形隐藏） |
| `css/app.css` | `.dc-chrome`、8px、提示分级、移动端 |

### H.3 测试与脚本

| 路径 | 用途 |
|---|---|
| `tests/runner.mjs` | Node runner（文件名子串，非递归） |
| `tests/phases4_s4_test.mjs` | S4 专项 5 项 |
| `scripts/browser_s4_test.mjs` | S4 浏览器 30 项 |
| `scripts/shot_s4.mjs` | 9 张截图 |
| `scripts/browser_s1_test.mjs` / `browser_s22_test.mjs` / `browser_s3_test.mjs` / `browser_s31_test.mjs` | 工作台回归 |
| `scripts/browser_dc_715_test.mjs` / `browser_p78_test.mjs` / `browser_dc_r3_test.mjs` / `browser_responsive_test.mjs` | 设计中心/响应式回归 |
| `scripts/browser_i18n_audit.mjs` | 中英文 DOM 审计 |
| `scripts/browser_stl_test.mjs` / `browser_stl_p22_test.mjs` | STL 回归 |
| `scripts/browser_inspection_test.mjs` | 检验中心回归（2 项历史失败） |

### H.4 截图

`screenshots/s4_01…s4_09`（详见 §B.5 和 S4 报告 §14）。

### H.5 外部数据（仓库外，不在本仓库）

| 路径 | 用途 |
|---|---|
| `D:\CDXProject\CCproject\1_铸造工艺计算表.xls` | 低压压力/低压浇铸系统原始资料 |
| `data/riser-benchmark/cases.csv` | 真实件基准表（37 列，**0 条记录**） |
| `tests/real-stl/` | 4 个真实 STL（若仍存在，使用前核对） |

---

## I. 交接完成标准与停止声明

本交接满足：

- [x] 交接文档已实际写入项目；
- [x] 基于当前工作区和 S4 实际报告；
- [x] 区分完成、未完成、计划中、待决策；
- [x] 记录产品原则与工程边界；
- [x] 没有把历史状态冒充当前状态；
- [x] 没有修改代码、没有删除/回滚工作；
- [x] 没有自动提交、推送或发布；
- [x] 已生成新窗口启动指令（`docs/PHASE_V2.0_HANDOFF_2026-10-21_START_PROMPT.md`）。

**停止声明**：交接完成后不继续开发其他功能。新窗口按启动指令执行。
