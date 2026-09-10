# PHASE 29 PRE-FLIGHT AUDIT

> 日期：2026-08-27 ｜ 命令：41.txt 二 ｜ 性质：只读调查，0 代码修改
> 依据：PHASE28_1~28_4 四份报告 + ISSUE_TRACKER + PRIORITY + 引擎/视图源码精读

---

## 1. 当前工作区状态

- 非 git 仓库（命令文件驱动，无版本控制）
- 28.4 已交付：canonical 架构稳定，7 处确定性缺陷修复完成
- 本阶段涉及文件：`js/engine/`（v3 热结引擎/网格校验/适配层）、`js/views/designCenter.js`、`calcs/calcManifest.js`、`js/model/CastingProject.js`

## 2. 28.4 后测试基线

**全量 199/0 通过**（194 基线 + phase284 新增 5 项：RUN_ORDER 顺序/riserHeight 清理/Mc 用户优先/charge unsupported/defaultCharge 防护）

## 3. 13 个独立计算器独立性（28.4 审计结论 + 本阶段确认）

✅ 全部 13 个可脱离 STL/设计中心独立计算（独立视图自带全部输入）；本阶段任何修改不得破坏此边界（41.txt 一）。

## 4. STL 工艺设计中心完整数据流（现状）

```
importFile（designCenter.js:520-665）
 ├─ parseSTL → validateMesh（error 级阻断热结，warning 放行）
 ├─ analyzeGeometrySliced（体积/面积/壁厚统计）→ writeGeometryToProject（:790）
 │    体积→refreshWeight→netWeightKg/blankWeightKg；wallUsed/wallHot（28.4 加 USER_OVERRIDE 保护）
 ├─ analyzeHotspotsV3Sliced → toViewResult（samplingWarn 四级 + bodyRefOf）
 │    → writeHotspotsToProject（:677）
 │      OK      → hotspots.items + mcHotspot（有热结）+ wallHot 不写
 │      LOW_CONFIDENCE → status/reason/items（候选带 confidence）但 mcHotspot 保持 0 ← P1-35
 │      NO_HOTSPOT → status/reason + wallHot=主体壁厚/2 兜底 ← R1 兜底链
 │      INSUFFICIENT_RESOLUTION → status/reason，wallHot 仍会写（bodyRef 链）← R1 兜底链（失败也兜底）
 └─ renderParams/renderHotspotList/updateHsBadge
runAnalysis（:1188）RUN_ORDER=[shrinkage,machining,riser,gating,chill,yield,sandbox,charge,shakeout]（28.4 已修）
 └─ manifest calculate → results → resultsCenter/reportGenerator
```

## 5. 已确认遗留问题（PRIORITY.md A/B 类，本阶段范围）

| 项 | 问题 | 根因定位（本阶段精读确认） |
|---|---|---|
| P1-35 | LOW_CONFIDENCE → riser 静默未执行 | writeHotspotsToProject 仅 OK 分支写 mcHotspot（:679-690）；LOW_CONFIDENCE 时 items 非空（候选）→ riser calculate 走"有热结"分支 → mcHotspot=0 → `mc<=0 return null`（calcManifest riser）→ 结果页"该模块未执行"无原因 |
| R1 | 热结漏检→wallHot 兜底→冒口偏小 | ①uniform 快路径（hotspotV3.js:70-78：top2/top3≥0.85 且 prom<0.6 → NO_HOTSPOT）：相位噪声可推过阈值；②`!coarsePeaks.length` → NO_HOTSPOT（采样不足与真均匀不可区分——**"分析失败伪装成无热结"**）；③失败状态（INSUFFICIENT_RESOLUTION）仍写 wallHot（designCenter:709-712 无条件按 bodyRef 写）→ riser 用壁厚/2 正常计算 |
| R2 | 坏网格体积静默错误 | validateMesh 仅 error 级（NO_TRIANGLES/NON_FINITE_VERTEX）阻断热结；OPEN_MESH/DEGENERATE 为 warning 不阻断；geometry.valid 无条件写 true（designCenter:792）；computeVolume 有符号积分对开口/缠绕偏小（实测 33%）→ 全链污染 |
| R3 | 非 90° 旋转热结变化 | 轴对齐体素采样；现有旋转测试仅 90° 三轴（p15_rotation.mjs）；需要旋转样本验证 |
| P1-40 | optionalInputs 死声明 | allMissingInputs 只收 requiredInputs（calcManifest:302）；optional 设计中心永不渲染；calculate 硬编码 |
| P1-18 | machining method 键不匹配 | options ['砂型','金属型','熔模','压力'] vs METHOD_GRADES 键 '金属型（重力/低压）' 等——即使接线也永不消费 |
| P1-23 | shakeout 参数硬编码 | mode/heatTreat/risk/importance 全硬编码；'砂型' 不在 SHAKE_ADJUST.modes（流水线/地面）→ `?? 1` 静默 |
| P1-39 | machining 铜合金双路径 | manifest '铜合金'→'铝合金'（calcManifest:213）；独立视图 '铜合金'→'灰铸铁'（smallCalcs:159）——**口径选择属工程判断** |
| P0-3 | 密度取值 | 结构正确；liquidDensity 实际仅报告展示（gating 用内部 GATING_MATS 表）；solidDensity 供 refreshWeight；**取值铸钢 7.5/铝 2.6 液态待人工批准** |

