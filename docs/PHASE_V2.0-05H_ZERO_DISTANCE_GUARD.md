# PHASE V2.0-05H — 零距离采样点边界漏洞修复

基线：`main @ da1c822`（V1.1.0）· 命令文件 `111.txt` · 前置：`PHASE V2.0-05G`（发现该漏洞）

> **信息分级**（111.txt §六）：
> **【实测】** 实际运行得到的数据 ｜ **【源码确认】** 源码可直接证明的调用/公式
> ｜ **【推测】** 合理但未证实的机制假设 ｜ **【未验证】** 本次未覆盖的范围

---

## 1. 原始漏洞的真实代码路径（§六.1）

### 1.1 三层叠加（【源码确认】）

```
sampling.js:337   const char = dists.map(d => (d !== null && d > 0.001 ? d * 2 : null));
                                                            ↑ d = 0 → char = null
modulusField.js:58  let r = (c !== null && c > 0) ? k * c : k * o.charFloor;
                                                            ↑ char = null → 窗口半径 R = charFloor = 1.0mm
modulusField.js:71  const d = sample.dists ? sample.dists[i] : null;
modulusField.js:72  if (d !== null && d > 0) m = Math.min(m, o.modulusCeilRatio * d);
                    ↑ d === 0 → 整个封顶语句被跳过 → M = 未封顶 V/A
```

**⇒ `d = 0` 的采样点同时满足两件坏事：** ① 绕过 `modulusCeilRatio` 封顶；② 窗口退化为
`charFloor = 1.0mm`（边长约 2mm，**比 `vs` 还小**），该 `V/A` 在物理上无意义。

### 1.2 `d` 的来源与数据类型（§二.1，【源码确认】）

| 项 | 结论 |
|---|---|
| 生产者 | `js/engine/mesh3d.js:52 distanceToSurface(geometry, points, maxDist)` |
| 返回类型 | `Array<number \| null>`（`mesh3d.js:53` `new Array(points.length)`） |
| `null` 的产生条件 | `mesh3d.js:46` `if (r === null) { out[i] = null; continue; }` —— **仅当 `bvh.closestPointToPoint` 在 `maxDist` 内找不到最近点** |
| 生产调用方传的 `maxDist` | `coarseSample`（`sampling.js:193`）与 `refineSample`（`sampling.js:336`）**都不传 maxDist** → 默认 `Infinity` |

**⇒ 【源码确认】在有效网格上 `d = null` 是防御性分支；`d = 0` 才是实际观测到的漏洞触发条件。**

### 1.3 `d = 0` 时确实未封顶（§二.2，【实测】）

thickEnd `experimentalGs=64 / refineMaxPoints=8000`，`debug.refine[1]`（gs=18）：

| 量 | 值 |
|---|---|
| 峰点坐标 | `[60.000, −12.031, −12.031]`（正好在 `bounds.max[0] = 60.00` 上） |
| `d` | **0** |
| `char` | **`null`** |
| `R`（窗口半径） | **1.0000**（= `charFloor`） |
| 未封顶 `V/A` | **14.3750** |
| `M`（改动前） | **14.3750** ← 与 `V/A` 逐位相同，证明封顶被整条跳过 |
| 报告 Mc（同档） | 9.21875 → **洞点是报告 Mc 的 1.559 倍** |

### 1.4 M 场如何表示无效采样点（§二.3，【源码确认】）

**没有专门的"无效点"表示**。既有哨兵就是 **`M = 0`**：

```
modulusField.js:64   let m = w.a > 1e-9 ? w.v / w.a : 0;   // 窗口内无散热面 → 模数无定义 → 0
```

### 1.5 后续峰值检测如何处理这些点（§二.4，【源码确认】）

```
peakRegion.js:39   const m = M[t];
peakRegion.js:40   if (m <= 0) continue;                  // ★ M ≤ 0 已被显式定义为"非候选"
peakRegion.js:43   if (!nbrs.length) continue;            // 无 6 邻域采样点
peakRegion.js:66   if (ring.length < 3) continue;         // 环带采样不足
```

### 1.6 其他消费者对 M 场结构/数值约定的依赖（§二.5，【源码确认】）

