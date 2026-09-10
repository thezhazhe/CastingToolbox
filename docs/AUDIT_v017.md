# Casting Toolbox v0.17 · STL 数据链架构审计报告

日期：2026-08-19 ｜ 依据：命令6.txt（第一阶段：审计、测试与稳定化）
结论：底层数据链（STL → Mesh → Geometry → Coordinate → Result）**正确、稳定、可测试**；
本阶段发现 2 个 Critical / 3 个 High 问题，已全部修复并加回归防线。

---

## 1. Current Architecture（当前架构）

```
STL 文件（Binary/ASCII）
   │  parseSTL（js/engine/stl.js）—— 纯 JS，浏览器/Node 通用
   ▼
Mesh {vertices:Float32Array, triCount, normals?, warnings}
   │  validateMesh（js/engine/meshValidation.js）—— 闭合性/退化/非法顶点
   ▼
BufferGeometry + MeshBVH（js/engine/mesh3d.js，three.js 只做显示与加速查询）
   │
   ├── analyzeGeometry（js/engine/geometryAnalysis.js）
   │     距离场（js/engine/distanceField.js：扫描线判内外 ×3 轴投票 + BVH 最近点）
   │     → GeometryResult {unit, bounds, size, volume, area, center, wallMax/Avg/Main, hist}
   │
   ├── analyzeHotspots（js/engine/hotspot.js）
   │     候选(26邻域局部极大+NMS) → Region BFS → 重叠合并 → 谷值分裂
   │     → 代表点（区域最高分+inside 校验）→ refineMc 亚体素精化
   │     → HotspotResult {status, reason, hotspots[{id, center, mc, regionVolume, validation}]}
   │
   └── ModelView3D（js/views/components/modelView3D.js）—— 只负责显示
         load() 时 translate(-center) 居中（仅显示层坐标）
         setHotspots() 同样减 center（与模型同坐标系）
```

**坐标链**：STL 原始坐标 → BVH（同坐标）→ 距离场（同坐标）→ 热结（同坐标）→
3D 显示时整体平移到 bbox 中心（显示层偏移，`setHotspots` 做同量平移）。
**无重复坐标转换**，Viewer 与 Geometry 使用同一原始坐标，未来换 Viewer 不影响算法。

**单位**：STL 无单位 → 导入时确认（mm/cm/m/inch），内部**统一 mm**；
体积/面积在写入 CastingProject 时按 `UNIT_SCALE` 换算（cm³/cm²），壁厚/尺寸直接 mm。
核心引擎（距离场/热结）始终工作在 STL 原始坐标，不经单位换算。

**解耦**：
- 引擎模块（stl/meshValidation/mesh3d/distanceField/geometryAnalysis/hotspot）零 DOM 依赖，Node 可测
- CastingProject 数据模型（js/model/CastingProject.js）带 source/confidence 元数据
- designCenter.js 是唯一桥接层：引擎结果 → 项目参数 → 计算器（calcs/ 纯函数）
- 计算器（gating/riser/yield）完全不知道 STL 存在

---

## 2. Problems Found（发现问题）

| # | 问题 | 风险 | 说明 |
|---|------|------|------|
| P1 | parseBinary 直接按 triCount 字段分配内存 | **Critical** | 损坏/恶意文件 triCount=0xFFFFFFFF → 申请 ~150GB 内存直接崩溃 |
| P2 | Raycaster 走 three 默认暴力遍历，未用 BVH | **Critical** | 25 万面网格 × 2.7 万射线 ≈ 60s+（实测），真实零件 STL 无法使用 |
| P3 | isBinary 判据可能误判合法 ASCII | High | ASCII 文件长度恰好 84+50n 时被当二进制解析 → 垃圾几何 |
| P4 | 导入后同步大计算冻结主线程 | High | 分析期间 UI 完全无响应（用户实测：任务无法勾选） |
| P5 | 热结球半径 = mc×0.9 | High(UI) | cube50 的球直径 45mm 几乎占满零件，遮挡几何 |
| P6 | 手工输入参数无入口 | Medium | 无 STL 时整个设计中心不可用 |
| P7 | validateMesh 闭合容差为绝对 0.001mm | Medium | 1e6 mm 级大模型顶点 key 可能碰撞 → 误判闭合 |
| P8 | 极小尺寸模型 bounds 为 Infinity/NaN | Low | 空网格几何分析会产出 NaN 尺寸（不崩溃，显示 —） |
| P9 | 单元测试套件无性能断言 | Low | 慢路径（P2）在测试中跑数分钟而不报失败 |

## 3. Recommended Changes（建议修改）

1. P1：triCount 超过文件容量时截断 + warning（已实施）
2. P2：`THREE.Mesh.prototype.raycast = acceleratedRaycast`（已实施）
3. P3：ASCII 文本特征优先于长度判据（已实施）
4. P4：距离场分片执行（scanAxis 按行让出，MessageChannel 免 timer 节流）（已实施）
5. P5：球半径 = clamp(0.35×mc, 3, minSize/4)（已实施）
6. P6：手动输入模式（已实施）
7. P7：闭合容差改相对值（建议下一阶段；影响面小）
8. P9：已通过 stability_test + engine_sliced_test 建立防线（已实施）

