# PHASE 92 分析（92.txt §二）

> 92.txt 要求：**先分析，再编码**。本文件回答 §二 点名的 6 个问题，
> 全部结论都有**实测数据**支撑（探针脚本在仓库外，用完即删）。
> 分析做完才动代码；实现与验收见 `docs/PHASE92_REPORT.md`。

---

## 0. 一句话

**PHASE 91 的追踪不是"算法不聪明"，而是它被写成了"一条路径"。**
在交汇处，几何给出的信号（截面并成一块板、形心横移）本来是对的，
但那条路径只有一种反应——**要么继续走，要么报"流道到头"**。
实测这两种反应都会错：走就迷路，停就永远到不了横浇道。
PHASE 92 要做的是**加第三种反应**：在这里停下，把它记成一个节点，然后**往每个方向各起一条新边**。

---

## 1. 当前路径是怎样生成的？

链路（全部在 `js/model/flowTrace.js`）：

```
findConnections()                 ← §一 冻结，PHASE 91 已重写
   └─ 每个 Product↔Gating 连接区域 → 1 个 connection{centroid, initialDir, seedArea}
traceFlow()
   └─ for each connection → walk(tris, startPoint, startDir, meta, seedRadius)
         └─ marchSegment()        ← 本阶段的主战场
              每一步：在 P + D·h 处切一刀（平面 ⊥ D）
                      挑"离预测点最近的闭合环" → 形心 C
                      P ← C，D ← unit(C − prevC)，arc += |C − prevC|
              结束时看：① 这一刀出现 ≥2 个环 → branchLoops
                        ② 板状 + 面积跳升 + 板状很快消失 → junction
                        ③ 都没有 → end_of_duct
```

**关键事实**：`walk()` 的"分叉"只是**递归建子段**，子段与父段之间**只有 `parentId` 一个字符串**。
没有任何共享的节点对象。所以 C1 那条路和 C2 那条路即使走在同一根横浇道上，
在数据结构里也是**两条互不相干的段** —— 它们不知道对方走过哪里。

---

## 2. "nearest closed loop" 具体在哪里决定下一步？

**`cutSection()`（`flowTrace.js:510–535`）**，三步：

| 步 | 代码 | 说明 |
|---|---|---|
| ① 切 | `sliceArea(vertices, triCount, q, dir, 0, tris)` | 只切**本连通分量**的三角形 |
| ② 挑 | `bi` = 使 `dist(loop.centroid, predictFrom)` 最小的环 | **这就是 "nearest closed loop"** |
| ③ 判 | `bd > prevR·maxJumpFrac` → `off_axis`；`sd ≤ bd·ambigRatio` → `ambiguous` | 两道闸门 |

`marchSegment`（`flowTrace.js:689–751`）拿到 `ok` 之后：
`C = loop.centroid` → `D = unit(C − prevC)` → `P = C`。
**下一步的位置就是"最近那个环的形心"** —— 这就是问题 3 的根。

---

## 3. 为什么在 Junction 会出现错误跳转？（**实测三条根因**）

### 3.0 实测：用最普通的工业网络（§六 模型）

用 `browser_inspection_test.mjs` 里那份真实规格的浇注系统
（2 条内浇口 ⌀16 → 横浇道 ⌀22 → 直浇道 ⌀30，一个标准的 T 型网络）跑**当前代码**：

```
 C1 (-45.2, 0.6, 0.2)  kind=contact  secA=197.6     ← ⌀16 = 201.06 ✓
 C2 ( 45.0, 0.5,-0.1)  kind=contact  secA=197.5

 E1  C1  br=junction  len=38.0   min=197.1  max=531.9   end=branched
     (-45,5) -> (-45,20) -> (-45,29) -> (-36,33)          ← 横向跳了 9mm
 E2  C1  br=loops     len=10.0   min=381.8  max=382.0
     (-22,40) -> (-19,40)
 E3  C1  br=null      len=12.7   min=711.9  max=711.9   end=end_of_duct
     (0,105) -> (3,108)                                   ← 跑到直浇道**顶上**去了
 E4  C1  br=null      len=0.0    v=0/3     min=null      ← 空段
 E5  C2  br=junction  len=96.0   min=197.5  max=2127.4  end=branched
     (45,5) -> (45,20) -> (45,29) -> (14,40) -> (6,71)    ← 穿到直浇道里
 E6  C2  br=null      len=24.0   min=703.0  max=703.9
     (0,92) -> (0,108)
 E7  C2  br=null      len=104.0  min=197.4  max=2222.2  end=end_of_duct
     (0,51) -> (-2,31) -> (-45,24) -> (-45,7) -> (-45,2)  ← 从 C2 **走进了 C1 的管口**
```