| 消费者 | 读什么 | 洞点的影响 |
|---|---|---|
| `findPeaks` 候选 | `M[t]` | M ≤ 0 直接排除 |
| `findPeaks` 环带 | `field.R[t]` | 洞点不是候选 → `R` 不被读 |
| `globalNMS` NMS 距离 | `p.refField.R[p.pt]` | 同上（仅峰点） |
| **`maxM` 统计** | `M[t] > maxM`，**以 0 起算** | 洞点**抬高 maxM** → 见下 |
| **`normalizedModulus`** | `hotspotV3.js:197/371` `normM = p.M / p.refField.maxM` | **maxM 被抬高 ⇒ normM 被压低** |
| **`computeConfidence`** | `sMod = clamp(normalizedM)`，权重 **0.4** | **confidence 被压低** |
| `extractRegion` 区域生长 | `rawOf(t) = field.A[t] > 1e-9 ? V/A : M[t]` | **不读 M** → 洞点仍可入区（见 §8.1） |
| `multiscaleVerify` | `buildModulusField(..., [ptIdx]).M[0]` | ptIdx 是峰点，洞点永不传入 |
| `buildModulusFieldSliced` | 与同步版**共用 `fieldPoint`** | phase22 `C1 sliced == sync` 锁定 |

**【实测】`maxM` 污染通道在基线中已在真实模型上触发**（不是纯理论）：

| 模型 | 热点 | `normM`（改前 → 改后） | `confidence`（改前 → 改后） |
|---|---|---|---|
| `t14_taperSeries` | [0] | 0.636735 → **1.0** | 0.8168 → **0.9621** |
| `t14_taperSeries` | [1] | 0.722222 → **1.0** | 0.8560 → **0.9671** |
| `t14_taperSeries` | [2] | 0.722222 → **1.0** | 0.8534 → **0.9645** |

### 1.7 既有测试覆盖（§二.6，【实测】）

`grep -rn "dists" tests/*_test.mjs` + 逐文件检查：**没有任何测试覆盖 `d = 0` / `d = null` / `d > 0` 的 M 场行为**。
现有测试全部走真实 STL 的完整流水线，只间接依赖。

### 1.8 与历史报告的一致性

与 `docs/PHASE_V2.0-05G_MC_DRIFT_DIAGNOSTIC.md` §5.5 **一致**，并且本次把该节的【推测】升格为【实测】：

> 05G §5.5【推测】：若某几何同时出现 `d = 0` 洞点与 `vs < 2mm`，该点可能成为峰并超过 ceiling 限定的 Mc。
> **本次【实测】已用生产 `findPeaks` 直接证实**（§4.3），无需依赖真实 STL 恰好满足该组合。

**与源码不一致处**：无。05G 报告与当前 `js/engine/v3/*` 一致（除本次修复本身）。

---

## 2. 采用的无效点处理方式及其理由（§六.2）

### 2.1 处理方式（【源码确认】）

```js
const d = sample.dists ? sample.dists[i] : null;
if (d !== null && d > 0) m = Math.min(m, o.modulusCeilRatio * d);
else if (sample.dists) m = 0;      // ★ PHASE V2.0-05H
```

**语义：当调用方提供了 `dists`、而该点的距离不是"有限正数"时，该点的 M 记为 0。**

### 2.2 为什么 `M = 0` 是**符合现有语义**的（111.txt §三.2 要求论证）（【源码确认】）

`M = 0` **不是新引入的哨兵**，而是复用本模块**既有**的三条约定：

| # | 依据 | 位置 |
|---|---|---|
| 1 | **本文件已用 0 表示"模数无定义"** —— 窗口内没有散热面（`A ≈ 0`）时 `m = 0` | `modulusField.js:64` |
| 2 | **检测层已把 `M ≤ 0` 定义为"非候选"** | `peakRegion.js:40` |
| 3 | **`maxM` 统计以 0 起算**，`M[t] > maxM` ⇒ 0 不会抬高 `maxM` | `modulusField.js:46-48` |

**⇒ 判据 2 意味着：把无效点记为 0，等于让检测层用**它已有的规则**排除该点，而不是新增一条特判。**
这正是 111.txt §三 "确保无效距离点**不得以未经封顶的异常 M 值**进入有效 M 场或最终峰值候选集" 的直接实现。

### 2.3 为什么不用其他方案

