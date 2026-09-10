# Hotspot Engine V2.1 设计文档

> 状态：**设计稿（V2.1）**，未实施。待确认后编码。
> 定位：轻量级铸造工艺辅助工具的**几何热节倾向分析**（Hotspot / Modulus Analysis）。
> 不是 MAGMA / ProCAST，不声称"精确预测凝固热结"；目标是**稳定、快速、可解释、可重复**地指出"哪里最值得铸造工程师关注"。

---

## 0. 核心原则（V2.1 修订）

1. **五级流水线严格分层**：Coarse Scan → Candidate Detection → Local Refinement → Hotspot Evaluation → Final Hotspot。每一级产出下一级的输入，判据只在所属层级生效。
2. **Candidate ≠ Hotspot**：`median × 1.3` 只回答"这个区域值得进一步检查吗？"，不回答"这就是热结"。最终热结由 Hotspot Evaluation 层判定。
3. **热结 ≠ 最大壁厚**：热结是**相对周围的显著厚区/质量集中**（相对显著性为核心），均匀模型（无相对变化）不是热结。
4. **全部阈值参数化**，集中在 `hotspotConfig`（单文件），未来用真实铸件数据校准，不散落、不写死。
5. **Confidence 可分解**：保存 resolutionScore / prominenceScore / validationScore 三个原始分项，综合 confidence 由它们计算——"过于保守"或"假热点多"时可定位到具体因子。
6. **保留原始审计数据**：每个候选的 peak/valley/合并/分裂/拒绝原因全部保留，DEBUG 可见，杜绝"这个热结为什么没有了"。
7. **架构不变**：Geometry Engine → Hotspot Engine → HotspotResult → Viewer → UI。引擎不碰 DOM，UI 不重算，Viewer 只显示。

---

## 1. 当前算法问题回顾（V2 依据）

| # | 问题 | 证据 |
|---|---|---|
| P1 | vs = 主尺寸/48 一刀切，薄壁大件 vs=8.33mm > 壁厚 8mm | thinShell：`gs=48, vs=8.33, INSUFFICIENT_RESOLUTION` |
| P2 | 升档判据用 bbox 最小边，真实铸件"最小 bbox 边 ≠ 最薄壁厚"→ 升档不触发 | `minDim < (mdim/gs)×6` 对 400×200×100 不成立 |
| P3 | 全模型统一 vs + 全局拒绝：只有局部厚区也被整体拒绝 | thinShell 3704 个内部点半壁厚≈4mm，无候选机会 |
| P4 | NO_HOTSPOT 与"无法分析"混用一个枚举 | UI 只显示"未检出热结（壁厚均匀或过薄时属正常）" |
| P5 | 结果缺 confidence / localThickness / resolution / reason，不可解释 | 命令文件第七节要求 |
| P6 | **均匀模型报假热结**：cube50（均匀实心）检出 1 个 Mc≈25——均匀件无相对厚区，不应报 | cube50 现有测试断言"检出 1 个热结" |

**P6 是 V2.1 的行为变更**：均匀模型（cube / uniform plate / uniform cylinder / uniform thin shell）→ `NO_HOTSPOT`（无显著相对厚区）。现有测试与 E2E 断言需同步更新（见 §9）。

---

## 2. 五级流水线（V2.1 核心）

```
┌──────────────────────────────────────────────────────────────┐
│ ① Coarse Scan        全局均匀网格 gs=48³，内部点 + 半壁厚距离    │
│                       产出：全部内部点 {pos, dist} + 全局统计    │
│                       （median / max / 内部点计数）              │
├──────────────────────────────────────────────────────────────┤
│ ② Candidate Detection   "值得检查吗？"（不是"是热结"）           │
│                       判据：26 邻域局部极大 + NMS(2 体素)       │
│                            + peak ≥ median × CANDIDATE_RATIO  │
│                       产出：候选区域列表（coarse 级）            │
├──────────────────────────────────────────────────────────────┤
│ ③ Local Refinement   只对候选区域 bbox 做高分辨率重采样          │
│                       vs_refine 由区域壁厚自适应（§5）           │
│                       产出：区域精确 peak / valley / 壁厚       │
├──────────────────────────────────────────────────────────────┤
│ ④ Hotspot Evaluation   "是热结吗？"（最终判据）                 │
│                       Peak-Valley-Peak 合并/分裂（§6）          │
│                       三因子 confidence 计算（§7）              │
│                       产出：区域级热结候选 + 完整审计记录          │
├──────────────────────────────────────────────────────────────┤
│ ⑤ Final Hotspot        confidence ≥ CONFIDENCE_THRESHOLD      │
│                        → OK + Hotspot 列表                     │
│                        有候选但不达标 → LOW_CONFIDENCE          │
│                        无候选 → NO_HOTSPOT                     │
│                        无内部点/解析极限 → INSUFFICIENT_RESOLUTION│
└──────────────────────────────────────────────────────────────┘
```

