# PHASE 83 · V1.1 第一阶段报告

> 命令文件：`D:\CDXProject\新建 文本文档 (83).txt`
> 日期：2026-09-23　项目：`D:\CDXProject\CCproject\CastingToolbox`
> 原则：**先审查、后判断、再决定是否修改**。STL 核心算法本轮**零改动**。

---

## 0. 一句话结论

| 项 | 结果 |
|---|---|
| STL 审查 | 完成。**核心算法未改一行**；标签文案确认后做了 1 处纯显示改动 |
| 支持与资源页 | 完成（中英 + PC/移动端全部实测通过） |
| Windows 圆角图标 | 完成，**Android 6 张 PNG 逐字节未变**（sha256 证明） |
| 回归 | 分组 51/0；浏览器 4 支脚本全过；i18n 静态审计 825 key 全有词条 |
| ⚠️ 本轮查出 | **真值套件（20 个工程模型）当前 9/20，旧基线写的是 16/20** —— 见 §1.6 |

---

## 1. STL 专项审查

### 1.1 当前 STL 系统实际结构

```
STL 文件
 └ parseSTL                    js/engine/stl.js          三角面 → vertices/triCount
 └ buildMesh                   js/engine/mesh3d.js       几何 + BVH（射线/最近点加速）
 └ validateMesh                js/engine/meshValidation.js  网格质量 9 类检查（见 §1.5）
 └ analyzeGeometry             js/engine/geometryAnalysis.js 体积/面积/包围盒（精确积分）
 └ buildDistanceField           js/engine/distanceField.js 壁厚三件套（wallMain/Avg/Max）
 └ analyzeHotspotsV3Sliced     js/engine/v3/hotspotV3.js  热结主链（分片版，UI 用）
     ├ coarseSampleSliced      js/engine/v3/sampling.js     自适应采样
     ├ buildModulusField       js/engine/v3/modulusField.js 模数场 M = V/A
     ├ findPeaks               js/engine/v3/peakRegion.js   局部极大 + 环带显著度 + NMS
     ├ multiscaleVerify        js/engine/v3/peakRegion.js   0.5/1.0/2.0 三尺度
     ├ extractRegion           js/engine/v3/peakRegion.js   区域生长 → 体积/质心
     ├ representativePoint     js/engine/v3/peakRegion.js   代表点
     └ computeConfidence       js/engine/v3/peakRegion.js   四因子加权
 └ toViewResult                js/engine/v3/v3ViewAdapter.js  → UI 形态 + 采样 WARNING 分级
 └ displayCenterFor            js/engine/hotspotDisplay.js   显示半径 + 中面修正（纯显示层）
```

`hotspot.js` / `hotspotConfig.js`（V2）与 `js/engine/v3/legacy/` 均为**非生产路径**（V2 只在 `?hsV2=1` 对照开启）。

### 1.2 自动采样率机制（机制 4）

**结论：三角面数量完全不参与。**

```
mdim = max(boundingBox.size)                    ← 只用最大维，三条轴共用同一个 vs
粗探测：pgs ∈ [16,32,48,64,96,128]，pvs = mdim/pgs
        char(p) = 2 × BVH 最近表面距离；过滤 char < 2mm（伪尖峰）
        取 char 的 p10 → estMinWall；保底 max(estMinWall, 4mm)
目标 vs = clamp(0.5 × estMinWall, mdim/128, mdim/24)     ← 即"每档至少 2 层采样"
主网格：vs 逐级减半（最多 3 级 × 2 相位），每级夹 maxSampleGs = 256
        内部点 ≥ 128 即停；全失败则保留最后一试（由 WARNING 层如实报告）
```

| 量 | 下限 | 上限 |
|---|---|---|
| 最终每轴格数 gs | 24 | **256（硬夹）** |
| 粗探测每轴格数 | 16 | 128 |
| 粗场采样点数 | — | 20000（stride 抽稀） |
| 细化网格 | 16 格/轴 | 8000 点 |

