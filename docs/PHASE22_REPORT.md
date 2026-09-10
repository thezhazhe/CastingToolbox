# PHASE 22 验收报告：热结显示与 STL 自适应采样率一次性优化

> 命令文件：`新建 文本文档 (30).txt`（2026-08-25）
> 基线：PHASE 21 完成（132/0），真实 STL 30/30
> 本轮结果：自动化测试 **149/0**（含新增 17 条 PHASE 22 用例），真实浏览器 UI 全路径验证 **全部通过**

---

## 〇、审计结论（改动前）

| 项 | 审计发现 |
|---|---|
| 热结球太小 | ①半径公式 `min(max(3, minSize×0.03), mc×0.35)` 的 mc 是 V/A 类长度量（V3 peakModulus≈3mm），对显示尺度太小；②**可见核心球只有 r×0.55**——实际可见球比计算半径还小一半；③大模型上大多数热结被 3% 下限压成等大 |
| 热结位置偏左/偏右 | 引擎位置=热结区域采样点质心（V2 0.95 连通域 / V3 region centroid），质心是**体素网格约束均值**——均匀壁厚件中偏差 ≤ vs/2 且随网格相位左右摆（非 raycast 方向问题，命令文件中的猜测不成立） |
| 「距离场无有效采样」 | **现存 30 个真实 STL 全部通过**（PHASE 19/21 已解决）；V3 采样已是壁厚驱动（char p10 → vs=0.5×壁厚，保底 4mm，上限 128/256 格） |
| 无进度反馈 | 分析期只有一句"正在自动分析…"，且 V3 主分析为**同步执行**（主线程冻结，进度条无从渲染） |
| DC 布局 | 参数优先（任务→参数→热结→模型信息），与"先看结果再操作"的信息层级相反 |
| 最大化溢出 | `.dc-main` 网格本身已用 `minmax(0,…)`；但内部 `.dc-params-grid`/`.dc-geom-grid` 用裸 `1fr`——内容最小宽度可撑爆父容器 |

**显示位置根因确认**：不是"射线起点/方向/法线"问题（命令文件猜测），而是**体素网格相位**：
均匀壁厚件中，热结区域质心 = 采样点均值，采样点落在以网格相位固定的位置上 →
质心偏差 (φ − vs/2) 随相位变化 → 同一结构显示位置左右漂移（30.txt 四）。
修复方向按命令文件五·三级规则：沿局部壁厚方向调整到有效厚度区间中部。

---

## 一、热结显示（30.txt 三/四/五/六）

### 1.1 显示半径规则（`js/engine/hotspotDisplay.js` → `displayRadiusFor`）

```
displayRadius = clamp(k × r_eq, minR, maxR)
  r_eq = (3 × regionVolume / 4π)^(1/3)   ← 热结区域等效球半径（区域体积是 V2/V3 都有的真实尺度数据）
  k = 1.0
  minR = max(2.5, minSize × 0.02)        ← 小热结仍可见
  maxR = max(8,   minSize × 0.25)        ← 不遮零件
  无体积数据（Fake/旧数据）→ mc 兜底
```

- 核心球 = 显示半径本体（旧版只有 0.55×，视觉小一半）；光晕 1.6×、标签 1.5× 随半径缩放
- **只改显示层**：计算坐标（x/y/z/mc/regionVolume）零修改

### 1.2 显示位置规则（`displayCenterFor`）

```
一级：引擎位置（区域质心）——引擎已实现，不重算
三级：中面修正 displayPosition = C + n̂×(d2−d)/2
      n̂ = 最近表面方向（BVH closest point，局部壁厚法线）
      d  = C 到最近表面距离；d2 = 沿 n̂ 射线到远侧表面距离（BVH 射线求交）
      → C 恰在中面时 d2=d 零修正；偏 δ 时修正 δ 拉回中面（体素相位偏差）
      修正量 > 0.5×r_eq（局部几何非壁型，如 T 交叉长段）→ 不修正
四级：无远侧表面（开放边界/非流形）→ 保持原位置
      displayCenterReliable = false（列表项 title 可见，供继续诊断）
```

- 计算坐标 `hotspot.position` 与 `hotspot.displayPosition` 严格分离（30.txt 六）
- 修改期间发现并修复 **mesh-bvh 0.9.13 API 坑**：最近点写在返回对象的 `.point` 字段，
  不是传入的 target（`js/engine/hotspotDisplay.js` 注释留档；mesh3d.js 只读 distance 一直未暴露）

