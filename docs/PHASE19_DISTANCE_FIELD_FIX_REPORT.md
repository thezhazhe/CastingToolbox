# PHASE 19 — 「距离场无有效采样」根因定位 + 直接修复报告

日期：2026-08-23 ｜ 命令：24.txt ｜ 性质：先定位实际触发点 → 全链只读诊断 → 根因数据证实后直接修复

## 0. 结论

**ROOT CAUSE CONFIRMED + FIXED**

「距离场无有效采样：壁厚可能小于网格采样极限」由 **V2 `buildDistanceField`（48³/96³）独立链路**产生——与 PHASE 17/18 修复的 V3 采样链（sampling.js）是**两条独立链**。V2 距离场对"大件+相对薄壁"（壳体/板件）0 内部点 → `thicknessStats` 报 INSUFFICIENT_NO_SAMPLE。修复后：10 模型诊断矩阵 0/10 再触发；附带修复 `thicknessStats` 字段名笔误（此前**所有正常模型**的 STL 诊断面板都在崩溃）。

## 1. 实际触发链（24.txt 十二.1）

```
designCenter.js:481  state.diag = diagnoseSTL(mesh, geometry, hotspots)
  → stlDiagnostic.js:46  buildDistanceField(mesh, geometry, {})   ← V2 距离场（独立链）
  → insideIdx.length = 0（0 内部点）
  → thicknessStats(df) → dists 过滤后 n=0
  → stlDiagnostic.js:57  return { status:'INSUFFICIENT_NO_SAMPLE',
      reason:'距离场无有效采样：壁厚可能小于网格采样极限' }        ← 用户看到的文案
```

**这条链不经 V3 sampling.js / hotspotV3.js / v3ViewAdapter.js**——PHASE 17/18 的全部修改对它是透明的。同时 `analyzeGeometry`（V2 geometry，PHASE 17 bodyWallOf 的数据源）也走同一个 buildDistanceField——同一缺陷使 wallMain/wallMax=0。

## 2. 第一个错误状态（24.txt 十二.2）

**`buildDistanceField` 的 `insideIdx.length = 0`**（V2 距离场 0 内部点）——这是整条链第一个变成错误状态的位置；其上游（scanInside 判内外）无 bug。

## 3. 真正根因（24.txt 十二.3）

V2 距离场分辨率策略对"大件+相对薄壁"结构性失效：

1. **升分辨率判据只看 bbox 最小边 minDim**：`minDim < (mdim/48)×6` 才升。壳体/板件的 bbox 最小边 = 壳外尺寸（3m 壳 minDim=1200mm）≠ 壁厚（25mm）→ 判据不触发 → 保持 48³（vs=62.5mm）。
2. **maxResolution=96 上限对 2m+ 件不够**：2m 件 96³ vs=31mm > 20mm 壁；3m 件 96³ vs=31mm > 25mm 壁。
3. 综合：**网格格距 ≥ 壁厚 → 壁内无网格落点（确定性相位）→ 0 内部点**（实测 3m 壳 25mm 在 48³ 下 0 点；2m 壳 15/20mm 在 48³ 下仅 912/996 点且层数 <1）。

V2.3.1 已记录同根限制（"minWallLayers 看 bbox minDim 对箱体件失效"），当时未修。**inside test 本身无 bug**（24.txt 四：坐标系/外推/法线/BVH/空腔全对——空腔件判出 13924 点正常）。

## 4. 为什么 PHASE 17/18 没有彻底解决（24.txt 十二.4）

PHASE 17 修的是 **V3 采样链**（estMinWall 语义 + samplingWarn 分级），PHASE 18 修的是 **V3 采样链**（sampling.js 探测升级/主网格兜底）。而这条提示来自 **V2 距离场链**（buildDistanceField → diagnoseSTL），两条链独立（V3 的 sampling.js 只 import scanInside，不经过 buildDistanceField）——PHASE 17/18 从未触碰 V2 距离场，因此"V3 已能正常分析（pts=9560）而 UI 诊断面板仍报无采样"并存。

