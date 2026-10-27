# Casting Toolbox V2.0 — PHASE V2.0-02 冒口体积校验根因审计

> **阶段性质：只读审计 + 计算 + 实验。**
> 未修改任何生产代码（JS / HTML / CSS / 测试 / package / 配置），未修改 `js/engine/**`，
> 未修改 Hotspot V3，未重构，未提交 Git。
> 本文件是本阶段**唯一新增的文件**。
>
> 审计日期：2026-10-07 ｜ 基线：`main` @ `da1c822` ｜ 版本 V1.1.0
> 上一阶段：`docs/PHASE_V2.0-01_RISER_INVESTIGATION.md`

---

## 【A. 当前代码链路】

从 STL 导入到最终冒口尺寸，**实际调用链**（文件 : 行 → 函数 → 关键变量）：

| # | 位置 | 函数 | 输入 | 输出 / 关键变量 |
|---|---|---|---|---|
| 1 | `js/views/designCenter.js:609` | `importFile` | `File` | — |
| 2 | `:616` | `parseSTL` | ArrayBuffer | `{vertices, triCount}` |
| 3 | `:625-627` | `validateMesh` / `buildMesh` | mesh | `validation` / `geometry`(BVH) |
| 4 | `:668` | `analyzeGeometrySliced` | mesh, geometry | `state.analysis` → `volume / area / wallMax / wallAvg` |
| 5 | `:917` | `writeGeometryToProject` | analysis | `geometry.volumeCm3`(mm³→cm³) |
| 6 | `:954` → `CastingProject.js:265` | `refreshWeight` | volumeCm3, solidDensity | **`geometry.netWeightKg`** |
| 7 | `:697` | `analyzeHotspotsV3Sliced` | mesh, geometry | V3 原始结果 |
| 8 | `:697` → `v3ViewAdapter.js:36` | `toViewResult` | V3 结果 | **`hotspots[].mc = peakModulus`**、**`regionVolumeCm3 = regionVolume/1000`** |
| 9 | `:792` | `writeHotspotsToProject` | state.hotspots | `hotspots.items[]`、**`process.mcHotspot = hotspots[0].mc`** |
| 10 | `calcManifest.js:241` | `riser.calculate` | CastingProject | **`castWt = netWeightKg \|\| blankWeightKg \|\| 0`** |
| 11 | `calcManifest.js:245` | `runOne(mcVal)` | `{mat: fam, cast_wt: castWt, mc_mode:'direct', mc, shape, hd_ratio:1.0, eff:undefined, rho}` | — |
| 12 | `calcs/riser.js:78` | **`runRiser`** | 同上 | `{D,H,Vr,effV,needVol,Mr_act,Mr_need,final_f,d_neck,modOk,volOk,…}` |
| 13 | `js/views/resultsCenter.js:91` | `riserSection` | riser 结果 | Page2「② 冒口设计」HTML |

### 关键数据来源对照（99.txt §一 要求）

| 数据 | 来源 | 位置 |
|---|---|---|
| **产品重量 / 产品体积** | STL 体积 ← `computeVolume`（散度定理）；重量 = 体积 × `material.solidDensity` | `js/engine/stl.js:93`；`CastingProject.js:265-275` |
| **热点 / 热结** | Hotspot V3 的 `hotspots[]`；Mc 取 `hotspots[0].mc`（按 peakModulus 降序 → 最大者） | `js/engine/v3/hotspotV3.js`；`v3ViewAdapter.js:36`；`designCenter.js:804` |
| **热结体积** | `hotspots[].regionVolume`（mm³）→ 显示为 `regionVolumeCm3` | `js/engine/v3/peakRegion.js:148`；`v3ViewAdapter.js:39` |
| 冒口尺寸 | `runRiser` 按形状 `DfromM` 反算 + `Math.round` | `calcs/riser.js:95-97` |

---

## 【B. 当前体积校验实际公式】

### 公式原文（逐字）

`calcs/riser.js:107-111`（循环内）：
```js
let volOk = true;
if (cw > 0) {
  const Vc = cw * 1000000 / rhoUsed;      // ← 被补缩对象体积（mm³）
  volOk = effV >= Vc * md.shrink;
}
```

`calcs/riser.js:122-126`（循环后复算，用于返回）：
```js
const Vc = cw > 0 ? cw * 1000000 / rhoUsed : 0;
const needVol = Vc * md.shrink;
const volOk = cw > 0 ? effV >= needVol : true;
const yieldPct = Vc > 0 ? Vc / (Vc + Vr) * 100 : null;
```

### 变量定义

