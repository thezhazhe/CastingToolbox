# PHASE 71.6 · Design Center 输入区 / 任务区 / 冒口结果展示修正（76.txt）报告

> 性质：**编排/展示/数据映射修正**，不是重做计算器。gating / riser / yield 核心公式 **0 改动**；
> STL 引擎与 hotspot 算法 **0 改动**。日期：2026-09-10

---

## 一、修改文件

| 文件 | 改动性质 |
|---|---|
| `js/views/designCenter.js` | 删除分析任务选择 UI；参数区重组为 ①②③④⑤ 固定分组；Mc 输入绑定修复；riser 结果写回健壮性；手动模式门禁修复 |
| `js/views/resultsCenter.js` | 结果导航六项；Page2 冒口完整展示（Mc 来源 / D/H / 模数 / 体积校核 / 颈 / 状态 / 结果出处）；出品率页参考依据行 |
| `calcs/calcManifest.js` | **riser 重量语义修正**（cast_wt 取铸件净重）；riser 门禁读用户 Mc 的路径规则；NO_HOTSPOT 文案按 76.txt §十二 措辞；yield 对 blocked riser 的空值健壮性 |
| `css/app.css` | 新增 `.dc-hint-line` / `.dc-src-line` |
| `tests/phase716_test.mjs` | 新增（8 项：固定任务集 / 冒口链路 / 用户 Mc / 采用值 / 恢复 / NO_HOTSPOT / 重量语义 / Page2 展示） |
| `scripts/design_center_test.mjs`、`scripts/browser_test.mjs`、`scripts/browser_stl_p22_test.mjs`、`scripts/browser_dc_715_test.mjs` | 断言随新 UI 结构对齐（任务勾选 → 固定分组；新增 76.txt 案例断言） |
| `docs/PHASE716_REPORT.md` | 本文档 |

**未触碰**：`calcs/gating.js`、`calcs/yield.js`、`calcs/riser.js`（公式）、全部 `js/engine/*`、所有独立计算器视图。

---

## 二、数据流变化

**之前（71.5）**
```
STL 导入 → 自动分析 → [勾选分析任务] → 参数区（①STL ②基础 ③浇注 ④高级）→ 执行 → 结果中心
```

**现在（71.6）**
```
STL 导入 → 自动分析（几何/壁厚/热结）→ 固定工艺设计流程（无勾选）
   │
   ① STL 自动识别（只读 + 可覆盖，orig/↺ 保留）
   ② 基础工艺参数：材料 / 铸造方法 / 造型线 / 型腔数 / 预估出品率   ← 全部默认展开
   ③ 浇注参数：浇注位置 / Ho / ph / 冒口高度                      ← 全部默认展开
   ④ 冒口参数：热节模数 Mc（含来源徽章与 orig 提示）               ← 从"高级参数"移出
   ⑤ 高级参数：仅低频项（当前固定任务集下为空，见 §五）
   ▼
固定任务集执行（RUN_ORDER 内）：shrinkage → machining → riser → gating → yield
   ▼
结果中心六页：① 铸件结构工艺性 ② 冒口设计 ③ 经典浇注系统 ④ 出品率 ⑤ 线收缩率 ⑥ 加工余量
```

固定任务集定义在 `designCenter.js: FIXED_CALC_TASKS`；其余计算器（chill / sandbox / charge /
shakeout / CT / principles / defect_finder / Campbell / 垂直造型线…）**文件与独立入口均保留**，
只是不再出现在设计中心的任务选择/流程中（符合 76.txt §一"删除/隐藏其他计算器任务"）。

---

## 三、冒口 bug 根因（76.txt §三）

冒口"已启用却看不到结果"由**三个独立缺陷叠加**造成，全部已修复并有回归覆盖：

### 根因 1 — 结果写回时对缺失字段解引用（主因，浏览器实测复现）
`designCenter.runAnalysis()` 在 riser 结果写回处直接读 `proj.get('process.riserHeight').src`。
持久化项目（localStorage 中的旧结构）**可能没有 `process.riserHeight` 字段** → `get()` 返回 `null`
→ `TypeError` → 被同一循环的 `try/catch` 吞掉 → `results.riser = null`
→ 结果中心里 "② 冒口设计" 整页消失（用户视角："勾了冒口却没结果"）。
> 修复：写回前判空（`const rh = proj.get(...); if (!rh || rh.src !== USER_OVERRIDE)`）。

