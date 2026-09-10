# PHASE 29 报告：STL 工艺设计中心 V1 可靠性升级 + 遗留问题收口

> 日期：2026-08-27 ｜ 命令：41.txt ｜ 全量测试：**208/0 通过**（199 基线 + phase29 新增 9 项）
> 前置文档：`PHASE29_PREFLIGHT.md`（问题地图）、`PHASE28_4_PRIORITY.md`、`PHASE28_ISSUE_TRACKER.md`

---

## 1. 执行摘要

本阶段目标：收口已确认问题（P1-35/39/40）、系统性提升"STL→自动分析→工艺参数建议"主流程可靠性（R1/R2/R3）、建立"分析可信度/数据质量门禁"。

**完成**：P1-35 门禁（不再静默）、P1-40 optionalInputs 生命周期机制（含 P1-18 machining 接线）、R2 网格质量门禁（INVALID 阻止 + OPEN_MESH 警示）、R1/R3 热结状态链（失败/低置信度不伪装无热结 + 单峰均匀件判据修复 45° 旋转误报）。P0-3 审计不改值、P1-39 记录不擅自决定（工程判断）。

**修改**：7 个生产文件（引擎 1 + manifest 1 + 视图 4 + CSS 1）+ 测试 4 文件（新增 phase29 9 项，修正 28.3-A-2/28.4-3 测试与门禁状态契约对齐）。

## 2. 修改前状态（PRE-FLIGHT 结论摘要）

- 测试基线 199/0（28.4 交付）
- 13 计算器独立可用（28.4 已审计）
- 遗留：P1-35（LOW_CONFIDENCE→riser 静默）、R1（失败/无候选伪装无热结→wallHot 兜底→冒口偏小）、R2（坏网格体积静默污染）、R3（无任意角度旋转测试）、P1-40（optionalInputs 死声明）

## 3. 已修复问题

| # | 问题 | 修复 | 验证 |
|---|---|---|---|
| P1-35 | LOW_CONFIDENCE 有候选但 mcHotspot=0 → riser/chill 静默"未执行" | riser/chill calculate 门禁：状态矩阵（用户 Mc→放行；INSUFFICIENT_RESOLUTION→blocked；LOW_CONFIDENCE→blocked；ok→mcHotspot；NO_HOTSPOT→wallHot+note） | 29-G1-1/2 测试 |
| P1-40 | optionalInputs 死声明（设计中心永不提供） | 生命周期机制：param 非 null → 高级折叠区（始终可调）；param=null（scope:calculator）→ 独立计算器入口；allOptionalInputs helper | 29-G2-1 测试 |
| P1-18 | machining method 键不匹配 + 永不消费 | options 对齐 METHOD_GRADES 键；calculate 消费 + 旧选项兼容映射；熔模/无标准组合明确提示（不静默） | 29-G2-2 测试 |
| P1-23 | shakeout 参数硬编码 + mode 误用 production.line | mode/importance 改 scope:calculator（独立计算器完整可调）；删除错误 param 绑定 | 机制内 |
| P1-30 关联 | gating qty 死参数（声明不消费） | 删除声明 | 29-G2-1 断言 |
| R2 | 坏网格体积静默污染（OPEN_MESH 仅 warning；geometry.valid 无条件 true） | geometry.valid 真实化（validateMesh error 级→false）；runAnalysis 门禁：INVALID 阻止自动建议、OPEN_MESH 显著警示 | 29-R2-1/2/3 |
| R1 | "分析失败/无候选"伪装"无热结"→wallHot 兜底 | 状态透传：INSUFFICIENT_RESOLUTION 绝不 wallHot 兜底（blocked）；NO_HOTSPOT（真均匀）保留 wallHot 兜底但结果标注"估算来源" | 29-G1-1 |
| R3 | 45° 任意轴旋转均匀立方体误报热结（中心峰） | 单峰均匀件判据：单峰+模型中心+窗口≥0.8×cap（物理：该点=模型最厚顶点=均匀件中心） | 29-R3-1/2 |

