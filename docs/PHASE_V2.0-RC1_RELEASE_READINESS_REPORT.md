# PHASE V2.0-RC1 · 发布前总验收与 Windows EXE 候选包

> 命令：`D:\CDXProject\新建 文本文档 (173).txt`
> 日期：2026-10-27 ｜ 分支 `main` ｜ HEAD `da1c822`
> 状态：**已构建并实际启动验证 Windows RC1 候选包；未提交、未推送、未发布。正式 GitHub Release 尚未就绪。**

---

## 1. 当前状态

| 项 | 实际值 |
|---|---|
| 项目目录 | `D:\CDXProject\CCproject\CastingToolbox` |
| 分支 | `main` |
| HEAD | `da1c822`（V1.1.0 之后提交，V2.0 工作全部未提交） |
| 工作区（开始） | **158 项**（47 modified + 111 untracked） |
| 工作区（报告写入前） | **158 项**；本轮只新增本报告 → **159 项**（47 M + 112 ??） |
| 版本常量 | `js/version.js` = `1.1.0`；侧栏显示 `V2.0`；关于弹窗/package/EXE 元数据 = `1.1.0` |
| 冻结文件 | 未变（见 §3） |
| 发布动作 | 未 commit、未 push、未打 tag、未创建 GitHub Release |

历史工作区中的全部未提交改动均保留；没有执行 `git reset/checkout/clean/stash`。

---

## 2. 本次依据的报告与发布流程

已阅读/核对：

- `docs/PHASE_V2.0-WEBGL_INITIALIZATION_RECOVERY_REPORT.md`（170）
- `docs/PHASE_V2.0-ARROWHELPER_SHARED_GEOMETRY_FIX_REPORT.md`（172）
- `docs/PHASE_V2.0-UI_POLISH_REPORT.md`（168）
- `docs/PHASE_V2.0-P1-R8_RISER_GATING_OPTIMIZATION_REPORT.md`（164）
- `docs/PHASE_V2.0-P1-R6-S5_REPORT.md`（158）
- `docs/PHASE_V2.0_HANDOFF_2026-10-21.md`
- `docs/PHASE73_REPORT.md`（Windows SEA 打包与 v1.0.0 发布实录）
- `docs/HANDOFF_2026-10-07.md` §9 发布链路

实际打包方式沿用既有 Node SEA 路线：`sea-config.json` → 复制 Node 底座 → rcedit 图标/元数据 → postject 注入 `sea-prep.blob` → 便携目录 + ZIP。没有引入 Electron/Inno/NSIS 或新依赖。

**保护说明：** `scripts/pack_win.mjs` 硬编码 `NAME = CastingToolbox-v${VERSION}-win64` 并会 `rmSync` 目标目录；直接运行会覆盖既有 `dist/CastingToolbox-v1.1.0-win64`。因此本轮只在临时 `dist/RC1/_build` 生成 EXE，再用同一份 `WIN_FILES/WIN_DIRS` 清单打包到独立 RC1 目录；没有运行会覆盖 v1.1 产物的命令。

---

## 3. 冻结文件

| 文件 | sha256 前 8 位 | 状态 |
|---|---|---|
| `calcs/riser.js` | `5cfcfef3` | 未变 |
| `calcs/riserDreq.js` | `efdc2301` | 未变 |
| `calcs/calcManifest.js` | `3bfc3e16` | 未变 |
| `js/engine/**` | — | 本轮未修改；工作区既有状态保留 |

---

## 4. 测试清单与结果

### 4.1 全量 Node

```text
node tests/runner.mjs
→ 918 通过 / 1 失败，exit 1
```

- 90 个测试文件。
- 唯一失败：`tests/phase24_test.mjs :: T5`
  `ALHR4510塑料模具v2-2.1.stl 热结数应=5，实际 2`
- 这是 V2.0-03 修 `stride³` 后的历史副作用；171 已确认 `browser_stl_p22` 的 marker 半径失败同源。
- 日志：`dist/RC1/logs/node_full.log`。

> 日志中还会出现嵌套 `hotspot_v2` 自报的 `41 通过 / 1 失败`；它不是 runner 汇总，最终汇总以 `918/1` 为准。

### 4.2 源码浏览器验收（实际运行）

