# PHASE V2.0 — WebGL 初始化失败恢复

> 命令：`D:\CDXProject\新建 文本文档 (170).txt`
> 日期：2026-10-27 ｜ 分支 `main` ｜ HEAD `da1c822`
> 状态：**已实施并完成专项验证；未提交、未推送、未发布。**

---

## 1. 修复前问题核对

169 报告 §7.3 指出的风险与当前代码一致；本轮按实际代码修复，并额外发现两处同类资源问题。

### 1.1 构造函数异常安全（`modelView3D.js`）

- 旧顺序：`OrbitControls` 先于 `WebGLRenderer` 创建。Renderer 失败时，Controls 已绑定 container 监听，但没有实例引用可调用 `dispose()`。
- `_animate()` 在构造函数中部启动；后续初始化抛错会留下无人停止的 rAF 循环。
- 构造函数没有 try/catch，资源只能依赖调用方；而调用方在 `new` 抛错时拿不到实例。

### 1.2 动画循环与监听器

- `_animate()` 只靠 `_disposed` 自检；没有保存 `requestAnimationFrame` ID，`dispose()` 无法取消已排队的下一帧。
- `dispose()` 非幂等：重复调用会重复执行 `controls.dispose()` / `renderer.dispose()`，可能抛错。
- 旧 `dispose()` 用 `container.innerHTML = ''` 清空承载元素，会连带清掉非本实例创建的节点。

### 1.3 geometry / material

- 旧 `clearMesh()` 只 `Group.clear()`，不释放 geometry/material；旧 `setHotspots()` / `setFlowOverlay()` 也只用 `clear()`，反复替换会累积 GPU/JS 资源。
- 额外发现：three 的 `Sprite` geometry 是**模块级共享对象**（所有 Sprite 共用同一份），不能像普通 mesh geometry 一样 dispose。
- 额外发现：`load()` / `loadScene()` 在对象加入 Group 之前失败时，局部 geometry/material 不在任何 Group 内，实例 `dispose()` 也看不到。

### 1.4 designCenter 初始化 / 恢复

- `importFile`、`restore` 直接 `state.view3d = new ModelView3D(box); state.view3d.load(...)`；任一步抛错时 `state.view3d` 可能已赋值但对象无效。
- `importFile` 的 catch 只写错误文字，不 dispose、不置空、不显示重试入口。
- 首次导入失败后 `#dc_importZone` 已隐藏，而 `#dc_replaceStl` 只在分析成功后才显示；错误文案写着“可更换 STL 文件重试”，但用户可能看不到入口。
- 同一个文件失败后再次选择时，若 `#dc_file.value` 未复位，`change` 事件不会再触发。

---

## 2. 修改文件

| 文件 | 修改 |
|---|---|
| `js/views/components/modelView3D.js` | 构造函数异常安全；Renderer 先于 Controls；动画循环延后启动并保存/取消 rAF ID；新增 `_releaseResources()`、`_disposeGroup()`；`dispose()` 幂等；`clearMesh` / `setHotspots` / `setFlowOverlay` 释放资源；`load` / `loadScene` 局部失败回收；清理调试全局引用。 |
| `js/views/designCenter.js` | 新增 `buildView3D()` / `viewErrorTitle()` / `showViewFailure()`；`importFile` 分阶段错误、失败回收、重试入口、文件输入复位；`restore` 构造/加载失败时清空引用并恢复导入入口。 |
| `js/i18n/en-US.js` | 新增本阶段错误标题/提示的英文词条。 |
| `scripts/browser_webgl_recovery_test.mjs` | **新增**专项测试（组件级 + 真实 designCenter UI + 390px 手机）。 |
| `docs/PHASE_V2.0-WEBGL_INITIALIZATION_RECOVERY_REPORT.md` | **新增**本报告。 |

未修改冻结文件；未新增运行时依赖。

---

## 3. 构造函数异常安全性的修复方式

