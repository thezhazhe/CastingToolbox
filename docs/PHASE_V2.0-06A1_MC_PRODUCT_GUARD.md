# PHASE V2.0-06A1 · 自动 Mc 风险控制与工程输入确认

> 命令文件：`D:\CDXProject\新建 文本文档 (113).txt`
> 上游结论：`docs/PHASE_V2.0-06A_MC_PRODUCT_DECISION.md`（决策 **C —— 暂时限制功能适用范围**）
> 基线：`main @ da1c822`（+ 未提交的 05H / V2.0-03 两处引擎修复，本阶段**未动引擎**）
> 日期：2026-10-10

---

## 1. 原有产品风险

06A 用独立几何验证确认：V3 引擎的 `Mc ≡ (1/3)×d(峰点)`，而经典凝固模数对**板状件是 `d`**、圆柱是 `d/2`、球是 `d/3`。
⇒ 实测板 300×200×40：引擎 6.667 vs 解析 20.000（**0.333×**）；立方 100：1.000×；圆柱 ⌀80×120：0.889×。

四个风险点（本阶段 §三 要求逐条落到实际源码，不以变量名推断）：

| 场景 | 当前输入来源 | 当前输出 | 风险 |
|---|---|---|---|
| ① 自动 Mc 展示 | `process.mcHotspot`（`src = STL_GEOMETRY_ANALYSIS`）→ `resultsCenter.js mcSourceLine` / `processPage1.js aRow('mc')` | 一行"来源：STL 热结检测 Mc = X mm" | **显示为确定值**，用户无从知道它没做过几何校准 |
| ② 冒口尺寸与冒口颈 | `calcManifest.js` riser：`hsStatus==='ok' && !userMc` → `mc = mcHotspot`，且 **`note` 保持 `null`** | `D`、`H`、`d_neck`（`d_neck = round(4×Mc×neck_k)`，**1:1 线性**） | **偏小**且界面上无任何提示；等级仍为 `SAFE_TO_RECOMMEND`＝"✅ 可直接采用" |
| ③ 冷铁默认壁厚 | 同上 → `T = chillT \|\| mc × 2`；`level = reliabilityLevel(...)` | 冷铁厚度 + `deltaText` | 默认值被当成经过本铸件验证的设计值 |
| ④ 冒口 1.2 判据 | `inspectionCenter.js:derive()` → `buildRiserRows(state.product.hotspots, …)`（引擎 V3 自动输出，**全流程不可编辑、不可确认**） | `riserVerdict` → `LEVEL.PASS`「模数比满足要求（≥ 1.2）」 | **假 PASS**（`ratio = M_riser / Mc`，Mc 偏低 → ratio 虚高） |

**现有确认机制的核实结果**（§三 要求"确认用户是否已有可复用的输入、编辑或确认机制"）：

| 场景 | 是否已有确认机制 |
|---|---|
| ①②③（工艺设计中心） | **有**：`CastingProject` 的 `SRC`/`CONF` 来源标记。用户在「冒口参数」改 Mc 输入框 → `src = USER_OVERRIDE` → 既有代码已认作"人工放行"（`calcManifest.js isUserVal`）。**无需新增机制**，只需把"自动"这一支如实标注。 |
| ④（工艺检测中心） | **没有**。`state.product.hotspots` 是 `analyzeHotspotsV3Sliced` 的直接产物，页面上既不能改也不能确认。 |

---

## 2. 实际数据流（逐条核对到源码，与 06A 报告一致）

```
① 展示    engine V3 peakModulus ──toViewResult──▶ hotspots.items[].mc
          └─ designCenter.js:803  mcHotspot = round(hs.hotspots[0].mc × 10)/10  (src = STL_GEOMETRY_ANALYSIS)
             ├─▶ resultsCenter.js  mcSourceLine(r, ctx)   ctx.mcUser = (src ∈ {USER_OVERRIDE, USER_INPUT})
             └─▶ processPage1.js   aRow('mc', …)

② 冒口    calcManifest.js riser.calculate()
             ├─ userMc?  ← isUserVal(process.mcHotspot | process.wallHot)   [有确认机制]
             └─ else hsStatus==='ok' → mc = mcHotspot  …（note = null，level = SAFE_TO_RECOMMEND）
                                        └─▶ runRiser({mc_mode:'direct', mc}) → D / H / d_neck

③ 冷铁    calcManifest.js chill.calculate()
             ├─ userT?  ← process.chillT 的来源标记                        [有确认机制]
             └─ else T = mc × 2  ← 同一个自动 mc
                                        └─▶ runChill({T})

④ 1.2 判据  工艺检测中心  inspectionCenter.js
             state.product.hotspots (引擎直出，无确认位)
               └─▶ buildRiserRows(hotspots, state.risers)  ratio = modulusMm / h.mc
                     ├─▶ riserVerdict(row)  → LEVEL.PASS / WARNING / INFO
                     └─▶ summarizeRisers()  → RISER_CODE.MODULUS_OK (LEVEL.PASS)
```