| 脚本 | 结果 | 退出码 | 日志 |
|---|---|---:|---|
| `browser_ui_polish_test.mjs` | 15/0 | 0 | `dist/RC1/logs/rc1_browser_ui_polish_test.log` |
| `browser_webgl_recovery_test.mjs` | 39/0 | 0 | `.../rc1_browser_webgl_recovery_test.log` |
| `browser_responsive_test.mjs` | 32/0 | 0 | `.../rc1_browser_responsive_test.log` |
| `browser_i18n_audit.mjs` | 0 遗漏 / 无异常 | 0 | `.../rc1_i18n.log` |
| `browser_s5_test.mjs` | 83/0 | 0 | `.../rc1_browser_s5_test.log` |
| `browser_s31_test.mjs` | 22/0 | 0 | `.../rc1_browser_s31_test.log` |
| `browser_dc_r3_test.mjs` | 35/0 | 0 | `.../rc1_browser_dc_r3_test.log` |
| `browser_p78_test.mjs` | 57/0 | 0 | `.../rc1_browser_p78_test.log` |
| `browser_test.mjs` | 174/0 | 0 | `.../rc1_browser_test.log` |
| `browser_dc_715_test.mjs` | 101/0 | 0 | `.../rc1_browser_dc_715_test.log` |
| `browser_perf_test.mjs` | 9/0 | 0 | `.../rc1_browser_perf.log` |
| `browser_stl_p22_test.mjs` | **19/1**（历史 marker 半径） | 1 | `.../rc1_browser_stl_p22_test.log` |
| `browser_inspection_test.mjs` | **184/1**（历史 ⑩⑥） | 1 | `.../rc1_browser_inspection.log` |

性能实测（`browser_perf`）：首屏 317ms；cube50 1.8s；ALR2510 1.5s；hollowThickRing 6.3s；重复导入/刷新/切语言/连续改参无异常。

### 4.3 数据/静态 QA

| 命令 | 结果 | 退出码 |
|---|---|---:|
| `node scripts/validate_data.mjs` | 164 条知识通过；6 条已知警告待复核 | 0 |
| `node scripts/qa_static.mjs` | 172 条数据 / 15 工具引用完整 | 0 |
| `node scripts/qa_sweep.mjs` | **48/1**；失败 = 首页工具卡期望 13、实际 15 | 1 |

### 4.4 未执行 / 无法完成

| 项目 | 原因 |
|---|---|
| `browser_s1/s22/s3/s4` | 较早阶段脚本，与 S5/S31/DC_R3/DC715 覆盖重叠；本轮按影响面未跑 |
| `browser_v2015` | 历史记录 8 项失败（旧结果未收敛断言依赖旧输入）；未重跑 |
| `browser_v2018` | 向导输入校验；本轮核心设计中心/计算链已由 Node + S5 覆盖，未跑 |
| `browser_p72` | i18n 专项已由 `browser_i18n_audit` 覆盖 |
| `browser_stl_test` | 真实 STL 导入已由 `browser_stl_p22` 覆盖 |
| `browser_gating_p45` / `vertical_gating` | 计算逻辑由全量 Node 覆盖；未重复跑浏览器 |
| `design_center_test.mjs` | **480s 超时**：9 通过 / 1 失败后停在 `#dc_run` 的 top-level await。165 已记录“300s 未完成、无输出”；属于旧脚本/选择器失配，不能算通过，也不能据此断定产品失败 |
| Android APK | 173 明确本阶段只做 EXE，未构建 |
| 真实硬件 GPU / 断网 | 未做；WebGL 测试为无头 Edge 软件渲染 |

### 4.5 失败分类

| 失败 | 分类 | 证据/影响 |
|---|---|---|
| `phase24 T5` 热结数 5→2 | **已确认历史失败** | V2.0-03 `stride³` 副作用；171 复核；不阻断打包，但全量 Node 不能显示绿色 |
| `browser_stl_p22` marker 半径 | **已确认历史失败** | 171 有 142/144/145/S2.2/S3.1/交接书多重记录；本轮源码与 EXE 均为 19/1 |
| `browser_inspection` ⑩⑥ | **已确认历史失败** | 旧基线 D/H=147/f=1.75；V2.0-22 后实际 101/101/1.2；S4/S5 已记录 |
| `qa_sweep` 首页工具卡 13 vs 15 | **测试期望过时** | `qa_static`、registry、README 均为 15 个计算工具；脚本仍写 13 |
| `design_center_test` 超时 | **测试脚本失配/未验证** | 旧参数窗口/选择器；165 已记录同类未完成；由 S5/S31/DC_R3/DC715 覆盖主链路 |
| `browser_v2015`（未跑） | 历史脚本失效 | S5 报告记录 8 项历史失败 |
| 新增阻断性产品失败 | **未发现** | 源码核心浏览器与 EXE 核心流程均通过；上述失败均可追溯到既有基线/测试维护 |

---

## 5. 核心功能与真实环境验收

### 5.1 源码运行环境

已实际覆盖：

- 首页/信息区、Three.js 按需加载、设计中心/检测中心懒加载；
- 设计中心导入真实 STL、3D canvas、几何/热结分析、参数与结果页；
- 重复导入、返回首页再进入、重试入口与 WebGL 失败恢复；
- 保存/分析分离、结果一致性、390px 手机布局与横向溢出；
- 中英文切换（核心页 0 遗漏）、性能与稳定性。

