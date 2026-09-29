# Casting Toolbox — Product Hunt Launch

> 本文件由项目实际代码核查后生成（2026-09-16）。
> 所有功能描述均来自当前 v1.0.0 代码、README、GitHub Release 与实际运行界面，
> **没有虚构用户数、下载量、客户、合作、媒体报道或精度指标**。
> 括号中标 `【需你确认】` 的地方是我无法从项目里得到答案的信息。

---

## 项目核查结果（写文案前先看这个）

| 核查项 | 实际结果 |
|---|---|
| 版本 | v1.0.0（`js/version.js` 唯一来源，与 package.json 一致） |
| 仓库 | `github.com/thezhazhe/CastingToolbox`，public，MIT |
| Release | v1.0.0，2026-09-10 发布；两个产物：`CastingToolbox-v1.0.0-win64.zip`(35.6MB)、`CastingToolbox-v1.0.0.apk`(1.17MB) |
| **网页版** | **已经在线可用**：https://thezhazhe.github.io/CastingToolbox/ （GitHub Pages，实测首页/计算器/设计中心/中英切换全部正常） |
| 计算器 | 代码实测 **15 个**，分 6 组（注册表 `calcs/registry.js`：gating / campbell_gating / vertical_gating / riser / chill / shakeout / shrinkage / machining / ct / castability / sandbox / charge / yield / defect_finder / principles） |
| 知识库 | `data/index.js` 实测 **172 条**（materials 26 / defects 30 / process 44 / rawmaterials 25 / equipment 15 / rules 10 / campbell 8 / disa 14） |
| STL 设计中心 | 实测可导入 20MB STL → 识别 1 处热节 Mc 18.2mm → 3D 标记 H1 → 跑工艺分析 → 三页结果（结构工艺性 / 冒口 / 浇注） |
| 双语 | 中/英切换实测可用；**但只有部分界面翻全**（见下方"必须先决定的一件事"） |
| 平台 | Windows 便携 exe / Android APK / 浏览器。**Android 作者未做真机验收**（Release 里已如实标注） |
| 许可 | MIT；禁止打包进商业产品转售牟利；必须保留署名 |
| 作者 | 感谢每一天的生活 · 320451242@QQ.COM · THEZHAZHE@gmail.com · QQ 群 1106396422 |
| 仓库数据 | Star 1 / Fork 0（**不要写进文案**，这不是卖点） |

### ⚠️ 必须先决定的一件事（影响整个发布）

**英文界面有中文残留，而且分布不均。** 我跑了 18 个页面逐字扫描，实测：

| 界面 | 英文模式下残留中文 |
|---|---|
| 首页 / 计算工具列表 / 冒口设计 / **整个设计中心** | **0 字，完全英文** ✅ |
| 浇注系统 | 194 字（工程原则提示条） |
| 出品率 / 加工余量 / 线收缩率 / 3D砂型 | 240~410 字 |
| 冷铁计算 / 开箱时间 / 尺寸公差 CT / 熔炼加料 | 850~950 字 |
| 结构工艺性 / Campbell 速算 / 垂直造型线 | 1140~1770 字 |
| 缺陷查找 / **铸造原则十规则** | 1790 / 3090 字（内容本身就是中文） |
| **合计** | **1222 处 / 14432 字** |

这不是 bug，是 PHASE 72 定下的覆盖边界（"知识库 / 长正文 / 导出报告留中文"）。
但它决定了 Product Hunt 的成败：

- PH 访客是**全球**用户，点进计算器看到半中半英会直接离开；
- 而且 PH 没有"铸造/制造"分类，来的人大多不是铸造工程师——他们更需要一个**一眼看懂**的产品。

**三个选择，按推荐度排序：**

1. **只主推已全英文的部分**（首页 / 15 个工具列表 / 冒口设计 / 设计中心全链）——这四个正好就是产品最有说服力的部分。文案与截图全部围绕它们，其余工具在描述里照实说"部分深度内容为中文优先"。**成本 0，今天就能发。**
2. 发布前把 9 个重中文计算器的界面文案翻掉（纯词条表补充，不动公式）。这是几小时的活，但要改代码。
3. 先发，把英文补全作为 v1.1 的公开路线图，在 First Comment 里主动说明。

**我建议选 1，同时在 First Comment 里主动提一句"部分深度知识内容还是中文优先"**——主动说明比被用户发现要好。

### ⚠️ 第二件事：网页版知识库慢

网页版（GitHub Pages）上，**172 个知识库 JSON 是串行加载的，实测 67 秒**。
受影响：首页搜索下拉、缺陷查找、工艺向导。计算器与设计中心不受影响。
本地 0.4 秒，所以开发时没发现。

修复已经写好在本地（`js/search.js` 并发化 + `js/app.js` 首屏后预取，模拟线上条件实测 67s → 用户无感），**但还没发布到线上**。
Product Hunt 一定会有人点"网页版试试"——**建议发布 PH 之前先把这两个文件推上去**。

---

## Product Name

**Casting Toolbox**（推荐，保持现名）

理由：短、准确、国际用户一眼看懂，且已经是仓库名 / exe 名 / APK 名，改名要动一堆地方，收益为零。

备用名（不推荐，仅备用）：
1. **Foundry Kit** — 更短，但 "foundry" 对非铸造人群比 "casting" 更陌生
2. **Casting Calc** — 直白，但丢掉了"工具箱"的广度感

> 注意：Product Hunt 产品名上限 **40 字符**，"Casting Toolbox" = 15 字符，没问题。

---

## Tagline

Product Hunt 标签语**硬上限 60 字符**（含空格）。以下 5 个全部实测合规：

| # | Tagline | 字符数 |
|---|---|---|
| 1 | Casting process calculations, without the spreadsheet | 53 |
| 2 | Riser, gating and yield design for foundry engineers | 52 |
| 3 | An offline toolbox for casting process engineers | 48 |
| 4 | Foundry calculations: riser, gating, yield. Offline, free. | 58 |
| 5 | The casting engineer's toolbox. Free, offline, open source. | 59 |