## 4. 未修复问题及原因（41.txt 十：只记录不擅自改）

| 项 | 状态 | 原因 |
|---|---|---|
| P0-3 密度取值（铸钢液态 7.5→7.0-7.2 等） | 审计完成，**待人工批准** | 工程取值判断；结构/消费者已正确（liquidDensity 实际仅展示——gating 用内部表，P0-3 审计发现记录） |
| P1-39 machining 铜合金口径 | 记录 | 两条路径均为带注释的近似（独立视图按灰铁 vs 设计中心按铝）——选哪套属工程判断 |
| R1 斜置漏检残余（非对称模型） | 状态可追溯，漏检本身未消除 | 轴对齐采样+uniform 阈值是引擎核心设计；41.txt 禁止简单调阈值；真热结漏检场景由门禁阻断自动建议（不伪装） |
| R3 M 值 45° 旋转漂移 ≤32% | 记录为已知精度限制 | 体素离散误差（斜壁 char 低估）；检测层（状态/数量/位置）稳定；冒口 ∝ M 建议斜置件工艺复核 |
| 慢浇表/查表 R77 系列 | 保持待验证 | 数据源不明（28.3 遗留） |

## 5. STL 质量检测机制（R2）

```
validateMesh（数量类：NO_TRIANGLES/NON_FINITE_VERTEX=error；DEGENERATE/OPEN_MESH=warning）
  → geometry.valid = (无 error)   ← PHASE 29 真实化（原无条件 true）
  → runAnalysis 门禁：
      valid=false（INVALID）    → 阻止自动工艺建议 + 明确提示（更换 STL 或手动模式）
      meshIssues 含 OPEN_MESH  → 放行但 toast 警示"体积/重量链可能偏小，仅供参考"
```
- **INVALID 阻止**：空/损坏/含非法顶点网格不再进入重量→浇注→冒口链
- **WARNING 放行+警示**：开口网格（体积实测偏小 16~33%）可继续但明确提示
- 已知未覆盖（记录）：自交/非流形（4 边共享）无检测——validateMesh 全面化属后续（P1-13）

## 6. 热结分析机制（R1/R3）

### 状态矩阵（最终系统区分 5 种情况）
| 引擎状态 | 含义 | riser/chill 自动建议 |
|---|---|---|
| OK（有热结） | 检出置信度达标候选 | ✅ mcHotspot 正常建议 |
| NO_HOTSPOT（无候选/均匀判据） | 分析成功、无相对显著热结 | ✅ wallHot 兜底 + note"估算来源"（均匀件合理） |
| LOW_CONFIDENCE | 有候选但无一达阈值 | ⛔ blocked（提示手动输入 Mc） |
| INSUFFICIENT_RESOLUTION（INVALID_MESH/NO_INSIDE_POINTS） | 无法可靠分析 | ⛔ blocked（绝不 wallHot 兜底——41.txt 特别禁止的静默降级） |
| 无 STL（手动模式） | — | 用户必填 Mc（requiredInputs），独立计算器行为不变 |

### R3 单峰均匀件判据（本次引擎唯一算法改动）
- **发现**：45° 任意轴旋转均匀立方体 → 中心峰误报热结（conf 0.89）。轴向时由"≥3 峰等高+低 prom"均匀快路径拦截；斜置时粗场只剩 1 峰（无等高对照），且体素离散使"窗口撞 cap"判据失效（斜壁 char 低估 → R=69.8 vs cap=80.2 不触发 0.99 容差）。
- **修复**（非调阈值，补缺失判据）：单峰 + 模型中心（<0.2×mdim）+ 窗口 ≥0.8×cap → 均匀件中心顶点 → NO_HOTSPOT。物理依据：窗口=到表面距离≈模型半宽 = 该点即模型最厚位置 = 均匀件中心。真热结窗口是局部结构尺寸（boss 0.3/法兰 0.46/大厚块 0.25，均 <0.8）不误伤——14.txt 20 个工程模型回归全过确认。
- **已知精度限制**：45° 斜置真热结 M 值漂移 ≤32%（体素离散），检测层稳定；测试容差 35% 并记录。

