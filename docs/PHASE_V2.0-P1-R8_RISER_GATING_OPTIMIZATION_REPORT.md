# PHASE V2.0-P1-R8 · 冒口设计与浇注系统优化

> 命令：`D:\CDXProject\新建 文本文档 (163).txt`；补充修正：`D:\CDXProject\新建 文本文档 (164).txt`
> 日期：2026-10-26 ｜ 分支 `main` ｜ HEAD `da1c822`
> 状态：**已完成（含 164 R8-FIX）；未提交、未推送、未发布；等待人工审查。**

---

## R8-FIX（164.txt）补充结论

164 是对 R8 的**正式接入修正**，不是重做 R8，也不是 R9：

- **发热/保温冒口从“参考卡”改为现有形状选择器中的正式选项**：选中后主结果整体切换为换算几何；沿用当前圆柱 `H/D`；`V1 = 0.4 × V0`；普通圆柱只作为基准 `V0` 出现在明细，不再并列展示第二套尺寸。
- **三种梯形从“参考卡”改为现有横浇道截面选项**：矩形 + 标准/扁/高梯形在同一选择器；梯形提供数量（默认 1）；`A_run` 是全部横浇道目标总面积，按 `A_each = A_run / n` 均分；矩形流程保留。
- **共享实现**：`js/views/riserReference.js` 提供体积换算与主结果转换；`js/views/gatingReference.js` 提供梯形几何、数量分配、面积重算与主结果转换。独立计算器与工艺设计中心共用同一函数。
- **边界明确**：梯形几何和面积判定是正式结果；没有建立梯形流动仿真，不宣称矩形流动校核与梯形等价。发热/保温不套用普通目标模数判定或补缩效率表，需工艺验证。
- **核心冻结未破**：`calcs/riser.js`、`calcs/riserDreq.js`、`calcs/calcManifest.js`、`js/engine/**` 未修改。

---

## 0. 完成范围

| 需求 | 状态 | 结果 |
|---|---|---|
| 冒口颈改为模数/尺寸范围 | **完成** | `M_N = M_F/3 ~ 2M_F/3`；圆/方/矩形；矩形 `a > 2M_N,max`；建议尺寸只向上取整并复核 |
| 移除旧冒口颈用户可见结果 | **完成** | 结果页、独立计算器、导出报告、向导报告均不再显示旧 `d_neck/M_neck`；核心返回值保留内部使用 |
| 补缩距离参考 | **完成** | 板状 `2s` / 杆状 `1.2s`；`s = process.wallUsed`；无值明确不可计算 |
| 发热/保温冒口选项 | **完成（164 正式选项）** | 选中后主结果切换为换算几何；`V1 = 0.4 V0`；沿用当前 `H/D`；普通目标模数/补缩效率不冒充新方案 |
| 结果展示统一/精简 | **完成（共享主结果转换）** | 两入口共用换算/截面模块；核心结果对象不改，视图层按选择类型生成当前主结果（见 §4、§5、§14） |
| 冒口顶部防封顶/压力锥提示 | **完成** | 两入口结果底部各一处，普通说明文字 |
| 三种梯形横浇道 | **完成（164 正式截面）** | 矩形 + 标准/扁/高梯形同一选择器；数量默认 1；`A_run/n` 均分；开放式默认扁、封闭式默认高；矩形流程保留 |
| 内浇口数量口径 | **完成** | 核实为整模总数；两页面统一名称与说明 |
| 中英文/桌面/移动端/明暗 | **完成** | 新词条齐全；S5/UI **76/0**；responsive / S3 主题 / S31 通过 |

---

## 1. 修改文件

