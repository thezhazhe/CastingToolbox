# PHASE 28.4 验收报告：28.3 全面验收、数据链审计与风险收口

> 日期：2026-08-27 ｜ 命令：40.txt ｜ 性质：验收 + 风险审计 + 确定性 Bug 修复
> 全量测试：**199/0 通过**（194 基线 + phase284 新增 5 项回归）
> 相关文档：`PHASE28_1_REPORT.md`、`PHASE28_2_ARCHITECTURE_DECISION.md`、`PHASE28_3_REPORT.md`、`PHASE28_ISSUE_TRACKER.md`、`PHASE28_4_PRIORITY.md`

---

## 一、执行摘要

本阶段为验收+审计，修改 10 个生产文件（8 修 + 1 迁 + 1 新测试文件），修复 **7 处确定性缺陷**（其中 4 处为 28.3 引入的接线缺陷），新增 5 项回归测试。未修改任何未经验证的工程公式、企业参数与密度取值（P0-3 仍待人工批准）。

| 项 | 结论 |
|---|---|
| 28.3 是否成功 | ✅ 六个阶段能力验收通过，canonical 迁移干净 |
| 28.3 是否引入新 Bug | ⚠️ 4 处接线缺陷（全部本阶段修复，见 §三） |
| 核心计算链是否可靠 | ✅ 三条数据链单向无环、口径一致；Hp 数学复核通过 |
| 13 计算器是否独立 | ✅ 全部可脱离 STL/设计中心独立计算 |
| STL 与计算器关系 | ✅ 健康（中心→project→计算器单向）；但 STL 引擎存在 3 项高风险（见 §六） |
| 遗留问题 | 见 PRIORITY.md（A 类 5 项） |

---

## 二、PHASE 28.1~28.3 回顾（审计基线）

### 28.1 发现的问题（原始审计 28 项）
- **P0×4**：riserWt 单位 1000 倍（P0-1）、中注 Hp 公式不符（P0-2）、密度液态/固态混用（P0-3）、pw 净重口径错位（P0-4）
- **P1×15**（fv 偏大/Dietert 无出处/chill 热结 T 失真/选项失效等）+ **P2×9**

### 28.3 后状态（本阶段逐项验证）
| 问题 | 28.3 声称 | 28.4 验证结论 |
|---|---|---|
| P0-1 riserWt 单位 | FIXED | ✅ 确认（/1e6，量纲正确，测试锁定） |
| P0-2 中注 Hp | FIXED（方案 A） | ✅ **公式正确**：calc_Hp 与 Excel 原式逐项等价（顶注 rh²/2C、中注 (C/2+rh)²/2C、无冒口退化 C/8）；真实案例 270.6/153.9/240.0/320.5 手算复核通过。⚠️ **但接线不完整**：设计中心首轮运行 gating 先于 riser 回写 → Hp 恒用 rh=0（本阶段修复） |
| P0-3 密度 | PARTIAL（结构拆） | ✅ 结构正确：liquidDensity（gating 液态）/solidDensity（净重+riser 体积）消费者关系清晰，旧 material.density 零残留。⏸ 取值仍待人工批准 |
| P0-4 重量口径 | PARTIAL（语义拆） | ✅ netWeightKg（STL 净重）/blankWeightKg（毛坯）真正区分：全计算器统一读 blankWeightKg；用户改 blankWeightKg 不被 STL 刷新覆盖（USER_OVERRIDE 保护）；refreshWeight 双字段同步正确。⏸ 净重→毛坯余量系数未实现（无可靠来源，正确决策） |
| P1-4 流速标准 | FIXED | ✅ 判定 v_ok 按新标准（封闭1.5/开放1.0）。⚠️ **展示标注 ≤1.8 残留 3 处**（结果中心/报告/向导），与本阶段修复 |
| P1-10/17 Mc 双语义 | FIXED | ✅ mcHotspot/wallHot/chillT 三分：有热结→mcHotspot、无热结→wallHot、chill 独立 chillT；旧 mcUsed 零残留。⚠️ **无热结时 UI 必填行 Mc 输入被静默忽略**（本阶段修复） |
| P1-27 过滤网 | FIXED | ✅ 验收通过（见 §五） |
| P2-15 查表体系 | PARTIAL | ✅ 浇注时间/浇注温度进入产品，锚点回归锁定 |

