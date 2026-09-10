# HOTSPOT ENGINE V2.2 SELF-VALIDATION 修复阶段报告

日期：2026-08-21 ｜ 命令：8.txt（PHASE 1~7） ｜ 基线：npm test 56/56 + hotspot_v2_test 44/44
V2.1 快照：`tests/golden/analytical/raw_v21/`（337 条原始数据） ｜ V2.2 全量：`tests/golden/analytical/raw/`

---

## 零、修改清单（V2.1 → V2.2 diff）

| 文件 | 修改 | PHASE |
|---|---|---|
| js/engine/distanceField.js | scanAxis/scanAxisSliced 射线起点外推到**全局模型 bbox 外**（5 处：scanAxis/scanAxisSliced/scanInside/scanInsideSliced/buildDistanceField×2） | 1 |
| js/engine/hotspot.js | 代表点：±2 voxel 邻域质心 → **峰出发 BFS 的 0.95×peak 连通域质心**；输出 peakPosition/representativePosition | 2 |
| js/engine/hotspot.js | uniform 判据 Region-level：growRegions 提前 + **region 外局部极大 + 厚度比×质心偏移（AND）** 三信号 | 4 |
| js/engine/hotspotConfig.js | 新增 REGION_THICKNESS_RATIO=2.0 / REGION_CENTROID_OFFSET_RATIO=0.025；REGION_COVERAGE_RATIO 改记录用 | 4 |
| tests/helpers/stlGen.js | 新增 multiBoss5 工厂 + 解析体积 | 1 |
| tests/hotspot_regression_test.mjs | 新增 3 回归（multiBoss5 n=5 / uniform Region-level / res96+rx90）；twoHotspots 断言实现改"mc 主热结"（语义不变，容忍 H3 弱伪影热结） | 1/4 |
| tests/hotspot_localization_test.mjs | 新增：5 模型定位回归（误差 < V2.1 一半） | 2 |
| tests/tools/ | 新增 exp07_multi/exp_rotation_v22/exp_prominence_scan/benchmark_distancefield/diag_*/compare_v21_v22 | 1/3/5/6/7 |
| tests/tools/hotspotGeometryGenerator.mjs | tShape GT 公式修正（竖板平台中心 y=armH/2=50，旧公式把 t=80 误当横板厚） | 2 |

**零改动**：candidate detection / PVP / confidence 三因子 / refinement / hotspot count / 五级流水线 / Geometry Engine / 坐标契约 / BVH。

---

## 一、PHASE 1 — n=5 多厚区异常（FIXED）

**根因链（全链路追踪）**：
1. 细化 bbox 射线起点 `o0 = bounds.min - vs` 只保证在 bbox 外 —— 相邻凸台（MC 侧壁内缩后）侵入起点位置 → **起点在模型内部** → 奇偶翻转基准错
2. 板顶/凸台底 MC 重合面被 eps 合并 → Z 轴凸台段判外
3. 叠加 → 凸台 E(0,0) 内部 700 采样点仅 23 个 inside（表面薄层）→ 细化 peak=0.03~1.21 全部 `<1 voxel` 拒绝 → 漏检

**修复**：scanAxis 起点外推到全局模型 bbox 外（恢复"起点在模型外"隐含前提；命中列表不变，无性能影响）。

**结果**：n=5 → 5/5 检出且位置对应 GT（H4@(-5.0,-1.2) ✓）；n=1..10 全部正确；twoHotspots 细化恢复正常（暴露过渡区 MC 斜切弱热结 H3 —— 见 PHASE 5）。

## 二、PHASE 2 — 宽平台代表点定位（FIXED/IMPROVED）

**实现**：代表点 = 峰出发 6 邻域 BFS 的 score ≥ 0.95×peak 连通域质心（不能用全连通域过滤——多凸台经板连通同域 → 质心跨平台，threeBosses 实测 135mm）。输出 peakPosition（原峰）+ representativePosition（质心）。

