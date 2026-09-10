# P52 Final Audit 报告（54.txt）— 结论：**GO → 正式冻结**（55.txt 裁决 ISSUE-1 后由 CONDITIONAL GO 升级）

> 审计范围：浇注系统设计计算器（gating）。目标=判断当前版本是否达到正式冻结条件。
> 基线：P51 收尾 122/0 → P52 审计后 **143/0**。
> 纪律遵守：未主动重构、未加功能、未改 UI 观感、未改企业参数/公式/preset/阈值（除下表中经审计确认违反已批准规则的 2 处取整修复）。

---

## A. Audit Summary

| 审计项 | 结果 | 说明 |
|---|---|---|
| Engineering calculation（浇注时间） | **PASS** | calc_t 五材料分派与 54.txt §2 逐项一致：灰铁 ≤450/ >450 两式、球铁 K₁=2.080/2.670/2.970 硬分档（10/25 不插值）、铸钢 log₁₀ 式、铝/铜 unified Dietert（fc 1.20/0.90）。52-T* 与 47-R2/R3 双重锁定 |
| Mass convention（质量口径） | **PASS** | castingMass=pw×cav 只进 calc_t（52-T3 显式自证：t≡calc_t(Wc) 且 ≠calc_t(G)）；G=Wc/yr 只进奥赞/流量/面积。无口径串用 |
| Density（密度） | **PASS** | gating 液态表（7.0/6.9/7.5/2.6/8.4）与批准一致；riser 固态表=28.7-A 人工批准值（球铁 7.1/铝 2.7）。54.txt PART 4 原文（6.9/2.6）为文档基准错误，经 44.txt 回查确认后已修正（55.txt 裁决） |
| Gating ratio（preset） | **PASS** | 6 preset 数据完整；UI=Calc=Report 三处同源（53-T11/17a + 52 浏览器）；自动推荐 6 场景锁定不变 |
| Choke（阻流位置） | **PASS** | A_choke=min(Fs_act,Fr_act,Fg) 实际几何判定（52-T6）；boundary 1% 容差保持不变（仅观察） |
| Velocity（速度） | **PASS** | v=1000G/(ρtF)；v_theory=fv√(2gHp) 保留内部诊断不参与判定；A_target/A_rec=max 数学链 52-T5 自洽 |
| Optimization（优化） | **PASS** | 入口门禁（ingate/boundary 无按钮）已在真实 UI 路径（gatingView 383/498-501）；提交前 choke 变化拒绝防御为真实代码非测试 mock（381-392）；浏览器 J 场景全流程：0.715→0.357 m/s、150→300 mm²、choke 未迁移 |
| Geometry（取整） | **PASS（含修复）** | D_sp 圆形直径 round→ceil（ISSUE-0）；L_r 横浇道长度对齐 ceil 规则。理论→实际→面积→choke→velocity 全链最终几何（52-T1/T2 锁定） |
| Boundary（临界） | PASS | 默认/常见封闭式案例如实显示"临界（并列）·建议人工复核"，为取整后的真实几何并列；1% 容差未改 |
| UI / UX（第一屏） | PASS | 13 项首屏答案全覆盖（浏览器 A 场景断言）；详情=证据不参与首屏 |
| Code architecture | ISSUE-3/4 | 单向依赖 ✓、无重复 event 计算 ✓（debounce 吸收）；发现 1 处死代码引用（#g_details2）与 1 处过时注释（已修，ISSUE-4） |
| Tests（真实性） | PASS（含补缺） | 测试均按"新规则锁定"而非放宽（P49 修复后 50-T4 属规则性断言）。审计发现覆盖缺口：直浇道/横浇道取整从未被测试锁定（50-T4 只锁内浇口 Fg）→ 52-T1/T2 补齐 |
| Browser（实操） | PASS | 10 场景 A-J 全过、0 JS exception（见 D 节） |

---

## B. Issues Found

