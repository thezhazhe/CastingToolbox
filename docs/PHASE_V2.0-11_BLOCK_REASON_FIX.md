# PHASE V2.0-11 · Riser BLOCK Reason Explanation Fix

**命令文件**：`D:\CDXProject\新建 文本文档 (121).txt`
**日期**：2026-10-11 ｜ **基线**：承接 PHASE V2.0-10 当前工作区（`main @ da1c822` + 未提交改动）
**性质**：修复 **R-1**（阻断结果缺少明确原因说明）。**只改解释文本与必要测试，不改工程数值。**
**承接**：`docs/PHASE_V2.0-09_P0_READINESS_AUDIT.md` §7.1 R-1、`docs/PHASE_V2.0-10_RELIABILITY_BLOCK_PRIORITY.md` §7.1 R-1

**证据标注**：【实测·Node】= 用生产模块跑出来的 ｜【实测·浏览器】= 无头 Edge 真实页面量到的 ｜【源码确认】= 读源码逐行确认 ｜【实测·脚本】= 本阶段一次性工具

---

## 0. 开工前检查（121.txt §一）

```
$ git status --short   → 13 个 M + 25 个 ??（与 V2.0-10 结束时逐条一致，无覆盖、无丢弃）
$ git log --oneline -1 → da1c822 docs: 新增 V2.0 交接书 HANDOFF_2026-10-07
```

- PHASE V2.0-10 的改动**仍在工作区**：`calcs/calcManifest.js` 含 5 处 `isHardBlocked`；
  `tests/phasev2010_test.mjs`（13111 B）与 `docs/PHASE_V2.0-10_*.md`（18383 B）均在。
- **未执行** git commit / reset / checkout / 切分支。

### `geomStatus` / `note` / `level` 的实际传递关系（121.txt §一.5，先确认再动手）

```
designCenter.js:924  proj.set('geometry.geomStatus', deriveGeomStatus(issues), …)
      ↓
calcManifest.js  riser.calculate()
      :222  const geomStatus = proj.getV('geometry.geomStatus') || 'VALID'
      :307  const level = (userMc || note) ? 'WARNING_REVIEW' : reliabilityLevel({ geomStatus, hsStatus })
      :308  const out = note ? { ...r, note, level } : { ...r, level }
      :310  if (isHardBlocked({ geomStatus, hsStatus, humanInput: userMc })) {
              out.level = 'BLOCK_AUTO_RECOMMEND'        ← V2.0-10 只改了 level，**没碰 note**
            }
      ↓
结果卡  resultsCenter.js:149   ${r.note ? `<div class="field-hint p72-cn">ℹ️ ${esc(r.note)}</div>` : ''}
报告    reportGenerator.js:133 if (r.note) out.push(`<div class="meta">${esc(r.note)}</div>`)
```

⇒ **`note` 是唯一同时被结果卡与导出报告渲染的文本字段。** 因此把阻断原因并入 `note`
可以**一处改动、两处同时生效**，**视图层一行都不用改** —— 这正是 121.txt §二「优先复用现有结果字段和渲染方式」的最小解。

---

## 1. R-1 的实际根因

**不是"没写文案"，是"文案被放在了错误的分支上"。**

| 场景 | 修复前卡片上实际显示的 | 问题 |
|---|---|---|
| 几何 INVALID + 自动 Mc | 「本次冒口 Mc 采用 STL 自动热结估计值（未经确认）……」 | 属实，但**不是阻断原因**；真正原因（网格无效）一个字没有 |
| 几何 INVALID + **用户** Mc | **什么都没有**（`note` 为 `null`，`:149` 的三元直接渲染空串） | 用户只看到一个 ⛔ chip，**零解释** |
| 几何 INVALID + 多热结 | 「已按您选择的 N 个热结分别计算冒口……」 | 讲的是多热结口径，同样不提几何无效 |

**根因**：V2.0-10 只把 `level` 抬到了 BLOCK，**没有同步处理 `note`** —— `note` 仍然由各自的**计算分支**产生
（自动 Mc 提示 / 多热结说明 / 壁厚兜底说明），而这些分支都只描述"这个数是怎么来的"，
**没有任何一支负责描述"为什么被阻断"**。

⇒ 这是 V2.0-10 那次修复的**不完整之处**，不是新缺陷。V2.0-09 §7.1 与 V2.0-10 §7.1 都已把它登记为 R-1。

---

## 2. 修复前后行为对比

**文案（121.txt §二 R1 要求三要素：原因 / 建议操作 / 重要限制）**：

```
当前 STL 网格校验无效，几何数据可能不可信，因此已阻断自动推荐。
请检查并修复网格，或重新导入有效的 STL 后再计算。
当前尺寸仅供排查参考，不应直接用于生产设计。
```

