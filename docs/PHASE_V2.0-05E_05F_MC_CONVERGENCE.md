# PHASE V2.0-05E / 05F — Mc 多分辨率收敛验证报告

**日期**：2026-10-08 ｜ **基线**：`main @ da1c822`（V1.1.0）｜ **性质**：READ-ONLY EXPERIMENT

> **未修改任何生产代码 / `js/engine/**` / `calcs/riser.js` / V3 默认参数 / 检测逻辑 / `modulusCeilRatio` /
> threshold / `regionVolumeMaxRatio` / confidence / expected / golden / baseline / `phase24 T5`；未 commit。**
> `experimentalGs` 未被改造成正式参数；`opts.resolution` 未修（仍是空转键）；采样公式未改。
>
> 产出：`tests/experiments/out/phasev2005ef_mc_convergence.json` · `.csv` ·
> `phasev2005e_only.json`（05E 原始） · 临时探针 `phasev2005e_probe.mjs` / `phasev2005f_probe.mjs` / `mcConvCommon.mjs`

**本报告严格区分【实验事实】【代码机制】【工程解释】【推测】。**

---

## 0. 结论速览

| 阶段 | 结果 |
|---|---|
| **05E**（thickEnd × 3） | **QUALIFIED_FOR_05F** —— 轴成立、主 Mc 单调收敛（Δ 逐半）、位置漂移收敛 |
| **05F**（6 几何 × 3 = 18 runs） | **PARTIAL** —— 轴 5/6 成立；**0/6 几何为 STABLE**；**系统性 finer→larger 且工程输出未进入稳定区** |
| **V3 冻结** | **不建议** |

---

## 1. combined resolution axis 的构造与审计（§六）

**【实验事实】** 轴 = `(experimentalGs, refineMaxPoints)` 组合：

| | experimentalGs | refineMaxPoints |
|---|---|---|
| L1 | 64 | 8000 |
| L2 | 96 | 32000 |
| L3 | 128 | 128000 |

**【代码机制】** 两个参数分工不同：

- `experimentalGs` → `sampling.js:116-118` → 强制 `vs = mdim/gs` → **改变 `coarse.vox`（M 场的载体）**
- `refineMaxPoints` → `sampling.js:326` → `stride = max(1, ceil(cbrt(refGs³/R)))` → **只改变 refine 采样密度**

**【实验事实】** thickEnd 上的审计（§六 全部 6 条条件）：

| | field vs | 主区 spacing | stride |
|---|---|---|---|
| L1 | 7.1875 | 14.375 | 2 |
| L2 | 4.7917 | 9.5833 | 2 |
| L3 | 3.5938 | 7.1875 | 2 |

⇒ field 严格变细（7.19→4.79→3.59）**且** sampling 严格不变粗（14.375→9.583→7.188）。
**默认候选（64/8000、96/32000、128/128000）满足 §六 全部条件，直接采用，未作任何调整。**

---

## 2. §七 三档完整记录

**【实验事实】** 全部 18 次运行数据见 JSON/CSV。核心表（riser：球铁 / cyl / hd=1 / **cast_wt=0**）：

