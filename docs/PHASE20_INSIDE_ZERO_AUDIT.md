# PHASE 20 — 距离场 0 内部采样点总审计报告（只读诊断，未修复）

日期：2026-08-24 ｜ 命令：25.txt ｜ 性质：**纯诊断**——零引擎/UI/测试修改，仅新增只读脚本 `tests/phase20_probe.mjs`

## 0. 版本来源的诚实说明（25.txt 二）

| 来源 | 内容 | 可用性 |
|---|---|---|
| git（1 个 commit v0.16）| `js/engine/` 从未被 git 追踪 | ✗ 无引擎基线 |
| `js/engine/v3/legacy/` | 12.txt 时代（V3 早期）快照 | ✗ ≠ PHASE 16 状态 |
| `dist/CastingToolbox-source/` | v0.15 打包，不含 js/engine | ✗ |
| **文件时间戳**（权威）| distanceField/stlDiagnostic/geometryAnalysis 仅 PHASE 19（Aug 23 15:20-38）改过；sampling/configV3 仅 PHASE 18（13:43-44）；v3ViewAdapter 仅 PHASE 17（13:26）| ✓ **PHASE 16/17/18 的 V2 距离场 = 同一版本，从未被修改** |

→ PHASE 16/17/18 版 buildDistanceField 用等价重建（单级单相位、maxResolution=96，仅存在于 probe 内）；PHASE 18 前 V3 采样同样等价重建（16³ 单级探测 + 主网格单次）。**无法从 git 精确恢复中间状态是事实，但时间戳证据链完整，重建可信度高。**

## 1. 版本行为对照（25.txt 二核心表，模型 shell3000_w25——PHASE 19 原触发）

**V2 距离场（diagnoseSTL 提示来源）：**

| 版本 | resolution | voxelSize | 总采样点 | inside点 | valid | wallMain | status |
|---|---|---|---|---|---|---|---|
| **PHASE 16** | 48³ | 62.47mm | 110592 | **0** | 0 | 0 | INSUFFICIENT_NO_SAMPLE |
| **PHASE 17**（V2df 未动）| 48³ | 62.47mm | 110592 | **0** | 0 | 0 | INSUFFICIENT_NO_SAMPLE |
| **PHASE 18**（V2df 未动）| 48³ | 62.47mm | 110592 | **0** | 0 | 0 | INSUFFICIENT_NO_SAMPLE |
| **PHASE 19** | 192³ | 15.62mm | 7077888 | **190576** | 190576 | 17.8 | LOW |

**回答 25.txt 二的核心问题：「到底是哪一个 PHASE 第一次把 inside 变成 0，或者从一开始就为 0？」→ 从一开始就为 0（PHASE 16）。** V2 距离场 48³（minWallLayers 升到 96 上限）对"3m 壳壁 25mm"这种"大件+相对薄壁"从 PHASE 16 起就是 0 内部点；PHASE 17/18 从未触碰 V2 距离场（它们修的是 V3 采样链与 Adapter 显示）；PHASE 19 才第一次修复（0→190576）。

**V3 采样链（对照：PHASE 18 前后）：**

| 模型 | PHASE 18 前（重建）| PHASE 18 后（当前）|
|---|---|---|
| shell3000_w25 | 16³ 探测 0 点→vs=37.5→主网格 inside=14000 | 探测到 64 级→主网格 inside=**42438** |
| shell1000_w3 | 16³ 探测 0 点→vs=12.5→主网格 inside=**0**（真 NO_INSIDE_POINTS）| 探测到 128 级→主网格 inside=**13120** |
| shell1000_w20 / t19 / cube200 | 与 PHASE 18 后完全一致（16³ 探测即成功）| 零开销 ✓ |

→ PHASE 18 修复有效：真 0 内部点模型 0→13120；正常模型零回归。

## 2. 全链审计结论（25.txt 三/四/五/六）

