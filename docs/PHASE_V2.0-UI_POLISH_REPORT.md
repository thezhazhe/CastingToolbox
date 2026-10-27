# PHASE V2.0 — UI POLISH 报告

> 命令：`D:\CDXProject\新建 文本文档 (168).txt`
> 日期：2026-10-27 ｜ 分支 `main` ｜ HEAD `da1c822`
> 状态：**已完成；未提交、未推送、未发布；等待人工验收。**

---

## 1. 修改目标与实际范围

本轮只处理 168.txt 指定的小范围 UI 体验问题：

1. 首页左下角信息区重新分组、统一视觉规格、补齐可点击链接与密码。
2. Three.js 三维资源从“首页即加载”改为进入工艺设计/工艺检测路由时**按需加载**，并提供不确定进度、失败提示与重试。
3. 支持与资源页删除“一个重要说明”整段，保留其他内容。
4. 工艺设计输入区的排气规则/浇注系统工程原则移入结果详细信息。
5. 三维顶部状态文字去掉边框/背景卡片。
6. 结果浇注重量标签改为“预计浇铸重量”；顶部第③步“工艺设计”改为“工艺参数”。

未修改计算引擎、冻结文件、工程默认值或计算判定。未引入 CDN/第三方依赖。

---

## 2. 首页信息区（A）

### 2.1 版本文案

- `index.html` 的侧栏版本节点显示 **V2.0**；
- `js/app.js` 运行时同步显示 **V2.0**；
- **只改界面展示**：`js/version.js`、关于弹窗、报告、package、Release、AndroidManifest 仍保持 v1.1.0，未冒充正式发布 V2.0。
- 侧栏版本节点下方仍显示“完全离线 · 数据本地”。

### 2.2 分组与链接

侧栏底部改为四组：

- **产品与下载**：在线使用、国内下载、密码 `5432`、GitHub 项目、GitHub Releases；
- **作者与联系**：作者、两个邮箱（`mailto:`）；
- **社区**：QQ 群、微信公众号；
- **开源声明**：MIT · 永久免费。

所有外链均使用完整 URL 并 `target="_blank" rel="noopener noreferrer"`；邮箱使用 `mailto:`。GitHub Releases 采用已核实的实际地址：

`https://github.com/thezhazhe/CastingToolbox/releases`

（仓库当前最新 Release 为 v1.1.0；本轮没有把它描述成 V2.0 发布。）

### 2.3 视觉与响应式

- 作者行不再使用单独的 `sf-author` 放大样式；所有 `.sf-line` / `.sf-linkline` 统一为 `.72rem / 600`；
- 分组标题使用更小的层级样式，不抢信息；
- 网址允许断行，侧栏 `.sf-about` 无横向溢出；
- 桌面侧栏底部限制最大高度并可滚动，避免短屏溢出；
- 手机（<768px）底部导航隐藏侧栏信息区，因此在首页末尾增加 `home-siteinfo`，克隆同一份分组 HTML（不复制数据、不重复维护），390px 下可见且无横向溢出。

代码位置：`index.html` 侧栏、`js/views/home.js`、`css/app.css`（`.sf-*`、`.home-siteinfo`、`.view-loading`）。

---

## 3. Three.js 按需加载（B）

### 3.1 原加载链路

- 原 `js/app.js` 静态 import `views/designCenter.js` 和 `views/inspectionCenter.js`；
- 两者静态 import `views/components/modelView3D.js`；
- `modelView3D.js` 又静态 import `three` 和 `OrbitControls`；
- 因此打开首页时，模块图就会请求 `vendor/three.module.js`、`vendor/mesh-bvh.module.js` 等资源。

### 3.2 改后触发条件

- `js/app.js` 不再静态 import 两个 3D 视图；
- 新增 `LAZY_VIEWS`：
  - `designCenter → import('./views/designCenter.js')`
  - `inspection → import('./views/inspectionCenter.js')`
- 只有进入 `#/designCenter` 或 `#/inspection` 且模块尚未加载时才 `import()`；
- 普通计算器、首页、知识库、支持页不触发 Three.js；
- 已加载模块保存在 `lazyModules`，再次进入直接复用，不重复 import/初始化。

### 3.3 进度 UI

原生 `import()` 无法可靠取得单个资源的下载字节数，因此**不显示伪造百分比**：

- 首次加载显示 `正在加载三维模块…` + 旋转指示 + 不确定进度条；
- 加载完成后移除加载层并渲染视图；
- 失败显示“加载失败”、错误详情、`重试`、`返回首页`；
- 重试会清除失败 promise，重新 import；成功后复用模块缓存。

相关代码：`js/app.js`（`LAZY_VIEWS`、`loadLazyView`、`renderLazyLoading`、`renderLazyError`、`mountLazy`），`css/app.css`（`.view-loading*`），`js/i18n/en-US.js`（新词条）。

