# PHASE 27-A：全工艺计算器输入/输出/数据依赖与 STL 自动化能力审计报告

> 命令文件：`新建 文本文档 (35).txt`（2026-08-26）
> 原则：只读审计，生产代码零修改
> 依据：calcs/calcManifest.js（294 行）、calcs/registry.js（194 行）、calcs/ 引擎 12 文件、
>       js/model/CastingProject.js（277 行）、js/views/smallCalcs.js、js/views/ctCalc.js、
>       data/ 数据表、js/views/designCenter.js 数据链（PHASE 26 已审）

---

## 1. 计算器完整枚举（以代码实际存在为准）

**权威清单 = `calcs/registry.js` 的 CALCULATORS（13 个，全部 status:'ready'）**

| # | id | 名称 | 类型 | 接入方式 |
|---|---|---|---|---|
| 1 | gating | 浇注系统设计 | 计算 | manifest（设计中心主流程）+ 独立视图 gatingView.js |
| 2 | riser | 冒口设计 | 计算 | manifest + 独立视图 riserView.js |
| 3 | shrinkage | 线收缩率 | 计算 | manifest |
| 4 | machining | 加工余量 | 计算 | manifest |
| 5 | yield | 出品率与铁水重量 | 计算 | manifest |
| 6 | chill | 冷铁计算 | 计算 | manifest |
| 7 | sandbox | 3D砂型吃砂量 | 计算 | manifest |
| 8 | charge | 熔炼加料计算 | 计算 | manifest（dependsOn gating/yield） |
| 9 | shakeout | 开箱时间 | 计算 | manifest + 独立视图 shakeoutCalc.js |
| 10 | castability | 铸件结构工艺性 | 查表建议 | 独立视图（smallCalcs.js renderCastability） |
| 11 | ct | 尺寸公差 CT 查询 | 查表 | 独立视图 ctCalc.js |
| 12 | principles | Campbell 十规则 | 展示型 | 独立视图 principlesCalc.js（无计算） |
| 13 | defect_finder | 缺陷查找 | 查询型 | 独立视图 defectFinder.js（知识检索，无计算） |

引擎位置：`calcs/`（gating/riser/yield/chill/sandbox/machining/shrinkage/charge/shakeout/castability/ct/registry/calcManifest）。
数据表：`data/`（chill_calc/sandbox_calc/shakeout_calc/charge_calc/ct_calc + 知识库 defects/rules/materials 等）。
参数模型：`js/model/CastingProject.js`（P(v,src,conf,editable) 单例 + localStorage）。

## 2. 逐个计算器审计（输入→公式→系数→来源）

### 2.1 浇注系统设计（gating.js，190 行）

**输入**（manifest 声明）：材料大类 material.family、铸件重量 geometry.weightKg、一模件数 production.cavities、主体壁厚 process.wallUsed、浇注方向 process.pourPos、内浇道至上箱面距离 process.Ho、铸件高度 process.ph；可选：预估出品率 material.yieldSug、目标产量 production.qty
**隐藏硬编码**（manifest calculate 内联，独立视图可改）：比例键 recommendGatingRatio、gc:2/gt:15/rc:2/rt:25/vr:15/vrc:4/vs:75/vst:8/vsc:4
**公式**（《铸造手册》）：
- 浇注重量 G = pw × cav ÷ (yr/100)
- 浇注时间（Dietert）t = f×(√G + ∛(w×G/5))×2/3（w=壁厚，f=材质系数）
- 平均静压头 Hp = Ho + Hb/2 − …（顶/中/底注三分支，Hb 水口盆高查表 150→1100）
- 阻流截面（奥赞）A = 71.47×G/(ρ×t×fv×√Hp)×100（fv=顶 0.8/中 0.6/底 0.45）
- 面积比例 RATIO_PRESETS（S直:S横:S内 六档预设）
- 内浇口流速校核 v ≤ 1.8 m/s、排气面积 ≥ 1.5 倍直浇道
**系数**：材质表 MATERIALS（ρ/fc/出品率区间）、fv、Hb 查表、RATIO_PRESETS——全部硬编码
**STL 已提供**：weightKg ✓、wallUsed ✓（PHASE 26 后可信）；Ho/ph/cav/pos 用户输入
**输出**：G/t/A/D_sp/L_g/L_r/Fg/Fr_act/v/v_ok/vr/vr_ok/sugs

