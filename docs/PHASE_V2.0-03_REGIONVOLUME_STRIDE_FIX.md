# Casting Toolbox V2.0 — PHASE V2.0-03 完成报告

## regionVolume 的 stride³ 确定性 Bug 修复与回归

> 基线：`main` @ `da1c822` ｜ 版本 V1.1.0 ｜ 日期：2026-10-07
> 铁律：**修 Bug，不改模型。** 只把「热结区域的尺子」修准；没有决定冒口该给哪片区域补缩。
> 上一阶段：`docs/PHASE_V2.0-02_VOLUME_CHECK_AUDIT.md`（本 Bug 的发现处）

---

## 1. Bug 根因

### 1.1 原来的计算方式

`js/engine/v3/peakRegion.js` `extractRegion()`：

```js
const cellVol = vs ** 3;          // :129（修复前）
...
const volume = pts.length * cellVol;   // :148
```

### 1.2 为什么少算 stride³

`js/engine/v3/sampling.js:326`（`refineSample()`）：

```js
const stride = Math.max(1, Math.ceil(Math.cbrt(gs ** 3 / o.refineMaxPoints)));   // refineMaxPoints = 8000
```

`gs > 20` 时 `stride ≥ 2`。此时 `pts` 的构建是
`for (i = 0; i < gs; i += stride) ...`（`sampling.js:329`），
**相邻采样点的真实坐标间距是 `vs × stride`，不是 `vs`**。

**2026-10-07 实测确认**（§二 要求，不靠推断）：

| 模型 | 采样 | vs | stride | 实测 pts 最小正间距 [x,y,z] | vs×stride | 结论 |
|---|---|---|---|---|---|---|
| ALR2510 v1_1 | 粗采样 | 4.1919 | 1 | [4.1919, 4.1919, 4.1919] | 4.1919 | ✓ 吻合 |
| ALR2510 v1_1 | 细化 | 4.1919 | 2 | [8.3838, 8.3838, 8.3838] | 8.3838 | ✓ 吻合 |
| HR4012 | 粗采样 | 4.6875 | 2 | [9.3750, 9.3750, 9.3750] | 9.3750 | ✓ 吻合 |
| HR4012 | 细化 | 4.6875 | 2 | [9.3750, 9.3750, 9.3750] | 9.3750 | ✓ 吻合 |

每个采样点代表 `stride³` 个体素，而旧式只按 1 个体素计 → **区域体积按 `stride³` 被低估**。

### 1.3 正确公式

```
单个采样 cell 的真实体积 = (实际采样间距)³ = (vs × stride)³
regionVolume            = region 采样点数 × (vs × stride)³
```

### 1.4 修改位置

| 项 | 值 |
|---|---|
| 文件 | `js/engine/v3/peakRegion.js` |
| 函数 | `extractRegion()` |
| 行 | :129（`cellVol` 定义处） |
| 影响面 | `volume`（:148）及其派生量 `regionArea`（`volume/meanM`） |

**未改动**（§三 明令）：BFS、threshold、6 邻域、peak detection、`representativePoint`、
`meanM`、`maxM`、`outsideMaxM`、confidence 公式、以及任何阈值。

---

## 2. 实际修改