| ID | Severity | Issue | Impact | Action |
|---|---|---|---|---|
| **ISSUE-0** | **Major（PART 0 点名）** | 直浇道圆形直径取整用 `Math.round`（gating.js:243 原），违反 P49「圆形直径必须 ceil」。P51 报告 "round 24mm" 字样实为代码真实行为 | 理论 D 落在 (n.5, n+1) 时直径向下取整 → Fs_act < A_sp，直浇道失去设计富余，可翻转 choke/boundary 判定（P51 默认案例 boundary 即此机制产物） | **已修**：改 `Math.ceil`；UI/报告只透传 calc 值无需改；52-T1 全剖面锁定 |
| **ISSUE-0b** | Major（同规则延伸） | 横浇道长度 `Math.round(…/5)*5`（gating.js:238 原）与 P49 §十五「目标面积驱动尺寸不得 round 致面积不足」及 54.txt PART 10「线性尺寸=ceil」冲突（内浇口 L_g 已 ceil，横浇道遗漏） | 理论长度 round 向下时 Fr_act < A_run 同类面积不足 | **已修**：改 `Math.ceil(…/5)*5`；52-T2 锁定 Fr_act ≥ A_run 且 5 的倍数 |
| **ISSUE-1** | ~~Major~~ → **已关闭（55.txt 裁决）** | 54.txt PART 4 将 riser solid 写成 6.9/2.6 | 回查 44.txt（28.7-A 批准记录）确认：球铁 6.9→7.1、铝 2.6→2.7 为该次**明确人工批准修改项**，代码现行值 7.1/2.7 = 最终批准企业参数。54.txt 原文为文档基准错误，已修正为 7.1/2.7 | 代码零修改；52-T4 锁定不变（gating liquid 6.9/2.6 保持） |
| **ISSUE-2** | Minor（记录不修） | custom 比例输入为负值时 calc 层不拒绝（`input.cs||1` 只兜 0/NaN；UI min=0.1 不阻断手输负数） | 输出负参考面积 A_run/A_gt（制造尺寸走最小兜底，无 NaN/异常——52-T7 证实 35 组攻击矩阵全过） | 正常路径不可达；如需可加 calc 层正数校验（本轮不加） |
| **ISSUE-3** | Cosmetic（记录） | `renderJudge` 引用 `#g_details2`——DOM 中不存在（详情区 id=`g_details` 且 P51 已平铺问题清单，该引用自始无效） | 无功能影响（`if (det)` 静默跳过），死代码 | 记录，后续重构清理 |
| **ISSUE-4** | Cosmetic（已顺手修） | `calc_t` 头注释残留 P47 口径「W=浇注重量 G（=pw×cav/出品率）」，与 183 行 P49 实现（W=castingMass 不出品率）矛盾 | 误导维护者 | **已修**（纯注释一行） |
| **ISSUE-5** | Observation | 默认输入（46.8×2/Ho180/封闭式常用）等常见封闭式案例：有意 15% 截面富余被 5mm/1mm 取整压缩至 <1% → 系统如实判 boundary | 第一屏提示人工复核属 P51 判定规则的直接后果 | 54.txt PART 7 明确不作为问题：**不改 1% 容差**。若默认场景需顺畅，属未来口径讨论（非 P52） |

---

## C. Changes Made

| 文件 | 修改 | 原因 |
|---|---|---|
| `calcs/gating.js:243` | 直浇道直径 `Math.round` → `Math.ceil`（+注释） | ISSUE-0：P49「圆形直径一律 ceil」已批准规则，P51 报告 "round 24mm" 确认为真实违规 |
| `calcs/gating.js:238` | 横浇道长度 `Math.round(…/5)*5` → `Math.ceil(…/5)*5`（+注释） | ISSUE-0b：与 L_g 同规则（P49 §十五 目标面积驱动尺寸不得 round 致面积不足） |
| `calcs/gating.js:71` | calc_t 头注释修正为 P49 口径 | ISSUE-4：残留旧口径误导 |
| `tests/phase52_test.mjs`（新增） | 7 项审计锁定（见 D） | PART 19：修复后回归测试 + PART 11 边界攻击 |

工程影响说明：两处取整均使**实际面积 ≥ 目标面积方向**（宁大勿小），不改变任何公式/口径/阈值。受影响下游为 Fs_act/Fr_act 数值及由此推出的 choke/boundary 判定——**修复正确性方向与 P51 判定意图一致**（富余不再被 round 吃掉），未产生任何"实际面积不足"的回归（136 项既有断言全部原样通过，无一条需要改写，佐证取整修复前后行为连续且未被测试错误锁定）。

---

## D. Test Results