---

## 3. hotspotConfig（全部参数，单文件 `js/engine/hotspotConfig.js`）

```js
export const hotspotConfig = {
  /* ---- Coarse Scan ---- */
  coarseResolution: 48,            // 主维度体素数（现状）
  maxCoarseResolution: 96,         // bbox 最小边升档上限（保留，但不再依赖它救薄壁）
  minWallLayersForUpscale: 6,      // 升档触发：最小边 < (mdim/gs)×6

  /* ---- Candidate Detection ---- */
  CANDIDATE_RATIO: 1.3,            // 候选门槛：peak ≥ median × 此值（只负责"值得检查吗"）
  candidateNMS: 2,                 // 非极大抑制邻域（体素）
  minRegionVoxels: 4,              // 候选区域最小体素数（低于 → 低置信）

  /* ---- Local Refinement ---- */
  MIN_VOXEL_SIZE: 0.5,             // vs_refine 下限（mm）
  TARGET_VOXELS_ACROSS_THICKNESS: 6, // 壁厚目标体素层数（默认工程参数，可调）
  MAX_REFINEMENT_POINTS: 50000,    // 单区域细化点上限（超限 → 该区域降级 LOW_CONFIDENCE）
  MAX_REFINEMENT_REGIONS: 5,       // 细化区域数上限（超限 → 后续候选降级）
  refinePaddingVoxels: 2,          // 区域 bbox 外扩（粗扫体素数）

  /* ---- PVP 合并/分裂 ---- */
  valleyDepthRatio: 0.15,          // 谷深比阈值（§6，初始值，测试校准）
  minPeakGap: 2,                   // 区域内峰间距下限（体素）

  /* ---- Evaluation ---- */
  MIN_PROMINENCE_RATIO: 1.3,       // 最终热结的最小显著度（粗扫 median 基准）
  CONFIDENCE_THRESHOLD: 0.5,       // 最终热结置信度门槛
  confWeights: { resolution: 0.4, prominence: 0.4, validation: 0.2 },  // 三因子权重

  /* ---- 输出 ---- */
  maxHotspots: 5,
};
```

所有"工程参数"（6 层、1.3、0.15、0.5）都是**默认值**，写在配置里，未来用真实铸件校准——**不写死在算法代码中**。

---

## 4. Coarse Scan（复用现状）

- 复用 `buildDistanceField`（gs=48 全局网格）：扫描线判内外（3×gs² 射线）+ 内部点 BVH 距离（半壁厚语义）。
- **关键保留**：即使 vs > 壁厚，内部点距离依然有效（thinShell 实测：3704 内部点 dist≈4mm 全有效）——粗扫只是采样稀疏，不是失效。
- **删除**：`globalMax < vs×1.5 → 全模型拒绝`（P3 根因）。分辨率判定下放到区域级。
- 产出：内部点 + dist + 全局 median/max + coarseRes。

**性能**：粗扫 = 现状全部分析耗时（0.3~0.4s @21 万面），无增加。

---

## 5. Local Refinement

对每个候选区域（上限 MAX_REFINEMENT_REGIONS=5）：

```
bbox = regionBBox + refinePaddingVoxels × vs_coarse
vs_refine = clamp( 2 × d_peak / TARGET_VOXELS_ACROSS_THICKNESS,
                   MIN_VOXEL_SIZE,
                   vs_coarse / 2 )
局部重跑 scanInside + distanceToSurface（复用 buildDistanceField，仅 bounds/gs 参数化）
```