**92.txt 列出的失效模式，一条不落全部复现**：

| 92.txt 的说法 | 实测 |
|---|---|
| 路径可能跳到错误方向 | E1 `(-45,29) → (-36,33)` |
| 可能穿到 Sprue 下方 | E5 `(14,40) → (6,71)` |
| 可能横向跳到另一条支路 | E7 `(-2,31) → (-45,24)`，终点就是 C1 管口 |
| 跑到 Runner 末端后又反向 | 见 §3.1 的 91-D 夹具 |
| 一个 Junction 被错误地当成单一路径 | 全表 |
| 量出物理上不可能的数 | `max=2222.2`（本夹具最大真值 706.9） |
| **同一个夹具 C1/C2 结果不对称** | C1 走 38mm、C2 走 96mm |

### 3.1 根因①：交汇处"最近的那个环"是**横通道的纵剖面**，形心在横通道中段

沿 C1 的轴线（x=−25）逐刀切（平面 ⊥ Y，实测表）：

```
  y     环数  面积     形心(平面内)      平面内 extent      长宽比
 y=45   n=2   222.0  c2=(0.0,0.0)    ext=(12.0,12.3)    asp=1.02    ← 两条内浇口各一个环
 y=47   n=2   252.2  c2=(0.0,-0.1)   ext=(12.0,13.6)    asp=1.13
 y=48   n=1   802.2  c2=(0.0,25.0)   ext=(12.0,99.9)    asp=8.32    ← ★ 并成一块板
 y=50   n=1  1224.5  c2=(0.0,25.0)   ext=(13.0,100.0)   asp=7.68
 y=55   n=1  1614.5  c2=(0.0,25.0)   ext=(19.1,100.0)   asp=5.22
 y=63   n=1   392.6  c2=(0.0,25.0)   ext=(22.0,26.4)    asp=1.20    ← 横浇道走完了
 y=65+  n=1   377.3  c2=(0.0,25.0)   ext=(22.0,22.0)    asp=1.00    ← 只剩直浇道
```

`y=48` 那一刀长宽比 **8.32**、extent `12×99.9` —— 这**根本不是本流道的截面**，
而是"顺着横浇道切开"得到的纵剖面。它的形心 `c2=(0,25)`，也就是**离我们自己的轴线 25mm**。
而 `prevR = 5.93`，`maxJumpFrac = 2.5` → 只允许跳 **14.8mm**。

> **这一刀被判 `off_axis` → 段直接以"流道到头"结束。C1 就是这样死在 y=45.5，从没到过交汇处。**
> 而 C2 因为步长相位不同，某一刀的跳幅恰好压在阈值以内被**放行**，于是冲进横浇道→直浇道，量出 2127mm²。
>
> **同一个夹具两种命运，差别只在"跨没跨过一道距离阈值"。**
> 这正是 92.txt §四 说的：`nearest-loop` 在交汇处"强行决定唯一方向"。

### 3.2 根因②：位置被"环的形心"拽走

`cutSection` 挑"离预测点最近的环"这一步**是对的**（预测点在**我们自己轴线上**）。
但下一步 `P = loop.centroid` 把位置**直接搬到环的形心**。
在交汇处，形心在横通道中段（25mm 外）—— 位置一被拽走，方向也跟着被拽走，后面全乱。

### 3.3 根因③：段之间没有共享节点，谁也不知道谁走过

E7 的终点 `(-45,2,0)` 就是 C1 那根内浇口的管口。
C2 的支路沿着横浇道走到 x=−45 之后，**没有任何机制告诉它"这段几何 C1 已经走过了"**，
于是它继续往下走进 C1 的管子。§十 要的 merge 在旧结构里根本无处安放。

### 3.4 补充实测：段结构本身也不稳

