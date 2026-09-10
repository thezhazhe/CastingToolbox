# Hotspot Engine V3 — 架构设计（PHASE 1 交付物）

日期：2026-08-22 ｜ 依据：命令 12.txt（40 节完整规格） ｜ 状态：冻结开始实施

## 1. 定位

Geometry-Based Local Thermal Modulus Engine。仅根据 STL 几何找到最可能最后凝固的局部区域。
不模拟温度场/凝固，不复制 MAGMASOFT/AnyCasting。20% 物理模型解决 80% 常见铸件热结识别。

## 2. 数据流（对应 12.txt §4）

```
STL
 → Geometry Validation          （复用 meshValidation.js）
 → Geometry Metrics             （复用 stl.js：volume/area/bounds；壁厚统计改 BVH 直接算）
 → Adaptive Spatial Sampling    （粗网格 M 场 + 候选区局部细化，禁 bbox/48 唯一分辨率）
 → Local V / Local A            （窗口内金属体积 / 真实外表面面积，人工截面禁计入）
 → Local Modulus Field M(x,y,z) （全场 1 尺度 medium + 峰点多尺度验证）
 → Multi-scale Peak Detection   （3 尺度位置稳定性验证）
 → Hotspot Region Extraction    （高 M 连通域 BFS）
 → Hotspot Ranking              （normalized M + prominence + volume + stability）
 → Representative Position      （region centroid → 金属校验 → fallback 最高 M 点）
 → Confidence → 3D 可视化
```

## 3. 核心算法决策

### 3.1 窗口尺度（characteristic size，12.txt §8）
- `char(p) = 2 × distToSurface(p)`（BVH closestPoint 半壁厚语义，局部壁厚）
- 窗口半径 `R(p) = k × char(p)`，`k ∈ {0.5, 1.0, 2.0}`（三尺度）
- **尺度不变性自动成立**：char 线性缩放 → R 线性 → V~R³、A~R² → M~R，即 M(10×)≈10×M(1×)
- 薄壁区（char=20）窗口 R=10/20/40，BVH 精确查询 → 壁厚不会"消失"；厚区（char=100）窗口自动放大捕获整个厚区

### 3.2 Local V（窗口内金属体积，12.txt §10）
- 窗口内微网格（默认 7³，可配）逐点判内外 → 体积 = 内部占比 × 窗口体积
- 判内外：**复用 scanInside 扫描线投票**（cube 窗口对齐坐标轴，每窗口 3×gs² 条射线 + 重合面合并；ray origin 已在全局 bbox 外——V2.2 已修的历史 bug，天然带 regression）
- Sphere 窗口判内外用逐点 6 方向射线投票（isInside 复用），PHASE 3 benchmark 后确定主方案
- 不求 CAD 级精度："足够准确 + 浏览器可运行"

### 3.3 Local A（窗口内冷却表面积，12.txt §11 — 最重要技术点）
- **方法 A（质心近似）**：BVH `shapecast` 按窗口 AABB 过滤 → 候选三角片，质心在窗口内则计全面积。不裁剪 → 无人工截面
- **方法 B（精确裁剪）**：Sutherland–Hodgman 多边形裁剪到窗口 → 精确面积（cube 窗口容易；sphere 难）
- 窗口切割产生的人工截面**绝不**计入 A；边缘三角片误差由多尺度稳定性抑制
- PHASE 3 实测比较 A/B 的 accuracy/stability/runtime 后选定

### 3.4 采样方案（12.txt §6 — 禁 bbox/48 唯一分辨率）
- Stage A 粗网格：`gs = clamp(round(mdim/粗网格目标 vs), 24, 48)`，只做候选区发现
- Stage B 局部细化：候选峰周围区域 `vs/2` 重采样，最终 M 场与判定在细化场做
- 薄壁保护机制：薄区 M 计算是 BVH 精确查询 + 小窗口（R∝char），不依赖 voxel 层数

### 3.5 多尺度验证（12.txt §8）
- 全场 M 场只算 1 尺度（medium）控制成本；**多尺度只在 peak 候选点上验证**（几十个点 × 3 尺度）
- 峰在 3 尺度下位置漂移 < 阈值 → 真热结；单尺度峰 → mesh artifact / weak feature