`js/views/components/modelView3D.js:59` 起：

1. 实例先置 `_disposed=false`、`_raf=null`，整个初始化过程包在 try/catch 中。
2. **Renderer 先于 OrbitControls 创建**：WebGL 不可用时直接抛错，此时还没有任何 Controls 或 container 监听需要回收。
3. 所有后续资源（controls、灯光、Axes、MutationObserver、media query、Group、pointer 监听、ResizeObserver、window resize）都在同一个 try 内创建。
4. **`_animate()` 移到全部初始化成功之后**才启动。
5. catch 中：置 `_disposed=true`，调用 `_releaseResources()` 回收已创建资源，再抛原错误。
6. `_releaseResources()` 每一步独立 `try/catch` + 可选链，能处理 `renderer` / `controls` / 各 Group / 监听器尚未创建的部分初始化状态；一个资源释放失败不阻断其余释放。
7. 构造函数失败时对象不会返回给调用方，因此不能依赖调用方 `dispose()`；自清理是唯一可行路径。

**残留边界：** 如果 `new THREE.WebGLRenderer()` 在 three 内部、返回实例之前抛错，组件拿不到该 renderer 的引用，无法回收其内部已创建的上下文。本轮模拟的“WebGL context 创建失败”路径不会产生上下文（测试确认 `glCreated` 未增加）；three 返回实例后的所有失败路径均可回收。

---

## 4. 动画循环、监听器、geometry/material 清理

### 4.1 动画循环

- `_animate()` 每帧把 rAF ID 写入 `this._raf`；`dispose()` / `_releaseResources()` 调用 `cancelAnimationFrame(this._raf)`。
- `_animate()` 首行 `if (this._disposed) return;`，已排队的帧执行后不会继续自续。
- 渲染抛错时不再排下一帧（避免每帧刷错/空转），资源仍由 `dispose()` 统一释放。
- `dispose()` 幂等：`if (this._disposed) return;`，重复调用不抛异常。

### 4.2 事件监听器

- `dispose()` / `_releaseResources()` 移除：
  - ResizeObserver、MutationObserver、media query；
  - window `resize`；
  - container 的 `pointerdown`（两套：`_onPick`、`_onDown`）和 `pointerup`；
  - `OrbitControls` 挂在 container 上的整套监听（`controls.dispose()`）。
- 专项测试在同一个 `#dc_view3dBox` 上经历“失败 → 成功 → 失败 → 成功 → 连续失败 → 成功”后，DOM 事件监听器数量保持 **7 → 7**，没有累积。

### 4.3 geometry / material / texture

- 新增 `_disposeGroup(group)`：遍历 Group，用 Set 去重后释放 geometry、material、常见贴图（`map` / `alphaMap` / `normalMap` / `roughnessMap` / `metalnessMap` / `emissiveMap`），再 `group.clear()`。
- **共享资源保护：** `Sprite` 的 geometry 是 three 模块级共享的同一份 `_geometry`，`_disposeGroup` 明确跳过 `o.isSprite` 的 geometry；SpriteMaterial 与每个标签的 CanvasTexture 仍正常释放。
- `clearMesh()` 现在释放 `meshGroup` / `hsGroup` / `flowGroup` 三组资源，并清空 hotspot / marker / pick 引用。
- `setHotspots()`、`setFlowOverlay()` 替换内容前先 `_disposeGroup` 旧内容。
- `_releaseResources()` 额外释放 `AxesHelper` 的 geometry/material，并移除本实例的 canvas；不再清空整个 container（避免误删非本实例节点）。
- `load()` / `loadScene()` 在对象加入 Group 前失败时，释放本次创建的局部 geometry/material，避免“未入场景 ⇒ 实例清理看不到”的泄漏。

**所有权核对：**