| 变量 | 含义 | 来源 | 单位 |
|---|---|---|---|
| `cw` | `cast_wt` = **铸件净重（整件）** | `calcManifest.js:241` ← `geometry.netWeightKg` | kg |
| `rhoUsed` | 固态密度 | `RISER_MATERIALS[mat].rho`（或用户覆盖） | g/cm³ |
| **`Vc`** | **`cw × 1e6 / ρ` = 整个铸件的金属体积** | — | mm³ |
| `md.shrink` | 体收缩率（灰铁 2% / 球铁 3% / 铸钢·铝·铜 4.5%） | `RISER_MATERIALS` | — |
| `needVol` | **所需补缩量 = 整件体积 × 收缩率** | — | mm³ |
| `Vr` | 冒口体积 | 形状公式 | mm³ |
| `eff` | 补缩效率（cyl 14% / sphere 20% / sphere_head 25%） | `RISER_EFF` | — |
| `effV` | 有效补缩量 = `Vr × eff` | — | mm³ |
| `volOk` | `effV ≥ needVol` | — | bool |

### ★ 对 99.txt §二 的直接回答

**当前体积校验回答的是 B：「这个冒口能不能补偿整个铸件的收缩？」**

```
V_casting = 整个产品体积        ← 明确使用（cw × 1e6 / ρ）
W_casting = 整个产品重量        ← 明确使用（cw = netWeightKg）
```

**不是** A（相对大小），**也不是** C（局部补缩区）。

代码里**有自述**：`js/i18n/zh-CN.js:94`
> `riser.note.volSimplified`: 「说明：本体积校核按**单冒口对整体铸件补缩**的工程简化方法计算；大件、多热节或多冒口铸件应按实际补缩区域分别校核。」

**但这条说明只在独立计算器显示**（`js/views/riserView.js:254`），
**设计中心结果页（`resultsCenter.js`）不显示**（grep `volSimplified` 全项目仅命中 riserView）。

---

## 【C. 为什么会导致冒口偏大】

### C.1 纯代数

两条约束**互相独立**，谁要求大谁说了算：

| 约束 | 表达式 | 化简（圆柱形 hd=1，M=D/6） |
|---|---|---|
| 模数约束 | `Mr_act ≥ Mc × f × 0.99`，f 从 1.10 起 | **`D_mod = 6.6 × Mc`** |
| **体积约束** | `Vr × eff ≥ Vc × shrink` | **`D_vol = ∛(4 × Vc × shrink / (π × eff))`** |

**交叉条件**（两者相等）：

```
Vc* = (6.6 × Mc)³ × π × eff / (4 × shrink)
```

代入球铁（shrink 3%）+ 圆柱（eff 14%）+ Mc = 10 mm：
`Vc* = 66³ × π × 0.14 / 0.12 ≈ 1.05×10⁶ mm³` → **≈ 7.5 kg**

**超过交叉重量后，`D_vol` 只依赖 `Vc`，与 `Mc` 完全无关 —— 热点算得再准也不影响冒口尺寸。**

### C.2 恒等式：体积主导区的冒口比例是一个常数

```
Vr = Vc × shrink / eff
冒口重量 = Vr × ρ = (cw × 1e6 / ρ) × (shrink / eff) × ρ / 1e6 = cw × shrink / eff
```

> **冒口重量 / 铸件净重 = shrink / eff**

| 材料 + 形状 | shrink/eff | 冒口重 / 铸件净重 |
|---|---|---|
| 球铁 + 圆柱形（**设计中心默认**） | 3% / 14% | **21.4%** |
| 球铁 + 球顶圆柱 | 3% / 25% | 12.0% |
| 灰铁 + 圆柱形 | 2% / 14% | 14.3% |
| 铸钢 + 圆柱形 | 4.5% / 14% | 32.1% |
| 铝合金 + 圆柱形 | 4.5% / 14% | 32.1% |

**与铸件几何、与铸件大小、与热点模数全都无关。** 这就是"明显偏大"最直观的来源：
不论导入什么产品，只要够重，冒口永远是净重的 21.4%。

### C.3 实测（球铁 / 圆柱形 / eff 14% / Mc = 10 mm）

| 铸件净重 | 仅模数 D | 体积要求 D | 实际 D | final_f | 冒口重/净重 | 主导 |
|---|---|---|---|---|---|---|
| 5 kg | 66.0 | 57.7 | 66 | 1.10 | 32.1% | 模数 |
| **10 kg** | 66.0 | 72.7 | 75 | 1.25 | 23.5% | **体积（交叉点）** |
| 50 kg | 66.0 | 124.3 | 126 | 2.10 | 22.3% | 体积 |
| 100 kg | 66.0 | 156.6 | 159 | 2.65 | 22.4% | 体积 |
| 200 kg | 66.0 | 197.3 | 198 | 3.30 | 21.6% | 体积 |
| 500 kg | 66.0 | 267.8 | **213** | **3.55（撞顶）** | 10.8% | 体积，**未收敛** |

