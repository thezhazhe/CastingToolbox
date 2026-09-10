# PHASE 63 RESULT — 独立计算器产品安全补丁

> 日期：2026-09-04 ｜ 任务书：新建 文本文档 (64).txt ｜ 项目：CastingToolbox
> 范围：13 个独立计算器本身的输入安全 / 默认值语义 / 明确计算逻辑问题；**未触碰** STL 工艺设计中心 / Wizard / CastingProject·context / 跨模块传参 / 结果中心 / UI 统一重构 / 其他 P2/P3。

## 1. 修改项

| Issue | Status | Changed |
|---|---|---|
| P0-1 非法输入阻断 | **PASS** | 视图输入校验门禁 ×11 计算器（gating/riser/shrinkage/machining/yield/chill/sandbox/castability/CT/charge/shakeout；defect_finder/principles 无数值计算入口）；共享 `js/views/numcheck.js`（纯逻辑）；**危险的 "parseFloat(...)\|\|0" 计算链兜底已消除：非法输入不会再绕过校验进入正式计算**（残留 `\|\|0` 仅存于门禁之后的 read()/预览函数内，见 PHASE 63.1-B）；件数不再"空→1/0→1" |
| P1-1 CT 默认等级 | **PASS** | CT 等级默认"请选择"，未选不计算并给引导（图纸标注→直接选；未标→推荐+填入）；120mm+CT1 → ±0.075 数值未动 |
| P1-2 示例值语义 | **PASS** | 全计算器"示例"小标 + 结果区一次提示（改任意带标输入自动消失）；ALR2510 类真实件默认值不再伪装成系统识别值；零弹窗 |
| P1-5 Charge 吸收率 dead input | **PASS** | read() 三行合金吸收率改读输入框（默认值仍由 loadDefaults 依 CHARGE_MATERIALS/CHARGE_RET_ABS 写入，数据层未删）；A≠B 回归测试锁定；附带修复同链路"应用按钮"映射 |
| P1-6 Shrinkage 范围语义 | **PASS（数值零改）** | UI 语义分离：当前档位=工具工程参考值（计算用）；资料典型范围单列（参考、口径不同可能不重叠，互不替代）；档位锚点/区间数据一行未动（63-P1-6 锁定） |
| P1-7 Shrinkage 方向映射 | **PASS** | calcShrinkageDir 按原始下标输出 idx；空方向不再造成 X/Y/Z 错位；A~E 五组回归 |
| JB 64/48 | **VERIFIED（记录修正）** | 代码/测试实际 = **48 格**（3 表 × 2 模样材质 × 8 档）；62 报告"64"为计数笔误，已修正 PHASE62_FINAL_REPORT.md 全部 7 处 + phase62_test 注释；JB 数值零改动（63-JB1 抽样锁定） |

## 2. 计算公式/参数保护（本阶段未修改清单）

浇注时间（Dietert/Ozan 模型）/ 阻流截面奥赞式 / 冒口模数·体积·颈系数 / 缩尺公式与档位锚点·文献区间值 / RMAG 余量表 / 出品率表与回退规则 / 激冷系数表 / 砂箱表 / charge 配方公式·成分目标·CHARGE_RET_ABS·默认吸收率 / 打箱时间表·温度机制 / 铸造性表 / 缺陷判定 / CT 数值表（ISO_T7 256 格）——**全部未动**。JB/T 5105 表值未动（仅记录口径修正）。calcs/ 层仅 shrinkage.js 方向映射加了 idx 字段（数值语义不变，63-P1-7F 验证逐方向数值与改造前一致路径）。

## 3. Regression

- Before（PHASE 62 冻结基线，交接书 §1 口径）：**188/0**
- 终版过滤串（phase16b…phase62 + phase63，含 283~287 引擎回归文件）：**247 / 0**
- （62 记录的 188 为不含 283x 系列计数；本机同串历史全量 234/0 → 终版 247/0，两口径下失败均为 0）

## 4. Browser

- **30 / 30**（空态·正常·非法输入·示例标记·CT 未选/推荐/CT1·charge 吸收率 A≠B·应用按钮·shrinkage 方向）
- **Console Errors: 0**
- 截图 `_p63_shots/63_*.png`

## 5. 新增测试

`tests/phase63_test.mjs` 13 项：
- 63-P0A checkNum 矩阵（空/0/负/NaN/±Inf/1e999/文字/非整数/超界/parseNum 不归零）
- 63-P1-7A~F（全方向/空 W/空 L/单方向/全空/单档一致性）
- 63-P1-6（档位锚点+区间+标签零改动锁定）
- 63-P1-1（CT1/120=0.15、CT9/120=2.5 数值锁定）
- 63-P1-5（吸收率 85→70 建议量反比放大、成分与他项建议不变、A≠B）
- 63-P1-5b（吸收率 0/120 边界）
- 63-JB1（JB 表 = 48 格结构 + 高度档 + 抽样值锁定）
- 63-P0B（11 个计算器参数域守卫汇总——63.1 口径修正，见 PHASE 63.1 RESULT）

## 6. 最终验证

- 终跑过滤回归：**247 / 0**（2026-09-04 终版代码，`_p63_final.log`）
- 浏览器 **30 / 30**、**Console Errors: 0**（`_p63_shots/63_*.png`）

## 7. 未处理问题（明确保留 + 原因）

| 项 | 来源 | 为何本阶段不处理 |
|---|---|---|
| P1-3 数据孤岛（设计中心/向导/独立工具参数零携带；blankWeightKg 零消费；hint 死声明） | PRODUCT AUDIT 01 | 任务书 §12 明令进入后续统一数据流阶段 |
| P1-4 sandbox 设计中心自动链参数错喂 | PRODUCT AUDIT 01 | 同上（设计中心范围） |
| P1-8 单件毛重标签防混提示 | PRODUCT AUDIT 01 | 涉及术语统一与跨页文案，随统一术语阶段 |
| P1-9 riser 效率格映射错位/发热死格 | PRODUCT AUDIT 01 | P2 级 UI 一致性，冻结模块内改 UI 需另行批准 |
| P1-10 设计中心失败态 Mc 双输入框 | PRODUCT AUDIT 01 | 设计中心范围 |
| P1-11 结果中心"开箱温度 —℃" | PRODUCT AUDIT 01 | 结果中心范围 |
| charge P/S 方向语义、yield 密度行脱节等 P2 | PRODUCT AUDIT 01 | 任务书 §12 禁顺手修 |
| 向导/独立工具间参数流转 | 审计 | 任务书：不修改 Wizard 数据流 |
| CT"是壁厚？"口语化等 P3 | 审计 | 打磨级，随 45 系列 |

## 8. 结论

P0-1 / P1-1 / P1-2 / P1-5 / P1-6（含明确结论：数值零改、语义分离 PASS）/ P1-7 全部 PASS；JB 64/48 VERIFIED（记录修正）。回归 0 失败 + 浏览器 0 失败 + Console 0 → **PHASE 63 GO / FROZEN**（由用户终审后宣布）。

—— END PHASE 63 RESULT