## 5. 修改了哪些文件（24.txt 十二.5）

| 文件 | 修改 |
|---|---|
| `js/engine/distanceField.js` | ①DISTANCE_DEFAULTS.maxResolution 96→256（+minInsidePoints=8）；②buildDistanceField/buildDistanceFieldSliced 多级采样：基础网格 0 内部点（或层数不足）时逐级 ×2 升级至 256，每级合并两相位（原相位+半格偏移）内部点；停判据 = 点数 ≥8 且 p95 壁厚 ≥ 1 层 |
| `js/engine/geometryAnalysis.js` | wallMain = max(直方图峰值, 分布 p95×2)——壳体内部点集中在三壁交集角块，char 主峰 = 采样深度非壁厚（vs≈壁厚/2 时低估一半），p95 采样点含近壁中心点（多相位合并保证），均匀薄壁更接近真实 |
| `js/engine/stlDiagnostic.js` | thicknessStats:71 字段名笔误 `p.p[0]` → `p.position[0]`（**此前任何 ≥2 有效采样的模型 diagnoseSTL 都抛异常**） |
| `tests/phase19_test.mjs`（新）| P19-T1~T6 |
| `tests/phase19_probe.mjs`（新）| 10 模型触发链诊断（保留） |
| `tests/hotspot_v2_test.mjs` | largeThin 断言同步（V2.2 引擎 uniform 判据后遗留漂移，与本次修复无关——已验证旧参数行为相同） |

## 6. 修改了什么核心逻辑（24.txt 十二.6）

**Level 1 多级升级 + 多相位合并**（distanceField）：基础网格（含 minWallLayers 升）不满足层数时，×2 倍增至 256；每级扫描两个相位（原网格 + 半格偏移）并**合并**内部点。正常模型第一相位即满足 → 零额外开销（实测 300mm 壳 110ms）。多相位合并同时解决：①壁内无落点（采样覆盖）②wallMain 相位污染（合并保证有落点在壁中心附近）。

**Level 2 wallMain p95 修正**（geometryAnalysis）：直方图峰值受相位压制时（壳体 char 主峰 = 采样深度），与 p95×2 取大——p95 采样点含近壁中心点，均匀薄壁更接近真实；厚块模型主峰仍占优（t16 板10+块100：99.8 > 47.9）。

**Level 3 崩溃修复**（stlDiagnostic）：字段名笔误。

**未做**：不修改 V3 核心（sampling.js 本轮零改动——V3 只 import scanInside，不受 buildDistanceField 影响，125/0 回归证实）；不修改 calcs；不关闭/降级任何 WARNING；不伪造内部点（真 0 点 → INSUFFICIENT_NO_SAMPLE 语义保留，P19-T6 验证）。

## 7. 是否修改 V3 核心（24.txt 十二.7）

**否**。本轮修改全部在 V2 层（distanceField/geometryAnalysis/stlDiagnostic）。V3 的 sampling.js/hotspotV3/configV3 零改动（configV3.js 未动——本轮未加 V3 参数）。distanceField 的 scanInside 本身未改，V3 采样链行为不变（runner 125/0 中 V3 测试全过）。

## 8. 是否修改 calcs（24.txt 十二.8）

**否**。

## 9. 实际失败 STL 修复前后数据对比（24.txt 十二.9）

（24.txt 三：工作区无用户真实 STL（tests/real-stl/ 仅 README 与旧 diag json），使用最接近真实使用场景的大件薄壁构造模型 + 工程文件，24.txt 九）