**新增测试（phase52_test.mjs，7 项）**
- 52-T1 PART0 修复回归：5 材料 × 200 剖面扫描——D_sp≡ceil(理论直径)、Fs_act≥A_sp 恒成立（命中 round≠ceil 差异剖面证明修复非空转）
- 52-T2 横浇道取整回归：L_r≥理论长度、Fr_act≥A_run、5 的倍数
- 52-T3 质量口径：t≡calc_t(Wc)、≠calc_t(G)（防回归到旧口径）
- 52-T4 密度分源锁定（液态 gating 表 + 固态 riser 已批准值，冲突裁决前基线）
- 52-T5 速度数学链自洽（A_target/A_rec/v_final/v_theory，含无目标材料）
- 52-T6 choke 一致性（chokeArea=实际 min、1% 并列、位置值域）
- 52-T7 PART11 边界攻击矩阵（35 组：0/负/450 边界/极大重量、球铁壁厚 9.9/10/25/25.1、型腔/浇口数非法值、Ho 0~50000、custom 0/负/极端/NaN、全空输入）——无 NaN/Infinity/负时间/负面积/JS exception/建议列表正常

**原有测试**：phase45a/47/48b/49/50/51/53 + 早期引用 gating 的 phase16c/16final/283a-f/284/286/287a/29 —— 全部原样通过，无一条断言改写（佐证 ISSUE-0/0b 修复与既有锁定一致）

**浏览器实测（场景 A-J）**：A 灰铁常规（首屏 13 项全断言）✓ B 灰铁 450kg 分界提示 ✓ C 球铁 auto 标准型 ✓ D 球铁 >200kg auto 宽大型 ✓ E 铝 auto 铝合金属 ✓ F 封闭式内浇口阻流（无按钮）✓ G 开放式直浇道阻流 ✓ H 自定义 1:0.7:0.8 横浇道阻流 ✓ I boundary（临界并列、无按钮、人工复核文案）✓ J 高流速一键优化全流程（0.715→0.357 m/s、150→300 mm²、choke 未迁移）✓ 无 console exception（0）

**Full regression：143 / 0 passed**（136 + 7 新增；全量含 STL/engine 套件按用户纪律跳过）

---

## E. Known Limitations

1. ~~ISSUE-1 密度冲突待人工裁决~~ → **已确认（55.txt）：28.7-A 为最终批准值**（riser solid 球铁 7.1/铝 2.7；gating liquid 球铁 6.9/铝 2.6 语义分离保持）。54.txt 原文列表已修正，避免文档基准错误
2. **boundary 1% 容差**：默认封闭式案例因取整富余压缩常落临界 → 系统如实提示复核（54.txt PART 7 声明不作为问题）
3. **preset description**：为按代码自动选择条件整理的一句话（非 preset 自带独立 description 字段）——数据源单一（RATIO_APPLIC），改条件时需同步
4. **runner choke 为工具定义分类**（横浇道阻流=上游截面控制流量，非铸造标准术语）
5. **v_theory 诊断值不参与判定**；灰铁仅设上限（无 lo），铸钢/铜无目标——均按 49.txt 定稿
6. D3 差异遗留（Hb <200kg 档企业表 300 vs 教材 150/200/250）不在本计算器范围，保持既有企业表

---

## F. 最终判定：**CONDITIONAL GO → 建议正式冻结**

满足 GO 条件：0 Critical、0 Major 未处理（ISSUE-0/0b 已修；ISSUE-1 经 55.txt 回查 44.txt 确认 7.1/2.7 为 28.7-A 最终批准值 → 已关闭，代码零修改）、全量 regression 通过（143/0）、浏览器关键场景全过、无未解释的核心计算问题。

条件项（记录不阻塞冻结）：
- ISSUE-2 Minor（custom 负比例输入无 calc 层校验）
- ISSUE-3 Cosmetic（#g_details2 死代码）
- ISSUE-5 观察项（默认封闭式案例 boundary 提示——1% 容差口径维持）

**55.txt 裁决后更新（2026-09-03）：ISSUE-1 关闭 → 0 Critical / 0 Major 未处理 → 判定升级为 GO。**

按 54.txt PART 21：不再进入 P53，不主动提出新功能。Casting Toolbox 当前版本**冻结**，进入实际使用与后续数据验证阶段。