```diff
--- a/js/engine/v3/peakRegion.js
+++ b/js/engine/v3/peakRegion.js
@@ -126,7 +126,15 @@ export function extractRegion(M, sample, peakPt, opts = {}, field = null) {
   const peakRaw = field && field.A[peakPt] > 1e-9 ? field.V[peakPt] / field.A[peakPt] : 0;
   const threshold = Math.max(peakM, peakRaw) * o.regionGrowRatio;
-  const cellVol = vs ** 3;
+  // PHASE V2.0-03（101.txt）：cell volume 必须用**实际采样点间距**，不是 vs³。
+  //   refineSample（sampling.js:326）在 gs > refineMaxPoints^(1/3) 时以 stride>1 降密度，
+  //   此时 pts 相邻间距 = vs × stride（2026-10-07 在真实件上逐轴实测吻合），
+  //   每个采样点代表 stride³ 个体素 → 旧式 pts.length × vs³ 按 stride³ 低估区域体积
+  //   （实测 stride=2/3/5 → 1/8、1/27、1/125；ALR2510 H1 52.82 vs 413.02 cm³）。
+  //   stride 与下方 gridNeighbors6 的步长同源——保证"区域连通步长"与"单点体积"一致；
+  //   sample 无 stride（旧夹具/外部调用）时退化为 1，与 gridNeighbors6 的默认一致。
+  const spacing = vs * (sample.stride ?? 1);
+  const cellVol = spacing ** 3;
   const rawOf = (t) => (field && field.A[t] > 1e-9 ? field.V[t] / field.A[t] : M[t]);
```

**`git diff --stat`：1 file changed, 9 insertions(+), 1 deletion(-)。**

### 为什么用 `sample.stride` 而不是别的

| 候选 | 评估 |
|---|---|
| `stride ** 3` 硬写常数 | ❌ 机械照搬；且 `extractRegion` 对**粗场与细化场都可用**，常量写死会失配 |
| 从 `pts` 坐标反解 spacing | 可行但引入新失败模式（退化轴、单点集），且与原实现复杂度不成比例 |
| **`sample.stride`** ✅ | **是采样对象自身的属性**（非全局参数）；**同一个函数在 :140 已经用它作为 `gridNeighbors6` 的步长** —— 保证"区域连通步长"与"单点体积"必然一致 |

`sample` 无 `spacing` 字段（全项目 grep 零命中），故取 `vs × stride`；
`?? 1` 与 `gridNeighbors6` 的默认值一致，兼容无 stride 的旧式调用。

---

## 3. 确定性单元测试

新增 `tests/phasev2003_test.mjs`（**用项目现有最小框架**，`export const tests = [{name, fn}]`，未引入新框架）。

构造方法：**同一个物理区域**（gs=30 的完整立方体，边长 vs=1，物理体积 = 30³ = **27000 mm³**），
只改变采样密度（stride），其余一切相同。

| stride | 采样点数 | 修复前报告 volume | **修复后报告 volume** | 真实体积 | 结果 |
|---|---|---|---|---|---|
| 1 | 27000 | 27000 mm³ | **27000 mm³** | 27000 mm³ | ✅ |
| 2 | 3375 | 3375 mm³（1/8） | **27000 mm³** | 27000 mm³ | ✅ |
| 3 | 1000 | 1000 mm³（1/27） | **27000 mm³** | 27000 mm³ | ✅ |
| 5 | 216 | 216 mm³（1/125） | **27000 mm³** | 27000 mm³ | ✅ |

**用例清单（3 个，全过）**：

| 用例 | 断言 |
|---|---|
| **T1** regionVolume 与采样 stride 无关 | 四个 stride 全部 == 27000 mm³（容差 1e-6）；且 stride=1 与 stride=5 结果相同 |
| **T2** 修复只改体积尺度 | `pts.length` 仍由采样密度决定（27000 / 1000）；`meanM`/`maxM` 逐位一致；`centroid` 偏移 ≤ 半格；`regionArea` 仍恒等于 `volume/meanM` 且与 stride 无关 |
| **T3** 兼容路径 | `delete sample.stride` 后退化为 `vs³`，结果仍为 27000 mm³ |

> **开发过程如实记录**：T2 首版断言"质心必须逐位相等"，实测失败（15 vs 14）。
> 核查后确认是**我的断言写错**——stride=3 时采样格点落在 0,3,…,27，质心自然是 14，
> 这是分格采样的固有性质（修复前后都存在），不是本修复引入的。已改为断言"偏移 ≤ 半格"。
> **产品代码无问题。**

---

## 4. ALR2510 回归

模型：`tests/real-stl/ALR2510塑料模具v1_1.stl`

