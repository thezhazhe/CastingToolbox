# PHASE 28.5 验收报告：STL 可靠性闸门（STL Reliability Gate）

> 日期：2026-08-27 ｜ 命令：42.txt（文件头写"命令：41.txt"为复制模板遗留，按内容执行）｜ 全量测试：**219/0 通过**（208 基线 + phase285 新增 11 项）
> 前置文档：`PHASE29_REPORT.md`（41.txt 已完成 R1/R3/R4 主体门禁）、`PHASE28_ISSUE_TRACKER.md`

---

## 1. 执行摘要

本阶段目标：**"让系统知道什么时候不能相信自己的 STL 分析结果"**——把最危险的静默错误挡住（42.txt 十六），不重写引擎、不调工程参数。

**完成**：R2 网格可靠性闸门升级（validateMesh 新增非流形边/缠绕一致性确定性检测 + `geometry.geomStatus` 结构化状态 + `deriveGeomStatus` 纯函数派生）；可靠性等级三层次（`SAFE_TO_RECOMMEND / WARNING_REVIEW / BLOCK_AUTO_RECOMMEND`）；UI 文案拆分（"未检出"与"分析失败"不再共用语义）；15° 旋转测试补齐；四类核心回归测试（TEST 1-4）。

**修改**：生产文件 5 个（meshValidation / CastingProject / designCenter / calcManifest / resultsCenter / reportGenerator 共 6 个）+ 测试 3 文件（新增 phase285 11 项、更新 phase29 的 29-R2-2 断言）。

**关键发现**：真实 STL 抽样验证（19 个 golden + real-stl）——**10 个带真实网格瑕疵**（缠绕不一致散布、非流形边等 CAD 布尔遗留），此前被静默忽略；新检测正确标注（WARNING，不阻止）。干净 CAD 模型（cube50/plate20/ALR 系列）保持 VALID，`SAFE_TO_RECOMMEND` 可达。

## 2. 基线（42.txt 二）