### 3.4 防重复初始化

- `lazyModules` 缓存已加载模块；
- `lazyPromises` 合并并发 import；
- `renderSeq` 防止用户加载中切走后又覆盖新视图；
- 已加载模块再次进入直接走缓存渲染；
- 失败后允许重试，不永久卡在 loading；
- 三维模型、相机、OrbitControls、热节标记逻辑保持原实现。

---

## 4. 支持与资源页（C）

- 从 `js/views/donateView.js` 删除整段：
  - “⚠️ 一个重要说明”
  - “支持与资源不是传统广告位，不承诺首页、计算器或其他核心功能区域的广告曝光。”
- 保留支持方式、二维码、支持者展示、支持者名单说明、作者信息等；
- 删除 `en-US.js` 中仅用于该段的两条词条，未留下孤立的空白/标题；
- 更新 `scripts/browser_test.mjs`：断言该段已移除，同时保留“关于支持者名单”说明。

---

## 5. 工艺设计与结果（D）

### D1 排气规则与浇注系统工程原则

- 从设计中心参数输入区（`js/views/designCenter.js`）移除：
  - “排气规则” `<details>`
  - “浇注系统工程原则（5 条）”
- 移入结果页 `gatingSection` 的外层“详细信息”：
  - “工程说明（不参与计算）”
  - “排气规则”
  - “浇注系统工程原则（5 条）”
- 文字来源仍为 `gatingView.ENG_NOTES` / 既有排气规则；未改内容、未改计算。
- 参数区保留一行指引：排气规则与工程原则见结果页“详细信息”。
- 结果尚未生成时不会执行该段渲染，无空白/异常。

### D2 三维顶部状态去外框

- `css/app.css` 的 `.dc-hs-badge` 去掉背景、边框、padding、backdrop 容器；
- 保留状态文字、状态颜色、悬停 title 和原布局；
- 视口内增加轻微 text-shadow 保证可读性；
- 不改变热节标记/显示控制。

### D3 “预计浇铸重量”

- 设计中心浇注结果主卡：`浇注重量 G` → **预计浇铸重量**；
- 同页详细信息/整模重量核对中的对应标签改为“预计浇铸重量 G…”；
- 只改标签，数值/公式/数据流未变；
- 英文词条：`Estimated pouring weight` / `Estimated pouring weight G (÷ yield)`。

### D4 “工艺设计” → “工艺参数”

- 顶部流程条第③步显示改为“工艺参数”；
- 右侧任务面板标题同步改为“工艺参数”；
- 路由 `param`、内部 ID、事件名、模块注册名、计算逻辑均未改；
- 英文沿用既有 `Process parameters`。

---

## 6. 修改文件与主要代码位置

| 文件 | 修改 |
|---|---|
| `index.html` | 首页侧栏信息分组、V2.0 展示、产品/下载/Release 链接 |
| `js/app.js` | 侧栏代际展示、三维视图动态 import、loading/error/retry、模块缓存 |
| `js/views/home.js` | 手机首页复制同一份侧栏信息（不复制数据） |
| `js/views/donateView.js` | 删除“一个重要说明”段 |
| `js/views/designCenter.js` | 移除输入区排气规则/工程原则；第③步/任务标题改为“工艺参数” |
| `js/views/resultsCenter.js` | 结果详细信息加入排气规则/工程原则；预计浇铸重量标签 |
| `css/app.css` | 信息区分组/统一字号、手机首页信息、loading UI、三维状态去外框 |
| `js/i18n/en-US.js` / `zh-CN.js` | 新 UI 词条、侧栏分组词条、移除废弃支持页词条 |
| `tests/phase73_test.mjs` / `phase98_test.mjs` | 侧栏 V2.0 代际与版本元数据分离；作者行统一样式契约 |
| `scripts/browser_test.mjs` | 支持页“一个重要说明”移除断言 |
| `scripts/browser_s1_test.mjs` | 排气规则/工程原则不再在参数窗口 |
| `scripts/browser_s31_test.mjs` | 预计浇铸重量核心卡 |
| `scripts/browser_s5_test.mjs` | D1~D4 与 lazy 入口相关 UI 检查 |
| `scripts/browser_ui_polish_test.mjs` | 新增：首页信息、首屏不加载 Three、失败/重试/缓存、支持页、390px |

未修改：`js/engine/**`、`calcs/riser.js`、`calcs/riserDreq.js`、`calcs/calcManifest.js`。

---

## 7. 测试结果

### 7.1 浏览器

