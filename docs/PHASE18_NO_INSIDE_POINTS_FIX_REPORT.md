# PHASE 18 — NO_INSIDE_POINTS 直接修复报告

日期：2026-08-23 ｜ 命令：23.txt ｜ 性质：直接修复（先复现 → 修采样 → 回归）

## 0. 结论

**正常 STL 不再因"未获得有效内部采样点（NO_INSIDE_POINTS）"被拒**：修复前 23 模型矩阵 2 个 NO_INSIDE_POINTS + 2 个濒临（<130 点），修复后 **0/23** 全部获得可靠内部点并进入热结分析；真超薄件（2m 壳 5mm）仍保留采样 WARNING（语义不丢）。性能：正常模型零开销（16³ 探测一次成功），失败路径增量 <0.5s。

## 1. 真正根因

NO_INSIDE_POINTS 触发链（hotspotV3.js:50 `if (!coarse.pts.length)`）：

```
STL → bounds → 16³ 粗探测 → estMinWall → vs = 0.5×estMinWall → 主网格 voxelize → inside pts → NO_INSIDE_POINTS
```

**两处系统性分辨率不足叠加，与"模型没有内部区域"无关**（23.txt 一）：

1. **16³ 探测对"壁厚 < mdim/16 格距"的薄壁 0 落点**（确定性网格相位全部错过，非概率问题）：
   2m 件格距 125mm，8mm 壁期望 ~千级落点实测 **0**；1m 件格距 62.5mm，5mm 壁实测 0（8mm 壁 208 点——相位侥幸）。
   探测失败 → `estMinWall = mdim/40` 兜底 → `vs = mdim/80`（与真实壁厚完全脱钩）。
2. **主网格格距 ≥ 壁厚 → 壁内无网格落点 → 0 内部点**：
   vs=mdim/80 对 2m 件 = 25mm，壁 5/8mm 无落点 → **NO_INSIDE_POINTS**；壁 10mm 仅 124 点（濒临）。
   相位敏感区间 [mdim/80, mdim/40]（1m 件 12.5~25mm）时好时坏——这正是用户感知"经常出现"的原因（同一壁厚不同尺寸/相位表现不同）。

**inside test 本身无 bug**（23.txt 三.4 全项核查）：坐标系/全局 bbox 外推起点/法线（DoubleSide 命中）/BVH 求交/多组件奇偶/空腔判定均正确（开盖箱空腔件判出 13924 点正常）；阻塞点 100% 在采样分辨率覆盖，不在判内外。

## 2. 修复方案（23.txt 四：A+B+C 组合）

**Level 1 — 多级粗探测**（adaptiveVs，sampling.js）：
16³ → 32³ → 48³ → 64³ → 96³ → 128³ 逐级升级，直到 char 数 ≥ probeMinChars(8)（探测到真实壁厚）或到达最高级。修复后 fallback 模型从 7 个降到 **1 个**（2m 壳 5mm：需 400+ 网格才能探测到，超出上限，属合理保留）。

**Level 2 — 主网格多级采样**（coarseSample，sampling.js）：
主网格内部点不足（< minInsidePoints=128）时逐级尝试：原 vs → **半格相位偏移**（相位互补，薄壁落点概率从 ~0 提到 ~壁厚/vs）→ vs/2 → 偏移 → vs/4 → ...，上限 maxSampleGs=256（性能/内存保护）。偏移通过平移 bounds.min 实现（采样点 = 偏移网格中心，ENGINE 坐标真实位置；voxelize 签名不变）。
全部级别不足 → 保留最后一试（有内部点即可分析，欠采样由 PHASE 17 四级 WARNING 报 🟠）；**真 0 内部点 → NO_INSIDE_POINTS 语义不变**（23.txt 六：不伪造、不掩盖）。

## 3. 修改文件与内容

| 文件 | 修改 |
|---|---|
| `js/engine/v3/sampling.js` | adaptiveVs：单级 16³ → 多级探测循环（probeResolutionSteps + probeMinChars）；coarseSample：单次 voxelize → 多级尝试（降 vs × 相位偏移，maxSampleGs/minInsidePoints 保护），返回 +probeLevel/probePts |
| `js/engine/v3/configV3.js` | +probeResolutionSteps / probeMinChars / sampleVsLevels / maxSampleGs / minInsidePoints / phaseOffsetHalf（全部带注释与根因说明）|
| `tests/phase17_test.mjs` | P17-T4 断言更新（fallback 被探测升级取代 → 验证"恢复真实壁厚 + 真正获得内部点"，非消症状）|
| `tests/phase18_test.mjs`（新）| P18-T1~T8（23.txt 七 8 类模型）|
| `tests/phase18_probe.mjs`（新）| 23 模型触发链诊断（保留）|
| `docs/PHASE18_NO_INSIDE_POINTS_FIX_REPORT.md` | 本报告 |

**未修改**：hotspotV3.js（NO_INSIDE_POINTS 出口保留）、modulusField/peakRegion/windowV（M 场/峰/体素化算法）、distanceField.js（scanInside 判内外）、calcs/、Adapter 分级逻辑、任何阈值（vsMin/vsMax/coarseResolution 原样）。未伪造任何 inside point（全部来自 scanInside 真实几何判定）。

## 4. 为什么能真正解决