**`triCount` 只影响耗时，不影响分辨率**（`adaptiveVs` 签名里就没有它）。模型尺寸**只用最大维**，最小维不参与 V3 采样链（只用几何分析那条距离场链）。

**"小尺寸局部特征被漏采"确实可能**：当真实局部厚度 < 2×最终 vs 时。代码有检测但不改变结果——
`thinFrac = P(t < 2×vs)`（t = 局部完整厚度 d+d2），阈值 `thinFractionMin = 0.10`，
触发后走 `samplingWarn` 的 🟡 `local_thin` 分支，只出提示、不改数值。

### 1.3 H1/H2 三个数字的真实含义（机制 1，**实测取证，不是看名字猜的**）

用真实浏览器加载 `tests/engineering-generated/models/t01_boss100/model.stl`，抓取设计中心 ② 热结列表**实际渲染出来的文字**：

```
② 热结列表        点击定位
H1
模数 18.2 mm
区域 112.6 cm³ · 置信度 81%
```

（改版前同一处显示：`H1` / `Mc 18.2 mm` / `112.6 cm³ · 置信 81%`）

| 界面上看到的 | 字段 | 真实定义 | 代码位置 |
|---|---|---|---|
| **模数 18.2 mm** | `peakModulus` | 热结区域**峰值点的模数 M = V/A**（体积÷散热表面积），单位 mm。V3 里还有 `modulusCeilRatio = 1/3` 的物理上限（M ≤ (1/3)×到表面距离） | `hotspotV3.js:206` `peakModulus: p.M` |
| **区域 112.6 cm³** | `regionVolumeCm3` | 热结**区域的体积**（mm³ ÷ 1000）。**是体积 cm³，不是面积 cm²** —— 代码里另有 `regionArea`（V/meanM，面积）也换算成了 `regionAreaCm2`，但**从未在任何界面显示过**（全项目仅 `v3ViewAdapter.js:40` 一处赋值，零消费） | `v3ViewAdapter.js:39` |
| **置信度 81%** | `confidence` | **算法内部评分，不是概率**。`0.4×相对模数 + 0.25×环带显著度 + 0.15×区域体积占比 + 0.2×多尺度稳定性`，全部 clamp 到 [0,1]；低于 `CONFIDENCE_THRESHOLD = 0.5` 的热结直接不输出。实测复核：t01 的 0.969967 用该公式逐项复算**完全吻合** | `peakRegion.js:186-193` |

**关于用户举例里的 "27.3 cm²"**：页面上确实有 `cm²`，但那是 **① 概览卡的「表面积 6115 cm²」**（模型总表面积），
和热结列表无关。热结那一项的真实单位是 **cm³**。已确认，非猜测。

**关于 "99%"**：本模型实测是 **81%**。数值随模型变，但含义固定——四因子加权评分。

### 1.4 热节"位置"如何确定（机制 3，本阶段最重要的一项）

**两级：**

1. **计算坐标**（`hs.x/y/z`，永不修改）
   `representativePoint()` = **区域质心**（`extractRegion` 的 BFS 生长点集平均值）
   → `isInside(geometry, c, 6)` 校验合法性
   → 不合法则**回落**到峰点 `sample.pts[region.pts[0]]`
   **注意：不是峰值点（M 最大点），是区域质心。**

2. **显示坐标**（`displayPosition`，只用于 3D 标记与列表 tooltip）
   `displayCenterFor()` 在计算坐标上再做一次**有界中面修正**：
   沿局部法线把点拉到壁厚中部，修正上限 = 0.5 × 区域等效半径；
   超限或无远侧表面 → **放弃修正**，`displayCenterReliable = false`，显示坐标 = 计算坐标。

**实测偏差（20 个工程模型 / 47 个热结，逐项量取）：**

| 指标 | 结果 |
|---|---|
| 峰值点 → 上报代表点 距离 | 最小 4.9 mm · **中位 24.7 mm** · 最大 147.5 mm |
| Δz（代表点 − 峰点） | **多数为负** —— 质心系统性地被拉到峰点下方 |
| 中面修正实际生效比例 | 3/10（其余 `no-far-surface` 或 `over-cap`，显示坐标 = 计算坐标） |
| 中面修正生效时的位移 | 0.36 ~ 2.98 mm（很小，方向正确） |

