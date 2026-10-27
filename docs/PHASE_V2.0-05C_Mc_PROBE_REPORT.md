# PHASE V2.0-05C — Mc 收敛门禁最小探针报告

**thickEnd × experimentalGs ∈ {64, 96, 128}**

**日期**：2026-10-08 ｜ **基线**：`main @ da1c822` ｜ **性质**：READ-ONLY EXPERIMENT（最小实验）

> **本阶段未修改任何生产代码 / `js/engine/**` / `riser.js` / V3 参数 / `opts.resolution` / `phase24 T5` / `BASELINE.md` / expected / golden / 历史数据；未 commit。**
> 临时探针脚本落 `tests/experiments/phasev2005c_probe.mjs`（未伪装成生产代码）；
> `debug` 未暴露的字段按当前代码公式推导并标注 `derived`。

---

## 1. 实验目的

只验证 PHASE V2.0-05B 的**测试驱动**是否真的能改变 V3 采样分辨率，并正确记录
`Mc → riser D/H/Vr`。**不做 Gate v1 判定。** 通过后才允许进入完整 18 次实验。

---

## 2. 基线

| 项 | 值 |
|---|---|
| commit | `main @ da1c822` |
| 夹具 | `thickEnd`（`tests/tools/hotspotGeometryGenerator.mjs`，默认参数 l=400 / body=40 / endL=120 / endS=60） |
| 真值 | `gt.expectedHotspots[0].mc = 30`（dEnd = min(endS/2, endL/2) = 30） |
| triCount | 见 JSON |
| riser 配置 | `球铁 / cyl / hd_ratio=1.0 / cast_wt=0`（cw=0 隔离模数路径；thickEnd 为合成件，无定义净重） |
| 唯一自变量 | `experimentalGs` |

---

## 3. 静态调用链（§三 A–F）

### A. `experimentalGs` 的真实入口 ✓

```
tests/experiments/phasev2005c_probe.mjs
  → analyzeHotspotsV3(mesh, geometry, { experimentalGs })      hotspotV3.js:32
      o = { ...V3_DEFAULTS, ...opts }                          hotspotV3.js:33
  → coarseSample(mesh, geometry, o)                            hotspotV3.js:49
      o = { ...V3_DEFAULTS, ...opts }                          sampling.js:138
  → adaptiveVs(geometry, bounds, globalMin, o)                 sampling.js:145
      if (o.experimentalGs > 0) {
        vs = mdim / o.experimentalGs;                          sampling.js:117
        gs = o.experimentalGs;                                 sampling.js:118
      }
```

**结论：`experimentalGs` 确实控制 V3 的初始 `gs`。** 但它位于 `coarseSample` 的
**多级升级循环之前**，若 `nInside < minInsidePoints(128)` 或触发相位偏移，`usedGs` 会被改写。
本次实测 `debug.coarse.gs === experimentalGs`（三档全中）→ **未触发升级**。

### B. `opts.resolution` ✓（未使用，未修）

本探针**只传 `experimentalGs`**，未传 `resolution`。
（`opts.resolution` 在 `js/engine/v3/**` 中**无任何消费点** —— V2.0-05B §7.3 已记录，本阶段不修。）

### C. stride —— **★ 106.txt §三C 给的公式与代码不符**

| | 公式 | 出处 |
|---|---|---|
| **106.txt §三C 所给** | `stride = max(1, ceil(cbrt(gs³/8000)))` | — |
| **coarse 网格实际** | `stride = max(1, ceil(cbrt(nInside / min(nInside, coarseMaxPoints=20000))))` | `sampling.js:180` |
| **refine 网格实际** | `stride = max(1, ceil(cbrt(refGs³ / refineMaxPoints=8000)))` | `sampling.js:326` |

**106.txt 的公式是 refine 用的，不是 coarse 用的**（§三 原话是"根据当前 sampling.js **实际公式**"，以代码为准）。
两者差 4~7 倍：

| gs | 106.txt 公式预测 | coarse 实测 |
|---|---|---|
| 64 | **4** | **1** |
| 96 | **5** | **1** |
| 128 | **7** | **2** |

**coarse 实测 3/3 与代码公式吻合**（`nInside` = 2779 / 8710 / 20998）。

### D. sampling spacing（未假设 stride=1）✓

`spacing = vs × stride`（与 `peakRegion.js` 的 `cellVol` 同源）。

### E. Mc 来源 ✓

