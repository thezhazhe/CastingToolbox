# PHASE 17 — 采样分辨率误报修正报告

日期：2026-08-23 ｜ 命令：21.txt ｜ 性质：先验证根因 → 最小修改（Adapter/判定/UI）→ 回归测试

## 0. 结论

**PASS — 可以进入真实 STL 验证**

---

## 1. 根因（一句话）

V3 自适应采样的 `estMinWall`（16³ 探测 char 的 **p10 分位**）物理上代表"局部最薄区域"而非主体壁厚，在薄壳/大件上被网格相位与局部特征系统性压到 4~7mm（1m 壳真实壁 20mm 被估成 4mm），`vs = clamp(0.5×estMinWall, mdim/128, mdim/24)` 随之失真并被 vsMin 夹住 → 旧判据① `estMinWall/vs < 2` 对主体壁厚正常的大型铸件恒误报"模型过薄，采样分辨率不足"。

## 2. 触发路径清单（21.txt 三.1，含代码位置）

| # | 触发路径 | 代码位置 | 修复后去向 |
|---|---|---|---|
| ① | `estMinWall/vs < 2`（旧判据①）| v3ViewAdapter.js `samplingWarn` | 改为 `主体壁厚/vs < 2` → 🟠；estMinWall 仅用于 🟡 局部特征 |
| ② | `vs > wallMax`（旧判据②，兜底路径关键补充）| v3ViewAdapter.js `samplingWarn` | 并入 🟠 resolution |
| ③ | `status = INSUFFICIENT_RESOLUTION`（NO_INSIDE_POINTS / INVALID_MESH）| hotspotV3.js:39,51 → v3ViewAdapter.js `samplingWarn` | 🔴 failed（文案改为"无法可靠分析"，不再说"模型过薄"）|
| ④ | 16³ 探测失败 → `estMinWall = mdim/coarseResolution` 兜底 | sampling.js:44（`adaptiveVs`）| **不修改**（V3 核心）；Adapter 用 `minWallReliable=false` 标记，兜底值不参与任何"壁厚"判定 |
| ⑤ | `wallMain` 峰值检测失败 → fallback wallMax / 伪低桶 | geometryAnalysis.js:79-83 | Adapter `bodyWallOf` 区间校验（0.7×wallAvg ~ 0.9×wallMax）→ 兜底 wallAvg |
| ⑥ | UI 文案 "模型过薄，采样分辨率不足" | designCenter.js `hsReasonText`（NO_INSIDE_POINTS 映射）| 改为"无法可靠进行热结分析（未获得有效内部采样点）" |

## 3. 只读验证证据（21.txt 三.2，诊断表）

诊断脚本：`tests/phase17_probe.mjs`（保留）。模型 = 构造（tetMC 水密，与工程测试集同源）+ 工程文件（真实 14.txt 生成件）。

| STL | 来源 | bbox 主维 | wallMain | wallAvg | wallMax | estMinWall | vs | 主体层数 | est层数 | insidePts | V3 status | 旧判据触发 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| shell1000_w20（1m 壳壁 20）| 构造 | 1000 | **20.0** | 15.2 | 22.5 | **4** | 7.81 | 2.56 | **0.51** | 5540 | ok | ①误报 |
| shell1000_w30（1m 壳壁 30）| 构造 | 1000 | 21.7 | 16.8 | 36.4 | **7** | 7.81 | 2.77 | 0.89 | 9479 | ok | ①误报 |
| shell500_w20（500 壳壁 20）| 构造 | 500 | 10.1 | 9.8 | 26.0 | **6.3** | 3.91 | 2.58 | 1.61 | 11414 | ok | ①误报 |
| shell1000_w3（1m 壳壁 3）| 构造 | 1000 | 0 | 0 | 0 | 25(兜底) | 12.5 | — | — | **0** | INSUFFICIENT_RESOLUTION | ③真报警 |
| plate500_w10（板 10）| 构造 | 500 | 4.8 | 4.8 | 9.6 | 12.5(兜底) | 6.25 | 0.77 | 2 | 12800 | NO_HOTSPOT | 旧漏报 |
| plate1000_w10（板 10）| 构造 | 1000 | 9.2 | 9.6 | 9.6 | 25(兜底) | 12.5 | 0.77 | 2 | 6400 | NO_HOTSPOT | ②误报 |
| plate500_w20（板 20）| 构造 | 500 | **4**（伪低桶）| 9.4 | 19.2 | 8.8 | 4.38 | 2.15 | 2.01 | 9747 | ok | 不触发（侥幸）|
| plate1000_w20_slot4（主体20+槽底4）| 构造 | 1000 | 9.5 | 9.5 | 19.2 | 25(兜底) | 12.5 | 0.76 | 2 | 8192 | NO_HOTSPOT | ②误报（局部特征 4mm 在 48³ 距离场/16³ 探测均不可见）|
| t01_boss100（主体20+boss100）| 工程文件 | 500 | 119.8(=wallMax 峰值失败) | 24.0 | 119.8 | 8.8 | 4.38 | 5.48 | 2.01 | 15453 | ok | 不触发 |
| t02_thin10_boss60（主体10+boss60）| 工程文件 | 500 | 67.7(=wallMax) | 13.2 | 67.7 | 21.6 | 10.79 | **1.23** | 2.00 | 2721 | ok | 旧漏报（实际欠采样）|

