# PHASE V2.0 · 设计中心有限 H/D 开放 · 最小实现方案与影响清单

> **★ 2026-10-21 实施状态**：本方案已随 **R6-S5（158.txt）** 落地。
> 实际结果：H/D 0.8/1.0/1.2/1.5，默认 1.0；球形 H≡D；`calcs/riser.js` 一行未改；
> 唯一冻结改动 `calcManifest.js` 读取 `process.hdRatio`，指纹 `e8d4d9a5 → 3bfc3e16`。
> 最终测试：Node 全量 **902/1**（唯一历史 `phase24 T5`）、H/D 专项 6/0、S5 浏览器 31/0。
> 详见 `docs/PHASE_V2.0-P1-R6-S5_REPORT.md`；本文件保留为**实施前的方案与授权依据**。

> **性质**：方案与影响清单。**本文件不包含生产代码改动**。
> **基线**：`main` / `da1c822` / 工作区 133 项（41 M + 92 ??）。
> **冻结指纹**：10 项已复核；`calcManifest.js = e8d4d9a5`，其余 9 项与交接书 §B.6 逐位一致。
> **依据**：`docs/PHASE_V2.0_HANDOFF_2026-10-21.md` §D.4 / §G.2；`docs/PHASE_V2.0-P1-R6-S3_WORKBENCH_FLOW_REPORT.md` §5；当前代码实测。
> **状态**：**待授权**。获得授权前不改 `calcs/**`、`js/engine/**` 与任何生产代码。

---

## 0. 结论（先看这 9 条）

1. **`calcs/riser.js` 不需要改**：它已经接受任意正 `hd_ratio`，且球形 `H ≡ D`、球顶柱 `H ≥ R`（`riser.js:180-182`、`219-224`）。
2. **唯一冻结改动是 `calcs/calcManifest.js:280` 一行**：把硬编码 `hd_ratio: 1.0` 改为读取 `process.hdRatio`（缺省 1.0）。这不是修改 `riser.js` 的算法，只是把既有入参接到设计中心。
3. **新增项目参数 `process.hdRatio`**：默认 `1.0`、`editable`；旧项目由 `mergeDeep(defaultProject(), saved)` 自动补齐，不需要迁移函数。
4. **UI 四档**：`0.8 / 1.0 / 1.2 / 1.5`，默认 `1.0`；与独立冒口计算器一致；不新增 `2.0`。
5. **球形不提供 H/D 输入**：`H ≡ D`；已保存的 hd 值保留但不参与几何，不静默清零（切回柱形时仍是用户上次的选择）。
6. **`hd = 1.0` 时，设计中心结果必须与当前逐位一致**（D/H/Vr/Mr_act 全部不变）。这是本阶段的硬验收。
7. **交接书里“需要重新基线化 49 个历史 riser 用例”是保守表述**。这 49 个是 V2.0-22 已重基线的历史期望，测试直接调用 `runRiser` 且显式传 `hd_ratio: 1.0`；本方案默认路径仍为 1.0，**预期 0 例变化**。以全量回归证明；任何一例变化都视为“默认值泄漏”，停止排查，不得改期望制造通过。
8. **必须同步更新的旧口径**：结果页“设计中心固定 hd = 1.00 / 四形状 M = D/6”只在 hd=1 时成立；H/D 开放后这段说明和两条浏览器断言（`browser_s3`、`browser_s22`）必须按新契约改写，不能保留假结论。
9. **不改**：`MODULUS_TARGET_RATIO = 1.2`、体积校核逻辑与“体积失败不放大冒口”、独立计算器、保存/分析分离契约、`optionalInputs` 的 calculator 作用域、最终实重出品率（仍 `null`）。

---

## 1. 事实基线（当前代码实测）