- **空段**：E4 长度 0、有效样本 0 —— 旧代码会产出"什么都没有的段"。
- **两条并排内浇口时**：`y∈[30,47]` 区间里**每刀都是 2 个环**（各 ⌀12，相距 50mm）。
  这是 PHASE 90 特意用 `forkSepMaxFrac=2.0`（上界）挡掉的情形（否则会被误判成"分叉"），
  **这一条 PHASE 91 是对的，必须保住**。

---

## 4. 哪一层负责什么？

| 职责 | 位置 |
|---|---|
| 几何截面 | `js/model/objectMetrics.js` → `sliceArea()`（返回 `area/loops/closed/centroid/loopInfo/basis`） |
| 连接检测 | `js/model/flowTrace.js` → `findConnections()`（**PHASE 91 冻结**） |
| 路径追踪 | `flowTrace.js` → `marchSegment()` + `cutSection()` |
| 分支识别 | `flowTrace.js` → `isFork()` / `detectJunction()` / `traceFlow().walk()` |
| 面积突变 | `flowTrace.js` → `detectAreaChanges()` |
| 语义标签 | `flowTrace.js` → `labelSegments()` |
| 汇总 / 诊断 | `flowTrace.js` → `flowSummary()` / `flowDiagnostics()` |
| UI | `js/views/inspectionCenter.js` → `renderGating / segmentBlock / areaChart / portEvidence / flowOverlay` |
| 3D 叠加层 | `js/views/components/modelView3D.js` → `setFlowOverlay()`（**已支持逐条 polyline 自定义颜色**，无需改） |
| 数值测试 | `tests/phase91_test.mjs` |
| 端到端测试 | `scripts/browser_inspection_test.mjs` |

**不涉及**（本阶段禁止动）：`js/engine/**`、Design Center、Hotspot V3、riser 逻辑、任何计算器。

---

## 5. PHASE 91 哪些函数可以直接复用？

| 函数 | 处置 | 理由 |
|---|---|---|
| `findConnections()` | **整体冻结** | §一 明令；PHASE 91 的顶点内外判据已实测可靠 |
| `sliceArea()` | **原样复用** | `loopInfo/closed/basis` 正好是交汇判据需要的三个量 |
| `headlineStats()` | **原样复用** | §16 第 4 条的落地，与拓扑无关 |
| `detectAreaChanges()` / `pointAtDistance()` | **原样复用** | §十二 要求 A(s) 保留 |
| `cutSection()` | **保留，改一处** | `off_axis` 从"这一刀作废"升级为"交给交汇判据再定"（见 §6） |
| `marchSegment()` | **保留推进主循环**，改两处 | ① 失败那一刀也过交汇判据；② 到位检查（撞上已有节点就停） |
| `isFork()` / `findCleanStart()` | **保留**，`findCleanStart` 加一道"非板状"闸门 | 否则会在"横穿通道的纵剖面"上错误起步（实测 91-P 踩过） |
| `detectJunction()` | **保留判据，改输出** | 判据（板状 + 面积跳升 + 板状很快消失 + 两个横向干净环）实测正确，但**只输出 2 个 arm，且要求"±横向都能切到环"** → 泛化成候选方向枚举 |
| `labelSegments()` | **保留，降级为"只有几何支持才命名"** | §十一：本阶段不把 Runner/Sprue/Ingate 当拓扑核心 |
| `traceFlow().walk()` | **重写为网络遍历** | 这是唯一的"结构性"改动 |

**一句话**：§十五 要求"复用 PHASE 90/91 已验证的代码，不要为了重新设计而全部重写" ——
**推进循环、切面、连续性闸门、A(s)、突变检测、语义标签一条都不重写**，
只把 `walk()` 的递归改成"节点 + 边"的网络遍历，并给它补一个"交汇处该停"的反应。

---

## 6. 最小修改点在哪里？

按依赖顺序：

1. **`marchSegment()` 的失败分支**（`flowTrace.js:676`）
   现在：`!hit.ok → missStreak++ → continue`（3 次就 `end_of_duct`）。
   改成：先跑一次**交汇判据**，成立就 `branched` 到交汇节点，不成立才 `missStreak++`。

