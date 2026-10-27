# PHASE V2.0 — ArrowHelper 共享 Geometry 最小修复

> 命令：`D:\CDXProject\新建 文本文档 (172).txt`
> 日期：2026-10-27 ｜ 分支 `main` ｜ HEAD `da1c822`
> 状态：**已修复并完成专项验证；未提交、未推送、未发布。**

---

## 1. 修复前的问题

171 只读核查确认 Three.js r160 的 `ArrowHelper` 内部：

- `line.geometry` 与 `cone.geometry` 是模块级共享对象（`_lineGeometry` / `_coneGeometry`）；
- 所有 `ArrowHelper` 实例、所有 `ModelView3D` 实例共用这两份 geometry；
- `_disposeGroup()` 原来只跳过 Sprite 的共享 geometry，会把 ArrowHelper 的 line/cone geometry 当作本实例资源 dispose。

`setFlowOverlay()` 中带 `dir` 的 marker 会创建 `ArrowHelper`。因此一旦调用该公开方法，清理 `flowGroup` 就可能误释放另一视图/后续 ArrowHelper 仍在使用的共享 geometry。

**当前生产调用图：** 当前源码中没有 `setFlowOverlay()` 调用点（`grep` 仅见方法定义/注释；`tests/phase94_test.mjs:661` 还断言主流程不得调用它）。所以这是**代码级潜在风险**，不是当前页面已观察到的故障。

---

## 2. 实际修改

只修改 `js/views/components/modelView3D.js` 的 `_disposeGroup()`：

```js
const isArrowHelperPart = o.parent?.type === 'ArrowHelper'
  && (o === o.parent.line || o === o.parent.cone);
if (o.geometry && !o.isSprite && !isArrowHelperPart) geos.add(o.geometry);
```

判断依据：

- Three.js r160 的 `ArrowHelper` 把 `line` / `cone` 作为直接子对象，`parent.type === 'ArrowHelper'`；
- 用 `o === parent.line || o === parent.cone` 精确限定，不误伤 ArrowHelper 可能新增的其他子对象；
- 只跳过 geometry；`material` 仍按原逻辑收集并释放（每个 ArrowHelper 的 line/cone material 都是独立创建的）；
- Sprite 的共享 geometry 保护保持原样；
- `Set` 去重、`dispose()` 幂等、`clearMesh()` / `setHotspots()` / `setFlowOverlay()` 行为均未改。

没有修改 `setFlowOverlay()` 的创建逻辑、业务行为或其他资源管理方式。

---

## 3. ArrowHelper geometry / material 生命周期验证

专项测试（真实浏览器，`scripts/browser_webgl_recovery_test.mjs` 扩展）：

- 创建 2 个在测试 Group 内的 ArrowHelper + 1 个 Group 外的 ArrowHelper；
- 确认三者 `line.geometry` 是同一对象、`cone.geometry` 是同一对象（`true/true`）；
- 对共享 geometry 与各实例独立 material 安装 `dispose()` 计数器；
- 调用 `inst._disposeGroup(testGroup)`。

结果：

| 检查 | 结果 |
|---|---|
| 共享 line/cone geometry 的 `dispose()` | **0 次** |
| Group 内 2 个 ArrowHelper 的 line/cone material | 每个 **1 次**（共 4 次） |
| Group 外 ArrowHelper 的 geometry `dispose()` | **0 次** |
| Group 外 ArrowHelper 的 material `dispose()` | **0 次** |
| Group 子对象数 | **0** |
| 重复调用 `_disposeGroup()` | 不抛异常；geometry 仍 0 次，material 仍各 1 次（不重复释放） |

结论：共享 geometry 不再被误释放；ArrowHelper 自己拥有的 material 正常释放；清理一个 Group 不影响另一个仍在使用共享 geometry 的 ArrowHelper。

---

## 4. Sprite 共享 geometry 保护

专项测试直接构造 `Sprite` + `SpriteMaterial` + `CanvasTexture`，调用 `_disposeGroup()`：

| 资源 | 结果 |
|---|---|
| Sprite 共享 geometry `dispose()` | **0 次**（保护保持） |
| SpriteMaterial `dispose()` | **1 次** |
| CanvasTexture `dispose()` | **1 次** |
| Group 子对象数 | **0** |

---

## 5. 普通 Mesh 释放与 Set 去重

- 独立 Mesh：SphereGeometry + MeshBasicMaterial → geometry **1 次**、material **1 次**，Group 清空。
- 两个 Mesh 共享同一 geometry/material → Set 去重后各 **1 次**（同一 Group 内不重复释放）。
- 未改变 `clearMesh()` / `dispose()` 的既有行为；170 的初始化失败、重试、页面切换专项继续通过。