| geometry | 指标 | L1 (gs64/R8000) | L2 (gs96/R32000) | L3 (gs128/R128000) |
|---|---|---|---|---|
| **bossOnPlate** | coarse vs / 主区 refGs / spacing | 6.25 / 16 / 6.121 | 4.167 / 27 / 4.167 | 3.125 / 37 / 3.125 |
| | 峰数 / conf | 1 / 0.9594 | 1 / 0.9691 | 1 / 0.9517 |
| | **Mc** | **9.4047** | **9.4722** | **9.6458** |
| | D / H / Vr | 62 / 62 / 187182 | 63 / 63 / 196386 | 64 / 64 / 205887 |
| **thinShell** | 状态 | **NO_HOTSPOT** (`no_candidate`) | 同 | 同 |
| | coarse maxM | 1.0417 | 1.0104 | 1.5625 |
| **thickEnd** | coarse vs / 主区 refGs / spacing | 7.1875 / 29 / 14.375 | 4.792 / 45 / 9.583 | 3.594 / 58 / 7.188 |
| | 峰数 / conf | 1 / 0.9675 | 2 / 0.9792 | 1 / 0.9476 |
| | **Mc** | **9.2188** | **9.6181** | **9.8177** |
| | D / H / Vr | 61 / 61 / 178270 | 63 / 63 / 196386 | 65 / 65 / 215690 |
| **pvpPair** | coarse vs / 主区 refGs / spacing | 2.969 / 19 / **2.969** | 1.979 / 47 / **3.958** | 1.484 / 65 / **2.969** |
| | 峰数 / conf | 2 / 0.9186 | 2 / 0.9061 | 1 / 0.9045 |
| | **Mc** | **4.5573** | **4.3924** | **4.8047** |
| | D / H / Vr | 30 / 30 / 21206 | 29 / 29 / 19155 | 32 / 32 / 25736 |
| **t19_valveLike** | coarse vs / 主区 refGs / spacing | 4.6875 / 32 / 9.375 | 3.125 / 50 / 6.25 | 2.344 / 61 / 4.688 |
| | 峰数 / conf | 5 / 0.9343 | 5 / 0.9087 | 5 / 0.9246 |
| | **Mc** | **6.3079** | **6.5625** | **6.6406** |
| | D / H / Vr | 42 / 42 / 58189 | 43 / 43 / 62445 | 44 / 44 / 66903 |
| **HR4012** | coarse vs / 主区 refGs / spacing | 9.375 / 28 / 18.75 | 6.25 / 41 / 12.5 | 4.688 / 48 / 4.688 |
| | 峰数 / conf | 5 / 0.9274 | 5 / 0.9524 | 5 / 0.9504 |
| | **Mc** | **11.4045** | **11.2001** | **11.6492** |
| | D / H / Vr | 75 / 75 / 331340 | 74 / 74 / 318262 | 77 / 77 / 358560 |

**【工程解释】** `cast_wt=0` ⇒ volume path 不参与（`volOk=true` 恒成立），**本阶段所有 D/H/Vr 只反映 modulus path**。
生产档（`cw=77.56kg`）的 HR4012 是 D=144 —— 差异全部来自体积校核（V2.0-05A §7 已量化）。

---

## 3. §八 核心判据

| # | 判据 | 结果 |
|---|---|---|
| 1 | field resolution 逐步提高 | **✓ 6/6**（vs 严格下降） |
| 2 | sampling 同步不粗化 | **△ 5/6** —— **pvpPair 违反**（2.969 → **3.958** → 2.969） |
| 3 | Mc 是否逐渐稳定 | **△ 2/5**（见 §4） |
| 4 | hotspot 主区可追踪 | **✓ 5/5**（主区 refGs 单调随场变化，`|ΔM|`=0） |
| 5 | 是否"更细反而明显跳变" | **✗ 有**（pvpPair、HR4012 反向放大） |
| 6 | 工程输出是否稳定 | **✗ ΔVr23 全部为正，+4.84% ~ +34.36%** |

---

## 4. Mc 收敛分析（§九 / §十三）

**【实验事实】** 不使用 `expectedHotspots[].mc` 作 accuracy 判据（§九）。

| geometry | Mc L1 | Mc L2 | Mc L3 | ΔMc12% | ΔMc23% | **span%** | D1/D2/D3 | ΔVr12% | ΔVr23% |
|---|---|---|---|---|---|---|---|---|---|
| **t19_valveLike** | 6.3079 | 6.5625 | 6.6406 | +4.04 | **+1.19** | 5.27 | 42/43/44 | +7.31 | +7.14 |
| **bossOnPlate** | 9.4047 | 9.4722 | 9.6458 | **+0.72** | +1.83 | **2.56** | 62/63/64 | +4.92 | +4.84 |
| **HR4012** | 11.4045 | 11.2001 | 11.6492 | −1.79 | **+4.01** | 4.01 | 75/74/77 | −3.95 | +12.66 |
| **thickEnd** | 9.2188 | 9.6181 | 9.8177 | +4.33 | **+2.08** | 6.50 | 61/63/65 | +10.16 | +9.83 |
| **pvpPair** | 4.5573 | 4.3924 | 4.8047 | −3.62 | **+9.39** | **9.39** | 30/29/32 | −9.67 | **+34.36** |

### ★★ 两个系统性发现