示例（400×200×100 壁 8 + 100×100×60 凸台）：
- 粗扫 d_peak ≈ 30mm → vs_refine = clamp(60/6=10, 0.5, 4.16) = **4.16mm**
- 凸台 bbox 120³ → 29³ ≈ 2.4 万点 < MAX_REFINEMENT_POINTS ✓
- 半壁厚 30mm ≥ 6×4.16=25mm → 分辨率充足 ✓

**计算量控制**：
- 单区域 ≤ 50k 点，超限 → 该区域**降级 LOW_CONFIDENCE**（宁缺毋滥，不做全模型细化）
- 区域数 ≤ 5，超限 → 后续候选降级
- 总增量：粗扫 11 万点 + 细化 ≤5×5 万点，内存 <10MB

---

## 6. Peak-Valley-Peak 合并/分裂（明确原则）

**不用固定距离**（`<20mm 合并` 这种规则不作主要规则）。用**谷深比**（相对量，跨模型尺度有效）：

```
valleyDepthRatio = (min(peakA, peakB) − valley) / min(peakA, peakB)

valley = 两峰间沿区域内部路径的最小 score（现有 minGapOnPath 复用）

判定（阈值 = hotspotConfig.valleyDepthRatio，初始 0.15）：
  valleyDepthRatio ≥ 阈值 → 存在明显谷值 → 分裂，保留两个独立 Hotspot
  valleyDepthRatio <  阈值 → 无显著谷值   → 合并为一个 Region
```

| 案例 | Peak A | Valley | Peak B | 谷深比 | 结果 |
|---|---|---|---|---|---|
| A（应分开） | 30 | 18 | 28 | (28−18)/28 = **0.36** | 两个 Hotspot ✓ |
| B（应合并） | 30 | 28 | 29 | (29−28)/29 = **0.03** | 一个 Region ✓ |

现有 `valleyRatio`（谷值 ≥ 两峰均值×0.6）参数废弃，替换为上述 PVP 规则（语义更清晰、可解释）。

---

## 7. Confidence 三因子（可分解、可解释）

```
resolutionScore  —— 分辨率充足度（壁厚 vs 细化体素）
    d_peak ≥ TARGET_VOXELS_ACROSS_THICKNESS × vs_refine → 1.0
    线性下降到 < 3 层 → 0.3

prominenceScore  —— 相对显著度（相对全局，非绝对厚度）
    d_peak / median = 1.3 → 0.6；≥ 2.0 → 1.0（线性映射，低于 1.3 不产生候选）

validationScore  —— 校验（inside 终检 + 区域完整性）
    inside 通过 1.0；区域 < minRegionVoxels 0.5；否则 0

confidence = confWeights.resolution × resolutionScore
           + confWeights.prominence × prominenceScore
           + confWeights.validation × validationScore
```

**三个分项必须单独保存在结果里**。未来真实铸件测试发现"过于保守"或"假热点太多"→ 看分项定位（如 resolutionScore 普遍低 = 细化策略问题；prominenceScore 普遍低 = 显著度阈值问题）。

---

## 8. 状态枚举与 HotspotResult

### 状态（V2.1，区分"没有"与"无法分析"）

| 状态 | 含义 | 触发 |
|---|---|---|
| `OK` | 至少一个热结 confidence ≥ 阈值 | Evaluation 层 |
| `LOW_CONFIDENCE` | 有候选但无一达标（分辨率/显著度/校验不足） | 候选存在，全部 < 阈值 |
| `NO_HOTSPOT` | 分析分辨率足够，但**无相对显著候选** | 均匀模型 / 无候选 |
| `INSUFFICIENT_RESOLUTION` | **无法可靠分析**：无内部点（壁 < 采样极限）或细化后仍解析不了 | 采样层 |
| `NO_SIGNIFICANT_HOTSPOT` | （= NO_HOTSPOT 的别名语义，UI 文案区分即可） | 同 NO_HOTSPOT |

### HotspotResult 数据（每个热结）