### 最推荐：#1 — "Casting process calculations, without the spreadsheet"

**为什么是它：**

- **对铸造工程师**：一眼就懂——"这就是我每天在 Excel 里做的事"。
- **对非铸造的 PH 用户**（占绝大多数）：也懂。它讲的是一个所有人都能共情的处境——重复的表格劳动。
- **它同时是定位**。你自己说的 `Excel ← Casting Toolbox → MAGMA`，这一句就是那个箭头。
- 没有形容词、没有 "AI-powered"、没有 "revolutionary"。符合你"不当广告口号"的要求。
- 53 字符，留了余量。

**备选场景**：如果你更想被铸造行业内的人精准搜到，用 **#2**——它把 riser/gating/yield 三个词摆出来，工程师搜得到，但普通人看不懂。

---

## Short Description

用于产品卡片 / 一句话介绍 / 社媒简介：

> Free, open-source calculators and STL analysis for casting process engineers. Runs offline in your browser — no account, no upload.

---

## 260 Character Description

Product Hunt 描述框历史上限 **260 字符**（2025 年有消息说放宽到 500，但**发布当天请在页面上确认**；以下两版都控制在 260 以内，无论哪个限制都安全）。

### 推荐版

```
Free, open-source calculators for casting process engineers: riser design, gating, yield, shrinkage, machining allowance and STL hotspot analysis. Runs fully offline in your browser. No account, no upload, no data leaves your machine.
```

**Character count: 234**

### 备用版（更强调"不替代仿真"）

```
Casting Toolbox is a free, open-source toolbox for casting engineers: riser design, gating, yield, shrinkage and machining allowance, plus STL hotspot and wall-thickness analysis. Runs offline in your browser. No account, no upload.
```

**Character count: 232**

---

## Full Description

Product Hunt 产品页正文。**英文，按你要求的结构。**

---

### What is Casting Toolbox?

Casting Toolbox is a free, open-source toolkit for casting process engineering. It collects the calculations a foundry engineer runs every day — pouring time, choke area, riser size, yield, shrinkage, machining allowance — into one place, and adds an STL analysis step so the part geometry feeds into them.

It is **not** a CAE package. There is no finite element solver, no CFD, no automatic design. It is the layer between a spreadsheet and a simulation package: fast enough to use on every job, structured enough that you can trace where every number came from.

### What can it do?

**15 calculators, grouped by process flow.**

*Pouring*
- **Gating System Design** — Dietert pouring time, Osann choke area, sprue / runner / ingate sizing, vent area, velocity and venting checks
- **Campbell Gating Quick-Calc** — minimal input (material / weight / wall thickness / ingate count) → 1:1:n basis, with the velocity evidence graded and labelled
- **Vertical Molding Line Gating** — DISA manual method for small castings; pressurised / non-pressurised / mixed systems, each mould layer calculated on its own effective head

*Feeding & solidification*
- **Riser Design** — hotspot modulus Mc, riser shape library, feeding efficiency, riser neck, auto-iterated until both modulus and volume pass
- **Chill Calculation** — external / internal chill sizing, failure warnings, placement rules
- **Shakeout Time** — in-mould cooling range and shakeout temperature target

*Dimensions & machining*
- **Linear Shrinkage** — per-direction recommendation and pattern allowance
- **Machining Allowance** — GB/T 42124.3-2025 lookup, top-face grading
- **Dimensional Tolerance CT** — CT / DCTG 1–16 lookup, cross-checked against ISO 8062-3:2023 Table 7

*Structure & moulding*
- **Castability** — minimum wall, critical wall, fillets, draft angle, minimum cored hole, by material / size / batch
- **3D Sand Mold Clearance** — clearance and minimum mould wall for 3D-printed sand moulds

*Melting & economics*
- **Charge Makeup** — grade → automatic charge mix → live composition balance → makeup suggestions
- **Casting Yield** — estimated yield range, then measured yield → liquid metal weight per part and per mould

*Method & diagnosis*
- **Defect Finder** — search by defect name, shop-floor alias or symptom; GB/T 5611 eight categories, features, causes, remedies
- **Casting Principles** — Campbell's ten rules across the four stages of liquid metal quality, filling, solidification and cooling

**STL Process Design Center**

Import a casting and the tool walks the process chain with you: geometry analysis (envelope, volume, surface area, weight, wall thickness) → castability → riser design → gating system → yield / shrinkage / machining allowance.

- Hotspots are detected from the mesh, marked in the 3D view and linked both ways with the hotspot list.
- **Every automatic value carries a source badge** — STL-derived, user input, calculated, or user override. Overriding an automatic value keeps the original and offers one-click restore.
- No STL? A manual input mode runs the same calculators.
- When the analysis cannot produce a reliable result, the tool says so and **blocks the automatic recommendation instead of guessing**.

**172 reference cards**

Materials, raw materials, moulding sand, process and charge, defects, equipment. Each card keeps its source (book / chapter) and a confidence level.

**Runs anywhere, talks to nothing**

Windows portable executable, Android APK, or any modern browser. All calculations run locally. No account, no sign-up, no telemetry, no upload — it works with the network cable unplugged. Chinese and English UI.

### Why I built it

I'm a casting engineer. I don't have a software background.

Most of what fills my working day is process design: how long to pour, how big the choke is, how large the riser needs to be, what yield to expect. None of it is especially difficult. It is repetitive. For years that work lived in spreadsheets I kept rebuilding and in books I kept digging through.

At some point I started using AI to write code. I can't write software, but I can describe exactly what a foundry engineer needs and I can tell when an answer is wrong. That turned out to be enough to build this.

Casting Toolbox is what came out of it. It is the tool I wanted to have.

