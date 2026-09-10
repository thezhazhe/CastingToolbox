# PHASE 73 报告 · Release Candidate 体检 → Windows / Android 封装 → GitHub Release

命令文件：`新建 文本文档 (81).txt`（含用户补充：版本号需统一更新）
日期：2026-09-11
版本：**v1.0.0**（用户裁定）

执行顺序严格按 §二：**代码冻结 → 只读全面体检 → 问题分级 → 修 P0/P1 → 完整回归 → RC → 封装 → 双端验收 → Release**。
本阶段**未新增任何功能**，未改任何成熟公式（唯一一处 `calcs/riser.js` 改动是除零守卫，见 §2）。

---

## 1. Release Audit

### 1.1 审计方式（四条独立流 + 三条自动化脚本）

| 流 | 方式 | 覆盖 |
|---|---|---|
| 中英文专项 | 只读子代理 + 自建**浏览器 DOM 级**审计脚本 | 17 条路由 + 4 个弹窗 + 设计中心全链，抓可见文本/占位符/title/aria/option |
| 计算器边界 | 只读子代理 | 15 个计算器 × 7 组极端输入（0/负/NaN/±Inf/1e9/1e-9/必填留空）+ UI 可达性判定 |
| 数据流与 STL | 只读子代理 | STL→Geometry→Wall→Hotspot→Project→Riser→Gating→Yield 全链，9 个真实 STL，旧存档/刷新/双模式 |
| 响应式 / 性能 / 设计中心盲测 | 本人 + 自建脚本 | 3 种视口 × 6 页 + 结果三页、加载与导入耗时、重复导入、12 次切语言、连续计算 |

新增审计资产（可复跑）：`scripts/browser_i18n_audit.mjs`（英文界面 DOM 残留）、`scripts/browser_responsive_test.mjs`、`scripts/browser_perf_test.mjs`、`scripts/edge_audit.mjs`。

> ⚠️ 原 `scripts/i18n_audit.mjs` 的绿灯是**假象**：它只做"源码单引号字面量 → 词条表"的静态查表，
> 存在范围（只扫 import 了 i18n 的文件）、语法（模板串/变量 key 看不见）、语义（不校验实际渲染结果）三个盲区。
> 本次把验收口径换成了浏览器 DOM 扫描 + 异常监控。

### 1.2 分级结果

**P0：无。**

**P1（6 条，全部已修）**

| # | 问题 | 影响 | 修复 |
|---|---|---|---|
| P1-1 | `orig` 基准未随 STL 绑定数据清理 | **刷新/换模型后点 ↺「恢复自动原值」会把上一个模型的值写进当前项目**（cube50 刷新后手动填 777 → 点 ↺ 变回 125，而本会话没有 STL） | `CastingProject.clearStlBoundData()` 同步清 `orig` |
| P1-2 | 设计中心数字输入**无下限** | 负 RH → 平均静压头 Hp=926（方向反）；RH=5000 → Hp=−5281、阻流截面 A=0.00、直浇道 ⌀5mm **照样作为设计结果展示**；主壁厚 −25 会改浇注时间 | 统一负值守卫（按"未填"处理 + 明确提示 + 输入框清空保持一致），number 行补 `min="0"` |
| P1-3 | 出品率留空被硬编码 `|| 70` 顶掉材料表推荐值 | 铸钢/铝/铜的推荐出品率被忽略，浇注重量最多偏 17% | 改为回退该材料 `y_sug`（`runGating` 原本就能正确处理，是 manifest 短路了它） |
| P1-4 | 报告正文出现 `undefined` | 下载的工艺计算报告里 `系统比例 —（undefined : undefined : undefined）` | 三值齐备才显示比例，否则省略 |
| P1-5 | 垂直造型线"依据"行出现 `undefined` | 读的是从未构造的 `mSrc.srcLabel`（该行是工程可追溯字段） | 改读同函数已算好的 `res.mInfo.srcLabel` |
| P1-6 | 冒口极小输入产出 `NaN` 并直接显示 | `Mc≈0.001` 时迭代取整得 D=0/H=0 → `M(0,0)=0/0` | `calcs/riser.js` 除零守卫（合法输入下分支永不触发，公式零改动）+ 视图对退化输入给出明确说明 |

