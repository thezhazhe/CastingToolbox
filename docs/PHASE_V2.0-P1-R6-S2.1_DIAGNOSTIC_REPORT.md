# PHASE V2.0-P1-R6-S2.1 · 关键缺陷诊断与工作台调整方案（只读）

> 输入：`D:\CDXProject\新建 文本文档 (151).txt`
> 性质：**只读诊断**。产品代码 / 测试 / 配置 / 其它文档**零改动**；唯一新增文件 = 本报告。
> 未提交、未推送、未发布。未开始 R6-S3。

---

## 1. 检查范围与实际基线

| 项 | 实际值 |
|---|---|
| 分支 / HEAD | `main` / `da1c82268fcaea3df089fbf4a6517754954f086f` |
| 工作区（本报告落盘前） | **110 项**（36 个已跟踪修改 + 既有未跟踪文件） |
| R6-S2 报告 | `docs/PHASE_V2.0-P1-R6_S2_CHECKPOINT.md` 已读；**代码与报告一致** |
| 工作区 109 → 110 的差额 | S2 交接文档自身落盘（`docs/PHASE_V2.0-P1-R6_S2_CHECKPOINT.md`，未跟踪）；**不是意外改动** |
| 冻结指纹（10 个） | **逐位未变**：`riser.js 5cfcfef3` · `riserDreq.js efdc2301` · `calcManifest.js c1d3ec3c` · `hotspotV3 d774532a` · `peakRegion 8d61d26d` · `sampling 5957831c` · `modulusField 48488b13` · `configV3 80a763ef` · `meshValidation 5af64ae4` · `v3ViewAdapter 1e3d96cc` |
| 测试 | **未重跑全量**（§二.5 明令不重复昂贵测试）。只做了两次**真实浏览器只读探针** + 一次模型层只读探针，均 exit 0（详见 §11） |

本次未重新调查 S0 已覆盖的引擎/字段全貌；只补充了本次问题所需的证据。
未发现「代码与 R6-S2 报告不一致」的情况。

---

## 2. P0：冒口形状切换后数值不变

### 2.1 完整数据流（逐段实测）

| # | 环节 | 实际实现（文件:行） |
|---|---|---|
| 1 | 形状选择控件 | 面板 ③ B：`[data-pf="process.riserShape"]`，字段定义 `js/views/designCenter.js:661-662`；选项由 `RISER_SHAPES` 生成 `:835-836`。**另一入口**：结果页 `#dc_riserShape`，`js/views/resultsCenter.js:197-208` |
| 2 | 选择事件 | 面板：`renderParamPanel` 的统一 `[data-pf]` 处理器 `designCenter.js:937-957` —— **只写草稿 + 刷新页脚**，不写项目、不重渲染（`shapeRow` 无特殊处理）。结果页：`resultsCenter.js:668` —— 直接 `proj.set` + `autoRecompute` |
| 3 | 草稿 / 保存 | `saveParamDraft()` `designCenter.js:1294-1353`：`proj.set(path, v)` → `markChangedStale` → 重渲染面板 → `autoRecompute` |
| 4 | 进入计算的数据 | `calcs/calcManifest.js:277` 读 `process.riserShape`；`:278-281` 调用 `runRiser({ shape: riserShape, hd_ratio: 1.0, ... })`（**hd_ratio 硬编码 1.0**） |
| 5 | 计算函数与形状分支 | `calcs/riser.js:58-93` `RISER_SHAPES`（每形状独立 `M/V/DfromM/label`）；`runRiser` `:147+`；尺寸由 `Mr_target` 反求（`:252-262`）；`shapeKey` 随结果回传 `:309` |
| 6 | 计算输出 | `D/H/Mr_target/Mr_act/Vr/eff/effV/d_neck/neck_k/shapeKey`（`riser.js:309-326`） |
| 7 | 结果视图 | `resultsCenter.js:82-96` 按 `shapeKey` 给尺寸字段；`:117-167` 核心卡 + 详细信息；`:197-208` 结果页内联形状下拉 |
| 8 | 缓存 / 失效 / 重算 | `runAnalysis` 整体替换 `state.results`；`markChangedStale` `designCenter.js:1359-1368`；`autoRecompute` `:2381-2391`（600 ms 防抖，`keepScroll`）；结果重渲染 `:2565+` |

**结论：链路上没有任何一段丢失 shape。** 形状从 UI → 草稿 → 项目 → 计算入参 → 输出 `shapeKey` → 结果映射全部逐段可追踪。

### 2.2 最小验证矩阵（真实浏览器，只读）

条件：`tests/golden/cube50.stl` · 球铁 · 无热结（`NO_HOTSPOT`，兜底 `wallHot=25`）· 分析已完成。
路径：面板 ③ → B → 改形状 → 「保存并重新分析」→ 等 `risers.items[0].shapeKey` 更新后读结果页。
（结果页内联下拉路径另单独验证了一次，结论相同。）