| 事实 | 证据 |
|---|---|
| 设计中心 riser 调用硬编码 `hd_ratio: 1.0` | `calcs/calcManifest.js:280` |
| 设计中心形状读取 `process.riserShape`，非法回退 `cyl` | `calcs/calcManifest.js:277` |
| `runRiser` 接受任意正 hd；缺省 1.0 | `calcs/riser.js:180-182` |
| `H = round(D × hd)`；球顶柱 `H ≥ R`；球形 `H = D` | `calcs/riser.js:219-224` |
| 独立计算器四档 0.8/1.0/1.2/1.5；球形隐藏选择器 | `js/views/riserView.js:90-102`、`208-216` |
| 设计中心 H/D 当前只读 1.00 | `js/views/designCenter.js:1003-1010` |
| 参数窗口字段表；形状字段 | `js/views/designCenter.js:698-745`（形状在 715） |
| 下拉草稿写入口；改回原值即删除草稿 | `js/views/designCenter.js:1100-1121` |
| 形状变化就地刷新帮助 | `js/views/designCenter.js:1120-1123` |
| 结果页 H/D 行与“固定 1.00”说明 | `js/views/resultsCenter.js:160`、`185`、`196-197` |
| 报告冒口统计表（当前无 H/D 行） | `js/views/reportGenerator.js:231` |
| 结果事实中的 hd 是 `H / D`（实际值） | `js/views/resultFacts.js:146` |
| 模型默认值位置 | `js/model/CastingProject.js:97`（`riserShape`） |
| 深合并会补齐新字段 | `js/model/CastingProject.js:160-188` |
| `PARAM_OWNERS` 只登记带 `param` 的输入；shape/hd 不在表内 | `js/views/designCenter.js:54-59`；`calcs/calcManifest.js:182-187` |

---

## 2. 产品口径（本方案建议值）

| 项 | 决定 | 理由 |
|---|---|---|
| 可选比例 | `0.8 / 1.0 / 1.2 / 1.5` | 与独立计算器一致；不发明新档位 |
| 默认 | `1.0` | 兼容现有全部结果；`hd=1` 是当前唯一口径 |
| 存储 | `process.hdRatio`，number，`SRC.DEFAULT / CONF.LOW / editable` | 与 `process.riserShape` 同构；来源徽章/草稿/保存语义复用 |
| 球形 | UI 隐藏 H/D，结果/报告写 `H ≡ D` | 球只有一个尺寸自由度；hd 不改变几何 |
| 球顶柱 | 四档都可用 | 四档均 ≥ 0.8 > 0.5，`H ≥ R` 的兜底不会被触发；`H = round(D×hd)` |
| 显示 | 显示**实际** `H/D`（= `H / D`，2 位小数）；与名义值不同时括号标“名义 1.50” | 取整后实际比值与名义值可差 ≤ 0.5/D，不能把名义值当实际值 |
| 失效范围 | 保存 H/D 后旧结果标过期；因无 `PARAM_OWNERS` 映射，走 `markAllStale()` | 与形状字段现状一致；宁可多标，不可漏标 |
| 形状切换 | 不重置已保存的 hd | 用户切到球形再切回柱形，不应丢掉上次选择；球形只是不使用它 |

**不支持**：把 hd 传给球形、给球形伪造 H/D 输入、在结果页另开第二套 H/D 输入、新增 2.0、按 hd 自动改 Mc/目标模数。

---

## 3. 最小实现（逐文件）

### 3.1 `js/model/CastingProject.js`（新增字段，非冻结）

在 `process` 内、`riserShape` 之后加一行：

```js
hdRatio: P(1.0, SRC.DEFAULT, CONF.LOW, true),   // 冒口 H/D（设计输入；球形不使用）
```

- 旧项目：`mergeDeep(defaultProject(), saved)` 自动补 `1.0`，**不需要** `migrateProject` 分支。
- `proj.set('process.hdRatio', v)` 首次从默认值改动时会按既有规则标 `USER_OVERRIDE` 并固化 `orig`；参数面板不提供 `restore` 入口（与 `riserShape` 一致）。
- UI 只写 number；`calcManifest` 读取时再做一次有限性/正值兜底。

### 3.2 `calcs/calcManifest.js`（**冻结文件，需授权**）

只在 riser 的 `calculate` 内、`runOne` 之前增加读取与兜底，并把 `hd_ratio` 改为该值：