| 备选 | 否决理由 |
|---|---|
| `continue` / 从 `pts` 删除该点 | 会改变 `pts` ↔ `insideIdx` ↔ `gridToPt` 的索引对齐，牵动 `refineSample`/`coarseSample` → 违反 §三"禁止修改采样间距/网格分辨率/refine 策略"，且 §四要求"不得出现索引错位" |
| `NaN` | `findPeaks` 的 `if (m <= 0)` 对 NaN 为 **false**（NaN 比较恒 false）→ 会**穿透**到环带计算，反而产生不可预测行为。**§三.1 明令不得假定哨兵值天然安全** |
| `-Infinity` | 会污染 `meanM`、`maxM` 之外的统计，且非本模块既有约定 |
| 把 `d = 0` 当作 `d = eps` | 引入任意 eps；且窗口仍退化在 `charFloor`，未解决"V/A 无意义"这一半 |
| 同时清零 `V`/`A` | 修改"原始 V/A 的计算公式"（§三 禁止项），且会改变 `extractRegion` 的既有区域生长行为（§三 禁止无关行为改动） |

### 2.4 `d = null` 与 `d = 0` 是否应当合并（111.txt §三.3）

**分别核实后判定：应当合并处理，理由是两者在代码路径上落入同一个分支。**

- 【源码确认】`d = null` 时旧代码同样跳过封顶（`d !== null && d > 0` 为 false）→ **与 `d = 0` 是同一条漏洞路径**，不是一个"既有正确语义"。
- 【实测】本项目 20 个工程模型 + 3 个生成器几何 + 真实件 HR4012 的全部生产档运行中**未观测到 `d = null`**（`maxDist = Infinity` 下 BVH 未返回 null）。
- **⇒ 合并为同一处理不会改变任何既有可观测行为，且堵住同型漏洞。** 测试 H6 单独覆盖该分支。

---

## 3. 实际修改的文件与代码范围（§六.3）

| 文件 | 改动 | 指纹（sha256 前 8 位） |
|---|---|---|
| **`js/engine/v3/modulusField.js`** | **+13 行**（12 行注释 + **1 行代码** `else if (sample.dists) m = 0;`） | `ad80da9d` → **`48488b13`** |
| `tests/phasev2005h_test.mjs` | **新增**（12 个针对性用例） | 新文件 |

**生产代码净改动：1 行。** 未新增文件/依赖，未改任何其他生产文件。

**同步/分片两条路径只改一处**（【源码确认】）：`buildModulusField`（`modulusField.js:43`）与
`buildModulusFieldSliced`（`:95`）**都调用同一个 `fieldPoint`**，故一处改动同时覆盖两条路径。

**未修改清单**（111.txt §三 禁止项，逐条核对）：

| 禁止项 | 状态 |
|---|---|
| `modulusCeilRatio` 默认值/定义 | 未动（`configV3.js` 指纹仍 `80a763ef`） |
| 原始 V/A 计算公式（`windowVoxels`） | 未动（`windowV.js` 未改） |
| 采样间距 / 网格分辨率 / refine 策略 | 未动（`sampling.js` 指纹仍 `5957831c`） |
| 峰值检测算法 / 显著性阈值 / 环带半径 | 未动（`peakRegion.js` 指纹仍 `8d61d26d`，即 V2.0-03 后的既有状态） |
| `calcs/riser.js` | 未动 |
| 冒口模数系数 / 补缩体积算法 | 未动 |
| 无关历史遗留（`opts.resolution` 空转 / BASELINE 指纹过期 / `regionVolumeMaxRatio` / phase24 T5） | 未动 |
| 基准值 / 黄金测试 / 既有行为 | 未动（未改任何 expected / golden / 阈值） |

**引擎 7 指纹（改动后）**：

```
d774532a hotspotV3.js   8d61d26d peakRegion.js*  5957831c sampling.js
48488b13 modulusField.js  80a763ef configV3.js   5af64ae4 meshValidation.js   1e3d96cc v3ViewAdapter.js
（* peakRegion.js 的 8d61d26d 是 V2.0-03 的既有改动，非本阶段；BASELINE.md 仍记 b8d3ab9e）
```

---

## 4. `d = 0` 为什么不再能携带未经封顶的异常 M 值进入有效候选集（§六.4）

### 4.1 三条通道逐个封堵（【源码确认】）