### 3.6 Peak / Region（12.txt §13/§14）
- 5 条规则：局部 M 极大 / 最小 prominence / 最小空间间距 / 高 M 连通域 / 多尺度稳定
- 不堆 V2 heuristic（uniform/candidate floor/outside maxima/centroid offset 全部不继承）
- NO_HOTSPOT = 算法自然结果（M 场均匀无显著峰）
- Region：峰出发 BFS（6 邻域，≥0.8×peak）；代表点优先 region centroid，`isInside` 校验失败（空腔/管内/外部/薄壁）→ fallback 最高 M 点

### 3.7 置信度（12.txt §22）
- Score = normalizedM×w1 + prominence×w2 + regionVolume 归一化×w3 + scaleStability×w4，权重集中 configV3.js

## 4. 性能预算（12.txt §28/§29）

| 阶段 | 成本 | 预算 |
|---|---|---|
| 粗网格扫描线 | 3×48² ≈ 7K 射线 | <1s（V2 已证） |
| 粗 M 场（medium 尺度） | 内部点降采样 ~4-8K × 微网格 3³ 扫描线 27 射线 ≈ 20 万 | <1s |
| 候选区细化 M 场 | 候选区局部 vs/2，~数千点 × 微网格 7³ | <2s |
| 峰点多尺度验证 | 几十点 × 3 尺度 × 微网格 | 毫秒级 |
| BVH shapecast AABB 过滤 | 每窗口 O(相交三角片) | 快 |

禁止全模型×全三角形（O(N×M)）；百万面模型总预算 ≤ 十几秒。

## 5. 文件布局（V3 独立，不污染 V2）

```
js/engine/v3/
  configV3.js       参数集中（沿用 V2"算法不写死数值"原则）
  sampling.js       粗网格 + 局部细化采样（复用 distanceField.scanInside）
  windowV.js        窗口内体积计算（扫描线/射线投票判内外）
  windowA.js        窗口内表面积计算（shapecast 质心法 / 裁剪法）
  modulusField.js   单尺度 M 场 + 降采样
  peakRegion.js     峰检测 / 多尺度验证 / region / 代表点 / 置信度
  hotspotV3.js      主入口 analyzeHotspotsV3（HotspotResult API 契约）
tests/hotspot_v3/   17 组独立测试（01_basic ~ 17_multiscale）
docs/V3_REPORT.md   PHASE 12 最终报告（含全部 JSON 数据）
```

## 6. API 契约（12.txt §33，冻结）

`analyzeHotspotsV3(mesh, geometry, opts)` → `HotspotResult`

```js
{
  status,                 // 复用 HS_STATUS：OK/NO_HOTSPOT/LOW_CONFIDENCE/INSUFFICIENT_RESOLUTION
  reason,                 // 复用 HS_REASON 语义，V3 新增原因可扩展
  hotspots: [{
    hotspotId, position:[x,y,z],     // ENGINE 原始坐标（坐标契约不变）
    peakModulus, normalizedModulus,  // M=V/A(mm)，相对 M=M/Mmax
    regionVolume, regionArea,        // 高 M 连通域统计
    confidence, scaleStability,      // 0~1
    geometrySource                  // 数据来源描述（供审计）
  }],
  metrics: { volume, area, bounds, wallMain, wallAvg, triCount },
  audit: [...],                      // 全链追踪 + 每阶段 JSON 数据（12.txt §36）
  debug: { sampling, coarseField, refineField, elapsedMs }
}
```

后续冒口/冷铁/浇注/缩孔/出品率模块读取 `CastingProject.hotspots[]`，工作流/UI 不动（12.txt §34）。

## 7. 成功标准映射（12.txt §37 的 16 条 → tests/hotspot_v3/）

| 标准 | 测试组 |
|---|---|
| plate/cube/cylinder/tube → NO_HOTSPOT | 01_basic, 02_plate, 03_cylinder, 04_tube |
| boss on plate → boss | 05_boss |
| 20mm plate + 100mm cylinder → cylinder | 11_large_thick_cylinder |
| 20mm wall 大箱体几何不消失 | 10_thin_wall |
| flange / hollow ring / tube+flange → 厚区 | 06_flange, 07_ring |
| 90°/45° 旋转稳定 | 13_rotation |
| 0.1×/1×/10× 尺度拓扑稳定 + M 线性缩放 | 14_scale |
| 低/中/高 triangle density 稳定 | 15_mesh_density |
| grid offset 稳定 | 13_rotation（含 offset 子用例） |
| 性能（普通 STL 秒级 / 百万面 ≤ 十几秒） | 16_performance |
| 多尺度稳定性 | 17_multiscale |