| 资源 | 所有权 | 处理 |
|---|---|---|
| `buildMesh` 生成的 mesh geometry/material | 本实例 | dispose |
| hotspot 的 SphereGeometry / BasicMaterial / CanvasTexture | 本实例 | dispose |
| flow overlay 的 Tube/Line/Sphere/Arrow 资源 | 本实例 | dispose |
| `AxesHelper` geometry/material | 本实例 | dispose |
| `Sprite` 的共享 geometry | three 模块级共享 | **不 dispose** |
| `renderer` / WebGL 上下文 | 本实例 | `dispose()` + `forceContextLoss()` |

---

## 5. designCenter 初始化 / 恢复与重试入口

### 5.1 统一的创建入口

`designCenter.js:2097` 新增 `buildView3D(box, mesh)`：

- `new ModelView3D` 失败 → 构造函数已自清理，标记 `dcViewStage='create'` 后抛出；
- `inst.load(mesh)` 失败 → `inst.dispose()` 后标记 `dcViewStage='load'` 再抛出；
- **只有两步都成功才返回实例**；调用方在此之后才写 `state.view3d` / `state._view3dBox`。

### 5.2 `restore()`（`designCenter.js:2133`）

- 承载元素变化时先 dispose 旧实例，并把 `state.view3d` / `_view3dBox` 先置空。
- 用 `buildView3D` 创建；成功后才登记。
- 失败时：清空两个引用、隐藏 `#dc_view3d`、显示 `#dc_importZone`、显示 `#dc_replaceStl` / `#dc_deleteStl`、在既有 `#dc_validate` 区域显示错误与下一步提示。
- 不修改页面结构；失败后重进/换语言仍会重新尝试创建。

### 5.3 `importFile()`（`designCenter.js:2199`）

- 新增阶段变量：`parse → model → view → analysis`；catch 按真实阶段给标题，不再把所有错误都写成“STL 解析失败”。
- 三维创建前先 dispose 旧视图并置空引用；`buildView3D` 成功后才登记。
- 视图阶段失败：`state.view3d=null`、`_view3dBox=null`；显示导入区与顶部导入按钮。
- 分析阶段失败：三维视图本身有效，**不销毁**；显示顶部 `导入 STL` 供重试。
- `finally` 复位 `#dc_file.value`，同一文件可再次触发 `change`。
- 错误文字写入既有 `#dc_validate`，不新增弹窗/页面。

### 5.4 重试入口显示规则

| 场景 | `#dc_view3d` | `#dc_importZone` | `#dc_replaceStl` | 标题 |
|---|---|---|---|---|
| 首次解析失败（无旧 mesh） | 隐藏 | 显示 | 隐藏 | STL 解析失败 |
| Renderer 创建失败 | 隐藏 | 显示 | 显示 | 三维视图初始化失败 |
| 实例创建成功、模型 load 失败 | 隐藏 | 显示 | 显示 | 三维模型加载失败 |
| 分析失败（视图有效） | 显示 | 隐藏 | 显示 | 分析未完成 |
| `restore` 创建/加载失败 | 隐藏 | 显示 | 显示 | 三维视图初始化失败 / 三维模型加载失败 |
| 重试成功 | 显示 | 隐藏 | 显示 | — |

桌面和 390px 手机均使用同一套既有元素；专项测试确认手机失败后“选择 STL 文件”按钮可见、页面无横向溢出。

### 5.5 并发与状态归属

- 现有 `state.busy` 已阻止同一设计中心内的第二次导入。
- 视图创建、`load()`、`state.view3d` 登记在同一个同步执行段内，不会与其他导入交错到同一个容器。
- 失败清理只在 `stage === 'view'` 时清空 `state.view3d`；分析阶段失败不会误伤仍然有效的实例。
- **未额外引入操作序号/取消令牌**：当前结构下没有“同一容器两个并发导入”的路径；避免为理论情况增加状态机。
- 已知既有行为（本轮未改）：离开设计中心到其它页面时，`state.view3d` 会保留到下次进入 `restore()` 才按承载元素比对销毁；这不影响失败恢复，也不会累积多个画布/动画循环。页面切换期间旧导入对旧 container 的 DOM 更新仍属既有路由生命周期问题。