`peakModulus = p.M`，`p` 来自 `findPeaks(refField.M, ref, refField, o)` —— **refine 场的局部极大**。
`refField = buildModulusField(coarse.vox, ref, o, 1.0)`（全局体素网格 + 细化采样点）。
**本次记录的 Mc = `hotspots[].peakModulus`，未使用 `regionVolume` 代替。**

### F. riser 输入 ✓

`runRiser({ mc_mode:'direct', mc: mainHotspot.mc, ... })` → `calcMc` 返回 `parseFloat(v.mc)`
→ `Mr_need = Mc × f`。**实测吻合**：9.21875 × 1.10 = 10.140625 ✓。
`cw=0` → `volOk` 路径不参与（`volOk = true`），**如实记录，未修改 `riser.js`**。

**⇒ A–F 全部可证，未触发 STOP。**

---

## 4. gs → stride → spacing 验证

| gs | nInside | nInside>20000 | coarsePts | coarse stride 实测 | 公式 | match | coarse spacing |
|---|---|---|---|---|---|---|---|
| 64 | 2779 | false | 2779 | **1** | 1 | ✓ | 7.1875 mm |
| 96 | 8710 | false | 8710 | **1** | 1 | ✓ | 4.7917 mm |
| 128 | **20998** | **true** | 2496 | **2** | 2 | ✓ | **7.1875 mm** |

**★ coarse spacing 非单调**：7.1875 → 4.7917 → **7.1875**（gs 96→128 时反而变粗）。
根因：gs=128 时 `nInside = 20998` 越过 `coarseMaxPoints = 20000` 门槛 → stride 跳 1→2，
抵消了 vs 变细（3.59 mm）带来的收益。

**★ refine 网格（真正产出 Mc 的那一层）**：

| gs | refine gs 序列 | refine stride 序列 | refine spacing 序列 (mm) | **最小 spacing** |
|---|---|---|---|---|
| 64 | 29,18,16,19,20,17,16,16 | 2,1,1,1,1,1,1,1 | 14.375, 7.188, 5.537, 7.188, 7.188, 7.188, 4.414, 4.959 | **4.414** |
| 96 | 45,23,20,31,31,21,16,23 | 3,2,1,2,2,2,1,2 | 14.375, 9.583, 4.792, 9.583, 9.583, 9.583, 4.714, 9.583 | **4.714** |
| 128 | 58,28,43,43,22,22 | 3,2,3,3,2,2 | 10.781, 7.188, 10.781, 10.781, 7.188, 7.188 | **7.188** |

> **gs 从 64 提到 128（全局体素细 2 倍），而产出 Mc 的 refine 网格最小有效间距
> 从 4.414 mm 变**粗**到 7.188 mm（×1.63）。**

---

## 5. 三次运行原始结果

机器可读：`tests/experiments/out/phase_v2005c_mc_probe.json`

| 项 | gs=64 | gs=96 | gs=128 |
|---|---|---|---|
| `experimentalGs` 被采纳 | ✓ | ✓ | ✓ |
| `actualGs` | 64 | 96 | 128 |
| `actualVs` | 7.1875 | 4.791667 | 3.59375 |
| `estMinWall` | 8.75 | 8.75 | 8.75 |
| `nInside` | 2779 | 8710 | 20998 |
| `coarsePts` | 2779 | 8710 | 2496 |
| `coarseMaxM`（粗场峰） | 9.2188 | 9.6181 | 9.8177 |
| `coarsePeaks`（粗场峰数） | 8 | 8 | 6 |
| **采样点集指纹** | `5705d826` | `589b9d75` | `a4f3fe85` |
| `status` | ok | ok | ok |
| `hotspotCount` | **1** | 2 | 2 |
| refine 条目数 | 8 | 8 | 6 |
| `min refine spacing` | 4.414 | 4.714 | 7.188 |
| triCount | 138864（三档同一网格） | | |
| 单次耗时 | 1252 ms | 1307 ms | 1060 ms |

> 注：`estMinWall` 三档恒为 8.75 —— 说明探测链路不受 `experimentalGs` 影响（`sampling.js:116`
> 的 override 在 `estMinWall` 计算**之后**），符合引擎注释"estMinWall 仍按探测链路计算"。
> 另：gs=64/96 的细化 Mc **恰好等于**粗场 `maxM`；gs=128 时不等（9.8177 vs 8.6198）。

---

## 6. Mc 对比

| gs | 主热点位置 | **mainMc** | ΔMc（相邻） | regionVolume (mm³) |
|---|---|---|---|---|
| 64 | `[-34.43, -1.87, -1.87]` | **9.21875** | — | 516860 |
| 96 | `[-33.76, -2.82, -2.82]` | **9.618056** | **+4.33%** | 463392 |
| 128 | `[-22.34, -0.87, -0.87]` | **8.619792** | **−10.38%** | 498759 |