---

## 【D. Hotspot V3 当前到底输出什么】

### D.1 实际输出字段（`hotspotV3.js:203-214`，经 `v3ViewAdapter.js:33-45` 映射）

| 字段 | 类型 | 含义 | 设计中心是否消费 |
|---|---|---|---|
| `hotspotId` | int | 序号（按 peakModulus 降序后重排） | 是（显示 H1/H2…） |
| `position` | [x,y,z] | **代表点 = region 质心**（`peakRegion.js:196` `representativePoint`），**不是峰点** | 是（3D 标记、距离计算） |
| `peakModulus` | mm | **封顶后**的峰模数 `min(V/A, (1/3)d)` | 是 → **`mc`** |
| `normalizedModulus` | 0~1 | 峰 M / 该细化场最大 M | 否 |
| **`regionVolume`** | **mm³** | **区域体积 = `pts.length × vs³`** | 是 → **`regionVolumeCm3`** |
| `regionArea` | mm² | **`regionVolume / meanM`（由 M=V/A 反推，非独立测量）** | 是（`regionAreaCm2`） |
| `confidence` | 0~1 | `0.4·normM + 0.25·prom + 0.15·sVol + 0.2·stability`（**算法评分，非概率**） | 是 |
| `scaleStability` | 0~1 | 多尺度稳定性 | 否 |
| `geometrySource` | string | 溯源字符串 | 否（调试） |
| `metrics` / `audit` / `debug` | obj/arr | 几何量 / 被拒原因 / 分层诊断 | 调试模式 |

### D.2 ★ 明确没有的东西

**没有**：温度场、凝固时间（solidification time）、冷却速率、补缩距离、凝固方向、
feeding zone、内浇口/冷铁耦合、冒口之间的竞争关系。

Hotspot V3 是**纯几何分析**（局部体素窗口内的 V/A），**不是热模拟**。
`js/model/processInspection.js:133` 明文禁止使用「负责冒口 / feeding riser / responsible」措辞——
**项目自己已经决定不建立"哪个冒口负责哪块区域"的关系。**

### D.3 空间区域定义（99.txt §三 Q2）

**有**，但是**有条件的**：`region` 是细化采样格点上的一个**6 邻域连通集**
（`peakRegion.js:132-146`，BFS，阈值 `≥ max(封顶峰M, 原始V/A峰) × 0.8`）。

`region` 对象含 `{pts, volume, centroid, meanM, maxM, outsideMaxM, regionArea}`
—— 但**只有 `volume` 被导出到热点结果**，`pts`（体素列表）不导出。

所以：**可以算出一个体积数，但不能从结果里还原出那块区域的形状/位置集合。**

---

## 【E. 热点体积能不能准确计算】

按 99.txt §七 的三级判据分别评。

### E.1 【一级：几何准确】—— **低（当前实现有确定缺陷）**

**方法本身是对的**：`volume = 采样点数 × vs³`（`peakRegion.js:129,148`）。
体素计数 × 体素体积，几何上就是该区域的离散体积。

**但 `extractRegion` 漏乘了 `stride³`。**

`js/engine/v3/sampling.js:326`（细化采样）：
```js
const stride = Math.max(1, Math.ceil(Math.cbrt(gs ** 3 / o.refineMaxPoints)));   // refineMaxPoints = 8000
```
→ **`gs > 20` 时 `stride ≥ 2`**。而 `extractRegion` 用 `pts.length × vs³`，
采样点间距是 `stride × vs`，每点实际代表 `stride³` 个体素 → **体积按 `stride³` 被低估**。

**直接证明**（构造同一物理区域 = gs30 全立方体，只改采样密度）：

| stride | 采样点数 | 报告 volume | 真实体积 | 低估 |
|---|---|---|---|---|
| 1 | 27000 | 27000 mm³ | 27000 mm³ | 1.0× |
| 2 | 3375 | 3375 mm³ | 27000 mm³ | **8.0×** |
| 3 | 1000 | 1000 mm³ | 27000 mm³ | **27.0×** |
| 5 | 216 | 216 mm³ | 27000 mm³ | **125.0×** |

**真实模型实测**（`analyzeHotspotsV3` 默认参数）：