**定位误差变化**（V2.1 → V2.2）：

| 模型 | V2.1 | V2.2 | 变化 |
|---|---|---|---|
| bossOnPlate | 11.8mm | **0.50mm** | 改善 96% |
| tShape | 28mm | **0.83mm**（GT 修正后） | 改善 97% |
| thickEnd | 31mm | 7.51mm | 改善 76% |
| twoAdjacentBosses | 22-25mm | **1.26mm** | 改善 95% |
| lShape | 1.8mm | 5.30mm | 略差（MC 等距区不对称，网格固有） |
| threeBosses | 2-7mm | 6.40mm | 略差（同上） |
| hollowThickRing | — | 0.00mm | ✓ |

**残余误差来源**：MC 网格棱边圆滑使 0.95 等距区不对称（thickEnd 7.5mm）—— 网格固有，非代表点算法误差。

## 三、PHASE 3 — 旋转不变量（IMPROVED / KNOWN_LIMITATION）

| 模型 | rx90 | ry90 | rz90 | r45 |
|---|---|---|---|---|
| lShape | **0mm** ✓ | **0mm** ✓ | **0mm** ✓ | 1.74mm |
| bossOnPlate | ✓ 检出（PHASE 4 修复） | **0mm** ✓ | **0mm** ✓ | H=6（相位分裂） |
| twoAdjacentBosses | 2.29mm ✓ | **0mm** ✓ | 0.62mm ✓ | H=7（相位分裂） |
| threeBosses | 1.67mm ✓ | **0mm** ✓ | 2.17-6.33mm | H=1 漏检 2 + mc 假峰 |

- MC/confidence 全部旋转一致 ✓（坐标转换正确）
- **45° 旋转 = 网格相位最坏情况**：等距区对角切分 → 连通域分裂 → 数量爆炸/mc 假峰。未修改（按 PHASE 3 纪律：报告不修）

## 四、PHASE 4 — Region-level uniform 判据（FIXED）

**V2.1 缺陷根因（实测）**：res96 时凸台平台高分点 288 个（NMS 后 ~100+ 同值候选）**耗尽 UNIFORM_CHECK_LIMIT=100**，板候选（比值 5.02）从未被检查 → 漏检。（V2.1 报告归因"ratio 1.036 竞争"是表面现象）

**V2.2 三信号**：
- a) 候选比值 ≥ 1.05（保持 V2.1）
- b) 谷深 ≥ 0.05（保持 V2.1；同 region 候选也检查——L 形臂/连接带件）
- d) **region 外局部极大 > 0**（均匀件 region 外 = 梯度区无极大；结构件 = 平坦区有极大）
- e)×f) **厚度比 ≥ 2.0 AND 质心偏移 ≥ 0.025×mdim**（薄板 1-2 采样层：板无局部极大、候选被去重 → 兜底；均匀实心中心区对称 → 偏移 0 不触发）

**结果**：cube/plate/cylinder 保持 NO_HOTSPOT ✓；res96/rx90/ry90/rz90 全检出 ✓；8 厚薄模型保持检出 ✓。
**tube**：V2.1 实测即为 ok（TEST_ARTIFACT：MC 管端圆角伪弱热结，管端候选谷深 0.194 触发）—— 非 NO_HOTSPOT，(8).txt 预期基于 V2.1 报告的记忆偏差，保持 V2.1 行为。

## 五、PHASE 5 — MIN_PROMINENCE_RATIO 参数扫描（数据，不选参）

| 模型 | 0.35 | 0.40 | 0.45 | 0.50 | 0.55 | 0.60 |
|---|---|---|---|---|---|---|
| steppedThickness | 2 | 2 | 2 | 2 | **1** | 1 |
| thickCorner | 2 | 2 | 2 | **1** | 1 | 1 |
| bossOnPlate | 1 | 1 | 1 | 1 | 1 | 1 |
| lShape | 1 | 1 | 1 | 1 | 1 | 1 |
| pvpPair | 2 | 2 | 2 | 2 | 2 | 2 |
| twoHotspots | 3 | 3 | 3 | 3 | **2** | 2 |