**P2（已修 3 条）**：空警告框（NO_HOTSPOT 时渲染出无文字的黄框）· 手动模式毛坯重输入框被净重覆盖（**屏幕 4.2、实际算 4.8**）· `process.wallHot` 被写成字符串破坏数值契约 · `↺` 触摸目标仅 12px 手机点不中。
**P2（登记不修）**：手动模式填的参数在导入 STL 时按现有语义清空（与代码注释不一致，属口径决策）· `shakeout` 未知材质键抛错、>100t 静默返回空（UI 不可达）· `sandbox` 静压头 Infinity 文案 · `riser` 迭代不收敛时仍返回 · 关键项留空的 fallback 未在界面标注。
**P3（登记不修）**：`hotspots.reason` 写入非枚举值 `rejected` · `HS_REASON.UNIFORM` 在 V3 生产路径永不出现（诚实分级实际未生效）· 死字段/死导出 · `clearIfBound` 数组空值判断恒假 · `geometry.unit` 恒 mm 却标 USER_INPUT。

### 1.3 设计中心盲测（§八，三个核心问题）

用真实 STL（cube50）走完整链路并留证（`screenshots/p73_walk_1..8`）：

| 问题 | 结论 | 依据 |
|---|---|---|
| ① 用户知道什么需要自己填写吗？ | **知道**。固定分组 + 必填项标注 + 未填时的占位提示（"未填（按 150 计）"）+「还需提供」清单 | 参数区五组结构；`dc_runHint` |
| ② 用户知道哪些数据来自 STL 吗？ | **知道**。每个参数行尾都有来源徽章（🟢STL 自动 / 🟡用户输入·默认 / 🔵自动计算 / 🟠用户修改），概览卡明示"以上为 STL 自动识别结果"，③ 组标题写"STL 自动识别（可修改）" | 逐行徽章 + 概览脚注 |
| ③ 用户知道最终结果的依据是什么吗？ | **知道**。结果页每块都有 Mc 来源行（用户输入 / STL 热结检测 / 壁厚结构参考值）、来源副标题行（"冒口结果来自现有冒口计算器"）、校核口径 chip（企业口径 R7）、参数区联动提示条 | `mcSourceLine`、`dc-src-line`、`dc-link-hint` |

**盲测发现并已修**：结果页 Page1 顶部一个**无文字的空黄框**（P2）。

### 1.4 中英文专项（§九/§十）

* 核心页英文界面：**0 处遗漏 · 0 个 undefined/null/key 泄漏 · 0 运行时异常**（浏览器 DOM 级实测）。
* 已声明保持中文（§十六/§十七）：知识库卡片、计算器「说明与依据」长正文、计算器生成的判定条目、导出报告、非核心工具整页 —— 均在英文界面下显式告知用户（`kb.zhOnly` / `note.zhOnly`）。
* 语言切换不影响工程数据：参数 / 结果 / source / orig / STL 全部不变（node 用例 + 浏览器 12 次切换实测），刷新后语言保持。

### 1.5 响应式 / 性能（§十一/§十二）

* 桌面 1600×1000 / 手机竖屏 390×844 / 手机横屏 844×390 × 6 个页面 + 结果三页：**全部无横向溢出**；触摸目标 ≥28px（修掉 ↺ 后通过）；桌面布局无回归。
* 首次加载 **410 ms**；小件 1.7 s、真实件 1.6 s、26.7MB 大件 6.7 s；重复导入、刷新、12 次切语言、连续 8 次计算：**无 console.error、无未捕获异常**。

---

## 2. 修复内容（实际改了哪些）

