# PHASE 16-C 完整 Design Center 工艺工作流报告

日期：2026-08-23 ｜ 命令：19.txt ｜ 性质：完整审计 + 实施 + 测试（一次完成）

---

## 1. 当前架构审计结论（19.txt 一）

全部代码阅读确认，无假设：

| 审计点 | 结论 |
|---|---|
| Design Center 是否调用现有计算器 | **是**。9 个 manifest 全部 `calculate() → calcs/ 纯函数`（runGating/runRiser/resolveYield/runChill/runSandbox/runShakeout/runCharge/rmaRange/calcShrinkageDir），无第二套计算逻辑 |
| 13 个工具真实依赖关系 | 见 §8 依赖表。yield←gating/riser（results 对象传参）、charge←yield/gating、chill←mcUsed、sandbox←size/weight、shakeout←weight/wallUsed |
| STL → geometry → hotspot → CastingProject → calculator 数据链 | 完整闭环：parseSTL → validateMesh → buildMesh → analyzeGeometry（V2 距离场壁厚）→ V3 热结 → Adapter（mc/regionVolumeCm3）→ CastingProject（SRC 元数据）→ manifest 缺失判定 → calcs |
| 参数来源 SRC 正确性 | 正确。STL 自动=STL_GEOMETRY_ANALYSIS、派生=DERIVED、计算写回=CALC_RESULT、用户输入=USER_INPUT、用户改自动值=USER_OVERRIDE、生产场景=SCENARIO |
| 模块之间 results 传递 | 正确。结构化 results 对象（16-C-4 测试验证 yield 取 gating.G/riser.Vr、charge 取 yield.pourWt），无 UI 文本解析 |
| STL 替换/删除/刷新安全 | 16-B 已实现：替换先解析成功再清理、删除回手动模式、刷新无幽灵（本阶段保留未动） |
| 可直接复用的 UI 结构 | dc-topbar/任务勾选/manifest 缺失判定/手动模式/3D 视图/分片执行/生产场景预填 |
| 影响工程师使用的问题（本次修复） | ①结果全平铺长页（→ 模块导航+当前模块）②参数无来源徽章（→ 🟢🔵🟡🟠）③模块无状态（→ ○◐●⚠）④线收缩率有核心无 manifest（→ 接入）⑤无完整报告（→ 新增） |

## 2. 13 个工具最终排序及理由（19.txt 二）

主流程按「拿到铸件 → 分析 → 基础参数 → 浇注/补缩 → 生产 → 检查」，**出品率从候选第 5 位移到第 8 位**（依赖浇注/冒口结果，工程上浇注冒口确定后才准）——19.txt 允许按真实依赖调整：

```
[工艺计算模块]（导航分组）
 A 铸件基础：加工余量 → 线收缩率
 B 浇注与补缩：浇注系统 → 冒口 → 冷铁
 C 生产与成本：出品率与铁水重量 → 3D砂型吃砂量 → 熔炼加料 → 开箱时间

[辅助知识工具]（16.txt 七：不作为主流程步骤，从导航进入独立视图）
 铸件结构工艺性 / 尺寸公差 CT / Campbell 十规则 / 缺陷查找
```

排序依据：①**数据依赖**（参数先于使用者）②**工程认知**（基础参数 → 设计 → 汇总）③**输出流向**（浇注重量→出品率→铁水总重→配料 为链式）。知识工具不参与计算链（无 manifest），勾选无意义 → 点击直达独立视图。

## 3. UI 最终结构（19.txt 三/四）

```
┌ 顶部信息条：STL 文件名 · 单位 · [🔄替换][🗑️删除][📝手动][📄改用STL]
├ 铸件信息卡（STL 导入后）：文件名 · 尺寸 · 体积 · 重量 · 壁厚 · Mc · 热结数 · ✅V3已分析/⚠采样欠解析
├ 左 3D 视图（70%）｜右 工作面板（30%）：
│   ① 计算模块导航（分组 A/B/C + 状态徽标 ○◐●⚠ + 辅助工具链接）
│   ② 参数与执行（自动参数[来源徽章] + 缺失参数 + [🚀开始工艺分析]）
│   ③ 热结列表  ④ 模型信息
└ 结果区（模块导航 + 当前模块结果 + [生成工艺计算报告]）
```

## 4. 输入界面设计（19.txt 六/七）

- **能可靠从 STL 得到的**自动填写（体积/尺寸/壁厚/Mc/重量），每行带来源徽章（§7），可改（改后 🟠 用户修改）
- **不能可靠得到的**明确要求填写（材料大类/一模件数/浇注方向/Ho/ph），manifest 缺失判定只显示还缺的
- 线收缩率新增 **dims3 三方向输入**（X/Y/Z mm，写回 geometry.size 数组）——STL 模式自动填齐，手动模式分方向填
- 参数检查隐含在"缺失参数区"：空=❌ 缺少，已满足自动消失 + "✅ 共享参数已齐"提示
- 高级计算过程不展示（结果页无公式堆砌，报告同）

## 5. 输出界面设计（19.txt 八/十一）

