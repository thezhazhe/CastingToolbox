# PHASE V2.0-10 · Reliability BLOCK Priority Fix

**命令文件**：`D:\CDXProject\新建 文本文档 (120).txt`
**日期**：2026-10-11 ｜ **基线**：`main @ da1c822`（工作区含 V2.0-03 ~ V2.0-09 全部未提交改动）
**性质**：修复 PHASE V2.0-09 发现的 **N-E**（可信度等级的阻断优先级）。**只动标签，不动任何工程数值。**
**承接**：`docs/PHASE_V2.0-09_P0_READINESS_AUDIT.md` §3.2

**证据标注**：【实测·Node】= 用生产模块跑出来的 ｜【实测·浏览器】= 无头 Edge 真实页面量到的 ｜【源码确认】= 读源码逐行确认 ｜【历史断言】= 既有测试锁定的字面

---

## 1. 缺陷原因与实际调用链

### 1.1 一句话

**V2.0-06A1 为"未确认的自动 Mc"引入降级时，把判定写成 `(userMc || note) ? 'WARNING_REVIEW' : reliabilityLevel(…)` —— `note` 为真就短路，`reliabilityLevel` 再也轮不到。**
于是 `reliabilityLevel` 明确定义为 BLOCK 的 **几何 INVALID**，在冒口结果卡上变成了"🟡 需人工复核"。

### 1.2 实际调用链（三处，症状相同）

```
① 冒口 · 单热结                      calcs/calcManifest.js  calculate()
     :307（修复前）
       const level = (userMc || note) ? 'WARNING_REVIEW' : reliabilityLevel({ geomStatus, hsStatus });
                      ↑ note = AUTO_MC_NOTE（:244 在该分支【无条件】赋值）
       ⇒ (false || 真) → 短路 → reliabilityLevel 不被求值 → INVALID 降级

② 冒口 · 多热结                      calcManifest.js:292-300（修复前）
       return { ...primary, items, multi, level: 'WARNING_REVIEW', ... }
       ⇒ 该路径**根本不调用** reliabilityLevel（V2.0-08 为修 D1 而写死）⇒ INVALID 同样降级

③ 冷铁                              calcManifest.js:403（修复前）
       const level = (userMc || userT || autoT) ? 'WARNING_REVIEW' : reliabilityLevel({ geomStatus, hsStatus });
                      ↑ autoT = !userT && !userMc（热结正常时恒为真）⇒ 同一种短路
```

### 1.3 判据本身没错，错在**优先级**

`reliabilityLevel`（`calcs/calcManifest.js:548`）**HEAD 与工作区逐字相同**，规则也没错：

```js
export function reliabilityLevel({ geomStatus = 'VALID', hsStatus = 'none' } = {}) {
  if (geomStatus === 'INVALID' || hsStatus === 'INSUFFICIENT_RESOLUTION' || hsStatus === 'LOW_CONFIDENCE') return 'BLOCK_AUTO_RECOMMEND';
  if (hsStatus === 'ok') return geomStatus === 'WARNING' ? 'WARNING_REVIEW' : 'SAFE_TO_RECOMMEND';
  return 'WARNING_REVIEW';
}
```

问题在于调用方**用"软降级"覆盖了"硬门禁"**：note（解释文本）与 userMc（人工放行）都不该压过 BLOCK。

### 1.4 为什么"几何 INVALID"必须比"热结分析失败"更强

| 情形 | 人工输入替代了什么 | 应否放行 |
|---|---|---|
| 热结分析失败 / 低置信度（`hsStatus`） | 用户手填 Mc **替代的正是失败的那个产物** | **放行**（PHASE 29 设计：`WARNING_REVIEW`），本次**保留** |
| 几何 INVALID（`geomStatus`） | 网格本身不可信 ⇒ **净重、体积、热结位置全部不可信**；人工输入 Mc 只替代了 Mc 一项 | **不放行**（恒 BLOCK） |

`geomStatus = 'INVALID'` 只由两类 error 级问题触发（`js/engine/meshValidation.js:128`）：`NO_TRIANGLES`、`NON_FINITE_VERTEX`。

### 1.5 跨页不一致（N-E 的可见症状）

`js/views/processPage1.js:103` 用的是**纯函数** ⇒ 同一份状态，**检测中心显示 ⛔、冒口结果卡显示 🟡**。
【实测·Node】修复前：`page1('INVALID') = BLOCK_AUTO_RECOMMEND`、`riser(geom=INVALID) = WARNING_REVIEW`。

### 1.6 为什么既有测试没发现