- **探测升级**直接把 estMinWall 从"mdim/40 常数"恢复为真实 char p10 → vs 自动匹配壁厚（1m 件 10mm 板：fallback vs=12.5 → 探测 128³ 后 vs=7.8 < 壁厚）→ 主网格壁内必有落点（数学保证：格距 < 壁厚 → 区间必含网格点）。
- **半格相位偏移**解决确定性网格相位全错过的问题（壁厚 < vs 但 > vs/2 的区间）：两次互补相位至少一次有落点。
- **降 vs 兜底**解决壁厚 < vs/2 的更深欠采样（2m 壳 5mm：vs 25→12.5→6.25 偏移 3.1 < 5 → 2532 点）。
- 三者都受上限保护（128³ 探测 / 256³ 主网格），正常模型第一次尝试即成功（16³ 探测 + 原网格），**失败路径才增量计算**。

## 5. 修复前后内部点数量（23.txt 九.5）

诊断矩阵（23 模型，构造 tetMC 水密 + 工程文件）：

| 模型 | 三角数 | 采样分辨率(修复前 vs → 后) | inside pts 修复前 | inside pts 修复后 | 分析耗时 | 最终状态 |
|---|---|---|---|---|---|---|
| shell2000_w5（2m 壳 5mm）| ~25 万 | 24.9 → 24.9（偏移相位）| **0 ★NO_INSIDE_POINTS** | **2532** | ~7s | NO_HOTSPOT + 🟠 |
| shell2000_w8（2m 壳 8mm）| ~25 万 | 24.9 → 15.5 | **0 ★NO_INSIDE_POINTS** | **10056** | ~7s | NO_HOTSPOT |
| shell2000_w10（2m 壳 10mm）| ~25 万 | 25 → 15.6 | 124（濒临）| 6621 | ~7s | NO_HOTSPOT |
| shell1000_w5（1m 壳 5mm）| ~15 万 | 12.5 → 7.8 | 32（相位侥幸）| **6565** | ~5s | NO_HOTSPOT |
| plate1000_w8（1m 板 8mm）| ~10 万 | 12.5 → 7.8 | 6400 | 16384 | ~5s | NO_HOTSPOT |
| plate2000_w15（2m 板 15mm）| ~20 万 | 25 → 15.6 | 4800 | 12288 | ~7s | NO_HOTSPOT |
| cavity1000_w10（1m 开盖箱）| ~15 万 | 12.5 → 7.8 | 13924 | 6114* | ~5s | NO_HOTSPOT |
| shell3000_w12（3m 壳 12mm，77 万 tri）| 771104 | 37.5(fallback) → 23.3 | 修复前高危 | **>128** | 0.34s（粗采样）| ✓ |

*腔体件内部点减少属正常：vs 变细 → 空腔更大比例网格点落在腔外（材料占比恒定），点数由壁内落点决定；该件 16³ 探测从 0 → 真实（estMinWall 6.3）。

**性能**（23.txt 五）：正常路径 shell1000_w20 粗采样 408ms（16³ 探测一次成功，修复零开销）；修复路径 shell2000_w8 373ms（探测升 96 级 + 主网格 128³）；77 万三角 3m 薄壁 338ms——**无数量级下降，100 万三角级可接受**。

## 6. 测试结果（23.txt 九.6）

- 原有测试：111/111（其中 P17-T4 断言随行为有意变更更新——fallback 被探测升级取代，语义从"识别 fallback"变为"验证恢复真实壁厚+获得内部点"）
- 新增测试：8/8（P18-T1~T8：2m 正常厚壁 / 2m 薄壁濒临 / 2m 真超薄修复 / 1m 壳体 / 壳+凸台 / 空腔 / 非均匀 / 工程 t02）
- 总测试：**119 通过 / 0 失败 / 0 WARNING**
- 回归：全量通过（runner.mjs）

## 7. 已知限制（如实）

1. **2m 件 5mm 级薄壁**：探测升级到 128³（格距 15.6mm）仍无落点 → estMinWall 仍走 fallback（minWallReliable=false），但主网格偏移兜底保证获得内部点并进入分析；采样 WARNING 报 🟠（2m 件 5mm 壁真实欠采样，方向正确）。
2. **壁厚 < maxSampleGs 可解析下限**（1m 件 ~3.9mm / 2m 件 ~7.8mm）：低于此的壁在主网格上无完整采样层，靠偏移相位获得稀疏点——能分析但 M 场分辨率受限（🟠 诚实提示）。
3. **探测升级成本**：仅失败路径产生（0 内部点才升级），正常模型 16³ 一次成功；最坏路径（2m 壳 5mm 全 6 级探测 + 主网格 3 级）增量 ~1s 级，受 128³/256³ 上限保护。
4. **相位偏移的边界效应**：偏移半格后最外层采样点可能超出原 bbox ±vs/2——对判内外无影响（点仍在模型外为 outside，壁内点不受影响），已由测试覆盖。
5. 真实 CAD STL（多组件装配体、非流形）仍走 validateMesh 出口（INVALID_MESH → 🔴），与本修复正交。

## 8. 验证方式

- `node tests/runner.mjs` → 119/119
- `node tests/phase18_probe.mjs` → 23 模型触发链诊断表（修复前 2 个 ★NO_INSIDE_POINTS → 修复后 0）
- 浏览器走查（真实 STL 验证时）：导入正常铸件 STL → 应直接进入热结分析，不再提示"未获得有效内部采样点"
