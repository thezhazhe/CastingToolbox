# PHASE 28.3 报告：核心架构收敛 + 工程公式修复 + 80/20 能力增强

> 日期：2026-08-27 ｜ 命令：39.txt ｜ 状态：六阶段全部完成，**全量测试 194/0 通过**（170 基线 + 24 新增）
> 基准文件：docs/PHASE28_1_REPORT.md、docs/PHASE28_ISSUE_TRACKER.md、docs/PHASE28_2_ARCHITECTURE_DECISION.md

---

## 一、执行摘要

| 阶段 | 内容 | 结果 |
|---|---|---|
| 28.3-A | canonical 参数语义（density/weightKg/mcUsed/rh 拆分） | ✅ 迁移 + 全部消费者改路径，旧项目数值不变 |
| 28.3-B | Hp 方案 A + 密度 + pw 语义 | ✅ 真实案例 270.6/153.9/240.0 100% 复现 Excel |
| 28.3-C | 浇注系统规则（流速企业标准/vL 接口/fv 标注） | ✅ 封闭≤1.5/开放≤1.0 分级生效 |
| 28.3-D | 过滤网校核（80/20 折叠区） | ✅ 9 规格企业表 + 自动推荐（仅建议） |
| 28.3-E | 浇注时间查表（80/20） | ✅ 快浇分段表 + 有/无冒口重量表（Excel 值回归锁定） |
| 28.3-F | 浇注温度推荐（80/20） | ✅ 壁厚表插值 + 液相线公式，推荐范围非绝对值 |

## 二、修改文件清单

### 生产代码（7 个修改 + 6 个新增）
| 文件 | 修改内容 |
|---|---|
| `js/model/CastingProject.js` | canonical 字段（liquidDensity/solidDensity、netWeightKg/blankWeightKg、mcHotspot/wallHot、riserHeight、chillT、**Ho/ph 补字段**）；migrateProject 旧数据迁移；refreshWeight 双字段；clearStlBoundData 覆盖新字段；set() 对 CALC_RESULT 用户修改标 USER_OVERRIDE |
| `calcs/calcManifest.js` | 全部计算器参数路径改 canonical；gating rh 接线（riserHeight）；chill 独立 T_hot；**chill 材质键映射修复**（灰铁→灰铸铁） |
| `calcs/gating.js` | **calc_Hp 中注方案 A**（(Pv+rh)²/2C）；V_LIMIT 企业流速标准（封闭 1.5/开放 1.0）；vL 液面上升速度接口；fv 来源标注 |
| `js/views/designCenter.js` | mcHotspot/wallHot 写入分流；材料联动双密度（gating 液态表 + riser 固态表）；参数区净重只读+毛坯主输入；Mc 输入绑定冒口模数来源；riser 结果回写 riserHeight |
| `js/views/resultsCenter.js` | 毛坯重量 + 冒口模数来源展示适配 |
| `js/views/reportGenerator.js` | 双密度/净重/毛坯展示 |
| `js/views/gatingView.js` | 过滤网折叠校核区；企业查表对照行；浇注温度建议行；流速标准标注；Hp 公式标注更新 |
| `data/filter_calc.js`（新） | 过滤网 9 规格企业表（成本数据不引入） |
| `calcs/filter.js`（新） | checkFilter/recommendFilter 纯函数 |
| `data/pour_time.js`（新） | 浇注时间查表（快浇分段 + 有/无冒口重量表） |
| `calcs/pourTimeTable.js`（新） | 线性插值纯函数（超界取端点） |
| `data/pour_temp.js`（新） | 浇注温度壁厚表 + 液相线公式 + 企业过热度 50 |
| `calcs/pourTemp.js`（新） | 浇注温度推荐纯函数 |

### 测试（6 个新增 + 4 个修改）
`tests/phase283a~f_test.mjs`（24 个新测试）；`model_test/phase16b/phase16c/phase16final/smoke_manifest` 适配 canonical 路径。

## 三、各阶段详情

### 28.3-A canonical 参数语义
**改了什么**：
- `material.density` → `liquidDensity`（gating 液态）/`solidDensity`（净重+riser 体积换算）
- `geometry.weightKg` → `netWeightKg`（STL 净重，派生+展示）/`blankWeightKg`（毛坯，**全部计算器统一口径**）
- `process.mcUsed` → `mcHotspot`（热结 M）/`wallHot`（壁厚/2）；riser 有热结用前者、无热结用后者
- `rh` → `process.riserHeight`（riser 结果回写，gating 读取）
- **迁移逻辑**：旧项目同值拆分，`material.density` 等旧字段删除（get 返回 null，杜绝旧路径）
- **补了两个静默失败字段**：`process.Ho/ph`——gating 声明了但模型无字段 → 设计中心输入一直写不进（set 返回 false），calculate 永远 fallback 150/100

