# PHASE 87 · V1.1 收口审计 + 剩余事项清理

> 命令文件：`D:\CDXProject\新建 文本文档 (87).txt`
> 日期：2026-09-23　项目：`D:\CDXProject\CCproject\CastingToolbox`
> 原则：**先盘点，再修改。已经完成的不碰。不确定的只报告不开发。核心算法优先冻结。**
> **Hotspot 到此收工。**

---

## 1. PHASE 86 是否正式收口

# YES

三重核验：

| 项 | 结果 |
|---|---|
| `git status --porcelain -- js/engine/` | **无输出** |
| 引擎 7 文件 sha256 | 与 PHASE 84/85 记录**逐位一致**（`d774532a` `b8d3ab9e` `5957831c` `ad80da9d` `80a763ef` `5af64ae4` `1e3d96cc`） |
| 显示层算法 | `designCenter.js`：`representative → 向 peak 拉近 → ≤1×Mpeak → displayCenterFor() → displayPosition`，`DISPLAY_PULL_K = 1.0` 定义 1 处、引用 1 处 |
| 遗留实验代码 | **无**。S0/S1/S2/S3 只在注释里作为选型依据被引用，**没有任何未使用的策略函数、参数或 debug 分支** |
| 多余参数 | **无** —— 只有一个常数 `DISPLAY_PULL_K` |

`geometrySource` 技术债按 §五 **只记录不修**（见 §4）。

---

## 2. 本阶段到底修改了什么

**有生产修改**，全部属于 §七「可以直接改」的那一类（文案/中英文/冗余），**没有触碰任何被禁止项**。

| 文件 | 改了什么 | 为什么 |
|---|---|---|
| `js/views/designCenter.js` | ① `单位：{u}（…按 {u} 计）` 补第二个实参 ② 网格问题文案按 `code` 走 i18n（新增 `MESH_ISSUE_TEXT` + `meshIssueText()`） | ① **真 bug**：数组插值按顺序替换，只传了 1 个 → 页面显示"**按 计**"（空）② 英文界面下这段整块是中文 |
| `js/i18n/en-US.js` | 新增 **20 条**英文词条（8 条网格问题 + 9 条进度阶段 + 3 条已有但没生效的尺寸档已在库） | 补英文覆盖 |
| `js/views/processPage1.js` | `mw.bucketLabel` 外面补 `tr()` | 见 §3.2 |
| `js/views/smallCalcs.js` | 同上（用 `t()`，该文件没引 `tr`） | 见 §3.2 |
| `.gitignore` | `_edge_profile*/` → `_edge_*/` | 见 §5 |

**未改**：`js/engine/` 任何文件 · `calcs/` 任何公式 · `data/` 数据结构 · `js/views/donateView.js`（PHASE 83 成果，本阶段未动）· 版本号 · 测试口径 · GT。

---

## 3. Design Center 审计（§六/§七）

### 3.1 审计方式

载入带网格警告的真实模型（t03）→ 中文扫一遍、切英文再扫一遍，按选择器定位残留中文；
另写两个只读扫描器查 i18n 结构性问题（占位符个数 vs 实参数、重复占位符）。

### 3.2 查出并修掉的 3 类问题

**① 文案 bug —— 占位符参数给少了（真 bug，不是风格问题）**

```js
tr('单位：{u}（STL 无单位，按 {u} 计）', [state.unit])   // ← 两个 {u}，只给了 1 个
```
`t()` 的数组插值是**按顺序**替换的，第二个 `{u}` 取到 `undefined` → 渲染成空字符串。
**页面实际显示：`单位：mm（STL 无单位，按  计）`**。
→ 已修（传 `[state.unit, state.unit]`），现在显示 `单位：mm（STL 无单位，按 mm 计）`。

> 顺带做了全项目扫描：**含重复占位符的文案共 4 条，只有这 1 条是真 i18n 文案**，另外 3 条是模板字符串。

**② 英文界面下整块中文：网格问题清单**

英文模式下显示的是：
```
INCONSISTENT_WINDING：存在 1241 处缠绕方向不一致（相邻三角形法向相对）。体积符号与射线内外判断可能出错。
```
外层句子翻译了，**`i.msg` 是引擎硬编码的中文**（`js/engine/meshValidation.js` —— 本阶段禁改）。
而这是**海外用户导入文件后第一眼看到的东西**（PHASE 83 交接书就把"设计中心的几何警告"列为 v1.1 英文覆盖优先级第 2 位）。

