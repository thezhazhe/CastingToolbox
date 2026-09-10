# Casting Toolbox

**A lightweight, practical, open-source toolkit for casting process engineering.**
Lightweight open-source casting process engineering toolkit — fully offline, free, MIT licensed.

> 🔩 Works on Windows / Android / any modern browser · 🌐 Chinese & English UI · 📴 No network, no account, no data upload

---

# English

## What is Casting Toolbox?

Casting Toolbox is a lightweight, practical, and open-source toolkit for **casting process engineering**. It is built for the questions a foundry engineer answers every day: how long to pour, how big the choke area is, how large the riser must be, what yield to expect, how much shrinkage to allow, how much machining stock to leave, and whether the part is even castable.

It focuses on the **20% of problems that come up 80% of the time** (80/20 principle). It deliberately is **not** a CAE package — there is no finite element solver, no CFD, no AI auto-design.

**Privacy:** every calculation runs locally in your browser or on your machine. Nothing is uploaded, no account is required, and the app works with the network cable unplugged.

## Core Features

| Feature | What it does |
|---|---|
| **Casting Processability** | Minimum wall, critical wall, fillets, draft angle, minimum castable hole — by material / size / batch |
| **STL Analysis** | Import an STL and get envelope size, volume, surface area, weight, wall-thickness distribution and hotspot detection, entirely locally |
| **Riser Design** | Hotspot modulus Mc, riser shape library, feeding efficiency, riser neck, auto-iterated until modulus + volume both pass |
| **Gating System Design** | Dietert pouring time, Osann choke area, sprue / runner / ingate sizing, vent area, velocity & venting checks; Campbell quick-calc and vertical molding line (DISA) methods are separate calculators |
| **Casting Yield** | Estimated yield range by product / process / material, then measured yield → liquid metal weight per part and per mold |
| **Linear Shrinkage** | Per-direction shrinkage recommendation and pattern allowance |
| **Machining Allowance** | GB/T 42124.3-2025 allowance lookup (RMAG grades, superseding GB/T 6414), top-face grading |
| **Dimensional Tolerance** | GB/T 42124.3-2025 CT / DCTG 1–16 lookup |
| **Chill Calculation** | External / internal chill sizing, failure warnings, placement rules |
| **Charge Makeup** | Grade → automatic charge mix → live composition balance → makeup suggestions |
| **Shakeout Time** | In-mold cooling range and shakeout temperature target |
| **3D Sand Mold Clearance** | Clearance and minimum mold wall for 3D-printed sand molds |
| **Defect Finder** | Find defects by name / alias / symptom — GB/T 5611 eight categories, features, causes, remedies, standards |
| **Engineering Reference** | 172 traceable knowledge cards (materials, raw materials, molding sand, process & charge, defects, equipment) with source and confidence level |

15 calculators in total, grouped by the process design flow — plus a built-in knowledge base of **172 cards**, each with its source (book / chapter) and a confidence level.

## STL Process Design Center

The design center is the main work entry: import a casting and the tool walks the process chain with you.

```
STL
 ↓   Geometry analysis        envelope · volume · area · weight · wall thickness
 ↓   Casting processability   detected signals vs. engineering references
 ↓   Riser design             hotspot Mc → riser size → modulus & volume check
 ↓   Gating system design     pouring time · choke area · sprue / runner / ingate · venting
 ↓   Yield / Shrinkage / Machining allowance
```

* **3D view** — solid / wireframe / transparent, view presets, model auto-centred; hotspots are marked in 3D and linked both ways with the hotspot list.
* **Every automatic value is traceable** — each parameter carries a source badge (🟢 STL-derived · 🟡 user input/default · 🔵 calculated · 🟠 user override). Overriding an automatic value keeps the original and offers one-click restore (↺).
* **No STL? No problem** — a manual input mode runs the same calculators without a model.
* **Nothing is hidden** — when the analysis cannot produce a reliable result the tool says so and blocks the automatic recommendation instead of guessing.

## Platforms

| Platform | How | Notes |
|---|---|---|
| **Windows** | Portable single-file `CastingToolbox.exe` (Node SEA) | No installation, no admin rights; double-click to start and the browser opens |
| **Android** | Sideload APK | Self-contained; all data and calculations stay on the phone |
| **Web / source** | Plain static files + a local Node server (`start.bat` / `node serve.js`) | Any modern browser; no build step required |

## Engineering Philosophy

> **Simple enough to use, practical enough for engineering work.**

Casting Toolbox is designed as an **engineering aid**, not a replacement for professional CAE simulation software. It gives you a defensible starting number and shows where that number came from, so you can review it against your own process instead of starting from a blank page.

Where public data is uncertain, the tool says so. Where a standard gives a range, the tool prints the range instead of pretending to a single exact value.