| 文件 | 修改 |
|---|---|
| `js/views/riserReference.js` | 颈范围；发热/保温 `0.4V0`、沿用 `H/D`、整数回算；`applyInsulatedRiserResult` 主结果转换；顶部提示；两入口共用 |
| `js/views/gatingReference.js` | **新增/扩展**：矩形+三梯形、数量分配、面积回算、阻流面积重算、`applyRunnerSection` 主结果转换、默认匹配 |
| `js/model/CastingProject.js` | 新增 `process.runnerSection`（`''`=自动）与 `production.trapezoidN`（默认 1） |
| `js/views/resultsCenter.js` | 发热/保温主结果；正式截面选择器/数量；旧参考卡移除；梯形明细；内浇口总数口径；顶部提示 |
| `js/views/riserView.js` | 旧颈展示/旧颈报告移除；固定补缩效率；发热/保温正式主结果；沿用 H/D；报告同步 |
| `js/views/gatingView.js` | 四种截面正式选择器；数量；梯形主结果/面积校核；自动匹配与手动保留；报告同步；矩形保留 |
| `js/views/designCenter.js` | 形状选择器含发热/保温且保留 H/D；分析链按类型转换 riser/gating 主结果后写回；无冻结文件改动 |
| `js/views/reportGenerator.js` | 发热/保温与梯形报告分支；旧冒口颈行移除 |
| `js/views/wizard.js` | 向导报告移除旧冒口颈行 |
| `css/app.css` | 参考卡/梯形/截面选择器布局、移动端换行 |
| `js/i18n/en-US.js` | R8 + R8-FIX 英文词条 |
| `tests/phases6_riser_reference_test.mjs` | 颈范围、发热/保温换算与主结果、共用模块（8 项） |
| `tests/phases6_gating_reference_test.mjs` | 梯形几何/数量/默认/主结果转换/内浇口口径（7 项） |
| `tests/phases5_hd_test.mjs` | 只有球形隐藏 H/D；发热/保温沿用 H/D（6 项） |
| `tests/phase79_test.mjs` | 矩形显式选择后验证原有功能 |
| `scripts/browser_s5_test.mjs` | 发热/保温主结果、H/D、四种截面、数量、默认匹配、报告、中英文/移动端（76 项） |
| `scripts/browser_p78_test.mjs` / `browser_test.mjs` | 截面默认变化后的矩形显式选择、旧颈移除断言更新 |

未修改：`js/engine/**`、`calcs/riser.js`、`calcs/riserDreq.js`、`calcs/calcManifest.js`。

---

## 2. 冒口颈计算链

### 2.1 数据来源

- `M_F = 当前冒口的实际模数 Mr_act`（`runRiser` 返回值）；**不是** `Mc`、不是 `D`。
- 已核查：`Mr_act` 是当前冒口几何的 V/A 模数；`Mc` 是铸件热节模数；两者不能混用。
- 无效/缺失 `M_F` → “无法计算”，不生成默认值。

### 2.2 公式

```
M_N,min = M_F / 3
M_N,max = 2 M_F / 3

圆形：  M_N = D/4      → D 参考范围 [4 M_N,min, 4 M_N,max]
正方形：M_N = a/4      → a 参考范围 [4 M_N,min, 4 M_N,max]
长方形：M_N = ab/[2(a+b)]
        b = 2a M_N/(a − 2M_N) → b 参考范围按 M_N,min / M_N,max 两次计算
        必须 a > 2 M_N,max
```

### 2.3 取整与边界

- 内部全精度；显示 2 位小数；
- 建议尺寸用 `Math.ceil` 到整数 mm，并重新代入模数式计算 `actualMin/actualMax`：
  - 圆/方：`actualMin = dMin/4`、`actualMax = dMax/4`；
  - 长方形：`actualMin/actualMax = a·b/[2(a+b)]`（分别用推荐 b 下限/上限）；
- `verified` 仅在**上下限实际模数都满足** `M_N,min ≤ M_N,actual ≤ M_N,max` 时为 true；
  上限因整数向上取整通常略高于 `M_N,max`，此时 `verified=false`，界面明确提示“上限取整后超出 M_N,max”，不把取整结果宣称为范围内；
- 长方形校验：`a` 必须有效正数；`a ≤ 2M_N,max` 时明确提示“输入不适用”；分母不会为零；不输出 `Infinity/NaN`；
- 不自动修改用户输入；不把范围宣称为已验证最佳尺寸。

### 2.4 旧结果

- 旧 `d_neck/M_neck/neck_k` 仍由冻结核心返回，但**不再显示**；
- 独立计算器导出报告、设计中心导出报告、向导报告均已移除旧冒口颈行；
- 新参考卡是唯一用户可见的冒口颈结果。

---

## 3. 补缩距离与壁厚数据流