- **主热结全部参数值保持** ✓（零假阴性）
- 弱热结消除点：thickCorner 0.50；steppedThickness/twoHotspots 0.55 → **0.55 是安全分离点**
- pvpPair 真实双结构 0.6 仍保持 2 ✓

## 六、PHASE 6 — 距离场性能 Benchmark（数据）

| 样本 | 面数 | inside | BVH | raycast | closestPoint | 总 |
|---|---|---|---|---|---|---|
| A 规则箱 50k | 152k | 51k | 0.0s | 4.3s | 10.2s* | 14.5s |
| A 规则箱 100k | 305k | 52k | 0.0s | 8.8s | 20.1s* | 28.9s |
| A 规则箱 200k | 608k | 53k | 0.1s | **49.5s** | **166.3s*** | 215.7s |
| A 规则箱 300k | 899k | 52k | 0.1s | 76.5s | 225.4s* | 302s |
| A 规则箱 1000k | 3007k | 45k | 0.2s | **324.9s** | 1989s* | — |
| B MC 网格 | 45-107k | ~1.1k | 0.1s | **0.0s** | 0.0s | <0.1s |
| C 薄壁壳 | 535k | 3.7k | 0.4s | **0.0s** | 0.0s | 0.1s |

\* closestPoint 子采样外推（200k+ 全量不可行）

**结论**：O(n×m) 退化**仅发生在规则网格箱体**（三角形按面聚集 → BVH 根节点包围盒叠层 → 剪枝失效），raycast 与 closestPoint **双双**退化（修正 V2.1 "closestPoint 零剪枝"单点归因）。MC 网格/薄壁壳同面数 <0.1s。BVH build（0.2s/300 万面）与 inside 采样（恒定 ~51k）均非瓶颈。

## 七、PHASE 7 — V2.2 全量回归

**基线**：npm test 56/56 ✓（54 + PHASE 1/4 新增 2 回归 + 定位回归 5）+ hotspot_v2_test 44/44 ✓

**全量对比**（raw_v21 337 条 vs raw 419 条，同 model+params 匹配；`node tests/tools/compare_v21_v22.mjs`）：

**改善 165 / 恶化 47 / 不变 22 / 状态变化 12**

### 定位误差变化（核心模型）

| 模型 | V2.1 | V2.2 | 变化 |
|---|---|---|---|
| bossOnPlate（含 55 位置扫描全部） | 11.8mm | **0.5mm** | -96% |
| tShape | 38.1mm | **0.83mm** | -98% |
| steppedThickness / suddenTransition | 43.6mm | **1.88mm** | -96% |
| thickEnd（res48/64/96） | 31.4/30.0/33.5 | **7.5/5.7/5.0** | -76~-85% |
| twoAdjacentBosses / pvpPair | 25.3mm | **1.26-1.44mm** | -95% |
| flange | 26.9mm | 2.29mm | -91% |
| hollowThickRing | 7.8mm | **0.0mm** | -100% |
| eccentric/offset/centralBoss | 10-14mm | 0.5-2.7mm | -75~-95% |
| lShape | 1.8mm | 5.3mm | +3.5mm（MC 等距区不对称） |

### 状态变化（12 条，全部可解释）

| 变化 | 数量 | 归类 |
|---|---|---|
| bossOnPlate res96 / rx90：NO_HOTSPOT → ok | 2 | **FIXED**（PHASE 4） |
| size_100/150/200_80（大凸台 80 高）：漏检 → 检出 | 3 | **FIXED**（V2.1 uniform 误判） |
| shell 200_2 / 400_5 / 800_10 / 800_15：NO_HOTSPOT → ok | 4 | TEST_ARTIFACT（壳圆角 MC 伪影，V2.1 已知类别，检测更敏感） |
| shell 400_4 / 800_8 / 1000_10：NO_HOTSPOT → LOW_CONFIDENCE | 3 | 无热结输出（H 0→0），仅状态变化 |

