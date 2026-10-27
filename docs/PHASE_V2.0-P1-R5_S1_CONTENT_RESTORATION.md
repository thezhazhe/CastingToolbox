# PHASE V2.0-P1-R5 · S1 内容恢复与状态修复

> **通常先读精简版 → `PHASE_V2.0-P1-R5_S1_SUMMARY.md`**（同样覆盖全部重要结论，只是不逐条列证据）。
> 本文是完整版，多出：逐条实测证据、优先级同序的完整论证、文件清单与逐项改动说明。

> 输入：`149.txt`。依据：`PHASE_V2.0-P1-R5_UI_DESIGN_PROPOSAL.md` / `…_SUMMARY.md`（147）、
> `PHASE_V2.0-P1-R5_S0_ENGINEERING_AUDIT.md`（148）、`PHASE_V2.0-P1-R4_WORKBENCH3.md`、`PHASE78_REPORT.md`。
> 范围：**只做 S1**。未进入 S2 的工作台布局重构（方案 D 未动）。
> 基线：`main` / `da1c822`，开工时工作区 101 项，与 S0 收尾态逐位一致。

---

## 0. 五句话结论

| # | |
|---|---|
| 1 | **示意图接回来了，一张图都没新画** —— `gatingDiagramSvg()` 原函数 + 原有 CSS，只补了一个调用点。 |
| 2 | **S0 查出的两处"文案与实际计算相反"已修**，判据从 `hotspots.items` 改成 `hotspots.status`，五态五文案，收在一个可单测的纯模块里。 |
| 3 | **"承诺了但界面没有"的两笔欠账还清了**：逐热结 ✎ 改 Mc、↺ 恢复自动原值 —— 两个都验证过"点了真能存下去"。 |
| 4 | **顺带查出并修掉一个真缺口**：`hsReasonText()` 的 7 条输出文案在 `en-US.js` 里**根本没有词条** ⇒ 英文界面一直是"英文句子里嵌中文"；它同时喂热结状态条与本轮新文案，不补会把这个缺口复制一遍。i18n 遗留 11 → 7 处。 |
| 5 | **全量 874 通过 / 1 失败**，唯一失败是 `phase24 T5`（交接书记录的**历史遗留**）；874 = 基线 861 + 本轮新增 13。**10 个冻结指纹逐位不变。** |

---

## 1. 实际恢复了哪些内容

### 1.1 浇注方向示意图（149 §二.1）

| 项 | 实际做法 |
|---|---|
| 图本身 | `js/views/gatingDiagram.js` 的 `gatingDiagramSvg(pos)` —— **PHASE 45 用户逐轮审到 v8 的正式版，本轮一字未改** |
| CSS | 复用既有的 `.dc-gating-diagram`（`app.css`，**从来没被删过**，一直在） |
| 新增 | 只有外层容器 `.dc-gating-diagram-wrap` 与一个调用点 |
| 位置 | 参数窗口 → **C 浇注系统** → 「浇注位置」下拉的**紧下方**（同一字段块内） |
| 三态切换 | 顶注 / 中注 / 底注，随下拉选择变化（浏览器实测三张 SVG 的 `aria-label` 与内部 marker id 各不相同） |
| 图注 | 图形自带 Ho / ph / rh 三处尺寸标注 + 图底三行注释（`diag.ho/ph/rh`），标题旁 chip「Ho / ph / rh 的含义见图」 |
| 主题 | 图纸**保留白底**（§二.1 明确允许）；外围容器用 `--surface-2` 适配明暗主题。深色主题实测 `svgBg=rgb(250,250,250)` |
| 红线 | 渲染在 `#dc_paramDlg` 内，**与 `#dc_view3dBox` 无任何关系** ⇒ 146 §五 那条 OrbitControls 指针捕获的红线天然不触及 |

### 1.2 参数帮助内容（149 §二.2）

**全部来自既有资源，没有新编任何工程规则。** 逐块出处：

| 恢复的内容 | 出处（可核对） | 放置 |
|---|---|---|
| **来源图例** `🟢 STL 自动识别 · 🟡 用户输入/默认 · 🔵 自动计算 · 🟠 用户修改（覆盖自动值，可 ↺ 恢复原值）` | v1.1.0 参数区原文（`git show HEAD:js/views/designCenter.js`）；i18n 词条一直都在 `en-US.js` | 窗口顶部常驻 |
| **参数共享与保存语义** | 同上 | 窗口页脚常驻（**不折叠**） |
| **浇注比例 7 条适用范围** | `gatingView.js` 的 `RATIO_APPLIC`（**加 `export` 直接 import，不另抄一份**） | 展开块「浇注比例怎么选？」 |
| **「浇注比例怎么选？」正文** | 同上弹窗原文，抽成 `RATIO_HELP_INTRO/AUTO/TIP` + `ratioHelpRows()` **单一来源**，独立计算器弹窗改读同一份（显示结果一字未变） | 同上 |
| **Mc 的四种估法** | 独立「冒口设计」计算器的 `mc_mode` 四个选项（直接 Mc / 热节圆 d / 壁厚 t / V&A） | 展开块「Mc 怎么估？（4 种方式）」 |
| **排气规则** | `gatingView.js:209` 的 title 原文（1.5~4 倍 S直 / 圆孔 3~10mm / 方片厚 ≤ 铸件壁厚） | 「排气孔直径」字段说明 |
| **浇注系统工程原则 5 条** | `gatingView.js` 的 `ENG_NOTES`（**加 `export` 直接 import**） | C 模块底部展开块 |
| **结果页参数调整指路** | v1.1.0 参数区原文 | 结果页 ③ 浇注系统 |
| **失效指路文案修正** | 见 §2.4 | 结果页 ④ / `res.riser.multiNote` |

