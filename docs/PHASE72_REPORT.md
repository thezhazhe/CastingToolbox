# PHASE 72 报告 · 核心 UI 中英双语（zh-CN / en-US）

命令文件：`新建 文本文档 (80).txt`
日期：2026-09-10
范围：**只做 UI 文本国际化与语言切换**——公式、计算逻辑、STL 引擎、热结算法、数据流、单位体系、报告生成逻辑一律未改。

---

## 1. 新增 / 修改文件

### 新增
| 文件 | 作用 |
|---|---|
| `js/i18n/index.js` | i18n 核心：`t()` 查表 + 插值、locale 读写、`onChange` 订阅、`applyDom()` 原地翻译静态节点 |
| `js/i18n/zh-CN.js` | 中文词条表（语义 key 的中文基准 + 长句中文原文） |
| `js/i18n/en-US.js` | 英文词条表（796 条） |
| `js/i18n/viewState.js` | 换语言时的视图状态保全（表单快照/还原 + 重算钩子 + 示例标抑制） |
| `tests/phase72_test.mjs` | T1~T12（12 项） |
| `scripts/browser_p72_test.mjs` | 浏览器验收 A/B/C/D/E/F/G + H（26 项） |
| `scripts/shot_p72.mjs` | 中英对照截图（`screenshots/p72_*.png` 8 张） |
| `scripts/i18n_audit.mjs` | 词条覆盖率审计（开发/CI 用，`node scripts/i18n_audit.mjs`） |

### 修改（均为显示层）
`index.html`（外壳 data-i18n + 语言切换器）· `css/app.css`（切换器样式）· `js/app.js`（切换接线 + 重渲染）·
`js/context.js`（场景条/材料下拉显示）· `js/views/`：`home.js` `calculators.js` `designCenter.js` `resultsCenter.js`
`processPage1.js` `gatingView.js` `riserView.js` `smallCalcs.js` `donateView.js` `gatingDiagram.js` `exampleTag.js`（抑制开关）

> `calcs/`、`js/engine/`、`js/model/`、`data/` **零改动**。

---

## 2. i18n 架构说明

**核心原则：中文原文即 key。** `t('冒口设计') → 'Riser Design'`。

```
t(key, vars) 查表顺序：  en-US[key] → zh-CN[key] → key 本身
```

* **为什么这样做**：80.txt §19 要求"英文缺译 → 显示中文原文，绝不出现 undefined / translation key"。
  以中文原文为 key，任何未收录文案**自动**回退成中文，从机制上不可能泄漏 `undefined` 或 `riser.title` 这类 key。
* **语义 key 并存**：全局骨架文案用语义 key（`t('nav.home')`、`t('dc.params')`），中文基准写在 `zh-CN.js`；
  两类 key 共用同一个 `t()`，不需要两套 API。
* **插值**：`t('{n} 个', [3])`（位置）/ `t('gel.velNote.target', {t, v})`（命名），词条值也可以是函数。
* **长句**（含标签或多变量、中文原文过长易抄错）统一用语义 key，中英各自完整文本在词条表里。

**语言切换只做两件事**：
1. `applyDom(document)` —— 外壳（侧栏/顶栏/弹窗/场景条）标了 `data-i18n` 的节点原地换文案，**不重渲染**。
2. 当前视图：**声明支持换语言的视图**才重渲染——先快照 `#view` 内全部表单控件值 → 重渲染（文案变英文）
   → 把快照值写回 → 调该视图注册的重算钩子重新生成结果区。

**关键取舍（保护 80.txt §十八 硬性要求）**：
* 还原时**不回放 input/change 事件**（回放会把"重渲染"误判成"用户改过"：示例标被清、设计中心 select 触发整组重渲）；
  重算只走视图显式注册的钩子（`setRecompute(update)`），因此**数值是同参数纯函数重算，与切换前逐个字段一致**。
* 未声明支持的视图（非核心工具、知识库）**不重渲染**，整页保持原状（符合 §十七）。
* i18n 层不 import `calcs/` `data/` `engine/`（有测试守住），locale 单独存 `castingToolbox.locale`，与项目数据完全隔离。

---

## 3. 翻译覆盖范围

| 区域 | 状态 |
|---|---|
| 侧栏导航 / 顶栏 / 各弹窗 / 生产场景条 | ✅ 完整英文 |
| 首页（搜索、生产场景表单、工具卡、推荐区标题、向导入口、toast） | ✅ 完整英文 |
| 计算工具列表（6 分类名 + 简介 + 15 个工具名/简介/徽章） | ✅ 完整英文 |
| 设计中心（导入区、3D 控件、概览三组 12 卡、热结列表、参数五组、来源徽章、状态条、进度阶段、全部 toast/warning、三页结果、校核、结果导航） | ✅ 完整英文（本阶段重点） |
| 浇注系统 / 冒口设计 / 线收缩率 / 加工余量 / 出品率 五个核心计算器（区块标题、全部字段与结果行、判定、图例、示意图 SVG 文字） | ✅ 完整英文 |
| 数据取值显示层（材料大类和牌号、浇注方向、造型线、铸造方法、生产方式、收缩档位、冒口形状、公差/余量相关枚举） | ✅ 英文（**只翻显示文本，option value 仍是原中文数据键**） |
| 工艺向导 / 冷铁 / 砂型 / 加料 / 开箱 / CT / 原则 / 缺陷查找 / Campbell / 垂直造型线 | ⛔ 内部保持中文（§十七）；**名称与入口在首页/列表已英文化** |