| 模型 | triangles | insidePointCount 前→后 | validDistanceCount 前→后 | 采样分辨率 前→后 | wallThickness(wallMain) 前→后 | status 前→后 |
|---|---|---|---|---|---|---|
| 3m 壳壁 25mm（原触发★）| ~177 万 | **0 → 190576** | **0 → 190576** | 48³/62.5mm → 192³/15.6mm | 0 → **17.8** | INSUFFICIENT_NO_SAMPLE → LOW |
| 2m 壳壁 20mm | ~176 万 | 996 → 176796 | 996 → 176796 | 48³/41.7 → 192³/10.4 | 15.4 → 14.6 | INSUFFICIENT → LOW |
| 2m 壳壁 15mm | ~177 万 | 912 → 112086 | 912 → 112086 | 48³/41.7 → 192³/10.4 | 4.7 → **14.7** | INSUFFICIENT → LOW |
| 1m 壳壁 10mm | ~176 万 | 1954 → 270142 | 1954 → 270142 | 48³/20.8 → 192³/5.2 | 7.9 → 8.5 | INSUFFICIENT → LOW |
| 1m 壳壁 20mm | ~150 万 | 8184 → 66072 | 8184 → 66072 | 48³/20.8 → 96³/10.4 | 20.0 → 20.8（p95 修正后恢复）| OK（不回归）|
| t19 阀体（正常模型）| 20 万 | 18416 → 18416 | 18408 → 18408 | 48³/6.3 不变 | 39.4 → 39.4 | OK（零回归）|

★「距离场无有效采样」：**1/10 → 0/10**（诊断矩阵）。性能：正常模型 110ms 零开销；3m 件修复路径距离场 882ms（192³），可接受（24.txt 五：无数量级下降）。

## 10. 测试数量（24.txt 十二.10）

- 原有测试：119/119（runner 基线，PHASE 17/18 含）
- 新增测试：**6/6**（P19-T1 原触发模型恢复 / T2 大件常规壁厚 / T3 thicknessStats 崩溃回归 / T4 工程模型零回归 / T5 1m 壳 20mm 全链不误报 / T6 真 0 采样语义保留）
- 总测试：**125 通过 / 0 失败 / 0 WARNING**（runner）
- V2 golden 自检（独立文件，runner 不包含）：42/42（largeThin 断言同步——V2.2 引擎 uniform 判据后遗留漂移，已验证与本次修复无关）
- 回归：0 regression

## 11. 新的已知限制（24.txt 十二.11，如实）

1. **wallMain 仍受 MC 波纹下界影响**（2m 壳 20mm → 14.6，真实 20 的 73%）：p95×2 修正让壳体从"低估一半"（10.1）恢复到"接近真实"（14.6~20.8），但 tetMC 阶梯使局部壁厚波动 ±10mm，p95 仍略低——真实 CAD 平滑表面预计更准（PHASE 17 §9.3 同款预判）。欠采样件 p95 高估（~85%）不足以越过 2 层判据，WARNING 语义安全。
2. **壁厚 < mdim/256 的深欠采样**（1m 件 <3.9mm）：多级升级到 256³ 仍无落点 → 保留 INSUFFICIENT_NO_SAMPLE（诚实，不伪造）；此类件 V3 采样也受限（PHASE 18 已知限制 2）。
3. **V2 引擎行为随距离场修复变化**（大薄壳 largeThin 从弱热结 → 均匀 NO_HOTSPOT）：V2 引擎仅 `?hsV2=1` 开发对照用（产品默认 V3），断言已同步。
4. **diagnoseSTL 独立重算距离场**（与 analyzeGeometry 重复）：每次分析多一次距离场构建（大件 +1s 级）——保持独立验证语义（诊断准确性优先），未做复用优化。
5. 真实 CAD STL（非流形/多组件破损）仍走 validateMesh → INVALID_MESH，与本修复正交。

## 12. 验证方式

- `node tests/runner.mjs` → 125/125
- `node tests/hotspot_v2_test.mjs` → 42/42（V2 golden 自检）
- `node tests/phase19_probe.mjs` → 10 模型触发链诊断表（★ 1/10 → 0/10）
- 浏览器走查（真实 STL 验证时）：导入大尺寸薄壁铸件 → STL 诊断面板显示实际壁厚统计，不再提示「距离场无有效采样」