**按 §二 的三条硬约束逐条核对：**

- **不把行业参考值说成固定规则**：工程原则块结尾明写「以上为工程提示，不参与任何计算或判定」。
- **不把 72~85% 写成泛指所有低压铸造**：本轮**根本没有引入出品率区间文案**（设计中心参数区没有该字段的说明位）。指南类文案不在 S1 范围（147 §9 的设计留待后续）。
- **1.8 不进产品界面**：全轮未出现该系数（与 S0 §1 的结论一致）。
- **不复制一份重复的计算逻辑**：帮助内容全部 `import` 自独立计算器，`gatingView.js` 只加了 2 个 `export` + 1 个纯数据函数 `ratioHelpRows()`；**计算行为零改动**。
- **复杂说明可展开，但字段含义与来源不隐藏**：常驻的是字段名 + 单位 + 来源徽章 + 一行短说明；只有"怎么选 / 怎么估 / 有哪些原则"折进 `<details>`。

### 1.3 冒口形状说明（149 §二.3）

- **默认值仍是 `cyl`**，本轮**未统一**独立计算器与向导的默认（§二.3 明令不做）。
- 形状下拉旁新增两行：
  - 当前形状的**模数公式**（原来就有，保留）；
  - 当前形状的**补缩效率** —— **读 `RISER_EFF[RISER_SHAPES[k].effKey]`**，UI 里**没有任何硬编码百分比**（实测：球形显示 20%）。
- 明确标注：「取自冒口计算的效率表（《铸造手册》第 5 卷），是**本模型采用的系数**——**不是实际生产验证结果**，各厂可按实绩在独立计算器中修改。」
- **冒口尺寸计算逻辑与默认值一字未改**（`calcs/riser.js` 指纹不变）。

---

## 2. 修复了哪些参数状态问题

### 2.1 ★ 五态 Mc 来源文案（149 §三）—— 本轮最重要的一条

**根因**（148-S0 §3.2 实测）：`mcSourceNote()` 的判据是 `hotspots.items` 有没有，而不是 `hotspots.status`。而 `hotspots.items` 在两个失败分支里**都会被写入**，于是：

| `hotspots.status` | 引擎 hotspots | **原界面显示** | `calcManifest` 实际 | 一致？ |
|---|---|---|---|---|
| `ok` | 非空 | 来源：STL 热结检测（最大热结 H1） | 用 `mcHotspot` | ✅ |
| `NO_HOTSPOT` | 空 | 主体壁厚 ÷ 2 = X mm | 用 `wallHot`（= 主体壁厚 ÷ 2） | ✅ |
| `LOW_CONFIDENCE` | **非空** | **来源：STL 热结检测（最大热结 H1）** | **`blocked`，不计算** | ❌ |
| `INSUFFICIENT_RESOLUTION` | **空** | **主体壁厚 ÷ 2 = X mm** | **`blocked`，不计算** | ❌ |

**做法**：新建 **`js/views/hsSourceNote.js`**（纯函数、无 DOM，166 行），照搬 V2.0-15 的 `riserStatus.js` 范式 —— **判定与文案收成一个可单测的单一来源**，设计中心只负责渲染。判定逐支对齐 `calcs/calcManifest.js:213-265`，**不重复实现任何计算规则**。

**五态 → 实际文案**（浏览器逐态实测，`data-mc-src-kind` / `data-mc-src-blocked` 钩子）：

| 状态 | kind | blocked | 文案要点 |
|---|---|---|---|
| `ok`（自动） | `stl` | false | 来源：STL 热结检测（最大热结 H1）＋「自动估计值，尚未验证适用于所有几何」 |
| `ok` + 勾选热结 | `stl-multi` | false | 逐热结各用各自 Mc，主结果取 Mc 最大者；未勾选的不计算 |
| **用户显式填 Mc** | `user` | false | 「来源：**用户确认的** Mc = X mm —— 冒口按此值计算，**不是**自动热结检测结果（热结分析状态：…）」 |
| `NO_HOTSPOT` | `wall` | false | 主体壁厚 ÷ 2 = X mm **＋ reason 原样带出**（见 §2.2） |
| `LOW_CONFIDENCE` | `blocked-lowconf` | **true** | 「本次**不会**给出冒口建议 —— 自动建议已被阻止，推荐值不成立，也**不是**按主体壁厚 ÷ 2 估算」 |
| `INSUFFICIENT_RESOLUTION` | `blocked-resolution` | **true** | 同上口径 |
| `none` | `none` | false | 「当前没有 STL 热结检测结果：按主体壁厚 ÷ 2 估算，不是 STL 识别出的热点」 |
| 取不到正值 | `uncomputable` | **true** | 与 `calcManifest` 的 `if (mc <= 0) return null` 对齐，不假装有值 |