| 文件 | 改动 |
|---|---|
| `js/model/CastingProject.js` | `clearStlBoundData()` 一并清 `orig` 基准（P1-1） |
| `js/views/designCenter.js` | 负值守卫（manifest 行/三方向/四项基础几何）+ `min="0"`（P1-2）；毛坯重输入框不再覆盖用户值（P2）；`wallHot` 数值类型修正（P2） |
| `calcs/calcManifest.js` | 出品率兜底改材料表 `y_sug`（P1-3）；冷铁路径显式传推荐冷铁材料，消除 `undefined` 文案（P1-4）；新增 `yieldSugPct()` |
| `js/views/reportGenerator.js` | 系统比例三值齐备才输出（P1-4）；版本号引用 `js/version.js` |
| `calcs/verticalGating.js` | `mSrc.srcLabel` → `res.mInfo.srcLabel`（P1-5，仅取值来源，公式未动） |
| `calcs/riser.js` | `Mr_act` 除零守卫（P1-6；`D>0 && H>0` 才计算，合法输入零影响） |
| `js/views/riserView.js` | `fmt` 非有限值显示 `—`；退化输入给出明确说明而非渲染 NaN |
| `js/views/processPage1.js` | 去掉空警告框（P2） |
| `css/app.css` | `↺` 触摸目标放大（窄屏 + `pointer:coarse`） |
| `js/version.js` · `index.html` · `js/app.js` · `package.json` · `AndroidManifest.xml` · `build_exe.bat` · `scripts/set_exe_icon.cjs` | **版本号统一 v1.0.0**（唯一来源 + 三处守卫） |
| `build_apk.ps1` | **补打 `vendor/`**（旧 APK 漏打，Android 上进设计中心必然白屏）；SDK 路径不再写死 34.0.0，自动挑可用版本 |
| `scripts/pack_win.mjs`（新） | Windows 便携版打包脚本：显式文件清单，杜绝"手工拼目录漏文件" |

**未改**：所有计算公式与阈值、STL 引擎、热结算法、数据表、知识库内容、i18n 词条表（除版本号）。

---

## 3. 未修复问题（登记，不影响发布）

见 §1.2 的 P2/P3 清单。其中**需要用户拍板的一条**：
手动模式填写的几何/工艺参数，在导入 STL 时按当前语义被视为"STL 绑定数据"清空，
而代码注释承诺"USER_INPUT（手动模式填写）保留"——两者不一致。**是"导入新模型就该以新模型为准"还是"手动填的应该留住"**，属产品口径，需明确后再改。

---

## 4. Test

| 类别 | 命令 | 结果 |
|---|---|---|
| Unit / Regression | `node tests/runner.mjs` | **461 / 0**（含新增 `phase73_test.mjs` 7 项） |
| i18n | `node tests/runner.mjs phase72` + `node scripts/browser_i18n_audit.mjs` | 12/0；核心页 **0 遗漏** |
| Design Center | `node scripts/design_center_test.mjs` · `browser_dc_715_test.mjs` · `browser_p78_test.mjs` | 全部通过 |
| Browser | `node scripts/browser_test.mjs` · `browser_p72_test.mjs` · `browser_responsive_test.mjs` | 全部通过 |
| STL | `node scripts/browser_stl_p22_test.mjs` + golden/real-stl 全链 | 全部通过 |
| 边界 | `node scripts/edge_audit.mjs` | 5 组极端输入 × 9 计算器：**无 NaN/Infinity/undefined、无崩溃** |
| 性能 | `node scripts/browser_perf_test.mjs` | 全部通过，0 异常 |

**KNOWN EXISTING → 已清零**：`phase16final FINAL-5`（报告 undefined，本次修真 bug）· `phase16final FINAL-6`（断言写死旧版本号，改为引用版本常量）· `phase16c 16-C-5`（断言基于 PHASE 71.6 之前的依赖契约，改为当前契约）。三处均在报告中说明理由，**不是为了让测试变绿而放宽断言**。

**KNOWN EXISTING（保留，不影响发布）**：`tests/hotspot_v2_test.mjs` 自跑报告 `40 通过 / 2 失败`，
两条失败均为**性能断言**（`large thin shell 18184ms`、`large thin + local thick 15274ms`，阈值 8s），
其状态/位置/Mc/置信度等**正确性断言全部通过**。判定依据：
① 该文件是**遗留 V2 引擎**的 golden 测试（生产默认走 V3；V2 仅在 `?hsV2=1` 开发对照时启用）；
② 模型是 176MB / 148MB 的超大薄壳，与既有记录「V2.1 平台定位效应 / BVH 规则网格退化」同源；
③ PHASE 73 **未触碰 `js/engine/`**（版本快照可证）。
注意：这些自跑输出不计入 `npm test` 的汇总（runner 只统计各文件导出的 `tests`），
所以 `461/0` 与「V2 自跑 2 条性能未达标」**同时成立**，此处并列披露，不做掩盖。

---

## 5. Windows