**没改什么/为什么**：密度取值不变（液态=现有 gating 表值，P0-3 取值待人工批准）；毛坯自动余量加成不实现（无可靠系数，不猜测）。

### 28.3-B Hp 方案 A + 密度 + pw
**改了什么**：calc_Hp 中注 `(P+C−rh)²/2C` → `(Pv+rh)²/2C`（方案 A，已批准）；riserHeight 闭环（riser 计算后回写，用户改过不覆盖；gating 读取，PARAM_OWNERS 自动纳入）。
**回归锁定**（真实案例海德曼基座 HT300）：顶注 270.6 / 中注 153.9 / 底注 240.0；无冒口中注退化文献式 320.5。
**未改**：底注公式（已验证正确）；Dietert/fv/奥赞（来源确认无需改）。

### 28.3-C 浇注系统规则
- 内浇口流速：企业标准**封闭≤1.5 / 开放≤1.0**（原统一 1.8，开放偏松 80%）；代码标注"企业经验标准"，UI 显示校核/建议
- fv：保留企业 Excel 来源（顶/中/底 0.8/0.6/0.45）；"有过滤网−0.1"证据不足不硬编码
- 液面上升速度 vL=ph/t 计算接口已建+展示；**下限标准无企业表，不硬判定**（P1-7 PARTIAL）

### 28.3-D 过滤网（方案 B 折叠校核区）
- gatingView 内折叠区（默认收起、0 输入自动跳过、"未设置过滤网，跳过校核"）
- 9 规格企业表（碳化硅/氧化锆/莫来石/双层，灰铁 400-1200/球铁 200-2200kg）；**价格未引入**
- 选型号 → 按当前 G 校核（✓/✗ + 百分比）；推荐仅显示"建议"，不自动改变浇注系统
- 铸钢/铝/铜无企业标准 → 明确提示跳过（不静默）

### 28.3-E 浇注时间查表
- 纯函数（不写死 UI）：`pourTimeByWeight(G, 有/无冒口)` + `pourTimeFast(G)` 线性插值，超界取端点
- 回归锚点：G=120.22 → 有冒口 16.9099s / 无冒口 10.022s / 快浇 9.5392s（Excel 原值）
- **慢浇表未实现**：Excel「浇注时间查表」R14 慢浇 16.011 来源不明确（≠有冒口 16.91），按 39.txt §九标记待验证，不猜测
- gatingView 结果区并列参照行（Dietert vs 企业查表）

### 28.3-F 浇注温度推荐
- 铸铁壁厚→浇注温度企业表（5mm→1470 … 250mm→1270℃，37.5→1320 与 Excel 案例一致）
- 液相线 TL=1650−124.5C−26.7Si−65.4P（B 级）+ 企业过热度 50℃（有成分时合并）
- 输出**推荐范围**（±15℃）非绝对值，标注"企业经验参数"
- 铸钢/铝/铜无企业表 → 明确提示手工填写；「查表」R77 系列（R73−1150 恒定差）语义不明未引入

## 四、数据流变化图

```
旧：material.density ─┬─ refreshWeight（净重，混用）
                      └─ designCenter 材料联动（液态表）
新：
  material.liquidDensity ── gating 液态密度（材料表自动，展示）
  material.solidDensity ──→ refreshWeight → geometry.netWeightKg（STL 净重）
                           └─→ blankWeightKg 默认同步（未手动改时）→ gating pw / riser
                                cast_wt / yield / sandbox / shakeout / charge（统一毛坯口径）

旧：process.mcUsed（热结 M 与壁厚/2 混用）→ riser + chill
新：process.mcHotspot（热结 M，STL）→ riser（有热结）
    process.wallHot（壁厚/2，DERIVED）→ riser（无热结）；chill 默认 T=2×模数
    process.chillT（独立 T_hot，用户可改）→ chill

旧：gating rh 恒 0（中注失效）→ 设计中心 Hp 错误
新：riser 结果 → setResult(process.riserHeight) → gating calc_Hp（方案 A）
    用户改 riserHeight → USER_OVERRIDE（不被 riser 回写覆盖）

新能力：G → 过滤网校核（折叠区，仅建议）
        G → 浇注时间查表对照（快浇/有冒口/无冒口）
        wall → 浇注温度建议（推荐范围）
```