| 通道 | 改动前 | 改动后 |
|---|---|---|
| ① **M 场本身**（`field.M[t]`） | `= 未封顶 V/A` | **`= 0`** |
| ② **`field.maxM`**（→ `normalizedModulus` → `confidence`） | 被洞点抬高（14.375 而非 9.219） | **不受影响**（`M[t] > maxM` 对 0 恒 false） |
| ③ **峰值候选集**（`findPeaks`） | 洞点可成为峰（见 §4.3） | **`if (m <= 0) continue` 直接排除** |

### 4.2 前置条件：该"异常 M 值"确实异常（【实测】）

洞点的 `R` 退化为 `charFloor = 1.0mm`，窗口边长 ≈ 2mm。thickEnd L1 的 `vs = 7.1875mm`
—— **窗口比一个体素间距还小**，其 `V/A` 不表征任何局部几何。对比：同点若取 `d = 27.656`（真实深处），
窗口半宽 = `round(2×27.656/7.1875)+1 = 9`，量级完全不同。

### 4.3 用**原始文件**直接测量"改前会怎样"（【实测】）

取 `git show HEAD:js/engine/v3/modulusField.js` 作为**原始模块**，与修复版跑同一组合成输入，
结果喂给**同一个生产 `findPeaks`**：

```
原始文件 (HEAD) M = [3.0000, 1.0000, 0.1667, ...]   maxM = 3.0000
修复后          M = [0.0000, 1.0000, 0.1667, ...]   maxM = 1.0000

未修复 findPeaks → ["idx0 M=3.0000"]     ← 洞点胜出，正常峰 idx1 被 NMS 挤掉
已修复 findPeaks → ["idx1 M=1.0000"]     ← 正常峰
```

**⇒ 【实测】环带一旦有采样点，`d = 0` 点在改前**确实会成为被报告的峰**，且其 M 完全绕过 ceiling。
这把 05G §5.5 的【推测】升格为【实测】。

### 4.4 端到端复核（【实测】）

thickEnd `experimentalGs=64` 的 `refine` 区最大 `maxM`：**14.375 → 9.21875**（= 该档报告 Mc）。
即"某区域的场最大值高于全模型报告 Mc"这一不可能状态，在修复后消失。

---

## 5. `d = null` / `d = 0` / `d > 0` 的行为（§六.5）

| `d` 取值 | 改动前 M | 改动后 M | 依据 |
|---|---|---|---|
| `d > 0.001` | `min(V/A, ratio×d)` | **同左（不变）** | `char = 2d` 正常，窗口正常 |
| `0 < d ≤ 0.001` | `min(V/A, ratio×d) ≈ ratio×d ≤ 0.00033` | **同左（不变）** | `char = null` → 窗口退化，但封顶生效 → M ≈ 0，实际已排除 |
| **`d = 0`** | **`V/A`（未封顶）** | **`0`** | 本次修复 |
| **`d = null`** | **`V/A`（未封顶）** | **`0`** | 本次修复 |
| `d = NaN` / `d < 0` | **`V/A`（未封顶）** | **`0`** | 本次修复（`!(d > 0)` 覆盖 NaN） |
| **调用方未提供 `dists`** | `V/A`（全不封顶） | **`V/A`（全不封顶，不变）** | `else if (sample.dists)` 守卫 → **向后兼容** |

---

## 6. 定向测试与完整回归结果（§六.6）

### 6.1 新增针对性测试

`tests/phasev2005h_test.mjs` —— **12 个用例，直接构造合成 M 场输入**（不依赖真实 STL 恰好产生）：

采用**板坯合成体素块**（`inside` 仅 `k ∈ [0,5]`，`boundary` 按 `windowV.js:29-40` 同一约定标记），
故任意采样点都有定义良好的 `V/A`，可以精确控制"高 V/A + `d = 0`"这一场景。