### 5.6 本轮未覆盖的边界

- **首次 render / 运行中 context lost**：`_animate()` 捕获渲染错误后会停止该实例的循环（不再每帧抛错），但不会回调 designCenter 显示“重试”UI；本轮必测场景是“Renderer 创建失败”和“模型 load 失败”，没有把运行期渲染错误升级为页面级失败。
- **three 内部在返回 renderer 之前抛错**：见 §3 残留边界，组件拿不到该对象引用，无法回收其内部资源。
- **检测中心**：其 `new ModelView3D` 页面级调用未改；构造函数自清理同样生效，但其自己的失败重试入口不在本阶段范围。

---

## 6. 实际执行的测试

| 命令 | 结果 | 退出码 |
|---|---|---:|
| `node scripts/browser_webgl_recovery_test.mjs` | **33/0** | 0 |
| `node scripts/browser_ui_polish_test.mjs` | **15/0** | 0 |
| `node scripts/browser_stl_p22_test.mjs` | **19/1**（1 项既有基线失败，见下） | 1 |
| `node tests/runner.mjs phase21` | **7/0** | 0 |
| `node tests/runner.mjs phase22` | **17/0** | 0 |
| `node tests/runner.mjs phase73,phase98` | **18/0** | 0 |
| `node tests/runner.mjs phasev2021` | **17/0** | 0 |
| `node scripts/browser_i18n_audit.mjs` | 0 遗漏、无运行时异常 | 0 |
| `node scripts/i18n_audit.mjs`（静态补充检查） | 2 条既有长句缺英文（非本阶段新增） | 1 |

### 6.1 新增专项测试覆盖

`scripts/browser_webgl_recovery_test.mjs`：

- **A 正常初始化**：组件级创建、真实 mesh 加载、`loadScene` 多对象加载与拾取、`clearMesh` 释放 geometry/material、正常 dispose；`loadScene` 在 translate 处失败时释放未入场景的 geometry/material；真实 designCenter 导入 cube50.stl 成功。
- **B Renderer 创建失败**：mock `HTMLCanvasElement.getContext('webgl*')` 返回 null → 构造抛错；容器无 canvas、rAF 增量为 0、未创建 WebGL 上下文；UI 显示错误、导入区与顶部导入按钮均可见；解除故障后重试成功。
- **C 模型加载失败**：mock `BufferGeometry.translate` 抛错 → 实例创建成功但 load 失败；实例被 dispose，无 canvas/动画循环，状态不保留；错误标题为“三维模型加载失败”；再次导入成功恢复。组件级另验证 load 失败会释放未入场景的 1 个 geometry + 1 个 material。
- **D 连续失败/重试**：2 次连续 Renderer 失败 + 最终成功；每次失败后 canvas=0、rAF=0、WebGL 上下文不增加；成功后 canvas=1、rAF=1；同一容器 DOM 监听器 7→7。
- **E 页面切换**：返回首页再进入设计中心，视图恢复且只有一个动画循环。
- **F `restore()` 失败**：带着已有 STL 重进页面时 mock Renderer 失败 → 错误可见、无 canvas/循环、未新增上下文、导入区与导入按钮可见；解除后重新导入恢复。
- **G 390px 手机**：导入失败后“选择 STL 文件”入口可见、无横向溢出；重试成功后 canvas=1、rAF=1、无横向溢出。

### 6.2 既有失败 / 补充检查说明

- `browser_stl_p22_test.mjs` 唯一失败：
  `✗ marker 半径有尺度差异（V3） — r=[18.29,18.29]`
  这是既有基线失败（此前报告记录为 `browser_stl_p22` 的已知项）；本轮未修改 `hotspotDisplay.js` / 半径计算 / 热结数据，失败断言与本次改动无交集。其余 19 项通过。