| 项目 | 圆柱形 `cyl` | 球形 `sphere` | 正方柱 `square` | 球顶圆柱 `sphere_head` |
|---|---|---|---|---|
| UI 实际选中值 | `cyl` | `sphere` | `square` | `sphere_head` |
| 保存后的参数值 | `cyl` | `sphere` | `square` | `sphere_head` |
| 实际计算输入 | `shapeKey=cyl` | `shapeKey=sphere` | `shapeKey=square` | `shapeKey=sphere_head` |
| 实际使用的形状分支 | cyl | sphere | square | sphere_head |
| 直径 / 等效尺寸 D (mm) | **180** | **180**（球径） | **180**（边长） | **180** |
| 高度 H (mm) | **180** | 180（≡D） | **180** | **180** |
| Mc (mm) | **25** | **25** | **25** | **25** |
| Mr_target (mm) | **30** | **30** | **30** | **30** |
| Mr_act (mm) | **30** | **30** | **30** | **30** |
| 冒口颈 ⌀ (mm) | **100** | **100** | **100** | **100** |
| 冒口体积 Vr (cm³) | **4580.4** | **3053.6** | **5832.0** | **3817.0** |
| 补缩效率 eff | **14%** | **20%** | **14%** | **25%** |
| 可补缩量 effV (cm³) | **641.3** | **610.7** | **816.5** | **954.3** |
| 结果页「冒口规格」 | `⌀180×H180` | `球⌀180` | `方180×H180` | `⌀180×H180（R90）` |
| 结果页「可补缩量」 | 641.3 | 610.7 | 816.5 | 954.3 |

**读法：只有最右三列（Vr / eff / effV）随形状变化；D、H、Mc、Mr_target、Mr_act、冒口颈全部逐位相同。**
这不是四舍五入造成的，也不是 UI 没刷新——同一结果对象里，这些量本来就相同。

### 2.3 根因判断（逐类对账）

| 分类 | 判断 | 证据 |
|---|---|---|
| A. UI 选项值没有更新 | **否** | 改变后 `select.value` 逐形状正确；页脚立即显示「有 1 项修改尚未保存」 |
| B. 草稿 / 保存丢失形状 | **否** | 保存后 `process.riserShape` 逐形状正确；结果页内联下拉也同步显示 |
| C. 计算未收到形状 | **否** | `risers.items[0].shapeKey` 逐形状正确 |
| D. 计算收到但没用 | **否** | Vr 3053.6→5832.0、eff 14%→25%、effV 610.7→954.3，逐形状不同 |
| E. 计算结果对，结果视图读错 | **否** | 结果页规格写法、尺寸字段、Vr/eff/可补缩量都与引擎输出一致；`shapeSizeCells` 按 `shapeKey` 分支 |
| F. 没重新分析，仍显示旧结果 | **否** | 保存后 600 ms 防抖重算；探针轮询到 `shapeKey` 切换后才读 DOM，DOM 已更新 |
| **G. 其他（观察层）** | **是** | 见下 |

**G 的三个组成：**

1. **★ 引擎事实（不是缺陷，不得"修"）**：设计中心固定 `hd_ratio = 1.0` 调 `runRiser`（`calcManifest.js:280`）。四种形状的模数式在该口径下**全部化简为 `M = D/6`**：
   - `cyl/square`：`D·H/(2D+4H)`，`H=D` ⇒ `D/6`
   - `sphere_head`：`V/A` ⇒ `D/6`（引擎实现；与它自己的"底面不散热"文案存在已知矛盾，见 148-S0）
   - `sphere`：本即 `D/6`
   尺寸只由 `Mr_target = 1.2 × Mc` 反求 ⇒ **D、H、Mr、冒口颈必然四形状相同**。换形状真正改变的是 **Vr 与补缩效率**。这与 145 / 148-S0 的结论逐位一致，且已被 `browser_dc_r3_test.mjs` 钉住。
2. **★ 信息层级**：结果页把"为什么换形状不改 D/H"的解释放在 `<details class="dc-adv-detail">` **内部**（`resultsCenter.js:126` 的 `shapeDiffNote` 在 `:146` 打开的折叠区里）。默认收起 ⇒ 用户切换形状时，最容易看到的仍是四项全同的尺寸/模数；真正变化的 `可补缩量` 是第三张核心卡，视觉权重低于第一张的"规格"与第二张的"模数校核"。
3. **★ 面板内的帮助文案是陈旧的（真实显示缺陷）**：在 ③ B 改形状后，下拉框本身变了，但**下面的「当前形状公式」「当前形状的补缩效率」仍显示旧形状**，直到点保存重渲染。实测：
   - 选中 `sphere` 后：`select.value = "sphere"`；
   - 但同字段下仍为 `当前形状公式：M = D×H / (2D+4H)…`、`当前形状的补缩效率：14%（圆柱形）`。
   原因：`[data-pf]` 处理器只写草稿 + 刷新页脚（`designCenter.js:937-957`），不更新 `shapeNoteHtml()` 生成的节点。**这会让"切换形状"这个动作在面板里几乎没有任何即时反馈**。