## 7. 置信度/状态机制

- 引擎 audit 链完整保留（weak_peak/unstable_multiscale/tiny_region/low_confidence 等），状态+原因透传 CastingProject（hotspots.status/reason，28.3 已有）
- 新增：riser/chill 结果 blocked 对象（reason/note）→ resultsCenter/reportGenerator 显示原因 + 人工输入指引
- canonical 结构未变（沿用 mcHotspot/wallHot/chillT 等，41.txt 七）

## 8. 自动工艺建议门禁（41.txt 六）

- STL INVALID → runAnalysis 阻止（几何+热结全链）
- HOTSPOT 分析失败/低置信度 → riser/chill blocked（结果区明确显示原因）
- 用户人工输入入口：Mc/T_hot 手动填写（USER_OVERRIDE）→ 任何状态放行（尊重人工判断）
- 禁止路径已封堵：analysis failed → 0 → wallHot → 正常冒口计算（原链路）

## 9. 13 个独立计算器独立性验收

- ✅ 全部独立视图未改动（riserView/shakeoutCalc/chargeCalc 等独立入口完整）
- ✅ 门禁只作用于 manifest calculate（设计中心路径）；独立计算器直接调 calcs 纯函数不受影响
- ✅ 手动模式（无 STL）：hotspots.status='none' → riser 走"用户必填 Mc"路径，行为与 28.4 前一致
- ✅ 全量测试含独立计算器回归（smoke_manifest/model_test/phase16* 等）

## 10. 数据链验收（41.txt 七）

- STL→volume→netWeight→blankWeight→riser→riserHeight→gating Hp：单向无环（28.4 RUN_ORDER 修复保持）
- USER_OVERRIDE 保护：riserHeight 回写不覆盖用户值（28.4 测试保持）；wallUsed/wallHot 保护（28.4 保持）
- STL 替换清理：riserHeight 纳入 clearStlBoundData（28.4 保持）
- 新增：INVALID/OPEN_MESH 状态进 geometry.valid/meshIssues → runAnalysis 消费（门禁单向，不反向）

## 11. 测试结果

**全量 208/0 通过**（199 基线 + phase29 新增 9 项）

| 测试 | 覆盖（41.txt 九 A-N 映射） |
|---|---|
| 29-R2-1/2/3 | A/B/C：STL invalid、OPEN_MESH、体积正确性（开口偏小实测） |
| 29-R3-1/2 | D/E/H：hotspot found、no hotspot、旋转（90° 三轴 + 30° + 45° 任意轴） |
| 29-G1-1/2 | F/G/I：low confidence、failed analysis、门禁（不伪装/不静默/人工放行） |
| 29-G2-1/2 | M/N：设计中心 optional 生命周期、不支持材料/工艺明确提示 |
| phase284（既有） | J/K/L：STL 替换清理、USER_OVERRIDE、独立计算器 |
| 全量回归 | 14.txt 20 工程模型 + 引擎/模型/计算器既有测试（单峰判据无误伤） |

**测试纪律**（41.txt 九）：测试走真实执行路径（manifest calculate 直接调用，同 runAnalysis）；无"测试模拟生产代码不存在的步骤"（28.3-B-4 教训）；28.3-A-2/28.4-3 测试修正为与 writeHotspotsToProject 状态契约一致（status+items 同写）。

## 12. 工程公式/参数变化

**零变化**。未修改：Dietert/fv/奥赞/Hp/出品率表/流速标准/过滤网表/浇注时间表/浇注温度表/冒口效率/密度取值/材料参数。唯一引擎改动是均匀件判据补判（§6，检测逻辑非工程参数）。

## 13. 风险清单