### 2.2 冒口设计（riser.js，123 行）

**输入**：材料大类、铸件重量 geometry.weightKg、热节模数 process.mcUsed、可选 冒口形状/高径比
**关键缺陷**：manifest calculate 写死 `shape:'sphere_head', hd_ratio:1.0, eff:undefined`——**optionalInputs 声明的形状/高径比选择不生效**（改了不参与计算）
**公式**（《铸造工艺学》模数法）：
- Mc = direct 模式直取 process.mcUsed
- 迭代：f 从 1.10 起 +0.05，Mr_need = Mc×f → 形状反算 D → 校核 Mr_act ≥ Mr_need×0.99 且 eff×Vr ≥ Vc×shrink（体积校核）
- 冒口颈 d_neck = Mc×neck_k×4（圆颈 M=d/4）
**系数**：RISER_MATERIALS（rho/shrink/neck_k，**铸钢 rho=7.8**）、RISER_EFF 补缩效率（14/20/25/35%）、形状库公式——硬编码
**STL 已提供**：weightKg ✓、mcUsed ✓（PHASE 26 后 = 热结 M 或 bodyRef/2）
**输出**：D/H/Mr_act/Vr/effV/d_neck/yieldPct/modOk/volOk

### 2.3 线收缩率（shrinkage.js，73 行）

**输入**：材料大类 + 外形尺寸 geometry.size（X/Y/Z 三方向）+ 可选 收缩方式（free/common/restrained，默认 common）
**公式**：SHRINKAGE 表（free/common/restrained 三档 ×5 材质）；按绝对尺寸 100~1000mm 线性插值（≤100 取小方向值、≥1000 取上限）；方向差 ≥0.2 个百分点 → directional 提示分方向放缩水
**系数**：SHRINKAGE 表、SPLIT_RATE_DIFF=0.2、SIZE_SMALL/LARGE=100/1000——硬编码
**STL 已提供**：geometry.size ✓（已自动连接）
**输出**：dirs[{size,rate,amount,pattern}]、combined、spread、directional

### 2.4 加工余量（machining.js，67 行）

**输入**：材料大类 + geometry.size（useMax）+ 可选 铸造方法 production.method
**公式**：GB/T 6414-1999 RMA_TABLE（A~H 八级 ×13 尺寸档，单侧余量）查表；METHOD_GRADES 方法×材质推荐等级
**近似映射**：球铁→灰铸铁、铜合金→铝合金（GB/T 6414 同档近似，无提示）
**STL 已提供**：geometry.size ✓（已自动连接）
**输出**：min/max/mid/grades

### 2.5 出品率与铁水重量（yield.js，60 行）

**输入**：材料大类 + geometry.weightKg + 可选 造型线 production.line
**公式**：resolveYield 五级回退（产品×工艺 → 材质×工艺 → 工艺 → 材质 → 通用[40,60]）
**关键串联（已实现）**：pourWt = results.gating.G（若浇注系统完成）否则 wt/(yieldSug/100)；runnerWt = G−wt；riserWt = results.riser.Vr×r.md.rho/1000（**用 riser 材料表 rho，非项目 density**）
**STL 已提供**：weightKg ✓（已自动连接）
**输出**：range/basis/level/castWt/pourWt/runnerWt/riserWt

### 2.6 冷铁计算（chill.js，76 行 + data/chill_calc.js）