**【实验事实】发现 1：L2→L3 **全部 5 个几何的 Mc 都在增大**（+1.19% ~ +9.39%），ΔVr23 全部为正。**

**【实验事实】发现 2：ΔMc 逐级缩小的只有 2/5**（thickEnd 4.33→2.08、t19 4.04→1.19）；
pvpPair（−3.62→**+9.39**）与 HR4012（−1.79→**+4.01**）**符号反转且幅度放大**；bossOnPlate Δ 微增（0.72→1.83）。

**【工程解释】** 发现 1 说明 **field 细化尚未收敛** —— 更细的场系统性地给出更大的 Mc。
**【推测】** 可能与 `modulusCeilRatio = 1/3` 的封顶有关：场越细，`d`（到表面距离）与窗口 V/A 的离散误差越小，被封顶的点越少 → M 越大。
**这只是推测，本阶段未设计能证实/证伪它的实验。**

---

## 5. §十四 变化分类

| geometry | 分类 | 支撑 |
|---|---|---|
| **t19_valveLike** | **CONVERGING** | Δ 4.04→1.19 逐级缩小，峰数 5/5/5 恒定 |
| **bossOnPlate** | NUMERICALLY_STABLE_POSITION_SENSITIVE | span 最小 2.56%，但位置漂移 31.1mm |
| **HR4012** | NUMERICALLY_STABLE_POSITION_SENSITIVE | span 4.01%，位置漂移 58.2mm |
| **thickEnd** | PEAK_SELECTION_SENSITIVE | 峰数 **1/2/1** |
| **pvpPair** | PEAK_SELECTION_SENSITIVE | 峰数 **2/2/1**，且轴违反、ΔMc 反向放大 |
| **thinShell** | **NOT_APPLICABLE** | 三档全部 `NO_HOTSPOT (no_candidate)`，无 Mc |

> **★ 0/6 几何为 STABLE。**
> （`thinShell` 在本分类器下被默认标为 STABLE，**此处如实更正为 N/A** —— 它没有 Mc 可谈。）

**【实验事实】位置稳定性（`position` = 区域质心代表点，非峰点）**

| geometry | 峰数 | 主代表点漂移 L1→L2 / L2→L3 |
|---|---|---|
| bossOnPlate | 1/1/1 | 31.10 / 5.05 mm |
| thickEnd | 1/2/1 | 14.41 / 1.20 mm |
| pvpPair | 2/2/1 | 94.08 / 1.34 mm |
| t19_valveLike | 5/5/5 | 88.83 / 70.66 mm |
| HR4012 | 5/5/5 | 58.23 / 2.87 mm |

**【工程解释】** **L1→L2 位置漂移普遍很大（14~94mm），L2→L3 多数收敛**。
**t19 是最好的反例**：Mc 收敛最好（CONVERGING），位置漂移却最大（88.8/70.7mm）
⇒ **"Mc 稳" 与 "位置稳" 是两件独立的事**（与 PHASE 83/84/85 的"峰点准、代表点漂"同源）。

---

## 6. §十五 总体门禁

| # | 问题 | 回答 |
|---|---|---|
| **A** | 三档 resolution axis 在 6 个 geometry 中是否成立？ | **5/6 成立**；**pvpPair L1→L2 违反**（field 变细但 sampling 变粗 2.969→3.958） |
| **B** | 是否存在普遍性的 Mc convergence trend？ | **✗ 不普遍**。Δ 逐级缩小仅 2/5；**但存在系统性方向：L2→L3 全部 Mc 增大** |
| **C** | 是否有某一 geometry 明显破坏整体结论？ | **✓ pvpPair**（ΔMc23 +9.39% 反向放大、ΔVr23 +34.36%、峰数 2/2/1、轴违反） |
| **D** | engineering riser output 是否基本稳定？ | **✗ ΔVr23 全部为正（+4.84 ~ +34.36%），未进入稳定区** |
| **E** | 系统性 finer→larger 且无法进入稳定区？ | **△ 系统性 finer→larger 已确认（5/5）；能否进入稳定区本阶段无法判断**（需要第四档） |
| **F** | hotspot detection 是否成为主要不稳定来源？ | **✓ 是**。见 §7 |

---

## 7. 不稳定来源归因（§十九 第 8 问）

**【实验事实】**