| 环节 | 结论 | 证据 |
|---|---|---|
| 坐标系/变换（ROOT-C）| **排除**。buildMesh 零变换（mesh3d.js:22-31），parseSTL→vertices→geometry→BVH→采样点同一空间 | 平移变体 shell1000_w20+（12345,-6789,31415）与未平移结果**逐字段一致**（inside=66090）|
| 采样网格生成（ROOT-A）| **排除**。总采样点恒 = gs³ 满格，坐标范围=bounds 内（对 7 模型均验证）| 版本表「总采样点」列 |
| inside 判定（ROOT-B）| **对健康网格排除**。引擎判 inside 的采样点独立复验（独立 8 方向射线投票，与 scanInside 零共用）**0 不一致**（6/6 健康模型）| shell3000/2000/1000_w20、平移、cube200、t19 均 0/51 不一致 |
| 中心点（25.txt 五）| **壳体中心 outside 是正确行为**——空腔！BVH 距离证实：3m 壳中心距表面 575mm、2m 壳 380mm、1m 壳 280mm、t19 阀体 44.9mm（内腔）；cube200 中心 INSIDE ✓ | 判内外工作正常 |
| 闭合 ≠ 可判定（ROOT-D）| **存在实证**：shell1000_w3（壁 3mm 在 tetMC 160 单元下 <1 格）网格 closed=true、0 边界边，但两个独立判内外实现互不一致（引擎 inside 点 8/51 被独立法否决、独立法判 50/50 网格点 inside 而引擎判 outside）→ **自交/病态网格导致射线奇偶失效** | **validateMesh 盲区**：只查边界边+退化三角（meshValidation.js:38-68），**不查自交/非流形边（>2 三角共享）**——非流形边计数仍为偶数 → 误报 closed |
| 分辨率策略（ROOT-E）| PHASE 16/17/18 版确实是根因（见第 1 节）；PHASE 19 修复后**残余边界**：壁厚 < mdim/256 仍 0（1m 件 <3.9mm、3m 件 <11.7mm）| shell1000_w3 理论下界验证 |

## 3. 路径一致性（25.txt 七，ROOT-G）

- `designCenter.js:481` `diagnoseSTL(state.mesh, state.geometry, state.hotspots)` 与 phase19_probe/phase20_probe 的调用**同函数、同参数（opts={}）**。
- 同步 `buildDistanceField` vs 分片 `buildDistanceFieldSliced`（Design Center 449 行 geometry 分析用分片）：shell1000_w20 逐字段一致（gs=96、inside=66090、dists 全等）→ **ROOT-G 排除**。
- PHASE 19 报告中的「190576 个内部点」= 当前 Design Center 同一条代码路径 ✓。

## 4. 生命周期审计（25.txt 八/九，ROOT-H）

- importFile（designCenter.js:396-515）：每次导入全新流程——481 行 `state.diag` 当次赋值；408 `proj.clearStlBoundData()` 先清旧绑定；409 清会话指纹；无 diag 缓存/localStorage 持久化。
- deleteStl（:333-347）：清 mesh/geometry/analysis/hotspots/diag/results → 无幽灵。
- UI（renderGeomInfo:747）读 state.diag = 当次计算结果。
- → **ROOT-H 无证据，排除**。

## 5. 意外发现（PHASE 19 引入的缺陷，记录不修——本阶段禁止）

**`buildDistanceField` 多级循环耗尽（break）出口的 `gs`/`vs` 未同步为最后一级**（distanceField.js:181-212）：循环内仅 return 时更新 `gs`，循环耗尽时返回的 `gs` 是初始值（48），但 `pts/insideIdx/dists` 是最后一级（256³）的数据。

- 实证：shell1000_w3 显示 `gs=48³ vs=20.83 总采样=110592`，但 `inside=198161 > 110592`（单相位容量）→ 标签与实际网格错配。
- 影响：仅"不满足停判据"的模型（病态/深欠采样）——诊断面板显示错误的 gs/vs（如 vs=20.83 实际 3.9）。**不影响 inside 点数本身**（inside 计数正确）。健康模型第一级即 return，零影响。
- 分类：ROOT-F（PHASE 19 引入）但**非 inside=0 根因**，属显示/报告缺陷，PHASE 21 修复候选。