**典型例（t03_twoDiff_60_100）**：期望热结在凸台几何中心 (150, 0, 60)；
**峰点检出在 (152.0, −1.2, 48.6) —— 只差 11.5 mm，很准**；
但**代表点落在 (145.9, −1.2, 14.8)**，被拉到凸台与底板的交界处（底板顶面 z=10），偏离 45 mm。

**根因判断（已定位到代码，非猜测）**：区域生长用**未封顶原始 V/A** 作判据
（`peakRegion.js:127-130`，PHASE 24 / 32.txt 为修 ALR2510 板肋漏检而改）。
凸台-底板交界处"四周都是料"，局部 V/A 高于凸台上部 → 区域向下不对称生长 → 质心下沉。
**这是该改动的已知副作用，不是新 bug**；且从补缩角度看，交界处**恰恰是物理上最后凝固的位置**，
所以"质心偏低"在工程上未必是错的——但**与真值套件按"厚区几何中心"设定的判据不一致**（见 §1.6）。

### 1.5 网格警告分级（机制 5）

`validateMesh` 共 **9 类**，只有 **2 个 error** 会中止分析：

| 级别 | code | 是否阻止分析 |
|---|---|---|
| error | `NO_TRIANGLES`（空网格） | ✅ 阻止 |
| error | `NON_FINITE_VERTEX`（非法顶点，并就地归零） | ✅ 阻止 |
| warning | `PARSE_WARNING` / `DEGENERATE_TRIANGLE` / `OPEN_MESH` / `NON_MANIFOLD_EDGE` / `INCONSISTENT_WINDING` / `SELF_INTERSECTION` / `SELF_INTERSECTION_UNCHECKED` | ❌ 一律继续算，只落标签 |

- 阻止点共 3 处：热结引擎 `hotspotV3.js:38`、设计中心执行门禁 `designCenter.js:1596`、冒口/冷铁自动建议 `calcManifest.js:501`。
- 拓扑三类用同一遍边统计（顶点按 **0.001 mm** 量化）：奇数边计数→`OPEN_MESH`；`c>2`→`NON_MANIFOLD_EDGE`；同一有向边出现 2 次→`INCONSISTENT_WINDING`。
- **自交检测做了**（PHASE 28.6，均匀分箱 + Möller–Trumbore，6 条边双向，邻接排除）；**共面重叠未做**——代码注释与实现不一致（注释说"共面且重叠算自交"，`meshValidation.js:226` 实际 `return false` 保守不报）。文档已记录为 B-2 未做项。
- 候选对超 250 万 → `SELF_INTERSECTION_UNCHECKED`（如实标注"没查完"，不假装查过）。

**"模型本身网格质量差" vs "软件处理失败" 的判据**：前者出 warning 且分析照跑；只有 error 级才等于软件明确拒绝。
程序生成的测试件普遍带缠绕/退化（t01 实测 1400 处缠绕不一致）——**这是测试件的问题，不是软件 bug**，真实 CAD 导出件通常干净。

### 1.6 ⚠️ 本轮最重要发现：真值套件当前 9/20

项目自带一套**独立真值**工程测试集（`tests/engineering-generated/`，20 个模型，GT 由生成器解析公式算出、
明令"禁止依据 V3 结果修改"）。本轮**重跑**，结果与仓库里的旧基线差很多：

