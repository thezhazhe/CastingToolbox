# PHASE 26 报告：修复"主体壁厚"UI 显示语义 + 统一几何数据单位显示

> 命令文件：`新建 文本文档 (34).txt`（2026-08-26）
> 依据：PHASE 25 审计结论（P0-1：UI 主体壁厚 = wallMain fallback 误导）
> 原则：方案 A（只改 UI 数据来源，不改底层算法）；不新增经验阈值；不加模型特例

---

## 1. 修改了什么（2 个生产文件）

### 修改 1：`js/engine/v3/v3ViewAdapter.js`（复用链提取，行为零变化）

- `bodyWallOf` 加 `export`（原有函数，未改逻辑）
- 新增 `bodyRefOf(geom, thin)`：提取 samplingWarn 内部已有的可信链
  `bodyRef = max(bodyWallOf, tP50)`（含 tP50 ≤ 2×wallMax 可用性 guard），返回
  `{bodyRef, bodyWall, tP50}`
- `samplingWarn` 内部改为调用 `bodyRefOf`（同一文件同一函数，行为零变化——
  由 tests/phase26_test.mjs T3 锁定 layers×vs == bodyRefOf 一致）

### 修改 2：`js/views/designCenter.js`（UI 数据来源 + 单位澄清）

- **`writeGeometryToProject`**：`process.wallUsed` 来源 `a.wallMain` → `bodyWallOf(a)`
  （wallMain 可信校验 → wallAvg → wallMax）；`process.mcUsed` 跟随
  （Mc=主体壁厚/2 公式不变，参数来源随可信主体壁厚）
- **`writeHotspotsToProject`** 末尾：V3 采样完成后回写**完整 bodyRef**
  （`bodyRefOf` 含 tP50——均匀实心件必须由 tP50 取大修正，见 §3）；
  用户已手动修改（USER_OVERRIDE）→ 尊重不覆盖；有热结时 mcUsed 仍按既有
  逻辑覆盖为最大热结 M
- **`renderOverview` / `renderGeomInfo`**："主体壁厚"显示改用
  `state.bodyRef ?? bodyWallOf(analysis)`（不再直接读 wallMain）
- state 新增 `bodyRef`；deleteStl 时清理
- 参数面板 hint 增加概念澄清："热节模数 Mc 自动值 = 主体壁厚/2（板件近似）；
  检出热结后自动取最大热结 M（局部 V/A 模数，与热结列表一致）——两者定义不同，均可手动修改"

## 2. 没修改什么

- wallMain / wallAvg / wallMax 算法：**零改动**（geometryAnalysis.js 未碰）
- tP10/tP50/thinFrac：零改动（sampling.js 未碰）
- samplingWarn：行为零变化（同文件重构调用，T3 锁定）
- 采样率公式 / vs / gs / maxSampleGs：零改动
- modulusCeilRatio / 热结检测 / NMS / confidence / region / V2/V3 核心：零改动
- hotspot.position / displayPosition：零改动
- 体积 / 面积 / bbox / 三角面：零改动（保持 STL 三角积分，未重写）
- 单位换算（mm³→cm³=/1000、mm²→cm²=/100、scale 默认行为）：零改动（仅验证）
- **未增加**：毫米/英寸切换、单位选择器、模型特例、文件名特判、新阈值

## 3. 主体壁厚现在到底使用什么变量

**UI"主体壁厚" = `bodyRefOf(state.analysis, coarse.thin).bodyRef`**

```
bodyRef = max( bodyWallOf(geom), tP50 )        // tP50 可用性 guard：≤2×wallMax
bodyWallOf = wallMain 可信区间校验（0.7×wallAvg ≤ wallMain ≤ 0.9×wallMax）
           → 失败 fallback wallAvg → 再失败 wallMax
tP50 = 局部完整厚度 t=d+d2 的中位数（V3 采样，PHASE 23 测度）
```

导入瞬间（V3 未运行）用 `bodyWallOf(geom)`；V3 采样完成后回写完整 `bodyRef`（含 tP50）。

## 4. 为什么 bodyRef 比 wallMain 更适合作为 UI 主体壁厚