4. **★ 两套保存语义并存**：面板里改形状是**草稿**（必须「保存并重新分析」才影响结果）；结果页 `#dc_riserShape` 是**立即写项目 + 自动重算**（`resultsCenter.js:668`）。同一个参数、两个入口、两种反馈，用户很容易在其中一处得出"没用"的结论。

**结论：不是计算缺陷，不改 `js/engine/**`、`calcs/riser.js`、`calcs/calcManifest.js`、`calcs/riserDreq.js`、公式、默认值或测试期望。**
最小的正确修复方向是：**让"形状改变的是 Vr/可补缩量、不是 D/H"在切换点就可见**，并消除面板内的陈旧帮助文案。

---

## 3. RH（冒口高度）的真实数据流

### 3.1 定义与读写链

| 问题 | 实际答案（带位置） |
|---|---|
| RH 是什么 | `process.riserHeight`，默认 `0` / `DEFAULT`（`CastingProject.js:86`）。**默认不是用户输入，也不是独立几何字段**：它是冒口计算的**输出回写值** |
| 谁写 | `runAnalysis` 在 riser 成功后：若 `process.riserHeight` 不是 `USER_OVERRIDE`，`proj.setResult('process.riserHeight', r.H)`（`designCenter.js:2511-2518`）⇒ 来源 `CALC_RESULT` |
| 谁读 | `calcs/calcManifest.js:151` 以 `rh` 传入 gating；`calcs/gating.js:155` 读取，`:174` `Cmm = ph + rh`，`:180` `calc_Hp(pos, Ho, Hb, Pv, Cmm, rh)`；结果对象回传 `rh / Cmm / Hp`（`:367-369`），结果页 `resultsCenter.js:337-341` 展示 |
| 是否参与浇注计算 | **是**：影响 `C = ph + rh` 与平均静压头 `Hp`（顶注 / 中注 / 底注三种公式均含 `rh`），进而影响阻流面积与浇道尺寸 |
| 冒口与浇注是否同一数据源 | **是**。只有一个 `process.riserHeight`；gating 不另存 rh，只读它。没有第二个存储 |
| 改形状/尺寸是否同步 | **会**，但前提是 `H` 真的变：riser 成功 → 回写 `r.H`；用户显式改过 RH（`USER_OVERRIDE`）则不再覆盖。本工具 hd=1 下四形状 `H` 恒为 180 ⇒ **切形状不会改变 RH**（实测 180 恒定） |
| 是否存在同名字段/重复存储 | **没有**。`calcManifest` / `gating` 里的 `rh` 都是局部变量；UI 只有一个字段。**但有一个来源语义缺口**：换 STL 时 `clearStlBoundData()` 用 `clearIfNotUserInput('process.riserHeight')`，只保留 `USER_INPUT`（`CastingProject.js:399-425`）；而当前 UI 改 RH 走 `proj.set` ⇒ 来源是 `USER_OVERRIDE` ⇒ **换 STL 会被清掉**。代码注释声称"用户手动填预估保留"，与实际 UI 来源不一致 |
| 能否"恢复自动值" | **不能**。`setResult` 写入 `CALC_RESULT` 时不会固化 `orig`（`CastingProject.js:203-240` 的 `wasAuto` 只含 `STL_GEOMETRY_ANALYSIS` / `DERIVED`）⇒ 用户覆盖后 `p.orig` 为空，`restoreAutoValue()` 返回 false。好在当前 RH 字段没有 `restore: true`，UI 没有错误地承诺 ↺；若未来要加"用冒口结果"按钮，应直接 `setResult` 或清 `USER_OVERRIDE` 后重跑，**不要依赖 `restoreAutoValue`** |

### 3.2 是否适合在浇注系统里展示

**建议：是，但采用「只读关联值 + 显式手动覆盖」，不要做成普通的可编辑输入框。**

依据：
- RH 的第一性来源是冒口设计结果；把它放在 C 浇注系统里最符合用户的心智（"浇注系统要用它算 Hp"）。
- 但 `rh` 确实是 gating 的真实输入，且在没有冒口结果时需要预估（riser 被阻断 / 用户先做浇注校核）⇒ 不能一刀切只读。
- 推荐形态：C 模块顶部显示 `冒口高度 RH（来自冒口设计）` + 来源徽章 + 值；默认只读。旁边一个「手动覆盖」开关，开启后才出现输入框（写入 `USER_OVERRIDE`，riser 不再覆盖）；再次关闭时重新采用冒口结果。这样既保留能力，又让"自动/手动"一眼可见。
- 不建议把它留在 B 冒口设计里作为普通数字框：用户会以为它是冒口设计的一个独立自由度，而它其实是冒口结果的回写。

---

## 4. 四类参数的实际字段归属清单

> 只列**当前代码里真实存在、且与设计中心相关**的字段。"建议归属"是给 S3/后续调整的依据，不是本次改动。

### A. 模型与几何信息

