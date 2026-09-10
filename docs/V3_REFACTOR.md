# Hotspot Engine V3 — Local Thermal Modulus Core 重构交付文档（命令 13.txt §21 A-O）

日期：2026-08-22 ｜ 状态：核心重构完成，8/8 核心模型通过 ｜ 旧核心归档：`js/engine/v3/legacy/`

## A. 新 V3 架构说明

```
STL
 → Mesh Validation（复用 meshValidation.js）
 → Adaptive Sampling（壁厚自适应 vs，13.txt §5）
 → 全局体素化（scanInside 三方向扫描线，O(N)）→ inside + 边界体素
 → Local V / Local A（体素块计数，O(块)，零 per-窗口射线/BVH）
 → Local Thermal Modulus Field M = min(V/A, (1/3)×d)
 → 峰检测（局部极大 + 环带显著性 + NMS + uniform 判据）
 → 局部细化（区域覆盖结构完整截面，M 统一用全局网格）
 → Hotspot Region（BFS 高 M 连通域）→ 代表点（质心 + isInside 校验）
 → Confidence → 标准化结果（HotspotResult API 契约，12.txt §33）
```

文件布局：
```
js/engine/v3/
  sampling.js      Adaptive Sampling（粗探测 → vs 决策 → 采样点 + char）
  windowV.js       全局体素化 + 窗口块计数（Local V/A 核心）
  modulusField.js  M 场（固定窗口 R=k×char + (1/3)d 上界）
  peakRegion.js    峰检测（环带显著性）/ region / 代表点 / 多尺度 / 置信度
  hotspotV3.js     主入口 analyzeHotspotsV3
  configV3.js      参数集中（所有阈值只在此修改）
  legacy/          旧核心归档（对比用）
```

## B. Adaptive Sampling 设计说明（13.txt §5/§6）

- **禁止 bbox/固定 voxel 数**：`vs = mdim/40` 对 800mm 模型 = 20mm/1 voxel（薄壁消失）
- **自适应流程**：
  1. Stage 1：粗探测（16³ 扫描线，3×256 射线 ≈ 毫秒级）
  2. Stage 2：探测点 BVH 距离 → char 分布（局部壁厚估计）
  3. char < 2mm 过滤（MC 网格化曲面伪曲率，工程假设 UNKNOWN 待校准）+ 4mm 保底
  4. estMinWall = char p10；目标 vs = 0.5×estMinWall（≥2 层）
  5. 保护区间：vs ∈ [mdim/128, mdim/24]（MAX_RESOLUTION/MAX_COMPUTE_TIME 保护）
- 实测：cube 100mm → vs=3.1；boss 8mm 板 → vs=4.5（板 1.8 层不消失）；800mm 箱体 20mm 壁 → vs=10（2 层）
- 采样点数上限 20000（stride 自动），MAX_MEMORY 保护

## C. Local V 算法说明（13.txt §7）

- **LOCAL_WINDOW_POLICY（固定规则）**：窗口半径 R = k × char(p)，k ∈ {0.5, 1.0, 2.0}，上限 0.5×mdim
- V = 窗口体素块内 inside 体素数 × vs³
- 无动态外扩/回退（旧核心的补丁已删——"简单、稳定、可解释"）
- 尺度不变性：char∝尺度 → R∝尺度 → V~R³ → M~R（M(10×)≈10×M(1×)）

## D. Local A 算法说明（13.txt §8 — 本轮最重要技术点）

- **体素边界法（O(N)）**：A = 窗口块内"边界体素"（inside 且 6 邻域有 outside）的接触面数 × vs²
- 边界体素 = 金属与模具/空气的界面（13.txt §8：surface voxel / occupancy transition）
- **零 per-窗口 raycast/closestPoint/shapecast 主循环**——规则高面数 STL 的 O(N×M) 退化结构性杜绝
- 人工截面免疫：窗口切割面（与金属相邻）不计入（块内 outside 判定）
- 已知局限：vs 网格离散误差（表面面积 ~±1 层），由环带显著性/多尺度平均抑制

## E. Local M 算法说明（13.txt §9）

- M = V/A，单位 mm（项目统一，输出按 UI 转换）
- **物理上界 M ≤ (1/3)×d**（d = 到表面距离）：半球 Chvorinov 解析 (2/3)d 实测使 cube 表面层 > 中心（伪峰）；校准为 (1/3)——工程假设 UNKNOWN，待真实 STL 校准（configV3.modulusCeilRatio）
- M Field 是核心数据（每采样点一个 M 值），旋转/缩放不变（尺度线性）

## F. Hotspot Detection 说明（13.txt §10）

- **Hotspot ≠ 全模型 M 最大**（13.txt §10 核心原则）
- 检测规则（5 条，无特殊规则堆砌）：
  1. **局部极大**（6 邻域，等值允许——高原多点，由 NMS 合并）
  2. **环带显著性**：prominence = (M_peak − 峰 1R~2R 壳 M 中位数)/M_peak ≥ 0.3（"相对于周围区域明显更高"）
  3. **NMS 合并**（间距 < 1.3×R_medium）
  4. **uniform 判据**（13.txt §11 均匀件自然 NO_HOTSPOT）：候选 <2 或 top2/top1 ≥ 0.85 → 快路径返回
  5. **Region 过滤**（regionMinVolume，采样噪声）