- **结果导航 + 当前模块**：已完成模块按钮（🌊浇注系统/🏗️冒口/…），点击切换；不再 13 结果全平铺
- 每模块：核心结果（数值卡）+ 明细表（校验 ✅/⚠️）+ 状态说明
- 底部：[↩️ 返回修改参数] [📄 生成工艺计算报告] [🧮 打开独立计算器]

## 6. STL 流程（16-B 保留 + 本阶段）

导入 → 解析成功先清旧绑定数据 → 几何分析（V2 距离场壁厚）→ **V3 热结 → Adapter** → CastingProject → 铸件信息卡 + 热结列表 + 参数自动填 → 替换/删除/刷新状态全部由 16-B 语义保障。坏 STL 解析失败不破坏当前模型（16-B 顺序修正）。

## 7. 参数来源机制（19.txt 五）

SRC 元数据（CastingProject 已有）→ UI 徽章：

| SRC | 徽章 | 示例 |
|---|---|---|
| STL_GEOMETRY_ANALYSIS | 🟢 STL 自动 | 铸件体积 18.42 cm³ 🟢 STL 自动 |
| DERIVED | 🔵 计算得到 | 重量 = 体积×密度 |
| USER_INPUT / SCENARIO | 🟡 用户输入 | 材料 QT500 🟡 用户输入 |
| USER_OVERRIDE | 🟠 用户修改 | 设计壁厚 22mm 🟠 用户修改 |
| CALC_RESULT | 🔵 计算结果 | 浇注重量 G（写回项目） |
| 采样风险 | ⚠ 数据存在风险 | 薄壁欠解析 → 采样 WARNING |

## 8. 模块依赖关系（19.txt 九/十）

```
STL → geometry(size/vol) → weight(×密度) → gating(重量/壁厚) → yield(G) → charge(pourWt)
                                    ↘ riser(Mc) → yield(Vr) ↗
                     Mc → chill(2×Mc) · wallUsed → shakeout(重量/壁厚)
```

参数 → 使用模块映射（PARAM_OWNERS，16-C-5 测试验证）：weightKg→6 模块、mcUsed→riser/chill、wallUsed→gating/shakeout、size→sandbox/machining/shrinkage。**参数修改 → 受影响已完成模块 ⚠ 需重新计算**（19.txt 十：不偷偷使用旧结果）+ 防抖自动重算，完成后回 ●。

## 9-10. 修改文件 / 修改原因

| 文件 | 修改 | 原因（19.txt 节） |
|---|---|---|
| calcs/calcManifest.js | +shrinkage manifest（dims3 参数类型） | 十四：线收缩率安全接入（不改核心） |
| js/views/designCenter.js | 模块分组导航+状态徽标、铸件信息卡、来源徽章、markStale、dims3 绑定、RUN_ORDER、信息卡 | 二/三/四/五/十 |
| js/views/resultsCenter.js | 重构为结果导航+当前模块+报告按钮 | 八/十二 |
| js/views/reportGenerator.js | 新建：完整工艺报告 HTML | 十二 |
| css/app.css | +模块分组/信息卡/徽章/结果导航/三方向样式 | 三/四/五/八 |
| tests/phase16c_test.mjs | 新建 10 项工作流测试 | 十六 |

**未修改**：V3 核心、calcs 公式、CastingProject 数据模型、独立计算器（硬性边界全部遵守）。

## 11-13. 测试 / PASS-FAIL / 回归

**98 通过 / 0 失败**（原 88 全部保持 + 新增 10 项 16-C）：
- 16-C-1/2/2b/3 shrinkage manifest 完整性与计算（三方向独立收缩）
- 16-C-4 依赖传递（yield←gating/riser、charge←yield，结构化对象）
- 16-C-5 参数→模块依赖映射
- 16-C-6/7/8 报告（只含选择模块/来源保留/WARNING 段）
- 16-C-9 manifest 完整性（9 模块）
- V2/V3 原有全部回归通过；16-A 8 项、16-B 10 项无回归

## 14. 已知限制

1. 结果导航只显示**已完成**模块（未选择不显示——符合"只展示用户选择的内容"）
2. ⚠ 状态在自动重算成功后清除；若重算因缺参数失败，⚠ 保持（用户可见"需要重算"）——符合 19.txt 十
3. shrinkage 手动模式需填三方向尺寸（dims3），STL 模式自动填齐
4. 知识工具（结构工艺性/CT/Campbell/缺陷）在导航中为链接入口，不在工作台内嵌展示（16.txt 七决策）
5. 报告不含 3D 视角截图（离线工具未做离屏渲染）

## 15. 下一阶段建议（16-D/16-E/16-F）

1. **16-D**：Workflow 排序文档 `PHASE16_WORKFLOW_ORDER.md`（本报告 §2 已含排序依据，可直接成文）+ 参数区视觉整理
2. **16-E**：结果导航补充"未完成模块"置灰展示（可选）；报告导出流程走查
3. **16-F**：完整回归 + 浏览器手工验收清单（STL 导入/替换/删除/刷新/手动模式/单模块/多模块/报告下载）
4. 真实 STL 验证（tests/real-stl/，需用户提供 ≥5 件真实铸件）——V3 已就绪，16 系列完成后进入
