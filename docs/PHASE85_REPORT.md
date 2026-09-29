# PHASE 85 · 测试体系升级报告

> 命令文件：`D:\CDXProject\新建 文本文档 (85).txt`
> 日期：2026-09-23　项目：`D:\CDXProject\CCproject\CastingToolbox`
> 原则：**测试体系升级，生产算法冻结。**
> `js/engine/` **零改动**（§3 有三重证明）。

---

## 1. 本阶段完成情况

| 85.txt 要求 | 状态 |
|---|---|
| 二 把"检测"与"位置精度"拆开（5 类信息同时记录） | ✅ detection / zone membership / peak 精度 / representative 精度 / ranking 全部产出 |
| 三 GT metadata（复用既有结构，由 generator 自动生成，不手工填 20 个模型） | ✅ 只补了一个真正缺的字段（ring 的 `axis`），其余全部复用 |
| 四 区域归属判定（`insideExpectedZone` / `zoneId` / 多命中原样记录） | ✅ `zoneMatch` / `zoneCandidates[]`，按声明几何判定，**不用 tolerance 球代替** |
| 五 新匹配三层 + legacy 保留 | ✅ legacy 逐字未改；新增 zone → peak 排序 → representative 距离 |
| 六 结果 schema | ✅ 全部字段落在 `result.json` 的 `diagnostics.hotspots[]`，旧字段保留 |
| 七 7 类 classification（不互相覆盖、优先级写进注释） | ✅ 见 `run_engineering.mjs` `classifyHotspot()` |
| 八 新 summary（10 项指标） | ✅ 控制台 + `summary.json` 的 `diag` 块 |
| 九 保留 legacy score 9/20，不包装成更好看的数字 | ✅ 顶层就叫 "Legacy score: 9 / 20" |
| 十 修 t19 矛盾 | ✅ 拆出 `optionalHotspots` |
| 十一 t06 多热点判断 | ✅ 判断为 B（合理次级热点）+ 发现 GT 记录缺陷 |
| 十二 ring GT 审计 | ✅ §9，给出精确接受区间 |
| 十三 peak / representative 双轨统计 | ✅ `peakCorrectRepresentativeDrift` = 15 |
| 十四 clean mesh fixture | ⚠️ **deferred**（§10 有实测依据，非偷懒） |
| 十五 重跑完整套件，legacy 必须复现 | ✅ **legacy 行逐字节一致** |
| 十六 验证算法零变化 | ✅ §3 |
| 十七 报告 + 回答"是否具备改算法的条件" | ✅ §14 |

---

## 2. 修改文件

**只动了测试体系，未动任何生产代码。**

| 文件 | 改动 |
|---|---|
| `tests/engineering-generated/gen_engineering.mjs` | ① 新增 `--meta-only` 模式（只重写 metadata，**不碰 model.stl**）② ring 型 thickZone 补 `axis` ③ t06 厚区 `centerMm` 修正（见 §8）④ t19 拆 `optionalHotspots` ⑤ t06 增 `optionalHotspots` ⑥ expected.json 增 `legacy` 冻结块 |
| `tests/engineering-generated/run_engineering.mjs` | 新增诊断层（zone 判定 / 双轨 / 分类 / 新 summary）；**legacy 函数逐字未改** |
| `tests/engineering-generated/models/*/expected.json` | 由 `--meta-only` **自动重新生成**（20 份） |
| `tests/engineering-generated/models/*/manifest.json` | 同上 |
| `tests/engineering-generated/models/*/result.json` | 运行器正常输出（新增 `diagnostics` 块） |
| `tests/engineering-generated/summary.json` | 运行器正常输出（新增 `diag` 块，旧字段保留） |
| `docs/PHASE85_REPORT.md` | 新建 |
| `tests/engineering-generated/BASELINE.md` | 更新（PHASE 85 双基线） |

**`model.stl` / `model_r90.stl` / `model_r120.stl` 全部未改动** ——
`--meta-only` 跑前跑后，20 个模型的 STL 指纹一致：

```
跑前：736545b9fb3de783ad8e60449c285674f42a8422172b8fa96cfb6cca32fa56db
跑后：736545b9fb3de783ad8e60449c285674f42a8422172b8fa96cfb6cca32fa56db
```

---

## 3. `js/engine` 零改动证明（85.txt 十六）

**三重证据：**