| 字段 / 路径 | 数据性质 | 当前显示位置 | 建议归属 |
|---|---|---|---|
| STL 文件、文件名、`meta.stlSession` | 会话 / 导入 | 工具栏、`#dc_file` | A 模型信息 |
| `geometry.unit` | **STL 无单位 ⇒ 用户确认值**（`USER_INPUT`） | ② A 分析条件 | **A 模型信息**（"模型单位"本质是模型属性，且影响全部派生量） |
| `geometry.size` / `bounds` / `center` / `triCount` | STL 自动识别 | 概览 / 只读行 | A |
| `geometry.volumeCm3` / `areaCm2` | STL 自动（体积可被用户改，当前无 UI 入口） | 只读行显示体积 | A |
| `geometry.wallMax` / `wallAvg` / `wallHist` | STL 自动 | 只读行显示最大壁厚 | A |
| `geometry.netWeightKg` | **派生**（体积 × 固态密度） | 只读行 | A |
| `geometry.blankWeightKg` | **派生默认 = 净重，用户可上调含余量**（必填） | ② A 可编辑 | A（模型信息）或分析条件顶部；语义是"铸件本身的重量"，不是工艺参数 |
| `geometry.valid` / `geomStatus` / `meshIssues` | 派生 / 校验结果 | STL 校验区 | A |
| `hotspots.status` / `reason` / `items` | STL 自动识别 | 概览 + 左栏热结列表 | A（只读参考） |
| `hotspots.sampling` | 会话诊断 | 诊断区 / 状态栏 | A |
| `process.wallUsed` | **STL 可信主体壁厚 → 派生，可改** | ② A 可编辑 | A 或 B（见下：它同时是"浇注时间用"与"无热结时 wallHot 的基准"，更偏工艺口径） |
| `process.wallHot` | 派生 = 主体壁厚 ÷ 2 | 不直接显示 | 不单列（随 `wallUsed` 联动） |
| `process.mcHotspot` | **STL 自动 / 用户修改**（未确认的初步估算） | ③ B 可编辑 + 来源说明 | C 冒口设计（作为设计输入） |
| `process.hsPick` | 用户输入（勾选 + 逐热结 Mc） | 左栏 + ③ B | C 冒口设计 |

**未确认值**：`geometry.unit`（必须用户确认）、`geometry.blankWeightKg`（默认净重，是否含加工余量需用户确认）、`process.wallUsed`（STL 估计，可改）、`process.mcHotspot`（06A1 明确标注"未经确认的自动估计"）、低置信度热结候选。

### B. 材料与分析条件

| 字段 | 数据性质 | 当前显示 | 建议 |
|---|---|---|---|
| `material.family` | **用户输入，唯一无可靠默认值的必需项** | ② A | 保留在分析条件（必填） |
| `process.wallUsed` | 自动/可改 | ② A | 可留在分析条件（"浇注时间用主壁厚"），或并入模型信息的"代表壁厚" |
| `geometry.blankWeightKg` | 派生 + 用户确认（必填） | ② A | 见 A；若强调"分析前确认"，可留在分析条件 |
| `material.liquidDensity` / `solidDensity` / `yieldMin` / `yieldMax` / `yieldSug` | 材料表自动；`yieldSug` 可改 | `yieldSug` 在 C 生产条件 | 密度类不暴露（随材料自动）；`yieldSug` 留在生产条件 |
| `material.grade` / `pourTemp` / `linearShrinkage` | 存在但当前设计中心面板不暴露 | 无 | 若后续要做收缩/加工余量细化，再按需恢复；本次不动 |
| `process.mcHotspot` / `process.wallHot` | 冒口设计输入/兜底 | ③ B | 归 C（冒口设计），不归"材料条件" |

**判断依据不是字段名**：`geometry.unit` 虽然出现在"分析条件"里，但它是模型属性；`blankWeightKg` 虽然影响浇注，但它是铸件本体的重量；`wallUsed` 同时服务 gating 与 riser 兜底，所以更适合分析条件；`mcHotspot`/`hsPick` 是冒口设计的直接输入，归 C。

### C. 冒口设计

| 字段 / 入口 | 数据性质 | 当前实现 |
|---|---|---|
| `hotspots.items` | 只读参考（检出热结） | 左栏列表 + ③ B 热结区 |
| `process.hsPick` | **用户输入；一个全局数组，元素 `{id, mc}`** | 左栏勾选（立即写项目）+ ③ B 勾选/逐热结 Mc（草稿） |
| `process.mcHotspot` | 单热结路径的 Mc（STL 自动 / 用户改） | ③ B 顶部 |
| `process.wallHot` | 无热结兜底 = 壁厚 ÷ 2 | 自动，不暴露 |
| `process.riserShape` | **用户选择；全局一个值，不按热结分开** | ③ B |
| `process.riserHeight` | **冒口结果回写，可覆盖** | ③ B（建议移到 C，见 §3） |
| 引擎输出 `D/H/Mr_target/Mr_act/Vr/eff/effV/d_neck` | 计算输出 | 结果页 |
| 公式 / 补缩效率帮助 | 来自 `RISER_SHAPES` / `RISER_EFF`（读冻结模块，不另写表） | ③ B 内联帮助 |