`tests/phase285_test.mjs:271-279` 只测 **`reliabilityLevel` 纯函数**，不测 `calculate()` 的分支；
全仓**没有任何测试**以 `geomStatus='INVALID'` 跑过 riser/chill。**与当年 D1 完全同一个盲区模式**（纯函数正确、调用路径错误）。

---

## 2. 修改文件及最小修复内容

### 2.1 文件清单

| 文件 | 改动 |
|---|---|
| `calcs/calcManifest.js` | **+42 / −2**（精确测量，见 §2.4）—— 本阶段唯一的本体代码改动 |
| `tests/phasev2010_test.mjs` | **新增**，9 用例 |
| `tests/experiments/phasev2010_diffsize.mjs` | **新增**，一次性测量工具（把工作区文件逆向还原成修复前，diff 出真实增删行数；只写临时文件） |

**未改动**：`js/engine/**`、`calcs/riser.js`、任何视图文件、任何既有测试断言、任何阈值、任何黄金数据。

### 2.2 修复内容：1 个判定函数 + 3 处调用点

**(a) 新增判定函数**（`calcs/calcManifest.js`，紧随 `reliabilityLevel` 之后）：

```js
function isHardBlocked({ geomStatus, hsStatus, humanInput }) {
  if (geomStatus === 'INVALID') return true;                       // ① 几何不可信 ⇒ 恒阻断
  return !humanInput && reliabilityLevel({ geomStatus, hsStatus }) === 'BLOCK_AUTO_RECOMMEND';  // ② 其余阻断保留人工放行
}
```
规则（高 → 低）写在它的文档注释里：① 几何 INVALID 恒 BLOCK；② 其余 BLOCK 保留 PHASE 29 的人工放行；③ 无阻断一律维持软等级。

**(b) 三处调用点**：

| 位置 | 改法 |
|---|---|
| 冒口 · 单热结 | 在 `const out = …` **之后**加一行 `if (isHardBlocked({…, humanInput: userMc})) out.level = 'BLOCK_AUTO_RECOMMEND';` |
| 冒口 · 多热结 | `level:` 由写死的 `'WARNING_REVIEW'` 改为 `isHardBlocked({…, humanInput: mcAllUser}) ? 'BLOCK_AUTO_RECOMMEND' : 'WARNING_REVIEW'` |
| 冷铁 | 在 `const level = …` **之前**加一条提前 `return`（`humanInput: !autoT`） |

### 2.3 三处实现细节的取舍（都有具体理由）

1. **冒口单热结用"`out` 赋值"而不是"提前 return"**：
   提前 return 必须自己重写返回形状 —— 实测**当场漏掉了 V2.0-08 引入的 `mcSrc`**（结果页「来源：…」要用它，丢了会退回反推 ⇒ **D2 会复发**）。
   改成对 `out` 做一次赋值后，`mcSrc` 及**将来任何新增字段都自动带上**。已为该场景补了断言（§3 V2.0-10-1）。
2. **冷铁只能写成提前 return**：它下面那行 `return chillNote ? … : …;` 被 `tests/phasev2006a1_test.mjs:139` **锁定字面**（120.txt §五禁止改历史断言）。已在代码注释里写明"若将来在本返回点加顶层字段，这条早返回必须同步"。
3. **不动 `blocked` 标志**：只改等级。若把 INVALID 结果改成 `blocked: true`，会连带停掉 `process.riserHeight` 回写 ⇒ 改变浇注系统 `Hp` 的**数值**，超出"只处理可信度等级"的范围。

### 2.4 +42 / −2 的精确口径

用 `tests/experiments/phasev2010_diffsize.mjs` 把工作区文件**逆向还原**成修复前的样子再 diff：

```
42  新增 ｜ 2  删除
```

**2 行删除的去向（逐行核对）**：

```
- level: 'WARNING_REVIEW',                                             ← 多热结：唯一真正被改变的业务行
- const level = (userMc || userT || autoT) ? … : reliabilityLevel(…);  ← 冷铁：**原样移了位置**（因 chillNote 上移），不是删除
```

⇒ **本次真正改变行为的只有 1 行**；其余 41 行新增全部是注释与那个判定函数。**无任何公式、系数、阈值被触碰。**

---

## 3. 修复前后的受控测试结果

**测试文件**：`tests/phasev2010_test.mjs`（9 用例）。**先写测试、跑出失败、再修**——下表两列是同一条命令的真实输出。