### 1.3 验收对照（真实 STL：ALHR4510塑料模具v2-2.1.stl，290×73×290mm，minSize=73.2）

| 项目 | 修改前 | 修改后 |
|---|---|---|
| 热结球大小（H1–H5） | r=3mm（minR 下限），可见核心球仅 1.65mm | r=12.0/12.3/13.8/14.3/14.8mm（r_eq 驱动，随区域尺度变化），核心球=半径本体 |
| 热结位置稳定性 | 质心随网格相位偏摆（偏差 ≤ vs/2≈1.2mm） | 中面修正拉回局部壁厚中部（H1–H4 修正 2.1–3.0mm，H5 超限保护保持） |
| 原始计算位置 | — | **零修改**（position/displayPosition 分离，测试锁定） |
| 是否影响计算结果 | — | 否（引擎零改动；V3 仅新增分片入口，sliced==sync 测试锁定） |
| 越界 | — | 全部 marker 在模型 bbox 内 |

---

## 二、采样策略（30.txt 七～十二）

### 2.1 现状与决策

**现存 30 个真实 STL 全部通过（V2 采样 0 失败、V3 无法分析 0 个）**——「距离场无有效采样」在
PHASE 19/21 已解决。本轮验证并固化：

- **V3 采样已是壁厚驱动**：char p10 → vs = 0.5×最小壁厚（≥2 层），clamp [mdim/128, mdim/24]，
  主网格多级采样（3 级 × 2 相位，受 maxSampleGs=256 保护），粗探测 16→128 六级升级
- **防"局部极薄特征爆分辨率"已结构性承担**：`charFilterMin=2mm`（<2mm 特征不进 char 统计）
  + `estWallFloor=4mm`（vs ≥ 2mm 保底）——不需要额外"主体壁厚下限"

### 2.2 试错记录（30.txt 十/十一，重要）

尝试"主体壁厚决定 vs 下限"（vs ≥ wallMain/5，通过 `opts.bodyWall` 传入）：
**ALHR4510 从 5 热结 → NO_HOTSPOT**。根因：该模型薄肋（p10≈5mm）本身就是热结所在结构，
主体壁厚放宽 2× 即丢失肋特征采样。已回退，代码留注释说明（sampling.js adaptiveVs）。
结论：**p10 驱动（保证最薄结构 ≥2 层）对这类模具件是正确语义**，主体壁厚判据只用于
WARNING 分级（samplingWarn，PHASE 17 已实现），不参与分辨率选择。

### 2.3 极端场景验证（新增 phase22_test.mjs D1/D2）

| 模型 | 场景 | 结果 |
|---|---|---|
| 3m×3m×3m 壳（壁 20mm） | 大件薄壁（历史「无有效采样」复现条件） | V2 自动升 192³ 成功（wallMain=15.7，内部点 18 万）；V3 正常出结果（均匀壳 → NO_HOTSPOT 正确语义，非采样失败） |
| 500mm 板（壁 1mm） | 极薄壁（低于 4mm 可靠性下限） | 诚实结果不假造（均匀 → NO_HOTSPOT / 无法可靠分析 → WARNING） |
| 1m 壳（壁 50mm） | 正常对照 | V3 OK |
| 空腔管（tube_wall10） | 空腔 | 不 INSUFFICIENT，代表点不落空腔 |

### 2.4 采样失败行为（30.txt 十二）

升级链已验证存在：粗探测 6 级 → 主网格 3 级×2 相位 → 真 0 内部点才 INSUFFICIENT。
全部上限（maxSampleGs=256 / coarseMaxPoints=20000 / refineMaxPoints=8000 / maxResolution）在位。

### 2.5 用户视角（30.txt 二十）

生产界面不再暴露 `48³/96³/gs/vs/内部点`（renderGeomInfo 仅 hsDebug 显示）；
「距离场无有效采样」专业文案替换为友好状态（✅ 采样正常 / ⚠ 采样点不足，结果仅供参考）。

---

## 三、进度条（30.txt 十三/十四）

**实现**：`dc_progress`（3D 视口上方），8 阶段真实进度：