- `s = process.wallUsed`：设计中心导入 STL 后由 V3 `bodyRefOf` 链路回写的主体验证壁厚；不是 `wallMax`，不是 `wallAvg` 的替代猜测。
- 结果卡每次重建都读取当前 `process.wallUsed`，不缓存上一个模型的值；
- 更换/删除 STL 走 `CastingProject.clearStlBoundData()`，其中清理 `process.wallUsed`（已有回归 `phase16b/phase284` 覆盖）；清除后卡片显示“无法计算：未获得有效主体壁厚”。
- `s` 缺失/0/负/NaN → 不计算；不用 0 或默认值代替。
- 结果：板状 `2s`、杆状 `1.2s` 同时展示，分别标注，不合并为安全区间。

---

## 4. 发热/保温冒口（164 正式选项）

### 4.1 交互与主结果

- 发热/保温继续使用现有形状选择器（设计中心 `process.riserShape`、独立计算器 `#r_shape`），**不新增第二套选择区域**；
- 选中后，主结果区整体切换为发热/保温方案：名称、`D/H`、目标体积、实际几何体积、几何模数、重量均属于新几何；不再并列展示普通圆柱主尺寸；
- 普通圆柱基准 `V0` 只在折叠明细中出现；
- 普通目标模数判定、补缩效率表不适用于本模式，界面明确标注“几何模数（参考）/不作普通目标模数判定”；
- 普通圆柱模式原有结果路径不变。

### 4.2 V0 的数据来源

- `V0 = runRiser` 返回的普通圆柱**几何体积 `Vr`**（mm³）；
- **不是** `effV = Vr × 补缩效率`，也不是其它已修正体积；
- `V1 = 0.4 × V0`；本功能不再乘 `RISER_EFF` 或任何其它体积系数，避免重复应用；
- 40% 是本产品采用的**经验估算系数**，不是普遍工程标准。

### 4.3 沿用 H/D 与尺寸反算

- 读取当前圆柱 H/D（`process.hdRatio` / `#r_hd`）；切换到发热/保温时原值保留，不再固定为 1；
- H/D 缺失/非法时回退到核心结果已采用的名义值，再缺失才用现有合法默认 `1.0`；不静默用 0；
- 名义 `k = H/D`；`V1 = πD²H/4`、`H = kD` ⇒ `D = ∛(4V1/(πk))`；
- 取整与现有冒口一致：`D` 为整数 mm，`H = round(kD)`；若该尺寸回算体积小于 `V1`，逐毫米上探 `D`，再下探到满足 `V1` 的最小整数档；
- 显示尺寸与回算体积使用同一组整数 `D/H`；同时显示目标体积 `V1` 与尺寸取整后的实际几何体积 `Vactual`；
- 不使用“普通 D/H × 0.4”。有效性分两层：纯换算函数 `calcInsulatedRiser` 对无效 `V0`/H/D 返回明确失败；入口适配器先按“核心名义值 → 1.0”归一化 H/D（回退值实际参与反算），`V0` 无效时才明确无法计算；不会产生 NaN/Infinity/零尺寸。

### 4.4 主结果与校核口径

- `applyInsulatedRiserResult()`（`riserReference.js`）在视图层替换主结果：`D/H/Vr/Mr_act/weightKg/yieldPct` 来自新几何；
- 新几何的几何模数按圆柱 `M = D×H/(2D+4H)` 计算，仅作参考；`Mr_target=null`、`modOk=null`、`eff=null`、`effV=null`，不冒充普通冒口验证；
- 发热/保温冒口颈参考使用新几何的 `Mr_act`；补缩距离仍取当前 `process.wallUsed`；
- 独立计算器报告、设计中心导出报告均只印发热/保温主结果，并说明经验性质与限制。

### 4.5 两个入口与状态

- 独立计算器先调用冻结 `runRiser`（以圆柱为基准）取得 `V0`，再调用共享转换；
- 设计中心在 `runAnalysis` 内取得原始结果后，用同一转换函数替换后再写回 `risers.items` / `state.results`，因此下游 `yield` 重量、结果页、报告使用同一套新几何；
- 切换形状保留 `H/D`；保存/恢复/项目切换使用 `CastingProject` 的同一字段；核心 `riser.js` 与 `calcManifest.js` 不改。

---

## 5. 横浇道四种截面（164 正式接入）

### 5.1 选择器与矩形保留