- 多尺度验证（简化）：峰在 ≥2 个尺度 M ≥ 0.6×maxM（弱信号拒绝）
- 代表点：region 质心 + isInside 校验（空腔/管内/外部 fallback 峰点）——V2.2 已验证思想

## G. 为什么选择该方法，而不是旧距离场/厚度法

| 维度 | 旧距离场/厚度法（V2） | 本方案（V3 Local M） |
|---|---|---|
| 核心指标 | 半壁厚距离（厚度） | V/A（Chvorinov 模数，成熟软件同源） |
| 薄壁大件 | voxel 分辨率不足 → 20mm 壁消失 | BVH 距离 + 自适应 vs → 壁不消失 |
| 表面层伪影 | 无（距离场干净）但有分辨率问题 | (1/3)d 上界抑制切表面虚高 |
| 计算 | 体素距离场（BVH 主循环） | 体素块计数（O(N)，零 BVH 主循环） |
| 物理可解释 | "最厚处"（MAGMASOFT 不这么定义） | "局部 V/A 最大"（MAGMASOFT 同源） |

## H. 复杂度分析

- 全局体素化：O(N_tri 射线求交)（scanInside 3×gs² 射线，BVH 加速）
- 边界体素：O(gs³)
- M 场（每采样点）：O(窗口块体素数) = O((R/vs)³)——与三角片数无关
- 峰检测：O(采样点数)（环带 O(峰数 × 采样点数)）
- 总复杂度：O(gs³ + N_pts × (R/vs)³)——**无 O(N×M)（三角片×体素）项** ✓ 13.txt §14

## I. 性能 benchmark（程序化模型）

| 模型 | tri | vs | 采样点 | 总耗时 |
|---|---|---|---|---|
| cube | 18 万 | 3.1 | 4096 | 0.47s |
| plate | 18 万 | 9.4 | 2688 | 0.33s |
| cylinder | 16 万 | 2.7 | 3806 | 0.44s |
| tube | 21 万 | 2.0 | 4450 | 0.54s |
| ring | 18 万 | 2.4 | 8960 | 0.65s |
| boss(8mm) | 12 万 | 4.5 | 14354 | 1.14s |
| flange | 14 万 | 3.1 | 7640 | 2.00s |

对比旧核心：cube 46s → 0.47s（~98×）。基准测试 10k~1M tri 分段待建（见 §O）。

## J. 真实 STL 测试

**未执行**——需要用户提供真实铸件 STL（箱体/法兰/凸台机械件/管路阀体 ≥5 个，13.txt §16）。框架已就绪：`tests/real-stl/run_real_stl.mjs`（V2 遗留，V3 接入待完成）。壁厚 10/20/30mm × 尺寸 300/500/800/1000mm 的 Adaptive Sampling 验证也依赖真实 STL。

## K. 程序化 GT 测试

- 生成器（tests/tools/hotspotGeometryGenerator.mjs，SDF 解析 GT）
- 8/8 核心模型通过（见 §N）；扩展模型：thickEnd ✓、lShape LOW_CONFIDENCE（接近）
- 已知限制：多热结次级丢失（tShape/steppedThickness/twoAdjacentBosses/threeBosses/pvpPair——次级热结环带显著性不足）；gradualTaper NO_HOTSPOT（GT 期望 0 ✓ 正确）

## L. Regression 测试

- V2 全量回归：`npm test`（61 项，V3 不修改 V2 代码，Import 仅复用枚举/基础设施）
- V3 独立：`node tests/hotspot_v3_test.mjs`（9/9）

## M. npm test

见 §L（全量 61+9 项）。

## N. Hotspot V3 test

```
✓ uniform cube → NO_HOTSPOT（0.47s）
✓ uniform plate → NO_HOTSPOT（0.33s）
✓ uniform cylinder → NO_HOTSPOT（0.44s）
✓ uniform tube → NO_HOTSPOT（0.54s）
✓ hollow thick ring → NO_HOTSPOT（0.65s）
✓ boss on plate (20mm 板) → OK@凸台（M=11.3）
✓ boss on plate (8mm 板) → OK@凸台（M=9.9，薄板不消失）
✓ thick block + thin wall → OK@厚块
✓ flange → OK（hub M=6.6 + rim M=3.0 双热结）
```

## O. 新增专项测试（待办）

- [ ] rotation 90°/45° 不变量（12.txt §18）
- [ ] scale 0.1×/1×/10×（M 线性缩放，§20）
- [ ] mesh density 低/中/高（§19）
- [ ] grid offset（§30 数值伪影标记）
- [ ] 性能基准 10k~1M tri 分段计时（§14）
- [ ] 真实 STL 5+ 件（§16）
- [ ] V2 vs V3 对照（BETTER/SAME/WORSE，12.txt §27）
- [ ] 接入 Design Center（12.txt §34——HotspotResult API 契约已冻结，UI 不动）

## 已知技术债 / 风险

1. (1/3)d 上界为工程校准值（UNKNOWN，需真实 STL 校准）
2. char 伪尖峰过滤阈值 2mm 为工程假设（UNKNOWN）
3. 多热结次级丢失（环带显著性对弱次级热结不足）
4. 细化区域 2×toCenter 扩展会放大细化范围（flange 2s）
5. 45° 旋转未验证（13.txt §13 允许不完美）