### Who is it for?

- Casting and foundry engineers doing process design
- Process engineers who need a starting number before committing to a simulation
- Engineering students and people learning casting
- Anyone who currently keeps these calculations in a spreadsheet

I'm not going to quote a user number, because I don't have a meaningful one to quote. It's a new release.

### What it is NOT

- **Not a replacement for MAGMA, ProCAST or any CAE package.** It does not simulate solidification or flow. Use it before the simulation, not instead of it.
- **Not a full casting simulation platform**, and not trying to become one.
- **Engineering judgment and plant data are still required.** Several values — yield ranges, feeding efficiencies, neck coefficients, some castability numbers — are industry experience values, not standard-mandated figures, and they are labelled that way in the UI.
- **The STL analysis has real limits.** Wall-thickness and hotspot detection are mesh-sampling based; thin features, complex geometry and very large models can fall outside the sampling resolution. The tool reports when that happens, but the limit is real.
- **Final process decisions need verification** against your own pattern design, melting practice and measured production data. First-article trials always override the built-in reference values.

### Key principles

- **Free** — MIT licensed. Factories and individuals can use it in production without restriction.
- **Open source** — read it, check the formulas, fork it, send fixes.
- **No registration, no account, no email.**
- **No data upload** — nothing leaves your machine. There is no server.
- **Offline capable** — the Windows build and the Android build never touch the network.
- **Practical over clever** — it solves the 20% of problems that come up 80% of the time and says so when it can't.

---

## First Comment

发布后立刻贴（Product Hunt 建议 5 分钟内）。语气是 Maker 本人在说话，不是新闻稿。

```
Hey Product Hunt 👋

I'm a casting engineer, not a software developer.

My working day is casting process design — how long to pour, how big the choke is, how large the riser needs to be, what yield to expect. None of it is hard. All of it is repetitive. For years that lived in spreadsheets I kept rebuilding, and in reference books I kept digging through.

At some point I started using AI to write code. I can't write software, but I can describe exactly what a foundry engineer needs, and I can tell when an answer is wrong. That turned out to be enough.

Casting Toolbox is what came out of it: 15 calculators for the calculations I actually do, a 172-card reference library with sources attached, and an STL design centre that reads a casting and finds the hotspots.

A few things I deliberately did NOT do:

— It does not simulate anything. It is not a MAGMA or ProCAST replacement, and I'd rather it not be sold as one. It sits between Excel and the simulation package.
— It does not guess. When the mesh analysis can't give a reliable answer, it blocks the recommendation and says why, instead of printing a number you'd trust too much.
— It does not phone home. No account, no upload, no telemetry. Unplug the network and it still works.

Two honest caveats:

1. The core UI is bilingual (Chinese / English). The deeper reference content is still Chinese-first — I'm working through it.
2. The Android build is signed and statically checked, but I have not been able to test it on a real device yet. Please tell me if it misbehaves.

If you work in a foundry, I'd genuinely like you to try it and tell me where the numbers are wrong. That's the feedback that's actually useful to me — a wrong formula is worth more to me than a compliment.

Links: GitHub is in the maker comment above, and you can try the web version without downloading anything.
```

---

## Maker Bio

Product Hunt 的 bio 会显示在你名字旁边。**不虚构学历、公司、职位、成就。**

### 极简版

```
Casting engineer. Building small tools that remove repetitive work from foundry process design.
```

### 正常版

```
Casting engineer working in foundry process design. I build the tools I wished I had — with a lot of help from AI, since I'm not a software developer. Author of Casting Toolbox, a free and open-source casting engineering toolkit.
```

### 故事感版

```
I'm a casting engineer. Most of my day is the same calculations over and over — pouring time, riser size, yield. I'm not a programmer, so for years that meant spreadsheets.

Then I started using AI to write code. I could describe what a foundry engineer needs, and I could tell when the result was wrong. That was enough to build Casting Toolbox: a free, open-source toolkit that now does the repetitive part for me.

It's the tool I wanted to have.
```

**给 Product Hunt 的显示名建议**：GitHub 账号是 `thezhazhe`。当前应用内显示的作者名是中文"感谢每一天的生活"，会出现在英文界面的侧栏里。面向全球发布，建议另起一个拉丁字母显示名（如 `thezhazhe`）**只用于 Product Hunt 与英文界面**，中文渠道保留原名——**是否要做、用什么名字，由你定。** `【需你确认】`

---

## Screenshots

Product Hunt：**最多 8 张，推荐 1270×760**，第一张是信息流里的缩略图。

**结论先行：现有 `screenshots/` 目录里的图基本都不能直接用**——绝大多数是中文界面，而且 `00_首页.png` 里侧栏还写着 **v0.9**（旧 UI：5 个导航项、没有语言切换、没有 STL 设计中心）。用在 v1.0.0 的发布页上会自相矛盾。

### ✅ 已经做好了：直接上传这 6 张

我用当前代码 + **强制英文界面**重新拍了整套图，**已按 Product Hunt 的规格裁好**，放在：

```
D:\CDXProject\_ph_upload\
```

- **画廊图**：`01`~`06` 的 `.png` = **1270×760**（PH 官方推荐尺寸，直接传这个）
- 带 `@2x` 后缀的是同图的 2540×1520 版本，想要更清晰可以传这个（宽高比相同）
- **缩略图**：`00_thumbnail_240.png`（240×240，PH 官方要求）
- 已裁掉左侧栏 —— 顺带把中文作者名和 QQ 群号也去掉了
- `_discarded/` 里是不要用的（见下方说明）

**上传顺序（PH 里第一张是信息流缩略图，最重要）：**