---

## 6. 实际运行的测试

| 命令 | 结果 | 退出码 |
|---|---|---:|
| `node scripts/browser_webgl_recovery_test.mjs` | **39/0**（原 33 + 本轮 6 项资源检查） | 0 |
| `node scripts/browser_ui_polish_test.mjs` | **15/0** | 0 |
| `node tests/runner.mjs phase21` | **7/0** | 0 |
| `node tests/runner.mjs phase22` | **17/0** | 0 |
| `node tests/runner.mjs phase73,phase98` | **18/0** | 0 |
| `node tests/runner.mjs phasev2021` | **17/0** | 0 |
| `node scripts/browser_i18n_audit.mjs` | 0 遗漏、无运行时异常 | 0 |
| `node --check js/views/components/modelView3D.js` | 语法通过 | 0 |
| `node --check scripts/browser_webgl_recovery_test.mjs` | 语法通过 | 0 |

**未重跑 `browser_stl_p22_test.mjs`**：其 19/1 的 `marker 半径有尺度差异（V3） r=[18.29,18.29]` 已由 171 确认为历史基线；本轮改动只影响 `_disposeGroup` 的 ArrowHelper geometry 判断，不涉及热节半径。若后续重跑，该失败仍应单独记录，不归入本轮回归。

**未跑全量 Node**（172.txt 明确不要求）；**未做真实硬件 GPU 故障测试**。本次资源检查是真实无头 Edge 浏览器中的 JS 级 `dispose()` 计数，不是 GPU 硬件故障实测。

---

## 7. 新发现 / 遗留风险

1. `setFlowOverlay()` 当前仍无生产调用点；本次修复是**代码级预防**，未新增调用，也没有改变其业务行为。
2. `setHotspots()` / `setFlowOverlay()` 在局部 Group 尚未加入父 Group 时若构造抛错，仍可能留下局部资源（171 已指出；172 §4.2 明确不在本轮修复）。
3. `buildMesh()` 内部创建后自身抛错的 geometry 仍无法由视图追踪（无引用、尚未上传 GPU；171 已指出）。
4. Set 去重仍只在单次 `_disposeGroup()` 内生效，不提供跨 Group / 跨实例的通用保护；当前项目没有这类共享（Sprite / ArrowHelper 的共享 geometry 已专门处理）。
5. 170 报告 §4.3 的所有权表把 Arrow 资源整体归为本实例；该表述不完整，本次 172 报告即为更正。按 171/172 要求，未修改 170 报告。
6. 历史 `browser_stl_p22` marker 半径失败保持原状，未修复、未放宽断言。

---

## 8. 分支 / HEAD / 工作区

| 时间点 | 分支 / HEAD | modified | untracked | 合计 |
|---|---|---|---:|---:|
| 本轮开始 | `main` / `da1c822` | 47 | 110 | **157** |
| 本轮结束（含报告） | `main` / `da1c822` | 47 | 111 | **158** |

新增 untracked：本报告 1 个。`scripts/browser_webgl_recovery_test.mjs` 是 170 已存在的 untracked 文件，本轮只在其内部追加 ArrowHelper/Sprite/Mesh 资源检查，未增加文件数。所有历史改动保留。

---

## 9. 冻结文件

172 未修改：

- `js/engine/**`
- `calcs/riser.js`
- `calcs/riserDreq.js`
- `calcs/calcManifest.js`

sha256 前 8 位与 170/171 基线一致：

| 文件 | 指纹 |
|---|---|
| `calcs/riser.js` | `5cfcfef3` |
| `calcs/riserDreq.js` | `efdc2301` |
| `calcs/calcManifest.js` | `3bfc3e16` |

（这些文件在工作区本来就有历史未提交状态；本轮未触碰、未回退。）

未执行 `git reset` / `git checkout` / `git clean` / `git stash`。

---

## 10. 结论

- `_disposeGroup()` 不再 dispose ArrowHelper 的模块级共享 line/cone geometry；
- ArrowHelper 独立 material、SpriteMaterial、CanvasTexture、普通 Mesh geometry/material 仍按原逻辑释放；
- Sprite 共享 geometry 保护保持；Set 去重与 `dispose()` 幂等保持；
- 专项 39/0，UI polish 15/0，指定 Node 回归全部 0 失败，browser i18n 0；
- 未提交、未推送、未发布；停止，等待人工验收。
