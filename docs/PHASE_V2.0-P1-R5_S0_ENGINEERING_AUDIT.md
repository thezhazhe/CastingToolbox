# PHASE V2.0-P1-R5 · S0 前置核实审计（只读）

> 输入：`148.txt`。基线：`docs/PHASE_V2.0-P1-R5_UI_DESIGN_SUMMARY.md` / `…_PROPOSAL.md`（147.txt）
> 性质：**只读调查，未改任何产品代码 / 测试代码 / 公式 / 默认值**（核对见 §6）。
> 证据分级：**【代码】**＝已由代码证实 · **【数据】**＝已由现有数据证实 · **【推断】**＝合理推断 · **【待验】**＝尚待验证。

---

## 0. 三句话结论

| # | 问题 | 结论 |
|---|---|---|
| 1 | 出品率系数 1.8 | **产品代码里根本没有这个系数**——它只在外部 Excel `1_铸造工艺计算表.xls` 的 `低压浇铸系统` sheet 里。UI 不存在"把 1.8 当事实展示"的风险；真正的风险方向**相反**（见 §1.5）。 |
| 2 | 冒口形状默认值 | 设计中心的 `cyl` 是 **PHASE 78 的一次显式产品决策**（有报告原文），独立计算器的 `sphere_head` 是历史遗留。两个入口**互不读写对方状态，不会互相覆盖**。默认形状**只改"可补缩量"，不改"冒口做多大"**。 |
| 3 | 兜底 Mc | **"主体壁厚 ÷ 2"在 `NO_HOTSPOT` 这一种状态下确实是真实规则**，代码与文案一致；**但界面在另外两种状态下也显示相近文案，而那两种状态下冒口是被阻断的** ⇒ **不得把"没热结 ⇒ 主体壁厚÷2"当成通用文案写进 S1**（详见 §3.2）。 |

---

## 1. 出品率系数 1.8

### 1.1 它在哪里【代码】

**结论：产品代码中没有这个系数。**

全仓检索（`js/` `calcs/` `data/` `tests/` `scripts/`，含 `*.js` `*.json` `*.mjs`）：

| 命中 | 出处 | 是否相关 |
|---|---|---|
| `modelView3D.js:556` `r * 1.8` | 三维箭头头部尺寸 | ✗ 无关 |
| `tests/phase283f_test.mjs:27` `26.7 * 1.8` | 浇注温度公式测试数据 | ✗ 无关 |
| `calcs/shrinkage.js:16` `铸钢 common: 1.8` | 线收缩率 1.8% | ✗ 无关 |
| `calcs/machining.js:24/26/29`、`data/ct_calc.js` | 加工余量 / CT 公差表值 | ✗ 无关 |

**唯一所在**：外部文件 `D:\CDXProject\CCproject\1_铸造工艺计算表.xls` → **`低压浇铸系统`** sheet。

**文档记载 3 处**（均非产品代码）：`docs/HANDOFF_2026-10-07.md:73,335,473` · `docs/PHASE_V2.0-P2_LOWPRESSURE_ANALYSIS.md`（§2.3 / §4.3）· `docs/PHASE_V2.0-P1-IMPLEMENTATION_REPORT.md:211,260`。

> ⚠ **同名不同物警示**：本项目的文档里至少还有两个"1.8"，检索时不要串：
> ① **内浇道流速 1.8 m/s** —— `docs/PHASE28_ALGORITHM_AUDIT_SUMMARY.md:58` 记为"来源未确认且不分材料"，该问题**已由 PHASE 48-B 定案**：现行代码是 `calcs/gating.js:121` `V_LIMIT = {封闭:1.5, 开放:1.0}` 与 `:134` `V_TARGET = {灰铁1.00, 球铁0.45, 铝合金0.45}`，**1.8 已不存在**。
> ② `calcs/shrinkage.js:16` 铸钢综合线收缩率 1.8%。

### 1.2 公式、输入与输出【数据】

出处：`docs/PHASE_V2.0-P2_LOWPRESSURE_ANALYSIS.md` §3（对 `低压浇铸系统` sheet 的逐格复算，非本轮新做）。

| 项 | 值 | 单位 | 性质 |
|---|---|---|---|
| 产品重量 | 62 | kg | 输入（表内注"自动生成"） |
| **浇注重量** | **111.6** | kg | 计算值 |
| 倍数 | 111.6 / 62 = **1.8000** | — | — |