| | 检出/期望 | 误报 | Δmax |
|---|---|---|---|
| t01_boss100 | 1/1 ✅ | 0 | 11.6 mm |
| t02_thin10_boss60 | 1/1 ✅ | 0 | 8.7 mm |
| **t03_twoDiff_60_100** | 2/2 ❌ | 2 | — |
| **t04_twoSame_60_60** | 2/2 ❌ | 2 | — |
| **t05_threeSizes** | 3/3 ❌ | 2 | 25.8 mm |
| t06_taperStairs | 3/1 ❌ | 1 | 34.8 mm |
| **t07_eccentric80** | 1/1 ❌ | 1 | — |
| **t08_pipeFlange70** | 2/1 ❌ | 1 | 38 mm |
| t09_boxInner80 | 1/1 ✅ | 0 | 8.1 mm |
| **t10_multiDirBoss** | 3/3 ❌ | 1 | 14.1 mm |
| t11_edgeThick80 | 1/1 ✅ | 0 | 6.7 mm |
| t12_closePair | 2/2 ✅ | 0 | 23.6 mm |
| t13_farPair | 2/2 ✅ | 0 | 22.1 mm |
| t14_taperSeries | 5/5 ✅ | 0 | 20.8 mm |
| t15_weakRamp | 5/4 ❌ | 5 | — |
| t16_extreme_10_100 | 1/1 ✅ | 0 | 5.5 mm |
| t17_weak_30_60 | 1/1 ✅ | 0 | 25.6 mm |
| **t18_multiSizeBoss** | 4/4 ❌ | 1 | 20.7 mm |
| t19_valveLike | 5/4 ❌ | 0 | 30.5 mm |
| t20_combinedBox | 3/4 ❌ | 3 | — |

**PASS 9 / 20**。仓库里 `tests/engineering-generated/summary.json` 写的（且已入库）是 **16 / 20**。

**为什么差这么多——关键事实：那份 summary.json 生成于 2026-08-22 17:44，而引擎文件此后改过：**

| 文件 | 最后修改 |
|---|---|
| `v3/configV3.js` | 08-25 13:43 |
| `v3/sampling.js`、`v3/modulusField.js`、`v3/peakRegion.js` | 08-26 |
| `v3/hotspotV3.js`、`meshValidation.js` | 08-27 |
| `summary.json` | **08-22 17:44（比引擎早 5 天）** |

即：**PHASE 24/26/28.x 的引擎改动之后，这套真值套件一次都没有重跑过**，入库的 16/20 是过期数字。
**失败模式高度一致**：不是"没检出"，而是**检出了但代表点落到了凸台/底板交界处，超出 ±30~40mm 判据**（§1.4 已量化）。

**这不是本轮改动引起的**（本轮 STL 零改动），是一个**一直挂着、没人再跑**的验证缺口。

**本轮未修改核心算法**，改动仅限：
- `designCenter.js` 热结列表文案（见 §1.7）
- `scripts/design_center_test.mjs` 一条断言随之更新

**建议（留给用户裁决，本轮不做）**：
1. **最小**：重跑并存档新基线（`node tests/engineering-generated/run_engineering.mjs`），让入库数字与代码一致；
2. **中等**：把真值判据从"厚区几何中心"改为"厚区内部任一点"（交界处也满足）——先确认工程上认哪个为准；
3. **大**：改代表点算法（质心 → 峰值点或二者加权）——**风险高，会动到 ALR2510 等真实件，不建议本轮动**。

### 1.7 本轮唯一的 STL 改动：热结标签文案（命令文件 §三）

**依据**：三个数字看不懂（`Mc` / `cm³` / `置信`），且 `置信 99%` **容易被读成"99% 概率正确"**——它不是概率。

**改动**（`js/views/designCenter.js` `renderHotspotList`，纯显示层，不动任何计算）：

```
改前：  H1 ｜ Mc 18.2 mm ｜ 112.6 cm³ · 置信 81%
改后：  H1 ｜ 模数 18.2 mm ｜ 区域 112.6 cm³ · 置信度 81%
列表下方新增一行说明：
  模数 = 热结区域的体积/表面积（越大越慢冷）；区域 = 热结体积；
  置信度 = 算法内部评分（模数、显著度、区域占比、多尺度稳定性加权），不是"正确概率"。
```

中英文均已补齐（`en-US.js`）。**未改**：参数区热结勾选列表（那里 `Mc` 紧邻"冒口设计模数 Mc"标签，上下文已明确）、3D 标签（只有 H1/H2 编号，不变）、报告（表格有表头）。

---

## 2. 支持与资源页（已完成）