* **封装方式**：沿用 v0.15/v0.16 已验证路线 —— Node SEA 单文件 EXE（`sea-config.json` + `postject`），产物形态 = **便携版文件夹 + zip**（用户裁定沿用；仓库内无安装器配置，不新引入 Inno/NSIS）。
* **产物**：`dist/CastingToolbox-v1.0.0-win64/`（11 个条目，含 `vendor/`）+ `dist/CastingToolbox-v1.0.0-win64.zip`（34.0 MB）。
* **EXE 元数据**：图标 + 文件/产品版本 1.0.0 + 产品名 + 版权（rcedit，注入 SEA blob 之前）。
* **实测**（非模拟，是真跑封装产物）：
  * 启动 ✅（`HTTP 200`，横幅正常）· 首页/版本常量/vendor/设计中心模块/数据/样式/图标 全部 `200`
  * 端到端：对 EXE 起的服务跑完整中英双语 DOM 审计 → **核心页 0 遗漏、0 undefined、0 异常**
  * 停止 ✅（关闭后端口不可连）· 残留锁文件重启 ✅（PID 已死 → 正常接管）
  * 便携版目录再测一遍（EXE 从自身目录取文件，能暴露"漏打包"）✅
* **未做**：真实安装程序（本版本发布形态为便携版，无安装/卸载步骤）。

## 6. Android

* **封装方式**：沿用既有 `build_apk.ps1`（离线 aapt2 + javac + d8 + zipalign + apksigner，无 gradle）。
* **产物**：`dist/CastingToolbox-v1.0.0.apk`（1.14 MB，277 个文件，172 条知识卡片）。
* **本次修复**：补打 `vendor/`（three.js 与 OrbitControls —— 旧 APK 缺失，**Android 上进设计中心必然因模块解析失败而白屏**）；版本号 `versionCode 3 / versionName 1.0.0`；SDK 路径不再写死。
* **静态验证** ✅：签名（V3）· `versionName=1.0.0` · `minSdk 21 / targetSdk 34` · assets 完整（含 vendor）· `assets/www` 全部扩展名（html/js/css/json/png/svg）在 `HttpServer` MIME 表内 · 资源经本地 HTTP 提供（ES module 与 importmap 可用，非 `file://`）· 所有资源路径用 `AssetManager.open` 逐层路径读取（嵌套可用）。
* **未验证** ⛔：**本机无 Android 设备也无 AVD（`adb devices` 为空、`emulator -list-avds` 为空），无法安装运行 APK。**
  因此以下**一律不写 PASS**，需**真人手机验收**：
  安装 · 启动 · 返回键 · 重启 · 文件选择器选 STL · STL 导入与 3D 视图 · 设计中心全流程 · 中英切换 · 断网离线运行 · 报告保存到「下载」目录。
  已把 APK 留在 `dist/CastingToolbox-v1.0.0.apk` 供实机安装。

## 7. GitHub

* **repository**：`https://github.com/thezhazhe/CastingToolbox`（沿用现有仓库，未新建）
* **branch**：`main`　**tag**：`v1.0.0`　**release**：`Casting Toolbox v1.0.0`（见 §二十三 说明与附件）
* **README**：英前中后双语改写（`README.md`）——入门/核心功能/STL 工艺设计中心/平台/工程理念/**可靠性说明（诚实声明经验值与 STL 局限）**/安装/License
* **Windows artifact**：`CastingToolbox-v1.0.0-win64.zip`
* **Android artifact**：`CastingToolbox-v1.0.0.apk`
* **敏感信息检查**：全仓扫描 `ghp_/gho_/sk-/PRIVATE KEY/password=` 无命中；`.gitignore` 已补齐浏览器 profile / 截图 / 产物 / 签名文件；本次提交 543 个文件**不含** EXE、APK、dist、profile、临时日志

## 8. 最终结论

**GO**

依据：P0 = 0；P1 = 6 条**全部修复并有回归用例守卫**；核心测试 458/0；全部浏览器测试（含新增的中英 DOM 审计、响应式、性能）通过；Windows 产物**真机实测通过**；中英文核心 UI 干净；语言切换不动任何工程数据。

**唯一保留意见**：Android 只有静态验证，**实机安装与 STL 文件选择未验证**（无设备/模拟器），已在 §6 逐项列明待人工验收项，未以任何形式冒充通过。