**公式**：`浇注重量 = 产品重量 × 1.8`
**输入含义**：产品重量（铸件净重）
**输出含义**：浇注重量（该次浇注需要的金属总重，含浇注系统与冒口）

**下游用途**【推断】：在该 sheet 内，其余各项（入水口直径、产品/横浇道模数与判据）都能由**壁厚与体积/表面积**复算出来，**不需要浇注重量**。
⇒ 合理推断：浇注重量在这张表里是一个**未被引用的输出**（与 §2.2 记录的 `P3 保压压力` 属同类问题）。
**【待验】** 我没有打开 `.xls` 逐格核对引用关系，此条需人工在 Excel 里确认一次。

### 1.3 1.8 是不是就等于 55.6% 出品率【数据】

**算术上是恒等的，且用的是项目自己的定义。**

* 项目对出品率的定义（`data/process/yield_ranges.json` 的 notes 原文）：`出品率 = 铸件重量 ÷ 浇注重量 × 100%`
* 代入：`62 ÷ 111.6 = 55.56%` ⇔ `1 / 1.8 = 0.5556`

所以：**只要采信这条定义，1.8 就等价于 55.6%，不是"另一种口径"。**

**但它是不是"出品率系数"，还有三种可能**【数据 + P2 §4.3 已列】：

1. 真的就是本产品的工艺出品率（55.6%）；
2. **含工艺附件的口径** —— 该 sheet 的原则第 5 条要求"顶部加排气片（8mm 厚、高 50~70）"，附件重量若并入浇注重量，倍数自然偏高；
3. 本产品（入水口壁厚 **72.5 mm** 的特厚大件）**专用**系数，不具通用性。

**表内没有任何文字说明它属于哪一种。**

### 1.4 72~85% 到底适用于什么条件【代码】

出处：`calcs/yield.js`（多级回退，只取最准的一级）。

| 层级 | 数据 | 区间 |
|---|---|---|
| ① 产品×工艺 | `PRODUCT_YIELD['轮毂 / 铸铝件']['低压']` | **[75, 85]** |
| ② 材质×工艺 | `MAT_PROCESS_YIELD['铝合金(Al)']['低压']` | **[72, 85]** |
| ③ 仅工艺 | `PROCESS_YIELD['低压']` | [70, 82] |

**关键事实：低压这一列只存在于"铝合金"域内。** `MAT_PROCESS_YIELD` 里 `灰铁(HT)` / `球铁(QT)` / `铸钢(ZG)` / `铜合金(Cu)` **都没有 `低压` 条目**——它们落到第③层通用 `[70, 82]`。

> 所以口语里的"低压 72~85%"精确说法是 **「铝合金 × 低压」= 72~85%** 与 **「轮毂/铸铝件 × 低压」= 75~85%**。引用时必须带条件。

### 1.5 两者是否可直接比较，以及 UI 文案风险

**可比性**【数据】：

* **口径相同**（都是"铸件重量 ÷ 浇注重量"）⇒ **数值上可以直接比较**。
* 但**可比性有保留**：① 仓库区间是**行业文献典型值**（`calcs/yield.js:4` 自述"仅供参考，待各厂实绩修正"），不是本企业实测；② Excel 只有**1 个算例**，且是壁厚 72.5 mm 的特厚大件；③ 1.8 可能含工艺附件。
* **反推**：若出品率取 72~85%，系数应在 **1.18 ~ 1.39** 之间，而不是 1.8。
* ⇒ **数值可比，但不能据此判定谁对谁错。** 需要企业回答的是"1.8 属于 §1.3 的哪一种"。

**UI 文案风险**【代码】：

| 事实 | 结论 |
|---|---|
| 产品里**没有**低压计算器；`1.8` 不出现在任何界面 | ⇒ **不存在"UI 把 1.8 当事实"的误解风险** |
| 低压在 UI 中只出现在两处：<br>· `js/views/smallCalcs.js:259` 出品率计算器的「铸造工艺 / 产线」下拉（选项来自 `YIELD_PROCESSES`，**含"低压"**）<br>· `js/views/designCenter.js:609` 铸造方法的「金属型（重力/低压）」——**只映射到加工余量等级**（`calcs/machining.js:78`），与出品率无关 | 唯一暴露面是**出品率计算器** |
| 该计算器的「说明与依据」已写明：`预估是"参考值"，算铁液、配炉料必须用本厂实测值`（`smallCalcs.js:278`）、`本页数据仅供参考（行业经验典型值，待各厂实际修正）`（`:282`），且第②步「现场实测出品率」默认预填预估中值、**要求用户改成贵厂实绩、改过即记住**（`:277`） | 设计上**已经要求用实测值覆盖**，缓解了这一风险 |