### 2.1 改了哪些界面

| 文件 | 改动 |
|---|---|
| `js/views/donateView.js` | **重写**（原 47 行 → 新结构） |
| `data/supporters.js` | **新建**（支持者名单数据，当前为空数组） |
| `css/app.css` | 新增 `.sr-*` 一组样式（约 30 行）+ 移动端收敛二维码 |
| `index.html` | 侧栏入口「捐助」→「支持与资源」+ title；关于弹窗正文里的「捐助」字样 |
| `js/i18n/zh-CN.js` | `nav.donate` / `nav.donateTitle` / `about.body` |
| `js/i18n/en-US.js` | 新增 18 条英文词条，`nav.donate` → `Support & Resources` |
| `scripts/browser_test.mjs` | 捐助页断言更新为新页结构 |
| `scripts/design_center_test.mjs` | 热结列表断言随之更新（§1.7） |
| `scripts/qa_sweep.mjs`、`scripts/screenshot.mjs` | **修掉历史遗留**：这两个脚本还在点已被删除的 `#btnDonate` / `#donateModal`（73.txt 改平铺页时就断了，与本轮无关，顺手修好） |

**路由名 `#/donate` 保持不变**（书签、三个测试脚本、`browser_responsive_test` 的页面清单都依赖它）——只改显示名，不改路由。

### 2.2 页面最终结构

```
🤝 支持与资源                                    [✓ 免费开源]
免费工具 · 持续开发中 · 每一份支持都是鼓励
「Casting Toolbox 是一个面向铸造工程师的免费工具，目前持续开发和完善中。如果你认可这个项目，欢迎通过支付宝支持项目继续开发。」

┌── 左栏（二维码为主操作）──┐ ┌── 右栏 ────────────────────┐
│ 💚 支持方式               │ │ 🏷️ 支持者展示               │
│   [支付宝二维码]           │ │  · 单次 100 元及以上 + 主动  │
│   👆 点击可放大            │ │    提供展示信息 + 同意公开   │
│  · 金额随意，量力而行       │ │  · 可展示：姓名/公司/城市/   │
│  · 可在转账备注里写展示信息  │ │    联系方式/简短介绍        │
│  作者：感谢每一天的生活 …   │ │  · 不公开支持金额            │
│                          │ │  ┌ ⚠️ 一个重要说明 ────────┐ │
│                          │ │  │ 不是传统广告位，不承诺首页、│ │
│                          │ │  │ 计算器或其他核心功能区域的  │ │
│                          │ │  │ 广告曝光。               │ │
│                          │ │  └───────────────────────┘ │
│                          │ ├────────────────────────────┤
│                          │ │ 👥 支持者名单               │
│                          │ │  名单暂时为空 —— 第一位支持者 │
│                          │ │  的信息会显示在这里。        │
└──────────────────────────┘ └────────────────────────────┘
```

**设计要点**：左窄右宽——二维码是页面主操作给固定窄栏；名单卡 `flex:1` 吸收右列剩余高度，避免两列留大白。
桌面 1600×1000、手机竖屏 390×844、手机横屏 844×390 三档实测无横向溢出、自动单列。

### 2.3 是否复用现有支持者数据

**原项目根本没有支持者数据结构**（全项目 grep `supporter|支持者|donor` 零命中），因此**新建**了 `data/supporters.js`：

```js
export const SUPPORTERS = [ /* 当前为空 */ ];
// 加人：在数组最前面插一条（新支持者优先）——不需要改任何代码
// 字段：name / company / city / contact / note / since，除 name 外都可留空
// 硬规则写在文件头：100 元及以上 + 主动提供 + 同意公开，三条同时满足；不填未经同意的信息
```

**刻意没有"金额"字段**——不公开支持金额是页面公告的口径，数据结构层面直接不给。
**没有编造任何支持者**：当前诚实显示空态文案。

### 2.4 中英文 / 多端