### 根因 2 — Mc 输入框的 DOM id 与绑定不一致（用户输入被静默丢弃）
71.5 把 Mc 行从 ① 列迁到独立分组时，元素 id 从 `#dc_p_mc` 改为 `#dc_m_mc`，但绑定仍查旧 id →
`bindParam` 取不到元素直接 `return` → **监听器根本没挂**：用户键入的 Mc 不写项目，
下一次重渲染又被自动值覆盖（实测：键入 20，读回 26，项目仍是自动来源）。
> 修复：按 `#dc_m_mc` 绑定；并在 T8/浏览器用例中断言"手改 Mc → 来源徽章 = 🟠 用户修改"。

### 根因 3 — 门禁读取的用户 Mc 路径与实际写入路径不一致
UI 的 Mc 输入框按场景写入 `mcHotspot`（有热结）或 `wallHot`（无热结），而 riser 门禁只检查
`process.mcHotspot` → 无热结时用户手改的 Mc 被当作"自动 wallHot"，不触发人工放行语义
（等级、说明文案都不对）。
> 修复（保持 28.4-3 既有契约）：有热结 → 认 `mcHotspot`；无热结 → 认 `wallHot`，
> 但当另一参数带**用户覆盖**时仍以用户值为准（不被自动值劫持）。

**附带修复**：`yield.calculate` 在 `riser` 被门禁阻止时解引用 `r.md.rho` 崩溃 → 出品率模块静默消失；
现改为守卫 + 使用 `r.rhoUsed`（阻止时 `riserWt` 如实为 null）。
**附带修复**：手动输入模式被 STL 门禁挡住（`geometry.valid` 默认 false = 无 STL）
→ 门禁只在"本会话导入了 STL"时生效。

**链路闭环结论**：`STL → mcHotspot/wallHot → runRiser() → results.riser → Page2` 全程闭环，
浏览器实测（cube50 均匀件 + 用户 Mc=20）：
`来源：用户输入 Mc = 20 mm → 冒口直径 ⌀132 mm / 高度 H / 体积校核` 均正确渲染。

---

## 四、重量语义检查结论（76.txt §十一）

逐一核对现有 calculator 的重量入参物理含义（读公式，不改公式）：

| 计算器 | 字段 | 需要的物理量（由公式反推） | 结论 |
|---|---|---|---|
| gating | `pw` | 参与 `G = pw×cav÷出品率`、`ya = pw×cav/G`、`castingMass = pw×cav`——都是"浇注重量口径的铸件重量" | **毛坯重** `blankWeightKg`（含加工余量）✅ 保持 |
| riser | `cast_wt` | 仅用于体积校核 `Vc = cw×1e6/ρ`（铸件实际金属体积）与 `needVol = Vc×shrink` | **铸件净重** `netWeightKg` ⚠️ **已修正**（原用毛坯重，会高估所需补缩量） |
| yield | `castWt` | 出品率计算基准（浇注重量口径） | **毛坯重** ✅ 保持 |
| sandbox / shakeout / charge | `wt` | 铸件重量量级估算 / 铁水总重 | 毛坯重量级口径 ✅ 保持（未改动） |

修正影响：`runRiser` 的尺寸 D/H 由 Mc 主导（迭代式），只有"体积校核"一项受影响；
当用户未单独上调毛坯重时 `netWeightKg === blankWeightKg`，**结果不变**；
用户单独上调毛坯重（含余量）后，体积校核不再被余量放大（更符合物理）。
回归锁定：`T7` 断言 gating/yield 取毛坯重、riser 取净重，并给出"毛坯口径会高估所需补缩量"的反向证据。

---

## 五、UI 调整说明（76.txt §四~§十）

- **删除**：③ 分析任务面板（含"可多选"chip、勾选/取消、状态徽标、辅助工具入口）。
  面板顺序变为 `① 分析结果概览 → ② 热结列表 → ③ 参数与执行条件 → ④ 模型信息`。
- **② 基础工艺参数**（默认展开）：材料大类 · 铸造方法 · 造型线 · 型腔数 · 预估出品率。
  预估出品率来自材料表推荐值（🟡 生产场景/默认），标签直接写明"工程预估，非 STL 识别"。
- **③ 浇注参数**（默认展开）：浇注位置（上注/中注/下注，存储值沿用语料 `顶注/中注/底注`）· Ho · ph ·
  **冒口高度**（riser 结果自动回写，可覆盖，覆盖后 gating 重算按用户值）。
- **④ 冒口参数**（默认展开）：热节模数 Mc + 来源徽章 + orig 提示（"STL/自动原值 X · 当前采用 Y · ↺ 恢复"），
  下方一句依据说明（有热结 → 取最大热结；无 → 壁厚/结构参考值估算）。