⇒ **判断：当前 UI 文案不足以造成"把 1.8 当事实"的误解。**

⇒ **给 S1 的硬约束**（写进使用指南时必须遵守）：

1. **不得引用 1.8**（它没有工程依据，且不在产品内）；
2. **不得把"72~85%"说成"低压的出品率"** —— 必须带条件：「铝合金 × 低压」72~85%；
3. 指南只应复述现有口径：*预估值仅供参考，算铁液/配炉料必须用本厂实测出品率*。

---

## 2. 冒口形状默认值

### 2.1 `RISER_SHAPES` 的定义【代码】

`calcs/riser.js:58-93`，**4 个键，库本身不含"默认形状"字段**：

| key | name | effKey | 模数式 | 反求式 DfromM |
|---|---|---|---|---|
| `cyl` | 圆柱形 | `eff_open` | `M = D×H/(2D+4H)`（《铸造工艺学》标准公式） | `Mr·(2+4hd)/hd` |
| `sphere_head` | 球顶圆柱 | `eff_sph` | `M = V/A`，半球头+柱体 | `/0.92` 起步 + **20 次不动点迭代** |
| `sphere` | 球形 | `eff_blind` | `M = D/6`（《铸造手册》） | `Mr·6` |
| `square` | 正方柱 | `eff_open` | `M = a×H/(2a+4H)`（类比圆柱） | `Mr·(2+4hd)/hd` |

补缩效率表 `calcs/riser.js:19-24`：`eff_open 14% · eff_blind 20% · eff_sph 25% · eff_heat 35%`（《铸造手册》第 5 卷）。

### 2.2 两个入口各自怎么取默认【代码】

| 入口 | 默认值 | 位置 | 性质 |
|---|---|---|---|
| **设计中心** | `'cyl'` | `js/model/CastingProject.js:95` `riserShape: P('cyl', SRC.DEFAULT, CONF.LOW, true)`（注释「默认圆柱形」） | **数据模型层声明的默认** |
| 设计中心 · 兜底 | `'cyl'` | `calcs/calcManifest.js:277` 值不合法时 `: 'cyl'`；`js/views/resultsCenter.js:199` 显示兜底同为 `'cyl'` | 守卫，非偏好 |
| **独立计算器** | `'sphere_head'` | `js/views/riserView.js:18` `DEFAULTS.shape = 'sphere_head'`（HTML 里 `<option value="sphere_head" selected>`） | 视图局部默认 |
| **工艺向导** | `'sphere_head'` | `js/views/wizard.js:365` `state.riserShape ?? 'sphere_head'` | 视图局部默认 |

### 2.3 已保存的形状会不会被切换入口覆盖【代码】

**不会。** 两条独立证据：

1. `js/views/riserView.js` 与 `js/views/wizard.js` **完全不 import `CastingProject`**（`grep "CastingProject"` 在两文件 0 命中）⇒ 它们既读不到也写不到 `process.riserShape`。
2. 替换/删除 STL 时的清理函数 `CastingProject.js:386-428`（`clearStlBoundData`）**清的是** `hotspots.*` / `hsPick` / `risers.items` / `riserHeight` / 几何与重量 —— **名单里没有 `riserShape`** ⇒ 用户选过的形状在换 STL 之后依然保留。

> ⚠ **但会产生"我的选择丢了"的错觉**：在设计中心选了圆柱 → 打开独立计算器，下拉显示球顶圆柱。两者是不同的状态，不是覆盖。S1 若要动这块，只需在文案上说明，无需改数据。

### 2.4 默认形状会不会影响结果【数据 —— 本机实测】

**方法**：直接调用冻结的 `calcs/riser.js`，用 `calcManifest.js:280` 的**实际入参**（`mc_mode:'direct'`、`hd_ratio:1.0`、`eff:undefined`）跑四形状。只读，未改任何文件。

**Mc = 10.3 mm**