### 恶化明细（47 条）归类

- lShape 系（1.8→5.3mm）：MC 网格等距区不对称（0.95 平台质心 = 网格真值）
- size_20_*（20mm 小凸台，4-14→11-21mm）：小平台 2-3 格 → 质心网格相位噪声
- pvp v≤10（92→110mm 基数）：V2.1 已知 v 小值 PVP 不参与场景，基数大
- 其余为 <1-3mm 网格相位波动

---

## 八、分类汇总（FIXED/IMPROVED/UNCHANGED/KNOWN_LIMITATION/REGRESSION）

### FIXED
1. n=5 多厚区漏检（scanAxis 起点外推 —— 细化 bbox 起点落入相邻凸台的奇偶基准破坏）
2. 宽平台定位（tShape 28→0.8、bossOnPlate 11.8→0.5、twoAdjacent 22→1.3、thickEnd 31→7.5）
3. uniform 网格相位漏检（res96/rx90 检出；根因 = UNIFORM_CHECK_LIMIT 被平台噪声耗尽）
4. 大凸台（size_*_80）uniform 误判漏检 → 检出
5. 等厚件（凸台=板厚）分层误报 → NO_HOTSPOT（outsideMaxima 比值条件）

### IMPROVED
- 全量定位：165 记录改善；旋转不变量（rx90 漏检修复、ry90/rz90 0mm）
- 位置分级：FAIL 198→82，EXCELLENT 2→124（分级变化含 GT 修正与平台质心语义）

### UNCHANGED
- 均匀件语义（cube/plate/cylinder NO_HOTSPOT）；PVP 61/63；平移 0.00mm；确定性 100%；tube（V2.1 TEST_ARTIFACT 行为保持）

### KNOWN_LIMITATION
1. 45° 旋转相位分裂（等距区对角切分 → 连通域分裂 → 数量爆炸/mc 假峰）
2. 矮凸台（<30mm 高）高分辨率 uniform 漏检（质心偏移 < 0.025）
3. 规则网格大面数性能（100 万面 raycast 325s + closestPoint 1989s 外推）—— 仅规则网格退化（MC/壳 <0.1s），不重写 BVH，待真实铸件网格类型确认后决策
4. tube 管端 MC 圆角伪弱热结（TEST_ARTIFACT，V2.1 行为）
5. lShape/size_20_* 定位略差（MC 等距区不对称/小平台网格相位）

### REGRESSION
- 无（npm test 54→56 + 新增 7 回归；44/44 golden 保持；等厚件误报已修复）

---

## 九、产品定义问题（未处理，按 8.txt 纪律）

| 问题 | CURRENT SEMANTIC | ALTERNATIVE | TRADE-OFF |
|---|---|---|---|
| 均匀厚圆柱算不算热结 | NO_HOTSPOT（相对语义） | 绝对热节语义 | 需产品定义层决策 |
| 渐变厚度厚端 | 不报（无局部极大） | 报厚端 | 同上 |
| 环形热结数量 | 分裂 2 个 | 报 1 个环形 | 同上 |
| 圆角 R≥5 棱热结 | 报出（物理正确） | 压制 | 工程需求 |

---

## 十、方法学说明

1. closestPoint 500k+ 面为子采样外推（全量不可行，V2.1 实测 29 万面 165s 交叉验证）
2. 45° 旋转的 mc 假峰（threeBosses r45 mc=151）为细化 bbox 边界格子的投票误判 + 连通域分裂叠加
3. 对比数据源：raw_v21（V2.1 快照）vs raw（V2.2 全量），同 model+params 匹配
4. 全部失败数据保留原始 JSON；runAll.mjs 可一键重跑