| 阶段 | 区间 | 进度来源 |
|---|---|---|
| 导入模型 | 0–10% | 快速步骤（解析/构建 BVH） |
| 检查 STL | 10–20% | 快速步骤 |
| 建立距离场 | 30–55% | **真实**：扫描行计数（3 轴归一化） |
| 内部采样 | 55–70% | **真实**：BVH 距离分片计数 |
| 热结分析 ×4 | 70–90% | **真实**：V3 扫描/距离/模数场/局部细化四阶段 |
| 生成结果 | 90–100% | 快速步骤 |

- **不伪造百分比**：无真实进度的阶段（V2 路径、同步段）显示阶段文案 + 流动条（indeterminate）
- **不允许"80% 卡 30 秒"**：V3 从同步改为**分片执行**（`analyzeHotspotsV3Sliced`，
  扫描按轴/行让出、距离按 128 点/片、模数场按 256 点/片）；sliced == sync 由测试锁定
- **单调性**：多级采样级间回退由 `monotonic` 包装（只前进不后退）
- 真实浏览器实测文案序列：`建立距离场（36%）→ 热结分析·建立几何采样（71%）→ 测量壁厚（79%）→ 计算模数场（85%）→ 局部细化（87→89%）`

---

## 四、Design Center 布局（30.txt 十五）

右侧面板重排（render 结构 + 编号同步更新）：

```
修改前：① 分析任务 → ② 参数与执行 → ③ 热结列表 → ④ 模型信息
修改后：① 分析结果概览（新增卡）→ ② 热结列表 → ③ 分析任务 → ④ 参数与执行 → ⑤ 模型信息
```

新增**分析结果概览卡**：热结数量 / 最大热结 Mc / 主体壁厚 / 模型状态（✅🟡🟠🔴 四级 chip）。
核心思想落实：先让用户看到"模型 + 结果"，再决定下一步（30.txt 十五）。

## 五、窗口最大化两列布局（30.txt 十六）

| 问题 | 修复 |
|---|---|
| `.dc-params-grid` 裸 `1fr`（内容最小宽度撑爆父容器） | `minmax(0, 1fr)` |
| `.dc-geom-grid` 同上 | `minmax(0, 1fr)` + 子项 `min-width:0` |
| 面板节无宽度约束 | `.dc-panel-sec { min-width: 0 }` |

真实浏览器 1920×1080 验证：`scrollWidth=1910 = clientWidth`、面板右缘=主网格右缘、
面板内各节 0 溢出、参数网格不超面板（-15px 余量）。未影响布局，无大改。

---

## 六、验证（30.txt 十七）

### A. 自动化测试：`tests/phase22_test.mjs`（17 条新增，全过）

| 组 | 覆盖 |
|---|---|
| A 显示半径 | r_eq 驱动 / min-max 约束（小热结可见、大热结封顶）/ mc 兜底 / 不改 hs |
| B 显示位置 | 均匀壁厚中面修正（z=8 → 0）/ 对称零修正 / 开放边界 fallback / 超限保护 / 无几何 fallback |
| C V3 分片一致性 | uniformPlate/bossOnPlate/thinShell：status+位置+M+体积 全等 |
| D 极端采样 | 3m 壳薄壁 / 1mm 极薄壁 / 空腔管 |
| E 进度 | 几何 scan/dist 真实进度 / V3 四阶段 / 回调不影响结果 |

### B. 真实浏览器 UI 全路径（`scripts/browser_stl_p22_test.mjs`，无头 Edge + CDP）

```
真实 STL → file input 注入 → importFile → ModelView3D → Design Center
→ analyzeGeometrySliced → analyzeHotspotsV3Sliced → toViewResult
→ setHotspots(displayPosition/displayRadius) → 3D 渲染 → 面板
```

结果（V3 生产路径 + --v2 对照路径均全过）：

| # | 检查 | 结果 |
|---|---|---|
| 1 | 真实浏览器通过 | ✅（V3 + V2 两路径） |
| 2 | 仍出现 "INSUFFICIENT_NO_SAMPLE" | ❌ 未出现（30/30 真实 STL + 极端场景全过） |
| 3 | 仍出现 "insidePoints=0" | ❌ 未出现（浏览器实测 insidePoints=9572） |
| 4 | 热结 marker 明显但不过大 | ✅ r=12.0–14.8mm（minSize 73mm 模型），有尺度差异，无 JS 异常 |
| 5 | 均匀壁厚区域位置稳定在壁厚中部 | ✅ 中面修正（H1–H4 修正 2.1–3.0mm；H5 超限保护保持+标记不可靠） |
| 6 | JS error | 无（exceptions=0） |
| 7 | 影响现有 V2/V3 计算 | 否（引擎零改动；sliced==sync 锁定；全量回归 149/0） |
| 8 | 最大化窗口溢出 | 已修复（1920×1080 无任何水平溢出） |

