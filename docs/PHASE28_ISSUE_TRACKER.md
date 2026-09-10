# PHASE 28 问题台账（Issue Tracker）

> 维护：PHASE 28.1（2026-08-26）
> 状态：FIXED（已修复）/ INVESTIGATING（调查中）/ CONFIRMED（已确认未修）/ DEFERRED（暂缓）
> 依据：PHASE 28 审计报告 + PHASE 28.1 调查（Excel 溯源/架构调查/Hp 专项，详见 `docs/PHASE28_1_REPORT.md`）
> 原审计全部问题保留，本阶段新增标记 ✨

---

## P0（必须保留并最终闭环）

| ID | 模块 | 问题 | 代码位置 | 证据 | 状态 | 修改方案 | 回归 |
|---|---|---|---|---|---|---|---|
| P0-1 | yield | **riserWt 单位错 1000 倍**：Vr(mm³)×rho/1000=g 标 kg（80000mm³×7.0 显示 560kg，应为 0.56kg） | calcManifest.js:141（旧） | PHASE28 实测验证 | **FIXED** | /1000→/1e6；同步修 phase16c_test 断言；新增 phase28_test 量纲锁定 | ✓ 全量 170/0 |
| P0-2 | gating | **中注 Hp 公式与 Excel/文献均不等价**（rh 恒 0 → P 项 1.5C；Excel 原式为 C/2+冒口高；文献 C/2） | gating.js:69 | PHASE28_1_REPORT.md §三（Excel K7 原文比对+数学证明） | **FIXED**（PHASE 28.3-B 方案 A：中注 (Pv+rh)²/2C，真实案例 270.6/153.9/240.0 + 无冒口 320.5 锁定） | 方案 A 实施 + riserHeight 接线（riser 回写→gating 读取）+ 回归 | ✓ 全量 194/0 |
| P0-3 | 全局 | **密度液态/固态混一**：gating 应液态（铸钢 7.5 应 7.0-7.2、铝 2.6 应 2.4）、riser 应固态（球铁 6.9 应 7.1）；三处并存 | gating.js MATERIALS / riser.js RISER_MATERIALS / CastingProject | PHASE28 §8；Excel F13 注释"液态金属密度" | **FIXED**（PHASE 28.7-A 44.txt **人工批准定稿**：solidDensity 球铁 6.9→7.1、铝 2.6→2.7 已改，灰铁 7.0/铸钢 7.8/铜 8.4 保持；liquidDensity 全部保持企业值——球铁 6.9/铝 2.6/铸钢 7.5 等不修改。28.6 接线修复保持：USER_OVERRIDE 覆盖 + mdFellBack） | 双密度结构已实施；液态表=企业 Excel F13 批准保留；固态表=人工批准定稿值；详见 PHASE28_7-A 汇报 | ✓ |
| P0-4 | gating/yield | **pw=STL 净重与出品率口径错位**（净重无余量 vs 出品率表按含余量毛坯）；Excel 另有 -2.5% 损耗修正 | gating.js:109 | PHASE28 §7；Excel 浇注系统尺寸计算 R6/6A R13 | **CONFIRMED**（PHASE 28.3-A 语义拆分完成；**自动余量加成待定**） | weightKg 已拆 netWeightKg（STL 净重）/blankWeightKg（毛坯，计算统一口径）；净重→毛坯自动换算无可靠系数，不猜测（等真实案例） | 部分 |

## P1（进入后续修改清单）