**§三.4（人工放行）与 §三.5（几何硬阻断）也按实际路径处理**：

- 用户显式填 Mc 且状态非 `ok` ⇒ 文案明说走的是**人工放行路径**，并要求「请确认该 Mc 有工艺依据」；**不声称自动热结检测可靠**。
- `geometry.geomStatus === 'INVALID'` ⇒ `isHardBlocked()` 恒阻断（V2.0-10 定案），文案追加「本次为**硬阻断**，自动建议一律不可用（人工输入 Mc 也**不能**放行）」—— **不再只给一个看似正常的推荐值**。

**⚠ 两处优先级必须与 `calcManifest` 逐支同序**（否则界面说"用的是用户值"而实际用了别的）：

- 有热结项 ⇒ 只看 `mcHotspot`（对应 `else if (hs.length > 0)`）
- 无热结项 ⇒ **先** `wallHot`，再 `mcHotspot`（对应 `else if (isUserVal(wallHotSrc))` → `else if (isUserVal(mcHotSrc))`）

Node 测试 `S1-T1b` 对这两条各做了正反两向断言。

### 2.2 `hotspots.reason === 'rejected'` 的文案映射（149 §三 末段）

- **出处**：`js/engine/v3/hotspotV3.js:240` `reason = audit.length ? 'rejected' : HS_REASON.NO_CANDIDATE` —— **有候选、也做了审计，但一条都没通过**。
- **问题**：`rejected` 是**裸字符串，不在 `HS_REASON` 枚举内**，`hsReasonText()` / `HS_NOTE` 都查不到 ⇒ 一律回落成「无热结」/ 空串，把"有候选但全被筛掉"说成"没有热结候选"。
- **修法**：`js/engine/**` 冻结（§九）⇒ 该键**只加在显示层**：
  - `designCenter.js`：`HS_REASON_REJECTED = 'rejected'` → `hsReasonText` 映射为「有热结候选但均未通过筛选（未达热结判定标准）」；
  - `processPage1.js`：`HS_NOTE.rejected` 同文案；
  - `hsSourceNote.js`：`NO_HOTSPOT` 分支**把 reason 原样带出来**（原来这一支根本不带 reason，`rejected` 没地方显示 —— **这条是浏览器测试抓出来的，不是我预先想到的**）。
- **对照组已验证**：`no_candidate` 仍显示「未检测到热结候选」，两种原因**没有被合并**。

### 2.3 `↺ 恢复自动原值` 的真实语义与接线（149 §五）

**先审查 `CastingProject.restoreAutoValue()`（模型层，本轮一字未改）**：

```js
if (!p || !p.orig || p.src !== SRC.USER_OVERRIDE) return false;
const { v, src, conf } = p.orig;
p.orig = undefined;
set(path, v, src, conf);   // ← 数值 + 来源 + 置信度三件一起还原
```

**结论：它恢复的是"来源"，不是"数字"。** 这正是 §五.5 要求的区别。

**接线设计（关键决策）**：R4 的参数窗口是**草稿 → 保存**两段式（§七），而 `restoreAutoValue()` 会**立即写项目**。两者直接拼在一起就会破掉「保存前项目数据不变」。因此：

- 点 ↺ ⇒ 只在 `state.draftRestore`（一个 Set）里**标记意图**，**项目一字未改**；
- 保存时才调 `proj.restoreAutoValue(path)`，并在**返回 false 时如实报告**（不静默假装成功）；
- 输入框即时预览"恢复后会变成的自动原值"，并给一句明确状态 + 一个「撤销」；
- **只有 `p.orig` 存在且 `src === USER_OVERRIDE` 才渲染入口** —— 没有原值的字段**一个 ↺ 都不出现**（§五.1）。
- 手动改成别的值 = 放弃恢复意图（后一次操作覆盖前一次，不做需要用户猜的叠加规则）。

**覆盖范围（§五 点名的三个）**：`process.mcHotspot`（Mc）、`process.wallUsed`（主体壁厚）、`geometry.blankWeightKg`（毛坯重量）。三者实测都可恢复。

**§五.7 文案诚实性**：`srcTagHtml()` 原来在 `title` 里**写死**「（↺ 可恢复）」而界面上从来没有那个 ↺ ⇒ 改成两态：**给了可恢复入口才提 ↺**，没给就只说"原始值 X · 当前采用 Y"，**一个字都不多承诺**。