- **三档 Mc 互不相同**（去重 3/3），**非单调**（升→降），**总跨度 10.38%**
- **三档均未命中真值 30**（9.22 / 9.62 / 8.62）—— 与 V2.0-05A 记录的"Mc 系统性偏低"方向一致；**本阶段不评估准确度**
- **H1 位置漂移**：−34.43 → −33.76 → **−22.34**（96→128 漂 **12.1 mm**）
- **H2 出现/消失 + 大漂移**：gs=64 **只有 1 个热点**；gs=96 H2 在 `x=−167.60`；gs=128 H2 在 `x=−349.25`（**漂 181.7 mm**）

---

## 7. riser 输入对比

| gs | `riserInputMc` | `mainHotspot.mc` | 一致？ | `Mr_need` | 校验 `Mc×f` |
|---|---|---|---|---|---|
| 64 | 9.21875 | 9.21875 | ✓ | 10.140625 | 9.21875×1.10 = 10.140625 ✓ |
| 96 | 9.618056 | 9.618056 | ✓ | 10.579862 | 9.618056×1.10 = 10.579862 ✓ |
| 128 | 8.619792 | 8.619792 | ✓ | 9.481771 | 8.619792×1.10 = 9.481771 ✓ |

**`riserInputMc` 严格等于对应 `mainHotspot.mc`，且 `runRiser` 确实消费了它（f=1.10 逐位吻合）。**

---

## 8. D / H / Vr 对比

| gs | Mc | **D** | **H** | **Vr (mm³)** | `Mr_act` | `modOk` | `volOk` | ΔD（相邻） |
|---|---|---|---|---|---|---|---|---|
| 64 | 9.21875 | **61** | 61 | 178270 | 10.166667 | true | true | — |
| 96 | 9.618056 | **63** | 63 | 196386 | 10.500000 | true | true | **+2 mm** |
| 128 | 8.619792 | **57** | 57 | 145450 | 9.500000 | true | true | **−6 mm** |

**D/H/Vr 与 Mc 单调一致**（Mc 升 → D 升；Mc 降 → D 降），读取正确。
**参考（非本阶段判定）**：按 V2.0-05B Gate v1，`ΔD = 2 mm` → WARN；`ΔD = 6 mm` → FAIL。

---

## 9. 是否真正改变了采样分辨率

| # | 问题 | 回答 |
|---|---|---|
| 1 | gs=64/96/128 是否真的进入 V3？ | **✓ 三档全部采纳**（`debug.coarse.gs` 逐一吻合） |
| 2 | 三次 `actualGs` 是否不同？ | **✓ 64 / 96 / 128** |
| 3 | stride 是否符合当前公式？ | **✓ coarse 3/3 吻合**（`nInside` 门槛效应如实复现）。**⚠ 106.txt §三C 所给公式是 refine 的，不是 coarse 的** |
| 4 | samplingSpacing 是否随 stride 正确变化？ | **✓ 按公式正确**，但 **coarse 非单调**（7.19→4.79→7.19）、**refine 单调变粗**（4.41→4.71→7.19） |
| 5 | 三次是否真的使用不同采样网格？ | **✓ 指纹 3/3 不同**（`5705d826 / 589b9d75 / a4f3fe85`），`nInside`/`pts` 亦不同 |
| 6 | Mc 是否变化？ | **✓ 变化**（9.21875 / 9.618056 / 8.619792，非单调，跨度 10.38%） |
| 7 | `riserInputMc` 是否等于 `mainHotspot.mc`？ | **✓ 三档全部一致** |
| 8 | D/H/Vr 是否真的来自这次 Mc？ | **✓ 单调一致 + `Mr_need` 逐位吻合** |

> §六 "如果三次 Mc 完全一样…" 条款**不适用**（Mc 确实不同）。
> **但反过来说也不成立** —— 见 §10。

---

## 10. 判定：SUSPICIOUS（驱动 PASS，现象异常）

### 10.1 驱动链路本身：**PASS**

`experimentalGs` 进入 ✓ · `actualGs` 正确 ✓ · stride 公式吻合 ✓ · Mc 来源正确 ✓ ·
`riserInputMc` 传递正确 ✓ · D/H/Vr 读取正确 ✓ —— §七 A 的五项条件**全部满足**。

### 10.2 但出现两类异常现象（§七 C）→ **SUSPICIOUS**