## Reliability & Disclaimer

Please read this before using the numbers in production:

* **Some results are empirical engineering references.** Yield ranges, feeding efficiencies, neck coefficients and several processability values are industry experience values, not standard-mandated numbers. They are labelled as such in the UI.
* **STL analysis has limitations.** Wall-thickness and hotspot detection are mesh-sampling based. Thin features, complex structures or large models may fall outside the sampling resolution — the tool reports this rather than hiding it, but the limits are real.
* **Final process decisions require engineering verification.** Always review the recommended riser, gating and allowance values against your own pattern design, melting practice and production data.
* **Validate against production data where appropriate.** First-article trials and your plant's measured yield should always override the built-in reference values.
* The tool is provided **"as is"**; the author accepts no liability for its correctness or for any consequence of its use.

## Installation

**Windows (portable)** — download `CastingToolbox-v1.0.0-win64.zip`, unzip anywhere, run `CastingToolbox.exe`. The browser opens automatically. To stop the server, close its console window.

**Android (APK)** — download `CastingToolbox-v1.0.0.apk`, allow installation from unknown sources, install and open. Fully usable offline. Reports you generate are saved to your Downloads folder.

**Source / development** — requires Node.js 18+:

```bash
npm start                 # start the local server → http://localhost:8090/
npm test                  # node regression suite (see tests/FIXTURES.md: large generated
                          # fixtures are not in the repo — affected tests skip, not fail)
npm run validate          # knowledge base JSON validation
npm run qa                # static cross-reference + browser sweep
node scripts/design_center_test.mjs   # design center end-to-end
node scripts/browser_p72_test.mjs     # bilingual UI acceptance (zh ↔ en)
```

## License

MIT License. Free to use, study, modify and share. **Factories and individuals may use it internally for their own production and process design without restriction.**

If you distribute it (or a modified version), please respect the author's work:

* Keep the copyright notice and the author's name intact — do not remove, obscure or modify it.
* Do **not** bundle this tool or a modified version into commercial products, commercial software or paid services for resale or profit.

## Author

**感谢每一天的生活** · 320451242@QQ.COM · THEZHAZHE@gmail.com · QQ group 1106396422
Bug reports and data corrections are welcome — please open a GitHub Issue or send an email.

---
---

# 中文

## 项目介绍

Casting Toolbox 是一个**轻量、实用、开源的铸造工艺工程工具箱**。它面向铸造工程师每天都要回答的问题：浇多长时间、阻流截面多大、冒口要做多大、出品率大概多少、放多少缩尺、留多少加工余量、这个件到底能不能铸出来。

只解决**每天最常遇到的 20% 问题**（80/20 原则），**不做**有限元、不做 CFD、不做 AI 自动设计。

**隐私承诺**：所有计算都在本机完成，不经过任何服务器，无需联网，数据不出本机，也不需要注册账号。

## 核心功能

| 功能 | 说明 |
|---|---|
| **铸件结构工艺性** | 最小壁厚 · 临界壁厚 · 铸造圆角 · 拔模斜度 · 最小铸孔（按材质/尺寸/批量） |
| **STL 分析** | 导入 STL 本地解析：外形尺寸 · 体积 · 表面积 · 重量 · 壁厚分布 · 热节检测 |
| **冒口设计** | 热节模数 Mc · 冒口形状库 · 补缩效率 · 冒口颈 · 自动迭代至模数/体积双通过 |
| **浇注系统设计** | Dietert 浇注时间 · 奥赞阻流截面 · 直/横/内浇道 · 排气面积 · 流速与排气校核（Campbell 速算、垂直造型线 DISA 方法为独立计算器） |
| **出品率** | 按 产品/工艺/材质 给预估区间 → 现场实测出品率 → 单件与一模铁液重量 |
| **线收缩率** | 按方向推荐收缩率与放尺量 |
| **加工余量** | GB/T 42124.3-2025（RMAG 等级，代替 GB/T 6414）· 顶面分级 |
| **尺寸公差** | GB/T 42124.3-2025 CT / DCTG 1~16 查询 |
| **冷铁计算** | 外冷铁/内冷铁尺寸 · 失效提醒 · 布置规则 |
| **熔炼加料** | 选牌号 → 自动配比 → 实时成分平衡 → 补料建议 |
| **开箱时间** | 型内冷却时间范围与开箱温度目标 |
| **3D 砂型吃砂量** | 3D 打印砂型吃砂量与砂型最小壁厚 |
| **缺陷查找** | 按缺陷名/俗称/症状查：GB/T 5611 八大类 · 特征 · 原因 · 对策 · 标准 |
| **工程参考** | 172 条可追溯知识卡片（材料/原辅材料/型砂/工艺与配料/缺陷/设备），每条带出处与置信度 |