### 28.3 新引入问题（4 处，全部本阶段修复）
1. **[P1-30] 执行顺序缺陷**（最严重）：RUN_ORDER gating 先于 riser，riserHeight 回写后 gating 不重算 → 设计中心**首次运行** gating 恒用 rh=0（无冒口退化值）：中注 Hp 320.5 vs 153.9（真实案例），阻流截面 A 偏小 ~31%，方向不安全（浇不足）。测试 28.3-B-4 模拟了"gating 重算"但真实代码无此步 → **28.3-B 测试与实际行为脱节**（本阶段修复并加顺序断言）
2. **[P1-31] 无热结 Mc 输入无效**：riser 必填参数 mcHotspot 但无热结时 calculate 读 wallHot → 用户填写被静默忽略
3. **[P1-33] riserHeight 未纳入 clearStlBoundData**：替换 STL 后旧模型冒口高残留 → 新模型只跑 gating 时 Hp 用旧模型值
4. **[P1-32] 流速标注 ≤1.8 残留**：判定按新标准、标注写旧标准（自相矛盾）

---

## 三、本阶段修复（确定性 Bug，40.txt §九范围内）

| # | 文件 | 修复 | 类型 |
|---|---|---|---|
| F1 | `calcs/calcManifest.js`（RUN_ORDER 迁入导出）+ `js/views/designCenter.js` | riser 前置 gating；依赖约束验证（riser/gating 无 results 依赖，yield 在两者后，charge 在 yield 后） | 接线错误（九.2） |
| F2 | `js/views/resultsCenter.js:36`、`reportGenerator.js:64`、`wizard.js:461` | 流速标注改动态 `{type}式≤{vLimit}`（含残缺对象防护 `?.`） | UI 与 calculate 不一致（九.6） |
| F3 | `js/model/CastingProject.js` | clearStlBoundData 清理 process.riserHeight（CALC_RESULT 清，USER_INPUT 保留） | 字段清理遗漏（九.4） |
| F4 | `calcs/calcManifest.js`（riser calculate） | 无热结时用户显式 mcHotspot（USER_OVERRIDE/USER_INPUT）优先；自动来源不误用 | UI 与 calculate 不一致（九.6） |
| F5 | `js/views/designCenter.js`（writeGeometryToProject） | wallUsed/wallHot 加 USER_OVERRIDE 保护（单位切换不再静默还原用户修改；替换 STL 时数据已先清空不受影响） | 自动值覆盖用户输入（九.5） |
| F6 | `calcs/calcManifest.js`（charge）+ `calcs/charge.js` | 不支持牌号（ZG230/ZL104/ZCuSn10P1）→ 明确 unsupported 标记（原 TypeError 被 try/catch 吞掉 → 模块静默消失）；defaultCharge 未知牌号返回 null 不抛错 | silent failure（九.5） |
| F7 | `js/views/resultsCenter.js`、`reportGenerator.js` | charge 渲染：finalCE/ceOk（不存在字段）→ 目标/原铁液 CE；sugs 对象数组 String()→[object Object] → `label +kg`；unsupported 分支显示提示 | UI 与 calculate 不一致（九.6） |

**为什么没有修更多**：P1-35（LOW_CONFIDENCE 透传）、P1-36~38（STL 三高风险管理）、P1-39（铜合金口径）、P1-40（optionalInputs 机制）均涉及工程判断或 UI 机制设计 → 只记录分级，不擅自改（40.txt 一.8/10）。

---

## 四、核心数据链审计（40.txt 三）

### 链路 A：STL→体积→密度→净重→毛坯→浇注→冒口→出品率→铁水
```
STL → volumeCm3(STL_GEOMETRY_ANALYSIS)
     → solidDensity(材料表 7.0) → netWeightKg(DERIVED) ── 展示/校准
     → blankWeightKg(DERIVED 同步；USER_OVERRIDE 保护) ── gating pw / riser cast_wt /
        yield castWt / sandbox wt / shakeout weight / charge 派生
```
- ✅ 单位：cm³×g/cm³÷1000=kg 正确；riserWt Vr(mm³)×rho/1e6=kg 正确（P0-1 回归）
- ✅ 口径：全计算器统一 blankWeightKg（毛坯）；净重仅展示
- ✅ 覆盖保护：blankWeightKg 用户修改（USER_OVERRIDE）不被 refreshWeight 覆盖
- ✅ 旧 STL 刷新：netWeightKg/blankWeightKg 随源体积绑定清理（clearWt 联动 volBound）
- ✅ 迁移：migrateProject 同值拆分（数值不变，28.3-A-1 测试锁定）
- ⚠️ 风险：STL 坏网格 → 体积静默错误 → 全链静默偏小（见 §六 R2，未修复，A 类）