1. **`git status --porcelain -- js/engine/` → 无输出**
2. **引擎文件 sha256 与 PHASE 84 记录逐位一致：**

   | 文件 | PHASE 84 | PHASE 85 |
   |---|---|---|
   | `v3/hotspotV3.js` | `d774532a` | `d774532a` |
   | `v3/peakRegion.js` | `b8d3ab9e` | `b8d3ab9e` |
   | `v3/sampling.js` | `5957831c` | `5957831c` |
   | `v3/modulusField.js` | `ad80da9d` | `ad80da9d` |
   | `v3/configV3.js` | `80a763ef` | `80a763ef` |
   | `meshValidation.js` | `5af64ae4` | `5af64ae4` |
   | `v3/v3ViewAdapter.js` | `1e3d96cc` | `1e3d96cc` |

3. **算法输出逐字节一致**：把 PHASE 84 与 PHASE 85 两次运行的 20 行 legacy 输出
   （检出数 / 漏检 / 误报 / Δmax / 排序）剥掉耗时后 `diff` —— **完全一致**。

   | | t03 | t05 | t10 |
   |---|---|---|---|
   | peak position | `[152.0,-1.2,48.6]` | 同左 | 同左 |
   | peak modulus | 14.42 | 14.63 / 13.80 / 11.85 | 13.56 / 12.47 / 11.66 |
   | region volume (mm³) | 43053 / 37388 | 同左 | 同左 |
   | representative position | `[145.9,-1.2,14.8]` | 同左 | 同左 |

---

## 4. legacy 9/20 是否保持（85.txt 九/十五）

**是。`Legacy score: 9 / 20`，且逐模型明细与 PHASE 84 完全一致。**

`expectedHotspots` 被修正后（t19 移走 2 条），legacy 判定**不能再读它** —— 否则 t19 会从
"漏 stub,midRing" 变成全过、legacy 就变成 10/20。因此：

- `gen_engineering.mjs` 在首次升级时把 **PHASE 84 的 `expectedHotspots` 原样冻结**进
  `expected.json` 的 `legacy.expectedHotspots`；
- legacy 层读冻结的那份；诊断层读修正后的那份；
- 代码注释里写明了"这是历史口径，故意保留"。

**没有把新指标包装成更高的 PASS 数**：新指标不叫 PASS，叫诊断计数，且顶层第一行仍然是
`Legacy score: 9 / 20`。

---

## 5. 新测试指标（85.txt 八/十三）

| 指标 | 分母 | 值 | 含义 |
|---|---|---|---|
| **Legacy score** | 20 模型 | **9** | 旧口径（历史指标） |
| **Peak detection** | 20 模型 | **19** | 每个必检厚区都有热点的**峰点落进该厚区** |
| **Peak accuracy** | 20 模型 | **14** | 必检热点的峰点全部落在容差球内 |
| **Zone detection** | 20 模型 | **14** | 每个必检厚区都有热点的**代表点落进该厚区** |
| **Representative accuracy** | 20 模型 | **7** | 峰点+代表点都落在容差内 |
| Peak within tolerance | 47 热点 | **38** | |
| Representative within tolerance | 47 热点 | **28** | |
| Unexpected / outside-zone | 47 | **2** | |
| In-zone-but-offset | 47 | **7** | |
| **Representative-drift** | 47 | **15** | **峰点对、代表点漂** |
| Peak-level failures | 47 | **9** | = in-zone-but-offset + outside-zone |
| Correct（峰+代表都达标） | 47 | **23** | |
| Weak / optional-zone hit | 47 | **0** | 见 §7 说明 |
| Unmatched / Unknown | 47 | **0 / 0** | |

**能一眼看出的两件事：**

> **① 算法"找到热点"这件事做得相当好**：19/20 的模型，每个必检厚区都有峰点落进去。
> **② 短板在"代表点落在哪"**：代表点全部达标的只有 7/20，15 个热点是"峰点对、代表点漂"。

这正是 85.txt 十八 要的那句话：**9/20 被拆开了。**

---

## 6. t03 对照（85.txt 十三）

新体系自动产出 PHASE 84 手工查出的那条：

```
t03_twoDiff_60_100  H1  REPRESENTATIVE_DRIFT  zone=B100  峰→GT 11.6  代表→GT 45.4  (tol 30)
t03_twoDiff_60_100  H2  REPRESENTATIVE_DRIFT  zone=A60   峰→GT 10.7  代表→GT 39.6  (tol 30)
```

**不再需要单独写探针** —— 这正是 85.txt 十三 的目标。

---