---

## 4. 已经完整英文的页面

`#/home` · `#/calculators`（列表）· `#/calculators/{gating,riser,shrinkage,machining,yield}` ·
`#/designCenter`（含结果中心三页）· `#/donate` · 全局外壳与全部弹窗。

## 5. 暂时保持中文的内容（明确边界，非遗漏）

1. **知识库卡片与搜索结果**（§十六）——英文界面下搜索页顶部会显示
   *"Knowledge Base content is currently available in Chinese."*，不让用户误以为坏了。
2. **计算器「说明与依据」长技术正文 / 公式表 / 数据来源**（标准条文、手册出处）——英文界面下顶部显示
   *"Technical notes and data basis below are currently provided in Chinese only."*。
3. **计算器生成的"建议条目"**（`sugs`）与部分 `note`：由计算器内部按数值插值生成（如
   `⚠️ 内浇口平均流速 1.11 > 1 m/s（目标 1）偏高`）。它们属于 `calcs/` 的**输出数据**，
   且被 6 个已冻结的回归文件断言（phase283c / 48b / 50 / 45a / 52 …）——改字符串会破坏冻结回归（§2 禁止改计算器核心）。
   建议下一阶段用"计算器输出模板层"统一处理，而不是在本阶段动 `calcs/`。
4. **计算记录 / 工艺计算报告（下载与打印的 HTML）**：属导出文档（与知识库同口径），保持中文。
5. **作者署名、QQ 群、邮箱、标准号（GB/T 6414 等）、工程变量（Mc/Ho/ph/D/H/V/ρ/t）、单位、公式**：按 §十四/§十五 不译。

---

## 6. 语言持久化

* 键：`localStorage['castingToolbox.locale']`，取值只有 `zh-CN` / `en-US`（§三/§五）。
* 无存档或值非法 → `zh-CN`；启动时 `initLocale()` 读取并设置 `<html lang>`；切换即写盘。
* 不引入账户同步、不写入任何项目字段（`ct-project` 与 `ct-context` 一字未动）。

---

## 7. 测试结果

| 项目 | 结果 |
|---|---|
| `node tests/runner.mjs "phase72"` | **12 / 0** |
| 设计中心组（model, phase78, phase79, phase715~717, phase72, phase45） | **66 / 0** |
| 计算器组（phase47~52, 63, 65, 70, 29, 283, 284） | **106 / 0** |
| `node scripts/i18n_audit.mjs` | ✅ 796 条 key 全部有对应词条 |
| `scripts/browser_test.mjs`（全站冒烟） | ✅ 全部通过 |
| `scripts/browser_p78_test.mjs` / `browser_dc_715_test.mjs` / `design_center_test.mjs` / `browser_stl_p22_test.mjs` | ✅ 全部通过 |
| `scripts/browser_p72_test.mjs` | ✅ 26 项全过，0 运行时异常 |

T1 默认中文 · T2 切英文核心 UI 英文 · T3 缺译回退中文 · T4 词条完整 · T5 英文无残留中文 · T6 插值 ·
T7 项目数据不变 · T8 计算结果不变 · T9 source/orig 不变 · T10 知识库数据未改 · T11 公式与变量未改 · T12 无 undefined/key 泄漏。

## 8. 浏览器验收结果（§二十一）

**中文**：首页 → 计算器（浇注系统）→ 设计中心（手动模式全链 + 结果三页）全部正常。
**点 English**：页面标题、参数、按钮、状态、Warning、结果、source 徽章、导航**全部英文**，
参数值与结果数字序列与切换前**完全一致**，项目数据序列化前后一字未动。
**English → 中文**：恢复正确，来回切换参数不丢（`#g_pw=52.5` 保持）。
**刷新**：语言保持 English（localStorage）。
**非核心工具**（冷铁）：切语言后页面保持原状，仅外壳变英文（符合 §十七）。
截图：`screenshots/p72_01..08`（中文/英文对照）。

## 9. 结论

**GO。**

* 80.txt 全部硬性要求满足：不刷新切换、当前语言高亮、localStorage 记忆、默认中文、
  `t(key)` 统一取词、缺译回退中文、切换不影响参数/结果/source/orig、知识库数据未动、公式与变量未动。
* 未越界：`calcs/` `js/engine/` `js/model/` `data/` 零改动；没有新增计算器、没有改报告生成、没有引入依赖。
* 遗留（非阻断，已在 §5 逐条说明）：知识库/长技术正文/计算器建议条目/导出报告保持中文——
  若需要，建议作为 **PHASE 73：计算器输出模板层 + 知识库双语**单独立项，避免在本阶段动冻结的 `calcs/`。