- `scripts/i18n_audit.mjs` 的 2 条缺失是 `designCenter` 既有 `\n` 长句：静态脚本按源码原文比较、不反转义 `\n`，无法与词条表匹配；本轮未新增这 2 条。实际渲染页面的 `browser_i18n_audit` 为 0 遗漏。

---

## 7. 哪些结论来自 mock / 自动化，哪些来自真实浏览器

- **真实浏览器实测（无头 Edge + 真实 Three.js / 真实 WebGL 上下文；`--disable-gpu` 下为软件渲染，不是硬件 GPU）**：
  - 正常创建、canvas 尺寸、模型加载、热结 marker、正常 dispose；
  - designCenter 真实 `importFile`、cube50.stl 真实解析与分析、真实 DOM 状态；
  - 页面切换、390px 响应式布局、DOM 监听器数量。
- **受控 mock 的异常路径（不是真实显卡故障）**：
  - `getContext('webgl2'/'webgl')` 返回 null 模拟 Renderer 创建失败；
  - `BufferGeometry.translate` 抛错模拟模型加载失败。
- **未做真实 GPU 故障 / 无 WebGL 硬件环境实测**；未声称真实显卡异常已复现。

---

## 8. 未执行的测试及原因

- 未跑全量 Node（170.txt 明确“不跑全量，除非专项暴露问题”）。
- 未跑 `browser_s5` / `browser_s1` / `browser_s31` / `browser_test` / `browser_responsive` / `browser_dc_715` / `browser_inspection_test`：本轮只改三维生命周期与失败路径，已用新增专项 + `browser_stl_p22` 的正常导入/热结链覆盖；这些脚本不属于直接受影响面，且部分耗时较长。
- 未测试检测中心（`inspectionCenter`）自己的创建失败 UI：本轮未改其初始化代码；`ModelView3D` 构造函数自清理同样适用于它，但其页面级重试入口不在本阶段范围。

---

## 9. 冻结文件与工作区

### 9.1 冻结文件（sha256 前 8 位）

| 文件 | 指纹 | 状态 |
|---|---|---|
| `calcs/riser.js` | `5cfcfef3` | 未变 |
| `calcs/riserDreq.js` | `efdc2301` | 未变 |
| `calcs/calcManifest.js` | `3bfc3e16` | 未变 |
| `js/engine/**` | — | 本轮未修改；工作区既有改动保留 |

未执行 `git reset` / `git checkout` / `git clean` / `git stash`。

### 9.2 工作区对比

| 时间点 | 分支 / HEAD | modified | untracked | 合计 |
|---|---|---|---:|---:|
| 本轮开始 | `main` / `da1c822` | 47 | 108 | **155** |
| 本轮结束（含报告） | `main` / `da1c822` | 47 | 110 | **157** |

本轮新增 untracked：`scripts/browser_webgl_recovery_test.mjs`、本报告。其余 155 项历史改动全部保留，未删除、未覆盖、未回退。

---

## 10. 结论

- 初始化失败不再留下运行中的动画循环；失败实例不会以有效身份留在 `state.view3d`。
- 构造函数、`load`/`loadScene`、`clearMesh`、`setHotspots`、`setFlowOverlay`、`dispose` 均按“本实例拥有”释放资源；共享的 Sprite geometry 被明确排除。
- 首次导入失败、Renderer 创建失败、模型加载失败、`restore` 失败后，用户都能在桌面和手机看到明确的重新选择文件入口；重试成功后三维视图恢复。
- 连续失败/重试不累积 canvas、rAF 循环、WebGL 上下文或 DOM 监听器。
- 正常三维显示、相机、OrbitControls、热结标记与铸造计算逻辑未改；冻结文件指纹未变。
- 未提交、未推送、未发布；停止，等待人工验收。