### 2.4 `hsPick` 双入口来源语义统一（149 §六）

**先按枚举定义判定，不是为了一致而一致：**

| 枚举 | 定义 |
|---|---|
| `USER_INPUT` | 用户**直接输入** |
| `USER_OVERRIDE` | 用户**修改了自动值** |

**判定：`USER_INPUT` 是对的。** 三条依据：

1. `process.hsPick` **没有任何自动写入口**（默认 `[]` = 按主热结 H1 的自动模式），不存在"被覆盖掉的自动值"；
2. `set()` 只在原来源是 `STL_GEOMETRY_ANALYSIS` / `DERIVED` 时才固化 `orig`，而 `hsPick` 的来源是 `DEFAULT` ⇒ 标成 `USER_OVERRIDE` 时 `orig` 永远不存在，**图例却承诺"可 ↺ 恢复"** —— 一个 `restoreAutoValue()` 兑现不了的承诺；
3. v1.1.0 与左栏热结列表**本来就用 `USER_INPUT`**。

⇒ 参数窗口保存时对 `process.hsPick` 显式写 `SRC.USER_INPUT + CONF.USER_CONFIRMED`。**没有丢失任何真实区别** —— 对这个参数而言那个区别本来就不存在。左栏勾选行为**一字未改**。

**顺带修正的陈旧注释**（148-S0 §3.4 第 4 条）：`renderHotspotList` 上方原写「多热结的 Mc 逐项编辑在参数窗口 B 模块里」，而 146 轮删掉 ✎ 改 Mc 后 B 模块其实**没有**该入口 —— 注释与实现不符。本轮按 §四把入口真正做实，两者才一致（注释里留了 2026-10-16 更正说明）。

### 2.5 失效指路文案（149 §二.2 末条）

145/146 轮删掉的入口，文案还在指路 ⇒ 全部改指**真实存在**的地方（顶栏「⚙️ 分析条件与工艺参数」，模块 A/B/C）：

| 位置 | 原文案（已失效） | 现文案 |
|---|---|---|
| `resultsCenter.js` ④ 出品率 | 参数与执行条件 → ② 基础工艺参数可改 | 分析条件与工艺参数 → **C 浇注系统 · 生产条件** 可改 |
| `resultsCenter.js` ④ | 造型线未指定（② 基础工艺参数可指定后重算） | 同上，指向 C 模块 |
| `zh-CN/en-US` `res.riser.multiNote` | 「参数与执行条件 → 冒口参数」中勾选 | 「**分析条件与工艺参数 → B 冒口设计**」中勾选（每个热结的 Mc 也可在那里逐项修改） |

---

## 3. 恢复逐热结修改 Mc（149 §四）

- **入口在参数窗口 B 模块**的行内输入框（不在左栏）：每行 = `H1` + **检出模数** + 区域体积 + 置信度 + 该热结自己的「✎ 冒口设计 Mc」输入框。
- **绑定到该热结**：按 `id` 定位 `hsPick` 元素，其他热结一个字节都不动（实测：改 H1 → H2 的值一字未动）。
- **草稿语义**（§七）：编辑只改草稿，**保存前项目数据不变**（实测通过）。
- **来源标签符合实际**：改过的记 `USER_OVERRIDE`、未改的记 `STL_GEOMETRY_ANALYSIS`（逐项标注，实测通过；V2.0-08 契约不变）。
- **勾选/取消勾选语义保持现有**：勾选 = 该热结参与冒口设计；未勾选的 Mc 输入框**禁用**（它在那条路径下根本不计算，让它可编辑会造出一个"填了但不生效"的假入口）。
- **`calcManifest` 的多热结优先级与计算路径零改动**（§四末二条）—— 本轮只是恢复了"把值填进去"的入口。
- **不是假按钮**：另有「↺ 改回检出值」入口，实测"点了 + 保存后确实回到检出值"。
- 非正值输入与 `calcManifest` 的 `p.mc > 0` 过滤同口径：**不静默写 0**（那会让该热结被悄悄剔除），而是标红并保持原值。

---

## 4. 因数据契约 / 冻结边界**未做**的事

| # | 事项 | 为什么不做 |
|---|---|---|
| 1 | 统一独立计算器 / 向导的冒口形状默认为 `cyl` | §二.3 明令本轮不统一；`sphere_head` 是视图局部默认，且两入口互不读写（S0 §2.3 已证） |
| 2 | 把 `rejected` 补进引擎的 `HS_REASON` 枚举 | `js/engine/**` 冻结（§九）。该键**只加在显示层** |
| 3 | 修改 `calcs/riser.js` / `calcManifest.js` / `riserDreq.js` 的任何公式、阈值、默认值 | §九 冻结。本轮对这三个文件**只读**（指纹见 §7） |
| 4 | 改 `hotspots.status` 的取值集合或判定规则 | 同上 |
| 5 | S2 的工作台布局重构（方案 D：左栏取消 → 右面板 + 顶部流程条） | §一/§九 明令**不进入 S2**。本轮所有恢复内容都落在**现有**参数窗口结构里 |
| 6 | 使用指南（147 §9 的两层指南） | 属于后续阶段；本轮 §二.2 只恢复"参数帮助"这一块 |
| 7 | 出品率区间 / 1.8 口径相关的任何界面文案 | S0 §4 的硬约束：企业确认口径前，**产品与指南都不出现 1.8**；且 §九「不修改出品率模型」 |
| 8 | 热结状态条的**悬停调试 tooltip**（`算法内部：gs=25³ …`）的英文覆盖 | 属 i18n 遗留（非本轮引入），且它是**调试信息**，改法有两条（补翻译 / 收进 `?hsDebug=1`）而后者是产品决定 ⇒ 不自作主张，列入 §8 待决 |