- 同一选择器包含：矩形、标准梯形、扁梯形、高梯形；
- 选择矩形时完全走原有矩形计算/输入/结果（厚度、条数、长度 5mm 档），原功能保留；
- 选择梯形时主结果只显示梯形几何与数量；不再把矩形尺寸作为当前主结果，也不显示第二套参考卡。

### 5.2 梯形几何（上底 a，下底 2a）

| 方案 | 高度 | 面积 | a |
|---|---:|---:|---:|
| 标准梯形 | 2a | 3a² | √(A/3) |
| 扁梯形 | a | 1.5a² | √(2A/3) |
| 高梯形 | 4a | 6a² | √(A/6) |

- `A` 为**单条目标面积**；
- `a` 向上取整到 0.01 mm；上底、下底、高、面积校核均使用同一组显示尺寸；
- 无有效目标面积/数量 → 明确失败，不输出 NaN/Infinity。

### 5.3 A_run 口径与数量

- 已核查 `calcs/gating.js`：`L_r = ceil(A_run/(rc×rt)/5)×5`、`Fr_act = rt×L_r×rc` ⇒ **`A_run` 是全部横浇道的目标总面积**，不是单条面积；
- 梯形：`A_each = A_run / n`，由 `A_each` 反算单条尺寸，`实际总面积 = n × 单条实际面积`；
- 数量默认 1，必须为正整数；数量变化即时/重算；切换梯形方案、矩形↔梯形不无故重置各自数量；
- 不重复除：`calcTrapezoidRunner` 只除一次数量，面积校核使用最终显示尺寸。

### 5.4 自动匹配与用户选择

- 使用真实浇注状态 `rd.type`：开放→扁、封闭→高、自定义/其它→标准；
- 设计中心 `process.runnerSection=''` 表示自动；用户手动选择后保存具体键，结果重建不再覆盖；「恢复自动匹配」清空该字段；
- 独立计算器未手动选择时按当前类型自动匹配；手动选择后置 `sectionTouched`，普通输入变化不覆盖；「↺」恢复自动；
- 不根据页面文字猜测类型。

### 5.5 结果与流动校核边界

- 梯形主结果展示上底/下底/高/数量、实际与目标面积、面积回算校核；
- 阻流位置/实际面积比按**最终实际总截面积**重算，沿用现有 P51 面积判定规则；
- **未建立梯形流动仿真**：不能把矩形流动校核视为梯形的等价验证；界面和报告均明确此边界；
- 核心 `runGating` 的浇注时间、浇注重量、内浇口/直浇道尺寸、流速与排气判定保持原逻辑。

---

## 6. 内浇口数量口径

### 6.1 核实结果

- 核心 `gating.js`：`Fg = gt × L_g × gc`；`A_gt` 按整模浇注重量给出；
- 没有 `gc × cav` 的写法；
- 因此 `gc` 是**整模全部铸件的内浇口总数**，不是单件数量。

### 6.2 显示

两页面统一：

- 名称：`内浇口总数（整模，全部铸件合计）`；
- 说明：`内浇口总数为整套浇注系统中所有铸件的内浇口数量合计。`
- 未做未经验证的单件/整模换算。

---

## 7. 两个入口的共享方式

| 功能 | 共用模块 |
|---|---|
| 颈范围 / 补缩距离 / 发热保温换算与主结果转换 | `js/views/riserReference.js` |
| 矩形/梯形截面、数量分配、面积校核与主结果转换 | `js/views/gatingReference.js` |

- 公式、取整、边界、默认匹配、`A_run/n` 分配、主结果转换只在共用模块内实现；
- 两个入口只负责传入 `Mr_act`、`process.wallUsed`、`A_run`、`rd.type`、H/D、数量和渲染；
- 设计中心的转换发生在 `runAnalysis` 内（`applyInsulatedRiserResult` / `applyRunnerSection`），因此写回项目、下游 yield、结果页与报告拿到的是同一套主结果；
- 独立计算器直接调用同一函数；没有复制第二套公式，也没有为复用做大重构。

---

## 8. 界面 / 国际化

- 两卡/梯形卡沿用现有颜色、边框、圆角、字体和 `auto-fit` 布局；桌面并排、移动端堆叠；
- 所有新增文案走现有 `tr()` i18n；`browser_i18n_audit` 0 遗漏；
- 浅色/深色主题使用现有 CSS 变量；S3 主题回归通过；
- 未引入 CDN 或新运行时依赖；
- 未删除现有功能或覆盖用户草稿/保存/切换逻辑。