## 7. t19 定义处理（85.txt 十）

**原矛盾**（PHASE 84 已确认）：`gen_engineering.mjs` 的 `observations` 写着
"stub/midRing 为弱次级热结…非必报"，却把这两条写进了 `expectedHotspots`。

**处置**：新增 `optionalHotspots` 字段，把 `stub` / `midRing` 移进去，并在条目上带
`reason` 说明依据（引用 generator 自己的 observations 原文）。

**新体系下**：

| 情形 | 判定 |
|---|---|
| V3 检出 optional 热点 | **不算 false positive**（分类为 `WEAK_OR_UNEXPECTED`） |
| V3 不检出 optional 热点 | **不算 false negative**（不进 `missed`） |

**实测结果**：t19 诊断层 `必检2 峰检出2 代表检出2 峰达标2 代表达标2` → **t19 在新体系下完全正确**。
（legacy 仍显示 `漏[stub,midRing]` —— 那是冻结的历史口径，见 §4。）

**注意**：`WEAK_OR_UNEXPECTED` 当前计数为 **0** —— 因为 V3 本来就没检出 stub/midRing，
所以这个分类路径**尚未被真实数据触发**（机制已就位，但没被行使）。这一点如实记录。

---

## 8. t06 处理（85.txt 十一）

**先发现一个 GT 记录缺陷**：t06 的 `thickZones` 里 s20/s30/s40 三条的 `centerMm` 与
`build()` **实际生成的 box 对不上** —— 沿用了板中心 z=0，且 s20/s30 的 x 也错位
（例如 s20 声明 x 中心 −150、宽 150 → 落在 x∈[−225,−75]，**超出 300mm 宽的板本身**）。
这三个字段只用于描述与区域归属，不参与 pass/fail，所以错误一直没暴露。

**处置**：改为**由同一个 `steps` 数组推导**（与 SDF 同源，不是手填）：

```js
const stepZone = ([x0, x1, dh]) => ({
  id: `s${20 + dh}`, kind: 'box',
  sizeMm: [x1 - x0, pl[1], dh],
  centerMm: [(x0 + x1) / 2, 0, pz + dh / 2],
  vaRatioTheory: boxVAratio(x1 - x0, pl[1], dh),
});
```

**判定（85.txt 十一 要求 A/B/C 三选一）**：

> **B —— 合理的 secondary hotspot。**
> 依据：① s40/s30 是 generator 自己在 `thickZones` 里声明的厚区；
> ② generator 的 `notes` 原文就写着"若 V3 把 30/40 段也报出 = 渐变全报问题（**观察项，非必然 FAIL**）"
> —— 作者本来就预期可能会报；③ 该台阶的理论 V/A（`boxVAratio(75,150,20)` = 11.1）高于 20mm 板的
> 本体。**没有删除任何热点**，而是把 s40/s30 列为 `optionalHotspots`。

**实测**：t06 H2 的**峰点**落在 `s20`（板本体区），不在 s40/s30 内 → 新体系分类为
`OUTSIDE_EXPECTED_ZONE`（峰点不属于任何**热点**厚区；它落在了板本体这个"声明厚区"里）。
H1 峰点在 s60 内但距中心 47.7mm > tol 35 → `CORRECT_ZONE_POSITION_OFFSET`。

---

## 9. ring GT 审计（85.txt 十二）

**当前 ring 的实现**（`run_engineering.mjs:ringMatch`）：

```js
if (Math.abs(along) > (e.halfH ?? 0) + e.toleranceMm) return null;              // 轴向
if (radial < e.innerR - tol || radial > e.outerR + tol) return null;            // 径向带
return Math.max(0, Math.abs(radial - (e.innerR + e.outerR) / 2));               // 误差 = 到中径的偏离
```
调用方再做 `bestD <= toleranceMm`。

**合并后的实际接受区间**（径向要同时满足两条）：

| 模型 | innerR/outerR | tol | 径向接受 | 环带本身 | 轴向接受 | 实际半高 |
|---|---|---|---|---|---|---|
| t08 `flange70` | 80 / 160 | 40 | **[80, 160]** | [80,160] | ±75 | 35 |
| t19 `flangeU/D` | 45 / 120 | 40 | **[42.5, 122.5]** | [45,120] | ±60 | 20 |
| t20 `topFlange` | 60 / 120 | 45 | **[45, 135]** | [60,120] | ±75 | 30 |

**结论（85.txt 十二 要求明确回答）**：