| 项 | 修复前 | 修复后 | 变化 |
|---|---|---|---|
| 热结数量 | 2 | **2** | 不变 |
| H1 regionVolume | 52.82 cm³ | **422.50 cm³** | **×8.00**（stride=2 → 2³） |
| H2 regionVolume | 166.77 cm³ | **166.77 cm³** | ×1.00（该区域 stride 本为 1） |
| H1 peakModulus (Mc) | 10.02 mm | **10.02 mm** | **不变** |
| H2 peakModulus (Mc) | 8.74 mm | **8.74 mm** | **不变** |
| H1 confidence | 0.96 | **0.96** | 不变 |
| H2 confidence | 0.96 | **0.96** | 不变 |

### 与 V2.0-02 预期值 413.02 cm³ 的差异说明

V2.0-02 的 413.02 cm³ 是**人为把 `refineMaxPoints` 拉到 64000 强制 stride=1** 测得的；
本阶段修的是默认路径（`refineMaxPoints=8000`，stride=2）。两者相差 **+2.3%**，来源：

1. stride=2 时区域边界按 2 格量化，与 stride=1 的 1 格量化边界不同；
2. 采样密度不同 → 峰模数略变（10.02 vs 10.39）→ 生长阈值 `0.8×峰值` 随之微变 → 区域略变。

**属预期内的离散化差异，不是残留错误。** 关键证据是 T1：同一物理区域在 stride 1/2/3/5 下
现在给出**完全相同**的体积。

---

## 5. HR4012 回归

模型：`tests/real-stl/HR4012塑料模具v4最早大板.stl`（模型体积 10923.4 cm³）
（**注意**：热结按 peakModulus 降序重排，下面的 H 编号是**修复后**的编号）

| # | 位置 | peakModulus | regionVolume 前 | regionVolume 后 | 倍数 | 占比 前 | **占比 后** | confidence 前→后 | 最终状态 |
|---|---|---|---|---|---|---|---|---|---|
| H1 | (-2,-42,119) | 11.43 mm | 59.2 cm³ | **1599.0 cm³** | ×27.0 | 0.5% | **14.6%** | 0.82 → 0.95 | ✅ 存活 |
| H2 | (66,-36,264) | 11.23 mm | 96.9 cm³ | **775.4 cm³** | ×8.0 | 0.9% | **7.1%** | 0.82 → 0.94 | ✅ 存活 |
| H3 | (25,-103,47) | 10.90 mm | 41.4 cm³ | **331.2 cm³** | ×8.0 | 0.4% | **3.0%** | 0.79 → 0.87 | ✅ 存活 |
| H4 | (88,-36,-91) | 10.67 mm | 110.4 cm³ | **883.3 cm³** | ×8.0 | 1.0% | **8.1%** | 0.85 → 0.97 | ✅ 存活 |
| H5 | (-49,-38,-162) | 9.31 mm | 85.8 cm³ | **2316.5 cm³** | ×27.0 | 0.8% | **21.2%** | 0.77 → 0.90 | ✅ 存活 |
| — | 热结数量 | — | 5 | **5** | — | — | — | — | **不变** |
| — | hotspots[0].mc（设计中心输入） | — | 11.43 | **11.43** | — | — | — | — | **不变** |

**V2.0-02 的预测复核**：当时用 stride=1 测得占比 4.1~21.3%，本次默认路径测得 **3.0~21.2%** ——
**同一量级、趋势一致**（逐点数值不要求相同，因为两次的采样格点与峰集合不同）。

---

## 6. 下游副作用

> 按 §六 要求：**只记录与分析，未修改任何阈值、判据或 UI 公式。**

### 6.1 `regionVolumeMaxRatio = 0.08` —— **是，开始大范围触发**

判据（`hotspotV3.js:178/360`）：`regionRatio > 0.08` **且** `prominence < uniformPromMax (0.6)` → 拒（`central_region`）。