- **⑤ 高级参数**：只保留"极少修改 / 特殊工艺 / 通常用系统或计算值"的项。**当前固定任务集下为空**
  （76.txt §九 的正确结果：铸件重量/壁厚/Mc 等核心量全部前置常显）。机制保留：未来某计算器新增
  optional 参数时会自动出现在此折叠区。
- **来源标识**（§十）继续保留：🟢 STL 自动 / 🟡 用户输入·默认 / 🔵 自动计算 / 🟠 用户修改（+ ↺ 恢复原值）。
- **结果中心**：Page2 增加 `dc-hint-line` 来源行与 `dc-src-line` 出处行，
  明确"**冒口结果来自现有冒口计算器**，数值未经本页修改"；规模表新增"所需补缩金属量（按净重换算）"行。

---

## 六、测试结果（76.txt §十四）

| 项目 | 结果 |
|---|---|
| 新增 `phase716_test.mjs`（8 项，含真实 cube50 STL 端到端链） | **8/0** |
| 计算器/model 回归（model + phase28x + phase29，第一组） | **84/0** |
| 计算器回归（phase45~70 + phase715 + phase716，第二组） | **136/0** |
| `scripts/design_center_test.mjs`（设计中心端到端，无头 Edge） | **全部通过** |
| `scripts/browser_dc_715_test.mjs`（71.5/71.6 浏览器验收） | **全部通过**（含 Case 1/2/5/6/7 断言） |
| `scripts/browser_stl_p22_test.mjs`（STL 面板/布局） | **全部通过** |
| `scripts/browser_test.mjs`（全站冒烟） | 通过（另 5 项失败为**既有、与本阶段无关**：首页工具数 13→15、CT 文案、2 处计算器列表计数） |

**76.txt §十四 验收案例对照**

| Case | 覆盖位置 | 结论 |
|---|---|---|
| 1 导入 STL 后不再出现"分析任务选择" | `design_center_test` / `browser_dc_715` / T1 | ✅ |
| 2 STL → mcHotspot → runRiser() → Page2 可见实际结果 | T2/T3/T8 + 浏览器（含用户 Mc=20 实测） | ✅ |
| 3 修改 STL 自动重量/壁厚/Mc → 下游用当前采用值 | T4（壁厚、毛坯重、浇注时间联动） | ✅ |
| 4 恢复自动值 → 下游回 STL 原始值 | T5（重量 + 壁厚） | ✅ |
| 5 NO_HOTSPOT 不伪装成可靠热点 | T6 + Page2 来源行 + 状态条口径 | ✅ |
| 6 铸造方法/造型线/预估出品率/浇注位置/Ho/ph/冒口高度常显 | 浏览器 Case 6 断言 | ✅ |
| 7 高级参数只剩低频项 | 浏览器 Case 7 断言（当前为空） | ✅ |
| 8 重量语义正确 | T7（三计算器逐项断言） | ✅ |

**注意（诚实报告）**
1. 长度/存储层面：`production.method` 的"不指定"仍会走 machining 的默认档（砂型·机器造型/壳型）——
   与既有行为一致（非本阶段引入），界面在高级区外已明示"未指定时按…计算"的语义由结果页 methodLabel 体现。
2. `FIXED_CALC_TASKS` 未包含 chill/sandbox/charge/shakeout：勾选时代码路径仍在（manifest/RUN_ORDER 未动），
   若后续产品决定重新纳入，只需把 id 加入该常量。
3. 手动模式下线收缩率/加工余量依赖 `geometry.size`（外形尺寸）——手动模式的 ① 列已含该输入；
   STL 模式下自动来自 STL。

---

## 七、是否 GO

**GO（本阶段目标达成）**：
- 76.txt 三项修正（删任务区 / 冒口结果闭环 / 参数分组）全部落地，冒口链路经浏览器实测确认闭环；
- 核心公式零改动，重量语义按物理含义逐项核对并只修正确有错误的一处（riser cast_wt）；
- 单元 + 浏览器全绿，无运行时异常。

遗留（不改，备案下一阶段）：
1. `tests/real-stl/` 下 ALR2510/lShape 的旧 diag 与当前引擎 no_candidate 的差异（引擎侧回检，独立课题）；
2. 「生成工艺计算报告」尚未包含 Page1 板块与新增的 Mc 来源行；
3. 浇注温度仍无 gating 消费者，保持不新增死输入。
