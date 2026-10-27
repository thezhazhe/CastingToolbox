# PHASE V2.0.0 · 正式发布报告

> 命令：`D:\CDXProject\新建 文本文档 (174).txt`
> 日期：2026-10-27 ｜ 分支 `main` ｜ 正式远端标签 `v2.0.0`
> 状态：**已正式发布 GitHub Release；本报告为发布后记录，不改变 tag 指向。**
> Android APK、代码签名、人工逐屏验收、真实硬件 GPU 验收未做。

---

## 1. 正式源码提交

| 项 | 值 |
|---|---|
| 正式远端 commit | `3d913cdd09b2129803edf3886f7a02c33c3ab200` |
| 正式远端 tree | `fe6f574e8821cccb24e1e6c309e1a41e6f3b40b9` |
| commit 页面 | https://github.com/thezhazhe/CastingToolbox/commit/3d913cdd09b2129803edf3886f7a02c33c3ab200 |
| tag | `v2.0.0` → `3d913cdd09b2129803edf3886f7a02c33c3ab200` |
| 本地镜像 commit | `88ed08e7da8d016fd41bfdc68d49727471ec6dab`（本地 LF 归一化镜像；**正式远端提交以 `3d913cdd` 为准**） |
| 远端 `main` | `3d913cdd09b2129803edf3886f7a02c33c3ab200`（发布时） |

**源码一致性：** 本地工作树 **827/827 个 tracked 文件**的原始字节 blob SHA 与远端 `3d913cdd` 的远端 tree **逐文件一致**。本地 commit 的 tree 与远端 tree 不同，原因是 Windows `core.autocrlf=true` 使部分文件在本地 index 中为 LF、工作树/远端为 CRLF；不涉及内容语义。正式构建使用的工作树字节与远端提交内容一致。

### 提交范围

- 196 个文件变更：**144 新增 + 52 修改**；`+51,913 / -2,211`。
- 包含：正式产品源码、`js/views` 新模块、`calcs/riserDreq.js`、`data/riser-benchmark/`、测试脚本、阶段报告、README、版本文件、`.gitignore`。
- 排除并保留在工作区：`tests/experiments/out/`（研究实验输出）与 `tests/engineering-generated/phasev2012_c1_sweep.csv`（生成基线），已加入 `.gitignore`。
- 未提交：`dist/` 下的 RC1/RC2 产物、日志、浏览器 profile、EXE、ZIP。
- 未发现凭据/API Key/私钥；敏感模式扫描无命中。

---

## 2. 版本统一

正式版本：`2.0.0`；标签：`v2.0.0`。

| 来源 | 实际值 |
|---|---|
| `js/version.js` | `VERSION = '2.0.0'`；`VERSION_LABEL = 'v2.0.0'` |
| `package.json` | `2.0.0` |
| `index.html` 侧栏/关于 | `v2.0.0` |
| `js/app.js` 侧栏显示 | 引用 `VERSION_LABEL`（不再写死 V2.0） |
| `js/i18n/zh-CN.js` / `en-US.js` 关于 | `v2.0.0` |
| `build_exe.bat` | 图标/元数据 `2.0.0` |
| `dist/apk/project/AndroidManifest.xml` | `versionName=2.0.0`（`dist/` 被 ignore；本阶段不构建 APK） |
| README 下载入口 | `CastingToolbox-v2.0.0-win64.zip` |

`tests/phase73_test.mjs`、`tests/phase98_test.mjs`、`scripts/browser_ui_polish_test.mjs` 已同步更新为从 `VERSION_LABEL`/`2.0.0` 断言；`phase73,phase98` 定向 **18/0**。

---

## 3. README 修订

已修正：

- 中文“热节 Mc → 冒口尺寸 → 模数与体积双校核” → 目标模数 `Mr = 1.2 × Mc` 反求尺寸，旧体积模型仅作参考诊断。
- 中文/英文“没有 STL 也能用手动输入模式” → 独立计算器无需 STL；工艺设计中心是导入 STL 的工作流。
- Windows 下载文件名 → `CastingToolbox-v2.0.0-win64.zip`。
- Android 说明 → V2.0.0 不提供 APK；最后 APK 为 v1.0.0，不含 V2.0 界面/功能。