---

## 5. 修改文件清单

### 5.1 改动（8 个）

| 文件 | 改了什么 | 性质 |
|---|---|---|
| `js/views/designCenter.js` | ① 接回示意图调用点 ② 来源图例 + 页脚共享说明 + 三块帮助 ③ 形状效率显示 ④ `mcSourceNote` 改走单一来源 ⑤ 逐热结 Mc 行内编辑 ⑥ `draftRestore` + ↺ 接线 + 保存落盘 ⑦ `hsPick` 写 `USER_INPUT` ⑧ `rejected` 映射 ⑨ 陈旧注释更正 | 显示层 + 草稿机制 |
| `js/views/hsSourceNote.js` | **新建**：热结五态 → Mc 来源文案的**单一来源**（纯函数，166 行） | 新模块 |
| `js/views/gatingView.js` | **只加 `export`**（`RATIO_APPLIC` / `ENG_NOTES`）+ 抽出 `RATIO_HELP_*` 与 `ratioHelpRows()` 供复用；ⓘ 弹窗改读同一份 | **零行为改动** |
| `js/views/processPage1.js` | `srcTagHtml` 不再承诺不存在的 ↺；支持可选恢复入口；`HS_NOTE.rejected` | 显示层 |
| `js/views/resultsCenter.js` | 失效指路文案 + 结果页参数调整指路提示 | 文案 |
| `css/app.css` | 来源图例 / 帮助块 / 逐热结行 / 比例适用范围 / ↺ 待恢复行 / 示意图容器 / 五态配色（全部沿用既有 token） | 样式 |
| `js/i18n/en-US.js` | 本轮新增文案的英文覆盖 + **补 `hsReasonText` 7 条落点** | i18n |
| `js/i18n/zh-CN.js` | `res.riser.multiNote` 指路更正 | i18n |

### 5.2 新增测试（3 个）

| 文件 | 内容 |
|---|---|
| `tests/phasev20s1_test.mjs` | **13 条** Node 断言（五态矩阵 / 人工放行 / 硬阻断 / rejected / restoreAutoValue 语义 / 逐热结绑定 / hsPick 来源 / 示意图三态 / 帮助资源齐备 / 形状效率 / 草稿契约） |
| `scripts/browser_s1_test.mjs` | **27 条**浏览器断言（对应 §八 的第 1/2/3/4/6/8/9/10 条，含真实鼠标、明暗主题 × 三档视口、运行期异常） |
| `scripts/browser_p78_test.mjs` | **改写 1 条被 149 §四取代的断言**（见 §6.4）+ 新增 6 条（草稿不落盘 / 绑定 / 保存 / ↺ 改回检出值） |

**未改动**：`calcs/**`（只读引用）、`js/engine/**`、`js/model/CastingProject.js`、`app.css` 以外的样式文件。

---

## 6. 自动值恢复与多热结编辑的实际验证结果

**全部为浏览器实测**（`scripts/browser_s1_test.mjs` + `browser_p78_test.mjs`），不是源码推断。

### 6.1 ↺ 恢复自动原值

| 步骤 | 实测结果 |
|---|---|
| 前置：把主体壁厚改成 77 并保存 | `{v:77, src:"USER_OVERRIDE", orig:50}` ✅ 来源记为「用户修改」且固化自动原值 |
| 有原值的字段出现 ↺ | `[data-reset-orig="process.wallUsed"]` 存在 ✅ |
| **没有**原值的字段 | `process.Ho` / `process.ratioKey` 的 ↺ **都不存在** ✅（不给假入口） |
| 点 ↺ | **项目一字未改**：仍是 `{v:77, src:"USER_OVERRIDE"}` ✅ |
| 点 ↺ 后界面 | 出现"待恢复"状态行 + 输入框预览 `50` + 可撤销 ✅ |
| 保存 | `{v:50, src:"STL_GEOMETRY_ANALYSIS", conf:"high"}` ✅ **数值 + 来源 + 置信度三件一起还原** |
| 恢复后 | `restoreAutoValue()` 返回 `false` ⇒ 不再是"可恢复状态"，↺ 不重复出现 ✅ |