| 顺序 | 文件 | 画面 |
|---|---|---|
| 1 | `01_dc_hotspot.png` | 3D 视图 + H1 热节标记 + "Mc = 18.2 mm" |
| 2 | `02_dc_riser_results.png` | 工艺分析结果 · 冒口页（ø137、模数/体积双校核通过） |
| 3 | `03_calculators.png` | 15 个计算器 / 6 组 |
| 4 | `04_riser_sources.png` | 冒口校核结论 + DATA SOURCES 出处 |
| 5 | `06_home.png` | 首页（搜索 + 生产场景） |
| 6 | `07_dc_params.png` | 参数区 + 浇注方向示意图 |

以下逐张说明（编号沿用上面的顺序）。

---

### 1. `01_dc_hotspot.png` — STL 设计中心 + 3D 热节标记 ★ 首图

- **截什么**：设计中心导入后的状态，深色 3D 视图里红色 **H1** 热节标记，上方是模型摘要条（500×500×120 mm / 8955.2 cm³ / 62.69 kg / 壁厚 24 mm / **Mc 18.2 mm** / 1 hotspot）
- **突出什么**：**这是一张图讲完产品**——真 3D、真数字、真的找出了问题。深色 3D 图在 PH 信息流里辨识度最高。
- **英文标题**：`Import a casting, find the hotspots`
- **英文说明**：`Drop in an STL. Casting Toolbox reads the geometry, estimates wall thickness, and marks the feeding hotspots in 3D — linked both ways with the hotspot list.`
- **要额外制作吗**：不用，已生成。

### 2. `02_dc_riser_results.png` — 工艺分析结果 · 冒口页 ★ 第二张

- **截什么**：结果页 "② Riser Design" 页签：热节 Mc 18.2 mm → 冒口 ø137 × 137，补缩效率 14%，实际模数 22.83 mm（须 ≥ 要求模数 22.75 mm ✅），体积校核 sufficient ✅，冒口颈 ø73，迭代系数 1.25 × Mc
- **突出什么**：**"它真的能算，而且算完还自己校核"**。底部那条 Campbell T 字交叉的英文提示，是"这东西读过书"的证据。
- **英文标题**：`Riser design, checked twice`
- **英文说明**：`Hotspot modulus in, riser size out — auto-iterated until both the modulus check and the volume check pass.`
- **要额外制作吗**：不用，已生成。

### 3. `03_calculators.png` — 15 个计算器 / 6 组

- **截什么**：计算工具列表页，六组分类标题 + 工具卡片
- **突出什么**：**广度**。一屏说明"这不是一个小脚本，是成套工具"。全部英文，干净。
- **英文标题**：`15 calculators, grouped by process flow`
- **英文说明**：`From pouring to feeding, dimensions, moulding, melting and defect diagnosis — the calculations a foundry engineer runs every day.`
- **要额外制作吗**：不用，已生成。

### 4. `04_riser_sources.png` — 冒口计算结果 + DATA SOURCES

- **截什么**：冒口计算器底部的校核结论（模数 ✅ / 体积 ✅ / 推荐 ø79×H79 R40）+ **DATA SOURCES 区块**
- **突出什么**：**可信度**。DATA SOURCES 里明写了补缩效率出自 Casting Handbook Vol.5、收缩率 3.0% 按 Campbell、冒口颈系数引自 ASM/Karsay——这一张是给"凭什么信你的数"这个问题准备的。
- **英文标题**：`Every number shows where it came from`
- **英文说明**：`Feeding efficiency, contraction and neck coefficients are sourced and labelled. Where a value is an industry reference rather than a standard, the tool says so.`
- **要额外制作吗**：不用，已生成。

### ~~5. 浇注系统设计结果~~ —— 已放弃，不放进图廊

原本想放一张浇注系统计算器的结果图（它在中文里是最"经典"的一个）。**试拍后放弃了**：那个页面的结果区里**交织着三条中文**——两条"工程原则"提示条（横浇道平稳过渡、直浇道锥度）和一条流速警示（"内浇口平均流速 1.47 > 1 m/s（目标 1）偏高"）。它们夹在流道尺寸和结论框中间，**不是换个取景能避开的**，裁哪一块都会留一条。

留 6 张干净的，比放 7 张、其中一张半中半英要好。

> 这也顺带说明了一件事：**修英文覆盖的时候，浇注系统的"工程原则"提示条是优先级最高的**——它正好出现在最常用的计算器里。

（已拍的废图在 `_ph_upload/_discarded/`，别传。）

### 5. `06_home.png` — 首页

- **截什么**：首页大搜索框 + Production Scenario 四联下拉
- **突出什么**：**入口简单**。搜索框文案 "Search materials, defects, standards, formulas, tools…" 一句话说明知识库的存在。
- **英文标题**：`Search across the whole toolbox`
- **英文说明**：`Materials, defects, standards, formulas and calculators — all indexed locally, all offline.`
- **要额外制作吗**：不用，已生成。

### 6. `07_dc_params.png` — 参数区 + 来源徽章 + 浇注方向示意图

- **截什么**：Process Parameters & Conditions 区，四色来源徽章图例（🟢 STL detection / 🟡 user input / 🔵 calculated / 🟠 user override），以及中注浇注方向示意图
- **突出什么**：**可追溯性**——这是整个产品最"工程"的一个设计决定，别的工具不这么做。
- **英文标题**：`No black boxes`
- **英文说明**：`Every automatic value is tagged with its source — STL-derived, your input, calculated, or your override. Override one and the original is kept, one click to restore.`
- **要额外制作吗**：不用，已生成。

---

### 关于演示模型：一件你要知道的事

图里用的模型是 `tests/engineering-generated/models/t01_boss100`（500×500 板 + 200×200×100 凸台），仓库里自带的工程测试件。

**这些程序生成的测试件网格都不完美**，导入后界面会弹一条几何警告。我实测了 5 个：

| 模型 | 警告 |
|---|---|
| t01_boss100 | 1400 处缠绕方向不一致 |
| t08_pipeFlange70 | 770 处缠绕方向不一致 |
| t19_valveLike | 864 个退化三角形 |
| t11_edgeThick80 | 21846 个退化三角形 |
| t03_twoDiff_60_100 | 1241 处缠绕方向不一致 |