### 5.2 EXE 候选包实际验证

见 §7。已确认：实际启动、HTTP 200、关键资源 200、设计中心真实 STL 导入与三维/分析流程可用。

### 5.3 未验证/不能声称

- 真实硬件 GPU（无头 Edge 使用软件渲染）；
- 人工逐屏视觉验收、默认浏览器自动弹出窗口的目视确认；
- Windows 其他版本/其他机器、杀毒软件/SmartScreen 行为；
- 断网场景的物理断网测试（应用本身完全本地）；
- Android APK（本阶段未构建）；
- 安装器/卸载流程（本项目是便携版，无安装器）。

---

## 6. EXE 构建

### 6.1 构建命令（实际执行）

```text
node --experimental-sea-config sea-config.json
copy node.exe → dist/RC1/_build/CastingToolbox.exe
node scripts/set_exe_icon.cjs <staging.exe> dist/apk/CastingToolbox.ico 1.1.0
npx --no-install postject <staging.exe> NODE_SEA_BLOB sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
# 按 WIN_FILES/WIN_DIRS 复制到 dist/RC1/CastingToolbox-V2.0-RC1-win64
# PowerShell Compress-Archive → dist/RC1/CastingToolbox-V2.0-RC1-win64.zip
```

- Node：`v24.18.0`
- postject / rcedit：使用本机 npm 缓存；未新增运行时依赖
- 构建日志：`dist/RC1/build.log`
- 构建时间：2026-10-27 21:37–21:38（本地）
- 未修改任何源码/冻结文件；未覆盖 `dist/CastingToolbox-v1.1.0-win64*` 或根目录旧 EXE

### 6.2 产物

| 产物 | 路径 | 大小/哈希 |
|---|---|---|
| 候选目录 | `dist/RC1/CastingToolbox-V2.0-RC1-win64/` | 300 个文件 |
| EXE | `.../CastingToolbox.exe` | 92,466,176 B；sha256 `2b3f8aaed19656c84f155e7f5162ac920b14c6461d519fddf0c71105ec8e54f8` |
| ZIP | `dist/RC1/CastingToolbox-V2.0-RC1-win64.zip` | 36,004,085 B；sha256 `ae27e3d48d1d2aa4489fadb5c70577ed3cd9cd964b5a75f58dd4c4669154adb8` |
| 构建日志 | `dist/RC1/build.log` | — |
| 测试/EXE 日志 | `dist/RC1/logs/` | — |

ZIP 为 301 个条目（300 个文件 + 1 个空目录条目 `js\components\`），不含 `.ct-server.json` / `tests` / `docs`。

### 6.3 清单核对

- `index.html`、`js/app.js`、`js/views/designCenter.js`、`js/views/components/modelView3D.js`、`vendor/three.module.js`、`calcs/riser.js`、`calcs/calcManifest.js`、`data/index.js` 与源码 sha256 **逐项一致**；
- 静态目录：`assets` 1、`calcs` 19、`css` 2、`data` 189、`js` 80、`vendor` 4；加 5 个顶层文件 + EXE = **300 文件**；
- EXE 元数据：FileVersion `1.1.0.0`、ProductVersion `1.1.0`、ProductName `Casting Toolbox`；
- 未发现开发机绝对路径或 `tests/`、`docs/` 被误打包。

---

## 7. EXE 启动与功能验证

### 7.1 启动

- 实际启动候选 EXE（`PORT=8090`，工作目录=candidate 目录）：控制台横幅正常，stderr 为空。
- `http://127.0.0.1:8090/` → **HTTP 200**（首次轮询即成功）。
- 关键资源均 **200**：`/js/app.js`、`/vendor/three.module.js`、`/css/app.css`、`/js/views/designCenter.js`、`/data/index.js`。
- 停止后端口不可连（HTTP 000）；候选目录运行锁已清理。

### 7.2 EXE 上的浏览器验收

| 脚本 | 结果 | 退出码 |
|---|---|---:|
| `browser_ui_polish_test.mjs` | 15/0 | 0 |
| `browser_s5_test.mjs` | 83/0 | 0 |
| `browser_stl_p22_test.mjs` | **19/1**（同一历史 marker 半径失败） | 1 |
| `browser_responsive_test.mjs` | 32/0 | 0 |
| `browser_test.mjs` | 174/0 | 0 |
| `browser_i18n_audit.mjs`（`CT_URL=8090`） | 0 遗漏 / 无异常 | 0 |

EXE 上实际完成了：首页/信息区、Three.js 懒加载、设计中心真实 STL 导入、三维显示、热结分析、S5 结果页、手机布局、核心页面导航、中英文检查。未在 EXE 上跑 `browser_webgl_recovery`，因为该脚本通过 `/tests/golden/cube50.stl` 取测试夹具，而测试夹具不属于发布包；这不是产品缺陷。