## 五、测试报告

**全量 194 通过 / 0 失败**（`node tests/runner.mjs`）

新增 24 个测试：
| 文件 | 覆盖 |
|---|---|
| phase283a（4） | 旧项目迁移同值拆分；riser 有/无热结消费分流；chill 独立 T_hot；gating 读毛坯+riserHeight 接线 |
| phase283b（4） | Hp 方案 A 真实案例 270.6/153.9/240.0；无冒口退化 320.5；runGating 全链一致；riserHeight 回写闭环 |
| phase283c（4） | 流速分级（封闭 1.5/开放 1.0）；超限建议标注企业标准；vL=ph/t；fv 来源不变 |
| phase283d（4） | 过滤网数据完整性（9 规格/无价格/莫来石仅球铁）；校核正确性；材料不适用→null；最小规格推荐 |
| phase283e（4） | 查表 Excel 值回归（16.9099/10.022/9.5392）；插值端点；超界取端点；慢浇待验证标记 |
| phase283f（4） | 温度表锚点 1320；液相线公式+灵敏度；推荐范围+来源标注；非铸铁明确提示 |

## 六、台账更新（docs/PHASE28_ISSUE_TRACKER.md）

**FIXED**：P0-2（Hp 方案 A）、P1-4（流速标准）、P1-10（mc 双语义）、P1-17（独立 T_hot）、P1-27（过滤网）
**PARTIAL**：P0-3（密度结构已拆，取值待批）、P0-4（重量语义已拆，余量换算待案例）、P1-7（vL 接口）、P2-15（查表体系部分引入）
**CONFIRMED 未动**：P1-11/12（riser 形状/hd 硬编码）、P1-13~15（STL）、P1-16（圆柱热结 T）、P1-19~26/28/29 等

## 七、本阶段没有解决的问题（遗留清单）

1. **P0-3 密度取值**：液态密度铸钢 7.5/铝 2.6 的修正（7.0-7.2/2.4）待人工批准——结构已拆，仅取值
2. **P0-4 毛坯自动余量**：净重→毛坯换算系数无可靠来源，未实现（等真实案例）——现毛坯默认=净重，UI 可改
3. **慢浇查表**：16.011 来源不明，待验证（不猜测）
4. **vL 下限标准**：无企业表，未判定（仅计算展示）
5. **P1-16 圆柱热结 T**：chillT 独立后数值行为保留，圆柱热结 T=D 修正需形状识别（后续阶段）
6. **P1-11/12 riser 形状/比值硬编码**：未在本阶段范围（28.3 清单后续项）
7. **浇注温度表仅铸铁**：铸钢/铝/铜无企业表，明确提示手工填写
8. **「查表」R77 系列/慢浇表数据源**：语义不明，未引入

## 八、产品结构验证（39.txt §十七 最终检查）

- ✅ 13 个计算器独立可用（gatingView 自带全部输入，不依赖 project）
- ✅ 工艺设计中心独立（canonical 参数经 CastingProject 传递，计算器不反向依赖中心）
- ✅ STL 不强制污染计算器（手动模式可完整使用；netWeightKg 仅展示参考）
- ✅ 无新增全局变量混乱（全部经 CastingProject 元数据参数；旧字段已删）
- ✅ 无新增单位混乱（riserWt /1e6 修复保留；双密度单位 g/cm³ 明确）
- ✅ 企业 Excel 未全盘复制（只进 4 项验证过的能力；成本/台账/废品率仍 Future Candidate）
- ✅ UI 复杂度可控（过滤网折叠、查表/温度一行文本、无新页面）

## 九、下一步建议

1. **批准 P0-3 密度取值**（铸钢 7.5→7.0-7.2 液态、铝 2.6→2.4）——唯一等待人工判断的公式级改动
2. 28.3 清单剩余高价值项：P1-11/12 riser 形状/比值接线、P1-13 validateMesh、P1-18 machining 接线
3. 收集真实案例：出品率校准（P1-29 需 5+ 案例）、毛坯余量系数（P0-4）
4. 慢浇表：若可取得 Excel 慢浇来源 → 补实现