| 风险 | 等级 | 说明 |
|---|---|---|
| R1 残余：非对称模型斜置热结漏检 | 中 | 状态可追溯（门禁阻断自动建议），漏检本身未消除——需真实斜置铸件验证 |
| R3 残余：任意朝向 M 值漂移 ≤32% | 中 | 冒口 ∝ M，斜置件建议工艺复核；采样加密可缓解（性能 4×，未做） |
| R2 残余：自交/非流形无检测 | 中 | validateMesh 全面化（P1-13）未做；4 边共享边静默通过 |
| P1-35 门禁副作用 | 低 | LOW_CONFIDENCE 时用户必须手动填 Mc（原静默给 wallHot 值的行为被阻止——有意为之，安全方向） |
| 单峰判据误伤 | 低 | 居中弱热结（prom 高但位置居中）不触发（需窗口≥0.8×cap）；14.txt 回归确认无误伤 |

## 14. 下一阶段建议

1. **A 类剩余**：P0-3 密度取值（等人工批准，一个数字）；R1 残余（真实斜置铸件验证采样）
2. **B 类**：P1-40 机制收尾（可选参数视觉优化）；P1-13 validateMesh 自交/非流形检测（R2 残余）
3. **数据积累**：真实铸件案例（出品率校准 P1-29、毛坯余量 P0-4、M 漂移验证）

---

## 最终四问（41.txt 十四）

**A. STL 工艺设计中心现在能不能作为可靠的 V1 主流程使用？**
**可以**，附条件：① 网格质量差（INVALID/OPEN_MESH）现在会阻止或显著警示，不再静默污染；② 热结分析失败/低置信度不再伪装成"无热结"，riser/chill 明确告知并给出人工入口；③ 均匀件+任意朝向的误报已修复（单峰判据）。**条件**：真实铸件的斜置/复杂网格场景建议再积累 2-3 个案例验证（R1 残余），且 P0-3 密度取值批准后公式链完全定稿。

**B. 13 个独立计算器是否仍然完全独立？**
**是**。门禁只在 manifest 层（设计中心路径）；独立视图/纯函数零改动；手动模式行为与之前一致；全量测试含独立性回归。

**C. STL→自动工艺建议这条链还有什么工程风险？**
① 非对称模型斜置热结漏检（状态已可追溯，漏检未消除）；② 任意朝向 M 值漂移 ≤32%（冒口尺寸偏差，建议工艺复核）；③ 自交/非流形网格无检测；④ 毛坯重量默认=净重（无余量系数，P0-4）——冒口/浇注按毛坯口径计算，实际铸件有余量时偏小（方向待案例校准）。

**D. 下一阶段应该继续开发新能力，还是继续可靠性建设？**
**继续可靠性建设为主，小步验证**：优先 P0-3 批准 + R1 真实案例验证（两者都是"一个数字/一个案例"级），然后 P1-13 网格校验（R2 残余）。**不建议**在新能力上大投入——当前 13 计算器 + 设计中心核心链已覆盖 80% 场景，可靠性收尾比功能扩张价值更高。

---

## 附：修改文件清单

**生产代码（7 文件）**：
| 文件 | 修改 |
|---|---|
| `js/engine/v3/hotspotV3.js` | isUniformCoarse helper（单峰均匀件判据，sync/sliced 共用） |
| `calcs/calcManifest.js` | riser/chill 门禁；allOptionalInputs；gating qty 删除；machining method 接线+unsupported；shakeout/riser/chill/sandbox scope 标注 |
| `js/views/designCenter.js` | geometry.valid 真实化；runAnalysis INVALID/OPEN_MESH 门禁；高级参数折叠区；manifestRow select 容错 |
| `js/views/resultsCenter.js` | riser/chill/machining blocked/unsupported 展示；riser note 展示 |
| `js/views/reportGenerator.js` | riser/chill/machining blocked/unsupported 展示 |
| `css/app.css` | dc-advanced/dc-blocked 样式 |
| `tests/phase29_test.mjs`（新） | 9 项：R2×3/R3×2/G1×2/G2×2 |
| `tests/phase283a_test.mjs`、`tests/phase284_test.mjs` | 状态契约对齐（status+items 同写） |