措辞刻意止于「**可能**不可信」—— 网格校验收到的 error 级问题（空网格 / 非法顶点）不等于"算出来的数一定错"，
**没有把话说满**（121.txt §二 R1 明令）。

| 场景 | 修复前 | 修复后 |
|---|---|---|
| **INVALID + 自动 Mc** | 只有自动 Mc 提示 | **阻断原因在最前**；自动 Mc 提示原样保留在后 |
| **INVALID + 用户 Mc** | 空 | **阻断原因**（原来一句都没有） |
| **INVALID + 多热结** | 只有多热结说明 | **阻断原因在最前**；多热结说明保留在后；**原因只出现一次**（不逐热结重复） |
| VALID + 自动 Mc | 自动 Mc 未确认提示 | **逐字不变** |
| VALID + 用户 Mc | note 为空 | **仍为空**（不新增假警告） |

【实测·Node】修复后原文（冒口）：

```
INVALID + 自动Mc
  level=BLOCK_AUTO_RECOMMEND
  note=当前 STL 网格校验无效，…不应直接用于生产设计。；本次冒口 Mc 采用 STL 自动热结估计值（未经确认）——…再复算

INVALID + 用户Mc
  level=BLOCK_AUTO_RECOMMEND
  note=当前 STL 网格校验无效，…不应直接用于生产设计。

INVALID + 多热结(混合 H1改/H2未改)
  level=BLOCK_AUTO_RECOMMEND
  note=当前 STL 网格校验无效，…不应直接用于生产设计。；已按您选择的 2 个热结分别计算冒口（H1 / H2）——…；本次冒口 Mc 采用 STL 自动热结估计值（未经确认）——…

VALID + 自动Mc      → level=WARNING_REVIEW，note 逐字未变
VALID + 用户Mc      → level=WARNING_REVIEW，note 仍为空
```

**两条设计取舍**（都有理由）：

1. **既有说明「保留在后、不被取代」**（121.txt §二 R2.1 要求「可以保留，但不能取代阻断原因」）。
   自动 Mc 那句中"未经确认"在几何修好之后依然成立、依然有用；删掉它等于丢失已确认的事实，
   也违反 §二 R2.5「不要让 INVALID 的提示**覆盖**其他有意义的错误信息」。
2. **原因措辞与热结无关**（§二 R3）：多热结场景用的是同一句、只说一次，
   **不会被误读成"某个热结分析失败"**（测试 V2.0-11-3 断言 note 里**不得**出现"热结分析失败/置信度不足"）。

---

## 3. 实际修改文件

| 文件 | 改动 | 原因 |
|---|---|---|
| `calcs/calcManifest.js` | **+29 / −4**【实测·脚本】 | 新增 `GEOM_INVALID_NOTE` 常量 + `withBlockReason()` 辅助；**3 处调用点**（冒口单热结 / 冒口多热结 / 冷铁）在判定为阻断时把原因**前置**到 `note` |
| `tests/phasev2011_test.mjs` | **新增，10 用例**（带自运行入口） | 本阶段守卫 |
| `tests/experiments/phasev2011_diffsize.mjs` | **新增**，一次性测量工具 | 把工作区文件**逆向还原**成 V2.0-10 结束时再 diff，量出真实增删（只写临时文件） |
| `tests/engineering-generated/BASELINE.md` | **追加一节**（历史段落一字未改） | 121.txt §六 要求 |

**−4 行的去向我们逐行核对过：4 行全部是 V2.0-10 自己写的行被就地改写**（多热结的 `level:` 与 note 展开、
单热结的一行 `if`、冷铁的 return），**没有一行是别处的既有业务逻辑被删掉**。

**视图层 0 行改动** —— 结果卡与报告都是"有 `note` 就渲染"，改了 `note` 它们自动跟上（§0 的调用链）。

### 冷铁路径（121.txt §二 R4）

- **检查结论：存在同类问题**（几何 INVALID 时同样只给 ⛔、不给原因）。
- **做了最小修复**：复用既有 `note` 字段，返回结构 `{...r, note?, level}` **不变** ⇒ 满足 R4「复用现有字段 + 不影响既有返回结构」的两个前提。
- ⚠ **但要如实说明：这次冷铁改动在产品里暂时没有可观测效果** —— 冷铁**不在** `FIXED_CALC_TASKS`
  （`js/views/designCenter.js:40` = `['shrinkage','machining','riser','gating','yield']`），设计中心不执行冷铁，
  其结果卡本来就不可达。**未接入主流程、未重构冷铁计算**（R4 明令）。

---

## 4. 测试结果及退出码（121.txt §五 逐条）