| 模型 | 细化区域 gs | 推导 stride | 实测结果 |
|---|---|---|---|
| ALR2510 v1_1 | 37 / 25 / 19 / 16 | **2 / 2 / 1 / 1** | **H1 区域 52.82 cm³ → 强制 stride=1 后 413.02 cm³（7.82×）** |
| HR4012 大板 | 29~52（15 个区域） | **14 个 ≥2，多数为 3** | 见下表 |

HR4012（同一模型，只改 `refineMaxPoints` 强制 stride=1）：

| 热结 | 默认报告区域 | 占铸件 | **stride=1 真实区域** | **占铸件** | 低估 |
|---|---|---|---|---|---|
| H1 | 59.2 cm³ | 0.5% | 775.9 cm³ | **7.1%** | 13.1× |
| H2 | 96.9 cm³ | 0.9% | 1564.3 cm³ | **14.3%** | 16.1× |
| H3 | 41.4 cm³ | 0.4% | 443.1 cm³ | **4.1%** | 10.7× |
| H4 | 110.4 cm³ | 1.0% | 2329.1 cm³ | **21.3%** | 21.1× |
| H5 | 85.8 cm³ | 0.8% | 2263.0 cm³ | **20.7%** | 26.4× |

**连带影响**（同一个 `region.volume` 被多处消费）：

1. **`regionMinVolumeMm3 = 100` 闸门** → 体积被低估 → 真热结可能被误判 `tiny_region` 拒掉（**漏检风险**）
2. **`regionVolumeMaxRatio = 0.08` 闸门** → 当前报告占比全部 ≤1%，**永远触发不了**；
   真实占比 4~21%，**H2/H4/H5 本会超过 8%** → 该闸门目前**被这个 bug 掩盖**
3. **置信度 `sVol = min(1, region.volume/(modelVolume×0.05))`** → 被低估 → 置信度偏低
4. **UI 显示**「区域 X cm³」**与 3D 热结标记大小**（`hotspotDisplay.js:40` `cbrt(3V/4π)`）
   → HR4012 的标记半径偏小 **2~3 倍**

> 注：`regionArea` 是由 `volume/meanM` 反推的（`peakRegion.js:169`），**不是独立测量**，
> 因此它也被同一个因子污染，**不能用它交叉验证**。

### E.2 【二级：算法准确】—— **中**

区域由阈值定义：`threshold = max(峰M, 原始V/A峰) × regionGrowRatio`（默认 0.8）。

**敏感性实测**（ALR2510 v1_1，`refineMaxPoints=64000` 强制 stride=1，只改阈值）：

| `regionGrowRatio` | H1 区域体积 | H2 区域体积 | 相对默认 0.8 |
|---|---|---|---|
| 0.6 | 473.1 cm³ | 188.6 cm³ | 1.15× / 1.13× |
| 0.7 | 445.0 cm³ | 178.1 cm³ | 1.08× / 1.07× |
| **0.8（默认）** | **413.0 cm³** | **166.8 cm³** | — |
| 0.9 | 379.4 cm³ | 139.1 cm³ | 0.92× / 0.83× |

→ 阈值在合理区间内变化只带来 **0.83 ~ 1.15×（±20%）** 的体积变化，**区域定义本身是稳定的**。
（对比：stride 带来的误差是 8~27×，**量级完全不同**。）

### E.3 【三级：工程准确】—— **低**

见【F】。区域是"局部 M 场高于阈值 80% 的连通体素集"，
**与"这个冒口实际负责补缩多少金属"没有建立任何关系**，代码里也没有任何机制去建立。

### E.4 三级评级汇总

| 判据 | 评级 | 依据 |
|---|---|---|
| **几何准确性** | **低** | `extractRegion` 漏乘 `stride³`，实测低估 8~27×（有唯一正确答案，可修） |
| **热点识别准确性** | **中** | 阈值敏感性 ±20%；但峰模数另有 `modulusCeilRatio=1/3` 导致的系统性偏低（见 V2.0-01 §10 附表） |
| **作为补缩体积的工程合理性** | **低** | region ≠ feeding zone（见【F】） |

---

## 【F. 热点体积是否等于 feeding zone】

### 结论：**不等于。两者是不同的概念，且代码里没有从前者推导后者的任何机制。**

### F.1 逐项对照（99.txt §四 要求考虑的因素）