未进行大规模文案重写；未宣传尚未实现或未验证的工程能力。

---

## 4. 测试结果

### 4.1 最终全量 Node（版本/README/测试修改后）

```text
node tests/runner.mjs
→ 918 通过 / 1 失败，exit 1
```

唯一失败：历史 `phase24_test.mjs :: T5`，ALHR4510 热结数期望 5、实际 2。已确认是 V2.0-03 `stride³` 修复后的既有基线，不冒充全绿。

### 4.2 定向与浏览器验收

| 项目 | 结果 | 退出码 |
|---|---|---:|
| `node tests/runner.mjs phase73,phase98` | 18/0 | 0 |
| `node scripts/browser_ui_polish_test.mjs` | 15/0（侧栏 v2.0.0） | 0 |
| `node scripts/qa_sweep.mjs` | **49/0**（首页工具卡 15 已修正） | 0 |
| `node scripts/browser_webgl_recovery_test.mjs` | 39/0 | 0 |
| `node scripts/browser_s5_test.mjs` | 83/0 | 0 |
| `node scripts/browser_s31_test.mjs` | 22/0 | 0 |
| `node scripts/browser_dc_r3_test.mjs` | 35/0 | 0 |
| `node scripts/browser_p78_test.mjs` | 57/0 | 0 |
| `node scripts/browser_dc_715_test.mjs` | 101/0 | 0 |
| `node scripts/browser_test.mjs` | 174/0 | 0 |
| `node scripts/browser_responsive_test.mjs` | 32/0 | 0 |
| `node scripts/browser_perf_test.mjs` | 9/0 | 0 |
| `node scripts/browser_i18n_audit.mjs` | 0 遗漏 / 无异常 | 0 |
| `node scripts/validate_data.mjs` | 164 条知识通过；6 条警告待复核 | 0 |
| `node scripts/qa_static.mjs` | 172 条数据 / 15 工具引用完整 | 0 |
| `node scripts/browser_stl_p22_test.mjs` | **19/1**（历史 marker 半径） | 1 |
| `node scripts/browser_inspection_test.mjs` | **184/1**（历史 ⑩⑥） | 1 |
| `node scripts/design_center_test.mjs` | **超时**（旧脚本；9 通过/1 失败后卡在旧 `#dc_run` 流程） | 124 |

历史失败与过时脚本已写入 Release notes/本报告，未通过删断言或跳过测试冒充通过。

### 4.3 冻结文件

| 文件 | sha256 前 8 位 |
|---|---|
| `calcs/riser.js` | `5cfcfef3` |
| `calcs/riserDreq.js` | `efdc2301` |
| `calcs/calcManifest.js` | `3bfc3e16` |
| `js/engine/**` | 未在 174 中修改 |

---

## 5. Windows EXE 构建

### 5.1 构建

- 源码：`3d913cdd09b2129803edf3886f7a02c33c3ab200`（本地工作树 827/827 blob 一致）
- Node：`v24.18.0`
- 方式：Node SEA（`sea-config.json`）+ 复制 Node 底座 + rcedit 图标/版本 `2.0.0` + postject 注入 + 便携目录 + ZIP
- 构建时间：2026-10-27 22:30（本地）
- 构建日志：`dist/RC2/build.log`
- 未覆盖根目录旧 EXE 或 `dist/CastingToolbox-v1.1.0-win64*`

### 5.2 产物

| 产物 | 路径 | 大小 / SHA-256 |
|---|---|---|
| 目录 | `dist/RC2/CastingToolbox-v2.0.0-win64/` | 300 个文件 |
| EXE | `.../CastingToolbox.exe` | 92,466,176 B · `f73f194b40ba9ff0fcd5940aff93853e5243ca35dc14653b73636a593cb3ae7e` |
| ZIP | `dist/RC2/CastingToolbox-v2.0.0-win64.zip` | 36,004,036 B · `f7d75da0bdb2f2508f8ee33b763c54ae34d7f023bed5c6a56a9f01c5efa3d32b` |
| EXE 元数据 | FileVersion `2.0.0.0` · ProductVersion `2.0.0` · ProductName `Casting Toolbox` | — |

### 5.3 EXE 实际验证

实际启动 V2.0.0 EXE（8090，候选目录工作目录）：