---

## 9. 测试结果

> 时间控制：先清点契约 → 集中修改 → 专项 → 集成/浏览器 → 最后跑一次全量 Node；
> 未为追求数量反复运行全量。

### 9.1 专项 / 集成 / 浏览器（最终代码）

| 命令 | 结果 | 退出码 |
|---|---|---:|
| `node tests/runner.mjs phases6_riser` | **8/0** | 0 |
| `node tests/runner.mjs phases6_gating` | **7/0** | 0 |
| `node tests/runner.mjs phases5_hd` | **6/0** | 0 |
| `node tests/runner.mjs phase79` | **5/0** | 0 |
| `node scripts/browser_s5_test.mjs`（R8-FIX UI） | **76/0** | 0 |
| `browser_i18n_audit.mjs` | 0 遗漏 | 0 |
| `browser_responsive_test.mjs` | 全部通过 | 0 |
| `browser_s3_test.mjs`（含明暗主题） | 全部通过 | 0 |
| `browser_s31_test.mjs`（结果/报告一致性） | 全部通过 | 0 |
| `browser_p78_test.mjs` | 全部通过 | 0 |
| `browser_test.mjs`（通用） | 全部通过 | 0 |

> 165.txt 最终验收审计（§15）随后加强了冒口颈上下限断言，最新专项为 `phases6_riser` **9/0**、
> S5 **78/0**；全量 Node **917/1** 是本次审计前的历史全量记录，未因 A2 视图层修复重跑。

### 9.2 最终全量 Node

| 项目 | 结果 | 退出码 |
|---|---|---:|
| `node tests/runner.mjs`（一次全量） | **917 通过 / 1 失败** | **1** |

> 全量耗时约 **20 分 19 秒**（12:30:59 → 12:51:18），90 个测试文件，完整结束。
> 唯一失败：`phase24 T5`（历史失败：ALHR4510 热结数 5→2），与本次改动无关。
>
> 透明说明：全量启动后、结束前，最终代码又完成了两项小改动——`riserReference` 中
> “H/D 非法时回退到核心名义值/1.0”的视图转换，以及结果页下拉宽度类名/CSS；
> **冻结核心文件与计算路径未动**。随后在最终代码上重跑了相关专项（`phases6_riser` 8/0 等）、
> S5/R8-FIX 76/0、S31 与响应式。全量日志：`_r8fix_node_full.log`。

### 9.3 历史失败 / 未运行

- 历史：`phase24 T5`（ALHR4510 热结数 5→2）；inspection ⑩⑥、stl_p22 marker、browser_v2015 旧脚本失效。
- 本阶段未运行（按影响面选择，未声称通过）：`browser_inspection`、`browser_stl_p22`、`browser_v2015`、`browser_s1`、`browser_s22`。
- `scripts/design_center_test.mjs`：本次尝试运行 300s 未完成、无输出（脚本/环境未给出可用结果）；不写入“通过”，以 S5/S31/响应式/P78/通用浏览器覆盖设计中心主链路。

---

## 10. 未完成 / 限制 / 风险

1. **结果展示未做完整组件化统一**：两入口共用主结果转换模块，但核心结果仍由各自视图渲染；没有重写核心计算。属于最小实现，不宣称“所有结果组件已统一”。
2. **梯形是正式几何选项，但未建立梯形流动模型**：梯形尺寸、数量和面积校核是真实主结果；阻流位置/面积比只按实际总截面积重算。**不得**把现有矩形流动校核解释为梯形等价验证；未来若做梯形流动仿真需独立立项。
3. **发热/保温是正式选择但仍是经验估算**：核心仅提供普通圆柱 `V0`；40% 与整数回算是产品指定经验假设，不是普遍工程标准；不套用普通目标模数/补缩效率表，实际补缩效果需工艺验证。
4. **DISA 颈/补缩关系**：公开资料未能直接核对 `M_N=M_F/3~2M_F/3` 与 `2s/1.2s` 原文；按产品指定关系实现，标注经验参考，不扩大适用条件。
5. **实际生产验证缺失**：需要模拟/生产数据；不把模数参考或发热/保温估算当作补缩能力已验证。
6. **旧内部字段保留**：`d_neck/M_neck` 仍在冻结核心返回值中，但不再显示；发热/保温转换结果将其置空，避免误用。
7. **设计中心未改 `calcManifest`**：冻结文件仍按普通圆柱/矩形产出原始对象，再由视图层转换；因此外部直接调用 `CALC_MANIFEST` 的代码仍拿到核心原始口径，只有设计中心流程和两个计算器入口应用主结果转换。