### 链路 B：STL→壁厚/热结→冒口→riserHeight→gating Hp
- ✅ mcHotspot（热结 M）/wallHot（壁厚/2）分流正确；chillT 独立
- ✅ riserHeight 闭环：riser 回写（CALC_RESULT）→ gating 读取（方案 A）；USER_OVERRIDE 不被回写覆盖
- ✅ **F1 修复后**：单次运行内闭环成立（riser 前置）；修复前首轮 Hp 用 rh=0（A 偏小 ~31%）
- ✅ 无循环依赖：riser→riserHeight→gating 为单向（riser 不读 gating 结果）
- ⚠️ 风险：热结漏检→wallHot 兜底→冒口 Vr∝Mc³ 偏小（见 §六 R1，未修复，A 类）

### 链路 C：用户输入→CastingProject→calcManifest→calculate→resultsCenter→reportGenerator
- ✅ Ho/ph 补字段后输入真正接线（28.3 修复确认有效）；未填时 fallback 150/100（已知设计，P3 记录）
- ✅ 参数声明与 calculate 消费：requiredInputs 全部被读取（逐一核对 9 个 manifest 计算器）
- ✅ 结果残留：无（null 从导航过滤 + 结果区整体重写）
- ⚠️ optionalInputs 全设计中心不渲染（P1-40，B 类）；charge 静默失败已修（F6）

---

## 五、80/20 能力验收（40.txt 四）

### 1. 过滤网 ✅
- 默认折叠 ✓（gatingView:98）、未设置自动跳过 ✓（:233-236）、推荐仅建议不自动改 ✓（:248）
- 企业表无成本数据 ✓（9 规格全含 ht/qtCapacity，无 price 字段，D-1 测试锁定）
- 铸钢/铝/铜明确提示"无企业标准" ✓（:240-241）
- 不静默 null ✓（checkFilter 返回 null 时 UI 明确提示）
- **页面复杂度**：折叠区一个开关，未发现"浇注系统页面变复杂"；维持现状（无需更简单方案）

### 2. 浇注时间 ✅
- 有冒口/无冒口/快浇三表 + 线性插值 + 超界取端点 ✓（E-2/E-3 测试）
- Excel 锚点 G=120.22 → 16.9099/10.022/9.5392 ✓（E-1 测试 + 数据表互验）
- 慢浇 16.011 来源不明 → null 待验证标记 ✓（E-4 测试锁定，不猜测）

### 3. 浇注温度 ✅
- 壁厚表插值（37.5→1320 锚点）✓（F-1 测试）
- 液相线 TL=1650−124.5C−26.7Si−65.4P（B 级公式）+ 企业过热度 50 ✓（F-2 测试）
- 输出推荐范围 ±15、标注"企业经验参数" ✓（F-3 测试）
- 非铸铁明确提示无企业表 ✓（F-4 测试）
- **不是"绝对正确温度"** ✓

---

## 六、STL 风险审计（40.txt 三-E）

**引擎现状**：validateMesh 只查数量类（空/NaN/退化计数/开口 warning），不查法向/自交/非流形；体积用有符号散度积分取 abs；热结为轴对齐体素采样。

| # | 风险 | 实测/机制 | 影响 | 等级 |
|---|---|---|---|---|
| R1 | 热结漏检→wallHot 兜底→冒口偏小 | uniform 快路径误判（hotspotV3.js:70-78 0.85/0.6 阈值 vs 相位噪声 ±5-15%）；wallHot=主体壁厚/2 非热结模数；Vr∝Mc³ | 冒口偏小可达数百倍，modOk 自洽通过；传导 gating Hp | **高** |
| R2 | 坏网格体积静默错误 | 开口/缠绕实测体积偏小 33%（stl.js 实测）；OPEN_MESH 仅 warning；geometry.valid 无条件 true | 净重/毛坯/浇注系统全链偏小（浇不足方向） | **高** |
| R3 | 非 90° 旋转热结漏检 | 轴对齐采样×朝向耦合；测试仅 90° 三轴 | 同 R1 | **高** |
| R4 | LOW_CONFIDENCE 有候选但 mcHotspot=0 | designCenter 仅 OK 分支写 mcHotspot | riser/chill 静默"未执行" | 中 |
| R5-R8 | NaN 归零篡改/非流形判内外错乱/内外翻转 | 均静默或安全方向失败 | 视场景 | 中-低 |