> ⚠ 一处**刻意不断言**的地方：恢复后 `p.orig` 又存在了 —— 因为 `set()` 对 `STL/DERIVED` 来源的写入本来就会把 `orig` 刷成"最新自动值"（模型既有契约）。验证的是**「orig 与当前值/来源一致」+「不再是可恢复状态」**，而不是"orig 必须为空"。这一点在测试注释里写明了理由。

### 6.2 逐热结改 Mc

| 步骤 | 实测结果 |
|---|---|
| 打开参数窗口 | 两行热结，各有自己的「✎ 冒口设计 Mc」输入框，值 = 检出值，**未禁用到** ✅ |
| 改 H1 的 Mc → 17.5 | **项目仍是检出值** ✅（草稿语义）；输入框即时显示 17.5 ✅ |
| 保存 | `H1 = 17.5`，**H2 一字未动** ✅ |
| 点「↺ 改回检出值」→ 保存 | H1 回到检出值 ✅（**点了真能存下去**，不是假按钮） |
| 逐项来源标注 | H2 改过 ⇒ `USER_OVERRIDE`；H1 未改 ⇒ `STL_GEOMETRY_ANALYSIS` ✅ |

### 6.3 保存 → 结果标记过期

冒口形状 `cyl → sphere` 保存后：项目值 = `sphere`、来源 = `USER_OVERRIDE` ✅；形状旁显示「补缩效率 … 20%」并标注「**不是实际生产验证结果**」✅。

### 6.4 ⚠ 关于"改写了一条既有断言"的说明（**不藏着**）

`scripts/browser_p78_test.mjs` 原有一条：

```
check('E 「✎ 改 Mc」入口已随参数窗口移除（Mc 不可手改）', ...)
```

这是 **146 轮删掉该入口时的判据**。149 §四 明确要求**恢复**它，该断言的前提已不成立。处理方式：

- **不是删断言、不是加 skip、不是放宽**：把它换成对"恢复后行为"的断言，**判据强度只增不减**（旧断言只查"入口不存在"；新断言查"入口存在 + 值绑对行 + 改它不写项目 + 保存后只有它变 + ↺ 改回有效"）。
- 在源码里留了注释说明这次取代的来龙去脉与日期。

---

## 7. 测试通过 / 失败情况（如实报告）

### 7.1 全量 Node 回归

```
node tests/runner.mjs
结果：874 通过 / 1 失败
```

| | |
|---|---|
| **唯一失败** | `tests/phase24_test.mjs :: T5 关键真实 STL 热结数量零回归`（`ALHR4510…stl 热结数应=5，实际 2`） |
| **性质** | **历史遗留**，非本轮引入 —— 交接书 §全量 明确记为「唯一失败 `phase24 T5` 是历史」 |
| **基线对照** | 基线 861/1 → 本轮 874/1。**874 = 861 + 13**（本轮新增的 13 条 Node 断言），失败数**没有变化** |
| **退出码** | `1`（runner 因该历史失败而返回 1，与基线一致） |

> ⚠ **并行跑会造出假红**：本轮曾并行跑两个全量套件，`hotspot_v2_test.mjs` 内部的 `性能 < 8s` 门限被抢 CPU 顶到 `10977ms` / `8968ms` 而报红（正是 V2.0-19 记过的"性能门槛让日志 PASS 数自己翻转"）。**单独复跑 `hotspot_regression`：18 通过 / 0 失败。**
>
> ⚠ **另有一条与统计口径有关的事实，一并说明**：`tests/hotspot_v2_test.mjs` 自己带一个**内部 mini-runner**（跑真实 STL 的扫描扫描，打印自己的「结果：N 通过 / M 失败」），它**不在 runner 的 `tests` 数组里 ⇒ 不计入上面的 874/1**（交接书也记过它 `process.exitCode` 泄漏的坑）。本次干净串行复跑时它报 `large thin shell: 性能 < 8s — 9397ms` 一条红 —— 属**机器负载敏感**门限，且本轮**没有任何改动能影响它**：该项测的是热结引擎的扫描耗时，而 `js/engine/**` 六个文件的指纹逐位未变（§7.4），改动全在视图与文案层。**不把它算作本轮引入的失败。**
>
> 上表 874/1 取自**串行干净复跑**（`/tmp/full_s1_clean.txt`，`exit_code=1`），与并行那次逐字一致。

### 7.2 浏览器验收

| 脚本 | 结果 |
|---|---|
| `scripts/browser_s1_test.mjs`（新增，27 条） | **全部通过**（`✅ 全部通过`），运行期无未捕获异常 |
| `scripts/browser_p78_test.mjs`（含改写断言 + 新增 6 条） | **51 ✓ / 0 ✗，exit 0**，`PHASE 78 浏览器验收：全部通过 ✅` |
| `scripts/browser_i18n_audit.mjs` | 核心页遗留 **11 → 7 处**（见 §7.3） |

**`p78` 里 5 条新断言的实测证据**（原文摘录）：