**输入**：材料大类 + process.mcUsed（T = mcUsed×2 "热节壁厚"）+ 可选 冷铁类型/材料
**公式**：外冷铁 δ = 系数×T（CHILL_COEF 材质×冷铁材料表）；内冷铁 = 0.3~0.5×T；失效警告（>100mm/挂砂层 10-15/二分之一原则）
**STL 已提供**：mcUsed ✓（间接——T=2Mc 由热结/主体壁厚推导）
**输出**：thickness/mid/deltaText/warnings/rules

### 2.7 3D砂型吃砂量（sandbox.js，51 行 + data/sandbox_calc.js）

**输入**：geometry.size（useMax 最大轮廓）+ geometry.weightKg + 可选 砂型方式（埋箱/裸浇）
**公式**：埋箱查表 SB_BURROW（轮廓×重量 → 承重/非承重壁厚）；裸浇 = 溃散层5 + (静水压头−铸件高)，最低 40，底面 1.5×；砂型最小壁厚 <100→8 / 100~4000→30
**STL 已提供**：size ✓、weightKg ✓（全自动）；裸浇 castH/headH 需用户（manifest 路径不可用）
**输出**：minWall/noload/load/basis

### 2.8 熔炼加料计算（charge.js，108 行 + data/charge_calc.js）

**输入**：材料大类 + **geometry.weightKg（声明）**；**dependsOn gating/yield（计算依赖）**
**关键缺陷**：calculate 实际用 `results.yield.pourWt || results.gating.G`（铁水总重），**与 requiredInputs 声明的 geometry.weightKg 不一致**——UI 显示"铁水总重（derived: 铸件重量÷出品率）"但绑定的是 geometry.weightKg 参数值；用户无法直接设置铁水总重
**公式**：牌号目标成分（CHARGE_TARGETS）→ 默认配比（CHARGE_DEFAULTS 生铁/废钢/回炉料%）→ 元素平衡 base[el] = Σ(kg×含量×吸收率)/totalWt → 球化/孕育带入 → 差额 → 补料建议（缺 >0.05% 才建议）→ CE 碳当量
**系数**：吸收率默认（0.45-0.85）、牌号表、料成分表——硬编码
**STL 已提供**：weightKg →（经 gating/yield）pourWt ✓ 已串联
**输出**：base/final/elems/CE/sugs/allOk

### 2.9 开箱时间（shakeout.js，95 行 + data/shakeout_calc.js）

**输入**：材料大类 + geometry.weightKg + process.wallUsed + 可选 生产方式 production.line（options ['砂型','流水线']）/重要性
**公式**：COOL_SMALL 按重量分档（min/max 分钟）+ 壁厚超档 +30% 提示；≥1t 走 COOL_LARGE（小时）；调整系数 SHAKE_ADJUST（流水线×0.65/热时效×0.85/易裂×1.15/重要×1.1）；开箱温度 SHAKE_TEMP（重要件 ≤250℃ 封顶）
**材质映射**：球铁→球墨铸铁（SHAKE_TEMP 键）
**STL 已提供**：weightKg ✓、wallUsed ✓（PHASE 26 后可信）
**输出**：timeRange/unit/shakeTemp/adjustments/warnings

### 2.10-2.13 知识/查询型（castability/ct/principles/defect_finder）

- **castability**（smallCalcs.js renderCastability）：输入全部**用户手填**（材质/最大轮廓尺寸默认300mm/两壁厚度默认10×14mm/批量/起模高/模样/砂种）→ MIN_WALL_TABLE（铸造工程师手册）/临界壁厚=3×最小/castability.js 圆角=壁厚均值 1/5~1/3 外、1/3~1/2 内/JB/T 5105-2022 拔模斜度表/最小铸孔批量表。**STL 的 geometry.size 与 bodyRef 完全未接入**
- **ct**（ctCalc.js）：用户手填基本尺寸（默认 120mm）+ 等级 → CT_TABLE（GB/T 6414）查 ±公差。**STL geometry.size 未接入**
- **principles**：展示型，无输入输出
- **defect_finder**：知识检索，无输入输出

## 3. STL → 工艺计算能力表