| ID | 模块 | 问题 | 代码位置 | 状态 |
|---|---|---|---|---|
| P1-1 | gating | Dietert 变体来源——**已确认为 Excel 企业公式**（K11 同构），从"未确认"升级为 C 级；保留并标注；另补企业查表体系（快/慢浇） | gating.js:63 | **CONFIRMED**（来源调查完成） |
| P1-2 | gating | fv 0.8/0.6/0.45 来源=Excel ✓（升级 C 级）；但超文献上限（0.75）且**"有过滤网降低 0.1"缺失** | gating.js:117 / 参数运算表 | **CONFIRMED** |
| P1-3 | gating | 开放式/封闭式共用同一奥赞模型（fv/Hp 语义未分流） | gating.js:74 | **CONFIRMED** |
| P1-4 | gating | 内浇口流速 1.8 m/s——**企业标准：封闭≤1.5/开放≤1.0**（无缺陷审核 R7），代码偏松（开放差 80%） | gating.js:158 | **FIXED**（PHASE 28.3-C：V_LIMIT 分级 + UI 标注"企业经验标准"，测试锁定） |
| P1-5 | gating | 中注 Hp：调查完成，修复待人工批准（P0-2 关联） | gating.js:69 | CONFIRMED（见 P0-2） |
| P1-6 | gating | 底注 Hp 的 Ho≈C 隐式假设需明确（实测 A 差 ≤7%） | gating.js:70 | **CONFIRMED** |
| P1-7 | gating | 液面上升速度 vL=C/t 校核缺失（大平面件冷隔风险） | gating.js | **PARTIAL**（PHASE 28.3-C：vL=ph/t 计算接口已建+展示，下限标准无企业表未判定） |
| P1-8 | riser | 球铁冒口未区分工艺（共晶膨胀自补缩，f 可降 1.05-1.1 或无冒口提示） | riser.js:85 | **CONFIRMED** |
| P1-9 | riser | 热结区域体积未用于体积校核（用整件体积） | riser.js:100-101 | **CONFIRMED** |
| P1-10 | riser/chill | mcUsed 双语义（热结模数 vs 冷铁 T 来源）需拆分 T_hot | calcManifest.js:161 | **FIXED**（PHASE 28.3-A：mcHotspot/wallHot + 独立 process.chillT；chill 默认 2×模数数值不变） |
| P1-11 | riser | 冒口形状 sphere_head 硬编码（选择声明不生效） | calcManifest.js:112 | CONFIRMED（未在本阶段范围） |
| P1-12 | riser | hd_ratio=1.0 硬编码 | calcManifest.js:112 | CONFIRMED（未在本阶段范围） |
| P1-13 | STL | validateMesh 不查开口/法向错/自交/非流形（体积可错无检测） | PHASE 20 遗留 | **PARTIAL**（PHASE 28.5 开口/非流形/缠绕；PHASE 28.6 自交穿越检测完成（SELF_INTERSECTION 独立 code+UNCHECKED 截断保护）；**剩余=共面重叠检测**） |
| P1-14 | STL | 热结非 90° 旋转退化（漏报→mcUsed 回退→冒口不足，方向不安全） | 引擎 | **CONFIRMED**（PHASE 25） |
| P1-15 | STL | 热结漏报后的安全性需重点处理（与 14 关联） | 引擎 | **CONFIRMED** |
| P1-16 | chill | 有热结时 T=2×mcUsed 物理语义错误（圆柱热结 T=D 而非 D/2） | calcManifest.js:161 | CONFIRMED（独立 T_hot 已建（P1-17 FIXED）；T=2×热结 M 的近似保留，圆柱热结修正需形状识别→后续） |
| P1-17 | chill | 需独立 T_hot（与 P1-10 同源） | — | **FIXED**（PHASE 28.3-A：process.chillT 独立，默认 2×模数自动派生） |
| P1-18 | machining | method 声明了但 calculate 硬编码"砂型·机器造型" | calcManifest.js:203 | **CONFIRMED** |
| P1-19 | sandbox | 企业规范"重量"语义（铸件重 vs 砂型重）待核对——**Excel 无 3D 砂型表（该规范独立于本 Excel），维持待核对** | calcManifest.js:181 | **CONFIRMED** |
| P1-20 | charge | 铸钢/铝/铜静默 null（CHARGE_TARGETS 无 ZG230/ZL104/ZCuSn10P1） | calcManifest.js:227 | **CONFIRMED** |
| P1-21 | charge | 材料不支持时须明确提示而非静默失败 | 同上 | **CONFIRMED** |
| P1-22 | shakeout | COOL_SMALL 冷却时间表不分材质（铝件高估 2-4 倍） | data/shakeout_calc.js:25 | **CONFIRMED** |
| P1-23 | shakeout | mode/heatTreat/risk/importance 声明存在但 calculate 硬编码（流水线 0.65 等死代码） | calcManifest.js:254 | **CONFIRMED** |
| P1-24 | castability | 应接入 STL 尺寸/壁厚（现手填） | smallCalcs.js | **CONFIRMED** |
| P1-25 | ct | 应接入 STL 尺寸 | ctCalc.js | **CONFIRMED** |
| P1-26 | castability | JB/T 5105 起模斜度数值需人工核对 | castability.js:80-83 | **DEFERRED**（需标准原文） |
| P1-27 ✨ | gating | 过滤网过流量校核缺失（企业标准表存在：碳化硅 100×100 灰铁 400/球铁 200kg 等） | gating.js | **FIXED**（PHASE 28.3-D：过滤网折叠校核区 + 9 规格企业表 + 自动推荐（仅建议）；成本数据未引入） |
| P1-30 ✨ | designCenter | **执行顺序缺陷：RUN_ORDER gating 先于 riser → riser 回写 riserHeight 后 gating 不重算 → 首轮 Hp 恒用 rh=0**（中注 Hp 偏大→A 偏小 ~31%，真实案例 320.5 vs 153.9） | designCenter.js:53 | **FIXED**（PHASE 28.4：riser 前置 gating；RUN_ORDER 迁至 calcManifest 导出可测试） |
| P1-31 ✨ | riser | **无热结时 Mc 输入无效**：manifest 必填 mcHotspot，但 calculate 无热结时读 wallHot → 用户填写被静默忽略 | calcManifest.js:113 | **FIXED**（PHASE 28.4：无热结时用户显式 mcHotspot（USER_OVERRIDE/USER_INPUT）优先） |
| P1-32 ✨ | gating | **流速标注 ≤1.8 残留**：resultsCenter/reportGenerator/wizard 硬编码，与 v_ok 新标准（封闭1.5/开放1.0）自相矛盾 | resultsCenter.js:36 等 | **FIXED**（PHASE 28.4：改动态 `${rd.type}式≤${vLimit}`） |
| P1-33 ✨ | CastingProject | **riserHeight 未纳入 clearStlBoundData**：替换 STL 后旧模型冒口高残留 → 新模型只跑 gating 时 Hp 用旧值 | CastingProject.js:299 | **FIXED**（PHASE 28.4：clearIfNotUserInput 清理，USER_INPUT 保留） |
| P1-34 ✨ | designCenter | **writeGeometryToProject 无 USER_OVERRIDE 保护**：单位切换重跑 → 用户改过的 wallUsed/wallHot 被静默还原（P2-13 具体路径） | designCenter.js:806 | **FIXED**（PHASE 28.4：与 writeHotspotsToProject 同模式保护） |
| P1-35 ✨ | riser/chill | LOW_CONFIDENCE 有候选但 mcHotspot 未写（0）→ riser Mc≤0 返回 null → 模块静默"未执行"，无原因提示 | designCenter.js:688 | **FIXED**（PHASE 29：riser/chill 门禁——状态矩阵：用户 Mc 放行/INSUFFICIENT_RESOLUTION blocked/LOW_CONFIDENCE blocked/NO_HOTSPOT wallHot+note；结果区显示原因+人工输入指引） |
| P1-36 ✨ | STL | **热结漏检→wallHot 兜底→冒口偏小链**（Vr∝Mc³ 可达数百倍；modOk 自洽通过；并传导 gating Hp） | hotspotV3.js:70-78 / calcManifest.js:113 | **FIXED 主体**（PHASE 29 门禁五态区分：INSUFFICIENT 绝不 wallHot、LOW_CONFIDENCE blocked、NO_HOTSPOT 才 wallHot+note；PHASE 28.5-T4 再次锁定：blocked 无正常冒口字段。漏检本身（非对称斜置）残留——状态可追溯） |
| P1-37 ✨ | STL | **坏网格体积静默错误**（开口/缠绕实测偏小 33%；validateMesh 只查数量类；geometry.valid 无条件 true） | stl.js:93-104 / meshValidation.js | **FIXED 主体**（PHASE 29 valid 真实化+门禁；PHASE 28.5 新增 NON_MANIFOLD_EDGE/INCONSISTENT_WINDING 确定性检测 + deriveGeomStatus 三态 + geometry.geomStatus 结构化字段；真实 STL 抽样 10/19 带真实瑕疵已可标注） |
| P1-38 ✨ | STL | 非 90° 任意朝向热结漏检（轴对齐体素采样×朝向耦合；uniform 快路径误判） | hotspotV3.js / sampling.js | **FIXED 主体**（PHASE 29 单峰均匀件判据修 45° 误报；PHASE 28.5 测试补齐 0°/15°/30°/45° 全过——主要热结不消失、均匀件不误报；非对称斜置漏检残留=已知限制记录） |
| P1-39 ✨ | machining | 铜合金两路径口径不一致：manifest 按铝合金（压力 B~D）vs 独立视图按灰铸铁（"无标准"） | calcManifest.js:213 / smallCalcs.js:159 | **CONFIRMED**（需人工判断铜合金近似口径） |
| P1-40 ✨ | manifest | **optionalInputs 死声明机制**：allMissingInputs 只收 requiredInputs → 设计中心所有 optional（riser shape/hd、chill type/chillT、shakeout mode/importance 等）永不渲染，calculate 硬编码 | calcManifest.js:302 | **FIXED**（PHASE 29：生命周期机制——param 非 null → 设计中心高级折叠区（始终可调）；param=null（scope:calculator）→ 独立计算器入口；gating qty 死参数删除） |
| P1-28 ✨ | gating | 排气校核缺上限（企业：4S阻＞出气＞1.5S阻，代码只有 ≥1.5） | gating.js:165 | **CONFIRMED** |
| P1-29 ✨ | yield | 出品率表（60-75）vs 企业标准（灰铁≥76.1-77.7/球铁≥75.6-75.9）**偏低 10+ 个百分点**；-2.5% 损耗修正缺失 | yield.js | **CONFIRMED**（Excel 标准成本/6A/无缺陷） |