**关键确认：**
- **多热结参数不是各自独立保存**：勾选与逐热结 Mc 在**同一个** `process.hsPick` 数组里，按热结 `id` 绑定；`shape` / `riserHeight` 是全局单值，所有热结共用。`risers.items` 里每个热结各自有 D/H/Vr/eff。
- **热结勾选当前有两套语义**：左栏 = 立即写项目（`designCenter.js:2304-2321`）；③ B = 草稿（`:959-978`）。S2 已修掉"保存把左栏勾选覆盖回去"的静默回退，但**没有统一语义**。
- **热结选择放在冒口设计顶部：可行**。`hotspotPickHtml()` 是独立函数（`:1239-1278`），当前被插在 B 模块字段之后（`secHtml` 的 `head.map(fieldHtml)` 之后，`:884`）。把它移到 B 模块最上方只需要调整渲染顺序，不涉及计算。
- **不要新增"热结模数超过某阈值就必须设冒口"的规则**：现有代码没有该判据，也不应在 UI 里发明。热结列表已经显示 Mc / 区域 / 置信度；未勾选时按主热结 H1 自动设计。建议只把候选标为"候选/待确认"，并提供辅助信息。
- **可复用的推荐/恢复/定位入口**：
  - 引擎计算本身就是"推荐"；
  - 逐热结 ↺ 只把 Mc 改回检出值（写草稿，`data-dlg-hs-mc-reset`）；
  - `restoreAutoValue()` 只对 `STL_GEOMETRY_ANALYSIS` / `DERIVED` 来源有效（Mc、壁厚、毛坯重）；**RH（`CALC_RESULT`）不在其覆盖范围**。

### D. 浇注系统与生产条件

| 字段 | 类型 | 当前显示 | 备注 |
|---|---|---|---|
| `process.pourPos` | 用户输入 | ③ C | 决定 P / Hp |
| `process.Ho` | 用户输入（0 = 计算兜底 150） | ③ C | 需造型方案，STL 无法识别 |
| `process.ph` | 用户输入（0 = 计算兜底 100） | ③ C | 铸件高度（浇注方向） |
| `process.riserHeight` | **计算输出 + 可覆盖** | ③ B（建议移到 C） | 见 §3 |
| `process.ratioKey` | 用户输入（空 = 自动推荐） | ③ C | 直:横:内 |
| `process.gateThk` / `production.ingateN` | 用户输入（0 = 推荐） | ③ C + 结果页内联 | 两个编辑入口 |
| `process.runnerThk` / `production.runnerN` | 用户输入（0 = 默认 25 / 2） | ③ C + 结果页内联 | 两个编辑入口 |
| `process.ventD` | 用户输入（默认 3） | ③ C + 结果页内联 | 孔数由系统算，不手填 |
| `production.cavities` | **生产条件**（一模件数） | ③ C 生产条件 | 影响浇注时间与出品率 |
| `material.yieldSug` | **生产条件 / 材料参考值，可改** | ③ C 生产条件 | 出品率口径见 148-S0：不要引用"1.8 系数" |
| `production.line` | 生产条件 | ③ C | 影响出品率参考区间 |
| `production.method` | 生产条件 | ③ C | 影响加工余量等级 |
| `production.qty` / `production.prod` | 存在但设计中心不使用 | 无 | 不新增 UI |
| gating 计算输出（`Cmm/Hp/A/浇道尺寸/阻流位置/t/出品率` 等） | **计算输出** | 结果页 | 只读；不得反向变成输入 |
| `runner.result` | 计算结果 | 结果页 | 每轮分析整体替换 |

**禁止事项（已核对现状）**：没有为了"把结果页做得更像结果"而把计算输入改成计算输出；也没有第二套参数存储。结果页内联控件写的仍是 `CastingProject` 的同一字段。

---

## 5. 热结选择、逐热结编辑与保存语义（汇总）

1. **多热结是否独立保存**：`process.hsPick = [{id, mc}, ...]`，每条按热结 id 绑定；**shape / RH 是全局单值**。`risers.items` 逐热结保存计算结果，但输入侧只有一份 shape。
2. **勾选语义**：左栏立即生效；③ B 草稿。S2 已保证后写的那次赢（左栏勾选会作废同字段草稿），但两种反馈仍需用户理解。
3. **逐热结 Mc**：只改该 `id` 的条目，不影响其他热结（`p78` E(149) 有断言）；非正值不写入，输入框标红。
4. **可复用入口**：逐热结 ↺（改回检出值）；`restoreAutoValue`（仅 STL/DERIVED 来源）；`openParamAt(path)`（定位到字段，S3 可用于结果页）。
5. **热结选择放顶部**：可行，建议顺序 = **热结选择 → 形状 → 逐热结 Mc / 结果 → RH**。但不要发明"必须设冒口"的阈值规则。

---

## 6. 宽窗口与结果视图：首选方案

### 6.1 现状（实测 / 代码）