| # | 用例（120.txt §四 的要求） | 修复前 | 修复后 |
|---|---|---|---|
| V2.0-10-1 ★ | 几何 INVALID + **自动 Mc 提示** → BLOCK | ❌ WARNING_REVIEW | ✅ **BLOCK** |
| V2.0-10-2 ★ | 几何 INVALID + **用户修改 Mc** → BLOCK | ❌ WARNING_REVIEW | ✅ **BLOCK** |
| V2.0-10-3 | 几何**有效** + 自动 Mc 未确认 → 维持原规则 | ✅ WARNING_REVIEW | ✅ WARNING_REVIEW |
| V2.0-10-4 | 几何**有效** + 用户 Mc → 维持既有规则（含 PHASE 29 人工放行） | ✅ | ✅ |
| V2.0-10-5 | 其他既有阻断状态不被自动 Mc 提示覆盖 | ✅ | ✅ |
| V2.0-10-6 ★ | **冷铁分支**同类短路 | ❌ WARNING_REVIEW | ✅ **BLOCK** |
| V2.0-10-7 ★ | **页面与结果卡等级一致** | ❌ 页面 ⛔ / 卡片 🟡 | ✅ 两处都 ⛔ |
| V2.0-10-8 | 工程数值零改动（黄金值） | ✅ | ✅ |
| V2.0-10-9 | 同一状态下除 `level` 外 18 个字段逐位不变 | ❌（等级断言） | ✅ |
| | **合计** | **4 通过 / 5 失败** | **9 通过 / 0 失败** |

**断言方式**（120.txt §四 的两条硬要求）：
- **只走真实调用分支**：全部经 `CALC_MANIFEST.<id>.calculate()` 与 `buildPage1Data()`，**不直测 `reliabilityLevel()` 纯函数**；
- **不做"搜源码字符串"式断言**：9 条全是行为断言（返回值/字段），无一条靠 grep 源码宣称通过。

**黄金值**（修复前实测，写进 V2.0-10-8 作为数值锁）：
`geom=INVALID + 自动 Mc` → `D=147 H=147 Mc=14 f=1.75 d_neck=56 modOk=true volOk=true`；
`geom=INVALID + 用户 Mc=20` → `D=144 H=144 d_neck=80`；冷铁 `thickness=[8.4, 22.4] mid=15.4`。

**修复后的等级状态矩阵**【实测·Node】：

| 场景 | level | mcSrc | note |
|---|---|---|---|
| 几何 INVALID + 自动 Mc | **BLOCK** | `STL_GEOMETRY_ANALYSIS` | 有 |
| 几何 INVALID + 用户 Mc | **BLOCK** | `USER_OVERRIDE` | 无 |
| 几何 VALID + 自动 Mc | WARNING_REVIEW | `STL_GEOMETRY_ANALYSIS` | 有 |
| 几何 VALID + 用户 Mc | WARNING_REVIEW | `USER_OVERRIDE` | 无 |
| 几何 WARNING + 自动 Mc | WARNING_REVIEW | — | 有 |
| 分析失败（无用户输入） | BLOCK（blocked） | — | 有 |
| **分析失败 + 用户 Mc（人工放行）** | **WARNING_REVIEW**（保留） | `USER_OVERRIDE` | 有 |
| 低置信度 + 用户 Mc（人工放行） | WARNING_REVIEW（保留） | — | 有 |

---

## 4. 是否检查了冷铁相关分支

**检查了，且存在同类缺陷，已做同规格最小修复。**

| 项 | 结论 |
|---|---|
| 缺陷 | 是。`calcManifest.js:403` 的 `(userMc \|\| userT \|\| autoT)` 与冒口是**同一种短路**（`autoT` 恒为真） |
| 修复前实测 | 几何 INVALID + 自动 T → **WARNING_REVIEW**；几何 INVALID + 用户 T → **WARNING_REVIEW** |
| 修复后实测 | 两处均 **BLOCK_AUTO_RECOMMEND**；几何 VALID 时维持原规则；**分析失败 + 用户 T 的人工放行未被误伤** |
| 改动量 | **1 条提前 return（3 行）+ 5 行注释**，未触碰 `T = chillT \|\| mc*2` 的取值、`runChill` 的任何输入输出 |
| 是否扩大范围 | **没有**。冷铁仍未接入 `FIXED_CALC_TASKS`（120.txt §五 与 V2.0-07 §D 的既有结论未变），未做任何主流程重构 |

---

## 5. 公式、引擎、阈值是否保持不变

**全部保持不变。**