## 6. 根因分类（25.txt 十一，唯一分类）

**ROOT-I（多原因叠加）——按优先级：**

1. **第一根因（历史）＝ ROOT-E**：V2 距离场分辨率策略不足（48³/96 上限）对"大件+相对薄壁"从 **PHASE 16 起就是 0 内部点**（非 PHASE 17/18/19 改坏）。PHASE 19 修复后该类别已消除（shell3000 0→190576），**残余边界 = 壁厚 < mdim/256**。
2. **第二根因（残余）＝ ROOT-D**：真实 STL 若"closed 但 inside=0"且壁厚 ≥ mdim/256——**最可能是网格病态**（自交/非流形/重叠面）：validateMesh 只查 open 边，不查自交与非流形边，"显示闭合"≠"可判定内部"。shell1000_w3 已实证此类网格真实存在判定失效。
3. 附随缺陷：PHASE 19 gs/vs 标签错配（ROOT-F 轻微，见第 5 节）。

**排除**：ROOT-A（采样网格生成）、ROOT-B（健康网格判定）、ROOT-C（坐标系）、ROOT-G（路径不一致）、ROOT-H（UI 旧结果）。

## 7. PHASE 17/18/19 逐项判定（25.txt 十三.4）

| 阶段 | 判定 | 理由 |
|---|---|---|
| PHASE 17（Adapter 分级警告）| **正确** | 只改显示层；WARNING 四级有工程意义；未动引擎/阈值 |
| PHASE 18（V3 采样探测升级）| **正确** | 真 0 内部点模型 0→13120；正常模型零开销零回归；未动 V2 |
| PHASE 19（V2 距离场多级+双相位+wallMain p95）| **正确，但含小缺陷** | 0→190576 修复实证；wallMain p95 修正合理；缺陷＝循环耗尽出口 gs/vs 标签错配（第 5 节，不影响 inside 计数与健康模型）|

## 8. 是否需要回滚（25.txt 十三.5）

**不需要。** 三个阶段的修复方向均经数据证实有效（V2 链 0→190576、V3 链 0→13120、wallMain 恢复）；缺陷是显示层标签错配，不是 inside=0 根因，PHASE 21 修复即可。**回滚任何阶段都会退回 PHASE 16 的 inside=0。**

## 9. 诚实声明（25.txt 十）

**当前工作区没有用户的真实失败 STL**（tests/real-stl/ 仅有 golden 模型 diag 快照）。因此：
- **「当前无法证明真实 STL 已解决」**——所有结论基于 7 个构造/工程模型的全链路径验证。
- PHASE 19 后真实 STL 仍 inside=0 的候选解释（按概率）：① 用户在 PHASE 19 修复前测试；② 壁厚 < mdim/256（残余 ROOT-E）；③ 网格病态但"显示闭合"（ROOT-D，validateMesh 盲区）。**无法区分，必须用真实 STL 复现。**

## 10. 下一步唯一修复方案（25.txt 十三.6，本阶段禁止实施）

**方案（唯一）：用户提供真实失败 STL → 我用 phase20_probe 跑「0 inside 判定分流」**：
- 独立判内外（probe 已有）在该 STL 上找到 inside 点 → ROOT-B 引擎判定 bug，修 scanInside；
- 独立判内外也 0 → 网格病态（ROOT-D）→ PHASE 21 给 validateMesh 增加自交/非流形检测 + 诊断面板明示；
- 壁厚 < mdim/256 → ROOT-E 残余 → 评估"按壁厚自适应而非 bbox"的采样策略（仅当 ① 证实）。
附：PHASE 21 同时修复第 5 节 gs/vs 标签错配（一行级修改）。

无真实 STL 之前，**不做任何修复**（25.txt 一：禁止一切修改）。

## 11. 验证方式

- `node tests/phase20_probe.mjs` → 7 模型全链诊断表（本报告数据来源，只读）
- 引擎/UI/测试零改动（git status 仅新增 phase20_probe.mjs 与本文档）