```
✓ E(149) 逐热结「冒口设计 Mc」输入框已恢复，且落在该热结那一行
   {rows:2, has:true, disabled:false, val:"7.1",
    rowTxt:"H1 检出模数 7.1 mm · 区域 164.8 cm³ ✎ 冒口设计 Mc mm"}
✓ E(149) 改 Mc 不写项目（149 §七：保存前项目数据不变）
   项目里 H1 仍应是检出值 7.1：[{id:1,mc:7.1},{id:2,mc:6.8}]
✓ E(149) 输入框保持用户刚填的值（界面即时反馈） — val=17.5
✓ E(149) 保存后：H1 = 17.5，H2 一字未动  — H1={id:1,mc:17.5} H2={id:2,mc:6.8}
✓ E(149) 「↺ 改回检出值」入口存在且保存有效 — 保存后={id:1,mc:7.1} 检出=7.1
```

**§八 十二项验证逐条对照**：

| # | 要求 | 覆盖 |
|---|---|---|
| 1 | 三种浇注方向对应正确示意图 | ✅ `S1-1`×5（aria-label / marker id / 三处标注 + 三行图注 / 紧邻字段） |
| 2 | 来源图例与帮助内容确实可见 | ✅ `S1-2`×7（图例 / 三块帮助 / 排气规则 / 页脚 / 7 条适用范围 / 不在 view3dBox 内） |
| 3 | 五种热结状态显示与实际计算路径一致 | ✅ `S1-3`（五态逐态比对 kind + blocked + 文案，含 S0 查出的两处相反文案） |
| 4 | `rejected` 不再显示为"无热结" | ✅ `S1-4`×2（rejected 专属文案 + no_candidate 对照组未被合并） |
| 5 | 多热结逐项编辑能正确保存 | ✅ `p78 E(149)`×6 + `S1-T4` |
| 6 | 自动值恢复能正确恢复来源和状态 | ✅ `S1-6`×5（含"项目未改"与"三件一起还原"） |
| 7 | 未保存草稿不会改变项目 | ✅ `p78 E(149)` + `S1-T7` |
| 8 | 保存后项目更新、受影响结果标记过期 | ✅ `S1-8`（值 + 来源） |
| 9 | 七个标准视图按钮仍通过**真实鼠标**事件工作 | ✅ `S1-9`×3（CDP `Input.dispatchMouseEvent` + `elementFromPoint` 命中校验 + 7 个不同机位） |
| 10 | 明暗主题 × 至少三档视口无溢出 | ✅ `S1-10`×2（1440×900 / 1024×768 / 390×844 × light/dark 共 6 组，页面 / 对话框 / 示意图横向溢出均 ≤1px） |
| 11 | i18n 审计通过 | ⚠ 见 §7.3（无新增；遗留减少 4 处） |
| 12 | 十个冻结指纹逐位不变 | ✅ 见 §7.4 |

### 7.3 i18n 审计

`node scripts/browser_i18n_audit.mjs` → 核心页遗留 **11 → 7 处**（**本轮减少 4 处，未新增任何一处**）。

**减少的 4 处**：`hsReasonText()` 的 7 条**输出文案在 `en-US.js` 里根本没有词条**（`未检测到热结候选` / `模型壁厚均匀…` / `有候选但置信度不足…` / `网格无效，无法分析` / `无法可靠进行热结分析…` / `局部细化超限…` / `无热结`），而它的输出会被**插进 `hs.badge.*` 与结果页/Page1 的句子里当参数** ⇒ 英文界面一直是"英文句子里嵌中文"（每个设计中心页报 2 处）。本轮新文案同样嵌 `{r}`，**不补就会把同一个缺口复制一遍**，所以一并补齐。

**剩余 7 处（均为遗留，非本轮引入）**：

| 处 | 内容 | 说明 |
|---|---|---|
| 3 | donate 页赞助商署名（`曹掌柜` 等） | 专有名词 |
| 4 | 热结状态条的**悬停调试 tooltip**（`算法内部：gs=25³ …`，4 个页上下文各 1 处） | 仅鼠标悬停可见；改法有两条且其中一条是产品决定 ⇒ **列入 §8 待决，未擅自改动** |

### 7.4 冻结指纹核对（10 个，逐位不变）

```
5cfcfef3  calcs/riser.js                    674f075be7bed823fe8a8d9fa119b922 (md5) ← 与 S0 开工时一致
efdc2301  calcs/riserDreq.js                5e1f9cdde42d215c4585825034dc6824 (md5) ← 一致
c1d3ec3c  calcs/calcManifest.js             6a1318e5143a1586e16fcfaf55776a18 (md5) ← 一致
d774532a  js/engine/v3/hotspotV3.js         fb6f89f9b610b784e351b1f1c1a47a92 (md5) ← 一致
8d61d26d  js/engine/v3/peakRegion.js
5957831c  js/engine/v3/sampling.js
48488b13  js/engine/v3/modulusField.js
80a763ef  js/engine/v3/configV3.js
5af64ae4  js/engine/meshValidation.js
1e3d96cc  js/engine/v3/v3ViewAdapter.js
```