**与 06A 报告的差异**：无实质差异；仅补记一处——`resultsCenter.js` 的多热结分页用的是
`|it.hsMc − it.Mc| > 1e-9`（数值差）而非 `src` 来判"用户输入"。该路径只在用户**主动勾选**
热结并进入弹窗改值时触发，属用户动作，本次未改（§五 禁止"顺便"改无关项）。

---

## 3. 实施的最小保护措施

设计原则（113.txt §一）：**只加"确定性"，不加"数值"**。所有工程数值、公式、阈值一行未改。

| # | 措施 | 落点 |
|---|---|---|
| 1 | 自动 Mc 就地标注「**自动估计值，尚未验证适用于所有几何**」，三处（结果页 / 参数页 / 检测页）**同一口径** | `resultsCenter.js mcSourceLine`、`processPage1.js`、`inspectionCenter.js` |
| 2 | 冒口自动分支产出 note（"未经确认"）并**降级为 `WARNING_REVIEW`**（不再给"✅ 可直接采用"） | `calcManifest.js` riser |
| 3 | 冷铁自动 `T_hot` 定位为「**未经确认的初始建议值**」并降级；**用户填的 `chillT` 仍优先，且不带该提示** | `calcManifest.js` chill、`resultsCenter.js` |
| 4 | 检测页新增**一个确认位**（复用既有 `SRC` 语义，不新增状态机）：未确认时 1.2 判据走新的 `RISER_CODE.MODULUS_OK_UNCONFIRMED`（`LEVEL.INFO`），总览首行也不得显示"未发现明显问题" | `processInspection.js`、`inspectionCenter.js` |

**安全默认**：`buildRiserRows(hotspots, risers)` 的 `mcConfirmed` **默认为 `false`** ——
调用方不显式确认就拿不到最终 PASS。这是"宁可不给，不给错的"在本项目的一贯口径。

**没有做的**（§四/§五 边界）：
- 没有改 `modulusCeilRatio`、没有改 `modulusField.js`、没有改冒口体积校核公式
- 没有批量统一 `d/2` 与 `d/3`（§五 明令禁止"为统一数学形式批量改公式"）
- 没有改 `MODULUS_RATIO_MIN = 1.2`（§四.4 明令"不能通过简单修改阈值来掩盖输入可靠性问题"）
- 没有新增弹窗、没有新增配置项、没有持久化新的状态字段

---

## 4. 修改文件清单

| 文件 | 改动 |
|---|---|
| `js/model/processInspection.js` | 新增 `RISER_CODE.MODULUS_OK_UNCONFIRMED`；`buildRiserRows(h, r, {mcConfirmed})` 返回该标记（**counts / ratio 数值计算一行未改**）；`summarizeRisers` 增 `mcConfirmed` → 未确认时发 INFO 级新 code，并返回 `mcUnconfirmed` |
| `js/views/inspectionCenter.js` | `state.mcConfirmed`（默认 false，换产品复位）；`derive()` 透传；`RISER_TEXT` 新条目；`riserVerdict(row, mcConfirmed)`；`riserCard(row, mcConfirmed)`；总览首行三分支；热点明细组加确认复选框 + `change` 监听 |
| `calcs/calcManifest.js` | riser 自动分支：新增 `note`，`level` 不再给 `SAFE_TO_RECOMMEND`；chill：新增 `autoT` 判定 + `chillNote`，`level` 同上。**公式、系数、数值一律未改** |
| `js/views/resultsCenter.js` | `mcSourceLine` 自动分支补限制语；冷铁结果块补渲染 `c.note` |
| `js/views/processPage1.js` | 「最大热节 Mc」行按 `src` 判定，自动值时补 note |
| `js/i18n/en-US.js` | 新增 9 条英文（本阶段新词条全部登记，不让英文覆盖缺口扩大） |
| `tests/phase93_test.mjs` | 93-H 显式传 `mcConfirmed: true`（**断言逐字未改**，只是把"测的是比值公式"这一前提写明）；动态词条登记表加新 code |
| `tests/phasev2006a1_test.mjs` | **新增**，7 个用例对应 §六 的 7 项 |