---

## 11. 冻结文件审计

| 文件 | 指纹 | 状态 |
|---|---|---|
| `calcs/riser.js` | `5cfcfef3` | 未变 |
| `calcs/riserDreq.js` | `efdc2301` | 未变 |
| `calcs/calcManifest.js` | `3bfc3e16` | 未变 |
| `js/engine/**` 7 项 | 与交接书一致 | 未变 |

- 未修改核心公式、默认值、判定标准、热点识别或尺寸路径。
- 未执行 `git reset/checkout/clean/stash`；未提交、推送、发布。

---

## 12. 最终工作区 / 记忆

- 工作区状态：**148 项**（43 M + 105 ??；新增/修改全部未提交）。未被 Git 跟踪的 `*.log`、`screenshots/` 不计入。
- 记忆更新：项目 `CLAUDE.md` 的当前状态已更新为 R8-FIX / 148 项；沿用测试分层/时间控制规则；
  更新 Auto Memory 的 `project-methodology.md`、`casting-toolbox-current-state.md`、`MEMORY.md`。
- 本阶段细节保存在本报告与代码中；未新增大量记忆文件。

---

## 13. 结果数据一致性审计（164 补充）

### 13.1 发热/保温

- 主结果中的 `D/H` 来自 `V1=0.4V0` 与当前 H/D 的整数反算；`Vr = Vactual = πD²H/4`，与显示尺寸一致；
- `V0` 只在明细中作为基准；目标体积 `V1` 与实际几何体积分开显示；实际体积 `< V1` 时明确提示；
- `weightKg` 由实际几何体积 × 密度计算；`yieldPct`（有铸件重量时）使用新 `Vr`；
- `eff/effV/needVol/Mr_target/Mr_need/modOk` 均为 `null`，不把普通圆柱模数/效率/校核状态冒充为新方案结果；
- 几何模数由新 `D×H` 重算，标注“参考”；冒口颈参考使用该几何模数；
- 两入口使用同一 `applyInsulatedRiserResult`；设计中心在写回项目/下游 yield 前转换，独立计算器在渲染前转换。

### 13.2 梯形

- `A_run` 确认是全部横浇道目标总面积（核心 `Fr_act = rt × L_r × rc`）；
- `A_each = A_run / n`，只除一次；尺寸由单条目标面积反算，`a` 向上取整到 0.01 mm；
- 主结果 `Fr_act` 替换为 `n × 单条实际面积`；矩形 `rt/L_r` 被置空；矩形路径显式选择时完全保留；
- `rrv`、`chokePosition`、`chokeArea`、`systemType`、`ingateChoke/boundaryChoke` 按最终实际总截面积重算（P51 同面积规则）；
- 梯形面积回算、结果页/报告/明细使用同一组显示尺寸；数量变化后单条尺寸与总实际面积同步更新；
- 明确声明未做梯形流动仿真；不把矩形流动校核描述为已验证的梯形校核。

### 13.3 一致性测试

- Node：R8-FB1/FB2（发热/保温体积、H/D、主结果、不重复效率、不冒充模数）；R8-T1/T1b/T6（梯形面积/数量/主结果转换）；两个入口共享函数源码断言；
- 浏览器：S5/R8-FIX 76 项，覆盖主结果切换、H/D 保留、四种截面、数量、自动/手动匹配、报告同步、英文/移动端；
- 历史失败与未运行测试见 §9。

---

## 15. R8-FIX 最终验收审计

> 命令：`D:\CDXProject\新建 文本文档 (165).txt`。审计开始时：`main` / `da1c822`，
> 工作区 **148 项**（43 modified + 105 untracked）；结束时同。未修改冻结文件。

### 15.1 A1 发热/保温 H/D 异常回退

**结论：代码实现正确；报告原表述与代码不一致，已改文档；未改生产逻辑。**

代码证据：