| 范围 | 修复前 | 修复后 |
|---|---|---|
| 占比 > 8% 的**存活**热点 | 4 个（t02/t10/t17/ALR2510v1_1 各 1） | **约 40 个**，分布在 20 个模型 |
| 因 `central_region` **被拒**的候选 | **0 个** | **11 个**（t06×3、t19×4、ALHR4510×6，共 3 个模型） |

**特别关注（§六.1 点名）—— HR4012**：

| 热点 | 修复后占比 | 是否 > 0.08 | 是否被拒 |
|---|---|---|---|
| H1 | 14.6% | ✅ 是 | ❌ **未被拒**（prominence ≥ 0.6） |
| H4 | 8.1% | ✅ 是 | ❌ **未被拒** |
| H5 | 21.2% | ✅ 是 | ❌ **未被拒** |

→ 判据是**「占比 AND 低显著性」双条件**，HR4012 这三个热点显著性够高，故存活。

**被拒候选的实际占比（关键）**：

| 模型 | 被拒候选占比 | 修复前它们报的占比 |
|---|---|---|
| ALHR4510 v2-2.1 | **8.1% / 9.1% / 9.1% / 9.5% / 9.8% / 10.4%** | 1.0% / 1.1% / 1.1% / 1.2% / 1.2% / 1.3% |
| t19_valveLike（最大热点 M=5.850） | **8.3%** | 0.3% |

> **★ 这三个模型全部是「刚刚越过 8% 线」。**
> 说明 `regionVolumeMaxRatio = 0.08` 这个阈值，是在**区域体积被系统性低估**的前提下标定的
> （`configV3.js:104-107` 自述"热结占比 <8%"的实测校准：boss 0.01%、大厚圆柱 3.5%）。
> 体积修正后，真实热结的占比落在 **8~10%** 这条线上 —— **该阈值的标定前提已失效**。
> **本阶段不改它**（§一 明令），留待下一阶段决策。

### 6.2 `regionMinVolumeMm3 = 100` —— 有恢复，无新增误杀

| 变化 | 数量 | 说明 |
|---|---|---|
| 因体积低估被误判 `tiny_region` → **修复后通过** | **1 个**（t19_valveLike） | 修复的预期收益 ✓ |
| 修复后**新出现** `tiny_region` | **0 个** | 体积只增不减，不会新增误杀 |

### 6.3 `confidence` —— 普遍上升，原因是 `sVol` 饱和

`sVol = min(1, region.volume / (modelVolume × 0.05))`。
体积修正后，多数热结的 `region.volume/modelVolume` 已 ≥ 5% → **`sVol` 普遍打到上限 1**。

| 现象 | 实测 |
|---|---|
| 广泛上升 | 多数热结 **+0.08 ~ +0.14**（如 HR4012 全部 +0.08~+0.13） |
| 极少下降 | ALHR4510 H2 0.71→0.65、t19 H5 0.59→0.51 —— **不是同一热点**（集合变化导致的重排） |
| 副作用性质 | `sVol` 饱和后，**置信度对"区域大小"的分辨力丧失**（该项恒为满分）。**本阶段不改权重** |

**公式未改**，`confidence` 仍 = `0.4·normM + 0.25·prom + 0.15·sVol + 0.2·stability`。

### 6.4 热点数量 —— **2 个模型变化**

| 模型 | 前 | 后 | Δ | 原因 |
|---|---|---|---|---|
| `t06_taperStairs` | 2 | **1** | −1 | 丧失的候选被 `central_region` 拒 |
| `REAL:ALHR4510塑料模具v2-2.1.stl` | 5 | **2** | **−3** | 3 个候选被 `central_region` 拒（8.1/9.1/9.5%） |
| 其余 22 个模型 | — | — | **0** | 不变 |

按位置配对（容差 1mm）的全局统计：

```
配对成功 59 个  ｜  仅修复前存在 5 个（被闸门拒掉）  ｜  仅修复后存在 1 个（新通过）
```