| 用例 | 场景（111.txt §四 表） | 断言 |
|---|---|---|
| H1 | `d > 0` | `M == min(V/A, ratio×d)` 逐点恒等式；`M ≤ ratio×d` |
| H2 | `d > 0` 且 ceiling 不绑定 | `M == 原始 V/A`（不误伤） |
| H3 | `d = 0`（高 V/A 区域） | `M == 0`；并**前置断言**该点未封顶 `V/A > ratio×d`（确认场景真实成立） |
| H4 | `d = 0` | `M == 0`；`maxM == max(M)`；`maxM ≤ ratio×d(正常点)` |
| H5 | `d = 0` 峰值候选 | **构造"若未修复则洞点必胜"的场**：前置断言 `raw(洞点) > M(正常峰)`；断言 `peaks[0].pt == 1`、洞点不在 peaks 中 |
| H6 | `d = null` | `M == 0`；不产生 NaN |
| H7 | 未提供 `dists`（旧调用） | `M == 原始 V/A`（**向后兼容**） |
| H8 | `d = NaN / -1 / -0` | `M == 0` |
| H9 | 正常几何体（thickEnd 粗场） | 逐点不变量（`d>0 ⇒ min(V/A,ratio·d)`；否则 0）；无 NaN；`M.length == pts.length`（**无索引错位**） |
| H10 | 分片 vs 同步 | 含 `d = 0` / `d = null` 时逐点一致 |
| H11 | 全为无效点 | 不抛错、无 NaN、`maxM == 0`、`meanM == 0`、`findPeaks` 返回 `[]` |
| H12 | 端到端（thickEnd L1） | `refine` 区 `maxM ≤ Mc`；所有 `normalizedModulus ≤ 1` |

**H5 的区分力已用原始文件独立验证**（§4.3）：未修复 → `idx0 M=3.0000` 胜出；已修复 → `idx1 M=1.0000`。

### 6.2 定向测试结果

```
改前（未修复代码）：12 用例 → 5 通过 / 7 失败
  失败 = H3 H4 H5 H6 H8 H11 H12   ← 全部是漏洞本身的表现（预期）
  通过 = H1 H2 H7 H9 H10          ← d>0 行为、向后兼容、正常几何、分片一致

改后：12 用例 → 12 通过 / 0 失败
```

### 6.3 完整回归结果

**方法**：把 `js/engine/v3/modulusField.js` 临时还原为 `git show HEAD` 版本跑"改前"，
再恢复修复版跑"改后"。两次都在**同一工作区、同一夹具、同一命令**（`node tests/runner.mjs`）下执行。

| | 通过 | 失败 | 说明 |
|---|---|---|---|
| **改前**（HEAD 版 `modulusField.js`） | **681** | **8** | 1 个既有失败 + 7 个新测试的预期失败 |
| **改后**（修复版） | **688** | **1** | **仅剩那 1 个既有失败** |

**净变化：+7 通过 / −7 失败 —— 即本次新增的 7 个用例由"未修复代码上的预期失败"转为通过。
引入失败 = 0。既有失败数不变（1 → 1）。**

**逐项归属（111.txt §五 要求的三分类）**：

| # | 失败项 | 改前 | 改后 | 归属 |
|---|---|---|---|---|
| 1 | `phase24_test.mjs :: T5 关键真实 STL 热结数量零回归`<br>`ALHR4510塑料模具v2-2.1.stl 热结数应=5，实际 2` | ❌ | ❌ | **原本存在的失败**（V2.0-03 的 `regionVolumeMaxRatio` 标定前提失效所致，HANDOFF 已记录，本阶段按 §三 不修）。**改前改后的错误信息逐字相同** |
| 2–8 | `phasev2005h_test.mjs :: H3 / H4 / H5 / H6 / H8 / H11 / H12` | ❌ | ✅ | **本次新增测试在未修复代码上的预期失败** —— 即漏洞本身 |
| — | **本次修改引入的失败** | — | **0 项** | — |
| — | **无法判断归属的失败** | — | **0 项** | — |

**未通过修改黄金值、删除测试或放宽阈值来消除任何失败**（§五 禁止项）：本阶段只新增测试文件，
未改任何既有测试的 expected / 断言 / 阈值。

---

## 7. Mc / 峰值位置 / 其他指标是否发生变化（§六.7）

**方法**：`tests/experiments/phasev2005h_fingerprint.mjs` —— 同一脚本在改前/改后各跑一次，
逐字段比对 ① 20 个工程模型（生产档 `opts={}`）、② thickEnd / pvpPair（生产档 + L1..L4 实验档）、
③ HR4012（生产档）。共比对 **906 个字段**。

### 7.1 结果：11 处差异，全部集中在两类