| 因素 | Hotspot V3 是否建模 | 说明 |
|---|---|---|
| 热点周围的补缩范围 | ❌ | 区域由 **M 场阈值**定义（0.8×峰），不是由补缩物理定义 |
| 补缩距离（feeding distance） | ❌ | 无此模型 |
| 凝固方向 | ❌ | 无温度场，无方向 |
| 内浇口位置 | ❌ | Hotspot V3 不读浇注系统 |
| 冒口颈 | ❌ | 颈在 `runRiser` 里算，**不影响** region |
| 冷铁 / 激冷条件 | ❌ | 不耦合 |
| 多冒口之间的竞争 | ❌ | 无（代码注释自认「V1 不做 feed-zone 分区补缩」） |
| 一个冒口负责多个热点 | ❌ | 无此关系；`processInspection.js:133` 明文禁止"负责"措辞 |
| 一个热点需要补缩远大于自身的区域 | ❌ | 无 |
| 薄壁区 / 厚壁区区分 | 部分 | `thin` 统计只用于 WARNING 分级，不参与 region |
| 热点多个连通区域 | ✅ | BFS 单连通分量；但**只有体积导出，形状不导出** |

### F.2 概念上的差别

`region` 是：**在局部窗口内，模数场 `M = V/A` 高于「峰值的 80%」的采样格点连通集**。

它是一个 **"几何/数值" 对象**：回答"哪块地方的局部模数最接近峰值"。

feeding zone 是：**"这块金属在凝固过程中，其收缩由该冒口通过冒口颈补充"** ——
它是一个 **"工艺/热历史" 对象**：取决于凝固顺序、温度梯度、补缩通道是否先于该区域凝固。

**两者只在"热节心部"这一小块上大致重合；越往外差别越大。**
`region` 的生长完全由 `M ≥ 0.8×M_peak` 决定 —— 如果一块薄壁恰好连在厚区旁边且模数没掉到 80% 以下，
它就会被算进 `region`；反之，一块实际靠冒口补缩但模数已衰减的区域就被排除在外。
**这两个方向都可能错，且没有物理依据说明它们恰好抵消。**

### F.3 对 99.txt §四 的最终判断

> **「Hotspot Volume」是否可以直接用于当前体积校验？**

# **不推荐（需要进一步定义 feeding zone）。**

---

## 【G. 实际案例 A/B 实验】

### G.1 案例选取（99.txt §六 要求）

**案例 1（放大明显）**：`HR4012塑料模具v4最早大板.stl`
—— 热点模数校验满足，但最终尺寸因体积校验被放大 **1.92 倍直径 / 7.08 倍体积**。

**案例 2（对照，未被放大）**：`ALR2510塑料模具v1_1.stl`
—— 恰好落在交叉点附近，体积校验**没有**主导。**说明"偏大"不是普遍现象，而是重量相关。**

两者均为项目内真实产品件（`tests/real-stl/`，内部调查可用）。

### G.2 案例 1 完整数据（HR4012，球铁，圆柱形 hd=1.0，eff 14%）

| 项 | 值 |
|---|---|
| 产品体积 | 10,923.4 cm³ |
| 产品净重 | 77.56 kg（ρ=7.1） |
| 热点模数 Mc | 11.43 mm（stride=1 时 11.65 mm） |
| 热点区域体积 | **报告 59.2 cm³** ／ **stride 修正后 775.9 cm³** |
| 热点区域占铸件 | 报告 0.5% ／ 修正 7.1% |
| 初始冒口模数 Mr_need | 11.43 × 1.10 = **12.57 mm** |
| **初始冒口尺寸** | **D = 75.4 mm, H = 75.4 mm** |
| 初始冒口体积 | **337 cm³** |
| **体积校验要求** | `needVol = 10923.4 × 3% = 327.7 cm³` → `Vr ≥ 327.7/0.14 = 2340.7 cm³` |
| **最终冒口尺寸** | **D = 144 mm, H = 144 mm** |
| 最终冒口体积 | **2345 cm³** |
| **放大条件** | 体积约束 `effV ≥ Vc×shrink` 未在 f=1.10 满足 → **f 迭代 20 次至 2.10** |
| 最终 final_f | **2.10**（即 Mr_act = 2.10 × Mc） |
| 最终冒口重 | 16.65 kg = **净重的 21.5%** |
| 出品率 | 82.3% |

### G.3 A / B / C 三模型对比（纯计算实验，不改代码）

| 模型 | 被补缩对象 | HR4012 要求 D | ALR2510 要求 D | 说明 |
|---|---|---|---|---|
| 基线 | 仅模数（Mr=1.10Mc） | **75.4 mm** | **66.1 mm** | 与下面比大小 |
| **A** | 整个产品 10,923 cm³ | **143.9 mm**【主导】 | 66.0 mm（被模数压制） | **现状** |
| **B** | 热点区域（**当前报告值** 59.2 cm³） | 25.3 mm | 24.3 mm | ⚠️ **远低于模数要求** |
| **B'** | 热点区域（**stride 修正** 775.9 cm³） | 59.6 mm | 48.3 mm | 被模数压制 |
| **C** | feeding zone | **【代码不具备，无法计算】** | 同左 | 无定义、无数据 |