**`js/engine/**` 一行未改**（指纹见 §5.3）。

改动量（`git diff --stat`，**不含** 05H / V2.0-03 两处既有未提交的引擎改动）：

```
js/model/processInspection.js |  33 ++++++++----
js/views/inspectionCenter.js  |  43 +++++++++++----
calcs/calcManifest.js         |  21 ++++++---
js/i18n/en-US.js              |  11 +++++
js/views/processPage1.js      |   8 +++-
js/views/resultsCenter.js     |   5 ++-
6 files changed, 101 insertions(+), 19 deletions(-)
```

---

## 5. 定向测试与回归结果

### 5.1 定向（113.txt §六 的 7 项）

`node tests/runner.mjs phasev2006a1` → **7 通过 / 0 失败**

| 用例 | 覆盖 §六 | 断言要点 |
|---|---|---|
| 06A1-1 | ① 估计值提示 | 三个页面都含统一限制语；6 条新词条都有英文 |
| **06A1-2 ★** | **② 不得被误认为已确认** | 自动分支必须产 note + 降级；结果页必须渲染 note；三种来源（壁厚 / 自动 Mc / 用户 Mc）文案互不相同；参数页必须按 `src` 而非数值区分 |
| 06A1-3 | ③ 确认后流程照常 | `runRiser` 的 `Mr_need = Mc×f`、`d_neck = round(4·Mc·neck_k)` 手算复核；Mc 增大时尺寸单调不小 |
| 06A1-4 | ④ 冷铁初始建议 | 默认值公式仍是 `mc*2`（未改）；带 note + 降级；用户 `chillT` 仍优先且不带提示 |
| **06A1-5 ★** | **⑤ 不得无条件最终 PASS** | 默认未确认；`ok`/`ratio` 数值照旧；总览不得出现 PASS 级 `MODULUS_OK`；改走 `MODULUS_OK_UNCONFIRMED` + `LEVEL.INFO`；阈值仍 1.2；视图两处都不得显示最终合格 |
| 06A1-6 | ⑥ 已确认照既有公式 | 1.2 恰过 → PASS；1.19 → WARNING；**未确认 + 不足仍是 WARNING**（输入不确定不得把"不足"美化成"待确认"）；三分类互斥完备 |
| 06A1-7 | ⑦ 无关功能无变化 | 五个改动文件剥注释后**不含任何引擎内部量**；引擎对 `t01_boss100` 的实测输出（Mc / 归一化模数 / 置信度 / 区域体积 / 位置）与 05H 冻结指纹**逐位一致** |

### 5.2 主回归

`node tests/runner.mjs`

| | 通过 | 失败 |
|---|---|---|
| 本次改动前（= 05H 后状态） | 688 | 1 |
| **本次改动后** | **695** | **1** |

- **本次引入的失败：0**
- 原本存在的失败：**1** —— `phase24_test.mjs :: T5`（V2.0-03 的 `regionVolumeMaxRatio` 标定遗留，
  错误信息与改动前逐字相同；见 `BASELINE.md` 追加段）
- 无法归属的失败：**0**
- 净增 7 个用例 = 本次新增的 `phasev2006a1_test.mjs`
- **未修改任何黄金值、未删除任何测试、未放宽任何阈值**

### 5.3 引擎指纹（本阶段零改动）

`sha256` 前 8 位，与 `tests/engineering-generated/BASELINE.md` 追加段记录一致：

```
hotspotV3 d774532a · peakRegion 8d61d26d · sampling 5957831c · modulusField 48488b13
configV3 80a763ef · meshValidation 5af64ae4 · v3ViewAdapter 1e3d96cc
```
（`peakRegion` 与 `modulusField` 的漂移是 V2.0-03 / V2.0-05H 的既有未提交改动，**06A1 未再碰**。）

---

## 6. 仍然存在的限制

1. **算法本身没变**：板状/长条状热结的自动 Mc 仍偏低 3 倍量级。本阶段只让它**不再冒充已确认的工程输入**，
   不修正数值。要修正必须重定义估值量 ⇒ 属核心算法变更（06A §6.2 第二步，需 06B 决策）。
2. **确认位是"人工声明"，不是"自动验证"**。用户勾选即视为已核对；工具不做校验，
   也无法判断用户的核对是否充分。这是刻意的：产品不能替用户承担工程判断。
3. **检测页的确认位不跨会话保存**（换产品复位、刷新即失效）。这是最小实现；若以后要持久化，
   必须同时解决"改了 STL 但确认位还在"的陈旧状态问题。