| 项 | 值 | 说明 |
|---|---|---|
| 基线测试数 | **208/0**（42.txt 预期 199） | 差异=41.txt（PHASE 29）新增 9 项 phase29_test——合法增长非回归 |
| 测试入口 | `node tests/runner.mjs` | 自动发现 tests/*_test.mjs |
| 基线建立后 | 未修改生产代码前确认 208/0 | 符合 42.txt 二 |

## 3. STL 风险模型审计（42.txt 四/五：逐项调查）

| 网格问题 | 修复前检测 | 检测方式 | 可靠性 | 误报 | 漏报 | 影响体积 |
|---|---|---|---|---|---|---|
| 空 STL | ✅ NO_TRIANGLES（error） | triCount≤0 | 可靠 | 无 | 无 | 阻止（INVALID） |
| NaN/Infinity 顶点 | ✅ NON_FINITE_VERTEX（error） | 数值检查 | 可靠 | 无 | 无 | 阻止；注意归零篡改已被 valid=false 拦截（29） |
| 退化三角形 | ✅ DEGENERATE_TRIANGLE（warning） | 叉积模≈0 | 可靠 | 极少（1e-20 阈值） | 无 | 无（面积≈0 无贡献） |
| 开放边界 | ✅ OPEN_MESH（warning） | 无向边奇偶计数 | 可靠 | 无 | **c=偶数非流形漏报**（28.5 前） | 有（实测偏小 16~33%，29） |
| 非流形边（c>2） | ❌ **未检测**（28.5 新增） | 无向边 c>2 | 可靠 | 无 | 无 | 有（体积定义不自洽） |
| 法向/缠绕一致性 | ❌ **未检测**（28.5 新增） | 有向边拓扑（同向共享边） | 可靠 | 无（抽样验证真实瑕疵） | 无 | 有（射线内外判断污染） |
| signed volume 受开放网格影响 | ⚠️ 已知（29 记录） | — | — | — | — | 开口网格体积偏小 16~33% |

**新增检测实现**（确定性、无第三方库，42.txt 五"不要立即引入大型第三方库"）：
- 非流形边：无向边计数 c>2（补奇偶法 c=4 盲区——两个闭合体焊接在一条边上，奇偶法 boundaryEdges=0 静默通过）
- 缠绕一致性：有向边拓扑——闭合流形每条无向边的两个方向各出现 1 次；同向出现 2 次 = 相邻三角绕向冲突

**真实 STL 抽样验证**（19 个 golden + real-stl）：10 个 WARNING（thickOnThin/largeThin/lShape/HR4012 等——缠绕冲突散布全模型 2% 三角等，CAD 布尔运算真实遗留瑕疵），9 个 VALID（cube50/plate20/tube_wall10/ALHR4510/ALR2510 等干净 CAD 导出）。检测无误报；WARNING 语义对"真实但含瑕疵"STL 恰当（不静默、不阻止）。

## 4. R2 最低要求落实（42.txt 五）

```
validateMesh（数量类 error + 拓扑类 warning：OPEN_MESH/NON_MANIFOLD_EDGE/INCONSISTENT_WINDING）
  → deriveGeomStatus(issues) → 'VALID' | 'WARNING' | 'INVALID'   ← 新增纯函数（Node 可测）
  → geometry.geomStatus（结构化状态字段，与 geometry.valid 同源派生不重复语义）
  → runAnalysis 门禁（29 已有）：INVALID 阻止自动工艺建议；OPEN_MESH 显著警示
```

- **不把错误体积当正常 volume**：INVALID（error 级）→ 阻止整链；WARNING → 计算可继续但 UI/报告明确标注"仅供参考"
- **字段复用**（42.txt 五"避免重复造字段"）：`valid`（布尔门禁）语义不变、消费者不变（designCenter 门禁/clearStlBoundData/测试）；`meshIssues`（msg 数组）保留；新增 `geomStatus` 是结构化派生，非平行状态系统
- `clearStlBoundData` 同步清理 geomStatus（与其他 STL 绑定字段一致，28.5-G1 测试锁定）

## 5. R1/R4 状态确认（42.txt 六/七——29 已实施，本阶段验证+等级标注）

- 状态语义已严格区分（42.txt 四）：`HOTSPOT_FOUND(ok) / NO_HOTSPOT / LOW_CONFIDENCE / INSUFFICIENT_RESOLUTION(ANALYSIS_FAILED)` 五个概念不共用语义
- LOW_CONFIDENCE 全链透传：`hotspots.status/reason/items(含 confidence)` → CastingProject → calcManifest riser/chill（28.5-T2 测试锁定：project 读回完整、riser blocked、无正常结果字段、人工 Mc 放行）
- 禁止路径已封堵：LOW_CONFIDENCE → mcHotspot=0 → 正常自动冒口（28.5-T2 断言 blocked 无 Mc/Vr 字段）
- wallHot 不再是无条件兜底：INSUFFICIENT_RESOLUTION 绝不 wallHot（29-G1-1 保持）；NO_HOTSPOT（真均匀）才 wallHot + note 标注

## 6. 可靠性等级（42.txt 十）

最小三等级（不复杂评分），`reliabilityLevel({geomStatus, hsStatus})` 纯函数导出（calcManifest）：

| 等级 | 条件 | 自动冒口行为 |
|---|---|---|
| `SAFE_TO_RECOMMEND` | 几何 VALID + 热结分析 OK | 正常建议 |
| `WARNING_REVIEW` | 几何 WARNING / NO_HOTSPOT（wallHot 估算）/ 手动模式（none）/ 用户人工 Mc 放行 | 建议生成，需工艺复核（note/UI 标注） |
| `BLOCK_AUTO_RECOMMEND` | 几何 INVALID / INSUFFICIENT_RESOLUTION / LOW_CONFIDENCE | 阻止自动建议，明确提示 + 人工输入入口 |

- riser/chill 结果对象携带 `level` 字段（不改变任何数值行为——门禁是行为，等级是可观察标签）
- 人工放行（userMc/userT）→ `WARNING_REVIEW`（建议已按人工输入生成，需用户自判，非 BLOCK）

## 7. R3 旋转鲁棒性（42.txt 八）

测试角度补齐为 **0°/15°/30°/45°（含 45° 任意轴）**：
- 有热结标准件（bossOnPlate）：各角度均检出热结（状态 OK 不跳变）、M 漂移 ≤35%（体素离散已知限制，29 记录）
- 均匀件（uniformCube）：各角度均 NO_HOTSPOT（不误报——29 单峰判据保持）
- 测试件为几何意义明确的标准件（42.txt 八"不能用无法判断热结位置的复杂随机 STL"）

## 8. UI 文案修改（42.txt 十一）

| 位置 | 修改前 | 修改后 |
|---|---|---|
| resultsCenter 热结分析区 | "未检测到有效热结（{reason}）——不会给出假热结，可继续其他分析"（三种状态共用，把"算法漏检"误导成"真实无热结"） | LOW_CONFIDENCE → "当前未获得足够可信的热结分析结果，自动冒口建议已阻止。可手工输入热节模数 Mc 后继续冒口计算"；INSUFFICIENT → "无法可靠判断是否存在热结……可检查模型/网格质量后重新导入，或手工输入 Mc"；NO_HOTSPOT → "模型壁厚均匀时属正常；冒口按主体壁厚估算（wallHot），建议结合工艺经验复核" |
| designCenter 热结徽标 | else 分支一律 "模型壁厚均匀或过薄时属正常"（含分析失败——误导） | 拆四态：NO_HOTSPOT（正常）/ INSUFFICIENT（⚠️ 分析未能完成+已阻止+人工入口）/ 手动模式（无 STL 提示）/ LOW_CONFIDENCE 既有分支 |
| reportGenerator 网格校验行 | "有 N 项提示/通过" | 按 geomStatus 显示：无效（红）/ 有风险（黄，仅供参考）/ 通过 |

**UI 纪律**（42.txt 十一）：正常→简洁；有风险→明确风险内容；无法可靠分析→明确阻断。未增加红黄绿堆砌。

## 9. 四类核心回归测试（42.txt 九）

| 测试 | 覆盖 | 关键断言 |
|---|---|---|
| TEST 1 坏网格（28.5-T1a~e） | OPEN_MESH/非流形/缠绕/空网格/几何警告链 | 识别风险；deriveGeomStatus 三态；WARNING 不阻止但标注（level=WARNING_REVIEW）；INVALID 阻止 |
| TEST 2 LOW_CONFIDENCE（28.5-T2） | status→project→riser 全链 | 状态/候选 confidence 完整保留；blocked+BLOCK_AUTO_RECOMMEND；**无正常冒口字段**；人工 Mc 放行→WARNING_REVIEW |
| TEST 3 热结旋转（28.5-T3a/b） | 0°/15°/30°/45° | 主要热结不消失（状态 OK、M 漂移≤35%）；均匀件不误报 |
| TEST 4 失败安全（28.5-T4） | 分析失败 | riser/chill 均 blocked；无 Mc/Vr/D 任何正常字段；提示人工入口 |

测试纪律：走真实执行路径（manifest calculate 直接调用同 runAnalysis）；构造为几何意义明确的标准件；无"测试模拟生产代码不存在的步骤"（28.3-B-4 教训延续）。

## 10. 工程公式/参数变化（42.txt 十三）

**零变化**。未修改任何阈值（0.85/0.6 未动）、Vr∝Mc³ 未动、冒口/浇注/密度/出品率等全部未动。唯一引擎改动=validateMesh 新增拓扑检测（几何判定，非工程参数）。发现的不确定项均按 42.txt 十三记录为 NEEDS_ENGINEERING_REVIEW 不修改（见 §12）。

## 11. 测试结果

**全量 219/0 通过**（208 基线 + phase285 新增 11 项）。

| 测试文件 | 说明 |
|---|---|
| phase285_test.mjs（新，11 项） | TEST 1-4 + reliabilityLevel 映射 + geomStatus 生命周期 |
| phase29_test.mjs（更新 1 项） | 29-R2-2 断言升级：缠绕翻转由"validateMesh 无感"改为"INCONSISTENT_WINDING 检出"（能力升级预期内，非为过测试改预期——42.txt 五明确要求检测缠绕） |
| 其余 30 文件 | 全量回归通过（含真实 STL/引擎/计算器/门禁既有测试） |

## 12. 尚未解决的问题（42.txt 十六：记录 NEEDS_ENGINEERING_REVIEW）

| 项 | 状态 | 说明 |
|---|---|---|
| 真实 STL 高频携带缠绕/非流形瑕疵（抽样 10/19） | 已检测已标注，**未修复** | WARNING 级不阻止（V3 对这些模型的历史结论已验证正确）；自动修复网格（重三角化）超出本阶段范围——若用户要求"坏网格自动修复"另立阶段 |
| 慢浇表/查表 R77 系列 | 保持待验证 | 数据源不明（28.3 遗留，与 STL 链无关） |
| P0-3 密度取值 / P1-39 铜合金口径 | 保持待人工决策 | 工程判断项（29 遗留，42.txt 明确暂不处理） |
| validateMesh 性能 | 已评估 | 边统计 O(triCount) 一次遍历（原 OPEN_MESH 检测同复杂度），106k 三角 ~0.1s 量级，无新增瓶颈 |

## 13. 数据链（42.txt 十五 6）

`STL → geometry(valid/geomStatus/volume/…) → CastingProject → calcManifest(riser/chill) → 建议`：单向无环保持。geomStatus 仅由 writeGeometryToProject 写入、runAnalysis/报告/等级函数消费，无反向写入。RUN_ORDER（28.4 修复）保持。

## 14. 13 计算器独立性（42.txt 十二）

**保持独立**：门禁/等级只在 manifest calculate 层（设计中心路径）；独立视图（riserView 等）零改动；手动模式（无 STL）行为不变（hotspots.status='none' → 用户必填 Mc 路径）；全量测试含独立性回归。无 riser→designCenter / gating→hotspotV3 等跨页依赖。

---

## 最终十问（42.txt 十五）

1. **R2 坏 STL 是否已不再静默进入错误体积计算？** **YES**。INVALID（空/损坏/非法顶点）阻止整链；OPEN_MESH/非流形/缠绕为 WARNING——计算可继续但 UI/报告明确标注"仅供参考"，体积不再被当作无风险正常值。
2. **R1 热结漏检是否已与"真实无热结"区分？** **YES**。五态严格区分（ok/NO_HOTSPOT/LOW_CONFIDENCE/INSUFFICIENT/none），INSUFFICIENT 绝不 wallHot 兜底（29 实施，28.5-T4 再次锁定）。
3. **LOW_CONFIDENCE 是否完整传递到 riser？** **YES**。status/reason/items(confidence) 全链透传（28.5-T2 逐项断言），riser 可见并 blocked。
4. **LOW_CONFIDENCE / ANALYSIS_FAILED 是否还能产生自动冒口建议？** **NO**。blocked 结果不携带任何正常冒口字段（Mc/Vr/D 均 undefined），仅提示人工输入入口。
5. **非 90° 旋转测试是否通过？** **YES**。0°/15°/30°/45°（任意轴）全部通过：主要热结不消失、状态不跳变、均匀件不误报。
6. **STL → project → riser 数据链是否仍单向？** **YES**。无环（§13）。
7. **13 计算器是否仍独立？** **YES**。门禁在 manifest 层，独立视图/手动模式零影响（§14）。
8. **是否修改了未经验证的工程公式？** **NO**。零工程参数变化（§10）。
9. **是否出现新的静默失败？** **NO**。新增检测/状态/文案全部朝"更明确告知"方向；唯一行为收紧=部分真实 STL 由"静默分析"变为"WARNING 标注"（有意为之，检测已验证为真实瑕疵）。
10. **"STL → 自动冒口建议"是否达到可用状态？** **CONDITIONAL**。自动链路已具备完整安全闸门（§3-8），干净 STL 可全自动（SAFE_TO_RECOMMEND）；含瑕疵 STL 明确标注或阻断。**条件**：① 真实铸件斜置/复杂网格再积累 2-3 案例验证 R1 残余；② P0-3 密度取值批准（公式链完全定稿）；③ 用户接受"含瑕疵 STL 显示有风险提示"的常态语义（10/19 抽样有此提示）。

---

## 最终结论（42.txt 十七）

**A. 修改文件列表**：`js/engine/meshValidation.js`（非流形/缠绕检测 + deriveGeomStatus）、`js/model/CastingProject.js`（geometry.geomStatus 字段 + 清理）、`js/views/designCenter.js`（geomStatus 写入 + 徽标四态拆分）、`calcs/calcManifest.js`（reliabilityLevel + riser/chill level 标注）、`js/views/resultsCenter.js`（热结文案拆分）、`js/views/reportGenerator.js`（网格校验状态行）；测试：`tests/phase285_test.mjs`（新 11 项）、`tests/phase29_test.mjs`（29-R2-2 断言升级）

**B. 新增测试数量**：11（phase285）

**C. 全量测试结果**：**219 通过 / 0 失败**（208 + 11）

**D. R1/R2/R3/R4 状态**：R1 ✅（漏检与无热结严格区分，状态可追溯）｜ R2 ✅（坏网格不再静默入链：INVALID 阻止 + WARNING 标注）｜ R3 ✅（0°/15°/30°/45° 全部通过）｜ R4 ✅（LOW_CONFIDENCE 全链透传 + 阻止自动建议）

**E. 是否修改工程公式**：**否**（零变化）

**F. 是否新增字段**：**是**——`geometry.geomStatus`（结构化状态，与 valid 同源派生）；riser/chill 结果携带 `level` 标签（非持久化字段）

**G. 数据链变化**：无结构变化（geomStatus 单向消费；RUN_ORDER 保持）

**H. 尚未解决的问题**：真实 STL 瑕疵自动修复（超范围，已标注可检测）、慢浇表数据源、P0-3/P1-39 人工决策项（§12）

**I. 是否允许进入下一阶段**：**允许**（可靠性建设方向；优先：P0-3 批准 → R1 真实案例验证 → P1-13 网格校验全面化）

---

## 结论

# **PHASE 28.5：PASS（附条件）**

最主要原因：四类最危险的静默错误（坏网格体积、热结漏检伪装、低置信透传丢失、旋转状态跳变）已全部被确定性检测 + 状态透传 + 等级标注封堵，219/0 全量通过，零工程公式变化。附条件=§14 问题 10 的三项（真实案例验证 R1 残余、P0-3 批准、瑕疵 STL 常态提示的用户接受度）。

---

## 附：真实 STL 抽样验证明细（geomStatus 分布）

| STL | geomStatus | 问题 |
|---|---|---|
| cube50 / plate20 / tube_wall10 / cylinder100 / adjacentMerge | VALID | 干净 |
| ALHR4510 / ALR2510 v1 / v1_1 | VALID | 干净（真实铸件） |
| thickOnThin / thinShell / twoThick / adjacentSplit | WARNING | INCONSISTENT_WINDING |
| largeThin / largeThinThick / longBar / lShape / mildThick / hollowThickRing | WARNING | DEGENERATE + NON_MANIFOLD + WINDING |
| HR4012 | WARNING | NON_MANIFOLD + WINDING |