### G.4 若采用 B' 的结果

| | HR4012 现状 (A) | HR4012 若用 B' | 变化 |
|---|---|---|---|
| 冒口直径 | 144 mm | **75 mm** | **1.92×** |
| 冒口体积 | 2345 cm³ | **331 cm³** | **7.08×** |
| 冒口重 | 16.65 kg | **2.35 kg** | 7.08× |
| 占净重 | 21.5% | **3.0%** | — |

**ALR2510 若用 B'：直径 66 → 66 mm（无变化），体积无变化。**
（因为它本来就被模数约束主导。）

### G.5 ★ 实验的关键警示

**若直接用「当前报告的」热点体积（B，未修 stride）**：
HR4012 会得到 **D = 25.3 mm** —— **只有模数要求（75.4 mm）的 1/3**。
虽然模数约束仍会把它托住，但这说明 **B 在数值上根本不具备替代 A 的资格**：
**它不是"更合理"，而是"更小且不可信"。**

---

## 【H. 根因判断】

### H.1 冒口偏大的根因（以代码证据为准）

> **当前冒口偏大的主要原因是 volume check 使用整个产品体积/重量作为补缩对象 —— 但不是因为它"写错了"，
> 而是因为"单冒口补缩整个铸件"这个**工程简化模型**在大件/多热节场景下不适用，且该适用边界没有对用户披露。**

三点代码证据：

1. **公式确认**：`calcs/riser.js:108,122` `Vc = cw × 1e6 / ρ`，`cw` = 整件净重（`calcManifest.js:241`）
2. **放大机制确认**：`calcs/riser.js:112-113` —— 体积不满足则 `f += 0.05` 继续放大，
   实测 HR4012 从 f=1.10 涨到 **f=2.10**
3. **适用边界自述存在但未披露**：`js/i18n/zh-CN.js:94` 已写明这是"单冒口对整体铸件补缩的工程简化方法"，
   且"大件、多热节或多冒口铸件应按实际补缩区域分别校核"——**但设计中心结果页不显示这条**，
   只在独立计算器（`riserView.js:254`）显示

**不是** Hotspot V3 的问题：`Mc` 与整件 V/A 量级一致（HR4012：热点 11.43 mm vs 整件 V/A 12.09 mm），
且 V2.0-01 已实测热点模数**偏小**（中位 0.828×解析真值）——**方向相反**。

### H.2 顺带查出的真实缺陷（与"偏大"无关，但必须记录）

**`extractRegion` 漏乘 `stride³`**（`js/engine/v3/peakRegion.js:129,148`）
→ 区域体积被低估 8~27×（实测）。
这是**有唯一正确答案的确定性缺陷**，且影响 4 条下游链路
（tiny_region 闸门 / regionRatio 闸门 / 置信度 / UI 显示与 3D 标记）。

---

## 【I. 是否应该修改】

### I.1 是否应该直接把热点体积替代产品体积？

# **NOT YET**

三条理由：

1. **热点体积当前算不准**：`extractRegion` 漏乘 `stride³`，实测低估 8~27×。
   按当前报告值代入，HR4012 会得到 **D = 25.3 mm**（模数要求 75.4 mm）——
   **这不是修正，是引入一个新的错误。**

2. **热点体积的工程含义 ≠ feeding zone**：region 由 M 场阈值定义，
   不含补缩距离、凝固方向、内浇口/冷铁、多冒口竞争。**项目代码自己也禁止建立"负责"关系**
   （`processInspection.js:133`）。用 region 代替 feeding zone 是**用一个未验证的假设替换另一个未验证的假设**。

3. **"整件 vs 补缩区"是工艺定义问题，不是代码问题**：需要企业/用户裁决
   （本阶段实测已给出可证伪的量化预测：交叉重量 ≈7.5 kg、恒等式 `shrink/eff`），
   **在裁决之前改公式，等于把工艺决策偷偷埋在代码里。**

### I.2 但有两件事**不依赖**上面的裁决，且证据充分

| 项 | 性质 | 理由 |
|---|---|---|
| **① `extractRegion` 的 `stride³` 漏乘** | **确定性缺陷** | 有唯一正确答案；与"整件 vs 补缩区"之争无关；当前正在污染显示值与 4 条闸门 |
| **② 设计中心补披露** | **可用性缺陷** | 免责说明文案**早已存在**（`riser.note.volSimplified`），只是没在设计中心结果页显示 |