| 检查 | 结果 |
|---|---|
| 中文页（zh-CN，1600×1000） | ✅ 三块结构齐全，二维码加载，点开放大 + Esc 关闭 |
| 英文页（en-US） | ✅ 正文全英文，**无中文残留**（署名行按既有白名单豁免） |
| 词条覆盖 | ✅ 视图用到的 19 个 key 英文**全部命中**（脚本核对）；静态审计 825 key 全有词条 |
| 手机竖屏 390×844 | ✅ 无横向溢出，单列，二维码收敛到 260px |
| 手机横屏 844×390 | ✅ 无横向溢出 |
| JS 异常 | ✅ 0 |

---

## 3. Windows EXE 圆角图标（已完成，**不影响 Android/Web**）

### 3.1 现状调查

- **图标像素的唯一源头**是 `dist/apk/gen_icons.py`（Edge 无头截图 SVG + PIL 缩放）。它**一次生成三端**：
  Android 5 档 mipmap + 1 张自适应前景 + **Windows 的 `.ico`**。
- Web 端只有 `index.html` 一条 `<link rel="icon" href="favicon.svg">`，**与 .ico 完全解耦**。
- Android 走 `aapt2` 编译 `res/`，`AndroidManifest` 指向 `@mipmap/ic_launcher`，**也引用不到 .ico**。
- `.ico` 由 `build_exe.bat` → `scripts/set_exe_icon.cjs`（rcedit 封装）**烧进 exe 二进制**，且必须在 postject 注入 SEA blob **之前**执行（脚本里记录了实测坑）。
- **`.ico` 原本是"全幅方形"**：`gen_icons.py` 的注释写明"圆角交给系统裁切"（那是为 Android 写的理由）——但 Windows 不会替应用裁圆角，所以 **exe 图标一直是方的**。

### 3.2 做法

在 `gen_icons.py` 里**新增第三个 SVG 模板**（原有两个一字未动）：

```python
# Windows 专用：超椭圆 |x/a|^n + |y/a|^n = 1，全周曲率连续 —— 即 Apple 图标那种
# "自然连续的圆角"，而不是圆弧圆角（圆弧在"直线→圆弧"交接处曲率突变，就是 CSS border-radius 的观感）
WIN_CORNER_N = 5.0
SVG_WIN = 超椭圆底 + 与全幅版完全相同的内容（Cx + 底横条）
```

**n=5 的选取有依据（实测数值，不是拍脑袋）**：

| 形状 | 45° 角点位置（相对半宽归一化） |
|---|---|
| 现有 logo 的圆角矩形 `rx=24/108` | 0.8698 |
| 超椭圆 n=3 | 0.7937（过圆） |
| **超椭圆 n=5** | **0.8706** ← 与现有 logo 圆角大小几乎重合 |
| 超椭圆 n=8 | 0.9170（接近方角） |

即：**圆角大小保持原样，只把曲率接顺**——正好对应"保留 Logo 内容，只增加自然圆润的外轮廓"。

### 3.3 是否影响 Android / Web —— 用 sha256 证明

生成前后逐文件比对：

| 文件 | 结果 |
|---|---|
| `res/mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher.png` | ✅ **6 个文件 sha256 完全一致（逐字节未变）** |
| `res/drawable-nodpi/ic_launcher_fg.png` | ✅ sha256 一致 |
| `res/drawable/ic_launcher_bg.xml`、`mipmap-anydpi-v26/ic_launcher.xml` | ✅ 未触碰 |
| `favicon.svg`（Web + 侧栏 + 源码预览） | ✅ 未触碰 |
| `CastingToolbox.ico` | 已更新（30171 → 39770 B） |

新 `.ico` 结构核验：7 帧齐全（16/24/32/48/64/128/256），各帧四角 alpha=0（透明圆角）、
上边中点 alpha=255（边缘铺满），45° 圆角起始位置在各尺寸下比例一致（≈0.0625）。

### 3.4 是否已接入 EXE 打包流程

**是，链路无需改**：`build_exe.bat:37-41` 本来就取 `dist\apk\CastingToolbox.ico` 交给 rcedit——
我只是把那个 `.ico` 的内容换成了圆角版。下次跑 `build_exe.bat` 即自动带上。