- `js/views/riserReference.js:122-126`：有效 H/D 用当前值；否则用核心结果 `it.hd`；再否则用现有合法默认 `1.0`。归一化后的 `k` 随即传入 `calcInsulatedRiser` 并用于 `D/H` 反算（`:126`、`:71-87`），不是只显示在界面。
- `js/views/riserView.js:157-174`：独立计算器从 `#r_hd` 读取，空/0 回退 `1.0`；切换形状保留选择值；`applyShapeUi` 只对球形隐藏 H/D。
- `js/views/designCenter.js:2814-2816`：设计中心把 `process.hdRatio` 传入同一转换。
- `js/model/CastingProject.js`：`process.hdRatio` 默认 `1.0`，保存/恢复/切换项目走同一字段，没有重置旁路。
- `calcInsulatedRiser` 对无效 `V0` 返回 `no_volume`（`:68-70`）；适配器返回 `D/H/Vr=null` 和 `insulatedError`（`:127-134`），不会产生 NaN/Infinity/零尺寸。
- `tests/phases6_riser_reference_test.mjs` R8-FB1/FB2：有效 H/D、无效 H/D 回退核心值、核心值也无效回退 1.0、无效 V0 不可用；`phases5_hd` 与 S5 覆盖切换/保留/不同 H/D 的尺寸差异。

**问题**：报告 §4.3 原文写“缺有效 V0 或 H/D 时明确无法计算”，与“适配器把无效 H/D 回退到核心名义值/1.0”的代码不一致（已更正为本节的两种层次）。没有发现数据错误。

### 15.2 A2 冒口颈范围、取整与边界

**结论：发现实际展示/校核缺陷，已最小修复。**

问题：`calcNeckReference` 原来只验证“向上取整后的下限 ≥ M_N,min、上限 ≥ M_N,max”，并把 `verified` 仅按这两个下限条件置 true；界面没有回算并展示**上限建议尺寸的实际 M_N**。当上限因整数向上取整超过 `M_N,max` 时，界面仍可能被读成“范围内”。这违反了“不能只检查下限”的要求。

最小修复（`js/views/riserReference.js`）：

- 圆/方：新增 `actualMin = recommendedMin/4`、`actualMax = recommendedMax/4`；
  长方形：用 `a·b/[2(a+b)]` 对最终推荐 b 回算；
- 新增 `minWithin`、`maxWithin`、`exceedsUpper`、`belowLower`；`verified` 改为**上下限实际值都在** `[M_N,min, M_N,max]` 时为 true；
- 界面显示“回算实际 M_N：下限尺寸 / 上限尺寸”，并在上限取整超出时明确提示“上限取整后超出 M_N,max”（`:198-212`）；
- 不改变“建议尺寸向上取整”规则，不自动修改用户输入。

测试证据：`phases6_riser` **9/0**，覆盖正常圆/方、整数上下限（verified=true）、上限取整超出（verified=false）、长方形、缺失/NaN/Infinity、`a≤2M_N,max`。S5 浏览器新增颈卡上限提示检查，**78/0**。

### 15.3 A3 发热/保温几何模数口径

**结论：实现口径与冻结核心一致；未修改生产代码。**

代码证据：

- `calcs/riser.js:59-64`：圆柱 `V = πD²H/4`，`M = D×H/(2D+4H)`；`Mr_act = sd.M(D,H)`（`:253`），即体积/总散热面积，包含上下两端；
- `applyInsulatedRiserResult` 生成的仍是圆柱几何，`calcInsulatedRiser` 用同一 `MrGeom = D×H/(2D+4H)`（`js/views/riserReference.js:103`），并以 `Mr_act` 输出（`:147`）；
- 实测：核心圆柱 Mc=12、H/D=1.2 → `D=82,H=98,Mr_act=14.453237410071942`；转换为 `D=61,H=73`，`Mr_act=10.756038647342995`，与 `RISER_SHAPES.cyl.M(D,H)` **逐位相等**。
- 未把新几何模数冒充普通目标的通过结果：转换结果 `Mr_target/Mr_need/modOk/eff/effV` 均为空，界面标“几何模数（参考）”。

边界：该值只回答“新几何的模数”，不等同于实际补缩能力；普通目标模数/效率表仍不适用。

### 15.4 A4 梯形下游结果数据流