| 命令 | 结果 | 退出码 |
|---|---|---:|
| `node scripts/browser_ui_polish_test.mjs` | **14/0** | 0 |
| `node scripts/browser_s5_test.mjs` | **83/0** | 0 |
| `node scripts/browser_s1_test.mjs` | 全部通过（29 项） | 0 |
| `node scripts/browser_s31_test.mjs` | 全部通过（22 项） | 0 |
| `node scripts/browser_test.mjs` | 全部通过 | 0 |
| `node scripts/browser_responsive_test.mjs` | 全部通过 | 0 |
| `node scripts/browser_s3_test.mjs` | 全部通过 | 0 |
| `node scripts/browser_p78_test.mjs` | 全部通过 | 0 |
| `node scripts/browser_i18n_audit.mjs` | 0 遗漏，无运行时异常 | 0 |

关键覆盖：

- 首页首次加载 `three/mesh-bvh/modelView3D` 成功响应数 = **0**；
- 阻断 Three.js 后进入设计中心：显示错误 + 重试，无伪造百分比；
- 解除阻断重试成功，Three.js 真正响应；
- 回首页再进设计中心：Three.js 响应数不增加，无重复加载；
- 工艺检测中心同样可加载/渲染；
- 首页信息四组、完整链接、密码、字体一致性、英中文、390px；
- 支持页说明移除；
- D1 规则位于结果详细信息且不在参数区；D2 无边框/背景；D3 标签；D4 第③步文案。

### 7.2 Node 专项

| 命令 | 结果 | 退出码 |
|---|---|---:|
| `node tests/runner.mjs phase73` | **7/0** | 0 |
| `node tests/runner.mjs phase98` | **11/0** | 0 |
| `node tests/runner.mjs phase72` | **12/0** | 0 |

本轮为 UI 改动，**未运行全量 Node**（按 168.txt 要求不跑不必要的长耗时测试）。

### 7.3 未覆盖/限制

- `browser_ui_polish_test` 通过 CDP 阻断本地 vendor 资源模拟失败；未在真实 GitHub Pages 慢网/断网环境验证网络时序；
- 加载进度为**不确定进度**，不是字节百分比（原生 `import()` 无可靠字节回调）；
- WebGL 初始化失败未单独用真实不可用 GPU 环境验证；`mod.render` 抛错会进入同一错误/重试层，但重试对已创建资源的重复初始化保障主要依赖现有 designCenter 的承载元素比对/dispose 逻辑；
- 未重跑 `browser_inspection_test` 全量（其目标页面已由本轮 `browser_ui_polish_test` 覆盖加载/渲染；完整功能依赖既有 S31/历史基线）；
- 未运行全量 Node；未改动计算链。

---

## 8. 冻结文件核查

| 文件 | 指纹 | 状态 |
|---|---|---|
| `calcs/riser.js` | `5cfcfef3` | 未变 |
| `calcs/riserDreq.js` | `efdc2301` | 未变 |
| `calcs/calcManifest.js` | `3bfc3e16` | 未变 |
| `js/engine/**` | 与 R8-FIX 审计一致 | 未变 |

未执行 `git reset/checkout/clean/stash`；未提交、未推送、未发布。

---

## 9. 工作区对比

| 时间点 | 分支 / HEAD | modified | untracked | 合计 |
|---|---|---:|---:|---:|
| 本轮开始 | `main` / `da1c822` | 43 | 105 | **148** |
| 本轮结束 | `main` / `da1c822` | 47 | 107 | **154** |

本轮新增 4 个 modified：`index.html`、`js/app.js`、`js/views/home.js`、`js/views/donateView.js`；
新增 2 个 untracked：`scripts/browser_ui_polish_test.mjs`、本报告。另在**本轮前已有的**未提交测试文件
`browser_s1/s31/s5`、`browser_test`、`phase73/98` 中做了本轮契约更新（不改变文件计数）。
其余 148 项原有工作区资产未删除、未回退。

---

## 10. 剩余问题与人工验收建议

1. 在桌面 1366×900 与手机 390×844 查看首页信息区：链接可点、密码可见、无横向溢出。
2. 退出/刷新后首次进入工艺设计中心：观察“正在加载三维模块…”不确定进度，不应出现百分比；完成后 3D 正常。
3. 用 DevTools 阻断 `vendor/three.module.js` 后进入：应显示错误/重试；解除后重试成功；回首页再进不重复加载。
4. 进入工艺检测中心：同样按需加载并可正常渲染。
5. 打开结果页“经典浇注系统设计 → 详细信息”：确认排气规则/工程原则在内，参数窗口不再有这两块。
6. 检查三维视口顶部状态文字无边框/背景；检查结果主卡“预计浇铸重量”和第③步“工艺参数”。
7. 检查支持与资源页无“一个重要说明”，其余支持内容/名单说明仍完整。
8. 英文界面切换后检查上述文案；侧栏 V2.0 仅展示，不改变关于/报告/package 的 v1.1.0 元数据。

**建议人工验收。**