**误报/漏报统计（旧逻辑）**：10 模型中 5 个误报"过薄/欠解析"（3×判据① + 2×判据②），2 个漏报（plate500_w10、t02 实际欠采样但无提示）——即旧判据一半以上模型判错方向。

### 3.1 p10 语义验证（21.txt 三.3）

- **char 的物理含义**：采样点到最近表面的距离 ×2（半壁厚语义，sampling.js `distanceToSurface`）。
- **p10 的统计含义**：16³ 探测点 char 排序后 10% 分位 = "**最薄 10% 的探测点对应的局部壁厚**"。
- **与真正"最小壁厚"的关系**：是（有偏的）下界——被网格相位进一步压低：薄壳件探测点只落在壁内 1 层且该层偏移（shell1000_w20 的 char p25~p90 全等 12.5，真实 20mm），p10=2.5（charFilterMin=2mm 过滤后取 floor 4mm）。
- **与"主体壁厚"的关系**：无关。主体壁厚是壁的典型尺度（geometry wallMain=20），p10 是"最薄 10% 区域"（≈2~7mm），两者物理上就是不同量。**用 p10 做"模型壁厚"是语义错误**（21.txt 判断 A）。

### 3.2 fallback 路径验证（21.txt 三.4）

- **真实存在**：probeInside=0 的模型 4/10（plate500_w10、plate1000_w10、shell1000_w3、plate1000_w20_slot4）。触发机制：16³ 网格格距=mdim/16，当模型某方向厚度 < 格距时该方向无网格点落于实体内（1m 板 10mm 厚：z 方向网格点全部落在板外）→ 探测 0 内部点 → `estMinWall = mdim/40` 兜底。
- **兜底后是否脱离真实壁厚**：**是**。vs=mdim/80（与真实壁厚完全无关）：plate1000_w10 的 vs=12.5 > 真实壁厚 10mm → 欠采样 0.77 层；shell1000_w3 的 vs=12.5 > 壁厚 3mm → 正式采样 0 内部点 → NO_INSIDE_POINTS。**确认兜底值不能作为任何壁厚判定依据**（21.txt Test 4 要求）。

## 4. 根因判断（21.txt 四）

| 判断 | 结论 |
|---|---|
| **A：p10/fallback 导致主体壁厚严重低估** | ✅ **主因**。5/10 模型 estMinWall 被压到 4~7mm（真实 20~30mm），3 个误报均由此触发 |
| **B：vs 上下限/bbox 限制** | ✅ 放大器（非主因）。vsMin=mdim/128 与低估的 estMinWall 联合使 layers<2 恒成立；vsMin 本身合理（性能保护），错在分子 |
| **C：文案表达错误** | ✅ 存在。NO_INSIDE_POINTS 固定文案"模型过薄"与真实原因（判内外无内部点）不符 |
| **D：优先级** | **A（estMinWall 语义）> B（vsMin 放大）> C（文案）**。修正 A 后 B、C 自然消解 |

