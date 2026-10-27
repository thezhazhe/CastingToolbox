# PHASE V2.0 — 首页信息区精简 + Three.js 初始化失败恢复只读核查

> 命令：`D:\CDXProject\新建 文本文档 (169).txt`
> 日期：2026-10-27 ｜ 分支 `main` ｜ HEAD `da1c822`
> 状态：**首页信息区已修改；Three.js/WebGL 初始化失败路径只读核查；未提交、未推送、未发布。**

---

## 1. 修改文件与具体改动

| 文件 | 修改 |
|---|---|
| `index.html` | 侧栏“产品与下载”只保留在线、GitHub、发布版本三个入口；删除国内网盘链接和提取码；产品入口改用短文字链接；社区组增加“更新动态 / 国内下载方式 / 使用帮助”说明。 |
| `js/i18n/zh-CN.js` | 增加三个短链接文案、社区说明；删除不再使用的国内下载/密码词条。 |
| `js/i18n/en-US.js` | 同步英文短链接与社区说明；删除国内下载/密码词条。 |
| `css/app.css` | 增加 `.sf-note` 样式（社区说明）；沿用现有字号/字重/分组/滚动规则。 |
| `scripts/browser_ui_polish_test.mjs` | 扩展首页信息专项测试：三入口、无网盘/密码、社区说明、英文同步、手机复用；保留原 Three.js 导入失败/重试/缓存检查。 |

未修改 `js/engine/**`、`calcs/riser.js`、`calcs/riserDreq.js`、`calcs/calcManifest.js`，也未修改三维核心代码。

---

## 2. 桌面侧栏与手机首页最终入口/文案

桌面侧栏底部与手机首页 `home-siteinfo` 使用同一份分组 HTML（手机端只是把侧栏内容克隆到首页）：

### 产品与下载

- 🌐 **在线使用** → `https://thezhazhe.github.io/CastingToolbox/`（显示“打开在线版”）
- 💻 **GitHub 项目** → `https://github.com/thezhazhe/CastingToolbox`（显示“打开 GitHub 项目”）
- **发布版本** → `https://github.com/thezhazhe/CastingToolbox/releases`（显示“查看 Releases”）

**不再展示**国内网盘链接、网盘地址或提取码 `5432`。

### 作者与联系

- 🧑‍💻 作者：感谢每一天的生活
- 📮 320451242@QQ.COM（mailto）
- 📮 THEZHAZHE@gmail.com（mailto）

### 社区

- 💬 QQ 交流群：1106396422
- 📱 微信公众号：铸造工具箱
- 说明：**加入 QQ 群或关注微信公众号，可了解产品更新动态，并获取国内下载方式与使用帮助。**
- 未暗示必须关注社区才能使用在线版。

### 开源声明

- 💚 免费开源（MIT）· 永久免费（原文保留）

版本显示仍为 V2.0（仅界面代际，未改 `js/version.js`、关于弹窗、报告、package/Release 元数据）。

---

## 3. 网盘地址与提取码移除确认

- 桌面侧栏：`index.html` 中已删除 `wwbxs.lanzouu.com/b0syyfxwh` 及 `5432`。
- 手机首页：`home-siteinfo` 克隆桌面侧栏同一份 HTML，因此同步不含网盘地址/提取码。
- `browser_ui_polish_test` 在桌面和 390px 两处断言：
  - 页面文本不含 `lanzouu` / `5432`；
  - 不存在的国内下载链接不出现在 `href` 列表中；
  - 社区说明仍包含“国内下载方式”。
- 其他位置的下载信息/Release 资产未删除、未修改。

---

## 4. 中英文一致性

- 中文短链接：打开在线版 / 打开 GitHub 项目 / 查看 Releases。
- 英文：Open online version / Open GitHub project / View releases。
- 社区说明：
  - 中：加入 QQ 群或关注微信公众号，可了解产品更新动态，并获取国内下载方式与使用帮助。
  - 英：Join the QQ group or follow our WeChat official account to keep up with product updates and get China download options and usage help.
- `browser_i18n_audit.mjs`：0 遗漏；中英文首页信息专项检查通过。

---

## 5. 实际运行的测试

| 命令 | 结果 | 退出码 |
|---|---|---:|
| `node scripts/browser_ui_polish_test.mjs` | **15/0** | 0 |
| `node tests/runner.mjs phase73` | **7/0** | 0 |
| `node tests/runner.mjs phase98` | **11/0** | 0 |
| `node scripts/browser_i18n_audit.mjs` | 0 遗漏，无运行时异常 | 0 |

`browser_ui_polish_test` 本轮覆盖：

- 在线 / GitHub / Releases 三个入口及其 URL；
- 桌面侧栏与手机首页都不再显示网盘地址/提取码；
- 社区说明存在，中文/英文对应；
- 作者、邮箱、MIT 开源说明保留；
- 原有 Three.js 模块导入失败/重试/缓存、检测中心加载检查继续通过。

---

## 6. 未运行的测试