- 右侧任务面板固定 **360 px**（`css/app.css:1045`：`.dc-ws[data-task="open"] .dc-body { grid-template-columns: minmax(0,1fr) 360px }`）。
- 1410 px 视口实测：应用侧栏 236 px，`.dc-body` 1150 px；面板展开后三维区 **790 px**（面板收起时可用满 1150 px）。
- <960 px：面板变成全宽浮层（`css/app.css:1465-1476`），已有移动端适配。
- 结果视图**本来就是工作台内的独立视图**：`setWorkspaceView('results')`，结果占满 `.dc-body`（`css/app.css:1047-1051`），面板隐藏但草稿保留。它不是"小面板里的结果"。

### 6.2 三方案比较

| 指标 | A. 右侧面板 + 可扩展宽度 | B. 复杂编辑用宽窗口 / 轻量任务用面板 | C. 编辑与结果各自独立工作区 |
|---|---|---|---|
| 改动范围 | **小**：CSS 列宽 + 一个「加宽」开关 + 记忆偏好 | **中**：重新引入浮层窗口 + 草稿跨载体 + 焦点/滚动/backdrop | **大**：新工作区 + 视图状态机 + 导航 + 测试 |
| 复用现有代码 | **高**：复用 `renderParamPanel` / 字段/帮助/页脚/ResizeObserver | **低**：S2 刚删除的 `#dc_paramDlg` 会被重新造一遍 | **中**：结果视图可复用，编辑侧要新做 |
| 草稿/保存兼容 | **完全兼容**：仍是同一面板会话 | 需把草稿在浮层和面板之间搬来搬去，易出"两套草稿" | 需跨视图搬运，且增加关闭/切换路径 |
| 对三维/相机/热结选择 | **无影响**：面板只改 CSS 列宽，靠既有 ResizeObserver | **有影响**：浮层遮住三维，逐热结编辑时看不到模型 | **有影响**：编辑工作区若隐藏三维，失去"边看热结边改" |
| 桌面/移动适配 | **低**：桌面加宽；移动沿用现有全宽浮层 | **高**：浮层在移动端与现有浮层冲突 | **高**：两套工作区都要适配 |
| 重复实现 | **无** | 重复面板的全部行为 | 重复结果视图与编辑视图 |
| 后续维护 | **最低** | 最高（两套编辑载体 + 两套关闭规则） | 高（多一套导航/状态） |

### 6.3 首选：**方案 A**

- **编辑**：保留右侧任务面板；在宽屏（建议 ≥1440 px）提供「加宽」开关，360 → 约 520–560 px；记住偏好；<960 px 继续用现有全宽浮层。加宽只改 CSS 列宽，不重建 3D 容器、不动相机、不动草稿。
- **结果**：**不新建"宽窗口"**。结果已经是独立工作区（占满 `.dc-body`），继续复用；不要为了"宽"再造一个页面。
- **不选 B**：S2 刚删掉浮层，B 会把浮层、backdrop 堆叠、草稿跨载体、焦点恢复等一整套问题重新引入；逐热结编辑还需要看着三维。
- **不选 C（编辑侧）**：会重复结果视图已经解决的问题，并让"改参数时看模型"变得困难。

**避免草稿丢失**：沿用 S2 的"面板停在 ②/③ 的整段会话"；加宽开关只改布局，**不碰 `state.paramDraft` / `state.taskStep`**。结果视图切换仍按现有逻辑保留草稿（S3 补端到端断言）。

**结果失效 / 返回修改 / 重新分析闭环**：现有 `markChangedStale` + `autoRecompute` + `revealResults` 已具备；S3 要做的是补"改参数 → 过期 → 重算 → 过期消失"和"结果页去改参数 → 回到面板"的入口与断言，而不是重建机制。

---

## 7. 结果页快捷修改建议

**现有内联入口（都在结果页，直接写项目并触发重算）：**

| 结果页控件 | 字段 | 语义 |
|---|---|---|
| `#dc_riserShape` | `process.riserShape` | 立即写 + 600 ms 重算 |
| `#dc_gtEdit` / `#dc_gcEdit` | `process.gateThk` / `production.ingateN` | 立即写 + 重算 |
| `#dc_ventD` | `process.ventD` | 立即写 + 重算 |
| `#dc_rtEdit` / `#dc_rcEdit` | `process.runnerThk` / `production.runnerN` | 立即写 + 重算 |
| `#dc_gtReset` / `#dc_rtReset` | 恢复推荐 | 写 0（按推荐） |

**建议（S3，不在本次实施）：**
1. **不要再往结果页加新的输入框**。对 `Ho / ph / ratioKey / cavities / yieldSug / line / method / riserHeight` 等，加「去改这个参数」**链接**：`onEditParam(path)` → 先 `setWorkspaceView(container,'model')` → `openParamAt(container, path)`。一个参数只有一个编辑实现（面板）。
2. 现有内联控件**保留**（它们是 78/79/80.txt 的既定功能，测试也依赖），但要在报告/帮助里说明它们与面板草稿的语义差异；是否在后续统一成"跳转编辑"由用户拍板。
3. 保存后仍由 `markChangedStale` + `autoRecompute` 负责失效与重算；结果页不创建第二套存储。
4. 结果页只放"核心结论 / 关键数值 / 依据 / 限制"，快捷入口必须**定位到具体字段**，不能只打开一个泛泛的参数页。