```js
const hdNum = Number(proj.getV('process.hdRatio'));
const hdRatio = Number.isFinite(hdNum) && hdNum > 0 ? hdNum : 1.0;   // 旧项目/脏数据回退 1.0

const runOne = (mcVal) => runRiser({
  mat: fam, cast_wt: castWt,
  mc_mode: 'direct', mc: mcVal, shape: riserShape, hd_ratio: hdRatio, eff: undefined, rho,
});
```

- 旧项目 `process.hdRatio` 不存在 → `Number(undefined) = NaN` → `1.0` → **数值逐位不变**。
- 非法/0/负值（手改 localStorage）→ `1.0`，不会让设计中心整块返回 `null`。
- **不限制**为四档：UI 是唯一正常入口；`runRiser` 本身接受任意正 hd。若后续要求“只允许四档”，需另立产品决定，不在本最小方案内。
- 不改 `optionalInputs` 的 `hd_ratio`（它仍是独立计算器的 `scope: 'calculator'` 入参）；不改 `RISER_SHAPES`、目标模数、体积段。
- 预期新指纹：待实施后计算并记录；其余 9 项应保持不变。

### 3.3 `js/views/designCenter.js`（参数面板）

1. **字段表**（`paramFields()`，紧跟 `process.riserShape`）：

```js
{ mod: 'riser', path: 'process.hdRatio', label: tr('H/D（高度 / 直径）'), kind: 'select',
  numeric: true, hdRow: true,
  options: [['0.8', '0.8（矮胖）'], ['1.0', '1.0（适中）'],
            ['1.2', '1.2（瘦高）'], ['1.5', '1.5（细长）']],
  hint: tr('设计输入：改变 H/D 会改变 D、H 与 Vr；保存后点顶部 ④「分析」才更新结果。') },
```

2. **下拉渲染**（`fieldHtml()` 的 select 分支）：让 `options` 同时接受字符串与 `[value, label]` 二元组，现有字段行为不变：

```js
opts = (f.options || []).map(o => Array.isArray(o) ? [o[0], tr(o[1])] : [o, tr(o)]);
```

3. **草稿写入口**（`data-pf` handler）：`select` 且 `f.numeric` 时 `val = parseFloat(raw)`；非有限 → 不写草稿/保持原值。这样与 `proj.getV` 的 number 比较不会产生“1.0 vs '1.0'”的幽灵草稿。

4. **替换只读块**（当前 `1003-1010` 的 `data-hd-readonly`）：
   - 非球形：字段本身是下拉；下方一句短说明（H/D 是设计输入；保存后 ④ 分析）+ 折叠的“取值范围来自独立计算器”说明。
   - 球形：隐藏 H/D 字段，显示 `data-hd-readonly` 的说明 `球形冒口由球径唯一确定（H ≡ D）；H/D 不参与几何。`，并保留“切回柱/方/球顶柱可调”的提示。
   - 用 `hidden` 属性；`.dc-ws [hidden] { display: none !important; }` 已存在（`css/app.css:988`），不会再被类选择器盖掉。不要只用 `style.display`。

5. **与形状联动**：
   - 初始渲染：按“草稿形状 ?? 已保存形状”决定 H/D 字段是否隐藏。
   - `shapeRow` 的 change handler 里，更新形状帮助后再同步 H/D 的隐藏状态（不重渲染整面板，保留焦点/滚动）。
   - 切换形状**不删除** `process.hdRatio` 草稿，也不把它重置为 1.0。

6. **保存/分析**：完全复用现有契约。保存只写参数 → `markChangedStale` → 结果过期；顶部 ④ 才分析。H/D 没有 `PARAM_OWNERS` 映射，`markChangedStale` 会走 `markAllStale()`（与形状相同），可接受且安全。

7. **不在结果页新增第二个 H/D 输入**：唯一编辑入口仍是 ③ 参数面板。

### 3.4 `js/views/resultsCenter.js`（结果页）

1. **H/D 行**（`196-197`）：
   - 球形：`H ≡ D（球形由球径唯一确定）`。
   - 非球形：`实际 H/D {H/D:.2f}`；若与结果对象的 `it.hd`（名义值）不同，加 `（名义 {it.hd:.2f}）`。删除“设计中心当前固定 hd = 1.00；H/D 可调仅在独立冒口计算器中支持”。
   - `hdTxt` 继续用 `f.hd`（`resultFacts` 的 `H/D`），不要用 `it.hd` 代替实际值。