## P2（以后优化，原审计全部保留）

| ID | 模块 | 问题 | 状态 |
|---|---|---|---|
| P2-1 | riser | 体积校核漏冒口自身收缩 εv·Vr（文献 εv(V件+V冒)≤ηV冒） | DEFERRED |
| P2-2 | riser | eff_sph=25% 高于文献球形 15~20% | DEFERRED |
| P2-3 | gating | 内浇道流速未分材料（铝应更低）——**已被 P1-4 企业标准覆盖** | 并入 P1-4 |
| P2-4 | gating | 液面上升速度校核（已列 P1-7，此处为实施细节） | 并入 P1-7 |
| P2-5 | yield | runnerWt 与 riserWt 概念重叠（浇道重/冒口重未拆分；runnerWt 实为浇冒口总重） | DEFERRED |
| P2-6 | yield | 无 gating 时 pourWt 默认出品率 70 不分材料 | DEFERRED |
| P2-7 | machining | 球铁→灰铁/铜→铝映射无 UI 提示（实际影响小） | DEFERRED |
| P2-8 | chill | 系数表与《铸造手册》交叉核对（可锻铸铁 1.0 存疑） | DEFERRED |
| P2-9 | shakeout | 壁厚超档仅警告（+30% 提示无自动修正） | DEFERRED |
| P2-10 | charge | P/S 超差无调整手段提示 | DEFERRED |
| P2-11 | castability | JB/T 5105 数值核对（与 P1-26 同源） | DEFERRED |
| P2-12 | shakeout | 开箱温度"易裂 800~900℃"特例补文献依据 | DEFERRED |
| P2-13 | 全局 | 单位切换时自动参数覆盖（PHASE 26 P3） | DEFERRED |
| P2-14 ✨ | gating | Hb 表来源标注（Excel F10 注释确认：1T-30/3T-50/8T-75/20T-110/40T-110 cm ✓） | CONFIRMED（来源已确认，仅需标注） |
| P2-15 ✨ | 全局 | 企业查表体系（浇注时间快/慢浇、交叉结构模数系数、分型负数表、浇注温度推荐）——引入候选，见 Excel 知识审计 §9 | **PARTIAL**（PHASE 28.3-E/F：浇注时间查表（快浇+有/无冒口）与浇注温度推荐已进入产品；慢浇表/交叉模数/分型负数仍 Future Candidate） |
| P2-16 ✨ | charge | 企业牌号扩展（HT275/QT400-18AL 等 20+ 牌号） | DEFERRED |
| P2-17 ✨ | resultsCenter | charge 渲染引用不存在字段（ch.finalCE/ceOk → "—"）；sugs 对象数组 String() → "[object Object]" | resultsCenter.js:134/138、reportGenerator.js:79-80 | **FIXED**（PHASE 28.4：目标 CE + 原铁液 CE 展示；补料建议 `label +kg` 渲染；unsupported 分支显示提示） |
| P2-18 ✨ | shakeout | SHAKE_TEMP[mat] 无兜底（未知键 TypeError）；当前两入口受白名单保护暂无触发路径 | shakeout.js:64 | CONFIRMED（防御性，低优先） |