| STL 数据 | 精确/采样 | 可供计算器 | 转换 | 单位 | 当前已连接？ |
|---|---|---|---|---|---|
| 外形尺寸 X/Y/Z | 精确 | shrinkage/machining/sandbox/castability/ct | 无 | mm | shrinkage/machining/sandbox ✓；**castability/ct ✗（手填）** |
| 体积 | 精确 | weightKg 链 | /1000 | cm³ | ✓ |
| 表面积 | 精确 | （无计算器使用；V/A 模数可由体积/面积近似） | — | cm² | ✗（无消费者） |
| 重量（体积×密度） | 精确派生 | gating/riser/yield/sandbox/shakeout/charge | 无 | kg | ✓ 全连接 |
| 主体壁厚 bodyRef | 采样工程 | gating/shakeout/castability 圆角 | 无 | mm | gating/shakeout ✓（PHASE 26）；**castability ✗** |
| 最大壁厚 wallMax | 采样工程 | （参考展示） | — | mm | ✗（无消费者） |
| 局部壁厚 tP10/tP50/thinFrac | 采样工程 | castability 最小壁厚对照 | 无 | mm | ✗ |
| 热结数量 | 采样估算 | 展示 | — | 个 | ✓ |
| 热结 M（封顶峰值） | 采样估算 | riser（mcUsed）/chill（2Mc） | 无 | mm | ✓（有热结时覆盖 mcUsed） |
| 热结位置/置信度 | 采样估算 | 展示 | — | mm/% | ✓ |
| 热结区域体积 | 采样估算 | 冒口补缩评估（当前未用） | cm³ | — | ✗ |
| 采样状态/warning | 采样估算 | 展示 | — | — | ✓ |

**重点优化对象（"STL 已算出来但计算器仍要求用户重新输入"）**：
1. **castability 的最大轮廓尺寸 + 壁厚**（视图手填默认 300/10×14）
2. **ct 的基本尺寸**（视图手填默认 120mm）
3. **gating 的铸件高度 ph**——可由 STL bbox 浇注方向尺寸自动建议（当前手填默认 100）
4. **Ho（内浇道至上箱面距离）**——可自动建议 = ph×0.6 等经验值（当前手填默认 150）

## 4. 用户只输入一次的公共参数（已有项目级共享）

CastingProject 已是项目级单例：material.family/density/grade、geometry.*、production.*（qty/cavities/line/prod/method）、process.*（pourPos/wallUsed/mcUsed）。**共享机制已实现**（allMissingInputs 按 input 键去重，同键只输入一次）。

| 重复参数 | 出现于 | 重复输入现状 | 主数据来源 |
|---|---|---|---|
| 材料大类 family | 全部 9 个 manifest 计算器 | 已共享 ✓ | material.family |
| 铸件重量 weightKg | gating/riser/yield/sandbox/shakeout/charge | 已共享 ✓ | geometry.weightKg（STL×密度） |
| 外形尺寸 size | shrinkage/machining/sandbox | 已共享 ✓ | geometry.size（STL） |
| **最大轮廓尺寸** | castability（未接）/ct（未接） | **重复手填** | 应接 geometry.size |
| 主体壁厚 wallUsed | gating/shakeout | 已共享 ✓ | process.wallUsed（STL bodyRef） |
| 热节模数 mcUsed | riser/chill | 已共享 ✓ | process.mcUsed（STL 热结/壁厚） |
| **密度 density** | material.density（项目）vs MATERIALS/RISER_MATERIALS 表 | **三处并存** | 应统一（见 §7） |
| **造型线 line** | yield（不指定/垂直线/水平线）vs shakeout（砂型/流水线） | **选项集冲突** | 见 §7 |
| 生产批量 qty | gating 可选 + castability（批量概念） | 部分 | production.qty |
| 铸造方法 method | machining | 已共享 ✓ | production.method |

## 5. 计算器间数据流