**回答"程序是否可能正常运行但产生错误工程结果"：是。** R1/R2 两条链完全静默，且结果页文案"未检测到有效热结——不会给出假热结，可继续其他分析"（resultsCenter.js:213）对"算法漏检"（假阴性）无任何区分，起反向引导作用。
**本阶段不开发**（40.txt 四-E：只评估）；三项高风险列入 PRIORITY.md A2/A3/A4，修复方向：区分"真均匀件"与"分析失败"并阻断/警示自动执行 + 坏网格体积确定性提示。

---

## 七、13 计算器独立性审计（40.txt 五）

**总体：全部 13 个计算器单独打开（独立视图）不依赖 STL/设计中心，可手工完整计算。** 逐项核验（关键项）：

| 计算器 | 独立可用 | 关键发现 |
|---|---|---|
| gating | ✅ 最完整（自定义比例/组元全 UI） | 设计中心路径组元硬编码（gc/gt/rc/rt 及排气 5 参数）；wall 兜底 `\|\| wallAvg \|\| 10` 静默 |
| riser | ✅ 4 种 Mc 输入/4 形状/效率全 UI | manifest 硬编码 sphere_head/hd=1.0（P1-11/12）；无热结 Mc 输入已修（F4） |
| yield | ✅ | riserWt 无冒口 null → 结果中心隐藏行，处理正确 |
| chill | ✅ | manifest 硬编码外冷铁·直接；冷铁材料不匹配显式回退+警告（好范式） |
| sandbox | ✅ | 超表返回保守值+warning（好设计）；无材料依赖 |
| machining | ✅ | **铜合金两路径口径不一致（P1-39，B5）**：manifest 按铝合金 vs 独立视图按灰铸铁 |
| charge | ✅ | 独立视图白名单自洽；设计中心不支持牌号已修（F6） |
| shakeout | ✅ | manifest 全硬编码（mode/heatTreat/risk/importance，P1-23）；SHAKE_TEMP 无兜底（P2-18，无触发路径） |
| shrinkage/castability/ct/defect_finder/principles | ✅ | castability/ct 无 manifest 仅独立视图；未知材质静默回退灰铁（白名单保护不可达） |

**共性**：独立视图 null 路径 9/9 有明确提示；设计中心 null=静默（charge 已修，其余为"参数不足"类，属设计中心信息架构问题）。

---

## 八、产品结构审计（40.txt 六）

```
工艺设计中心（STL 分析 + 自动参数）
    ↓ 写 CastingProject（canonical 参数，P(v,src,conf) 来源标记）
13 个独立计算器（manifest calculate 读共享参数；独立视图自带全部输入）
    ↓
resultsCenter / reportGenerator（纯展示）
```
- ✅ **无循环依赖**：riser→riserHeight→gating 单向；yield/charge 顺序依赖（RUN_ORDER 约束 + F1 测试断言）
- ✅ 无跨页面强耦合（riser 回写是唯一跨计算器数据流，经 project 中转，非直接调用）
- ✅ 无大量全局状态（仅 CastingProject 单例，来源标记可追溯）
- ✅ 计算器不依赖设计中心（独立视图全输入自带）；计算器之间无"必须打开 A 才能算 B"
- ✅ canonical 参数零旧字段残留（全局 grep：仅迁移代码/注释/测试夹具）

---

## 九、28.3 六阶段验收结论

| 阶段 | 验收 |
|---|---|
| A canonical 拆分 | ✅ 迁移数值不变、消费者分流正确；补静默失败字段（Ho/ph）有效 |
| B Hp 方案 A | ✅ 公式正确（手算+测试双重验证）；⚠️ 接线缺陷 F1 已修 |
| C 流速标准 | ✅ 判定正确；⚠️ 标注残留 F2 已修 |
| D 过滤网 | ✅ 全项通过 |
| E 浇注时间查表 | ✅ 全项通过 |
| F 浇注温度 | ✅ 全项通过 |

## 十、新发现 Bug 汇总（原台账未记录）