---

## 8. 冒口几何比例：现有支持情况

| 比例 | 当前支持 | 代码位置 | 适用形状 / 注意 |
|---|---|---|---|
| **H/D（`hd_ratio`）** | 引擎支持任意正数；**设计中心硬编码 1.0**；独立「冒口设计」计算器与向导暴露 0.8 / 1.0 / 1.2 / 1.5 | `calcManifest.js:280`；`riserView.js:93-98,169`；`wizard.js:384-389,410` | `cyl/square`：`H = round(D×hd)`；`sphere_head`：同样但强制 `H ≥ D/2`（hd < 0.5 会被夹到 0.5）；`sphere`：**H ≡ D，H/D 恒为 1**，与输入无关 |
| **D / Mc（冒口直径与热结特征尺寸之比）** | **未作为独立字段显示**；由目标模数隐式决定：hd=1 时 `M = D/6`，`Mr_target = 1.2 Mc` ⇒ `D = 7.2 Mc`（取整/升档后可能 +1 mm） | `riser.js:64,75,83,91`；`calcs/riser.js` Mr_target 段 | 四形状在 hd=1 下相同；球形/方形用各自的等效尺寸 D |
| **冒口颈 / 直径（`d_neck/D`）** | 未显示；由 `M_neck = Mc × neck_k`、`d_neck = 4 × M_neck` 推出 | `riser.js:292-294`；材料 `neck_k`：灰铁 0.75 / 球铁 1.0 / 铸钢 1.1 / 铝 1.0 / 铜 1.0 | hd=1 时 `d_neck/D = neck_k / 1.8` ≈ 0.417 / 0.556 / 0.611 |
| **球顶半径 / 直径（R/D）** | 球顶圆柱固定 `R = D/2`（R/D = 0.5） | `RISER_SHAPES.sphere_head.label` / `V` | 仅 `sphere_head` 有独立 R |
| 其它 | `Mr/Mc = 1.2`（`MODULUS_TARGET_RATIO`）；方形长宽比 1:1 | `riser.js` | 设计规则常量，不是几何比例 |

**用户说的"冒口和直径的比"目前含义不唯一**，可能是：
1. 冒口高度 / 直径（H/D）——最可能；
2. 冒口直径 / 热结特征尺寸（D/Mc 或 D/热结厚度）；
3. 冒口颈 / 冒口直径（d_neck/D）。

**建议**：先确认是 1；若是，设计中心可直接复用独立计算器已有的 0.8/1.0/1.2/1.5 档位（不新增工程参数、不改默认值，默认仍 1.0）。但**本次不实施**：加 H/D 会让尺寸随 H/D 变化，属于产品/工程口径决策，需用户批准。

---

## 9. 推荐的最小实施顺序

1. **先修"看起来没变化"的显示层（不动计算）**
   - ③ B 改形状后，立即更新「当前形状公式 / 补缩效率」帮助（就地更新 `shapeNoteHtml` 节点，或给该容器加 `data-shape-note` 后替换 innerHTML；**不要整面板重渲染**，避免丢焦点）；
   - 把结果页 `shapeDiffNote` 移出折叠区，或在核心卡旁常驻一句"换形状不改变 D/H，只改变 Vr / 可补缩量"；
   - 在面板形状下拉旁明确"保存并重新分析后结果才更新"。
2. **确定字段归属并做最小搬动**
   - `geometry.unit` → 模型信息；
   - `process.riserHeight` → C 浇注系统顶部，按 §3.2 的"只读关联 + 显式手动覆盖"呈现；
   - 热结选择移到 ③ B 顶部（`hotspotPickHtml()` 顺序调整）；
   - 评估面板加宽（方案 A）。
3. **需要用户拍板的工程/产品决策**
   - 是否在设计中心暴露 H/D；
   - 两处热结勾选是否统一语义；
   - RH 的覆盖/清除语义；
   - 结果页内联控件是否改为"去改参数"链接。
4. **R6-S3**：结果页「去改这个参数」入口（`openParamAt`）、过期/失效端到端断言、失败恢复路径、STL→结果→改参数→重分析→结果更新的完整闭环。
5. **R6-S4**：统一验收、截图、i18n、指纹、真实退出码、报告。

---

## 10. 涉及文件与关键代码位置