| 形状 | D | H | H/D | Mr_act | Vr (cm³) | eff | **可补缩量 = Vr×eff** | 冒口颈 ⌀ |
|---|---|---|---|---|---|---|---|---|
| cyl | 75 | 75 | 1.000 | 12.500 | 331.3 | 14% | **46.4** | 41 |
| sphere_head | 75 | 75 | 1.000 | 12.500 | 276.1 | 25% | **69.0** | 41 |
| sphere | 75 | 75 | 1.000 | 12.500 | 220.9 | 20% | **44.2** | 41 |
| square | 75 | 75 | 1.000 | 12.500 | 421.9 | 14% | **59.1** | 41 |

**Mc = 25 mm**：同样四形状 D/H/Mr_act/冒口颈**全为 180/180/30.000/100**；可补缩量 641.3 / 954.3 / 610.7 / 816.5 cm³。

**结论**：

* **D、H、实际模数、冒口颈 —— 四形状完全相同**（原因：`hd=1` 时四种模数式全部化简为 `M = D/6`，145 轮已证）。
* **冒口体积差 1.91 倍**（331.3 / 276.1 / 220.9 / 421.9）。
* **可补缩量差 1.56 倍**（46.4 / 69.0 / 44.2 / 59.1），且 **sphere_head 最乐观**（最高）、**sphere 最低**。
* ⇒ 换默认形状**不改"冒口做多大"，只改"能补多少"**——而后者正是结果页「可补缩量」卡与旧体积模型对比的输入。

### 2.5 哪个默认值有更充分的项目依据【数据】

**`cyl` 依据充分得多 —— 它是一次有记载的显式产品决策。**

`docs/PHASE78_REPORT.md:86` 原文：

> **冒口形状默认值**：设计中心原硬编码 `sphere_head`（球顶圆柱，效率 25%）→ 按 78.txt 改为**圆柱形（效率 14%）**。同模数下两者直径相同（h/d=1 时 M=D/6 等价），但**补缩效率不同 → 体积校核与迭代倍率 f 不同 → 冒口体积更大**。下拉可一键切回。

（其中"迭代倍率 f"一节已因 P0-22 删除 f 迭代而成为历史；"效率不同 ⇒ 可补缩量不同"仍然成立，§2.4 已实测。）

`sphere_head` 只见于 `riserView.DEFAULTS` 与向导的 `??`，**未检索到任何决策记录**；它的历史地位来自更早的 `calcManifest` 硬编码 period——`docs/PHASE27_AUDIT_REPORT.md:55`、`docs/PHASE28_ISSUE_TRACKER.md:33`（P1-11）把它记为**缺陷**（"形状选择不生效"），后来才改成读项目值。

⚠ **一条既存的工程张力**【数据，**非本轮发现**】：`docs/CAMPBELL_VIEWS_EXTRACT.md:31,95` 已登记——Campbell 对**小型件用暗冒口**持谨慎态度（通气芯可靠性问题），而球顶圆柱正是暗冒口。该文档标注"低——仅文案层提示"。

### 2.6 建议处理方式

* **不改默认值**（`calcs/riser.js` 冻结；`CastingProject` 的默认属产品决策，本轮无权改）。
* S1 可做且低风险的：在形状下拉旁**显示该形状的补缩效率**（14/25/20/14%），让"换形状改的是可补缩量"这件事**可见**。数据全是现成的 `RISER_EFF`。
* **【需你决定】** 独立计算器 / 向导是否也统一到 `cyl`。（不统一也不产生覆盖问题，只是两处第一眼给出的"可补缩量"口径不同。）

---

## 3. 兜底 Mc 的真实路径

### 3.1 先回答"特别检查"【代码】

**问题**：方案里写的"主体壁厚 ÷ 2"，是不是当前代码的实际兜底规则？

**答案：是，但要加三个限定。**

`process.wallHot` 的**全部两个写入点**（`js/views/designCenter.js`）：

```js
// :1401-1404（writeHotspotsToProject，V3 采样后）
if (proj.get('process.wallHot').src !== SRC.USER_OVERRIDE
  && !(hs.status === HS_STATUS.OK && hs.hotspots.length > 0)) {
  proj.set('process.wallHot', parseFloat((br.bodyRef * scale / 2).toFixed(1)), SRC.DERIVED, CONF.MEDIUM);
}
// :1524-1525（writeGeometryToProject，导入 / 单位切换）
proj.set('process.wallHot', parseFloat((bodyWall * scale / 2).toFixed(1)), SRC.DERIVED, CONF.MEDIUM);
```