- **`js/engine/**`**：7 个跟踪文件 sha256 前 8 位与 V2.0-09 结束时**逐位相同**
  ```
  d774532a hotspotV3.js   8d61d26d peakRegion.js   5957831c sampling.js   48488b13 modulusField.js
  80a763ef configV3.js    5af64ae4 meshValidation.js   1e3d96cc v3ViewAdapter.js
  ```
- **公式与数值**：`calcs/riser.js` **一行未改**；`runRiser` 的 D/H/f/Vr/d_neck、`T = chillT || mc*2`、`Vc`、`needVol`、`modvol` 全部未触碰。
  §3 的黄金值断言（V2.0-10-8）与"18 个字段逐位不变"断言（V2.0-10-9）是这条的结构性证明。
- **阈值**：`MODULUS_RATIO_MIN = 1.2`、`RISER_EFF`、`RISER_MATERIALS`（shrink / neck_k / rho）、`f` 起点 1.10 / 步长 0.05 / 上限 50 轮 —— **零改动**。
- **`reliabilityLevel()` 自身规则**：HEAD 与工作区**逐字相同**（120.txt §三.4 的要求）。
- **未改 `FIXED_CALC_TASKS`**、未动冷铁主流程、未改任何历史测试断言。

---

## 6. 全量回归结果及历史失败

### 6.1 逐项（120.txt §六 要求记录数量 / 失败名 / 退出码）

| # | 项目 | 修改前 | 修改后 | 退出码 |
|---|---|---|---|---|
| 1 | **本阶段新增测试** `phasev2010` | **4 / 5** | **9 / 0** | 前 1 → 后 **0** |
| 2 | PHASE V2.0-08 相关（`phasev2008`） | 9 / 0 | **9 / 0** | 0 |
| 3 | PHASE V2.0-06A1 相关（`phasev2006a1`） | 8 / 0 | **8 / 0** | 0 |
| 4 | **浏览器检查** `scripts/browser_inspection_test.mjs` | 全部通过 ✅（185 ✓） | **全部通过 ✅（185 ✓）** | 前 0 → 后 **0** |
| 5 | **完整测试套件** `node tests/runner.mjs` | **712 / 1** | **721 / 1** | 前 1 → 后 **1** |
| 6 | 定向 11 个相关文件 | — | 108 / 1 | 1 |

### 6.2 历史失败（**唯一**，与本阶段无关）

```
tests/phase24_test.mjs :: T5 关键真实 STL 热结数量零回归
Error: ALHR4510塑料模具v2-2.1.stl 热结数应=5，实际 2
```

- **错误信息逐字未变**（与 V2.0-07 / V2.0-08 / V2.0-08-FINAL / V2.0-09 四次记录相同）。
- 归属见 `docs/PHASE_V2.0-09_P0_READINESS_AUDIT.md` §4-E1：它在冒口链的**上游**（热点检出**数量**），
  根因是 V2.0-03 的 stride 修复使 `regionVolumeMaxRatio = 0.08` 的标定前提失效。
- **本阶段未修复、未改其测试预期**（120.txt §五 明令）。

### 6.3 721 = 712 + 9 ⇒ **引入失败 0**

712 是 V2.0-09 结束时的基线，+9 是本次新增的 `tests/phasev2010_test.mjs`。**没有任何既有断言从通过变失败。**

### 6.4 浏览器检查说明了什么（【实测·浏览器】）

`scripts/browser_inspection_test.mjs` 185 条 ✓ 全过，其中与本次直接相关的：

```
✓ ⑩⑥ 工程数值 = 修复前基线（D/H = 147/147、f = 1.75）
      {"D":147,"H":147,"f":1.75,"Mr":24.5,"neck":56,"level":"WARNING_REVIEW","bind":"volume","dMod":92,"mcSrc":"STL_GEOMETRY_ANALYSIS"}
✓ ⑩② 仍为 🟡 需人工复核   ✓ ⑩③ 来源行必须写"用户输入"   ✓ ⑩⑤ 取消勾选 → 回到 🟡 + 提示恢复
✓ 无未捕获异常
```

⇒ 真实浏览器里**几何 VALID 的既有行为逐位未变**，且 `mcSrc` / 来源行 / 归因说明全部照常。
（浏览器脚本跑的是几何 VALID 场景；INVALID 场景的页面证据在 Node 侧由 V2.0-10-7 覆盖。）

> 注：跑浏览器前**先把 `_edge_p93inspect` 旧 profile 移开**（该脚本不删 `--user-data-dir`，是 V2.0-08 记录的已知坑）。**未修改任何断言。**

### 6.5 测试运行器的已知统计问题（**如实记录，本阶段不修**）