| 文件 | 关键位置 | 作用 |
|---|---|---|
| `js/views/designCenter.js` | `:661-662` 形状字段；`:835-836` 选项；`:937-957` 统一草稿处理器；`:855` / `:1149-1155` 形状帮助；`:1239-1278` 热结区；`:1294-1353` 保存；`:1359-1368` 过期标记；`:2381-2391` 自动重算；`:2459+` 执行分析；`:2511-2518` RH 回写；`:2565+` 结果渲染；`:2304-2321` 左栏热结勾选 |
| `calcs/calcManifest.js` | `:277-281` 形状 / `hd_ratio=1.0`；`:149-151` gating 的 `rh` | 计算入口 |
| `calcs/riser.js`（冻结） | `:58-93` 形状表；`:147+` runRiser；`:292-294` 冒口颈；`:309-326` 输出 | 冒口计算 |
| `calcs/gating.js` | `:107-111` `calc_Hp`；`:155` `rh`；`:174-180` `Cmm/Hp`；`:367-369` 输出 | RH 的下游用途 |
| `js/views/resultsCenter.js` | `:82-101` 尺寸映射；`:117-167` 冒口结果卡；`:126` shapeDiffNote（在折叠区内）；`:197-208` 内联形状下拉；`:660-668` 内联参数写入；`:337-341` gating 的 rh 展示 |
| `js/views/processPage1.js` | `:149` 最大热节 Mc | 工艺性页只展示 Mc，不展示冒口 D/H |
| `js/model/CastingProject.js` | `:86` `riserHeight` 默认；`:203-240` `set` / `orig`；`:242-245` `setResult`；`:399-425` 换 STL 清理 | 数据模型 |
| `css/app.css` | `:1045` 面板 360px；`:1465-1476` 移动端全宽 | 布局 |
| `js/views/riserView.js` | `:18` 默认 `sphere_head` / hd=1；`:93-98` H/D 选项；`:247` H/D 显示 | 独立计算器（不 import 设计中心） |
| `js/views/wizard.js` | `:384-389` H/D 选项；`:410,437` 传参 | 向导 |
| `docs/PHASE_V2.0-P1-R6_S2_CHECKPOINT.md` | §8 S3 清单 | 下一阶段依据 |

---

## 11. 测试 / 验证执行情况及真实退出码

| 验证 | 方式 | 结果 | exit |
|---|---|---|---|
| 形状切换全链路 | 真实浏览器 CDP（Edge headless，`cube50.stl`，面板 ③ B 与结果页内联两条路径） | 四形状全部正确保存、计算、重算、显示；矩阵见 §2.2 | **0** |
| 形状帮助陈旧 + 布局 | 真实浏览器 CDP（同模型；读面板 DOM 与 `getBoundingClientRect`） | 选中 `sphere` 后帮助仍为圆柱形公式 / 14% ⇒ **确认显示缺陷**；面板 360px、1410 视口下三维 790px | **0** |
| `set` / `setResult` / `restoreAutoValue` | Node 直接 import `CastingProject.js`（只读，不写文件） | `CALC_RESULT` 覆盖后 `orig` 为空，`restoreAutoValue('process.riserHeight')` 返回 **false** | **0** |
| 冻结指纹 | `sha256sum` 10 个文件 | 10/10 与 S2 基线逐位一致 | 0 |
| 全量 Node / 浏览器回归 | **未执行** | 按 §二.5 不重复昂贵测试；S2 已记录的结果仍然有效 | — |

> 两次浏览器探针脚本写在系统临时目录（项目外），运行后已删除；项目内未新增任何脚本、测试或资源文件。

---

## 12. 当前工作区状态

- 分支 `main`，HEAD `da1c822`，**未提交 / 未推送 / 未发布**。
- 本报告落盘前工作区 110 项；本报告落盘后 **111 项**（唯一新增 = 本文件）。
- 已跟踪修改仍为 S0~S2 的既有工作（36 项），**本次没有修改任何一个已跟踪文件**。
- 未执行 `git reset / checkout / clean / stash`；未覆盖或删除任何既有工作。
- 10 个冻结指纹逐位未变。

---

## 13. 尚未确认的问题（需用户决定）

1. **实际观察路径**：是在 ③ 面板改完形状后**没点保存**就去看结果，还是在结果页内联下拉直接切？两者反馈不同；两条路径本身都已验证正常。
2. **是否期望"换形状改变尺寸"**：当前 hd=1 下 D/H 必然相同。如果期望尺寸随形状变化，需要引入 H/D 或改变设计口径（工程决策，不能由 UI 擅自改）。
3. **是否在设计中心暴露 H/D**（复用独立计算器的 0.8/1.0/1.2/1.5 档位），默认仍 1.0？
4. **两处热结勾选是否统一为草稿语义**（左栏当前立即生效；③ 是草稿）。
5. **RH 的呈现方式**：只读关联 + 显式手动覆盖（本报告推荐），还是继续普通可编辑输入？
6. **RH 换 STL 的清理语义**：当前 UI 写 `USER_OVERRIDE`，换 STL 会被清掉；代码注释说用户手填应保留 —— 以哪个为准？
7. **结果页内联控件**：保留现状（立即写）还是逐步改为「去改这个参数」链接（统一走面板草稿）？
8. **"冒口和直径的比"的确切含义**：H/D、D/Mc，还是 d_neck/D？
9. **面板加宽的断点与宽度**（建议 ≥1440 px 时 360 → 520–560 px，是否接受）。