`br.bodyRef` / `bodyWall` 来自 `js/engine/v3/v3ViewAdapter.js:84-110`：`bodyWallOf`（在 `0.7×wallAvg ≤ wallMain ≤ 0.9×wallMax` 可信时取 `wallMain`，否则回退 `wallAvg`、再回退 `wallMax`）→ `bodyRef = max(bodyWallOf, tP50)`。

**三个限定**：

1. **"主体壁厚"= 可信主体壁厚链 `bodyRef`/`bodyWallOf`**，是**全局统计量**；不是热节处的局部壁厚，也不是热节区域 V/A 模数。
2. **有热结（`status=ok` 且有热结）时 `wallHot` 不更新**（`:1401` 的条件显式排除），停留在导入时的 `bodyWallOf/2`。此时 riser 走 `mcHotspot`，不受影响；但意味着 `wallHot` 与 `wallUsed` 可能来自链上不同的一环。
3. **用户改「主体壁厚 wallUsed」时 `wallHot` 不跟随** ⇒ 文案里的"主体壁厚 ÷ 2"数字可能与界面上用户改过的 `wallUsed` 对不上。

**⇒ 结论：`wallHot` 确实 = 可信主体壁厚 ÷ 2，且 `calcManifest` 在兜底支里直接把它当 Mc 用；但"兜底"只覆盖一种状态（见 §3.2）。**

### 3.2 ★ 状态 → 文案 → 实际计算的对照表【代码】

`hotspots.status` 的取值与引擎行为（`js/engine/v3/hotspotV3.js:39/51/78/236-243/262/274/287/410-418`）：

| `hotspots.status` | 引擎 `hotspots` | 项目 `hotspots.items` | **界面实际显示**（`mcSourceNote()`，`designCenter.js:834-843`） | **`calcManifest` 实际拿什么算** | 一致？ |
|---|---|---|---|---|---|
| `ok` | **非空** | 非空 | `来源：STL 热结检测（最大热结 H1）…` | `process.mcHotspot`（STL 值）+ **未确认警示** | ✅ |
| `NO_HOTSPOT` | **空** | **空** | `未检测到可靠热点：冒口按壁厚/结构参考值（主体壁厚 ÷ 2 = X mm）估算…` | `process.wallHot`（= 主体壁厚 ÷ 2） | ✅ **一致** |
| `LOW_CONFIDENCE` | **非空**（有候选） | **非空** | `来源：STL 热结检测（最大热结 H1）…` | **`return {blocked:true}`** —— 根本不计算 | ❌ **不一致** |
| `INSUFFICIENT_RESOLUTION` | **空** | **空** | `未检测到可靠热点：冒口按壁厚/结构参考值（主体壁厚 ÷ 2 = X mm）估算…` | **`return {blocked:true}`** —— 根本不计算 | ❌ **不一致** |
| `none`（无 STL / 已清空） | — | 空 | 同上（主体壁厚 ÷ 2） | `process.wallHot` | ⚠ 设计中心已无手动入口，实际不可达 |

**根因**：`mcSourceNote()` 的判据写的是 **`hotspots.items` 有没有**，而**不是 `hotspots.status`**：

```js
const items = proj.getV('hotspots.items') || [];
if (items.length) txt = tr('来源：STL 热结检测（最大热结 H1）…');
else txt = tr('未检测到可靠热点：冒口按壁厚/结构参考值（主体壁厚 ÷ 2 = {v} mm）估算…');
```

而 `hotspots.items` 在两个失败分支里**都**被写入（`designCenter.js:1386`，非 OK 分支无条件 `proj.set('hotspots.items', …)`），导致：

* **`LOW_CONFIDENCE`**（有候选 → items 非空）→ 文案说"来源：STL 热结检测（最大热结 H1）"，**暗示有一个被采用的最大热结**，实际上冒口被阻断；
* **`INSUFFICIENT_RESOLUTION`**（无候选 → items 空）→ 文案说"按主体壁厚 ÷ 2 估算"，**实际上冒口被阻断，压根没用 wallHot**。

**⇒ 给 S1 的硬约束**：写 UI 文案时**必须按 `hotspots.status` 分状态出文案**，五种状态给五条不同的话。**"没有可靠热点 ⇒ 主体壁厚 ÷ 2"这条不能作为通用文案**——它只在 `NO_HOTSPOT` 成立。