**这是测试件本身的问题，不是软件的问题**——真实的 CAD 导出件通常不会有。而且这条警告本身就是产品设计的一部分（"分析不可靠时如实说明，而不是编一个数"）。

我处理的方式是**把它挤出画面外**（调整取景，不是隐藏元素）：
- 图 1 只框住"1 hotspots detected · Mc 18.2 mm"这一条 + 3D 视图，警告条在画面之上；
- 图 2 框在结果页，警告条在画面之下。

**但你录 Demo 视频时藏不掉**——滚动过程中那条中文警告会露出来。两个选择：

1. **录视频时避开设计中心顶部**，直接从 3D 视图开始录（**推荐**，最简单）；
2. 或者从你的真实产品件里挑一个**网格干净、且不含敏感几何**的 STL 当演示件（最理想，但需要你判断哪个能公开）。

> 顺带一提：这也意味着**"几何警告"那几行是英文覆盖里第二优先要修的**——它出现在设计中心第一屏，海外用户第一次导入文件就会看到。

### 不建议放的

- 捐助页 / 关于弹窗 / 知识库列表页 —— 信息量低，占位置。
- 手机截图（`16~19_手机*.png`，750×1334）—— 是 8 月的旧 UI，且竖图在 PH 图廊里显示很小。

---

## Demo Video

**目标**：让完全不懂铸造的海外用户，在 45 秒内明白"这是一个铸造工程师真的在用的工具，而且它真的能跑"。
**做法**：纯录屏，不加动画、不加转场特效、不加背景音乐（PH 默认静音自动播放，**所有信息必须靠画面和字幕**）。

### 录制前准备

1. 浏览器窗口设成 1440×900，语言切到 **English**
2. 提前把 `tests/engineering-generated/models/t01_boss100/model.stl` 放在好找的位置
3. 录之前**先跑一遍全流程**，让知识库预取完成，避免录到等待
4. **全程不出现中文界面**——按上面的"必须先决定的一件事"，只录全英文的四个部分

### 分镜脚本（总长约 47 秒）

| 时间 | 画面 | 屏幕字幕（英文，大字号） |
|---|---|---|
| 0–4s | 首页，鼠标轻扫过搜索框 | `Casting Toolbox`<br>`Free · open source · offline` |
| 4–12s | 点 Calculators → 15 张工具卡一屏，向下慢滚一半 | `15 calculators for daily foundry work` |
| 12–20s | 打开 **Riser Design**，把 Material 选成 Ductile iron，结果区数字跳动 | `Change an input — results recalculate` |
| 20–26s | 滚到 DATA SOURCES 区块，停 2 秒 | `Every number is sourced` |
| 26–32s | 切到 Process Design Center，拖入 STL（显示导入进度） | `Or import the casting itself` |
| 32–40s | 3D 出现，热节红点标出 H1，鼠标点热节列表 → 3D 高亮（双向联动） | `Hotspots found and marked in 3D` |
| 40–45s | 点 Run Process Analysis → 结果三页签依次点过 | `Full process chain: riser → gating → yield` |
| 45–47s | 停在结果页，淡出到纯色底 | `Free · Open Source · No Registration`<br>`github.com/thezhazhe/CastingToolbox` |

### 录制要点

- **不要加速播放**。铸造工程师看的是"这软件反应快不快"，加速会显得假。
- 导入 20MB STL 大约 1~6 秒，**这一段保留真实速度**，它是可信度的一部分。
- 字幕放在画面下方 1/4 处，避开侧栏。
- ⚠️ **Product Hunt 的视频字段只接受 YouTube 链接**（不接受直接上传 MP4，也不接受 GIF）。所以流程是：
  1. 按上面脚本录屏 → 剪成 45~50 秒 → 导出 1080p MP4；
  2. **上传到你自己的 YouTube 频道**；
  3. 可见性设为 **Public（公开）**——设成"不公开列出"PH 那边可能播不了；
  4. 把 YouTube 链接填进 PH 的视频字段。
- 视频标题和简介直接用本文档的 Tagline 和 Short Description，**记得在简介里放 GitHub 链接**（YouTube 来的流量也会转到仓库）。

---

## Topics

⚠️ **Topic 能选的数量有限**——公开资料里"最多 3 个"和"3~5 个"两种说法都有，**以提交页面上实际能选几个为准**。所以下面按优先级排了序，从前往后选，能选 3 个就选前 3 个。
（说明：producthunt.com 在我这边被网络策略拦截，无法直接读取实时分类表；以下是基于公开资料的判断，**发布当天请在页面上以实际可选项为准**。）

### 推荐选择（按顺序）

| 顺序 | Topic | 为什么 |
|---|---|---|
| 1 | **Open Source** | 事实成立，且是 PH 增长最快的分类之一。这个分类的用户真的会去点 GitHub 链接、真的会提 issue——是你要的人群。 |
| 2 | **3D Modeling** | 事实成立：STL 导入 + 3D 视图 + 网格分析是产品的核心能力之一。这是最接近"工程/几何"的可用分类。 |
| 3 | **Productivity** | 事实成立：产品定位就是"减少重复劳动"。分类宽泛，但确实相关，不算蹭流量。 |

### 明确不选

- **Developer Tools / Software Engineering** —— 增长快、流量大，但那是"给程序员写代码用的工具"。选它是明显不相关，违背你"不为流量选不相关分类"的要求。
- **Artificial Intelligence** —— **不选**。AI 是开发这个故事的一部分，不是产品的运行时功能。选它属于虚假陈述。
- **Android** —— 事实成立（确实有 APK），但它会把产品标签成手机 App，而产品主体是桌面/浏览器。**如果你更想强调移动端，可以用它换掉 Productivity。**

