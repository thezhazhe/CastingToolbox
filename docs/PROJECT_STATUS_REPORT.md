# CastingToolbox 项目状态报告（2026-08-31）

> 项目介绍 + 进度 + 近期修改摘要（精简版，重点全保留）

---

## 一、项目介绍

**CastingToolbox 铸造工艺设计工具箱** —— 面向铸造工程师的 Web 工艺设计辅助工具。

**组成（三大部分）**：
1. **V3 热结引擎**：STL 网格 → 体素块法 O(N) 分析 → 热结识别（含自交/非流形/缠绕可靠性检测）
2. **工艺设计中心（Design Center）**：STL 导入 → 参数中心 → 计算器串联执行 → 建议输出
3. **13 个计算器**：9 个 manifest 计算器（冒口/浇注系统/冷铁/出品率/熔炼加料/工时/浇注温度等）+ 4 个知识型（查表/手册类）

**核心数据链（单向）**：STL → geometry → CastingProject（canonical 参数）→ calcManifest（riser 前置 gating）→ 建议；USER_OVERRIDE 保护用户值

**工程参数红线（已定稿，未经人工批准不得改）**：密度两表（gating 液态企业值/riser 固态球铁 7.1 铝 2.7）、Hp 方案 A（中注企业原式）、流速封闭 1.5/开放 1.0、出品率表

**运行**：`start.bat`，serve.js 端口 8090；测试 `node tests/runner.mjs`（基线 240/0）

---

## 二、项目进度

### 阶段地图（已完成全部）
```
PHASE 16-21  工作台整合 + V3 Adapter + 采样误报/距离场修复（架构定型）
PHASE 22-26  显示与采样优化 + 薄壁热结专项 + 几何审计 + 主体壁厚 UI（98~168/0）
PHASE 27      13 计算器全链审计（P0×3 修复：密度三处/charge 声明/line 选项集）
PHASE 28      工程算法科学性审计：P0×4（riserWt 单位 1000 倍错/中注 Hp/密度混用/pw 口径）
PHASE 28.1-28.4  Hp 破案（企业原式方案 A）→ 核心收敛实施 → 验收（4 处接线缺陷修复）
PHASE 29      可靠性升级：riser/chill 状态门禁（LOW_CONFIDENCE/INSUFFICIENT 不静默）
PHASE 28.5    STL 可靠性闸门：validateMesh 三态 + reliabilityLevel 三等级
PHASE 28.6    密度全链审计 + P1-13 自交检测（真实 STL 首次命中 96 处自交）
PHASE 28.7-A  密度人工批准定稿 → 公式链完全定稿，28 系列遗留人工项清零
```

### 当前状态
- **测试基线 240 通过 / 0 失败**
- 真实案例库：ALR2510/ALHR4510/HR4012/cat.stl（67 万三角，R1 正式 CLOSE）等，覆盖 2千~67万三角
- **正在进行的阶段（45.txt）**：STL 研究告一段落 → 13 计算器逐个打磨（保证稳定科学），第一个目标 = 浇注系统设计；打磨前调研已完成（企业说明书 + Campbell 手册），决策点待用户选择（见 `docs/GATING_CALC_GUIDE.md`）
- **未修复遗留**：B-2 自交共面重叠检测｜B-3 mdFellBack UI 提示｜P1-39 铜合金口径待人工｜C-2 出品率校准/ C-3 毛坯余量（缺数据，已从企业 Excel 找到素材）｜R1 次级热结位置漂移（记录层）

---

## 三、近期修改内容（28 系列，时间倒序）