**但要说清楚两点**：
1. **当前已发布的 `CastingToolbox.exe` / `dist/CastingToolbox-v1.0.0-win64/` 里的 exe 仍是方形图标**——
   图标是**烧进二进制**的，必须重新打包才会变。本轮**没有重新打包**（那属于发版动作，且会重跑 npx/postject）。
2. `dist/` 整个目录被 `.gitignore` 忽略，`gen_icons.py` 与 `.ico` **都不在仓库里**。
   新克隆的环境跑 `build_exe.bat` 时 `gen_icons.py` 不存在（错误被 `>nul 2>&1` 吞掉）。
   这是**既有缺口**，本轮按"不要为了图标大改构建系统"的要求**未动**，仅记录。

---

## 4. 验证（全部为实测数字）

```bash
# 分组回归（命令文件指定）
node tests/runner.mjs "model,phase78,phase79,phase715,phase716,phase717,phase72"
→ 51 通过 / 0 失败

# 浏览器验收（命令文件指定 4 支 + 追加 2 支）
node scripts/design_center_test.mjs     → 全部通过
node scripts/browser_test.mjs           → 全部通过 ✅
node scripts/browser_p72_test.mjs       → 全部通过 ✅（PHASE 72 浏览器验收）
node scripts/i18n_audit.mjs             → 扫描 97 文件 / 825 key → 全部有词条 ✅
node scripts/browser_i18n_audit.mjs     → donate 干净（放行 2 处）；12 个核心页全部"干净"；
                                          undefined / NaN 泄漏：无；运行时异常：无 ✅
node scripts/browser_responsive_test.mjs→ 三视口 × 9 页全部无横向溢出；触摸目标达标 ✅

# 本轮新增的一次性验收（脚本在仓库外，未污染项目）
node D:\CDXProject\_v11_donate_check.mjs  → 16 项全过（含中英 + 三视口）
```

**浏览器脚本最初跑出 1 处红**：`phase72_test.mjs` 断言 `nav.donate === 'Donate'`——
这是我们主动改名的预期结果，已同步更新为 `'Support & Resources'`。**更新的是"旧名字的契约"，不是放宽断言。**

---

## 5. 未做 / 待用户裁决

| # | 事项 | 说明 |
|---|---|---|
| 1 | **真值套件 9/20 的处置**（§1.6） | 三个方案（重跑存档 / 改判据 / 改算法），需要工程判断，**本轮未动** |
| 2 | 代表点偏低是否要改 | 交界处物理上就是最后凝固处，"偏低"未必是错——**需用户定性** |
| 3 | 重打 exe / APK 带新图标 | 属于发版动作，等 V1.1 节点 |
| 4 | `npm run validate` 跑不起来 | `data/tags.js` 缺 `export const TAG_PREFIXES`（上一轮已报告，仍未修） |
| 5 | 共面重叠自交未检测 | 代码注释与实现不一致（§1.5），已记录为 B-2 |
| 6 | 英文界面残留中文 1222 处 | v1.1 头号工作，本轮只覆盖了新页面 |
| 7 | 工艺检验中心 | 命令文件 §八 明确本阶段不做 |

---

## 6. 本轮产生的临时文件（仓库外，不入库）

- `D:\CDXProject\_v11_stl_probe.mjs` / `_v11_pos_probe.mjs` / `_v11_ui_probe.mjs` / `_v11_donate_check.mjs` / `_v11_icon_preview.py`
- `D:\CDXProject\_v11_shots\`（截图与图标对比图）
- `D:\CDXProject\_v11_summary_BEFORE_2026-08-22.json`（重跑前的旧真值汇总，**备份**）
- `D:\CDXProject\_v11_icon_before\`（换图标前的 .ico 与 6 张 Android PNG 备份）

⚠️ **需要交代的一处操作**：重跑真值套件时，`tests/engineering-generated/models/*/result.json` 被覆盖
（这是该 runner 的正常输出，且 20 个 result.json **本来就不入库**）。旧汇总 `summary.json` 已备份到上面第 3 项。