```js
{
  id, x, y, z,                    // center（原始坐标）
  mc,                             // 热节模数（refineMc 亚体素精化）
  score,                          // 细化后峰值距离（mm）
  confidence,                     // 综合（0~1）
  resolutionScore, prominenceScore, validationScore,   // 三因子分项
  localThickness,                 // 2×refined（mm）
  regionVolumeCm3,
  resolution,                     // vs_refine（mm）
  reason,                         // 'local mass concentration + thick region' 等（枚举文案）
  regionBBox, peaks,              // 现有
}
```

### DEBUG 审计（结果对象附带，UI 不显示 / hsDebug 模式输出）

```js
audit: [{
  candidateId,                    // 候选编号
  coarsePeak, coarseValley,       // 粗扫峰值/谷值（mm）
  regionVolumeCm3,
  localThickness,                 // 细化后
  coarseRes, refineRes,           // vs_coarse / vs_refine
  merged: 'into #2 (valleyDepth 0.03 < 0.15)',   // 合并原因
  split:  'from #1 (valleyDepth 0.36 ≥ 0.15)',   // 分裂原因
  rejected: 'confidence 0.31 < 0.5 (resolutionScore 0.2)',  // 拒绝原因
  confidence, resolutionScore, prominenceScore, validationScore,
}]
```

`[HS-DEBUG]` console 输出（复用现有 hsDebug 机制）+ badge 悬停 title。**合并/分裂/拒绝每一条都必须有原因**——这是"为什么这个热结没有了"的答案。

---

## 9. 行为变更清单（必须同步更新现有测试）

| 变更 | 影响 |
|---|---|
| **cube50（均匀实心）不再检出热结** → NO_HOTSPOT | `hotspot_regression_test.mjs`、E2E（"cube50 热结 Mc≈25"、"Mc 自动写入冒口"断言）→ 更新为 NO_HOTSPOT；冒口 Mc 走 `wallMain/2` 兜底（现有逻辑已支持，均匀件 Mc=壁厚/2 本来就正确） |
| 均匀 plate/cylinder/tube → NO_HOTSPOT | 现有回归断言同步 |
| L 形（臂 40/角部 60）→ **仍检出**（角部是相对厚区，Mc≈30） | 保留现有断言 ✓ |
| thinShell（均匀薄壁）→ NO_HOTSPOT（不再 INSUFFICIENT_RESOLUTION） | 新断言 |
| 状态枚举扩展 | hsReasonText 映射扩展 |

**均匀模型防误报双保险**：
1. 26 邻域局部极大用**严格大于**（`score[idx] > score[i]`）——全等 dist 下零候选（现有逻辑已保证）
2. CANDIDATE_RATIO 门槛过滤数值噪声峰（噪声峰 ≈ median < 1.3×median）

---

## 10. 测试模型与回归计划

### 保留（断言更新）
- `cube50` → NO_HOTSPOT
- `L-shape` → OK，Mc≈30 角部（相对厚区）
- `tube_wall10` → NO_HOTSPOT（均匀壁厚）
- `thinShell` → NO_HOTSPOT（新断言：不再 INSUFFICIENT_RESOLUTION）
- 全部 48 项现有 Node 测试 + E2E + browser_test 不回归

### 新增（tests/golden/，stlGen 构造，`tests/hotspot_v2_test.mjs`）

| 模型 | 构造 | 断言 |
|---|---|---|
| `thickOnThin` | 400×200×8 板 + 中央 100×100×60 凸台 | OK，H1 在凸台中心，Mc≈30（解析值 30±15%） |
| `twoThick` | 薄板 + 两个独立凸台（间距大） | OK，H1/H2 两个，位置误差 <5mm |
| `adjacentSplit` | **Peak A=30 / Valley=18 / Peak B=28**（两个近距厚区，明显谷） | **两个 Hotspot**（PVP 分裂） |
| `adjacentMerge` | **Peak A=30 / Valley=28 / Peak B=29**（近距厚区，无谷） | **一个 Region**（PVP 合并） |
| `longBar` | 800×40×40 均匀长条 | NO_HOTSPOT（防误报） |
| `largeThin` | 1000×600×200 壁厚 10（thinShell 放大） | NO_HOTSPOT（不再 INSUFFICIENT） |
| `largeThinThick` | largeThin + 局部厚区 | OK（薄壁大件也能检出局部厚区——P3 核心场景） |