### 我的取舍建议

固定选 **Open Source + 3D Modeling**，第三个在 **Productivity** 和 **Android** 之间二选一。我倾向 Productivity——因为 PH 没有"制造/铸造"分类，来的人大多不是工程师，Productivity 能帮他们理解"这东西帮我省事"，而 Android 只会让他们以为这是个手机软件。

---

## 上传步骤（照做）

### ⚠️ 先看这一条：你刚注册的账号，多半还不能发

Product Hunt 的规则是：**必须用个人账号**（公司账号不能发帖、不能投票、不能评论），而且**新注册的账号通常要等大约一周才能发帖**，并且要先走完新手引导（onboarding）。

所以你现在该做的是：

1. **先去把账号"养"几天**。每天上去给几个你真心觉得不错的产品投一票、留一两句真实的评论（不是"nice"，是具体意见）。这不是刷数据，是让账号看起来像个真人——新账号的票会被系统打折，而且容易触发风控。
2. 同时确认右上角 **Post / Submit** 按钮是不是已经可用。能用 = 可以发了；不能用 = 再等几天。
3. **等待这几天正好用来**：① 录 Demo 视频传 YouTube、② 更新 GitHub 仓库描述和 Homepage、③ 决定英文中文残留怎么处理、④ 决定要不要先推网页版那个修复。

**不要**为了早发就去买 Hunter、找人代发或买票——PH 的规则里这是明确禁止的，会导致产品被下架。

### 提交那天的操作

| 步骤 | 具体动作 |
|---|---|
| 1 | 登录你的 **个人账号**（不是公司页），点右上角 **Post**（或 Submit） |
| 2 | 在输入框里填产品网址。填 `https://thezhazhe.github.io/CastingToolbox/` —— PH 会去抓取标题和图标 |
| 3 | 依次填下面表格里的字段。**Gallery 和 Thumbnail 从 `D:\CDXProject\_ph_upload\` 里拖进去** |
| 4 | **First Comment 先写好放在剪贴板**（本文档「First Comment」那一段），发布后 5 分钟内贴 |
| 5 | 选择 **Schedule（排期）**，不要直接发。PH 是太平洋时间 **00:01** 开当天的榜，**提前 24 小时以上排期**，选周二/周三/周四 |
| 6 | 如果当天还没准备好，选 **Create draft（存草稿）**，别硬发 |

**关于排期时间**：PH 的一天按太平洋时间（PST/PDT）算，12:01 AM PT 上线的帖子能吃到完整 24 小时窗口。换算成北京时间大约是**下午 3~4 点**（夏令时 15:01 / 冬令时 16:01）。你不用熬夜。

**如果 Post 按钮还不能用**：说明账号还没过等待期，先存草稿，过几天再排期。素材都在这里，不会跑。

---

## Product Hunt Submission Checklist

按 PH 表单顺序，"复制 → 粘贴 → 下一步"。

| # | 字段 | 填什么 |
|---|---|---|
| 1 | **Product name** | `Casting Toolbox` |
| 2 | **Tagline** | `Casting process calculations, without the spreadsheet` （53 字符） |
| 3 | **Link / Website** | `https://thezhazhe.github.io/CastingToolbox/` ← 网页版，点开即用，转化最高<br>（备选：GitHub 仓库地址 `https://github.com/thezhazhe/CastingToolbox`） |
| 4 | **Description** | 用本文档「260 Character Description」推荐版（234 字符） |
| 5 | **Topics** | `Open Source` → `3D Modeling` → `Productivity`  【我自己选择：第三个可用 Android 替换】 |
| 6 | **Gallery** | 上传 `D:\CDXProject\_ph_upload\` 下的 **6 张**（`01_dc_hotspot.png` → `02_dc_riser_results.png` → `03_calculators.png` → `04_riser_sources.png` → `06_home.png` → `07_dc_params.png`）。**别传 `@2x` 和 `_discarded/`** |
| 7 | **Thumbnail** | `D:\CDXProject\_ph_upload\00_thumbnail_240.png`（已经是 240×240，直接传） |
| 8 | **Video** | YouTube 链接（可选，但强烈建议——PH 页面上会自动播放，转化明显更好）。**必须是 YouTube，不能直接传 MP4** |
| 9 | **Pricing** | `Free` |
| 10 | **Platforms** | `Web` · `Windows` · `Android`（三个都事实成立） |
| 11 | **Maker** | 你自己的 PH 账号（**不要买 Hunter，也不要找人代发**） |
| 12 | **First comment** | 用本文档「First Comment」全文，**发布后 5 分钟内贴出** |

### 发布前 30 分钟检查

- [ ] 网页版能打开，且**首页搜索下拉能在几秒内出结果**（若仍是 67 秒 → 先推 `js/search.js` + `js/app.js` 的修复）
- [ ] 网页版切到 English，走一遍截图里的 7 个画面，确认没有中文残留
- [ ] Release 页两个下载链接都能点开
- [ ] `_ph_upload/` 里 6 张按顺序排好，第一张是 3D 热节图（`01_dc_hotspot.png`）
- [ ] 缩略图用的是 `00_thumbnail_240.png`（240×240）
- [ ] First Comment 已经写好放在剪贴板里，**不要现场编**
- [ ] GitHub 仓库描述已更新（见下方 README 建议第 1 条）

---

## Launch Day Checklist

**控制在 10 条以内。**

**发布前**
1. 挑 **周二 / 周三 / 周四**，太平洋时间 **00:01** 上线（这样有一整个 24 小时投票窗口）。
2. 提前一天把上面「发布前 30 分钟检查」全部过一遍。

**发布**
3. 上线后 **5 分钟内**贴出 First Comment（PH 官方建议；晚了曝光会明显少）。
4. 把链接发到你的真实圈子：铸造/材料/机械的同事群、QQ 群、邮件签名里认识的人。**只说"我发布了一个东西，想听听你的意见"，不要提投票。**

**当天**
5. **每条评论都回**，包括负面评论。回复要具体——有人指出公式问题就当场讨论，这比一百个 upvote 有价值。
6. 每隔 1~2 小时看一次评论区，及时回。
7. 按本文档「Launch 后推广文案」发 X / LinkedIn / Reddit / HN，**每个平台文案不同**。
8. 当天结束时记一下：**哪条反馈出现了两次以上**——那大概率是真的要修的东西。

**不要做**
9. **不要买 Hunter、不要买投票、不要刷票、不要在任何地方写"帮我投一票"。** 这违反 PH 规则，会导致产品被下架，而且对工程师社区来说是不可逆的信誉损失。
10. **不要一上来就推销。** 在 Reddit / HN 用产品口吻发帖会被秒删；用"我做了个东西，想听意见"的口吻。

---

## X Post

```
I'm a casting engineer, not a developer.