| ID | 问题 | 状态 |
|---|---|---|
| P1-30 | 执行顺序缺陷（gating 先于 riser 回写） | **FIXED**（28.4） |
| P1-31 | 无热结 Mc 输入无效 | **FIXED**（28.4） |
| P1-32 | 流速标注 ≤1.8 残留 3 处 | **FIXED**（28.4） |
| P1-33 | riserHeight 未纳入 STL 清理 | **FIXED**（28.4） |
| P1-34 | writeGeometryToProject 无 USER_OVERRIDE 保护 | **FIXED**（28.4） |
| P2-17 | charge 渲染 bug（不存在字段 + [object Object]） | **FIXED**（28.4） |
| P1-35 | LOW_CONFIDENCE 候选 mcHotspot=0 → riser 静默未执行 | CONFIRMED（A5） |
| P1-36~38 | STL 三高风险（漏检链/坏网格体积/旋转漏检） | CONFIRMED（A2-A4） |
| P1-39 | machining 铜合金两路径口径不一致 | CONFIRMED（B5，需人工） |
| P1-40 | optionalInputs 死声明机制（P1-11/12/18/23 根因） | CONFIRMED（B1） |
| P2-18 | SHAKE_TEMP 无兜底 | CONFIRMED（C9，防御性） |

## 十一、8 个问题的最终回答（40.txt 十二）

1. **PHASE 28.3 是否成功？** ✅ 成功。canonical 架构收敛正确、Hp 方案 A 公式正确、3 个 80/20 能力合格、旧字段零残留。但接线有 4 处缺陷（首轮 Hp 失效最严重）——都是"计算正确、串联不完整"，非架构问题。
2. **28.3 有没有引入新的 Bug？** 有，4 处（P1-30~33），全部为确定性接线缺陷，本阶段已修复并加回归。
3. **当前核心计算链是否可靠？** ✅ 可靠。三条数据链单向无环、单位/口径/覆盖保护全部验证通过；Hp 数学复核与真实案例一致。剩余风险集中在 STL 输入质量（R1/R2，非计算链本身）。
4. **13 个计算器是否仍保持独立？** ✅ 是。逐项验证均可脱离 STL/设计中心独立计算；独立性是产品结构原则，未被 28.3 破坏。
5. **STL 工艺设计中心与计算器关系是否健康？** ✅ 健康（单向依赖）。但中心依赖的 STL 引擎存在高风险管理项（§六），不影响结构健康、影响工程正确性。
6. **哪些遗留问题真正影响工程正确性？** ① P0-3 密度取值（等批准）；② R1 热结漏检→冒口偏小；③ R2 坏网格体积静默错误；④ R4 低置信度静默未执行。①②③是同一主题：**"输入质量差时系统静默产出偏小结果"**。
7. **哪些问题可以以后再做？** C 类 9 项（见 PRIORITY.md）：出品率校准、毛坯余量、慢浇表、validateMesh 全面化等——均不影响当前核心正确性。
8. **产品是否足够稳定进入下一轮能力开发？** **可以，但有前置条件**：建议先做 A 类 5 项中的 STL 三高风险管理（R1/R2/R3）再进入大规模功能开发——它们不阻塞现有计算器使用，但阻塞"STL 导入→冒口建议"这条主流程的可靠性结论。若接受该风险等级，则下一轮可优先 B 类（optionalInputs 机制一处修通四家）。**本阶段不进入 28.5**（40.txt 执行原则）。

---

## 十二、修改文件清单

**生产代码（10 文件）**：`calcs/calcManifest.js`（RUN_ORDER 迁入 + riser Mc 优先 + charge unsupported）、`calcs/charge.js`（defaultCharge 防护）、`js/model/CastingProject.js`（riserHeight 清理）、`js/views/designCenter.js`（RUN_ORDER 引用 + wallUsed/wallHot 保护）、`js/views/resultsCenter.js`（流速标注 + charge 渲染）、`js/views/reportGenerator.js`（流速标注 + charge 渲染）、`js/views/wizard.js`（流速标注）
**测试**：`tests/phase284_test.mjs`（新增 5 项：RUN_ORDER 顺序 / riserHeight 清理 / Mc 优先 / charge unsupported / defaultCharge 防护）
**文档**：`docs/PHASE28_4_ACCEPTANCE_REPORT.md`（本报告）、`docs/PHASE28_4_PRIORITY.md`（优先级）、`docs/PHASE28_ISSUE_TRACKER.md`（P1-30~40/P2-17/18 新增 + 修订历史）