`tests/hotspot_v2_test.mjs` **不导出 `tests`** ⇒ `runner.mjs:31` 直接 return，其 42 项检查**不进 721 的统计**；
且它的 `process.exitCode = fail ? 1 : 0` 使**整仓退出码在任何情况下都可能是 1**。

```
本次实测：该文件自报 41 通过 / 1 失败（失败项 = large thin shell: 性能 < 8s — 9727ms）
         该失败是既有的（V2.1 引擎 js/engine/hotspot.js，V2.0 全系列未触碰；两份 HANDOFF 已记录）
```

⇒ **721/1 这个数字是准确的，但它不等于"全仓所有断言"的通过情况。** 已登记为 V2.0-09 §4-E4，
120.txt §五 明令**不修 E4**，故本次只记录、不重构测试运行器。

---

## 7. 未解决问题与明确排除的事项

### 7.1 本阶段新发现、**有证据但未处理**

| # | 事项 | 证据 | 为什么不处理 |
|---|---|---|---|
| R-1 | **阻断时结果卡不显示"为什么被阻断"**。几何 INVALID 现在等级是 ⛔，但卡片**没有一句解释**：自动 Mc 时显示的是 `ℹ️ 本次冒口 Mc 采用 STL 自动热结估计值（未经确认）…`（**真的，但不是阻断的原因**）；用户 Mc 时 **`note` 为空、连这一句都没有**（【实测·Node】`geom=INVALID + 用户Mc → note=无`）。真正原因在参数页的「网格校验：无效（N 项问题）」行 | 【源码确认】`js/views/resultsCenter.js:149` 只渲染 `r.note` | 改 `note` 的内容/生成时机属于"解释文本"改动，超出 120.txt §三「只处理可信度等级的优先级」。**建议下一步**：INVALID 时给 `note` 前置一句网格无效说明（约 3 行，不动数值，两处调用点同改） |
| R-2 | **冷铁阻断路径只能靠提前 return**，若将来在该返回点加顶层字段会漏 | §2.3 第 2 条 | 根因是 `06A1-4` 锁定了 `return chillNote ? …` 的字面，而 §五 禁止改历史断言。已在代码注释里写明同步要求 |

### 7.2 明确排除、本阶段**确实没有**做的事（120.txt §五）

- **C1 / C2（Mc 非单调）** —— 未触碰（`calcs/riser.js` 一行未改）
- **E4（runner 盲区 + 退出码）** —— 未修，只如实记录（§6.5）
- **P1 界面重构** —— 未启动
- **低压铸造计算器** —— 未启动
- **未自动提交 Git**

### 7.3 承自 V2.0-09 的其余遗留（本阶段无变化）

C1 非单调成因②（`Mc < 7.58`，跌幅可达 21%，改数值需先裁决）· C2 成因①（≤6 mm / 4%）·
B 类待裁决（Mc 核心算法 / 热点位置精度 7/20 / D4 多冒口各按整件补缩量 / R1 铸铁石墨膨胀）·
D 类缺数据（R2 缠绕污染体积 / R3 无企业冒口基准）·
E 类与 P0 无关（`phase24 T5` · 冷铁未接入主流程 · 向导毛重 · E4）·
F 类可接受限制（`large thin shell` 性能 · `f=1.10` 依据不可考 · 多热结主结果按 Mc 选 · 默认 cyl）。

---

## 8. 阶段结论

**完成。** 120.txt §一 的目标——**让 BLOCK 保持 BLOCK，不被自动 Mc 提示或人工修改降级**——已达成，且**冒口（单/多热结）与冷铁三条路径全部覆盖**。

**最终汇报的三分开**：

- **实际修复**：`calcs/calcManifest.js` **+42 / −2**（其中真正改变行为的只有 1 行）；新增 1 个判定函数 + 3 处调用点；冒口与冷铁同规格修复。
- **测试证据**：新测试 **4/5 → 9/0**；全量 **712/1 → 721/1**（引入失败 0）；浏览器 **185 ✓ 全通过**；工程数值黄金值逐位未变；引擎 7 指纹未变。
- **历史问题**：`phase24 T5` 留红（逐字未变，与冒口链无关，未修未改断言）；`hotspot_v2_test` 不计入统计 + 退出码恒 1（E4，如实记录不修）。
- **仍然未知**：几何 INVALID 在**真实损坏 STL（含 NaN 顶点）**上的端到端可达性——本次确认了**代码路径**与**跨页一致性**，但**未构造真实坏网格做端到端复现**。

**不自动进入下一阶段。**