### I.3 明确**不**建议做的事（避免为了"让冒口变小"而动）

- ❌ 调小 `f`（1.10）、调大 `eff`、调小 `shrink` —— 这些是**工艺参数**，不是 bug
- ❌ 直接把 `Vc` 换成 `regionVolume`
- ❌ 把 `modulusCeilRatio` 从 1/3 改成 1/2 —— 那会**放大**模数（V2.0-01 已量化），
  在当前体积校验仍是整件的前提下会**把冒口推得更大**

---

## 【J. 下一步建议】

> 按 99.txt §九 4 的 P0/P1/P2 框架，但**按证据强度重新排序**（不迎合"应该改小"的预期）。

### P0 —— 证据充分、与工艺裁决无关，应立即处理

1. **修 `extractRegion` 的体积计算**：`volume = pts.length × vs³ × stride³`
   （或等价地：用采样点间距³ 作为 cellVol）。
   **修之前必须先评估副作用**：修完后 HR4012 的 H2/H4/H5 区域占比达 14~21%，
   会**开始触发 `regionVolumeMaxRatio = 0.08` 判据**（当前被掩盖）→ 可能改变检出结果。
   **必须连同 `regionMinVolumeMm3` / `regionVolumeMaxRatio` / 置信度权重一起复核。**
2. **在设计中心结果页显示 `riser.note.volSimplified`**（文案已存在，纯显示层）。

### P1 —— 需要先建立定义与真值

3. **拿到 1~3 个有企业实际冒口设计的真实件**做基准比对
   （V2.0-01 已列为第一优先；本阶段给出的可证伪预测：`冒口重/铸件净重 = shrink/eff`）。
4. **定义 feeding zone 的工程判据**（补缩距离/温度梯度/凝固方向至少要有其一），
   否则 feeding zone 模型无法建立，也无从验证。

### P2 —— 只有在 P1 完成后才考虑

5. 正式修改体积校核对象（整件 → 补缩区）。

### 若 P1 无法完成

> **宁可保留 WARNING（并如实披露适用边界），也不要为了让冒口变小而强行修改公式。**
> 当前状态是"结果偏保守 + 未披露适用边界"；
> 强行改成热点体积会变成"结果偏小 + 未验证"——**后者在铸造上是危险方向**（缩孔/缩松）。

---

## 【涉及文件】

**本次审计只读、未修改**：

| 文件 | 涉及内容 |
|---|---|
| `calcs/riser.js` | `runRiser` 体积校核公式（:107-111, :122-126） |
| `calcs/calcManifest.js` | riser 选源与 `cast_wt` 接线（:241, :245-272） |
| `js/engine/v3/peakRegion.js` | `extractRegion` 区域体积（:118-171，缺陷在 :129/:148） |
| `js/engine/v3/sampling.js` | `refineSample` 的 stride（:326） |
| `js/engine/v3/hotspotV3.js` | V3 主流程与热点输出契约（:203-214） |
| `js/engine/v3/configV3.js` | `refineMaxPoints: 8000`（:20）、`regionMinVolumeMm3: 100`（:100）、`regionVolumeMaxRatio: 0.08`（:104）、`modulusCeilRatio`（:45） |
| `js/engine/v3/v3ViewAdapter.js` | `peakModulus→mc`、`regionVolume→regionVolumeCm3`（:36,:39） |
| `js/engine/hotspotDisplay.js` | `regionEqRadius` = `cbrt(3V/4π)`（:40） |
| `js/views/designCenter.js` | 导入链与参数写回（:609-720, :917-955） |
| `js/views/resultsCenter.js` | Page2 冒口结果渲染（:47-125） |
| `js/views/riserView.js` | 独立计算器（唯一显示 `volSimplified` 的地方，:254） |
| `js/i18n/zh-CN.js` / `en-US.js` | `riser.note.volSimplified`（:94 / :1193） |
| `js/model/processInspection.js` | 「负责冒口」措辞禁令（:133） |

## 【涉及函数】

| 函数 | 位置 | 作用 |
|---|---|---|
| `runRiser(input)` | `calcs/riser.js:78` | 冒口主计算（模数 + 体积双约束迭代） |
| `calcMc(mode, v)` | `calcs/riser.js:66` | 热节模数输入转换 |
| `RISER_SHAPES[*].DfromM` | `calcs/riser.js:27-63` | 模数 → 尺寸反算 |
| `CALC_MANIFEST.riser.calculate` | `calcs/calcManifest.js:173` | 门禁 + Mc 选源 + `cast_wt` 接线 |
| `extractRegion(M, sample, peakPt, opts, field)` | `js/engine/v3/peakRegion.js:118` | 区域生长与体积（**缺陷所在**） |
| `refineSample(...)` | `js/engine/v3/sampling.js:313` | 细化采样与 stride |
| `buildModulusField(...)` | `js/engine/v3/modulusField.js:28` | M 场 |
| `analyzeHotspotsV3(mesh, geometry, opts)` | `js/engine/v3/hotspotV3.js:32` | V3 主入口 |
| `toViewResult(v3, geom)` | `js/engine/v3/v3ViewAdapter.js:29` | 结果形态映射 |
| `regionVolumeOf` / `regionEqRadius` | `js/engine/hotspotDisplay.js:44,40` | 区域体积 → 显示半径 |