| # | 命令 | 通过 / 失败 | 退出码 |
|---|---|---|---|
| 1 | `node tests/phasev2011_test.mjs` | **10 / 0** | **0** |
| 2 | `node tests/phasev2010_test.mjs` | **无输出**（见下方 ⚠️）；等价入口 `node tests/runner.mjs phasev2010` = **9 / 0** | 0 / 0 |
| 3 | `node tests/phasev2008final_test.mjs` | **无输出**；等价 `node tests/runner.mjs phasev2008final` = **7 / 0** | 0 / 0 |
| 4 | `node tests/phasev2008_test.mjs` | **无输出**；等价 `node tests/runner.mjs phasev2008` = **16 / 0** | 0 / 0 |
| 5 | `node tests/phasev2006a1_test.mjs` | **无输出**；等价 `node tests/runner.mjs phasev2006a1` = **8 / 0** | 0 / 0 |
| 6 | `node scripts/browser_inspection_test.mjs` | **全部通过 ✅（185 条 ✓）** | **0** |
| 7 | `node tests/runner.mjs` | **731 / 1** | **1** |

> ⚠️ **§五 第 2~5 条命令按字面写的是"没有输出、退出码 0"，这并不代表通过。**
> `tests/phasev200{3,4,5h,6a1,8,8final,10}_test.mjs` **只导出 `tests`、没有自运行入口**，
> 直接 `node` 运行会静默退出。真实结果必须走 `node tests/runner.mjs "<子串>"`。
> 本阶段新写的 `tests/phasev2011_test.mjs` 带了自运行入口，所以第 1 条按字面就是可用的。
> （已同步写进 `BASELINE.md`，避免以后再被"静默 0"误导。）

> ⚠️ **另外更正 V2.0-10 报告里的一处数字**：V2.0-10 §6.1 写「`phasev2008` = 9 / 0」，
> 实际该子串**同时匹配** `phasev2008_test.mjs`(9) **与** `phasev2008final_test.mjs`(7) = **16 / 0**。
> 当时的三文件合计 33 = 9 + 16 + 8 本已说明这一点。**结论不变（全过），只是数字记小了**；
> 为遵守"不改写历史报告"，此处更正而不回改 V2.0-10 那份文档。

### 4.1 全量测试的前后差异

| | 通过 | 失败 | 退出码 |
|---|---|---|---|
| V2.0-10 结束时 | 721 | 1 | 1 |
| **V2.0-11（本次）** | **731** | **1** | **1** |
| 差异 | **+10** | 0 | 0 |

**731 = 721 + 10**（`tests/phasev2011_test.mjs`）⇒ **引入失败 0**，无既有测试回归。

### 4.2 历史失败：仍是原来那一个

```
tests/phase24_test.mjs :: T5 关键真实 STL 热结数量零回归
Error: ALHR4510塑料模具v2-2.1.stl 热结数应=5，实际 2
```
**逐字未变**；未修复、未改其预期值（121.txt §三 明令）。

### 4.3 E4 仍然存在（**不得把 731/1 说成全仓通过**）

- `tests/hotspot_v2_test.mjs` **不导出 `tests`** ⇒ 其 42 项检查**不进 731 的统计**；
  且它的 `process.exitCode` 使整仓退出码在任何情况下都可能是 1。
- **本阶段不修 E4**（121.txt §三 明令）。本次清理残留 Edge 进程后实测该文件自报 **41 通过 / 1 失败**，
  与 V2.0-09/10 基线一致；唯一失败是既有的 `large thin shell`（~9.7 s > 8 s 预算，两份 HANDOFF 已记录）。

> **★ 一次环境性假失败，已查明并留证**：V2.0-11 全量跑的那一次，该文件自报 **40 / 2** ——
> 多出的 `large thin + local thick` 报了 9612 ms。**与本阶段改动无关，是环境负载**：
> ① `hotspot_v2_test.mjs` 的 import 图只到 `js/engine/{stl,mesh3d,hotspot}.js`，
>   **完全不经过 `calcs/`**（本阶段唯一改动的目录）；
> ② 引擎文件未改（7 指纹 + mtime 均未变）；
> ③ 该用例历史实测 7497 / 7500 / 7670 ms（均通过），本次 9612 ms；
> ④ **杀掉上一次浏览器测试残留的 23 个 Edge 进程后，立刻回到 7578 / 7641 ms（通过）**，整文件回到 41/1。
> ⇒ 判定：**测量噪声，非回归**。此坑已写进 `BASELINE.md`。

---

## 5. 工程数值不变的证据

**121.txt §四 指定的 9 个字段逐位比对**（基线 = V2.0-10 已记录的黄金值，与修复前完全一致）【实测·Node】：