9 个 sha256 与交接书 §3.2 的记录**逐字一致**；4 个 md5 与 **S0 开工时逐位一致**。
**`calcs/riser.js` / `calcManifest.js` / `riserDreq.js` / `js/engine/**` 本轮只读。**

### 7.5 工作区状态

```
HEAD  da1c822（未变）
git status --porcelain  101 → 106 项
```

**本轮实际落盘的文件**（`find . -newermt "-6 hours"` 逐条核对，共 11 个）：

```
M  css/app.css                              ??  js/views/hsSourceNote.js
M  js/i18n/en-US.js                         ??  scripts/browser_s1_test.mjs
M  js/i18n/zh-CN.js                         ??  tests/phasev20s1_test.mjs
M  js/views/designCenter.js                 ??  docs/PHASE_V2.0-P1-R5_S1_CONTENT_RESTORATION.md（本报告）
M  js/views/gatingView.js
M  js/views/processPage1.js
M  js/views/resultsCenter.js
M  scripts/browser_p78_test.mjs
```

> ⚠ **总项数 +5 中有 1 项不是本轮产生的**：`js/views/riserStatus.js`（未跟踪，mtime **10-13**）是 V2.0-15 轮的遗留文件，一直在工作区里。我无法从当前状态反推出 S0 收尾那一刻的精确分解（S0 报告记的 101 与本轮开工实测差 1），**如实说明，不编一个对得上的账**。
> 另有 `docs/_p47/pour_time_matrix.csv` 的 mtime 被测试运行刷新，但**内容逐字节未变**（`git status` 里无差异记录）。
未提交 / 未推送 / 未发布；未执行 `git reset` / `checkout` / `clean` / `stash`；未覆盖或删除任何已有工作。
本轮唯一落盘的新增物：`hsSourceNote.js`、`browser_s1_test.mjs`、`phasev20s1_test.mjs`、本报告。

---

## 8. 未解决问题与下一阶段建议

### 8.1 需要你决定（进入 S2 前）

| # | 事项 | 我的建议 |
|---|---|---|
| 1 | **热结状态条悬停调试 tooltip 的中文**（i18n 剩余 4 处的来源） | 二选一：**收进 `?hsDebug=1`**（它本来就是诊断信息，正常模式下用户不需要看到 `gs=25³`）／补英文覆盖。我倾向**收进 debug** —— 但它会改掉一个既有可见行为，属产品决定 |
| 2 | donate 页赞助商署名是否保留中文 | **建议保留**（专有名词，`ALLOW_TEXT` 里已有作者署名的先例，可把赞助商也加进去） |
| 3 | S2 是否按 147 的**方案 D** 开工（左栏取消 → 右面板 + 顶部流程条） | 本轮恢复的内容**都落在现有参数窗口里**，方案 D 落地时这些块需要按 §6 的设计搬家 —— 建议 S2 先把"参数窗口 → 右侧面板"这一步做掉，再谈其余 |

### 8.2 已在 S0 提出、仍需企业回答（本轮未动）

- **1.8 的口径定性**（真出品率 / 含工艺附件 / 本产品专用）—— 需要企业回答，不是技术问题。确定前**产品与指南都不出现 1.8**。
- `LOW_CONFIDENCE` / `INSUFFICIENT_RESOLUTION` 两态文案**已按 §三 定稿并落地**，可直接审阅（见 §2.1 表格）。

### 8.3 下一阶段建议

1. **S2 工作台布局重构**（方案 D）—— 本轮的内容恢复为它铺好了路：所有帮助块都已经是独立的 HTML 生成函数，搬家只需换挂载点。
2. **`p.orig` 语义的一处小张力**（本轮如实记录，未改）：`restoreAutoValue()` 清掉 `orig` 后 `set()` 又立刻重建 —— 结果正确但读起来费解。若将来要动，属于模型层改动，需单独授权。
3. **参考 147 §9 的两层使用指南**：本轮只恢复了"参数帮助"，指南本身还没做。

---

## 9. 本轮做过的核对（可复现）

```bash
# 全量回归（串行，勿并行 —— 性能门限会被抢 CPU 顶红）
node tests/runner.mjs

# 本轮新增
node tests/runner.mjs phasev20s1
node scripts/browser_s1_test.mjs
node scripts/browser_p78_test.mjs
node scripts/browser_i18n_audit.mjs

# 冻结指纹
for f in calcs/riser.js calcs/riserDreq.js calcs/calcManifest.js js/engine/v3/hotspotV3.js \
         js/engine/v3/peakRegion.js js/engine/v3/sampling.js js/engine/v3/modulusField.js \
         js/engine/v3/configV3.js js/engine/meshValidation.js js/engine/v3/v3ViewAdapter.js; do
  printf '%s %s\n' "$(sha256sum $f | cut -c1-8)" "$f"; done
```