- 未运行全量 Node（169.txt 明确不要求；本轮只改首页信息展示）。
- 未重跑 `browser_s5`、`browser_s1`、`browser_s31`、`browser_test`、`browser_responsive`、`browser_s3`、`browser_p78`：这些不是本轮信息区修改的影响面，且上一轮已有通过记录；本轮只用专项 + 轻量 i18n。
- **WebGL 初始化失败没有做真实 GPU / 无 WebGL 环境实测**；详见第 7 节。
- 未运行 `browser_inspection_test` 全量。

---

## 7. Three.js / WebGL 初始化失败恢复 —— 只读核查

> 本节只是代码路径核查，不是真实 GPU 故障实测。上一轮已模拟“模块下载失败”，但这**不等同于** WebGLRenderer 初始化失败。

### 7.1 模块导入失败路径（已实现）

`js/app.js`：

- `LAZY_VIEWS` 动态 import `designCenter` / `inspection`；
- `loadLazyView()` 失败时从 `lazyPromises` 删除失败 promise（`app.js:45-59`），允许再次 import；
- `renderLazyLoading` / `renderLazyError` 提供 loading、错误详情、重试、返回首页（`app.js:95-117`）；
- `renderSeq` 防止加载中切页后旧结果覆盖新视图（`app.js:119-160`）；
- 已成功模块保存在 `lazyModules`；再次进入直接复用；
- `mountLazy()` 也捕获视图 render 的同步 / Promise 错误，并显示同一错误 UI（`app.js:134-143`）。

**结论：** 动态 import 失败 / 路由级视图 render 失败有可见错误与重试入口；失败 promise 会清除，重试可重新 import。`browser_ui_polish_test` 已覆盖这条路径（阻断 `vendor/three.module.js`）。

### 7.2 模块加载成功，但 WebGL / 3D 初始化失败

关键代码：

- `js/views/components/modelView3D.js:58-151` 构造函数：
  1. 创建 scene / camera；
  2. `new OrbitControls(camera, container)`；
  3. `new THREE.WebGLRenderer(...)`；
  4. append canvas、灯光、Axes、MutationObserver、media query、groups、pointer listeners；
  5. `_animate()` 启动 rAF；
  6. 最后才建立 ResizeObserver / window resize / pointer 拾取监听。
- `js/views/designCenter.js:2167-2176`（`importFile`）：
  - 旧实例 `dispose()`；
  - `state.view3d = new ModelView3D(box)`；
  - `state._view3dBox = box`；
  - `state.view3d.load(state.mesh)`。
- `js/views/designCenter.js:2283-2295`：`importFile` 的 `catch` 仅显示 `❌ 处理失败` 到 `#dc_validate`，`finally` 复位 busy；**没有对 `state.view3d` 做 dispose/reset**。
- `js/views/designCenter.js:2114-2119`（`restore`）：同样的 `new ModelView3D` + `load`，无 try/catch。

### 7.3 明确风险

1. **构造函数不是异常安全的**  
   如果 `new THREE.WebGLRenderer()` 抛错：
   - 之前的 `OrbitControls` 已创建并绑定 container 指针监听，但没有对象可调用 `dispose()`；
   - `state.view3d = new ModelView3D(box)` 的赋值不会完成，`state.view3d` 可能仍为已 dispose 的旧实例或 null；
   - 若后续步骤（灯光/Axes/observer/listeners）抛错，构造函数中的部分资源也没有清理路径。

2. **`_animate()` 在构造函数中部启动**  
   `_animate()` 在 ResizeObserver、window resize、pointer 拾取监听建立之前启动（`modelView3D.js:137-150`）。若这些后续步骤抛错，`_disposed` 尚未置 true 的动画循环可能继续运行；重试又创建新实例时可能出现多个 rAF 循环。

3. **`load()` 失败后实例可能残留**  
   `state.view3d` 在 `load()` 之前已赋值、`state._view3dBox` 也已设置。若 `buildMesh` / geometry / material / `fit()` 抛错：
   - `importFile` 的 catch 不 dispose、不置空；
   - 再次进入/重试时，`restore` 看到 `state.view3d` 真值且 `_view3dBox` 相同，会跳过 `new ModelView3D` 和 `load`（`designCenter.js:2114-2119`），保留一个半初始化实例。

4. **首次导入失败后的可见重试入口不足**  
   `importFile` 的 catch 文案写“可更换 STL 文件重试”，但首次导入时：
   - `#dc_importZone` 已被隐藏；
   - `#dc_replaceStl` 只在成功完成分析后才 `hidden=false`（`designCenter.js:2269-2272`）；
   - catch 内没有新增“重新选择 STL”按钮。  
   因此某些初始化/加载失败后，用户可能看不到明确的文件重选入口，只能刷新页面或尝试其他入口。

5. **`restore` 路由级初始化失败**  
   重新进入设计中心时，`restore` 内的 3D 构造/加载抛错会被 `js/app.js` 的 `mountLazy` 捕获并显示路由级错误；但 designCenter 的 `state.view3d/_view3dBox` 仍是失败后的残留状态。点击“重试”重新 render 时，可能继续复用半初始化实例，而不是重新构造。

