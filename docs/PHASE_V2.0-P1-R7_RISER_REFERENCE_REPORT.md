# PHASE V2.0-P1-R7 · 冒口颈与补缩距离经验参考

> 命令：`D:\CDXProject\新建 文本文档 (162).txt`
> 日期：2026-10-22 ｜ 分支 `main` ｜ HEAD `da1c822`
> 状态：**已实现；未提交、未推送、未发布；等待人工审查。**

---

## 0. 结论

1. **冒口颈**：新增独立“冒口颈尺寸参考”卡，按任务指定的 DISA 经验关系 `M_N ≥ M_F/3`，`M_F` 取当前冒口**实际模数 `Mr_act`**（不是 Mc、不是直径）。支持圆形、正方形、长方形；长方形由用户输入一侧 `a`，按 `b = 2aM_N/(a−2M_N)` 反算，并检查 `a > 2M_N`。理论值不提前取整；建议实际尺寸只向上取整到整数 mm，并复核取整后仍满足模数。
2. **补缩距离**：新增独立“补缩距离经验参考”卡，直接复用 STL 主体壁厚 `process.wallUsed`，同时显示板状 `2s` 与杆状 `1.2s`；无有效壁厚时显示“无法计算”，不使用 0/默认值替代。
3. **两个入口共用逻辑**：新增 `js/views/riserReference.js` 纯计算 + 卡片绑定模块；独立冒口计算器与工艺设计中心都 import 同一模块，不维护第二套公式。
4. **UI**：两卡放在现有冒口核心结果之后；桌面并排、移动端自然堆叠；底部一条统一低干扰工程提醒；中英文同步。
5. **核心算法未改**：`calcs/riser.js`、`calcs/riserDreq.js`、`calcs/calcManifest.js`、`js/engine/**` 均未修改；旧 `d_neck` 保留在详情中并标注“旧模数法（历史口径）”，不反向限制新参考。
6. **来源核查**：按任务要求做了最小范围检索，但公开资料**未能直接核对** DISA 的 `M_N=M_F/3` 与 `2s/1.2s` 原文；因此按任务指定的产品关系实现，明确标注“经验参考”，不扩大适用条件（详见 §5）。
7. **测试**：参考模块 Node **6/0**；S5/UI 浏览器 **49/0**；全量 Node **908 通过 / 1 失败，exit 1**（唯一历史 `phase24 T5`），完整结束，约 24 分 37 秒；无新增失败。

---

## 1. 基线

| 项目 | 结果 |
|---|---|
| 分支 / HEAD | `main` / `da1c822` |
| 开始前工作区 | 141 项（42 M + 99 ??） |
| 完成后工作区 | **144 项（42 M + 102 ??）**；新增 `js/views/riserReference.js`、参考测试、本报告 |
| 破坏性 Git 操作 | 未执行 |
| 提交 / 推送 / 发布 | 均未执行 |
| 冻结文件 | 未修改（指纹见 §8） |

---

## 2. 冒口颈计算链

### 2.1 输入来源

| 量 | 来源 | 说明 |
|---|---|---|
| `M_F` | `runRiser` 返回的 `Mr_act` | 当前设计冒口的实际有效模数（mm）；不是 `Mc`，不是 `D` |
| 形状 | 卡片选择器 | 圆形 / 正方形 / 长方形 |
| `a` | 用户输入（仅长方形） | 一侧尺寸，mm；正数 |

### 2.2 公式与边界

```
M_N = M_F / 3
圆形：  D_min = 4 M_N
正方形：a_min = 4 M_N
长方形：b_min = 2 a M_N / (a − 2 M_N)，要求 a > 2 M_N
```

- 内部计算使用 JS number 全精度，不提前取整；
- 理论值展示 2 位小数；建议实际尺寸 `Math.ceil` 到整数 mm，并重新代入模数公式复核 `M ≥ M_N`；
- 圆形：建议 `⌀D`；正方形：建议边长 `a`；长方形：展示用户 `a`、理论 `b`、建议 `b`；
- 输入缺失、非数、非正、`a ≤ 2M_N` 时明确失败，不输出假尺寸、不自动替换用户输入；
- 没有增加任何未由资料支持的修正系数。

### 2.3 旧结果处理

- 现有 `runRiser` 仍返回旧 `d_neck/M_neck/neck_k`（模数法历史口径）；
- 结果页详情中将旧行标注为“旧模数法冒口颈（历史口径）”，新参考卡独立展示；
- 旧值不参与新卡计算，也不把新卡结果回写核心。

---

## 3. 补缩距离

### 3.1 壁厚来源

- 使用 `process.wallUsed`：现有 STL/V3 可信主体壁厚字段（设计中心导入 STL 后由 `bodyRefOf` 链路回写；用户可手工调整）；
- 不从变量名推断其他字段；不重建壁厚识别；
- `s` 非有限或 `≤0` 时，卡片显示“无法计算：未获得有效主体壁厚”，不代替为 0/默认值；
- 独立计算器如果没有 STL/项目壁厚，同样显示不可计算。

### 3.2 结果

```
板状参考 = 2s
杆状参考 = 1.2s
```

两个结果同时展示，分别标注“板状参考”“杆状参考”，不合并成区间，不标记为所有铸件通用值。

---

## 4. 两个入口共用逻辑

新增 `js/views/riserReference.js`：

- `calcNeckReference({ modulus, shape, sideA })`：纯计算、无 DOM；
- `calcFeedingReference({ wallThickness })`：纯计算；
- `renderRiserReferenceCards()` / `bindRiserReference()`：两卡 HTML 与交互绑定（形状选择、长方形 a 输入、就地更新）。

调用点：