### 性能断言
- 普通铸件（cube/L/tube/均匀件）单次分析 < 3s
- 复杂铸件（thickOnThin/twoThick/largeThinThick）< 8s
- thinShell 类 < 2s

### 置信度边界用例
- 构造显著度 1.2~1.3 边缘模型 → 断言落入 LOW_CONFIDENCE（不硬报也不漏报）

---

## 11. 性能估算

| 模型 | 面数 | 粗扫 | 细化 | 总计（预算） |
|---|---|---|---|---|
| cube50 / longBar | ≤2 万 | 0.2s | 0 | **0.2~0.3s**（<3 ✓） |
| thinShell / largeThin | 21 万 | 0.4s | 0（无候选） | **0.4s**（<3 ✓） |
| thickOnThin / twoThick | ~10 万 | 0.4s | 0.3~1s | **0.7~1.5s**（<3 ✓） |
| largeThinThick / 复杂铸件 | 50 万+ | 1s | 1~3s | **2~4s**（<8 ✓） |

内存：粗扫 11 万点 + 细化 ≤5×5 万点 → 峰值 <20MB（现状 ~15MB）。

---

## 12. 文件修改计划（确认后实施）

| 文件 | 改动 |
|---|---|
| `js/engine/hotspotConfig.js` | **新增**：全部参数（§3），单文件集中 |
| `js/engine/distanceField.js` | `buildDistanceField` 支持可选 `bounds` 参数（局部细化复用；最小改动，默认行为不变） |
| `js/engine/hotspot.js` | 五级流水线重构（复用 §13 列出的现有逻辑）；状态枚举扩展；HotspotResult + audit；PVP 替换 valleyRatio |
| `js/engine/geometryAnalysis.js` | **不动** |
| `js/views/designCenter.js` | hsReasonText 新状态映射；热结列表显示 confidence/resolution；hsDebug 输出 audit |
| `css/app.css` | 热结列表小徽章（confidence%）——若有 |
| `tests/` | 新模型 + `hotspot_v2_test.mjs` + 现有断言更新（§9/§10） |
| `docs/HOTSPOT_ENGINE_V2.md` | 本文档（实现后标记已实施） |

## 13. 可复用代码

| 复用 | 位置 | 用途 |
|---|---|---|
| BVH + acceleratedRaycast patch | mesh3d.js | 全部距离计算 |
| scanInsideSliced / distanceToSurfaceSliced | distanceField.js | 粗扫与局部细化共用 |
| 26 邻域局部极大（严格大于）+ NMS | hotspot.js | 候选检测 |
| minGapOnPath | hotspot.js | PVP 谷值计算（复用核心，判定换谷深比） |
| Region BFS / 重叠合并 | hotspot.js | 聚类 |
| refineMc | hotspot.js | Mc 亚体素精化 |
| validateMesh | meshValidation.js | 前置校验 |
| regionBBox | hotspot.js | 细化范围 |
| hsDebug 机制（`[HS-DEBUG]` + badge title + window.__view3d） | designCenter.js / modelView3D.js | 审计输出 |

---

## 14. 未决参数（默认值，待真实铸件校准）

| 参数 | 默认 | 校准信号 |
|---|---|---|
| CANDIDATE_RATIO | 1.3 | 假候选多 → 提高；漏检 → 降低 |
| valleyDepthRatio | 0.15 | 应分开被合并 → 降低；应合并被分开 → 提高 |
| TARGET_VOXELS_ACROSS_THICKNESS | 6 | Mc 偏大/偏小 → 调整 |
| CONFIDENCE_THRESHOLD | 0.5 | 结合三因子分项判断 |
| confWeights | 0.4/0.4/0.2 | 结合分项分布判断 |

**校准方法**：用户提供真实铸件 STL + 铸造工程师标注的热结位置 → golden 回归 + 参数扫描（`hotspotConfig` 单点修改，算法零改动）。

---

*V2.1 设计确认后开始编码。优先顺序：稳定性 > 可解释性 > 可测试性 > 性能 > 80/20 实用性。*