**现象 ①：hotspot 位置 / 集合不稳定**
- H1 位置漂移 **12.1 mm**（gs 96→128）
- H2 **在 gs=64 不存在**，且 gs=96→128 漂移 **181.7 mm**
- 与"配对异常"同源：**峰集合随 gs 改变**，不是一个可追踪的同一个热点

**现象 ②：★ `experimentalGs` 不是 Mc 的采样分辨率旋钮 —— 方向是反的**

```
experimentalGs ↑  ⇒  全局体素 vs ↓（7.19 → 4.79 → 3.59）  ✓ 符合直觉
                  ⇒  但 refine stride ↑（1 → 2 → 3）
                  ⇒  refine 有效间距 = vs × stride：4.414 → 4.714 → 7.188 mm  ✗ 反而变粗
```

**原因（代码级）**：`refineSample` 的 `stride = max(1, ceil(cbrt(refGs³ / refineMaxPoints=8000)))`
（`sampling.js:326`）。`refGs` 随区域尺度增长，而 **`refineMaxPoints = 8000` 是硬上限** ——
**分辨率越高，细化网格的 stride 越大，有效采样密度反而下降。**

> **这一段与 PHASE 23 早已记录的现象完全一致**（"提高分辨率不改善热结结果……根因 `refineMaxPoints=8000`
> 上限使细化 stride 随网格分辨率增长"）。**本探针第一次用 Mc 数值把它量化出来。**

### 10.3 由此得出的关键推论（对 05B 的修正）

> **`{64, 96, 128}` 这三档，并不是"三个递增的 Mc 采样分辨率"。**
> 它们扫的是**全局体素网格**，而 Mc 来自 **refine 网格**，后者的有效密度**不由 `experimentalGs` 决定**，
> 且随它**反向**变化。
>
> **⇒ PHASE V2.0-05B 设计的「6 几何 × experimentalGs {64,96,128}」扫描，扫错了轴。**
> 若照此跑满 18 次，会产出 18 个**看起来像收敛研究、实际不是**的数字。

**正确的 h-细化旋钮是 `refineMaxPoints`**（直接决定 refine stride，`refineSample` 经 `opts` 消费，
**改它不需要动任何代码**）：

| `refineMaxPoints` | refine gs=29 时 stride | refine gs=58 时 stride |
|---|---|---|
| 8000（当前） | 2 | 3 |
| 32000 | 1 | 2 |
| 128000 | 1 | 1 |

**（上表为按 `sampling.js:326` 公式的静态推算，未经运行验证 —— 应按 §七 纪律另起一次 3 次探针。）**

---

## 11. 是否允许继续完整 18 次实验

# BLOCKED — do not proceed

**不是因为驱动坏了**（驱动已验证正确），**而是因为扫描轴选错了**：
`experimentalGs` 不能一致地改变产出 Mc 的那层采样密度，反而使其反向变化。
在此轴上跑满 18 次，得到的不是 Mc 收敛曲线。

**未自行进入 05D。**

### 若要解锁，建议的最小修正（供下一份命令文件裁决）

1. **把扫描轴换成 `refineMaxPoints`**，例如 `{8000, 32000, 128000}`；
   或**以实测的有效 spacing（`vs × stride`）为横轴**，`experimentalGs` 仅作辅参。
2. **先按 §七 同一纪律，只跑 `thickEnd` × 3 档**验证新轴**确实单调改变 refine 有效间距**。
3. 新轴验证通过后，再上 6 几何 × 3 档。
4. **`experimentalGs` 是否保留为第二根轴**（"全局体素 vs 变化时 Mc 是否稳定"）—— 建议**保留，但单列**，
   因为本次数据显示它确实影响 Mc（10.38%）与峰集合。

### 顺带产出（不修，只报）

| # | 发现 | 状态 |
|---|---|---|
| 1 | **106.txt §三C 的 stride 公式是 refine 的，不是 coarse 的**（两者差 4~7 倍） | 已按代码为准执行；不改代码 |
| 2 | **`opts.resolution` 在 V3 是空转键** | V2.0-05B 已记录；本阶段未修 |
| 3 | **PHASE 23 的 `refineMaxPoints` 退化现象在 V2.0-05C 上被 Mc 数值复现** | 新证据，支持 PHASE 23 的既有结论 |
| 4 | gs=128 时 `nInside = 20998` 刚越过 `coarseMaxPoints = 20000` 门槛 → stride 跳变 | 一个**阈值悬崖**，值得记入限制 |