2. **形状差异说明**（`185`）：
   - 仅当 `|实际 hd − 1| < 1e-9` 时保留“四形状 M = D/6，换形状不改变 D/H”的结论；
   - 否则改为“当前 H/D = {hd}，不同形状的模数式不同，D/H 会随形状变化；体积/补缩效率也随形状变化”。这是新文案，不得让旧结论在 hd≠1 时继续显示。

3. 多热结列表：每个 item 的 H/D 来自各自的 `H/D`；同一次分析通常相同，但不要用主结果的 hd 覆盖。

### 3.5 `js/views/reportGenerator.js`（导出报告）

在冒口统计表（`231`）中、`冒口尺寸` 之后增加一行：

```js
stat('H/D（高度 / 直径）',
  r.shapeKey === 'sphere' ? 'H ≡ D（球形）'
    : `${(r.H / r.D).toFixed(2)}` + (Math.abs(r.hd - r.H / r.D) > 0.005 ? `（名义 ${r.hd.toFixed(2)}）` : ''))
```

- 报告是中文单语，不需要 i18n。
- 多热结表可增加同一列或仅在汇总表显示；建议只在汇总表加，避免 6 列表格过宽。
- 不改报告的可靠度、未收敛警告、旧体积参考说明。

### 3.6 `js/i18n/en-US.js`（中英文同步）

新增/更新词条（中文原文即 key）：

- `H/D（高度 / 直径）`
- `0.8（矮胖）` / `1.0（适中）` / `1.2（瘦高）` / `1.5（细长）`（若复用 riserView 现有词条则直接引用）
- `设计输入：改变 H/D 会改变 D、H 与 Vr；保存后点顶部 ④「分析」才更新结果。`
- `H/D 可选范围与独立「冒口设计」计算器一致：0.8 / 1.0 / 1.2 / 1.5。`
- `球形冒口由球径唯一确定（H ≡ D）；H/D 不参与几何。`
- 结果页“当前 H/D = {hd}，不同形状的模数式不同，D/H 会随形状变化……”（中文原文即 key，带占位符）
- 实际/名义 H/D 的括号文案。

删除或保留为死词条（不渲染）：
- `只读 · 设计中心固定`
- `为什么设计中心不能调 H/D`
- `设计中心当前固定 hd = 1.00；H/D 可调仅在独立冒口计算器中支持`
- `独立「冒口设计」计算器支持按形状调整 H/D；设计中心这条计算链在 calcManifest 中固定 hd_ratio = 1.0……`

建议实施时删除这些死词条（中英文两侧），避免下次审计误以为它们仍是有效口径；若担心其他入口引用，先 grep 全仓再删。

---

## 4. 影响清单

| 文件 | 改动 | 冻结 | 风险 | 必须验证 |
|---|---|---|---|---|
| `calcs/calcManifest.js` | 读取 `process.hdRatio`，替换硬编码 1.0 | **是** | 设计中心计算语义；指纹变化 | `hd=1` 全量数值不变；新指纹记录 |
| `js/model/CastingProject.js` | 新增 `process.hdRatio` 默认 1.0 | 否 | 旧项目深合并；脏数据 | 旧 localStorage 项目加载后为 1.0 |
| `js/views/designCenter.js` | 字段、下拉、数字草稿、球形隐藏、形状联动 | 否 | 焦点/草稿/隐藏/保存契约 | 保存不分析；④ 分析；球形无输入；移动端 |
| `js/views/resultsCenter.js` | H/D 实际值；形状差异说明条件化 | 否 | 旧结论在 hd≠1 时变假 | hd=1 与 hd≠1 两种文案 |
| `js/views/reportGenerator.js` | 增加 H/D 行 | 否 | 表格宽度/同源 | 页面/报告 H/D 一致 |
| `js/i18n/en-US.js` + `zh-CN.js` | 新词条；清理旧口径 | 否 | 英文遗漏 | `browser_i18n_audit` 0 遗漏 |
| `scripts/browser_s3_test.mjs` | “只读 H/D=1.00”断言改为新契约 | 否 | 旧契约被取代 | 新断言覆盖四档/球形 |
| `scripts/browser_s22_test.mjs` | 形状等价说明断言限定 hd=1 | 否 | 旧结论不能无条件成立 | hd=1 与 hd≠1 分别断言 |
| `tests/phasev20hd_test.mjs`（新增） | H/D 契约与数值不变量 | 否 | 新测试不得复制输出当期望 | 4 形状 × 4 比例 + 默认路径 |
| `scripts/browser_hd_test.mjs`（新增） | 真实浏览器保存/分析/球形/英文/移动端 | 否 | CDP 环境 | 全部通过 |
| `tests/engineering-generated/BASELINE.md` | 追加指纹与测试记录 | 否 | 文档 | 与实测一致 |