| 场景 | D | H | Mc | f | Mr_act | Vr | d_neck | modOk | volOk |
|---|---|---|---|---|---|---|---|---|---|
| INVALID + 自动 Mc | 147 | 147 | 14 | 1.75 | 24.5 | 2494835.330189753 | 56 | true | true |
| INVALID + 用户 Mc=20 | 144 | 144 | 20 | 1.20 | 24 | 2345186.349534166 | 80 | true | true |

- 测试 `V2.0-11-7` 用**逐位断言**锁死上表，并额外断言
  **15 个字段（含 `Mr_need` / `effV` / `M_neck` / `bind` / `dModOnly` / `yieldPct`）不随 `geomStatus` 变化**
  ⇒ 几何状态**只影响等级与文案，不影响任何尺寸**。
- **不是"页面上看起来一样"**：断言直接读 `calculate()` 返回对象的数值字段，不经过任何渲染。

### 引擎与 riser.js 是否完全未改

| 项 | 证据 |
|---|---|
| `js/engine/**` | **完全未改**。7 个 sha256 前 8 位与 V2.0-09/10 记录**逐位相同**（`d774532a 8d61d26d 5957831c 48488b13 80a763ef 5af64ae4 1e3d96cc`）；文件 mtime 最早为 2026-10-07，均早于本阶段 |
| `calcs/riser.js` | **完全未改**。mtime `2026-10-11 10:37:49`（早于 V2.0-09 开工的 19:xx），sha256 `87ffe83136b295e6` |

其余**未触碰**：`MODULUS_RATIO_MIN` / `RISER_EFF` / 材料参数 / 阈值 / 搜索范围 / `FIXED_CALC_TASKS` /
冷铁主流程 / 浇注系统 / 任何既有测试断言的预期值。

---

## 6. 未解决事项及范围外问题

### 6.1 本阶段发现、**有证据但未处理**

| # | 事项 | 证据 | 处置 |
|---|---|---|---|
| R-1a | **冷铁的原因说明目前无可观测效果**（冷铁不在 `FIXED_CALC_TASKS`，结果卡不可达） | `designCenter.js:40`【源码确认】 | 已按 R4 做最小修复并注明；**接入主流程属独立产品决策**，本阶段不做 |
| R-1b | **阻断结果仍会把尺寸一起印出来**（卡片显示 ⌀147×H147 + ⛔） | `resultsCenter.js:127-149` | 文案已明确「当前尺寸**仅供排查参考**，不应直接用于生产设计」，方向安全；是否连尺寸一起隐藏属产品取舍，未改 |
| R-1c | **端到端可达性未复现**：几何 INVALID 需要 `NON_FINITE_VERTEX`（含 NaN 顶点的 STL），本次**未构造真实坏网格** | `meshValidation.js:128` | 与 V2.0-10 同一遗留；本次验证到"生产调用路径 + 报告渲染路径"为止 |

### 6.2 明确排除、本阶段**确实没有**做的事（121.txt §三）

- **C1 / C2（Mc 非单调）** —— 未触碰
- **E4（runner 盲区 + 退出码）** —— 未修，只如实记录（§4.3）
- **`phase24 T5`** —— 未修、未改预期
- **P1 界面重构 / 低压铸造计算器** —— 均未启动
- **未提交 Git**、未进入 V2.0-12

### 6.3 承自 V2.0-09 / V2.0-10 的其余遗留（本阶段无变化）

C1 非单调成因②（`Mc < 7.58`，跌幅可达 21%，改数值需先裁决）· C2 成因①（≤6 mm / 4%）·
B 类待裁决（Mc 核心算法 / 热点位置精度 7/20 / D4 多冒口各按整件补缩量 / R1 铸铁石墨膨胀）·
D 类缺真实件数据（R2 缠绕污染体积 / R3 无企业冒口基准）·
F 类可接受限制（`large thin shell` 性能 · `f=1.10` 依据不可考 · 多热结主结果按 Mc 选 · 默认 cyl）。

---

## 7. 收尾声明

- **未启动 PHASE V2.0-12。**
- **未提交 Git**（工作区保持 `main @ da1c822` + 全部未提交改动，未 reset / 未 checkout / 未切分支）。
- 本阶段完成 121.txt §七 的全部完成标准：
  几何 INVALID 时**单热结与多热结**均明确显示阻断原因 ✓；
  **自动 Mc 与用户 Mc 两条路径行为一致** ✓；
  几何 VALID 的现有提示与来源逻辑**无回归** ✓；
  已覆盖工程数值**逐位一致** ✓；
  新测试通过且**引入失败 0** ✓；
  报告**如实记录 E4 与历史 T5**，未夸大验证范围 ✓。