### 6.5 **Mc / peakModulus —— 未变** ✅（§六.5 的重点）

**按位置配对 59 个热点，`peakModulus` 逐位完全相等（0 处不一致）。**

> 早期对比脚本按**列表序号**配对时曾误报 6 处 Mc 变化（t19、ALHR4510）。
> 按**位置**重新配对后确认：那是**列表重排造成的错位**，不是数值改变。
> **本修复只触及 `region.volume` 与派生量 `regionArea`，`peakModulus` 的计算路径一字未动。**

---

## 7. 冒口计算是否受到影响

### 7.1 代码层：**没有数据通路**

`regionVolume` 的消费点（全项目 grep）：

```
js/engine/v3/v3ViewAdapter.js:39    regionVolume → regionVolumeCm3（形态映射）
js/engine/hotspotDisplay.js:44-47  区域体积 → 显示半径
js/model/processInspection.js:102,180  hsVolumeCm3（**仅展示**，判据只有 MODULUS_RATIO_MIN=1.2）
js/views/designCenter.js:799,982,1162,1430   显示
js/views/inspectionCenter.js:2068  显示
js/views/reportGenerator.js:62     报告表格
```

`calcs/riser.js` / `calcs/calcManifest.js` **均不读 `regionVolume`**。✓

### 7.2 实测层：冒口输入 Mc 的变化

设计中心的冒口 Mc = `process.mcHotspot` = **`hotspots[0].mc`**（最大峰模数）。

| 模型 | 修复前 hotspots[0].mc | 修复后 | 冒口是否受影响 |
|---|---|---|---|
| **ALR2510 v1** | 8.57 | 8.57 | ❌ 不受影响 |
| **ALR2510 v1_1** | 10.02 | 10.02 | ❌ 不受影响 |
| **ALHR4510 v2-2.1** | 4.792 | 4.792 | ❌ **不受影响**（丢掉的 3 个都不是最大值） |
| **HR4012 v4 大板** | 11.43 | 11.43 | ❌ 不受影响 |
| `t19_valveLike` | 5.850 | **5.563** | ⚠️ **受影响（−4.9%）** |
| 其余 18 个工程模型 | — | — | ❌ 不受影响 |

**结论：4 个真实产品件的冒口输入 Mc 全部不变；只有 1 个工程生成模型（t19_valveLike）
的 Mc 变化 −4.9%，会使该模型的冒口略小。**

### 7.3 对 100.txt 阶段结论的影响

V2.0-02 的 A/B/C 实验数据**不需要重算**：当时用 stride 修正后的体积做的推演，
与本阶段实测的修正后体积同量级（HR4012 3.0~21.2% vs 预测 4.1~21.3%）。
**「NOT YET」的结论不变**，且本阶段的副作用（§6.1）进一步支持该结论。

---

## 8. 回归测试

```
node tests/runner.mjs
```

| 项 | 值 |
|---|---|
| **PASS** | **666** |
| **FAIL** | **1** |
| 总数 | **667** |
| 跳过（缺夹具） | 0 |

对比：**修复前基线 664 通过 / 0 失败**。
`664 + 3（本阶段新增）= 667`；`667 − 1（下述失败）= 666` ✓ 账目吻合。

### 唯一的失败

```
❌ tests/phase24_test.mjs :: T5 关键真实 STL 热结数量零回归
   Error: ALHR4510塑料模具v2-2.1.stl 热结数应=5，实际 2
```

该断言锁定三个真实件的热结数（ALHR4510=5 / ALR2510 v1_1=2 / HR4012=5）。
**ALR2510 v1_1 与 HR4012 仍通过**，只有 ALHR4510 失败。

> ### ★ 本阶段**未修改这条断言**
> 依据 101.txt §一（"不得因为看到 HR4012 热结区域变大，就为了让结果'看起来合理'而调整过滤阈值"）
> 与 §六（"不要为了保持数量不变而修改任何判据"）与 §十.10（"发现副作用 → 当前阶段不处理 → 等下一阶段单独决策"）。
> 把断言改成 2 等于**在代码里把"ALHR4510 只检出 2 个热结"固化为期望行为**，
> 而这正是需要单独决策的事。**留红上报，交下一阶段裁决。**