For years my daily calculations lived in Excel files I kept rebuilding.

So I used AI to write code, and built the tool I wanted: Casting Toolbox — riser, gating, yield, plus STL hotspot analysis.

Free, open source, fully offline.

github.com/thezhazhe/CastingToolbox
```

（约 320 字符，X 单条上限内。**不要放链接在第一条**——若想提高触达，可以把链接放到回复里。）

---

## LinkedIn Post

语气更像行业内分享，不是产品广告。

```
I'm a casting engineer. I don't have a software background.

Most of what fills my working day is process design — pouring time, choke area, riser size, yield. None of it is difficult. All of it is repetitive. For years that work lived in spreadsheets I kept rebuilding, and in reference books I kept digging through.

A while ago I started using AI to write code. I can't write software, but I can describe exactly what a foundry engineer needs, and I can tell when an answer is wrong. That turned out to be enough.

The result is Casting Toolbox: 15 calculators for the calculations I actually do, a 172-card reference library with sources attached, and an STL design centre that reads a casting and finds the hotspots.

A few things I deliberately did not do:
— It does not simulate anything, and it is not a replacement for MAGMA or ProCAST. It sits between Excel and the simulation package.
— It does not guess. When the mesh analysis can't give a reliable answer, it blocks the recommendation instead of printing a number.
— It does not phone home. No account, no upload, no telemetry.

It's MIT licensed and free. If you work in a foundry, I'd like to hear where the numbers are wrong — that's the feedback that actually improves it.

https://github.com/thezhazhe/CastingToolbox
```

---

## Reddit Post

**发在 r/engineering、r/casting、r/metalworking 这类版块。** 每个版的规则不同，**先读置顶规则、先参与别人的讨论再发自己的**，否则会被当推广号处理。

标题直接用陈述句，不要用营销口吻：

```
I'm a foundry engineer and I built a free offline toolkit for the casting calculations I got tired of doing in Excel
```

正文：

```
I do casting process design for a living. Pouring time, choke area, riser sizing, yield — the same set of calculations over and over, every job. For years that lived in a stack of Excel sheets I kept rebuilding.

I'm not a programmer. A while back I started using AI to help me write code, mostly because I could describe the problem precisely enough to get something usable out of it.

The result is Casting Toolbox. It's 15 calculators grouped by process flow (gating, feeding, dimensions, moulding, melting, defect diagnosis), a reference library of 172 cards that each keep their source, and an STL design centre that reads a casting and finds the feeding hotspots with a modulus value.

It's MIT, free, and runs entirely offline — Windows portable exe, Android APK, or in a browser. No account, no upload.

Things it deliberately does not do, because I'd rather be useful than impressive:
— No simulation. It's not a MAGMA/ProCAST replacement, and I don't want it used as one.
— No guessing. When the STL analysis is outside its sampling resolution, it says so and blocks the automatic recommendation.
— Several values (yield ranges, feeding efficiencies, neck coefficients) are industry experience values, not standard-mandated numbers, and they're labelled as such in the UI.

Two caveats: the deeper reference content is Chinese-first right now (the core UI is bilingual), and I haven't been able to test the Android build on a real device yet.

Happy to answer questions about the method or the numbers. If something is wrong, I'd rather hear it now.
```

**Reddit 特别注意**：有些版块禁止任何自我推广，有些有固定的 "Show and Tell" 帖。**发之前一定要确认该版规则**，被删帖还可能导致账号受限。

---

## Hacker News / Show HN Post

HN 的口味：**讲技术、讲取舍、别客套、别用形容词。** 标题不要出现 "free"、"open source" 这种求关注的字眼（评论区会反感）。

标题：

```
Show HN: Casting Toolbox – offline calculators for foundry process engineering
```

正文（HN 的正文就是一条评论，写短，留细节给追问）：

```
I'm a casting engineer, not a software developer. Most of my working day is the same set of process calculations — pouring time, choke area, riser size, yield — and for years that meant rebuilding spreadsheets.

I started using AI to write the code. I can't write software, but I can specify what a foundry engineer needs precisely enough, and I can tell when the output is wrong. That was enough to get here.

Some implementation notes that might be interesting:

- The whole thing is static files — no framework, no build step, no server. The Windows build is Node's single-executable-application wrapping the same files plus a local static server.
- STL analysis runs on a voxel-block distance field, O(N), no BVH in the main loop. It handles a ~20MB ASCII STL in a couple of seconds in the browser. Wall thickness and hotspot detection are sampling-based and have real resolution limits — thin features and very large models can fall outside it, and the tool reports that rather than hiding it.
- Every automatic value in the design centre carries a provenance tag (derived from STL / user input / calculated / user override). Overriding keeps the original and allows one-click restore. This was the single most useful design decision for getting engineers to trust it.
- Where the analysis can't produce a reliable result, it blocks the automatic recommendation instead of returning a fallback number.

It's MIT licensed. It does not simulate anything — it's explicitly the layer between a spreadsheet and a CAE package.