## 本阶段修改范围（Bug 修复报告）

| 文件 | 修改 | 类型 |
|---|---|---|
| `calcs/calcManifest.js:141` | riserWt：`Vr*rho/1000` → `Vr*rho/1e6`（g→kg）+ 量纲注释 | 确定性 Bug（P0-1） |
| `tests/phase16c_test.mjs:82` | 断言期望值 `80000*7.0/1000` → `80000*7.0/1e6`（0.56kg）+ 说明 | 同步修正（原断言锁定错误行为） |
| `tests/phase28_test.mjs`（新增） | 28-1 量纲锁定（0.56kg 非 560）+ 28-2 Vr/riserWt 一致性 | 新增回归 |

**为什么确定是 Bug**：量纲推导 Vr(mm³)×rho(g/cm³)=Vr×rho/1000 (g)；UI 标 kg → 1000 倍。实测 80000mm³×7.0=560（g）≠0.56（kg）。与同屏"冒口体积 Vr/1000 cm³"（换算正确）自相矛盾。
**影响检查**：riserWt 消费方=resultsCenter.js:71、reportGenerator.js:69（展示层无额外换算）——修复后显示正确；riser 视图/向导的 Vr 展示（/1000 cm³）不涉及 riserWt，无影响；全量测试 170/0 通过。
**全项目同类搜索**：`Vr×rho` 仅 calcManifest.js:141 一处；`/1000` 的其他用途（Vr 显示/单位换算）均正确。