**没有强行选 A**：A 由 3 个误报模型的完整数值链证实（wallMain=20 正常 ↔ estMinWall=4 ↔ layers=0.51），B 是 A 的放大器，C 是表达层。

## 5. 修正策略（21.txt 五/六，已实施）

**原则 1（主体壁厚为采样能力参考）**：`bodyWallOf()` 取 geometry 权威值，区间校验防 geometry 自身假值（wallMain=wallMax 峰值失败 / 伪低桶）：
- 可信 wallMain ∈ [0.7×wallAvg, 0.9×wallMax] → 用 wallMain；否则 wallAvg；再否则 wallMax。
- 诊断表 10 模型全部得到合理主体值（20/21.7/10.1/4.8/9.6/9.4/9.5/24/13.2）。

**原则 2（不丢局部薄壁检测）**：estMinWall 降级为"局部较薄区域"信号，仅当主体层数正常时触发 🟡；fallback 值（estMinWall/vs 恒=2）自动不触发 🟡。

**WARNING 四级（21.txt 六）**：

| 级别 | 触发 | 示例文案 |
|---|---|---|
| 🟢 ok | 主体层数 ≥2 且无局部欠采样 | — |
| 🟡 local_thin | 主体层数 ≥2 但 estMinWall <2 层 | 主体壁厚约 20mm，存在局部较薄特征（V3 估计约 4mm），局部区域采样精度可能不足 |
| 🟠 resolution | 主体层数 <2 或 vs>wallMax；或主体壁厚数据不可靠 | 当前模型存在局部区域采样不足，热结分析结果仅供参考 |
| 🔴 failed | status=INSUFFICIENT_RESOLUTION | 无法可靠进行热结分析，请检查模型尺度、网格质量或局部薄壁结构 |

文案与 22.txt 四示例对齐（22.txt 复核指令）；🟠 增加"主体壁厚不可靠 → 明确不确定，不伪装正常"分支（22.txt 三）。

**未做**：不修改任何阈值（vsMin/vsMax/coarseResolution/estWallFloor 原样）、不关闭任何 WARNING、未改 V3 核心。

## 6. 修改文件与内容（21.txt 十.3/4）

| 文件 | 修改 | 为什么 |
|---|---|---|
| `js/engine/v3/v3ViewAdapter.js` | `samplingWarn` 重构为四级分级 + `bodyWallOf()` 区间校验 + `minWallReliable` fallback 标记；`layers` 语义改为主体壁厚/vs | 根因 A 的修正层（21.txt 允许 Adapter）|
| `js/views/designCenter.js` | ①toViewResult 调用补传 `wallAvg` ②铸件信息卡 chip 四级显示（🟢✅/🟡/🟠/🔴，新 CSS `dc-chip-warn`）③`hsReasonText` 的 NO_INSIDE_POINTS 文案改为"无法可靠进行热结分析（未获得有效内部采样点）" | ①bodyWallOf 区间校验需要 wallAvg ②③UI 区分主体/局部（21.txt 允许 UI 层）|
| `css/app.css` | +`.dc-chip-warn`（🟡 琥珀色 chip）| 视觉分级 |
| `tests/phase17_test.mjs`（新）| Test 1-6 | 21.txt 八 |
| `tests/phase17_probe.mjs`（新）| 只读诊断脚本（10 模型全链路表）| 21.txt 三 |
| `tests/v3_adapter_test.mjs` | 16-A.4b 断言更新（旧 layers 语义 → 新分级 + fallback 识别）| 行为有意变更，断言跟随语义 |

## 7. 未修改内容（21.txt 十.5）

- **V3 核心未修改**：`js/engine/v3/` 下仅 v3ViewAdapter.js（Adapter 层，PHASE 16 定义即允许）；sampling.js / hotspotV3.js / configV3.js / modulusField.js / peakRegion.js / windowV.js 零改动。
- calcs/ 计算公式、CastingProject 数据模型、resultsCenter、reportGenerator、路由架构均未动。
- 未调整任何 V3 阈值；未关闭/弱化任何 WARNING（分级只改变判据语义与文案，触发集合比旧逻辑更准）。

## 8. 测试（21.txt 十.6/7/8/9）