### 另有一条**既有的、不计分**的失败（与本修复无关）

`tests/hotspot_v2_test.mjs` 自报 `结果：41 通过 / 1 失败`，失败项是
`large thin shell: 性能 < 8s — 9513ms`。
该文件**不导出 `tests`**（`node tests/runner.mjs hotspot_v2` → `0 通过 / 0 失败`），
**不在 666 里**；且 `HANDOFF_2026-10-07.md` §4 在**本阶段之前**就已记录该性能未达标（当时 11.6s）。
本修复只在每个 region 上加一次乘法，不具备造成秒级性能变化的能力。

---

## 9. Git 变更

```
$ git status --short
 M js/engine/v3/peakRegion.js
?? docs/PHASE_V2.0-01_RISER_INVESTIGATION.md      ← 前两阶段报告（非本阶段产出）
?? docs/PHASE_V2.0-02_VOLUME_CHECK_AUDIT.md       ← 前两阶段报告（非本阶段产出）
?? tests/phasev2003_test.mjs                      ← 本阶段新增测试
?? docs/PHASE_V2.0-03_REGIONVOLUME_STRIDE_FIX.md  ← 本报告

$ git diff --stat
 js/engine/v3/peakRegion.js | 10 +++++++++-
 1 file changed, 9 insertions(+), 1 deletion(-)
```