### 已实现（代码确认）
```
STL → geometry（精确量）→ weightKg（×density）
STL → bodyRef → wallUsed（gating/shakeout 用）
STL → 热结 M → mcUsed（riser/chill 用）
gating.G → yield.pourWt/runnerWt
riser.Vr → yield.riserWt
yield.pourWt | gating.G → charge.pourWt（dependsOn 已声明）
```

### 理论上可连接但未实现
```
geometry.size → castability 最大轮廓尺寸、ct 基本尺寸
bodyRef → castability 圆角输入
geometry.size → gating 铸件高度 ph 建议（浇注方向）
hotspot 区域体积 → 冒口补缩量校核（riser 的 Vc 现用整件重量）
yield.pourWt → shakeout？（无）
shrinkage.pattern（放缩水后尺寸）→ 模具尺寸输出（无消费者）
```

## 6. 输入来源矩阵

| 参数 | STL | 用户 | 材料库 | 标准/知识库 | 其他计算器 | 当前自动连接 |
|---|---|---|---|---|---|---|
| material.family | — | ✓（选择） | ✓（预填场景） | — | — | ✓ |
| geometry.size | ✓ | 可改 | — | — | — | ✓ |
| geometry.weightKg | ✓（体积×密度） | 可改 | 密度来自库 | — | — | ✓ |
| process.wallUsed | ✓（bodyRef） | 可改 | — | — | — | ✓ |
| process.mcUsed | ✓（热结 M/壁厚/2） | 可改 | — | — | — | ✓ |
| production.cavities/qty | — | ✓ | — | — | — | — |
| process.pourPos/Ho/ph | ✗（ph 可建议） | ✓ | — | — | — | — |
| 出品率 | — | 可改 | ✓（y_min~y_max） | ✓（五级回退表） | gating.G | ✓ |
| 冒口形状/效率 | — | ✓ | — | ✓（RISER_EFF） | — | **✗（声明不生效）** |
| 铁水总重 | — | — | — | — | yield/gating | ✓（但 UI 声明错误） |
| castability 尺寸/壁厚 | ✗（未接） | ✓ 手填 | — | ✓ 查表 | — | ✗ |
| ct 基本尺寸 | ✗（未接） | ✓ 手填 | — | ✓ GB/T 6414 | — | ✗ |

优先级规则（已实现）：STL 自动值 → 用户修改（USER_OVERRIDE 保护）→ 手动输入。PHASE 26 已确认 wallUsed/mcUsed 的覆盖保护存在，但**切单位/重导入会无条件覆盖用户修改**（P3，PHASE 26 已记录）。

## 7. 输出复用矩阵 + 数据一致性风险

| 计算器 | 输出 | 单位 | 可供 | 当前复用 |
|---|---|---|---|---|
| gating | G | kg | yield.pourWt/runnerWt、charge | ✓ |
| gating | t/A/D_sp/L_g/L_r | s/mm²/mm | 展示/砂型设计 | ✗（无消费者） |
| riser | D/H/Vr/d_neck | mm/cm³/mm | yield.riserWt、工艺卡片 | ✓（Vr→yield） |
| riser | Mr_act | mm | 校核展示 | ✗ |
| yield | pourWt/riserWt | kg | charge | ✓ |
| shrinkage | pattern | mm | 模具设计 | ✗（无消费者） |
| machining | mid | mm | 工艺卡片 | ✗ |
| chill | mid | mm | 工艺卡片 | ✗ |

**数据一致性风险（P0）**：
1. **铸钢密度三处不一致**：gating.js MATERIALS 铸钢 rho=7.5、riser.js RISER_MATERIALS 铸钢 rho=7.8、CastingProject material.density 默认 7.0（灰铁）。同一铸钢件：重量链（体积×7.0？——density 由场景预填，若用户选铸钢但 density 未更新=错）与浇注链（7.5）与冒口链（7.8）给出不同质量/体积。且**用户修改 material.density 不影响 gating/riser 计算**（它们用表内值）
2. **production.line 选项集冲突**：yield 用 ['不指定','垂直线','水平线']，shakeout 用 ['砂型','流水线']——同一参数两个语义，用户改一个破坏另一个
3. **charge 输入声明 vs 实际计算不符**：UI 显示 geometry.weightKg，实际用 results.yield.pourWt || gating.G