4. **"不足"方向不受确认位影响**：未确认时 `ratio < 1.2` 仍报 WARNING。
   这是安全的（输入不确定不会把"不足"变成"合格"），但意味着**确认位的可见效果只体现在"够"的那一侧**。
5. **`resultsCenter` 多热结分页仍用数值差判"用户输入"**（见 §2 末），未与 `src` 口径统一。
6. **英文覆盖**：本阶段新词条已全部登记，但仓库既有的英文缺口（1200+ 处）不受本阶段影响。
7. **未做浏览器实测**：Node 环境无 DOM，页面文案与复选框的**真实渲染**未在浏览器里量过
   （沿用项目既有做法：结构契约在 Node 测，真实排版在 `scripts/browser_*_test.mjs` 里量）。

---

## 7. 用户现在应该如何理解这三样东西

### 自动 Mc（结果页 / 参数页 / 检测页里的「检出 Mc」「最大热节 Mc」「热点模数」）

> 它是**热结的相对严重程度指标**，用来**找位置、排顺序**。它不是经过几何校准的模数真值 ——
> 对等轴/块状热结接近可用，对**板状、长条状热结可能低到 1/3**。
> 页面上凡出现自动值，都会带「自动估计值，尚未验证适用于所有几何」这一句。

### 冒口设计结果

> - Mc 来自**用户自己填的**（`来源：用户输入`）→ 按正常工程输入看待，结论可用。
> - Mc 来自**STL 自动检测**（`来源：STL 热结检测…`）→ 结果标记为**初步估算**，
>   等级是「🟡 需人工复核」而不是「✅ 可直接采用」，并附一行提示。
>   要把它变成正式结果：核对热节壁厚 → 在「参数与执行条件 → 冒口参数」填 Mc → 重新执行。

### 冷铁默认壁厚

> `T_hot = 2 × Mc` 是**未经确认的初始建议值**，不是本铸件热节的验证结果。
> 用户随时可以在「冷铁」处填 `T_hot` 覆盖 —— 填了就以用户的为准，提示也随之消失。

### 冒口检测的 1.2 判据

> - **未勾选**「我已核对以上热点模数…」→ 显示「模数比**计算通过**（≥ 1.2）；热点模数 Mc 尚未确认，
>   **本结论待确认**」（ℹ，不是 ✅），总览首行也不再是"未发现明显问题"，而是"结论待确认"。
> - **勾选后** → 恢复既有的 ✅ PASS / ⚠ WARNING 判定，公式与阈值一字未改。
> - 「模数比**不足**」在任何状态下都是 ⚠ WARNING，不会因为没勾选就变成"待确认"。

---

# 8. 🔧 追加（2026-10-11 · PHASE V2.0-06A1-R1，115.txt）

> **上面 §1~§7 是本阶段做完时的记录，不改。** 本节记录之后 114.txt 只读验收查出的
> **P0** 及其修复。**结论变化：§3 表格第 4 行声称的保护当时在真实浏览器里并未生效。**

## 8.1 根因（已确认，非推测）

`js/views/inspectionCenter.js` 把确认位的 `change` 监听**直接绑在元素上**：

```js
container.querySelector('#pi_mc_confirm')?.addEventListener('change', …);   // 旧写法
```

这一行在 `render()` 里执行时，`#pi_detail` 还是空的 —— 复选框是
`paint()` → `renderDetail()` 在**之后**才现画的。`?.` 于是静默跳过，**监听器从未注册**；
而 `paint()` 不重跑绑定（项目已知坑：`paint()` 不重跑 `bindImport()`），事后也补不回来。

**真实浏览器实测**（无头 Edge + CDP）：复选框存在、可见、可点，勾选后 `checked === true`，
但判定文案**一字不变**，`state.mcConfirmed` 恒为 `false` ⇒ **PASS 分支不可达**，
且"打了勾却不生效"是误导性的。方向是安全的（不会假 PASS），但功能等于没做。

## 8.2 修复

改**事件委托**，挂在长期存在的 `#pi_detail` 上（`paint()` 只替换它的 innerHTML，
容器本身不销毁 ⇒ 每次重画后的新复选框天然具备事件能力，且只注册一次）：

```js
container.querySelector('#pi_detail')?.addEventListener('change', (e) => {
  if (e.target?.id !== 'pi_mc_confirm') return;
  state.mcConfirmed = e.target.checked === true;
  paint(container);
});
```