→ 显示层按 `code` 出文案（新增 `MESH_ISSUE_TEXT` 表），数字从原 msg 取、不另算。
现在英文显示：`INCONSISTENT_WINDING：1241 inconsistent winding directions (adjacent triangles face opposite ways) — …` ✓

**已知未覆盖**：`PARSE_WARNING` 的 msg 来自解析器（`stl.js`），模板多变，**原样显示不翻译**；
该分支只在文件损坏时出现。已在代码注释里写明。

**③ 英文界面下整块中文：分析进度条的 9 个阶段名**

`PROGRESS_STAGES` 的 9 个 `text` 都经过 `tr()`，但 en-US 里**一条词条都没有** → 英文模式下
进度条全程显示"导入模型 / 建立距离场 / 热结分析 · 计算模数场…"。→ 已补 9 条。

### 3.3 一个"翻译早就有、但从来没生效"的发现

英文界面残留的最后一条中文是 `轮廓＞500mm`（出现在「建议最小壁厚…砂型档」里）。
追下去发现：**en-US.js 里 `'轮廓＞500mm': 'envelope >500 mm'` 这条词条早就存在**，
但调用处 `tr('建议最小壁厚 {a} mm（{b} · {c}砂型档）', [mw.text, tr(matKey), mw.bucketLabel])`
**只翻译了材料名，`bucketLabel` 是裸插的** → 词条永远查不到。

→ 补一个 `tr()` 包装即可（`processPage1.js` 与 `smallCalcs.js` 各一处）。
**没有新增翻译，只是让已有的生效。**

**修完后的实测结果：英文模式设计中心残留中文 = 0。**

### 3.4 审计过但**判定不需要改**的（不为凑数制造改动）

| 项 | 结论 |
|---|---|
| 顶部 `📄 model.stl` 与参数区再出现一次文件名 | **不是重复** —— 后者标注的是"这组自动值来自哪个文件"，信息不同 |
| 显示原始 `code`（如 `INCONSISTENT_WINDING`） | **保留** —— 工程师要靠它检索；旁边已有解释 |
| `② 热结列表` 下的置信度说明（PHASE 83 加的） | 偏长但**必要**（"不是正确概率"这句不能省），保留 |
| 「计算器堆在一起」的感觉 | **未发现**。设计中心是 ①概览 → ②热结 → ③参数 → 执行 → 三页结果 的线性流程 |
| 专业术语密度 | 与产品定位（工程辅助工具）相符，未做删减 |

---

## 4. `geometrySource` 技术债（§五，只记录不修）

```
Future cleanup:
geometrySource 中的 peak position 应在未来适当时机改成正式结构化字段。
优先级：Low / Future cleanup
```

现状：`js/engine/v3/v3ViewAdapter.js` 的 `peaks: [{x,y,z}]` 里放的是**代表点**，
真正的峰点只存在于 `geometrySource` 字符串 `"refined field peak @(x,y,z)"` 中，
PHASE 86 的显示层因此需要解析这个字符串。**本阶段按要求未动 `v3ViewAdapter.js` / `hotspotV3.js` / `peakRegion.js`。**

---

## 5. 清理（§十三）

**删除了 6 个本会话产生的 Edge 浏览器 profile**（约 200MB）：
`_edge_p86s` · `_edge_profile_p86` · `_edge_profile_dn` · `_edge_profile_probe` · `_edge_p87audit` · `_edge_p87lang`

**修了一个会持续复发的问题**：`.gitignore` 原来只忽略 `_edge_profile*/`，
PHASE 86 的脚本用了 `_edge_p86s` 这个名字 → **漏进了 `git status`（多出一个 `??` 目录）**。
→ 改成 `_edge_*/`，以后任何 `_edge_` 前缀都忽略。

**未删除**（按 §十三）：
- `tests/real-stl/`（作者真实产品几何）
- `tests/engineering-generated/`（夹具 + 基线）
- `docs/PHASE*.md`（历史报告）
- `D:\CDXProject\_v11_*`（**仓库外**实验资料，§二明确不许删）