> 附带：`calcManifest.js:242` 有唯一的**人工放行**入口——用户显式填了 Mc（`userMc`）时，即使 `LOW_CONFIDENCE` / `INSUFFICIENT_RESOLUTION` 也放行，note 写成 `按用户确认的热节模数 Mc = X mm 计算（热结分析状态：LOW_CONFIDENCE）`。**这是设计内的行为，不是缺陷。**

### 3.3 五种情况逐一

#### 情况 1 · STL 没有检测到可靠热点【代码】

| 项 | 实际行为 |
|---|---|
| **Mc 来源** | 默认 `process.wallHot` ＝ 可信主体壁厚 ÷ 2（`DERIVED`）；用户若在参数窗改过 → `process.mcHotspot`（`USER_OVERRIDE`） |
| **计算路径** | · `NO_HOTSPOT` / `none` → 用 `wallHot`，附"（主体壁厚 ÷ 2）"说明<br>· `LOW_CONFIDENCE` / `INSUFFICIENT_RESOLUTION` → **`blocked`**（`calcManifest.js:243-246`），除非用户显式填了 Mc<br>· `geometry.geomStatus === 'INVALID'` → `isHardBlocked()` 恒 `BLOCK_AUTO_RECOMMEND`（数值照给但等级为硬阻断） |
| **界面显示** | 左栏概览「最大热结 Mc」显示 `wallHot`（`:1056,1083`）；参数窗 B 模块用 `mcSourceNote()`（**见 §3.2 的不一致**）；Page1「最大热节 Mc」显示"（无热结 → 冒口按主体壁厚/2 估算）"（`processPage1.js:125`） |
| **保存** | `hotspots.status/reason/items` = `STL_GEOMETRY_ANALYSIS`；`wallHot` = `DERIVED`；`risers.items` **仅在 `!r.blocked` 时写** |

#### 情况 2 · 检出热点、用户没手动输入 Mc【代码】

| 项 | 实际行为 |
|---|---|
| **Mc 来源** | `process.mcHotspot` ← `hs.hotspots[0].mc`（保留 1 位小数），仅当原 src 非 `USER_OVERRIDE`（`:1380-1381`） |
| **"H1 = 最大热结"成立** | 引擎先按 `peakModulus` 降序排序再编号（`hotspotV3.js:218,229`）✅ |
| **计算路径** | `calcManifest.js:247-255` → `mcSrc = STL_GEOMETRY_ANALYSIS` + 附 `AUTO_MC_NOTE`（**"未经确认的初步估算"**，V2.0-06A1 定的口径） |
| **界面显示** | 参数窗 Mc 输入框 = `mcHotspot` + "当前为**自动估计值，尚未验证适用于所有几何**"；结果页 page2 = `来源：STL 热结检测 Mc = X（热结 H1）—— 自动估计值，尚未验证适用于所有几何`（`resultsCenter.js:61`） |
| **保存** | `mcHotspot` = `STL_GEOMETRY_ANALYSIS`（`CONF.HIGH`）；`risers.items` 存 `mcSrc` |

#### 情况 3 · 用户手动修改 Mc【代码】

**3a 参数窗 B 模块改 `process.mcHotspot`（当前 R4 唯一入口）**

* 输入先进 `state.paramDraft`（不写项目），点「保存并重新分析」才 `proj.set()`；
* `proj.set` 的来源规则（`CastingProject.js:203-229`）：原 src 为自动 → 变 `USER_OVERRIDE` + `CONF.USER_CONFIRMED`，并**首次固化 `orig`**；
* 结果：`calcManifest` 走 `userMc` 分支 → `mcSrc = USER_OVERRIDE`，note = `按用户确认的热节模数 Mc = X mm 计算`；工程等级 → `WARNING_REVIEW`；结果页标「来源：**用户输入** Mc = X mm（未使用 STL 自动热结点）」。
* ⚠ **把值改回自动值再保存 ≠ 恢复自动语义**：草稿的"删除"判定是 `String(val) === String(proj.getV(path))`（`:779`），若原先是 `USER_OVERRIDE`，改回同一个数仍以 `USER_OVERRIDE` 写入，`orig` 不更新。

**3b 逐热结改 Mc —— 当前代码里没有这个入口**【代码】