## 6. 可确定修 vs 工程判断

**可确定修（41.txt 十允许范围）**：
- P1-35 状态透传：LOW_CONFIDENCE/INSUFFICIENT_RESOLUTION 不伪装（门禁）
- R1-② 无候选区分"真均匀"vs"采样不足"（需测试样本验证判定）
- R2 门禁：error 级阻止自动建议；OPEN_MESH 显著警示
- P1-40 机制：param 非 null 的 optional → 设计中心高级折叠区；param=null → 独立计算器入口（manifest 标注）
- P1-18 键名对齐 + 接线
- P1-23 键名对齐 + 接线（mode 消费）
- gating qty 死参数删除（calculate 不消费）

**涉及工程判断（只记录/标记）**：
- P1-39 铜合金近似口径（铝合金 or 灰铸铁）→ 需人工决策
- P0-3 密度取值 → 需人工批准
- R1-① uniform 阈值调优 → 不做（41.txt 禁止"简单把阈值改大/改小"）；改为状态可追溯（audit 已存在，透传展示）

## 7. 需先建立测试再修改

- **R3 旋转样本**：需要确认 tests/engineering-generated/gen_engineering.mjs 能否生成任意角度旋转 STL（现有 p15_rotation 90°）；建立旋转回归（原始/90°×3/30°/45°/随机）
- **R1 状态区分样本**：明确有热结（boss 凸台）/明确均匀（cube/plate）/临界（薄壁+厚块）
- **R2 坏网格样本**：开口立方体/缠绕翻转/退化——验证体积偏小 + 门禁触发
- 测试先于修改：先建 phase29_test.mjs 样本与断言 → 再改引擎/门禁

## 8. 共同根因（41.txt 十二：统一机制解决）

| 组 | 问题集合 | 统一机制 |
|---|---|---|
| **G1 状态门禁** | P1-35 + R1-②③ + R2 | "STL 质量/热结分析状态 → 自动工艺建议门禁"：hotspots.status+reason+audit 完整透传；INVALID/INSUFFICIENT_RESOLUTION/LOW_CONFIDENCE → 阻止或显著标记 riser/chill 自动执行 + 用户人工输入入口 |
| **G2 optional 生命周期** | P1-40 + P1-18 + P1-23 + qty 死参数 | optionalInputs 明确生命周期：param 非 null → 设计中心高级折叠区（声明→UI→project→calculate→提示）；param=null → 独立计算器入口（manifest 标注，设计中心不渲染） |
| **G3 密度口径** | P0-3（审计） | 不改值；审计结论 + liquidDensity 仅展示的事实记录 |

## 9. 本阶段实施计划（草案，按 41.txt 十二执行策略）

1. **测试先行**：phase29 样本生成（旋转/状态/坏网格）→ 锁定现状行为
2. **G1 门禁**：hotspots 状态透传 → riser/chill 计算器门禁（manifest 读 hotspots.status；非 OK 且无用户输入 → 返回带状态的结果而非静默 null）→ designCenter/resultsCenter 展示状态与原因 → 阻止自动建议或显著标记
3. **R2 质量检测**：meshValidation 输出增强（volume 可信度标记）→ designCenter 门禁（error 阻止自动建议；OPEN_MESH 显著警示 + 体积仅供参考标记）
4. **G2 optional 生命周期**：calcManifest optionalInputs 标注 scope → designCenter 高级折叠区渲染 param 非 null 项 → calculate 消费 → 键名对齐（machining/shakeout）→ qty 死参数移除
5. **P1-39/P0-3**：记录 + 标记（不自行决定）
6. 全量回归 + PHASE29_REPORT.md

## 10. 风险与边界（41.txt 十一 禁止事项对照）

- 不修改工程公式/企业参数/密度取值/阈值（uniform 0.85/0.6 保持，只透传状态）
- 不改计算器独立性（门禁在 manifest/designCenter 层，不动独立视图）
- 不大规模重构（引擎算法不动，只加状态/门禁）
- 测试锁真实执行路径（吸取 28.3-B-4 教训：测试必须跑生产代码实际顺序）