| 场景 | wallMain（旧） | bodyRef（新） |
|---|---|---|
| ALR2510 薄壁主体+厚大轨 | **17.2 = wallMax**（峰值检测失败 fallback，误导 5-8×） | **3.6**（wallAvg 2.34 + tP50 3.6 取大，≈真实 2-3mm）✓ |
| cube50 均匀实心 | 50 = wallMax（恰好正确，但语义是"最厚处"） | **50**（bodyWallOf 低估 12.5，tP50≈50 取大修正）✓ |
| 正常主体模型（ALHR4510） | 20.3（峰值检测成功） | 24.1（bodyWallOf 20.3 + tP50 24.1 取大）✓ |
| 与 warning 一致性 | UI 与 samplingWarn 内部**矛盾**（17.2 vs 3.6） | **同一函数同一值** ✓ |

关键：**单独 bodyWallOf 对均匀实心件会低估**（wallMain=wallMax 不可信 → wallAvg=
半距平均=边/8，cube50 得 12.5）——必须由 tP50 取大修正，这是 samplingWarn 链
（PHASE 23/24 验证）完整复用的原因，也是 design_center_test"主壁厚≈50"断言
保持通过的保证。

## 5-8. 计算链（全部不变，仅记录）

| 指标 | 计算链 | 类型 | 单位 |
|---|---|---|---|
| 体积 | STL 三角有向体积积分 Σv0·(v1×v2)/6（stl.js）→ /1000 | 精确 | mm³ → cm³ |
| 表面积 | Σ\|(v1−v0)×(v2−v0)\|/2（stl.js）→ /100 | 精确 | mm² → cm² |
| 外形尺寸 | 顶点 min/max（stl.js computeBounds） | 精确 | mm |
| 热结 M | 体素块 V/A（modulusField）→ 峰值（封顶 M）→ toViewResult mc | 采样估算 | mm |
| 重量 | volumeCm3 × density(g/cm³) / 1000（refreshWeight） | 精确派生 | kg |

重量链验证：`cm³ × g/cm³ = g → /1000 = kg` ✓ 无重复换算；USER_OVERRIDE 保护 ✓。

## 9. 所有 UI 单位（逐字段审计）

| UI 位置 | 字段 | 单位 | 状态 |
|---|---|---|---|
| 铸件信息卡 | 尺寸/体积/重量/壁厚/Mc/热结数 | mm / cm³ / kg / mm / mm / 个 | ✓ 全部明确 |
| 分析概览 | 热结数量/最大热结 Mc/主体壁厚/模型状态 | 个 / mm / mm / — | ✓ |
| 模型信息 | 外形尺寸/体积/表面积/主体壁厚/最大壁厚/三角面 | mm / cm³ / cm² / mm / mm / 面 | ✓ |
| 参数面板 | 单位/尺寸/体积/重量/最大壁厚/主体壁厚/Mc | — / mm / cm³ / kg / mm / mm / mm | ✓ |
| 热结列表 | Mc/区域体积/置信度 | mm / cm³ / % | ✓ |
| warning | 主体壁厚（约 X mm（Y 层…）） | mm | ✓ |
| 3D 状态条 | 主热结 Mc | mm | ✓ |

**结论：所有长度字段均明确显示 mm；体积 cm³、面积 cm²、重量 kg 换算全部正确。
未发现缺单位或换算错误字段。** 单位策略：STL 坐标按 mm 解释（默认），未增加
英寸体系（现有单位选择器保留——命令文件仅要求"不增加"）。

## 10. ALR2510 修改前后对比

| 字段 | 修改前 | 修改后 |
|---|---|---|
| UI 主体壁厚（概览/模型信息/参数面板） | **17.2 mm**（=最大壁厚，误导） | **3.6 mm**（bodyRef，≈真实 2-3mm） |
| 最大壁厚 | 17.2 mm | **17.2 mm（不变）** ✓ |
| 参数面板"主体壁厚"（process.wallUsed） | 17.2 | 3.6 |
| Mc（无热结时 = 主体壁厚/2） | 8.6（17.2/2） | 1.8（3.6/2）；热结分析后覆盖为最大热结 M=2.7 |
| 热结数量 | 5 | **5（不变）** ✓ |
| 两条厚大轨检出 | ✓ | ✓（Δ1-2mm 位置保持） |
| samplingWarn | resolution（3.6mm 1.8 层） | **不变** ✓ |