| 阶段 | 指令 | 核心修改 | 结果 |
|---|---|---|---|
| **28.7-A 密度定稿** | 44.txt | solidDensity 球铁 7.1/铝 2.7（riser.js），liquidDensity 全保持企业值；**28 系列遗留人工项清零，公式链完全定稿** | 240/0 |
| **28.6 密度审计+自交检测** | 43.txt | 密度 7 处消费者全链审计、liquidDensity 零消费静默脱节修复；P1-13 自交检测（分箱+MT+邻接排除+UNCHECKED 截断），45° 斜置 AABB 膨胀坑修复 | 233/0→240/0 |
| **28.5 STL 可靠性闸门** | 42.txt | validateMesh 非流形/缠绕检测 + deriveGeomStatus 三态 + reliabilityLevel 三等级（SAFE/WARNING_REVIEW/BLOCK）；UI 文案拆"未检出"vs"分析失败"；15° 旋转补齐 | 219/0 |
| **PHASE 29 可靠性升级** | 41.txt | riser/chill 状态门禁（LOW_CONFIDENCE/INSUFFICIENT 不静默、INSUFFICIENT 绝不 wallHot 兜底）；optionalInputs 生命周期机制；geometry.valid 真实化 + INVALID 阻止；单峰均匀件判据修 45° 斜置误报 | 208/0 |
| **28.4 验收审计** | 40.txt | 28.3 六阶段验收；修复 4 处接线缺陷：RUN_ORDER（riser 前置 gating——首轮运行 A 偏小 31% 根因）、无热结 Mc 输入无效、riserHeight 清理遗漏、流速标注 1.8 残留 | 199/0 |
| **28.3 核心收敛实施** | 39.txt | canonical 参数拆分迁移（density/weightKg/mcUsed 双字段、Ho/ph 静默失败补字段）；**Hp 方案 A 实施**（270.6/153.9/240.0 锁定，中注企业原式）；流速企业标准 1.5/1.0；新增过滤网+查表+浇注温度 3 能力 | 194/0 |
| **28.2 架构收敛决策** | 38.txt | Hp 方案 A 决策（真实案例 100% 复现 Excel 待批准）；问题四分类 A8/B3/C9/D12；canonical 参数方案；0 代码改动 | — |
| **28.1 Hp 破案+Excel 审计** | 37.txt | 中注 Hp=Excel K7 原式（变量合并漂移致失效）方案 A 待批准；riserWt 已修（170/0）；发现出品率偏低/流速 1.8 不符/过滤网缺失 3 大差异 | 170/0 |
| **PHASE 28 算法审计** | 36.txt | 工程算法科学性审计：P0×4（riserWt 单位错 1000 倍/中注 Hp A 偏大 31%/密度液态固态混用/pw 净重口径错位）+ P1×15；评级 B-；奥赞 71.47 已验证正确 | — |
| **PHASE 27 计算器审计** | 20.txt 等 | 13 计算器全链审计：P0（密度三处 7.5/7.8/项目不一致、charge 声明与实际不符、line 选项集冲突）+ P1（castability/ct 不读 STL、riser 形状不生效、gating 组元硬编码）；UI 重设计参数中心 | — |

### 今天（2026-08-31，45.txt 启动日）
- 完成 gating 打磨前调研：企业工艺设计说明书 V3.2.2 深挖（12 项差异 D1~D12 + 8 项已验证一致）+ Campbell 手册可引用 TOP5
- 产出 `docs/GATING_CALC_GUIDE.md`（工具全解 + Excel 对照 + 书引用 + 8 个决策点）
- **0 代码改动**（等待决策点选择）

---

## 四、工作纪律（长期有效）

- 命令文件驱动（`新建 文本文档 (N).txt` 为新阶段指令，先读再执行）
- 只读诊断阶段禁止修改；修复阶段最小修改；测试走真实执行路径，禁止改测试预期掩盖
- 先根因后修复；对照测试用非对称模型；报告少而精，小阶段并入台账
- 真实 STL 测试慢（全量 ~5 分钟），后台运行

## 相关文档
`docs/PHASE28_6_ACCEPTANCE_REPORT.md`（28 系列验收+后续优先级）｜`docs/GATING_CALC_GUIDE.md`（gating 打磨指导，最新）｜`docs/PHASE29_REPORT.md` 等