6. **几何/材质清理路径不完整**  
   `ModelView3D.clearMesh()` 只清空 Group 引用，不调用 geometry/material 的 `dispose()`（`modelView3D.js:598-606`）。完整 `dispose()` 会调用 `renderer.dispose()` + `forceContextLoss()`，可释放上下文；但中途失败不会执行完整 dispose，可能保留 JS/GPU 资源。

### 7.4 现有机制中看起来足够的部分

- 正常成功路径的 `ModelView3D.dispose()`（`modelView3D.js:631-653`）：
  - 置 `_disposed` 停 rAF；
  - 断开 ResizeObserver、MutationObserver、media query；
  - 移除 window resize + container 三个 pointer 监听；
  - `controls.dispose()`；
  - `renderer.dispose()` + `forceContextLoss()`；
  - 清空 container。
- `designCenter` 在正常替换 STL 前会 `state.view3d.dispose()`（`designCenter.js:2169`）；
- `restore` 在承载元素变化时会 dispose 旧实例（`designCenter.js:2114`）；
- 正常重进/重新导入路径有承载元素比对，能避免旧 box 上重复使用旧对象；
- `js/app.js` 模块导入失败/路由 render 失败已有可见错误与重试。

### 7.5 最小修复建议（本轮未实施）

1. 在 `designCenter` 的 `importFile` / `restore` 中把 `new ModelView3D` + `load` 包进 try/catch：
   - 失败时 `state.view3d?.dispose()`（若已构造）；
   - `state.view3d = null; state._view3dBox = null;`
   - 显示明确的“重新选择 STL / 重试”按钮，并把 `#dc_replaceStl` 或导入按钮恢复可见。
2. 让 `ModelView3D` 构造函数对异常自清理，或抽出一个 `createView3D(container)` 工厂：失败时 dispose 已创建的 controls/renderer/observer/listeners；`_animate()` 放在全部初始化成功之后启动。
3. `clearMesh` 在清 Group 前遍历 geometry/material 调 `.dispose()`（或至少在全量 `dispose()` 中统一释放），避免重复 load 的 GPU/JS 残留。
4. 路由级重试时若 `state.view3d` 已存在但初始化失败，应强制 dispose + 重新构造，不要复用同一 `_view3dBox`。
5. 单独补一条真实“WebGL 初始化失败”验证路径（注入失败或真实无 WebGL 环境）；不能把模块 import 失败测试当作 WebGL 失败验证。

以上属于三维核心修改，需单独授权；本轮按 169.txt 要求**没有修改** `modelView3D.js` 或 `designCenter.js` 的三维初始化/清理逻辑。

---

## 8. 代码路径核查 vs 真实环境实测

- **已实际验证：** 
  - 动态模块 `import()` 失败→错误 UI→重试→成功；
  - 已加载模块复用；
  - 首页不请求 Three；
  - 设计中心/检测中心正常加载。
- **仅代码路径核查，未真实实测：**
  - WebGLRenderer 创建失败；
  - OrbitControls 初始化失败；
  - `load()` 中 geometry/material 创建失败；
  - 首次 render 抛错；
  - 真实 GPU 不可用 / 无 WebGL 环境。
- 本轮没有修改三维核心，也没有声称这些失败路径已修复/已验证。

---

## 9. 冻结文件

| 文件 | 指纹 | 状态 |
|---|---|---|
| `calcs/riser.js` | `5cfcfef3` | 未变 |
| `calcs/riserDreq.js` | `efdc2301` | 未变 |
| `calcs/calcManifest.js` | `3bfc3e16` | 未变 |
| `js/engine/**` | 与上一轮审计一致 | 未变 |

未执行 `git reset/checkout/clean/stash`；未提交、未推送、未发布。

---

## 10. 工作区对比

| 时间点 | 分支 / HEAD | modified | untracked | 合计 |
|---|---|---:|---:|---:|
| 本轮开始 | `main` / `da1c822` | 47 | 107 | **154** |
| 本轮结束 | `main` / `da1c822` | 47 | 108 | **155** |

本轮只改：
- 既有 `index.html`、`js/i18n/zh-CN.js`、`js/i18n/en-US.js`、`css/app.css`、`scripts/browser_ui_polish_test.mjs`；
- 新增本报告（untracked）。
所有上一轮 154 项历史工作区改动均保留，未删除、未覆盖、未回退。

---

## 11. 历史工作区保护

- 未清理、未覆盖、未回退任何与本轮无关的文件；
- 未触碰冻结核心；
- 未提交、未推送、未发布；
- 未自动进入下一阶段。

---

## 12. 结论

- 首页/手机信息区已完成精简：只保留在线、GitHub、发布版本；网盘地址和提取码从两处信息区移除；社区说明已补充中英文。
- Three.js **模块导入失败**已有可用的错误/重试/缓存路径，并由本轮专项测试覆盖。
- **WebGL/3D 初始化失败**存在上述明确清理/重试风险；本轮按命令仅报告，未修改任何三维核心代码。
- 建议先完成首页信息验收；WebGL 失败修复需单独授权并补真实环境验证。