## 8. 单位体系检查

| 环节 | 单位 | 状态 |
|---|---|---|
| STL 长度 → 尺寸 | mm | ✓ |
| 体积 mm³ → cm³ | /1000 | ✓（writeGeometryToProject） |
| 面积 mm² → cm² | /100 | ✓ |
| 重量 = cm³×g/cm³÷1000 | kg | ✓（refreshWeight，无重复换算） |
| gating G = kg/(%) | kg | ✓ |
| riser Vc = kg×1e6/rho | mm³（rho=kg/m³ 等价 g/cm³×1e6） | ✓ 换算正确 |
| riser Vr → yield.riserWt = Vr×rho/1000 | cm³→kg | ✓ |
| chill T = 2×Mc | mm | ✓ |
| shakeout 时间 min/h | ✓ |
| **混用风险** | gating 用 rho（7.5 铸钢）与 riser 用 rho（7.8 铸钢）在同一重量链交叉 | **密度不一致（见 §7）** |
| **kg/g 混用** | charge totalWt kg、补料 sug kg | ✓ 无 g 混用 |

结论：换算本身全部正确；唯一风险是密度常量不一致（非单位换算错误）。

## 9. 数据可信等级标注

| 数据 | 等级 | 说明 |
|---|---|---|
| 体积/面积/尺寸/三角面 | **A 精确** | STL 三角积分（PHASE 25 实证旋转不变 0% 波动） |
| weightKg | A（体积）×D（密度） | 密度为经验/库值 |
| 主体壁厚 bodyRef | **B 采样工程** | ±10% 内（PHASE 25/26 已验证链） |
| 最大壁厚 wallMax | B | ±5-14% 相位波动 |
| 热结 M/位置/置信度 | **C 工程估算** | 90° 内稳定（PHASE 25） |
| 出品率区间 | **D 经验推荐** | 五级回退查表 |
| 浇注时间/阻流截面 | D（公式经验系数） | Dietert/奥赞 + 材质系数 |
| 冒口尺寸 | D（模数法） | 模数法 + 效率表 |
| 冷铁厚度 | D（系数×T） | CNKI 系数表 |
| 收缩率 | D | 手册表 + 插值 |
| 加工余量/公差 | **D 标准查表** | GB/T 6414（权威） |

## 10. 重量数据链专项

```
STL 体积(mm³) → /1000 → volumeCm3(cm³)
volumeCm3 × material.density(g/cm³) / 1000 → weightKg(kg)   [refreshWeight，USER_OVERRIDE 保护]
weightKg → gating.G = weightKg×cav/yield
gating.G → yield.pourWt；yield.runnerWt = G−wt
riser.Vr(cm³) × riser 材料表 rho / 1000 → yield.riserWt
yield.pourWt | gating.G → charge 铁水总重
```

**概念区分**：净铸件重量（weightKg）✓ 已有；浇注系统重量（runnerWt，仅 gating 完成时）✓ 已有；冒口重量（riserWt，仅 riser 完成时）✓ 已有；铁水重量（pourWt）✓ 已有。**但三者依赖"gating/riser 已执行"**——未执行时 pourWt 用 yieldSug 估算（wt/0.7），runnerWt=估算−wt，riserWt=null。**各重量概念的来源标记（STL/估算/实测）未在 UI 区分**。

## 11. 模数 M/Mc 专项（概念区分）