## 【本次未修改文件】

**全部未修改。** 实测核对：

```
git status --short   →  ?? docs/PHASE_V2.0-02_VOLUME_CHECK_AUDIT.md   （仅本报告）
git diff --stat      →  （空）
js/engine/** 7 指纹  →  d774532a b8d3ab9e 5957831c ad80da9d 80a763ef 5af64ae4 1e3d96cc  （与 BASELINE.md 7/7 吻合）
```

未执行：任何写操作、`git commit`、参数修改、重构、格式化。
实验脚本全部放在系统临时目录（`%TEMP%\v2001_probe\`），**不进项目**。

## 【测试/实验数据】

| 探针 | 内容 | 关键结果 |
|---|---|---|
| `probe_region_volume.mjs` | 直接证明 `extractRegion` 体积 ∝ 1/stride³ | 1× / 8× / 27× / 125×（精确等于 stride³） |
| `probe_region_stride_e2e.mjs` | 真实模型 stride 实测 + E2E 对照 | ALR2510 H1：52.82 → **413.02 cm³**（`refineMaxPoints` 8000→64000） |
| `probe_hr4012_stride1.mjs` | HR4012 强制 stride=1 | 5 个热结区域低估 **10.7~26.4×**；占比 0.4~1.0% → **4.1~21.3%** |
| `probe_sensitivity.mjs` | `regionGrowRatio` 0.6~0.9 | 体积变化 **0.83~1.15×（±20%）** |
| `probe_abc.mjs` | A/B/C 三模型对比 | HR4012：A 要求 D=143.9、B' 要求 D=59.6、模数要求 75.4 |
| `probe_units.mjs` | 单位/密度/重量换算逐项验算 | **全部 ✓**（体积↔重量往返恒等；`Vr×rho/1e6` 正确） |
| `probe_edges.mjs`（V2.0-01） | 交叉重量与恒等式 | 交叉 ≈7.5 kg；`冒口重/净重 = shrink/eff` |

## 【风险】

1. **本审计发现的 `stride³` 缺陷尚未修复**，正在影响设计中心显示的「区域体积」与 3D 热结标记大小
   （HR4012 偏小 2~3 倍），以及 `tiny_region` / `regionRatio` / 置信度三条内部判据。
2. **修 `stride³` 会改变检出结果**：修完后 HR4012 的 H2/H4/H5 区域占比达 14~21%，
   将开始触发 `regionVolumeMaxRatio = 0.08`（当前被掩盖）。
   **修之前必须评估这三个热点是否会被判 `central_region` 拒掉。**
3. **若在 feeding zone 未定义前就用热点体积替换整件体积**，方向是**冒口变小**，
   在铸造上属于**危险方向**（缩孔/缩松）。本阶段明确给出 **NOT YET**。
4. **本阶段未验证"21.4% 是否过大"** —— 这需要企业实际冒口设计数据，
   不属于代码审计可判定的范围。**已在报告中如实标注为无法判断。**
5. 真实件 `HR4012` 网格带 `INCONSISTENT_WINDING` 警告，`computeVolume` 对该情况不鲁棒
   （V2.0-01 已记录），本次未再展开。

---

## 附：与 PHASE V2.0-01 的关系

| 项 | V2.0-01 | 本阶段（V2.0-02） |
|---|---|---|
| 范围 | 冒口全链只读调查 | **聚焦体积校验对象 + 热点体积可用性** |
| 主结论 | 体积校核用整件 → 与 Mc 脱钩，恒等式 `shrink/eff` | **确认【B】答案 = B（补缩整件）**；量化交叉重量 7.5 kg |
| 热点体积 | 未展开 | **新发现 `stride³` 缺陷：低估 8~27×**；三级评级 低/中/低 |
| A/B/C | 未做 | **已完成**；B' 使 HR4012 直径 144→75（体积 7.08×），ALR2510 无变化 |
| 最终判断 | 待 V2.0-02 | **NOT YET**（热点体积不能直接替代产品体积） |