- 启动横幅正常，stderr 为空；`/` HTTP 200；`/js/app.js`、`/vendor/three.module.js`、`/css/app.css`、`/js/views/designCenter.js`、`/data/index.js` 均 200。
- 服务端 `js/version.js` = `2.0.0`。
- EXE 上浏览器验收：
  - `browser_ui_polish` 15/0
  - `browser_s5` 83/0
  - `browser_stl_p22` 19/1（同一历史 marker 基线）
  - `browser_responsive` 32/0
  - `browser_test` 174/0
  - `browser_i18n_audit` 0 遗漏
- 已实际覆盖：首页/信息区、Three.js 懒加载、真实 STL 导入、三维显示、热结分析、结果页、手机布局、核心导航、中英文。
- **未验证**：真实硬件 GPU（无头软件渲染）、默认浏览器窗口人工目视、代码签名/SmartScreen、其他 Windows 版本、Android APK、物理断网、人工逐屏验收。

---

## 6. GitHub Release

| 项 | 值 |
|---|---|
| 发布状态 | **已发布（非 draft / 非 prerelease）** |
| Latest | 是（`/releases/latest` 返回 `v2.0.0`） |
| Release | https://github.com/thezhazhe/CastingToolbox/releases/tag/v2.0.0 |
| Release id | `425592495` |
| 附件 | `CastingToolbox-v2.0.0-win64.zip` · 36,004,036 B · state `uploaded` |
| 附件 SHA-256（GitHub API digest） | `sha256:f7d75da0bdb2f2508f8ee33b763c54ae34d7f023bed5c6a56a9f01c5efa3d32b`（与本地一致） |
| GitHub Pages | `https://thezhazhe.github.io/CastingToolbox/js/version.js` 已返回 `2.0.0` |

### 发布过程网络说明

- 第一次 `publish_via_api` 在 blob 上传时遇到 TLS 超时，`main` 未移动；重试成功（196 个文件上传，0 删除），`main → 3d913cdd`。
- `gh release create` 两次在内部 PATCH 时 TLS 超时（release 未落地）；随后改为**单次 POST `/releases`** 成功创建 release，再用 `gh release upload` 上传附件。
- **直接下载验证未完成**：本机访问 `release-assets.githubusercontent.com` 时多次 TLS/连接重置；Release 页面 HTTP 200，API 附件 size/digest 与本地逐字节哈希一致。未能在本机完成“下载后再算一次哈希”的最后一步，已如实记录。
- 未使用强制覆盖、未移动/覆盖已有 v1.0.0/v1.1.0 标签或产物。

---

## 7. 已知问题与残余风险

1. `phase24 T5`：历史热结数量基线，未修；全量 Node 仍为 918/1。
2. `browser_stl_p22` marker 半径、`browser_inspection ⑩⑥`：历史 UI 基线，未修。
3. `design_center_test.mjs`：旧选择器流程超时，未重写；当前设计中心由 S5/S31/DC_R3/DC715 覆盖。
4. EXE **未签名**；Windows SmartScreen/杀毒提示可能。
5. 未做真实硬件 GPU、人工逐屏、SmartScreen 全面验证。
6. 未发布 Android APK；README 已明确说明。
7. 本报告是**发布后记录**，不改变 `v2.0.0` tag 指向的正式源码提交；本报告将作为独立 docs 提交（post-release commit），与 tag 源码快照区分。

---

## 8. 未做事项

- 未制作 Android APK。
- 未做代码签名。
- 未做人工逐屏视觉验收 / 真实硬件 GPU 验收 / SmartScreen 全面验证。
- 未声称全量测试全绿；未声称已完成上述未验证项目。

---

## 9. 结论

**Casting Toolbox V2.0.0 已正式发布。**

- 正式源码：`3d913cdd09b2129803edf3886f7a02c33c3ab200`
- 标签：`v2.0.0`
- Release：https://github.com/thezhazhe/CastingToolbox/releases/tag/v2.0.0
- Windows ZIP：`CastingToolbox-v2.0.0-win64.zip`，36,004,036 B，SHA-256 与 GitHub API digest 一致
- 本地完整报告/日志：`docs/PHASE_V2.0.0_OFFICIAL_RELEASE_REPORT.md`、`dist/RC2/`