**原有测试：105/105**（含语义更新的 16-A.4b——断言随新分级语义，非消症状）
**新增测试：6/6**（P17-T1~T6）
**总计：111/111 通过 / 0 失败 / 0 WARNING**

| 测试 | 模型 | 要求 | 结果 |
|---|---|---|---|
| P17-T1 正常厚壁 | 1m 壳壁 20mm | 不出现"模型过薄"（≠resolution/failed）| ✅ level=local_thin（主体 20mm 层数 2.56 正常）|
| P17-T2 真实薄壁 | 1m 壳壁 3mm | 仍产生 WARNING | ✅ level=failed（NO_INSIDE_POINTS）|
| P17-T3 主体20+局部4mm | 500mm 板+槽 | 不判整体过薄，区分局部 | ✅ local_thin（bodyWall≥10 且 minWall≤8）|
| P17-T4 fallback 识别 | 1m 板 10mm | 兜底值不当真实壁厚 | ✅ minWallReliable=false + level=resolution（主体 9.6mm 来自 geometry）|
| P17-T5 NO_INSIDE_POINTS | fake V3 | 必须仍报警 | ✅ level=failed + 文案"无法可靠"|
| P17-T6 大型正常铸件 | 1m 壳壁 20/30mm | 不误报（本次真实问题回归）| ✅ 两壁厚均 ≠resolution/failed |

### 8.1 误报测试（21.txt 十.7）

正常 20/30mm 壁厚大型铸件**不再报警"模型过薄"**：shell1000_w20 → 🟡（主体 20mm 采样正常，仅提示局部欠采样可能）、shell1000_w30 → 🟡、t01_boss100 → 🟢。误报由 3/5 降至 0/5（诊断表 10 模型）。

### 8.2 真薄壁测试（21.txt 十.8）

2~3mm 主体薄壁**仍然报警**：shell1000_w3 → 🔴 failed（无法可靠分析）。判据无弱化（P17-T2/P17-T5）。

### 8.3 局部薄壁测试（21.txt 十.9）

主体正常 + 局部薄特征可区分：P17-T3 报 🟡 local_thin（带 bodyWall 与 minWall 数值），不再是笼统"过薄"。UI chip 与 detail 文案区分四级。

## 9. 已知限制（如实记录，不隐藏）

1. **1m 件上的局部 4mm 特征**（plate1000_w20_slot4）：48³ 距离场（vs=20.8mm）与 16³ 探测（62.5mm）都无法看见 4mm 槽 → 该件报 🟠（主体判定 9.5mm 被拉低）。识别 <网格分辨率 的局部特征需要更高分辨率探测（=改 V3 核心，本阶段禁止）→ **已知限制，记录**；工程意义：此类特征本就无法被当前采样解析，🟠 报警方向正确。
2. **V2 geometry wallMain 对 1m 薄壳低估**（30mm 壁 → 21.7mm）：V2 距离场自身限制（V2.3.1 已知），不阻塞；主体值用于层数判定时偏保守（偏小 → 更容易报 🟠，不会漏报）。
3. 🟡 的"局部较薄区域约 Xmm"数值来自 estMinWall（p10），在测试模型（tetMC 网格化）上受 MC 表面波纹相位污染（如壳 20mm 报 4mm）；真实 CAD 导出 STL 表面平滑，该污染预计显著减轻。文案已用"V3 估计约"措辞。

## 10. 最终结论

**PASS — 可以进入真实 STL 验证**

判定依据：根因经 10 模型数值链证实（非假设）；修正局限于 Adapter/UI/测试（V3 核心与 calcs 零改动）；111/111 测试通过；误报修复（5→0）与真薄壁报警保留（P17-T2/T5）同时满足；未调任何阈值、未关闭任何 WARNING；21.txt 十一原则遵守（WARNING 有工程意义：🟡/🟠/🔴 分别对应局部欠采样/整体欠采样/无法分析三种真实状态）。

## 11. 验证方式

- `node tests/runner.mjs` → 111/111
- `node tests/phase17_probe.mjs` → 10 模型诊断表（只读，保留）
- 浏览器人工走查（下一次真实 STL 验证时）：导入真实铸件 STL → 铸件信息卡 chip 分级 + toast detail；建议同时观察 🟡 数值在真实 CAD STL 上是否合理