### C. 真实 STL

- **ALHR4510塑料模具v2-2.1.stl**（命令文件指定，576KB）已复制入 `tests/real-stl/`
  （原文件在 D:/LOCAD/STL文件/ALHR4510V2/，另有 v1.2/浇道 等版本）
- 全量 30 个真实 STL Node 扫描：V2 采样 0 失败、V3 无法分析 0 个
- 截图：`screenshots/p22_dc_hotspots.png`（默认视角）/ `p22_dc_transparent.png`（透明看位置）/
  `p22_dc_focus_h1.png`（聚焦 H1）

---

## 七、性能（30.txt 十四）

| 模型 | V3 耗时 | 备注 |
|---|---|---|
| ALHR4510 v2-2.1（11520 面） | 1.66s | 进度条分片推进 |
| ALHR4530 整个（16718 面） | 1.68s | — |
| HR4012 大板（85812 面） | 2.8s | — |
| cat.stl（67 万面） | 2.9s | 最大实测模型 |
| 3m 壳（极端） | V2 1.0s + V3 1.4s | 上限保护在位 |

全部远低于 10–30s 目标；安全上限（maxResolution/maxSampleGs/voxel 上限）在位。

---

## 八、改动文件清单

| 文件 | 改动 |
|---|---|
| `js/engine/hotspotDisplay.js` | **新增**：显示半径/位置规则（纯函数，Node 可测） |
| `js/engine/distanceField.js` | sliced 版加 onProgress（scan/dist 真实进度，默认 null 零开销） |
| `js/engine/geometryAnalysis.js` | analyzeGeometrySliced 透传 onProgress |
| `js/engine/v3/windowV.js` | 新增 voxelizeSliced（分片体素化） |
| `js/engine/v3/sampling.js` | 新增 coarseSampleSliced；adaptiveVs 试错回退留注释 |
| `js/engine/v3/modulusField.js` | 提取 fieldPoint；新增 buildModulusFieldSliced |
| `js/engine/v3/hotspotV3.js` | 新增 analyzeHotspotsV3Sliced（流水线级分片，与同步版逐字段一致） |
| `js/views/components/modelView3D.js` | setHotspots 用 displayRadius/displayPosition（显示层修正，计算数据只读） |
| `js/views/designCenter.js` | 进度条 8 阶段接线、V3 分片+进度、toViewHotspot（displayPosition）、概览卡、面板重排、生产模式隐藏 gs/vs、热结列表可靠性格 |
| `css/app.css` | 进度条/概览卡样式、minmax(0,1fr)+min-width:0 防溢出、chip 作用域补充 |
| `tests/phase22_test.mjs` | **新增**：17 条用例（显示/位置/分片一致性/极端采样/进度） |
| `scripts/browser_stl_p22_test.mjs` | **新增**：真实浏览器全路径验证（V3 默认，--v2 对照） |
| `scripts/shot_dc_p22.mjs` | **新增**：设计中心截图 |
| `tests/real-stl/ALHR4510塑料模具v2-2.1.stl` | 命令文件指定真实 STL 入库 |
| `docs/PHASE22_REPORT.md` | 本报告 |

## 九、风险与后续

1. **displayPosition 修正有界但有不确定性**：H5 类"近表面质心 + 长局部段"结构保留原位置并标
   不可靠——如需进一步处理，可研究"region 高分格子集质心"作为一级规则增强（30.txt 五 一级规则）
2. **V2 路径热结半径全部封顶 maxR**：V2 区域体积同量级所致，非缺陷；如需 V2 尺度差异可研究
   regionBBox 对角线作为补充特征
3. **validateMesh 不查自交/非流形**（PHASE 20 遗留）：本轮未处理，遇坏网格仍可能显示误导性结果
4. **新真实 STL 持续校准**：命令文件 30 个 STL 全过，但新模型出现"距离场无有效采样"时，
   优先检查是否触发极端场景（大件薄壁/极薄壁），机制已覆盖并有测试