> ring 的"正确检测"当前实际意味着 —— **径向基本等于"落在环带内"**（t08 完全相等，
> t19 略窄 2.5mm，t20 反而宽 15mm），**而不是"接近中径"**：`|radial − 中径| ≤ tol` 这一条
> 因为 tol 与环带半宽同量级，几乎从不单独起作用。
> **真正宽松的是轴向**：接受窗口是 `±(halfH + tol)`，即 t19 的法兰（实高 40mm）
> 接受 ±60mm、t20 的顶法兰（实高 60mm）接受 ±75mm —— **是实际高度的 2.5~3 倍**。

**本阶段按 85.txt 十二 的要求"不要随便改变既有语义"—— 只审计并记录，未改实现。**
`axis` 字段是**新增**的（原先 thickZones 里根本没有，导致区域归属对 ring 无法判定），
属于补全而非改语义。

---

## 10. clean mesh fixture 状态（85.txt 十四）

**状态：`clean mesh fixture deferred`** —— 不是偷懒，是实测后发现"用现有 generator 直接产出
干净 STL"这条路成本明显偏高：

| 实验 | 结果 |
|---|---|
| 形状 × 分辨率扫描（4 个形状 × 5 档 res=48~120） | **19 个组合里 18 个是 WARNING**；唯一一个 VALID（板200+boss60 @res72）在同一形状的 res48/64/90/120 下**全是 WARNING** → 是**网格相位碰巧对齐**，不是稳健性质 |
| 按 SDF 梯度做定向修复 | 该修的三角形数 = **0**（所有三角面法向本来就与梯度同向） |
| 预量化顶点到 1e-3 / 1e-2 后再判定 | 仍报 `INCONSISTENT_WINDING` |

**说明**：告警既不是"面朝向反了"，也不是"顶点量化边界效应"，而是 `tetMC` 网格**拓扑层面**的
固有性质（有向边统计）。要产出干净夹具 = 需要**新的网格修复能力**，属于明显更高的成本 ——
按 85.txt 十四 的指示"不要强行做"，**记录 deferred**，本阶段不做。

**建议的下一步（供将来参考）**：与其修 `tetMC`，不如给夹具加一个
**手工构造的解析件**（如 `tests/phase285_test.mjs` 里已有的 `closedCubeMesh()` 那类
12 三角闭合立方体，扩展成"板+凸台"），代价小得多。本阶段未做，避免扩大范围。

---

## 11. 新旧测试体系对比

| | 旧（legacy） | 新（diagnostic） |
|---|---|---|
| 配对依据 | 到 GT 中心的欧氏/环带距离 | **峰点落在哪个声明厚区**（几何包含） |
| 位置超差的后果 | 同时记 1 漏检 + 1 误报 | 单独一类（`REPRESENTATIVE_DRIFT` / `CORRECT_ZONE_POSITION_OFFSET`） |
| 输出 | 一个数（9/20） | 13 个分层指标 |
| optional 热点 | 无此概念 → 误判为漏检 | `optionalHotspots`，两边都不判失败 |
| 能回答"错在哪一层" | ❌ | ✅ |
| 是否改动 | **未改（逐字保留）** | 新增 |

**两层都读同一份 V3 输出，算法零改动。**

---

## 12. 当前真正能够证明什么

1. **算法能找到正确的厚区**：19/20 的模型，每个必检厚区都有热点的峰点落进去 —— 这是实测，不是估计。
2. **短板在代表点**：代表点全部达标的只有 7/20；47 个热点里 **15 个是"峰点对、代表点漂"**。
3. **失败可以分层归因**：`REPRESENTATIVE_DRIFT: 15` / `CORRECT_ZONE_POSITION_OFFSET: 7` /
   `OUTSIDE_EXPECTED_ZONE: 2`。
4. **t19 的定义矛盾已解决**，且新体系下 t19 完全正确。
5. **ring 的接受口径已被量化**（§9），不是"接近中径"而是"基本等于落在环带内 + 轴向 2.5~3 倍宽松"。
6. **t06 的 GT 记录缺陷已被定位并修正**（与 SDF 同源推导）。

---

## 13. 当前仍然不能证明什么

1. **"代表点该取哪个点"仍未有结论 —— 而且新数据给出了反例。**
   t01/t02/t09/t11 四个模型里，**代表点比峰点更接近 GT 中心**
   （t01：代表点 11.6mm vs 峰点 63.8mm）。也就是说"改成用峰点"会让这些**变差**。
   这不是"质心一律更差"，而是**取决于结构**（宽凸台 vs 高凸台）。
   → **"把 representativePoint 改成 peak"这个方案没有数据支持。**