**结论：下游主结果已使用梯形实际几何；不存在仍把矩形尺寸当梯形主结果的已确认路径；未修改生产代码。**

代码证据（`js/views/gatingReference.js:101-144`）：

- `A_run` 为目标总面积；`calcTrapezoidRunner({ area: g.A_run, count: n })` 单条目标 `A_run/n`；
- 转换后 `rc=n`、`rt=null`、`L_r=null`，`Fr_act=actualTotal`；
- `rrv/rgv` 用 `Fr_act`/`Fs_act` 重算；
- `classifyChoke` 用 `Fs_act`、梯形 `actualTotal`、`Fg` 重算 `chokeArea/chokePosition/systemType/ingateChoke/boundaryChoke`（与 P51 同一面积判定）；
- `optChokeMigrated` 重算；按矩形数值生成的“横浇道不足”提示被过滤；
- 浇注时间 `t`、浇注重量 `G`、内浇口流速 `vFinal`、排气 `vr/sugVent` 不依赖横浇道截面，保持核心值，这是正确的，不是残留矩形几何；
- `cp` 是目标 S:R:G 比例的最小项，不是实际矩形几何，保留不变；
- 下游消费：`resultsCenter.runnerBox/gatingSection`、`reportGenerator` 的 `gatingFacts.areas[1]`、`gatingView` 的主结果/报告均读取 `runnerSection` 元数据；梯形时不会显示矩形厚度/长度；矩形显式选择时完全保留；
- 报告/界面均明确“未建立梯形流动仿真，不能视为矩形流动校核的等价验证”。

测试证据：`phases6_gating` **7/0**（含 R8-T6 主结果转换、数量/面积/阻流重算）；`phase79` **5/0**（矩形原有功能）；S5 **78/0**（四种截面、数量、矩形回切、报告）。未发现 A4 实际缺陷。

### 15.5 本次修改文件

仅审计范围内：

- `js/views/riserReference.js`：A2 增加上下限实际模数与范围状态；
- `tests/phases6_riser_reference_test.mjs`：修正并加强 A2/A1 边界断言；
- `scripts/browser_s5_test.mjs`：新增颈卡实际回算/上限提示检查；
- `js/i18n/en-US.js`：上述新界面词条；
- 本报告：A1 表述更正、§2.3 口径说明、本节审计记录。

未修改生产计算链、冻结文件或无关页面。

### 15.6 测试与未运行项

| 命令 | 结果 | 退出码 |
|---|---|---:|
| `node tests/runner.mjs phases6_riser` | **9/0** | 0 |
| `node tests/runner.mjs phases6_gating` | **7/0** | 0 |
| `node tests/runner.mjs phases5_hd` | **6/0** | 0 |
| `node tests/runner.mjs phase79` | **5/0** | 0 |
| `node scripts/browser_s5_test.mjs` | **78/0** | 0 |
| `node scripts/browser_i18n_audit.mjs` | 0 遗漏 | 0 |

- 未为 A2 的视图层修复重跑约 20 分钟全量 Node；§9 的 917/1 是全量历史记录，A2 修改后未重跑全量（按 165 §7.2，避免机械全量）。
- 未在本次审计重跑：`browser_s31`、`browser_responsive`、`browser_s3`、`browser_p78`、`browser_test`、`design_center_test`、`browser_inspection`、`browser_stl_p22`、`browser_v2015`、`browser_s1`、`browser_s22`。S5 的 390px 检查覆盖本次颈卡新增行。

### 15.7 最终状态与验收建议

- 工作区：**148 项**（43 modified + 105 untracked），与审计开始时一致；本次无非预期删除/覆盖。
- 冻结文件：`calcs/riser.js` `5cfcfef3`、`calcs/riserDreq.js` `efdc2301`、`calcs/calcManifest.js` `3bfc3e16`；未修改。
- 未提交、未推送、未发布；HEAD 仍 `da1c822`。
- 尚存边界：发热/保温 40% 仍是经验估算；梯形未建立流动模型；本次只修 A2 展示/校核，不改变产品推荐规则。
- **验收建议：建议人工验收**。四项关键问题已核实；A2 的展示/校核缺陷已最小修复并通过专项/浏览器；其余为已明确标注的模型边界。

---

## 16. 停止声明

本阶段完成即停止。**未提交、未推送、未发布。**