**⚠️ 报告但未处理**：仓库根目录还残留 **~1.2GB** 的历史 Edge profile（`_edge_profile_p21` … `_edge_profile_walk` 等 30 余个，来自 PHASE 21~78）。
它们**都被 gitignore 忽略、不影响仓库**，纯占磁盘。**未擅自删除**（不属于本阶段产物），需要清理请说一声。

---

## 6. 发布链检查（§十一，只检查未发布）

| 项 | 状态 |
|---|---|
| **版本号三处一致** | `js/version.js` `1.0.0` · `package.json` `1.0.0` · `dist/apk/project/AndroidManifest.xml` `versionName="1.0.0"` ✅ |
| **Windows `.ico`** | 7 帧（16/24/32/48/64/128/256）· 四角透明（超椭圆圆角）· 上边中点不透明 ✅ · `build_exe.bat` 引用 2 处 ✅ |
| **`CastingToolbox.exe`** | 内含 rcedit 写入的版本串（`Casting Toolbox` / `OriginalFilename` / `1.0.0.0` / `MIT License`，UTF-16）✅ |
| ⚠️ **exe 图标仍是方形旧版** | exe 构建于 **2026-09-11**（PHASE 73 发版），`.ico` 于 **2026-09-23**（PHASE 83）换成圆角 → **下次跑 `build_exe.bat` 才会带上圆角**。本阶段按要求**不重新打包** |
| **Android** | 只检查了构建链（`build_apk.ps1` → aapt2 编 `res/`，manifest 指向 `@mipmap/ic_launcher`）。<br>**Android real-device validation: not performed** —— 本机无设备/AVD，**不声称 PASS** |
| **GitHub Pages / Release** | 未发布、未推。本地 HEAD `ce7e87b` + 未提交改动；远端 `main` 仍是 `d517fe0`（PHASE 83 之前推的）。<br>**PHASE 83~87 的全部改动都还没推。** |
| 计算器数量 | **15 个 / 6 分类**，与 README 表述一致。§八：**本阶段未新增任何 calculator** |

---

## 7. 支持与资源（§十二）

PHASE 83 成果**本阶段未改动**。核对项：

| 项 | 状态 |
|---|---|
| 命名「支持与资源」 | ✅ 侧栏 + 页面标题 |
| 二维码 + 点击放大 | ✅（`browser_test` 断言通过） |
| 支持者卡片结构（`data/supporters.js`，当前空数组 + 诚实空态） | ✅ |
| responsive | ✅（`browser_responsive_test` 三视口通过） |
| i18n | ✅（`browser_i18n_audit` donate 页「干净」） |
| 路由 `#/donate` 保持 | ✅ |

**结论：不需要再改。**

---

## 8. V1.1 完成度（§十四.3）

### DONE

| 项 | 说明 |
|---|---|
| Hotspot 核心算法 | V3 冻结；引擎 7 文件 sha256 自 PHASE 84 起未变 |
| Hotspot 显示位置 | PHASE 86 的 S3/k=1 已生效并收口 |
| Design Center | 结构/流程审计通过；本阶段补齐中英文与 1 处文案 bug |
| 支持与资源 | PHASE 83 完成，本阶段核验无需再改 |
| Windows 圆角图标（源资源 + 生成链） | PHASE 83 完成；`.ico` 已是圆角版 |
| i18n（核心页） | 设计中心残留中文 **0**；`browser_i18n_audit` 12 个核心页全「干净」 |
| responsive | 三视口 × 9 页无横向溢出 |
| 版本号一致性 | 三处 `1.0.0` |
| Calculator registry | 15 个 / 6 分类 |
| 测试体系 | PHASE 85 双层化（legacy + 诊断）；真实 STL 回归在位 |
| 文档 | PHASE 83/84/85/86/87 报告 + `BASELINE.md` |

### IN PROGRESS

| 项 | 说明 |
|---|---|
| 英文覆盖（非核心页） | 实测 **1222 处 / 14432 字**（PHASE 73 数字，之后部分改善）。**设计中心已清零**，其余计算器页仍按 PHASE 72 划的边界保持中文 |
| 发布（推送到 GitHub） | PHASE 83~87 的改动**全部未推**。远端落后。**未被授权发布** |
| Windows exe 重打包 | 需要重跑 `build_exe.bat`（含 rnexit/postject）才能带上圆角图标 |