两个字段同时成立：主体壁厚 ≈2-4mm ✓、最大壁厚 ≈17mm ✓（phase26_test T5 锁定）。

## 11. 真实 STL 回归结果

本地 4 个真实模具 STL（tests/real-stl，V3 全链）：

| 模型 | 热结数 | 与 PHASE 24 基线 |
|---|---|---|
| ALHR4510塑料模具v2-2.1 | 5 | ✓ 一致 |
| ALR2510塑料模具v1 | 5 | ✓ 一致 |
| ALR2510塑料模具v1_1 | 2 | ✓ 一致 |
| HR4012塑料模具v4最早大板 | 5 | ✓ 一致 |

V2 对照：3/2/2/5（ALHR4510 的 V2=3 为既有差异，非本次引入）。

## 12. 全量测试结果

- **tests/runner.mjs：168 通过 / 0 失败**（原 163 + 新增 phase26_test 5 条）
- 新增 `tests/phase26_test.mjs`（5 条）：
  - T1 ALR2510 bodyRef≈3.6（2-4mm 验收）、bodyWall fallback wallAvg
  - T2 cube50 bodyRef≈50（tP50 修正 wallAvg 低估）
  - T3 samplingWarn 与 bodyRefOf 一致性（行为零变化）
  - T4 bodyWallOf 可信校验语义（直返/fallback 四种情形）
  - T5 验收共存：主体壁厚 2-4mm + 最大壁厚 ~17mm + 热结 5 个 + 双厚轨检出
- **浏览器 design_center_test.mjs**：关键验收全过（自动主壁厚 ≈50 mm、Mc 兜底 =25）；
  6 项失败均为**既有断言过期**（结果中心标题实际为"工艺分析结果"、任务数
  13=9 模块+4 知识、热结区块文案、`#dc_p_pos` 选择器不存在——全部位于本阶段
  未修改的 resultsCenter.js/renderTasks/manifest 参数区），非本次引入
- **浏览器 browser_stl_p22_test.mjs（PHASE 22 双路径）：全部通过**（概览
  "主体壁厚 24.1 mm"=ALHR4510 bodyRef 正常显示；热结 marker/位置/面板顺序/溢出全过）
- PHASE 25 审计脚本可重复运行（生产算法零改动，结果不变）

## 13. 是否发现新的数据可信度问题

**是（1 项新发现，既有行为）**：`writeGeometryToProject` 对 `process.wallUsed`/
`process.mcUsed` 无条件写回（显式 SRC），用户手动修改后切换单位/重导入会丢失
用户值——PHASE 26 未修（命令文件范围是单位明确显示；该问题在单位切换场景暴露）。
影响：低（单位切换是低频操作；修改后再次导入 STL 也会重置自动参数——此为
"新 STL 重新生成自动参数"的设计语义）。

## 14. 剩余风险

1. `process.wallUsed` 修改后切单位被覆盖（§13，P3 待修）
2. 单位选择器仍允许 cm/m/inch（既有功能，命令文件保留）；选择 cm/inch 时 3D
   显示不缩放（显示层固定 ENGINE 坐标）——既有设计
3. PHASE 25 遗留：非 90° 旋转热结退化（P1 记录）、wallMax 相位波动 ±5-14%（P1）、
   wallMain 算法本身仍会 fallback（现仅影响"最大壁厚"周边派生，不再影响"主体
   壁厚"显示）
4. ALHR4510 概览主体壁厚由 20.3→24.1（tP50 取大）：语义变化，属预期（与
   samplingWarn 一致），但用户可能注意到数值变化——报告说明

## 15. 下一阶段建议

**可以正式进入"STL 分析结果信息架构与 UI 设计"阶段。** 建议优先：
1. 信息架构：将"精确几何量 / 采样统计量 / 热结分析"分组展示，标注数据可信等级
2. 结果中心热结区块文案统一（既有测试断言过期项一并修复）
3. 单位选择器 UI 强化：切单位时提示自动参数将按新单位重算（§13 风险关联）
4. 长期：非 90° 旋转鲁棒性（P1）、wallMax 细化范围（P1）按 PHASE 25 优先级处理