* `hotspotPickHtml()`（`:846-863`）**只渲染复选框，没有 Mc 输入框**；
* `designCenter.js:107` 注释明示「✎ 改 Mc」小弹窗已在 146 轮删除；
* 但 `designCenter.js:1554` 的注释仍写「多热结的 Mc 逐项编辑在参数窗口 B 模块里」——**注释与实现不符（陈旧注释）**；
* i18n 里还残留 3 条相关词条（`en-US.js:1143,1149,1225`）。
* ⇒ 这**印证了 147 报告 §12.5 第 7 项"是否恢复逐热结 ✎ 改 Mc"的必要性**。

#### 情况 4 · 用户恢复自动值（↺）【代码】

**当前 R4 界面上做不到。**

* `restoreAutoValue()`（`CastingProject.js:232`）在 `js/` 中**只有定义、零调用**（全库命中仅测试文件）；
* `srcTagHtml()`（`processPage1.js:67-77`）**只产出一个 `<span>`，不含任何按钮**（已核：`grep button` = 0），只是把「↺ 可恢复」写进 `title` 悬浮提示，而 `en-US.js:1134,1289` 等处仍在承诺；
* 结果页的两个 ↺（`#dc_gtReset` / `#dc_rtReset`）是**内浇道/横浇道**的"置 0 = 用推荐"，**不走 `restoreAutoValue`，也不覆盖 Mc**。
* ⇒ **实际可达的"恢复"只有**：替换/重导 STL（`clearStlBoundData()` 把非 `USER_INPUT` 的 `mcHotspot`/`wallHot` 清 0 并 `dropOrig`），或手填与自动值相同的数（**src 仍是 `USER_OVERRIDE`**，语义不恢复）。

#### 情况 5 · 多热结分别设计（`process.hsPick`）【代码】

* **元素结构**：`{id, mc}`。`id` = 引擎 `hotspotId`（降序序号 1..n）；`mc` = 项目 `hotspots.items[].mc`，**已 round 到 0.1**（`designCenter.js:1375`）。
* **优先级（谁盖谁）**：`pickedHot` 非空时**恒盖过 `mcHotspot`**（`calcManifest.js:216-224` 在最前，且直接进 `USER_OVERRIDE` 分支）；逐热结各用各自的 `mc` 调 `runRiser`；**未勾选的热结不计算**。
* **主结果**：取 **`Mc` 最大者**（`:295`）—— 供 gating 的 Hp 与 `riserHeight` 回写使用。注意是"模数最大"不是"直径最大"。
* **逐项来源标注**：与检出值比较（`|p.mc − det| > 1e-9`）判定"用户改过"→ `USER_OVERRIDE`，否则 `STL_GEOMETRY_ANALYSIS`（`:290`）。
* ⚠ **两个入口写同一个参数、src 不一致**：左栏勾选写 `USER_INPUT`（`:1607`），参数窗勾选经草稿保存写 `USER_OVERRIDE`（`:881`）。

### 3.4 顺带查出的 5 处不一致（全部只读发现，未修）

| # | 不一致 | 位置 | 影响 |
|---|---|---|---|
| 1 | `mcSourceNote()` 判据用 `items.length` 而非 `status`（§3.2） | `designCenter.js:836-840` | **两处失败态下文案与实际计算不符** |
| 2 | ↺ 恢复在 UI 不可达，但 3 处文案承诺 | `processPage1.js:72` · `en-US.js:1134,1289` | 用户按文案找不到入口 |
| 3 | `hsPick` 双入口 src 不一致（`USER_INPUT` ↔ `USER_OVERRIDE`） | `:1607` ↔ `:881` | 来源徽章口径不统一 |
| 4 | 逐热结改 Mc 无 UI 入口，但注释称有 | `:1554` 注释 vs `:846-863` 实现 | 陈旧注释 |
| 5 | `status==='ok'` 分支不写 `reason`，旧失败原因可能残留 | `:1371-1387` | 有 NO_HOTSPOT 分支读项目 `reason`，理论上可读到陈旧值 |

另：`hotspotV3.js:240` 会产出 `reason: 'rejected'`（**裸字符串，不在 `HS_REASON` 枚举里**），`hsReasonText()` 与 `HS_NOTE` 都查不到该 key，显示会回落到"无热结"。**【代码】** 这条影响小但确实存在。

---

## 4. 三项问题各自的建议处理方式