| 来源 | 证据 | 判定 |
|---|---|---|
| **field discretization** | vs 严格按设计变细，6/6 成立 | **不是主因** |
| **sampling** | 5/6 单调不粗化 | **不是主因**（但 pvpPair 是） |
| **peak selection** | 峰数变化 1/2/1、2/2/1；代表点漂移 14~94mm | **★ 主因** |
| **hotspot position** | 5/5 几何 L1→L2 漂移 >14mm | **★ 主因（与 peak selection 同源）** |
| **Mc 数值本身** | t19 收敛最好但位置漂移最大；bossOnPlate span 最小 | Mc 数值比位置更稳 |

**【工程解释】** 不稳定集中在 **峰值选择 / 代表点定位** 这一层，而不是 **Mc 的数值**。
这与项目历史一致：PHASE 85 的结论是"检测强、定位弱"（Peak detection 19/20 vs Representative accuracy 7/20）。

---

## 8. §十七 HR4012 专项（真实工程件）

**【实验事实】**

| Level | Mc | position | D | H | Vr | Mr_act | conf | regionVol |
|---|---|---|---|---|---|---|---|---|
| L1 | 11.40450 | `[46.376, -40.590, -100.371]` | 75 | 75 | 331340 | 12.500 | 0.9274 | 1338135 |
| L2 | 11.20014 | `[63.251, -33.600, -155.659]` | 74 | 74 | 318262 | 12.333 | 0.9524 | 706543 |
| L3 | 11.64922 | `[65.594, -35.052, -154.877]` | 77 | 77 | 358560 | 12.833 | 0.9504 | 775875 |

- **ΔMc12 = −1.79% ｜ ΔMc23 = +4.01% ｜ span = 4.01%**（**符号反转且放大**）
- **ΔD12 = −1mm ｜ ΔD23 = +3mm ｜ ΔH 同 ｜ ΔVr12 = −3.95% ｜ ΔVr23 = +12.66%**
- **峰数 5/5/5 恒定**；位置漂移 58.23 / 2.87 mm
- 分类：**NUMERICALLY_STABLE_POSITION_SENSITIVE**

**【与前序 PHASE 的对照】**

| 阶段 | HR4012 观察 |
|---|---|
| V2.0-01 | 生产档 `hotspots[0].mc = 11.43`；`cw=77.56kg` → **D=144、16.65kg**（体积校核主导） |
| V2.0-04 | 5 热结；旋转下 Mc 最大偏差 **3.84%**；求交算法自身 81/81 旋转不变 |
| **V2.0-05E/F** | `cw=0` → D=75/74/77；Mc span **4.01%**，**非单调**；峰数恒定 |

**【工程解释】**
- 本阶段 Mc 的 **span 4.01%** 与 V2.0-04 旋转下的 **3.84%** 量级相当 —— **两种扰动（分辨率 / 姿态）给 HR4012 带来的 Mc 不确定性是同量级的**。
- 生产档 Mc = 11.43 落在 L2(11.20) 与 L3(11.65) 之间 —— **本实验的三档都不等于生产档**（生产走 `adaptiveVs`，不传 `experimentalGs`）。**本实验表征的是轴，不是生产值。**
- **这些差异在 `cw>0` 时会被体积校核吸收**（V2.0-05A §7：HR4012 上 Mc 8→20 冒口完全不变）。

---

## 9. §十九 十个问题