**仍未验证：** 默认浏览器窗口是否实际弹出（`Start-Process -WindowStyle Hidden` 下未目视确认）；真实硬件 GPU；人工逐屏验收；SmartScreen/杀毒；其他 Windows 版本。

---

## 8. 已知问题与残余风险

### 8.1 发布治理阻断项

1. **V2.0 工作全部未提交**：HEAD 仍是 `da1c822`（v1.1.0），工作区 158 项（本报告写入前；含本报告为 159 项）；正式发布必须先决定提交/分支/tag。当前 RC1 EXE 来自工作区，不能声称可由某个 commit 重现。
2. **版本号/命名未决**：`VERSION=1.1.0`、关于弹窗/EXE 元数据 1.1.0，但侧栏显示 V2.0、候选目录名为 V2.0-RC1。若正式发布 V2.0，需要按项目 7 处同源规则统一版本并重新构建；本轮按 173 未擅自改版本号。
3. **README 有陈旧用户说明**（候选 ZIP 会带上）：
   - 中文第 161 行仍写“模数与体积双校核”；当前是目标模数反求尺寸、旧体积模型仅作参考诊断；
   - 中文第 168 行/英文第 57 行仍写“没有 STL 也能用手动输入模式”；设计中心的手动输入模式已在 145 阶段删除。
4. **测试套件不是全绿**：全量 Node exit 1（历史 `phase24 T5`）；p22/inspection 历史红；`design_center_test` 超时；`qa_sweep` 期望过时。发布前需决定“接受历史基线”还是修复测试/产品，并形成书面基线。
5. **EXE 未签名**：便携版无代码签名，Windows SmartScreen/杀毒可能提示；正式分发前需决定是否签名。
6. **EXE 未做安装器**：沿用便携版形态，符合历史发布方式；无安装/卸载流程。

### 8.2 工程残余（已记录）

- `browser_stl_p22` marker 半径：历史基线，未修；
- `phase24 T5`：历史基线，未修；
- `browser_inspection ⑩⑥`：历史旧基线，未修；
- `browser_v2015`：历史脚本失效，未跑；
- `design_center_test`：旧脚本超时，未重写；
- 无真实硬件 GPU/人工验收；
- Android APK 未构建（本阶段范围外）。

---

## 9. 是否满足正式发布条件

**不满足正式 GitHub Release 条件；满足“可供人工审查的 Windows RC1 候选包”条件。**

技术层面：

- 冻结文件未变；
- 全量 Node 仅 1 个已确认历史失败；
- 核心源码浏览器与 EXE 核心流程无新增阻断性失败；
- EXE 可构建、可启动、资源完整、可完成真实 STL 导入/分析/结果/响应式/i18n 检查。

正式发布仍缺：

1. 工作区提交、分支/tag 决策（目前 HEAD 是 v1.1.0，V2.0 未入库）；
2. 版本号与“V2.0”命名口径统一；
3. README 两处陈旧说明修正；
4. 历史测试基线/过时脚本的正式处置；
5. 人工 Windows/真实 GPU 验收与代码签名决策。

---

## 10. 最少必要后续事项

1. 决定版本策略：继续 1.1.x 还是正式 V2.0.0；如改版本，按 `js/version.js` 等 7 处同源更新并重建 EXE。
2. 修正 README 的“模数与体积双校核”“手动输入模式”两处陈旧说明（中英都检查）。
3. 决定历史失败（phase24 T5、p22、inspection ⑩⑥）是接受为已知基线还是开修复任务；更新/退役超时脚本 `design_center_test` 与过期 `qa_sweep` 断言。
4. 经用户授权后提交/推送/打 tag；从**已提交 commit**重新构建正式 EXE（当前候选来自未提交工作区）。
5. 人工验收：干净 Windows 目录启动、默认浏览器、STL 导入/3D/分析/语言/主题、关闭与重启、SmartScreen 行为。
6. 正式 GitHub Release 前确认：tag/标题/notes、ZIP 与 commit 对应、README 下载链接、GitHub Pages 更新、是否签名。

---

## 11. 最终结论

- **EXE 候选包已成功构建并实际验证**：`dist/RC1/CastingToolbox-V2.0-RC1-win64.zip`。
- 核心功能未发现新的阻断性回归；失败均为已记录历史基线或过时测试脚本。
- **不建议立即发布 GitHub Release**：工作区未提交、版本/README/发布基线尚未定案；请先按 §10 审查。
- 本轮未提交、未推送、未打 tag、未创建 Release；根目录旧 EXE 与 `dist/CastingToolbox-v1.1.0-win64*` 未被覆盖。