**未改**：确认状态默认值（仍 `false`）、换产品复位（仍在 `loadProduct`）、判定公式、阈值 1.2、
`js/engine/**`、`FIXED_CALC_TASKS`、冷铁任务调度。

## 8.3 真实浏览器回归（`scripts/browser_inspection_test.mjs`，新增 ③-bis 段）

`node scripts/browser_inspection_test.mjs` → **全部通过 ✅**（0 失败）。

| 场景 | 断言 | 实测 |
|---|---|---|
| 前置 | 复选框存在且可见 / 初始未确认 / 无 PASS 卡 | ✓ |
| **A 勾选** | 复选框仍 `checked=true`（证明确实重绘过）/ 卡片给 PASS 文案 + `pi-pass` / 总览条目翻面 | ✓ |
| **B 取消** | `checked=false` / 卡片回 INFO「本结论待确认」/ **不残留任何 PASS** | ✓ |
| **C 反复重绘** | 确认→取消→再确认后仍生效 / 复选框只有 1 个 / 一次操作只处理一次 | ✓ |
| **D 安全边界** | 未确认+≥1.2 不给 PASS / 未确认+<1.2 仍 WARNING / **换产品后确认失效且无 PASS 残留** | ✓ |
| **E 首行三分支** | 摘掉 R2 后：未确认→「结论待确认」；确认→「未发现明显问题」(ok)；再取消→回「结论待确认」 | ✓ |

> E 是新加的：A/B 用的是 R1(满足)+R2(不足) 两张卡，首行恒为"⚠ 需要关注"，
> 把"待确认 ↔ 未发现明显问题"这一支盖住了 —— 第一版断言因此误判 5 项。
> 这是**测试设计缺陷不是产品缺陷**，已用现有 UI（明细表 × 删除）单独验出该分支。

## 8.4 既有浏览器断言同步（06A1 就该改、当时漏了）

`browser_inspection_test.mjs` 有 2 条 06A1 **之前**的断言（"必须存在 PASS 卡"、"总览含『模数比满足』"），
在 06A1 之后必然变红。本次按新契约改写，**并把"必须有 PASS"挪到场景 A**（确认后必须真的出现）
—— 是**加强**不是放宽。浏览器测试不在 `tests/runner.mjs` 里，所以当时没人看到它们变红。

## 8.5 定向与回归

| 套件 | 结果 |
|---|---|
| `node tests/runner.mjs phasev2006a1` | **8/8**（新增 06A1-R1：绑定方式的结构守卫，浏览器测试不在 runner 里，回退时没人会看到） |
| `node scripts/browser_inspection_test.mjs` | **全部通过 ✅** |
| `node tests/runner.mjs` | **696 通过 / 1 失败** = 之前 695/1 + 新增 1 条；唯一失败仍是既有 `phase24_test.mjs :: T5`（错误信息逐字相同） |

**本次引入的新失败：0。** 未改黄金值、未放宽断言、未删除测试、未改阈值、未改核心算法。

## 8.6 遗留（仍未验证）

- **冷铁主流程**：`FIXED_CALC_TASKS` 不含 `chill` ⇒ 设计中心从不执行冷铁模块 ⇒
  `resultsCenter` 的 ❄️ 冷铁块（§3 表格第 3 行的"初始建议值"提示就挂在这里）**在真实产品里不可达**。
  代码正确（定向 06A1-4 通过）但**无任何可观测产品行为**，属于"未验证"。
  要不要让设计中心跑 chill、还是把这段 UI 明确为"预留给其他入口"，需单独裁决。
- 检测页确认位仍**不跨会话保存**（换产品复位、刷新失效）。
- `resultsCenter` 多热结分页仍用**数值差**判"用户输入"（非 `src`），未统一。
- 🔴 **§3 表格第 2 行的保护有旁路（2026-10-11 · PHASE V2.0-07 发现）**：
  在**勾选热结但不改 Mc 值**的路径上，`calcManifest.js:268` 走的是 `reliabilityLevel(...)`
  而不是 `:277` 那行"note 与 level 同一口径"的判断 ⇒ 结果卡同时显示
  「自动估计值，尚未验证适用于所有几何」与「**✅ 可直接采用**」，且 06A1 的 `note` 整条消失。
  **真实浏览器实测**（含尺寸一位不变）见 `docs/PHASE_V2.0-07_RISER_AUDIT.md`。
  本节只登记，**未修**（PHASE V2.0-07 为只读调查阶段）。

## 8.7 冻结建议

真实浏览器测试通过、本次引入失败 0 ⇒ **建议冻结 06A1**（前提是 8.6 第一条作为已知遗留登记）。