| 类别 | 差异 | 判定 |
|---|---|---|
| **A. `refineMaxM`**（区域 M 场最大值） | `t06[3]` 9.375 → 6.640625；`t14[0]` 18.75 → 13.5417；`t14[1]` 18.75 → 13.5417；`t14[2]` 21.875 → 13.9286；`thickEnd/L1[1]` 14.375 → 9.21875 | **预期修正**：洞点不再抬高 `maxM` |
| **B. `t14_taperSeries` 三个热点的 `normM` / `confidence`** | `normM` 0.6367/0.7222/0.7222 → **1.0/1.0/1.0**；`conf` 0.8168/0.8560/0.8534 → **0.9621/0.9671/0.9645** | **预期修正**：`normM = p.M / maxM`，`maxM` 不再被污染 |

### 7.2 **未发生变化**的项（逐位相同）

- ✅ **`status`**（全部模型全部档位）
- ✅ **`hotspotCount`**（热点数量）
- ✅ **`Mc`（`peakModulus`）**：20 模型 + thickEnd L1–L4 + pvpPair L1–L4 + HR4012 prod **全部逐位相同**
- ✅ **峰值位置 / 代表点位置**（3 位小数逐位相同）
- ✅ **`regionVolume`**
- ✅ **粗场 `maxM`（`coarseMaxM`）**

**⇒ 【实测】本修复不改变任何 Mc、位置、热点数量；只修正被洞点污染的 `maxM` / `normalizedModulus` / `confidence`。**

### 7.3 对既有基准的含义

- **`BASELINE.md` 的工程真值套件指标不受影响**（【源码确认】+【实测】）：
  - 【源码确认】`run_engineering.mjs` 的评分只读 `peakDistanceToGTmm` /
    `representativeDistanceToGTmm` / `zoneMatch` / `toleranceMm`（**位置与厚区**）；
    `confidence` 与 `peakModulus` 仅被**记录**进 `result.json` / `summary.json`（`:264`、`:361`），
    **不参与任何判定**。
  - 【实测】§7.2 已证明 Mc 与位置**逐位不变** ⇒ legacy 9/20、Peak detection 19/20、
    Representative accuracy 7/20 等指标**结论不变**。
  - **本次未重跑 `run_engineering.mjs`**：它会 `writeFileSync` 覆盖 `result.json` / `summary.json`
    （`:386`、`:432`），属于 §三 禁止触碰的基准快照。
- **`confidence` 数值变化对 UI 的影响**：置信度显示值会上升（t14 三个热点 +0.11~0.15）。
  这是**修正**而非回归——`normM` 的定义是"峰 M / 场最大 M"，而场最大 M 之前被一个无物理意义的点占据。

---

## 8. 仍然存在的限制（§六.8）

### 8.1 `extractRegion` 仍可通过未封顶 V/A 接纳洞点（**既有行为，本次未改**）

**【源码确认】** `peakRegion.js:138`
```js
const rawOf = (t) => (field && field.A[t] > 1e-9 ? field.V[t] / field.A[t] : M[t]);
```
区域生长**刻意**使用未封顶原始 `V/A`（PHASE 24 的修复，见 `peakRegion.js:122-128`），
**不读 `M[t]`**。因此 `d = 0` 的点（现 `M = 0`）只要 `V/A` 高于生长阈值仍会被 BFS 纳入区域。

**【实测】** thickEnd L1 主区：region 共 1019 点，其中 **16 个是洞点**（`rawOf = 14.375 > 阈值 10.3712`）。

**【实测】本次改动不改变这一行为**：改前/改后指纹中所有 `regionVolume` 逐位相同
（洞点在改前的 `rawOf` 同样是未封顶 V/A）。

**判定**：属于 111.txt §三 明确范围（"不得以未经封顶的异常 **M 值** 进入有效 **M 场** 或最终**峰值候选集**"）
**之外**的既有设计选择，且 §三 禁止修改无关既有行为。**只记录，不修。**

### 8.2 `legacy/modulusField.js` 有同型守卫（**未修改**）