| 名称 | 位置 | 数学定义 | 来源 | 与热结 M 关系 |
|---|---|---|---|---|
| 主体壁厚 | 概览/模型信息 | bodyRef = max(bodyWallOf, tP50) | STL 采样 | 不同概念 |
| 概览 Mc | 概览"最大热结 Mc" | 热结列表最大 peakModulus | STL 热结 | **同一概念**（=最大热结 M） |
| 热结列表 M | 热结列表 | 细化场封顶 M 峰值（V/A） | STL 热结 | 本体 |
| 参数面板 Mc（process.mcUsed） | 参数面板 | 无热结：bodyRef/2；有热结：**= 最大热结 M** | STL + 覆盖逻辑 | 有热结时同值；无热结时不同（壁厚/2 近似） |
| 冒口计算模数 | riser 输入 | = process.mcUsed（direct） | 同上 | 同上 |
| 冒口目标模数 | riser 内部 Mr_need | Mc × f（f≥1.10 迭代） | 派生 | 不同（含安全系数） |
| 冷铁"热节壁厚" | chill 输入 | T = 2 × mcUsed | 派生 | 2×Mc |

**结论**：系统中只有两个独立模数语义——**热结 M（局部 V/A 工程估算）**与**工艺 Mc（无热结时 bodyRef/2 的板件近似，有热结时被热结 M 覆盖）**。名称相似但切换语义（PHASE 26 已在 UI hint 澄清）。riser 内部 Mr_need 是目标模数（Mc×安全系数），非上述两者。

## 12. P0/P1/P2 问题清单

### P0（正确性/严重体验）
1. **材料密度三处不一致**（gating 7.5 / riser 7.8 / 项目 density）：同一铸钢件不同模块给出不同重量/体积；用户改 project density 不影响 gating/riser。→ 应统一为项目级 density 单一来源，计算器从项目读（或显式标注表内值与项目值的关系）
2. **charge 输入声明与实际计算不符**：UI 要求/显示"铸件重量"，实际用 gating/yield 的铁水总重；依赖链 UI 表达错误，用户看到的结果与填写的参数无关
3. **production.line 选项集冲突**（yield vs shakeout 同参数不同 options）

### P1（明显值得下一阶段做）
4. **castability/ct 不读 STL**（最大轮廓尺寸/壁厚/基本尺寸手填）——"STL 已算出来但要求用户重新输入"的典型
5. **riser 形状/高径比选择不生效**（manifest calculate 写死 sphere_head/1.0）
6. **gating 组元尺寸硬编码**（gc/gt/rc/rt/vr/vs 等 8 个参数在 manifest 内联，主流程用户不可调；独立视图可调）
7. **machining 材质近似映射未提示**（球铁→灰铁、铜→铝）
8. **gating 铸件高度 ph / Ho 可自动建议**（bbox 浇注方向尺寸 + 经验比例）

### P2（以后优化）
9. sandbox 裸浇参数（castH/headH）manifest 路径不可用
10. 壁厚超档提示、材质映射（shakeout 球铁→球墨铸铁键）的一致性提示
11. castability 批量概念与 production.qty 未打通
12. 冒口体积校核用整件重量（Vc），可用热结区域体积做局部校核

## 13. 理想数据流（推荐，基于现有系统）

```
                    STL（三角积分）
                         ↓
                 ┌─────────────────┐
                 │ 几何分析（精确量）│ 尺寸/体积/面积/三角面（A 级）
                 │ 壁厚采样链（B 级）│ bodyRef/wallMax/tP50
                 │ 热结分析（C 级） │ 热结 M/位置/置信度/区域体积
                 └────────┬────────┘
                          ↓
                 ┌─────────────────┐
                 │ 项目基础数据     │ material.family/density（单一来源）
                 │（单例，只输入一次）│ production.*（qty/cavities/line/method）
                 └────────┬────────┘
                          ↓
            ┌─────────────┼─────────────┐
            ↓             ↓             ↓
       weightKg      wallUsed/mcUsed    size（几何）
       （体积×密度）   （主体壁厚/热结）   （尺寸复用）
            ↓             ↓             ↓
   ┌────────┴───────┬─────┴──────┬──────┴───────┐
   ↓                ↓            ↓              ↓
   gating ←────→ riser      yield ←────→ charge
   （G/t/A）      （D/H/Vr）   （pourWt）      （铁水总重）
   ↓                ↓            ↓
   sandbox      shakeout     chill
   （尺寸+重量）   （重量+壁厚）   （mcUsed）
        └──────────── 知识/查表型：castability/ct ←（应接入）size/bodyRef
```

