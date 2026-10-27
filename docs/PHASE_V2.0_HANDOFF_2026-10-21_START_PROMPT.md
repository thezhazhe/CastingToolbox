# 新窗口启动指令（复制到新 Claude Code 窗口）

> **★ 2026-10-21 后续更新**：R6-S5 已完成（158.txt）。
> 先读 `docs/PHASE_V2.0-P1-R6-S5_REPORT.md`（最新），再读本指令下面的 S4 交接材料。
> 当前工作区 138 项（41 M + 97 ??），Node 全量 902/1（唯一历史 `phase24 T5`），
> `calcManifest.js` 指纹 `3bfc3e16`。

你是接手 **Casting Toolbox V2.0** 的新 Claude Code 窗口。项目路径：

`D:\CDXProject\CCproject\CastingToolbox`

## 第一步：只读恢复上下文（按顺序）

1. 完整读取最新 S5 实际执行报告：
   `docs/PHASE_V2.0-P1-R6-S5_REPORT.md`

2. 完整读取正式交接书：
   `docs/PHASE_V2.0_HANDOFF_2026-10-21.md`
   这是 S4 时点的最高优先级交接文件；其正文数字（133 项 / 896/1 / e8d4d9a5）
   已被 S5 更新，顶部有说明。

3. 读取 S4 实际执行报告：
   `docs/PHASE_V2.0-P1-R6-S4_REPORT.md`

4. 读取项目约束：
   `D:\CDXProject\CLAUDE.md`
   `docs/HANDOFF_2026-10-07.md` 只作历史参考；其中的 `840/1`、`116 文件`、
   `e56deaa0 riser.js` 等数字已经过期，不要当成当前状态。

5. 核对当前 Git 状态（只读命令）：
   ```bash
   git branch --show-current
   git rev-parse --short HEAD
   git status --short
   ```
   S5 完成后的基准是：分支 `main`、HEAD `da1c822`、工作区 **138 项**
   （41 M + 97 未跟踪；`screenshots/` 被 gitignore）。
   **不要假设 HEAD 仍然相同，必须自己核对。**

## 第二步：最小必要代码核实

只验证与下一步直接相关的结论，不要重读整个项目：

- `js/views/designCenter.js`：`saveParamDraft()` 保存时不调用 `runAnalysis/autoRecompute`；
  `startAnalysis()` 才执行完整分析；空保存有守卫。
- `calcs/calcManifest.js`：`yield.calculate` 的整模新字段仍在；riser 调用仍硬编码
  `hd_ratio: 1.0`。
- `calcs/riser.js`：`runRiser` 接受正 `hd_ratio`；球形 `H ≡ D`。
- `js/views/riserView.js`：H/D 选项为 0.8 / 1.0 / 1.2 / 1.5；球形隐藏 H/D。
- 冻结指纹：交接书 §B.6 的 10 个值；当前 `calcManifest.js` 应为 `e8d4d9a5`。

**不要重新执行已经有可靠证据的调查，也不要因为交接就重跑全量 Node/浏览器测试。**
S4 报告已有：Node **896/1，exit 1**（唯一历史 `phase24 T5`）、S4 专项 **5/0**、
S4 浏览器 **30/0**；历史失败为 inspection 2 项、stl marker 1 项。
如果下一步确实需要新结果，只跑相关分级测试，并记录真实退出码。

## 第三步：先输出简短状态确认（不超过 15 行）

必须包含：

1. 当前实际进度；
2. 已完成的工作；
3. 尚未完成的工作；
4. 与交接书不一致的地方（若有，给文件/行号证据）；
5. 推荐的下一步。

## 第四步：继续推进，但守住边界

- 如果用户提供了新的命令文件（`新建 文本文档 (NN).txt`），**以命令文件为准**。
- 如果没有新命令文件，按交接书 §G.2 推进：
  1. 先做 **H/D 最小实现方案 + 影响清单**（只写方案，不改冻结代码）；
  2. 明确 49 个历史 riser 用例的重基线范围；
  3. 方案完成后等待授权，再实施。
- 不要只做摘要就停下来；没有关键矛盾时应继续推进已经明确的待办任务。

## 绝对边界

- **不执行** `git reset`、`git checkout`、`git clean`、`git stash`。
- **不删除、覆盖或回滚**当前工作区已有的未提交修改。
- **不自动提交、推送或发布**。
- **不通过删除测试、删断言、跳过测试或改测试期望来制造通过。**
- **不修改冻结计算逻辑**：
  `js/engine/**`、`calcs/riser.js`、`calcs/calcManifest.js`、`calcs/riserDreq.js`。
  唯一已知例外是 S4 获授权的 `calcManifest.js` 出品率新增字段；后续任何冻结改动，
  必须先说明原因、影响和验证方案，等待用户授权。
- 不改变 `Mr_target = 1.2 × Mc`、设计中心 `H/D = 1.0`、体积校核只作诊断、
  不因体积失败自动放大冒口。
- 不编造实测浇道重量、最终实重出品率或工程结论；没有数据就保持 `null`/“暂不能给出”。
- 中英文界面保持同步；不引入 CDN 或新的外部运行时依赖。
- 对已有工作台架构做增量修改，不推翻重做。

## 遇到以下情况必须暂停并报告

1. 需要改冻结文件且没有明确授权；
2. 需要改变冒口算法、目标模数、体积校核对象；
3. 需要新增实测数据口径或最终出品率公式；
4. 需要提交、推送、发布或改版本号；
5. 发现交接书与真实代码存在会导致后续工作出错的关键矛盾。

报告格式：先说简短结论，再给文件/行号证据、测试结果（含退出码）和剩余风险。