共 **15 个计算器**，按工艺设计流程分组；内置 **172 条知识卡片**，每条保留出处（书/章）与置信度。

## STL 工艺设计中心

设计中心是主要工作入口：导入铸件，工具陪你走完整条工艺链。

```
STL
 ↓   几何分析        外形尺寸 · 体积 · 表面积 · 重量 · 壁厚
 ↓   铸件结构工艺性   检测信号 与 工程参考 分开给
 ↓   冒口设计        热节 Mc → 冒口尺寸 → 模数与体积双校核
 ↓   浇注系统设计     浇注时间 · 阻流截面 · 直/横/内浇道 · 排气
 ↓   出品率 / 线收缩率 / 加工余量
```

* **3D 视图**：实体/线框/透明，视角预设，模型自动居中；热结在 3D 中标记，与热结列表双向联动。
* **每一个自动值都可追溯**：参数带来源徽章（🟢 STL 自动 · 🟡 用户输入/默认 · 🔵 自动计算 · 🟠 用户修改）；覆盖自动值时保留原值，可一键恢复（↺）。
* **没有 STL 也能用**：手动输入模式走同一套计算器。
* **不猜、不装**：分析给不出可靠结果时如实说明并阻止自动建议，而不是编一个数。

## 平台

| 平台 | 形式 | 说明 |
|---|---|---|
| **Windows** | 便携版单文件 `CastingToolbox.exe`（Node SEA） | 免安装、免管理员权限；双击启动并自动打开浏览器 |
| **Android** | 侧载 APK | 自带全部数据，计算与数据都留在手机上 |
| **Web / 源码** | 静态文件 + 本地 Node 服务器（`start.bat` / `node serve.js`） | 任意现代浏览器，无需构建 |

## 工程理念

> **简单到能用，实用到能干工程。**

Casting Toolbox 的定位是**工程辅助工具**，不是专业 CAE 仿真软件的替代品。它给你一个有依据的起点数字，并告诉你这个数字是怎么来的，让你能结合本厂工艺复核，而不是从一张白纸开始。

公开数据不确定的地方，工具会明说；标准给的是区间，工具就打印区间，不假装成一个精确值。

## 可靠性说明

在生产中使用这些数字之前，请先读这一段：

* **部分结果是工程经验参考值**：出品率区间、补缩效率、冒口颈系数以及若干结构工艺性数值属于行业经验值，不是标准强制条文——界面上都按"工程参考"标注。
* **STL 分析有局限**：壁厚与热结检测基于网格采样，薄特征、复杂结构或大模型可能超出采样分辨率。工具会如实报告这种情况，但局限本身是真实存在的。
* **最终工艺决定必须经工程校核**：推荐 的冒口/浇注/余量 数值，请结合本厂模具设计、熔炼工艺与生产数据复核。
* **能用实测数据就用实测数据**：首件试制与本厂实测出品率，永远优先于软件内置的参考值。
* 本工具按**"现状"**提供，作者不对其正确性或任何使用后果承担责任。

## 安装

**Windows（便携版）**——下载 `CastingToolbox-v1.0.0-win64.zip`，解压到任意目录，双击 `CastingToolbox.exe`，浏览器会自动打开。关闭它弹出的控制台窗口即停止服务。

**Android（APK）**——下载 `CastingToolbox-v1.0.0.apk`，允许"未知来源安装"，安装后直接打开，完全离线可用。生成的报告会保存到手机的「下载 / Download」目录。

**源码 / 开发**——需要 Node.js 18+：

```bash
npm start                 # 启动本地服务器 → http://localhost:8090/
npm test                  # Node 回归测试（大件夹具不在仓库里，见 tests/FIXTURES.md：
                          #   引用到它们的测试会**跳过而不是失败**）
npm run validate          # 知识库 JSON 领域校验
npm run qa                # 静态交叉引用 + 浏览器全巡检
node scripts/design_center_test.mjs   # 设计中心端到端
node scripts/browser_p72_test.mjs     # 中英双语界面验收（zh ↔ en）
```

## 许可

MIT License。免费使用、学习、研究、修改与分发；**工厂 / 个人用于自身生产与工艺设计完全允许**。

分发（含修改版）时请尊重作者的劳动：

* 必须**保留版权声明与作者署名**，不得删除、遮挡、修改；
* **禁止**将本工具或其修改版本**打包进商业产品 / 商业软件 / 收费服务**转售牟利。

## 作者

**感谢每一天的生活** · 320451242@QQ.COM · THEZHAZHE@gmail.com · QQ 群 1106396422
发现 bug 或数据问题，欢迎提 GitHub Issue 或发邮件。