## 4. Changes Made（实际修改）

| 文件 | 修改 |
|------|------|
| js/engine/stl.js | triCount 防御截断；isBinary ASCII 特征优先 |
| js/engine/mesh3d.js | Raycaster BVH patch（30× 性能）；distanceToSurfaceSliced |
| js/engine/distanceField.js | scanAxisSliced/scanInsideSliced/buildDistanceFieldSliced（分片） |
| js/engine/geometryAnalysis.js | 拆分 fromDistanceField；analyzeGeometrySliced |
| js/engine/hotspot.js | 拆分 analyzeWithDistanceField；analyzeHotspotsSliced |
| js/views/designCenter.js | 分片分析（MessageChannel 让出）+ 任务区先显示；手动输入模式；busy 防重入 |
| js/views/components/modelView3D.js | 热结球按 Mc 缩放并封顶 |
| css/app.css | 两列布局（左 3D 小窗口+任务，右 参数+运行） |
| tests/stability_test.mjs | 新增 14 个异常输入用例 |
| tests/engine_sliced_test.mjs | 新增 5 个分片一致性用例 |
| tests/helpers/stlGen.js | lShape（L 形角部热节）；导出 BOX/CYL_Y/SPHERE |
| tests/hotspot_regression_test.mjs | L 形角部热结用例 |

## 5. Test Results（Model / Expected / Actual / Pass-Fail）

### 黄金 STL（真实 CAD 质量网格，严格断言）
| 模型 | Expected | Actual | 结果 |
|------|----------|--------|------|
| cube50（50³） | V=125000 / A=15000 / Mc≈25 / 1 热结 | 125000 / 15000 / 25.0 / 1 | ✅ |
| plate20（200×20×200） | 壁厚 10 半距 / Mc≈10 | 10.0 / 9.9 | ✅ |
| cylinder100（Φ100 长 100） | Mc≈25 | 25.0 | ✅ |
| tube_wall10（壁 10 圆筒） | Mc≈5 且热结在壁内 r≈45 | 5.0 / inside ✓（Bug A 防线） | ✅ |

### 程序化模型（MC 台阶网格，弱断言：主热结位置/Mc + inside）
| 模型 | Expected | Actual | 结果 |
|------|----------|--------|------|
| T 型 | Mc≈20 在竖板 | 20.1 ✓ 位置 ✓ | ✅ |
| 十字交汇 | Mc>5 | ✓ | ✅ |
| Boss 凸台 | Mc≈15 | ✓ | ✅ |
| 薄厚过渡 | Mc≈30 在厚块 | ✓ x>-35 ✓ | ✅ |
| twoHotspots | 2 个热结分离 | 2 个，x=-52/+48（Bug D 防线） | ✅ |
| longBlock | 连续大热结 1 个不拆 | 1 个 Mc≈30 | ✅ |
| L 形（新） | 角部热结 Mc≈30 | 30 ✓ 位置角部 ✓ | ✅ |
| boxShell | Mc≈5 壁内 | 6.3 inside ✓ | ✅ |
| brokenMesh | 不崩溃 + OPEN_MESH 提示 | ✓ | ✅ |

### 异常 STL 稳定性（14 用例全过）
空文件 / 空 ASCII / 垃圾文本 / 随机二进制 / 巨大 triCount / 截断二进制 /
极小 1e-6 / 超大 1e7 / 退化三角 / 法向异常 / 非流形 / 重复三角 / 高面数 —— 全部不崩溃且给出明确提示。

### 回归防线
- engine_sliced_test：分片版与同步版结果**逐位一致**（5 模型）
- 设计中心 E2E：24 项检查全过（导入→自动参数→任务勾选→手动模式→结果中心→布局）
- 浏览器冒烟：13 工具全过

**总时长**：48 项 Node 测试 21.5s（修复前 boxShell 单项 >60s）

## 6. Remaining Risks（剩余风险）

1. **闭合容差 0.001mm 为绝对值**（P7）：超大模型（米级）可能误判；建议下一阶段改为相对 bbox 容差
2. **极小模型 NaN**（P8）：空/退化网格分析产出 NaN 尺寸，UI 显示 — 但不报错；建议 analyzeGeometry 前置 bounds 有效性检查
3. **热结阈值全局默认**：minScoreRatio=0.5 / growRatio=0.4 等对厚大件可能过严；已有参数化入口（HOTSPOT_DEFAULTS），按真实工厂零件校准
4. **单元判断**：STL 无单位信息，mm/cm 假设在导入时确认——靠用户确认，无自动检测
5. **程序化模型均为差集构造**（无并集内部面问题）；真实 CAD 布尔导出的 STL 若含内部面，扫描线判内外仍可能受影响（已按距离组合并缓解）

## 7. Next Step（下一阶段建议）

按命令6"完成 Audit 后停下来"要求，本阶段到此为止。候选方向（需用户指令）：
1. **真实零件验证**：用工厂实际 STL 跑 5-10 个零件，校准阈值 + 积累 golden
2. P7/P8 修复（闭合容差相对化、空网格防护）
3. 分片版下沉为通用 util（当前仅设计中心使用）
4. 热结→自动布冒口（多热结逐个建议，命令3 第二阶段）