Honest caveats: the deep reference content is Chinese-first (core UI is bilingual), and the Android build hasn't been tested on a real device.

Repo: https://github.com/thezhazhe/CastingToolbox
```

**HN 注意**：Show HN 里放链接是允许的。**发帖后一定守在评论区**——HN 的评论比投票重要得多，作者不回复的帖子会很快沉下去。

---

## GitHub README Recommendations

**我没有改动 README。** 以下是建议修改的内容，改不改、什么时候改由你决定。

结论：**README 整体质量已经够用，不需要为营销重写。** 有 4 处是真正必要的，其中前 2 处在 GitHub 页面上（不在 README 文件里）。

---

### 1. ⚠️ 仓库描述过期（GitHub 页面右上角 Description）

**原因**：当前实际写的是 `开源铸造工具箱 - 13个计算工具 / 164条工艺知识 / 完全离线 / 永久免费 / MIT`。
实测是 **15 个计算器 / 172 条知识**。Product Hunt 来的人第一眼看到的就是这行字，写错数字会直接损害可信度。

**改成**：

```
开源铸造工具箱 · 15 个计算工具 / 172 条工艺知识 / 完全离线 / 永久免费 / MIT

Free, open-source casting process engineering toolkit — 15 calculators, 172 sourced reference cards, STL hotspot analysis. Fully offline, MIT.
```

---

### 2. ⚠️ 仓库没有设置 Homepage（GitHub 页面右侧 Website 字段）

**原因**：实测 `homepage: null`。Product Hunt 的流量进来后，**"点开就能用"的转化率远高于"下载 35MB 压缩包"**。网页版已经在线可用，但没有从仓库露出。

**操作**：仓库 → 右上角 ⚙️ Settings → Website 填 `https://thezhazhe.github.io/CastingToolbox/`

---

### 3. README 顶部补一句网页版入口

**原因**：README 的 Platforms 表里只写了"Web / source"，读者会以为要自己跑 Node 服务器。实际已经有托管好的网页版。

**在第 6 行那段引用块之前，插入一行**：

```markdown
> 🔗 **Try it in your browser:** https://thezhazhe.github.io/CastingToolbox/ — nothing to install
```

---

### 4. Core Features 表漏了 1 个计算器

**原因**：表里写 "15 calculators in total"，但表内只点了 14 个——**「Casting Principles · Campbell's 10 rules」没有出现**。数量对不上容易被认真的人挑出来。

**在 `| **Defect Finder** |` 那一行之后、`| **Engineering Reference** |` 之前，插入一行**：

```markdown
| **Casting Principles** | Campbell's ten rules across liquid metal quality, filling, solidification and cooling — mechanism, parameters, consequences of violating, checkpoints |
```

---

### 不建议改的

- **不要重写 Engineering Philosophy / Reliability & Disclaimer 两节。** 它们现在是 README 里最有说服力的部分——主动写清楚局限，反而让人信任。Product Hunt 的文案直接引用了它们的口径。
- **不要加 badge 墙、star 数、贡献者图。** 对 1 个 star 的新仓库来说，这些只会暴露冷清。
- **不要为了 SEO 堆关键词。** README 现在的英文已经自然，堆词会毁掉它。

---

## 需要你本人确认的信息

1. **英文显示名**：Product Hunt 上用什么名字？现有 GitHub 账号 `thezhazhe`，应用内作者名是中文"感谢每一天的生活"。面向全球受众，建议英文渠道单独用拉丁名。
2. **项目真实起点时间**：仓库第一次提交是 **2026-08-10**（v0.16）。而 `dist/` 里存在 v0.15。First Comment / "Why I built it" 里如果要写时间跨度（"about a year ago" 之类），请给我真实时间——**我不编。**
3. **英文界面中文残留怎么处理**：本文档开头给了三个选项。**这个决定影响截图怎么截、文案怎么写、什么时候发。**
4. **网页版知识库 67 秒的问题要不要先修再发**：修复已在本地写好未推送。PH 一定会有人点网页版。
5. **第三方 AI 工具署名**：如果 PH 的 First Comment / HN 帖子里要提到"用 AI 写的代码"，是否愿意点名具体工具？我目前写的是泛指的 "AI"，没有点名任何产品。
6. **Android 的表述**：Release 里已经如实写了"作者未做真机验收"。PH 的 Platforms 字段如果勾 Android，建议在 First Comment 的 caveat 里同步说明（我已在 First Comment 里写了这句）。

---

## 附：物料位置一览

### 要上传的（`D:\CDXProject\_ph_upload\`）

| 文件 | 用途 |
|---|---|
| `00_thumbnail_240.png` | **缩略图**，240×240，直接传 |
| `01_dc_hotspot.png` | 画廊第 1 张（首图） |
| `02_dc_riser_results.png` | 画廊第 2 张 |
| `03_calculators.png` | 画廊第 3 张 |
| `04_riser_sources.png` | 画廊第 4 张 |
| `06_home.png` | 画廊第 5 张 |
| `07_dc_params.png` | 画廊第 6 张 |
| `*@2x.png` | 同图的 2540×1520 版本，想要更清晰可改用这些 |
| `_discarded/` | **不要传**（浇注系统那张，含中文） |

### 参考用的（`D:\CDXProject\_ph_shots\`）

更大的 2880×1800 原始截图，含侧栏。**不用上传**，留给你自己看效果或另作他用。

### 生成脚本（都在仓库外，未改动项目任何文件）

`D:\CDXProject\` 下：`_ph_shots*.mjs` · `_ph_export*.mjs` · `_ph_cjk_scan.mjs`（英文界面中文残留扫描）· `_ph_probe_models.mjs`（模型网格警告探测）· `_live_check.mjs`（线上验收）

---

*本文档由项目代码与实测界面核查后生成，未修改项目任何代码或文档。*