| # | 问题 | 建议 | 归属 |
|---|---|---|---|
| 1 | **1.8** | **不写进产品，不写进指南**。S1 只做一件与它有关的事：在使用指南「结果怎么读 / 出品率怎么定」一节里，**按现有口径写清"预估值仅供参考、算铁液必须用本厂实测值"，并把 72~85% 明确标注为「铝合金 × 低压」**。企业确认 1.8 口径之前，不在任何界面出现该系数。 | 指南文案 |
| 2 | **冒口形状默认值** | **不改默认值**（`cyl` 是有记载的产品决策，`sphere_head` 是视图局部默认，二者不冲突）。S1 只加一条**可见性**：形状下拉旁显示该形状的补缩效率（`RISER_EFF` 现成）。独立计算器是否统一 → 交你决定。 | 显示层 |
| 3 | **兜底 Mc** | **S1 必须按 `hotspots.status` 分状态出文案**（§3.2 五条）。同时**恢复"逐热结改 Mc"入口**（147 §12.5 第 7 项已列）与**↺ 恢复自动值**（`restoreAutoValue` 已有实现，只需接一个按钮）——这两件都是"文案承诺了但界面没有"的欠账。 | 显示层（**不碰冻结计算链**） |

**三项共同点**：都**不需要改公式、默认值或冻结文件**，全部落在显示层与文案层 —— 与 147 方案「不把 UI 问题当算法问题修」的边界一致。

---

## 5. 进入 S1 前仍需你决定的事项

| # | 事项 | 我的建议 |
|---|---|---|
| 1 | **1.8 的口径定性**（真出品率 / 含工艺附件 / 本产品专用）—— 需要企业回答，不是技术问题 | 确定前：**产品与指南都不出现 1.8** |
| 2 | 独立计算器与向导的冒口形状默认是否统一到 `cyl` | **暂不统一**（不产生覆盖问题），但值得记入待办 |
| 3 | 是否恢复「✎ 改 Mc」逐热结入口 | **恢复**（147 已列，§3.3 情况 3b 再次印证） |
| 4 | 是否恢复「↺ 恢复自动原值」按钮（`restoreAutoValue` 已实现，零调用） | **恢复**，至少给 Mc / 壁厚 / 重量三个有 `orig` 的参数 |
| 5 | `LOW_CONFIDENCE` / `INSUFFICIENT_RESOLUTION` 两态的界面文案定稿（§3.2） | 五态五文案，S1 实施时逐条对 |
| 6 | `hotspots.reason = 'rejected'` 补进 `hsReasonText` / `HS_NOTE`（现在的回落文案是"无热结"，不准确） | **补**，纯文案 |

---

## 6. 本轮零改动核对

```
git status --porcelain | wc -l   →  100   （基線 98 + 147 轮的 2 份设计报告；本轮再加本文件 = 101）
git status --porcelain 去掉本轮与上轮报告后的 md5  →  436e3aba0e0d24496b73eb1e56b4e7b1  ← 与开工时逐位一致
git rev-parse --short HEAD       →  da1c822 （未变）
```

* **未修改**任何产品代码、测试代码、计算公式、默认值；`js/engine/**`、`calcs/riser.js`、`calcs/calcManifest.js`、`calcs/riserDreq.js` **一字未动**。
* **未执行** `git reset` / `checkout` / `clean` / `stash`；**未提交 / 未推送 / 未发布**。
* **未运行**与本轮无关的全面回归测试。
* 本轮做过的**唯一计算**：用只读探针调用冻结的 `calcs/riser.js`（§2.4 的四形状对照），探针文件建在系统临时目录、**已删除**，未落入仓库。
* 临时产物：无（均已清理）。

---

## 附录 · 引用到的既有报告（复用，未重做）

| 报告 | 复用内容 |
|---|---|
| `docs/PHASE_V2.0-P2_LOWPRESSURE_ANALYSIS.md` | `1.8` 的表格复算、证据状态、72~85% 冲突量化（§2.3 / §3 / §4.3） |
| `docs/PHASE78_REPORT.md:86` | 冒口形状默认值从 `sphere_head` 改为 `cyl` 的决策原文 |
| `docs/PHASE28_2/28_3/28_4/28_5` | `wallHot` 与 `mcHotspot` 的拆分决策、`wallHot` 不作无条件兜底的定案 |
| `docs/CAMPBELL_VIEWS_EXTRACT.md:31,95` | 暗冒口与 Campbell 建议的既存张力（A7） |
| `docs/HANDOFF_2026-10-07.md:73,335,473` | 两个系数"确实找不到出处"的记录 |