**【现有数据流】**：STL→几何→weightKg/wallUsed/mcUsed→gating/riser/yield→charge；size→shrinkage/machining/sandbox ✓
**【推荐数据流】**：① 统一密度单一来源 ② castability/ct 接入 size/bodyRef ③ gating 组元参数可调 ④ riser 形状选择生效 ⑤ 输出（G/t/A、D/H/Vr、pattern、mid）进入"工艺结果中心"统一展示

## 14. 最终 10 问题回答

1. **多少个计算器**：13 个正式（registry 权威）：9 个 manifest 计算型 + 4 个独立知识/查询型（principles/defect_finder 无计算）
2. **每计算器核心输入**：gating=重量+壁厚+浇注参数；riser=重量+Mc；shrinkage=尺寸+材质；machining=尺寸+材质+方法；yield=重量+出品率区间；chill=Mc；sandbox=尺寸+重量；charge=铁水总重（源自 gating/yield）；shakeout=重量+壁厚；castability=尺寸+壁厚（手填）；ct=基本尺寸（手填）
3. **每计算器核心输出**：见 §7 输出复用矩阵
4. **STL 能自动提供多少**：13 个关键输入中 9 个已自动（尺寸/重量/主体壁厚/热节模数——覆盖 gating/riser/yield/chill/sandbox/shakeout/shrinkage/machining 的全部核心）；4 个未接（castability/ct 的尺寸与壁厚）
5. **必须用户手工输入**：材料大类（选择）、一模件数/目标产量、浇注方向/高度（Ho/ph）、冒口形状/效率（当前未生效）、砂型方式、重要性等——均为工艺决策类，合理
6. **重复输入参数**：castability/ct 的尺寸与壁厚（STL 已有）；密度三处并存；line 选项冲突
7. **已存在的数据复用**：weightKg/wallUsed/mcUsed/size 项目级共享；gating.G→yield→charge；riser.Vr→yield
8. **应建公共项目参数**：密度（唯一权威源）、造型线（统一语义）、铁水总重（由 yield 产出写回项目）
9. **最值得自动串联的 5 个数据关系**：① 密度统一 ② castability/ct 接 STL 尺寸壁厚 ③ gating 铸件高度 ph 由 bbox 建议 ④ riser 形状选择生效 ⑤ charge 铁水总重写回项目（用户可见）
10. **UI 重新设计最应该改变**：以"项目级参数中心"替代"每计算器手填"模式——STL 数据自动带出 + 标注可信等级（A/B/C/D）+ 只让用户输入真正的工艺决策参数；结果中心统一展示跨计算器输出（G/t/A、D/H/Vr、pourWt 等可互相引用的值）

## 15. 代码位置索引（关键）

- 计算器声明：calcs/calcManifest.js:31（CALC_MANIFEST）
- 计算器注册表：calcs/registry.js:7（CALCULATORS）
- 引擎：calcs/gating.js、riser.js、yield.js、chill.js、sandbox.js、charge.js、shakeout.js、machining.js、shrinkage.js、castability.js、ct.js
- 参数模型：js/model/CastingProject.js:32（defaultProject）
- 参数缺失判定/去重：calcs/calcManifest.js:261-294（paramValue/isMissing/allMissingInputs）
- 设计中心装配：js/views/designCenter.js（writeGeometryToProject:767、writeHotspotsToProject:672、renderParams:924、runAnalysis:1143）
- 独立视图：js/views/smallCalcs.js（renderCastability:414）、js/views/ctCalc.js:41（手填尺寸）、gatingView.js/riserView.js/shakeoutCalc.js/chargeCalc.js（旧版独立视图，与 manifest 共用引擎）
- 数据表：data/chill_calc.js、sandbox_calc.js、shakeout_calc.js、charge_calc.js、ct_calc.js