| 入口 | 调用 |
|---|---|
| 独立冒口计算器 `js/views/riserView.js` | `renderRiserReferenceCards({ modulus: r.Mr_act, wallThickness: proj.getV('process.wallUsed') })`，渲染后 `bindRiserReference(el)` |
| 设计中心结果 `js/views/resultsCenter.js` | `renderRiserReferenceCards({ modulus: it.Mr_act, wallThickness: proj.getV('process.wallUsed') })`，结果页重建后 `bindRiserReference(container)` |

两个入口的单位、有效性判断、取整与边界条件由同一模块提供；没有复制公式。未做大规模重构。

---

## 5. 公式来源最小核查（重要限制）

按任务要求，只对本次实际使用的两条关系做最小范围核查：

- `M_N = M_F / 3`；
- 板状 `2s` / 杆状 `1.2s`。

**核查结果**：

- 公开检索到的 DISA 资料（DISA Foundry Technology 索引）只列出 “Risering Technique / Riser Neck” 章节，**未给出可复核的公式原文**；
- 其他公开资料常见的颈模数关系是 `M_n = 1.1 M_c`、约 `0.67 M_t` 等，以及颈径约为冒口直径的 0.34~0.6 等；**不能据此证明或否定** `M_N=M_F/3`；
- 公开资料未找到 `2s / 1.2s` 的直接出处；Pellini 等补缩距离研究与本次指定关系不是同一表达。
- 因此：**保留任务指定的产品关系，但将其明确标注为“经验参考”**；不擅自扩大为所有材料/所有几何的通用结论，不添加修正系数，不声称已验证生产尺寸。
- 后续若企业能提供 DISA 原始手册/内部标准页，应把版本、页码、起算点与适用条件补入报告和 UI 帮助。

> 这不是“已证实”的工程结论；它是本阶段按已确定产品方案实现的参考功能。真实铸造效果仍需模拟与生产验证。

---

## 6. UI 与国际化

- 两张独立卡片：`冒口颈尺寸参考` / `补缩距离经验参考`；
- 关键数值加粗，单位 mm 清晰；
- 桌面 `repeat(auto-fit, minmax(260px, 1fr))` 并排；移动端自然堆叠；
- 底部统一提醒（低干扰普通文字）：
  “以上为经验参数，仅供工艺设计参考。实际尺寸与补缩效果仍需通过铸造模拟和生产实践验证，并结合实际结果持续优化。”
- 英文界面已提供对应词条；`browser_i18n_audit` 0 遗漏；
- 浅色/深色主题复用现有变量；无外部依赖；未重设计整个结果页。

---

## 7. 测试

### 7.1 专项

| 项目 | 结果 | 退出码 |
|---|---|---:|
| `node tests/runner.mjs phases6_riser` | **6/0** | 0 |
| `node scripts/browser_s5_test.mjs`（含参考卡、形状/矩形交互、独立计算器） | **49/0** | 0 |
| `browser_i18n_audit.mjs` | 0 遗漏 | 0 |
| `browser_responsive_test.mjs` | 全部通过 | 0 |
| `browser_s3_test.mjs` | 全部通过 | 0 |

### 7.2 最终全量 Node

| 项目 | 结果 | 退出码 |
|---|---|---:|
| `node tests/runner.mjs`（代码冻结后一次） | **908 通过 / 1 失败** | **1** |

> 新增 `tests/phases6_riser_reference_test.mjs` 6 个用例；R7-UI 基线 902 + 6 = 908，与实测一致。唯一失败为历史 `phase24 T5`；本阶段无新增失败。
> 全量耗时约 **24 分 37 秒**（日志创建 18:25:51 → 修改 18:50:29）；已完整结束。
> 全量日志：`_r7_ref_node_full.log`。

### 7.3 历史失败 / 未运行

- 历史：`phase24 T5`；`browser_inspection ⑩⑥`；`browser_stl_p22` marker；`browser_v2015` 旧脚本失效。
- 本阶段未运行：`browser_inspection`、`browser_stl_p22`、`browser_v2015`（按影响面选择；未声称通过）。

---

## 8. 冻结文件

| 文件 | 指纹 | 状态 |
|---|---|---|
| `calcs/riser.js` | `5cfcfef3` | 未变 |
| `calcs/riserDreq.js` | `efdc2301` | 未变 |
| `calcs/calcManifest.js` | `3bfc3e16` | 未变 |
| `js/engine/**` 7 项 | 与交接书一致 | 未变 |

- 新增文件：`js/views/riserReference.js`、`tests/phases6_riser_reference_test.mjs`、本报告。
- 修改：`js/views/resultsCenter.js`、`js/views/riserView.js`、`css/app.css`、`js/i18n/en-US.js`、`scripts/browser_s5_test.mjs`。
- 未改现有冒口核心计算公式、默认值或工程判据。

---

## 9. 记忆更新

- 项目 `D:\CDXProject\CLAUDE.md`：长期测试分层/时间控制规则（上一阶段已加入）；
- Auto Memory：`project-methodology.md`、`casting-toolbox-current-state.md`、`MEMORY.md` 更新；
- 没有新增大量记忆文件；本阶段细节保留在本报告与项目代码中。

---

## 10. 明确不在本次范围 / 待解决

- 不实现 Pellini、平方根公式、材料分类器、冷铁/冷却肋优化、缩松自动判断；
- 不要求用户选择板状/杆状；
- 不将参考结果回写冒口尺寸计算；
- 不声称 `M_N=M_F/3` 或 `2s/1.2s` 已由公开资料证实；
- `process.wallUsed` 为 0/无效时只能显示不可计算，需后续提供可靠壁厚来源；
- 邻接/颈长/切除难度、材料与凝固条件未进入本次计算，仅在提醒中说明。

---

## 11. 停止声明

本阶段完成即停止。**未提交、未推送、未发布。**