### DEFERRED

| 项 | 说明 |
|---|---|
| clean mesh fixture | PHASE 85 实测判定成本过高，已记录理由 |
| `npm run validate` | `data/tags.js` 缺 `export const TAG_PREFIXES`（PHASE 83 报告过，**至今未修**） |
| `npm run qa`（浏览器部分） | 依赖 `qa_sweep.mjs`，本阶段未跑全量 |
| 报告版式卡片化 | PHASE 78 提过，用户未定 |
| 产品方向三方案 | `docs/` 下三份未执行方案，仍待用户拍板 |

### NEEDS DECISION

| 项 | 需要谁定 |
|---|---|
| **是否推送 PHASE 83~87 的改动到 GitHub** | 用户（涉及公开发布） |
| **真值套件 9/20 的处置**（PHASE 84 给了三方案） | 用户（工程判断） |
| **"热点位置"的工程定义**（冒口要 peak / 冷铁要 region / 检验要二者） | 用户 —— PHASE 85 明确指出这是解锁算法优化的唯一前提 |
| 1.2GB 历史 Edge profile 是否清理 | 用户 |

---

## 9. 剩余工作（§十四.4 —— 只列真正值得做的）

1. **推送 PHASE 83~87 到 GitHub**（一次性动作，让线上与本地一致）
2. **修 `npm run validate`**（一行：补回 `data/tags.js` 的 `TAG_PREFIXES` 导出）
3. **重打 Windows exe**（让圆角图标生效）
4. **英文覆盖的剩余部分**（非核心页，量最大但价值递减）

**不列为剩余工作的**：任何 Hotspot 算法优化（已收口）、任何新计算器（§八明确不加）、
clean mesh fixture（已 defer）、任何"看起来可以更好"的重构。

---

## 10. 下一步建议（§十四.5）

### P0

> **当前没有必须立即处理的 P0。**
>
> Legacy 9/20 稳定、真实 STL 25/0、`js/engine/` 零改动、核心页中英无残留、
> responsive 全过、版本号一致。**没有阻塞性问题。**

### P1

1. **推送 PHASE 83~87 到 GitHub** —— 线上版本落后本地 5 个阶段的成果（支持与资源页、
   圆角图标源、大量中英文修复）。这是**唯一一件"做了就有实际收益"的事**，且需要你明确授权。
2. **修 `npm run validate`** —— `npm run` 里挂着的命令跑不起来，属于"文档承诺了但做不到"。

### P2

3. 重打 Windows exe（圆角图标落地，属于发版动作）
4. 清理 1.2GB 历史 Edge profile
5. 英文覆盖的剩余部分（非核心页）

---

## 11. 最终结论（§十五/§十六）

> **PHASE 86 已收口，V1.1 还有 4 件真正值得做的事项，且没有 P0。**

**本阶段没有把 V1.1 做成 V2**：
- 没有新增计算器
- 没有新增功能
- 没有动算法、数据结构、测试口径、GT
- 改的全部是**已经存在但没做对/没生效**的东西（1 个文案 bug、29 条英文覆盖、1 个 .gitignore 前缀）

**「先审计，再行动」的执行结果**：审计发现的问题**全是低风险小改**，
没有一项需要产品决策 —— 唯一的决策点是「推不推」，那不属于开发，属于发布授权。

---

## 附：本阶段产出的文件

| 文件 | 说明 |
|---|---|
| `docs/PHASE87_REPORT.md` | 本文件 |
| `D:\CDXProject\_v11_p87_dc_audit.mjs` | 仓库外 · 设计中心中英文全文 + 残留中文扫描 |
| `D:\CDXProject\_v11_p87_lang.mjs` | 仓库外 · 切语言状态保全验证 |
| `D:\CDXProject\_v11_p87_i18n_arity.mjs` / `_v11_p87_dupvar.mjs` | 仓库外 · i18n 结构性问题扫描器（占位符/实参数、重复占位符） |
| `D:\CDXProject\_v11_p87_dc.txt` | 审计原始输出 |

**`js/engine/` 零改动**（§1）。