| 检查项 | 结果 |
|---|---|
| 除允许的文件外无其他变化 | ✅ 仅 `peakRegion.js`（本阶段授权修改）+ 1 个新测试 |
| 无大面积格式化改动 | ✅ 9 增 1 删，无行尾/缩进游走 |
| 无 package 变化 | ✅ |
| 无配置变化 | ✅ |
| 无 docs 大面积变化 | ✅（本报告为本阶段唯一新增文档） |
| 无临时文件进入项目 | ✅ 全部探针在 `%TEMP%\v2001_probe\` |
| 未 commit | ✅（§九 明令） |

**引擎指纹变化**（`js/engine/**` 授权改动 1 个）：

| 文件 | 前 | 后 |
|---|---|---|
| **`js/engine/v3/peakRegion.js`** | `b8d3ab9e` | **`8d61d26d`** |
| `hotspotV3.js` | `d774532a` | `d774532a` ✓ |
| `sampling.js` | `5957831c` | `5957831c` ✓ |
| `modulusField.js` | `ad80da9d` | `ad80da9d` ✓ |
| `configV3.js` | `80a763ef` | `80a763ef` ✓ |
| `meshValidation.js` | `5af64ae4` | `5af64ae4` ✓ |
| `v3ViewAdapter.js` | `1e3d96cc` | `1e3d96cc` ✓ |

> ⚠️ `tests/engineering-generated/BASELINE.md` 记录的仍是旧指纹 `b8d3ab9e`。
> **本阶段未修改该文件**（不在 §一 允许清单内）。**建议下一阶段一并更新。**

---

## 10. 风险与下一阶段建议

### 10.1 已修复 ✅

`extractRegion` 的区域体积现在是**几何正确**的：
同一物理区域在 stride 1/2/3/5 下给出**完全相同**的体积（T1，确定性证明），
真实件上实测倍数精确等于 `stride³`（1× / 8× / 27× / 64×）。

**连带自动修正**（无需改任何显示代码，§七 已核）：
- `regionVolumeCm3`（`v3ViewAdapter.js:39`）→ 设计中心「区域 X cm³」、检测中心、导出报告全部变准
- `regionEqRadius = cbrt(3V/4π)`（`hotspotDisplay.js:40`）→ 3D 热结标记半径自动变准
  （HR4012 H1 的等效半径 24.2 mm → 72.5 mm；受 `displayRadiusFor` 的
  `maxR = max(8, 最小包围盒×0.25) = 38.25 mm` 钳位，大区域标记会贴近上限——
  **这是钳位的设计意图（不遮零件），不是错误**）

### 10.2 遗留（本阶段**故意不处理**，等下一阶段单独决策）

| # | 遗留项 | 证据 | 为什么不在本阶段处理 |
|---|---|---|---|
| **R1** | **`regionVolumeMaxRatio = 0.08` 标定前提失效** | 被拒候选占比全部落在 **8.1~10.4%**，刚越线；修复前它们报 1.0~1.3% | §一 明令禁止改阈值 |
| **R2** | **ALHR4510 热结数 5 → 2**（真实产品件） | 3 个候选被 R1 的判据拒掉 | §六 明令"等下一阶段单独决策" |
| **R3** | **`phase24_test.mjs` T5 留红** | ALHR4510 期望 5 实得 2 | 改断言 = 把待决策的事固化 |
| **R4** | **`confidence` 的 `sVol` 普遍饱和** | 多数热结 `region.volume/modelVolume ≥ 5%` → `sVol` 恒为 1，该权重失去分辨力 | §一 明令禁止改 confidence 权重 |
| **R5** | `BASELINE.md` 引擎指纹过期 | `b8d3ab9e` → `8d61d26d` | 不在允许清单内 |

### 10.3 下一阶段建议

1. **先裁决 R1/R2**：`regionVolumeMaxRatio = 0.08` 是保留、重标定、还是改用别的判据？
   - 关键事实：该值原本是在**体积被低估 8~27×**的前提下校准的（`configV3.js:104-107` 实测 boss 0.01%、大厚圆柱 3.5%）
   - 修正后真实热结占比 **3~21%**，"<8%" 这个前提已不成立
   - **在裁决前不要动 ALHR4510 的期望值**——否则等于默认了现状
2. **R4 与 R1 一起看**：`sVol` 饱和与占比判据失准是同源问题（都源于体积尺度变了）
3. **更新 `BASELINE.md` 指纹**（R5），并重跑一次工程真值套件记录新基线
4. **不要**在下一步做（§十.10 明令）：
   - ❌ 修改冒口 volume check
   - ❌ 把 `regionVolume` 接入 `Vc`
   - ❌ 建立 feeding zone

### 10.4 诚实声明

- 修复本身**已验证正确**（确定性证明 + 真实件倍数 = stride³ + 59/59 配对 Mc 逐位不变）。
- 但修复**暴露了一个更大的问题**：`regionVolumeMaxRatio` 这条判据原本处在"被 Bug 掩盖"的状态。
  **这不是修复引入的新问题，是修复让它显形。** 本阶段的选择是**如实暴露**，
  而不是把阈值调到让结果"看起来和以前一样"。

---

## 附：本阶段执行记录

**允许并已执行**：修 `extractRegion` 的 cellVol / 新增 `tests/phasev2003_test.mjs` /
临时探针（在 `%TEMP%\v2001_probe\`，**未进入项目**）/ 完整回归。

**未执行**：任何阈值修改、任何 formula 修改、UI 逻辑修改、重构、格式化、
`git commit`、`git checkout` / `reset` / `clean`。

**探针清单**（全部只读，通过绝对路径 import 项目模块）：

| 探针 | 用途 |
|---|---|
| `p03_spacing.mjs` | §二：实测 pts 真实间距 == vs × stride |
| `probe_region_volume.mjs` | 修复前/后的确定性对照（stride 1/2/3/5） |
| `p03_snapshot.mjs` | 24 模型基线快照（before.json / after.json） |
| `p03_diff.mjs` | 逐项 diff（热点数 / Mc / 体积 / 置信度 / 占比 / audit） |
| `p03_mc_invariance.mjs` | §六.5：按位置配对验证 Mc 未变 |
| `p03_sideeffect_detail.mjs` | §六.1：`central_region` 触发详情 |