## 修订历史
- 2026-08-26 PHASE 28.1：P0-1 FIXED；P0-2 调查完成（CONFIRMED，修复待批准）；P1-1/2/4 来源确认升级；新增 P1-27/28/29、P2-14/15/16（Excel 溯源发现）
- 2026-08-26 PHASE 28.2：问题四分类（A 必修 8 项 / B 加入能力 3 项 / C 保留建接口 9 项 / D 知识库 12 项，见 `docs/PHASE28_2_ARCHITECTURE_DECISION.md` §2）；P0-2 方案 A 真实案例验证完成（100% 复现 Excel，**待人工批准**）；P1-4 流速标准（封闭≤1.5/开放≤1.0）待人工批准；P1-29 出品率校准降级为 C 类（样本不足）；新增知识库 `docs/knowledge/excel_audit.md`（Future Candidate）
- 2026-08-27 PHASE 28.3（39.txt）：P0-2 **FIXED**（方案 A，真实案例锁定）；P1-4 **FIXED**（企业流速标准）；P1-10/17 **FIXED**（mcHotspot/wallHot + 独立 chillT）；P1-27 **FIXED**（过滤网校核）；P1-7 **PARTIAL**（vL 接口已建）；P0-3/P0-4 **PARTIAL**（canonical 结构已拆，取值/换算待批准）；P2-15 **PARTIAL**（浇注时间查表+浇注温度已引入）；chill 材质键映射修复（灰铁→灰铸铁，既有静默失败）；新增 process.Ho/ph 字段（既有静默失败）；全量 194/0。详见 `docs/PHASE28_3_REPORT.md`
- 2026-08-27 PHASE 28.4（40.txt）：验收+审计。**FIXED**：P1-30（RUN_ORDER riser 前置 gating）、P1-31（无热结 Mc 输入生效）、P1-32（流速标注动态化）、P1-33（riserHeight 纳入 STL 清理）、P1-34（wallUsed/wallHot USER_OVERRIDE 保护）、P1-20/21 **PARTIAL→FIXED 主体**（charge 不支持牌号明确提示，不静默）、P2-17（charge 渲染 bug）。**CONFIRMED 新增**：P1-35~40、P2-18（含 STL 三高风险管理 R1-3 与 13 计算器独立性审计结论）。P0-3/P0-4 维持 PARTIAL（取值/换算仍待人工批准）。28.3 六个阶段能力（canonical/Hp 方案 A/流速/过滤网/查表/温度）**验收通过**；28.3 引入 4 处接线缺陷全部修复（P1-30~33）。全量 199/0。详见 `docs/PHASE28_4_ACCEPTANCE_REPORT.md`
- 2026-08-27 PHASE 29（41.txt）：V1 可靠性升级。**FIXED**：P1-35（riser/chill 门禁：LOW_CONFIDENCE/INSUFFICIENT_RESOLUTION 不再静默——blocked+原因+人工输入入口；INSUFFICIENT 绝不 wallHot 兜底）、P1-40（optionalInputs 生命周期：高级折叠区 + scope:calculator 机制）、P1-18（machining method 键对齐+接线+熔模明确提示）、P1-23（shakeout mode/importance 归独立计算器）、gating qty 死参数删除。**R2**：geometry.valid 真实化 + runAnalysis 门禁（INVALID 阻止/OPEN_MESH 警示）。**R3**：单峰均匀件判据（45° 斜置立方体误报修复，14.txt 全过）。P0-3/P1-39 记录不改（工程判断）。全量 208/0（+9）。详见 `docs/PHASE29_REPORT.md`、`docs/PHASE29_PREFLIGHT.md`
- 2026-08-27 PHASE 28.5（42.txt）：STL 可靠性闸门。**FIXED**：P1-36 主体（R1 热结漏检链——五态严格区分+门禁，29 完成、28.5 以 28.5-T4 再次锁定）、P1-37 主体（R2 坏网格——validateMesh 新增 NON_MANIFOLD_EDGE/INCONSISTENT_WINDING 确定性检测 + deriveGeomStatus 三态 + geometry.geomStatus 字段；真实 STL 抽样 10/19 带真实瑕疵已可标注）、P1-38（R3——15° 测试补齐 0/15/30/45° 全过，29 单峰判据保持）。**新增能力**：reliabilityLevel 三等级（SAFE_TO_RECOMMEND/WARNING_REVIEW/BLOCK_AUTO_RECOMMEND）+ riser/chill level 标注；UI 文案拆分（"未检出"vs"分析失败"不再共用语义——42.txt 十一）；reportGenerator 网格校验状态行。P1-13 主体（缠绕/非流形已检测；自交未覆盖——见 §12）。P0-3/P1-39 维持待人工。全量 219/0（+11）。结论 **PASS（附条件）**。详见 `docs/PHASE28_5_ACCEPTANCE_REPORT.md`
- 2026-08-27 PHASE 28.6（43.txt）：工程参数定稿 + 真实验证 + 自交检测。**FIXED**：P1-13 主体（SELF_INTERSECTION 确定性检测：分箱加速+MT+邻接排除+截断保护 UNCHECKED；7 场景+真实 STL 全过）、新发现 2 项（liquidDensity 零消费静默脱节→USER_OVERRIDE 密度接线；未知材料静默 fallback→mdFellBack 标记——数值零变化）。**R1 CONDITIONAL CLOSE**（ALR2510 真实热结件 0/15/30/45° 热结不消失、主 Mc 漂移 ≤17%、位置回旋 <2mm；cube50 均匀件零误报；**新记录**：次级热结位置旋转漂移 30-60mm）。**P0-3 PARTIAL**（审计完成：两表全值+消费者+来源；待批清单 5 项——铸钢液态 7.5/铝液态 2.6/球铁固态 6.9/铝固态 2.6/铜固态 8.4，数值未改）。全量 233/0（+14）。详见 `docs/PHASE28_6_ACCEPTANCE_REPORT.md`（含附录：后续优先级）
- 2026-08-27 PHASE 28.7-A（44.txt）：**P0-3 人工批准定稿**。solidDensity：球铁 6.9→7.1、铝 2.6→2.7（riser.js RISER_MATERIALS）；灰铁 7.0/铸钢 7.8/铜 8.4 保持。liquidDensity：全部保持（企业工艺参数，gating.js 未动）。28.6-A4 fallback 断言同步 6.9→7.1；smoke_manifest 同步。新增 phase287a_test 7 项（两表五材料/重量链/gating 液态/riser 固态/USER_OVERRIDE/mdFellBack）。全量 240/0（+7）。**28 系列遗留人工项全部清零**