**不改**：`calcs/riser.js`、`calcs/riserDreq.js`、`js/engine/**`、`js/views/riserView.js`（独立计算器现有行为）、`js/views/wizard.js`（它已有自己的 H/D 入口）、`css/app.css`（除非参数面板需要一行样式；优先复用现有类）。

---

## 5. 重基线范围（对交接书 §D.4 的更正）

### 5.1 49 个用例是什么

`tests/engineering-generated/BASELINE.md:1150` 记录：V2.0-22 因“目标模数规则”授权变更，**重新基线化 15 个文件、49 个用例**。逐条名单在 `docs/PHASE_V2.0-22_MODULUS_TARGET.md §6.2`，涉及：
`phase59 / 715 / 2008 / 2008final / 716 / 717 / 2010 / 2011 / 2013 / 2015 / 2016 / 2018 / 2019 / 2021` 等。

这些用例的期望是 **V2.0-22 之后的当前期望**，不是“等待 H/D 的旧期望”。它们直接调用 `runRiser`，多数显式写 `hd_ratio: 1.0`（例：`tests/phase59_test.mjs:58`、`tests/phase715_test.mjs:192`、`tests/phasev2013_test.mjs:28`）。设计中心路径的测试也不设置 `process.hdRatio`，深合并后为 1.0。

### 5.2 本方案预期

| 场景 | 预期 |
|---|---|
| 全部直接 `runRiser(..., hd_ratio: 1.0)` 的用例 | **逐位不变** |
| 设计中心 riser 路径（旧项目无 `process.hdRatio`） | **逐位不变**（读取回退 1.0） |
| 球形 | **逐位不变**（hd 本来就不改变几何） |
| 新增 hd≠1 的用例 | 只存在于新测试文件，需要有依据的新期望 |

⇒ **重基线数量：预期 0。** 不预先改动任何历史期望。

### 5.3 执行时的证明方式

1. 实施前空载跑一次 `node tests/runner.mjs`，保存汇总（基线：896/1，唯一历史失败 `phase24 T5`）。
2. 实施后空载再跑一次；对比通过数/失败名单。
3. 专项回跑 49 用例所在文件（至少 §6.2 名单）与冒口相关文件。
4. 若任何 `hd=1` 用例的 D/H/Vr 变化 → **停止**，按“默认值泄漏”排查：
   - `process.hdRatio` 是否被错误写成非 1.0；
   - `Number()` 兜底是否把合法值变成 1.0 或反之；
   - 是否误改了 `runRiser` 的 `hd` 缺省；
   - 是否在测试夹具中注入了 hd。
5. **不得**通过改期望、放宽容差、跳过用例来恢复绿色。

---

## 6. 验收清单（实施后）

### 6.1 数值

- [ ] `hd=1.0`：四形状、代表 Mc 区间的 D/H/Vr/Mr_act 与实施前逐位一致。
- [ ] 四形状 × 四比例：`H = round(D × hd)`；`Mr_act ≥ Mr_target`；D 是最小可行整数档。
- [ ] 球形：无论 hd 存什么，`H = D`，结果与当前一致。
- [ ] 球顶柱：四档均满足 `H ≥ R`（0.8 档不会触发兜底；仍要断言）。
- [ ] 体积校核/`volOk` 仍只是旧模型参考，不参与定尺寸。
- [ ] 旧项目/缺失/非法 hd → 1.0，不返回 `null`。