2. **峰点层 9 个失败（7 in-zone-offset + 2 outside）根因未定位** —— 本阶段只做了分类，没追因。
3. **采样/网格质量的影响仍未与控制组分离**：20/20 都是 `INCONSISTENT_WINDING`，
   干净网格夹具 deferred（§10）。
4. **真实 STL 上是否同样成立未知** —— 20 个夹具全是 `tetMC` 合成件。
5. **ALR2510 等真实件的回归未做** —— 任何动 `region growth` 的方案都必须先过这一关，
   而本阶段没有跑真实件。
6. **`WEAK_OR_UNEXPECTED` 分类路径尚未被真实数据触发**（计数 0）。
7. **多热点落在同一 zone 时的配对歧义未处理** —— 当前诊断是逐热点独立分类，不消费 slot；
   若将来要判"重复检出"，需要再加一层。

---

## 14. 下一阶段建议 + 最终结论

### 【现在我们是否已经具备修改 STL hotspot 算法的条件？】

# 否。

**缺什么（逐条）：**

| # | 缺的东西 | 为什么它是前提 |
|---|---|---|
| 1 | **"热点位置"的工程定义**（冒口定位要 peak、冷铁要 region、工艺检验要二者） | PHASE 84 §8 已列出分用途需求，但**没有裁决**。定义没定，就无法判断"改了是改善还是改坏" |
| 2 | **对反例的解释** | §13-1：t01/t02/t09/t11 代表点比峰点准。**"统一改成峰点"会退化这 4 个**。必须先解释"什么结构该用哪个点" |
| 3 | **真实 STL 回归** | 20/20 合成件、20/20 带缠绕告警；`region growth` 的现状是**为修 ALR2510 真实件漏检而专门引入的**，任何改动必须先在真实件上证明不重新打开那个漏检 |
| 4 | **干净网格对照组** | 否则任何改动都无法区分"算法改善"与"网格质量差异" |
| 5 | **峰点层 9 个失败的根因** | 这 9 个不是代表点问题，是真·检测层问题，但**本阶段只分类未追因** |

**证据链目前的完整度：**
- ✅ "哪里有不足" —— **已经量化**（19/20 检测 vs 7/20 定位）
- ✅ "不足发生在哪一层" —— **已经分层**（drift 15 / in-zone-offset 7 / outside 2）
- ❌ "应该改成什么" —— **没有依据**，且存在明确反例
- ❌ "改了会不会更差" —— **无法回答**（缺真实件 + 干净对照）

**如果答案是"是"就必须指出的那句话，本阶段说不出来** —— 因为唯一候选（改 region 生长口径 /
改 representativePoint 取 peak）都**同时存在支持证据和反对证据**。
按 85.txt 十七 的指示：**不为了推进版本强行给"是"。**

### 建议的下一阶段顺序

1. **先做工程裁决**（用户）：热点位置对下游（冒口/冷铁/检验）到底要哪一个点。
   —— 这是唯一能解锁后续所有工作的前提，且只有用户能定。
2. **补真实 STL 回归基线**（在现有真值套件之外另立一套，不混用）：
   对 ALR2510 等真实件记录当前的 peak / representative / region，作为"改动不得劣化"的护栏。
3. **追峰点层 9 个失败的根因**（纯分析，不改码）。
4. **只有在 1~3 都完成之后**，才具备讨论"最小算法改动"的条件。

---

## 附：本阶段产出的文件

| 文件 | 说明 |
|---|---|
| `tests/engineering-generated/run_engineering.mjs` | 两层判定（legacy 逐字保留 + 诊断层） |
| `tests/engineering-generated/gen_engineering.mjs` | `--meta-only` + GT metadata 修订 |
| `tests/engineering-generated/BASELINE.md` | **更新**：legacy 9/20 + 诊断指标双基线 |
| `tests/engineering-generated/summary.json` | 运行器输出（旧字段 + `diag`） |
| `docs/PHASE85_REPORT.md` | 本文件 |
| `D:\CDXProject\_v11_cleanmesh_probe.mjs` | 仓库外 · clean mesh 可行性实验（§10 的依据） |
| `D:\CDXProject\_v11_summary_PHASE84.json` | 仓库外 · PHASE 84 基线备份 |

**`js/engine/` 零改动**（§3）。