**【源码确认】** `js/engine/v3/legacy/modulusField.js:87`
```js
const d = sample.dists ? sample.dists[i] : null;
if (d !== null && d > 0) m = Math.min(m, d);     // 同型：d = 0 同样跳过封顶
```
**【实测】** `grep -rn "legacy/hotspotV3\|legacy/modulusField" --include=*.js js/` → **零引用**（应用内无导入）。
legacy 也不在 7 指纹冻结清单内。**按 §三 最小改动原则未修改。**

### 8.3 `0 < d ≤ 0.001` 的窗口退化未处理（**本次未改**）

这些点 `char = null` → 窗口退化为 `charFloor`，与洞点同样"窗口无物理意义"，但其 `M = ratio×d ≤ 0.00033`
已被 ceiling 压到接近 0，**不构成异常值**。本次未改其行为（§三 要求对 `d > 0` 保持原行为）。

### 8.4 【未验证】范围

- **浏览器端到端**：未在 UI 中实际跑一次完整流程（仅 Node 侧验证）。
- **`run_engineering.mjs` 的 20 模型真值套件**：未重跑（会覆盖基准快照，§三 禁止）。
  结论不受影响的依据是【源码确认】评分不消费 `confidence` + 【实测】位置逐位不变（§7.3）。
- **Android / 打包版**：`dist/**` 内的副本未同步（打包时另行处理）。
- **`d = Infinity`**：未构造（BVH 不会返回该值）。

---

## 9. 结论与建议（111.txt §七）

| 项 | 结论 |
|---|---|
| 是否确认漏洞 | **是**。三层叠加（`sampling.js:337` → `modulusField.js:58` → `:72`），实测最高达报告 Mc 的 **1.559 倍**，且已用原始文件证明改前**确实会**成为被报告的峰 |
| 是否完成安全修复 | **是**。生产代码净改动 **1 行**，复用既有 `M = 0` 约定，向后兼容（不传 `dists` 时行为不变） |
| 修改文件清单 | `js/engine/v3/modulusField.js`（`ad80da9d` → `48488b13`）；新增 `tests/phasev2005h_test.mjs` |
| 测试结果 | 定向 **12/12** 通过（改前 5/12）；全量回归 **681/8 → 688/1**（唯一失败为既有 `phase24 T5`，**引入失败 0**） |
| Mc / 位置 / 热点数 | **全部逐位不变**；仅 `maxM` / `normM` / `confidence` 被修正 |
| 是否建议合并 | **建议合并**（详见 §9.1） |
| 本阶段边界 | 未进入 V2.0-06；未改 `modulusCeilRatio`；未 commit；未改历史审计报告 |

### 9.1 合并建议的理由

1. **修复的是明确的越界值**（`M = 未封顶 V/A` 且窗口退化），不是行为偏好；
2. **零 Mc/位置影响**（906 字段比对，Mc/位置/热点数/体积全部逐位相同）→ 不会推翻任何既有审计结论；
3. **修正了一个已在真实模型上触发的静默缺陷**（`t14_taperSeries` 的 `normM` 被压低 28~36%）；
4. **改动面 1 行**，复用既有哨兵，无新增概念。

---

## 10. 下一阶段（V2.0-06）开展前需要注意什么

1. **05G 的两条硬约束仍然有效，未因本修复改变**：
   - `Mc ≡ (1/3)×d(峰点)`，`F_M` 的语义归属必须在 V2.0-06 前裁决 `modulusCeilRatio`；
   - 本修复**没有**触碰 ceiling 的工程含义（§三 禁止项）。
2. **`modulusCeilRatio` 仍是 V2.0-06 的前置裁决项**，且现在多了一个证据点：
   洞点绕过封顶时 M 跳到 14.375（= 未封顶 V/A），说明**未被封顶的 V/A 与封顶值差距可达 1.56×**。
3. **BASELINE.md 的引擎指纹需要更新**：`modulusField` 已由 `ad80da9d` 变为 `48488b13`
   （`peakRegion` 的 `b8d3ab9e → 8d61d26d` 仍是 V2.0-03 的未记录差异）。
   **本阶段未改 BASELINE.md**（§三 禁止动基准值；建议在合并时一并更新并注明原因）。
4. **`docs/PHASE_V2.0-05G_MC_DRIFT_DIAGNOSTIC.md` §5.5 与 §12#6 描述的是**已修复**的状态**。
   按 §七"不擅自修改历史审计报告"，**本次未改该文件**；建议在合并时于该节加一行交叉引用指向本报告。