1. **`experimentalGs` 是否确实控制 coarse M field resolution？** —— **✓ 是。** vs 随 gs 严格下降（6/6）；M 场由 `buildModulusField(coarse.vox, ref, …)` 在 `coarse.vox` 上定义（`hotspotV3.js:118`）。
2. **`refineMaxPoints` 是否可作为 sampling compensation 而非 Mc resolution knob？** —— **✓ 是**（05D 证明它单独对 Mc 零响应）。**但有个反例**：pvpPair 在 L1→L2 时它没能补偿住（region 相对变大 → stride 跳 1→2）。
3. **是否成功构造 3 个 field 逐步变细、sampling 不反向粗化的 combined levels？** —— **5/6 成功；pvpPair 违反。**
4. **thickEnd 三档 Mc 是否表现出收敛？** —— **✓ 是**：单调递增、Δ 逐半（4.33%→2.08%）、位置漂移 14.4→1.2mm。
5. **6 geometry × 3 levels 中 Mc 是否普遍收敛？** —— **✗ 不普遍**。Δ 逐级缩小 2/5；**系统性 finer→larger 5/5**。
6. **哪些 geometry 最稳定？** —— **t19_valveLike**（Δ 逐级缩小、峰数恒定、span 5.27%）；**bossOnPlate**（span 最小 2.56%）。
7. **哪些 geometry 最不稳定？** —— **pvpPair**（ΔMc23 +9.39% 反向放大、ΔVr23 **+34.36%**、峰数 2/2/1、轴违反）；次为 **HR4012**（ΔMc 反转放大、ΔD23 +3mm）。
8. **不稳定主要来自？** —— **peak selection / hotspot position**（峰数变化 + 代表点漂移 14~94mm），**不是 field discretization，也不是采样密度**。
9. **当前 Mc 是否已有足够证据作为"工程模数法"的输入？** —— **不足以"冻结"，但足以"继续"**：主 Mc span 2.6~9.4%，**水平方向尚未收敛**，**垂直方向（工程输出）ΔVr23 全部为正且未收窄**。
10. **是否建议冻结 Hotspot V3 并进入下一阶段？** —— **不建议冻结**。

---

## 10. §十六 最终决策

# PARTIAL

**依据 §十六 决策树**：

- "6 geometry 大部分进入稳定区 **且** 不存在明确的算法级反常 **且** riser engineering output 基本稳定" → 冻结候选
  - **✗ 不满足**：**0/6 为 STABLE**；pvpPair 存在**轴违反**这一算法级反常；**ΔVr23 全部为正（+4.84 ~ +34.36%）**
- "部分 geometry 明显不稳定" → **PARTIAL** ✓ **满足**

**⇒ 不冻结 V3。**

### 哪些稳定 / 哪些不稳定

| 稳定 | 不稳定 |
|---|---|
| t19_valveLike（CONVERGING） | pvpPair（PEAK_SELECTION_SENSITIVE + 轴违反） |
| bossOnPlate（span 最小 2.56%） | thickEnd（PEAK_SELECTION_SENSITIVE，但主 Mc 收敛） |
| | HR4012（ΔMc 反向放大） |
| | thinShell（无热点，N/A） |

### 不稳定属于哪一类

**C. peak detection / hotspot position**（§二 的失败分类），**不是** A（sampling axis）或 B（field resolution）。

### 是否需要进一步实验

**需要。** 最小增量见 §11。

---

## 11. 建议的下一步（未执行）

**【推测/建议，非结论】**

1. **加第 4 档（gs=192 或 R 进一步）** 验证"finer→larger"是否收敛 —— 当前 L3 仍在向上，**无法判断是收敛还是单调漂移**。
2. **逐几何校准 `refineMaxPoints`**（而非全局统一阶梯）—— pvpPair 的违反源于 `refgs` 随几何缩放方式不同。**红线：只能以"消除 sampling confounding"为目的，不得以"让 Mc 好看"为目的。**
3. **把 peak selection 的不稳定单独立案** —— 它是本阶段唯一的**主要**不稳定来源，且与 V2.0-02/03 的 `regionVolumeMaxRatio` 遗留、PHASE 85 的 "Representative accuracy 7/20" 同源。
4. **不要**据本阶段结果调整 `modulusCeilRatio`、threshold、`regionVolumeMaxRatio` 或 V3 结构。

---

## 12. 诚实边界

- **本实验不做 accuracy 判定** —— `expectedHotspots[].mc` 未参与任何结论（§九）。
- **`cw=0`** —— volume path 被隔离，**结论只对 modulus path 成立**。
- **三档均不等同生产档** —— 生产走 `adaptiveVs`；本实验强制 `experimentalGs`。
- **18 次运行 × 1 次** —— 未做重复运行（确定性已有 20/20 的独立证据）。
- **`position` 是代表点（区域质心），不是峰点** —— 位置漂移 ≠ 峰点漂移。
- **pvpPair 的轴违反未被修正** —— 如实报告，未调参掩盖。
- **`thinShell` 三档全部 `NO_HOTSPOT`** —— 它不构成 Mc 收敛证据（正反都没有）。