### 6.2 UI 与口径

- [ ] ③ 冒口设计可见 H/D 四档；默认 1.0；改变后保存 → 结果过期；点 ④ 才分析。
- [ ] 球形隐藏 H/D 输入并显示 `H ≡ D`；切回柱/方/球顶柱恢复选择器，且保留上次 hd。
- [ ] `hd=1` 时结果页仍可显示“四形状 M=D/6”的等价结论；`hd≠1` 时不得再显示该结论。
- [ ] 结果页与报告的实际 H/D 一致；球形写 `H ≡ D`；无 `undefined / NaN / [object Object]`。
- [ ] 中英文同步；`browser_i18n_audit` 0 遗漏。
- [ ] 390×844 参数面板无横向溢出；H/D 字段隐藏/显示不破坏布局。

### 6.3 回归

- [ ] Node 全量：预期 `896/1`（唯一历史 `phase24 T5`）；无新增失败。
- [ ] 新增 Node H/D 专项全绿。
- [ ] 新增浏览器 H/D 专项全绿。
- [ ] `browser_s1/s22/s3/s31/s4/dc_715/p78/dc_r3/responsive` 等相关回归全绿（历史失败除外）。
- [ ] 10 指纹：9 项不变，`calcManifest.js` 新指纹有记录。

---

## 7. 风险与处理

| 风险 | 影响 | 处理 |
|---|---|---|
| 改冻结文件 | 违反 P0-22 边界 | 本方案即授权申请；只改 riser 调用的一处读取，不改算法 |
| 旧项目无 `process.hdRatio` | 读取到 undefined | `Number()` + 有限性/正值兜底 1.0；旧项目深合并补默认 |
| 脏数据 0/负/字符串 | 设计中心冒口整块 null | 兜底 1.0；不允许非法值进入 `runRiser` |
| 下拉值类型 string vs number | 幽灵草稿、来源徽章异常 | `numeric: true` + `parseFloat`；与 `proj.getV` 的 number 比较 |
| `PARAM_OWNERS` 无映射 | 保存 H/D 后全部模块标过期 | 接受（与形状现状一致）；不为此改 calcManifest 元数据 |
| 旧文案“固定 1.00” | hd≠1 时是假陈述 | 结果页条件化；删除死词条；更新两条浏览器断言 |
| 名义值 vs 实际值 | 显示 1.50 但实际 H/D=1.49 | 显示实际 `H/D`，必要时括号标名义值 |
| 球形存了非 1 hd | 误以为球形仍按该 hd | 球形 UI 隐藏+说明；结果写 `H ≡ D`；不篡改存储 |
| 测试重基线冲动 | 把默认值泄漏洗成新期望 | 预期 0 例；任何 hd=1 数值变化先停 |

---

## 8. 实施顺序与规模

1. 模型字段（约 2 行）。
2. `calcManifest` 读取与兜底（约 3-4 行，冻结）。
3. 参数面板字段/下拉/数字草稿/球形隐藏/形状联动（约 60-90 行）。
4. 结果页与报告（约 20-40 行）。
5. i18n 新词条与旧口径清理（约 10-15 条）。
6. 新增 Node 专项（约 120-160 行）+ 浏览器专项（约 100-140 行）。
7. 全量回归、指纹、`BASELINE.md` 记录、报告。

预计一个阶段可完成；不需要重构工作台，不需要改独立计算器，不需要改引擎。

---

## 9. 需要用户确认的事项（授权点）

1. **是否授权修改冻结文件 `calcs/calcManifest.js`**（仅 riser 调用读取 `process.hdRatio`，默认 1.0）。
2. **比例集合与默认值**：`0.8 / 1.0 / 1.2 / 1.5`，默认 `1.0`（与独立计算器一致）。
3. **球形策略**：不提供 H/D 输入、结果写 `H ≡ D`；已存值保留但不用。
4. **49 个历史用例**：按“预期 0 例重基线”执行；若 hd=1 有变化则停止报告，不擅自改期望。
5. **不提交、不推送、不发布、不改版本号**（与交接书一致）。

确认后按 §8 顺序实施；实施前先重算一次冻结指纹并在报告中记录。