2. **抽出 `junctionFromCut()`**（新）
   判据四条，全部是可复核的几何事实：
   - ① `slice.closed` 且只有 **1 个**闭合环（多环走 `isFork` 那条路）
   - ② **板状**：平面内长宽比 ≥ `junctionAspect`
   - ③ **面积跳升**：≥ 上一刀 × `junctionUpRatio`
   - ④ **预测点落在这一刀里面**（`|center2| ≤ extent/2`）
     —— 这才是 §九 要的"空间连续性"：说明是**我们进入了它**，
     不是"它离我们很远、只是恰好被这一刀顺带切到"
   - ⑤ 再加 PHASE 91 已有的"**板状沿原方向很快消失**"（§五：不要因为面积变大就判 Junction）

3. **`probeBranches()`**（新）：交汇点 → 候选方向 → 筛选 → 支路起点
   - 候选 = 平面内**长轴 ±**（还原成 3D，用 `slice.basis`）**∪ 原方向 D**
   - 筛选：不回头（与来向夹角 > `backDeg`）／`findCleanStart` 能找到**非板状**的干净起点
   - **理由**：切一根横穿通道得到的板，它的**平面内长轴就是那根通道的轴线方向**——
     这不是经验规则，是"平面 ⊥ 自身轴线切一根管会得到沿该管轴的矩形"的直接推论。

4. **`traceFlow()` 重写为网络遍历**（新结构，同文件）
   ```
   nodes[]: {id, kind:'connection'|'junction'|'terminal', point, r, degree}
   edges[]: {id, startNode, endNode, samples[], path[], lengthMm, areaMin/Max, ...}
   ```
   外加一张**已走访点表**（每个采样形心 + 局部等效半径），两个用途：
   - **边中途撞上已有节点 → 停在那里并连上**（§十 的 merge）
   - **支路起步点落在已走过的几何上 → 根本不生成**（杜绝 §十七 Q 的重复边）

5. **`flowSummary()` / `flowDiagnostics()`** 增加图统计（节点数 / 交汇数 / 末端数 / 边数）。

6. **`inspectionCenter.js`**：`renderGating()` 改网络视图；`flowOverlay()` 加交汇点 / 末端点标记 + 逐条边不同颜色（§十五：**不引入 legend 系统**，沿用现有图例）。

7. **`tests/phase92_test.mjs`** 新建（§十六 A~T）；**`scripts/browser_inspection_test.mjs`** 按 §十七 增补。

**不动**：`js/engine/**`、`findConnections()`、`sliceArea()`、`modelView3D.js`、Design Center、冒口逻辑、Hotspot V3。

---

## 7. 设计出来的目标形态（§二十一 验收）

对 §六 那个模型，程序**必须**稳定给出：

```
C1 ──E1(内浇口)──> J1(交汇)
C2 ──E4(内浇口)──> J3(交汇)
J1 ──E2──> T1(横浇道末端, x=-50)
J1 ──E3──> J2(直浇道交汇, x=0)
J2 ──E5──> T2(直浇道顶端, y=120)
J2 ──E6──> J3
J3 ──E7──> T3(横浇道末端, x=+50)
```

**而不能**出现：

```
C1 → 直浇道下方 / 上方      （实测 E3 就是这么错的）
C1 → 横浇道末端 → 回头
C1 → C2 / C2 → C1           （实测 E7 就是这么错的）
C1 → 错误横向支路
```

判定"对"的标准是**连通关系**，不是标签（§十一/§十四）：
正确的几何网络比错误的工程标签重要。

---

## 8. 已知难点与不做的事（§二十 不要过度设计）

| 难点 | 本阶段怎么办 |
|---|---|
| 环形浇道（闭环网络） | 允许 graph 有环；靠"已走访点表"终止，不会无限展开 |
| 4 路交叉（+） | 候选方向里本来就有"原方向 D"（若那里的截面不是板状就保留），天然支持 |
| 交汇处**占比很大**（横浇道吞掉内浇口） | 同 PHASE 91：切不出干净截面就如实说，**不给数** |
| 面积比例 / 流速 / 工艺合理性 | **明确不做**（§一/§十三/§二十二） |
| Runner/Sprue/Ingate 的工程命名 | 只在几何支持时贴标签，**不参与拓扑**（§十一） |

---

## 9. 相关

`docs/PHASE91_REPORT.md` · `docs/PHASE90_REPORT.md` · `docs/PHASE89_REPORT.md`
`js/model/flowTrace.js` · `docs/PHASE92_REPORT.md`（实现与验收）
