# PHASE 98 报告 · CastingToolbox V1.1 发布

> 98.txt。范围严格限定为**两项修改**（新增「坎贝勒推荐」预设 + 左下角 Support/Resources 调整），
> 之后定向测试 → 完整回归 → Windows EXE 打包 → GitHub V1.1 发布。
> **原则：小改动、小验证、小步提交。不借发布机会扩大项目范围。**

---

## 0. 一句话

新增了一条**纯数据**的浇注比例预设 `坎贝勒推荐 = 1:1:4`（`runGating` / `calc_v` / `V_LIMIT` 一行未改），
左下角把版本升到 V1.1、加了微信公众号、把作者行放大加粗；
**全量 664 通过 / 0 失败**、`js/engine/**` 7/7 指纹零改动、Windows EXE 打出并跑通、GitHub V1.1 已发布。

---

## 1. 本次实际修改了哪些文件（13 个）

| 文件 | 改了什么 | 性质 |
|---|---|---|
| `calcs/gating.js` | `RATIO_PRESETS` **新增一条** `'坎贝勒推荐': { type:'开放', r:[1,1,4], note:'阻流在直浇道' }` | ★ 主改动，纯数据 |
| `js/views/gatingView.js` | `RATIO_APPLIC` 增加该预设的一句话适用范围（ⓘ 弹窗用） | 同源补全 |
| `js/i18n/en-US.js` | 3 条新词条（`坎贝勒推荐` / 适用说明 / `app.wechat`）+ 版本号 | i18n |
| `js/i18n/zh-CN.js` | `app.wechat` 基准 + 版本号 | i18n |
| `index.html` | 侧栏/关于弹窗版本 → `v1.1.0`；新增公众号行；作者行挂 `sf-author` | ★ 主改动 |
| `css/app.css` | 新增 `.sf-author` 一条规则 | ★ 主改动 |
| `js/version.js` | `VERSION` `1.0.0` → `1.1.0` | 版本 |
| `package.json` | 同上 | 版本 |
| `build_exe.bat` | EXE 元数据版本 `1.1.0`（**并恢复 CRLF 行尾**，见 §6.2） | 版本 |
| `dist/apk/project/AndroidManifest.xml` | `versionName` 1.1.0 · `versionCode` 3→4（`dist/` 不入库，仅本地一致） | 版本 |
| `README.md` | Windows 下载文件名 → `CastingToolbox-v1.1.0-win64.zip` | 发布一致性 |
| `scripts/browser_p78_test.mjs` | 预设计数断言 7→8 + 增加「含坎贝勒推荐」断言 | 见 §4.2 |
| `tests/phase98_test.mjs` | **新建**，11 条定向测试 | 新增 |

**没碰**：`js/engine/**`（7/7 指纹吻合）、Hotspot V3、PHASE 97 的连接面定向算法、`calcs/campbellGating.js`、
既有浇注公式、`MATERIALS`、冒口、STL 核心、UI/i18n 架构、其他 6 档预设。

---

## 2. 「坎贝勒推荐」是否成功加入 —— 是

**先找到真实数据来源与调用链（98.txt §一 要求），再动手**：

```
calcs/gating.js  RATIO_PRESETS（唯一数据源，6 条）
   ├─→ js/views/gatingView.js  #g_ratio 下拉   ← Object.keys(RATIO_PRESETS) 生成，非硬编码清单
   ├─→ js/views/designCenter.js #dc_m_ratio3   ← 同上，一份数据两处消费
   └─→ runGating(input.ratioKey) → rd.r = [s_r, r_r, g_r]
```

**因此只加一条配置就够**（98.txt §一.10「尽量复用现有数据结构和 UI」）——两处下拉**自动同源**，
不存在需要同步修改的第二份清单。测试 98-K 直接断言这一点。

- 名称：**坎贝勒推荐**（98.txt §一.2）
- 比例：**S直 : S横 : S内 = 1 : 1 : 4**（98.txt §一.3）
- 字段结构与既有预设**逐字同构**（`type` / `r` / `note`），测试 98-B 比对字段集合
- **不新增第二套计算逻辑**：`campbellGating.js`（PHASE 65.1 的方法隔离模块）与 `RATIO_PRESETS` 无耦合，
  测试 98-K 断言 `campbellGating.js` 里不出现 `RATIO_PRESETS`

### 2.1 `type` 为什么取「开放」（**这是我做的工程判断，请复核**）

`type` 是既有数据结构里的字段，被 `runGating` 用来取 R7 审核上限（`V_LIMIT = {封闭:1.5, 开放:1.0}`），
所以必须给一个值。取「开放」的依据：

- 既有约定：**封闭 = 阻流在内浇口**（r 形如 `1 : 2.0 : 0.85`，内浇口最小）；**开放 = 阻流在直浇道**
- 本预设 `1 : 1 : 4` 的**内浇口是三者中最大的**，阻流不可能落在内浇口 → 只能是「开放」
- 实测旁证：结果区自动打出「**系统类型：开放式/非加压式特征：直浇道为阻流截面**」「**阻流位置：直浇道**」

> 若你认为 Campbell 这套应归到「封闭」，改 `calcs/gating.js` 里的一个词即可（`'开放'`→`'封闭'`），
> 无需动其他任何地方。

### 2.2 `note` 取「阻流在直浇道」

复用既有词条（`en-US.js` 已有 `'阻流在直浇道': 'choke at the sprue'`），**零新增 i18n**。
Campbell 自然加压系统本就是「直浇道做阻流、内浇口做大以降低充型速度」，与该 note 一致。

---

## 3. 1:1:4 是否能够正常参与计算 —— 能

### 3.1 面积分配（走的是既有逻辑，未修改）

`runGating` 按 `min_r` 归一分配。`min_r = 1`：

| 项 | 值 | 说明 |
|---|---|---|
| `A`（奥赞阻流面积） | 414.7 mm² | 只与材质/重量/壁厚/方向有关 |
| `A_sp`（直浇道参考） | 414.7 = A | |
| `A_run`（横浇道参考） | 414.7 = A | |
| `A_gt`（内浇口参考） | 1658.7 = **4A** | |
| `cp`（阻流口判定） | **直浇道** | 既有 `cp` 逻辑，未改 |

### 3.2 浏览器端到端实测（灰铁 46.8kg / 顶注，示例默认值）

```
浇注比例预设：坎贝勒推荐（S直:S横:S内 = 1:1:4）      ← 下拉显示
坎贝勒推荐 · S直:S横:S内 = 1:1:4 · Campbell 自然加压思路…（阻流在直浇道）   ← 下方说明行

核心数据：总浇注重量 124.8 kg ｜ 浇注时间 26.96 s ｜ 平均压头 Hp 246 mm ｜ 阻流面积 A_choke 377 mm²
         阻流位置 直浇道 ｜ 系统类型 开放式/非加压式特征：直浇道为阻流截面
横截面积 · 按比例 1:1:4 分配（参考，mm²）：S直 377 ｜ S横 377 ｜ S内 1508
校核：内浇口平均速度 0.401 m/s 🟢 正常     ← 内浇口做大 → 速度低 → 平稳充型，正是 Campbell 的意图
实际比例 S直:S横:S内 1:1.32:4.34，目标 1:1.00:4.00
```

> 「实际比例」与「目标 1:1:4」略有出入是**既有行为**：内浇口长度按 5mm 向上取整（`ceil`，PHASE 49 定的
> 「宁大勿小」），回算后实际比值自然会偏。不是本次引入的问题。

### 3.3 无值异常（98.txt §四 E）

5 材质 × 3 浇注方向 × optimize 开关 = **30 组组合**，**NaN / undefined：0**。
`null` 只有 3 条（`boundaryNote` / `vTargetLo` / `optChokeMigrated`），且
**新预设的 null 路径 ⊆ 既有预设的 null 路径**（测试 98-E 直接对比集合）——
即新预设**没有引入任何新空值**，这 3 条是项目原有的「不适用」语义标记。

---

## 4. 左下角 V1.1 / 微信公众号 / 文字加粗放大 —— 已完成

侧栏底部现在是（浏览器实测原文）：

```
v1.1.0 · 完全离线 · 数据本地          ← ① 版本
🧑‍💻 作者：感谢每一天的生活            ← ③ 放大加粗（.78rem / 600）
📮 320451242@QQ.COM
📮 THEZHAZHE@gmail.com
💬 QQ 交流群：1106396422
📱 微信公众号：铸造工具箱              ← ② 新增，与 QQ 群并列
💚 免费开源（MIT）· 永久免费
```

### 4.1 ★ 关于「这节数」—— 我停下来问了你

98.txt §二.3 说「这节数」可能是「支持人数」「捐助人数」，「以代码中的实际内容为准」。
**代码里这块区域没有任何「人数」**：全库搜 `人数 / 捐助人 / 已支持 / 支持数` **零命中**；
全应用唯一的「人数」是**支持与资源页**「👥 支持者名单」标题右侧那个 `共 1 位`（不在左下角）。

所以我把左下角 6 行原文列出来问了你，你的选择是 **`🧑💻 作者：感谢每一天的生活`**。

**处置**：只加一个 `.sf-author` 类，字号 `.68rem → .78rem`、字重 `600`、颜色 `muted → secondary`。
**没有**给 `.sf-line` 加整体样式（那会波及其余 5 行），**没有**上大标题/背景色。测试 98-J 守住这三点。

### 4.2 版本号：显示为 **v1.1.0**（不是 v1.1）—— 请你确认

你写的是「V1.0.0 → V1.1」。我落成 **`1.1.0` / 显示 `v1.1.0`**，理由是项目既有硬约束：

- `tests/phase73_test.mjs` 断言 `/^\d+\.\d+\.\d+$/.test(VERSION)` —— 写 `1.1` 会**直接让测试失败**
- `VERSION_LABEL === 'v' + VERSION` 同一条测试守着
- 98.txt §八：「如果项目之前已有 Release 命名、Tag 命名和 EXE 文件命名规则，**请严格沿用**」
  —— 上一版是 `v1.0.0` / `CastingToolbox-v1.0.0-win64.zip`，故本版 `v1.1.0` / `CastingToolbox-v1.1.0-win64.zip`

**七处同源**（测试 98-H 逐个断言，并断言无 `1.0.0` 残留）：
`js/version.js` · `index.html` 侧栏静态 · `index.html` 关于弹窗 · `zh-CN.js` · `en-US.js` · `package.json` · `AndroidManifest.xml` · `build_exe.bat`

> 若你要的就是字面「v1.1」，说一声——改 `js/version.js` 一处 + 放开那条正则即可，但我**不建议**（会与包名/标签命名体系打架）。

### 4.3 微信公众号

- 位置：**左下角，与 QQ 群并列**（你选的方案）
- 文案：`📱 微信公众号：铸造工具箱`
- 英文界面：`📱 WeChat official account: Casting Toolbox · 铸造工具箱`
  —— **公众号名保留中文原名**：微信里就是按「铸造工具箱」搜，翻成英文反而搜不到。
  该写法复用了 72-T5 白名单里已有的 `'Casting Toolbox · 铸造工具箱'`，**零测试改动**。

### 4.4 响应式

移动端（390×844）实测：`.sidebar-foot` 仍是 `display:none`（**既有响应式逻辑，未新增可见性**）、
无横向溢出、浇注比例下拉含新预设且无 NaN。

---

## 5. 完整测试 PASS / FAIL 数量

| 项 | 命令 | 结果 |
|---|---|---|
| 定向（PHASE 98） | `node tests/runner.mjs phase98` | **11 通过 / 0 失败** |
| 定向（i18n 相关） | `node tests/runner.mjs "phase72,phase98"` | **23 通过 / 0 失败** |
| **Level 3 全量** | `node tests/runner.mjs` | **664 通过 / 0 失败** |
| 浏览器 · 全站冒烟 | `scripts/browser_test.mjs` | 174 断言 全通过 |
| 浏览器 · 工艺检测中心 | `scripts/browser_inspection_test.mjs` | 132 断言 全通过 |
| 浏览器 · 设计中心 | `scripts/design_center_test.mjs` | 62 断言 全通过 |
| 浏览器 · 双语 | `scripts/browser_p72_test.mjs` | 41 断言 全通过 |
| 浏览器 · 显示层 | `scripts/browser_p78_test.mjs` | 49 断言 全通过 |
| 数据校验 | `node scripts/validate_data.mjs` | OK · 164 知识（6 条警告待复核，既有） |
| 静态交叉引用 | `node scripts/qa_static.mjs` | OK · 172 数据 · 15 工具 |
| i18n 覆盖率 | `node scripts/i18n_audit.mjs` | ✅ 1013 个 key 全有词条 |
| **`js/engine/**` 指纹** | sha256 逐个核对 | **7/7 吻合（零改动）** |

**基线对账**：PHASE 97 全量 **653**，本次新增 phase98 的 **11** 条 → `653 + 11 = 664` ✓ 数目精确吻合。

### 5.1 ⚠ 一条既有的性能未达标（**与本次无关，我没修**）

`tests/hotspot_v2_test.mjs`（**独立脚本，不导出 `tests`，runner 对它计分恒为 0**）单独跑：

```
结果：40 通过 / 2 失败
  ✗ large thin shell:        性能 < 8s — 11578ms
  ✗ large thin + local thick: 性能 < 8s —  9089ms
```

**归因证据**：该脚本只 `import` 三个文件 —— `js/engine/stl.js`、`js/engine/mesh3d.js`、`js/engine/hotspot.js`，
**本次一个都没碰**，也不经 `calcs/gating.js` / i18n / version。交接书 §4 已把它记为既有项
（当时实测 9.0~9.9s，今日 9.1~11.6s，属同机波动）。**建议单独立项。**

### 5.2 我改过的一条历史断言（逐条说明理由）

| 断言 | 改动 | 理由 |
|---|---|---|
| `browser_p78_test.mjs`「B 比例可选 6 档预设 + 自动推荐」`ratioOpts.length === 7` | → `=== 8`，标题同步改「7 档预设」，并**追加** `ratioOpts.some(o => o.includes('坎贝勒推荐'))` | 设计中心 `#dc_m_ratio3` 与浇注系统下拉**同源**（都取 `Object.keys(RATIO_PRESETS)`），预设 6→7 必然使该下拉 7→8 项。**仍是精确计数，未放宽**，且新增了一条更强的断言 |

**除此之外 0 条历史断言被改动**，其余全部为新增。

---

## 6. 是否有 Bug 被修复 —— 有 1 个（我自己引入并已修）+ 1 个环境问题

### 6.1 我引入的：i18n 英文覆盖失败（已修）

初版把英文写成 `'📱 WeChat official account: 铸造工具箱'` → `phase72_test.mjs :: 72-T5 英文词条不含未翻译中文` **失败**。
**修法**：改成中英并列 `'… Casting Toolbox · 铸造工具箱'`，命中 72-T5 白名单里已有的词条，
**不改测试、不放宽白名单**（见 §4.3）。

### 6.2 ★ 环境问题：`build_exe.bat` 行尾 + 本机 `sed` 会吃掉 CR

**现象**：第一次跑 `build_exe.bat` 报一堆 `'amFilesProgramFiles' / 'rimental-sea-config' 不是内部或外部命令`，
随后 postject 报 `Resource with that name already exists: NODE_SEA_BLOB`。

**根因**：
1. `build_exe.bat` 当时是 **LF-only 行尾**，而 **cmd.exe 解析不了 LF 行尾的多行 `if (...)` / `for … do (` 块**
   —— 行被拆碎、复制 node.exe 那步没跑，于是 postject 撞上旧 EXE 里已有的 blob。
2. 追查中发现：**本机 `sed -i` 会把 CRLF 变成 LF**（实测 `a\r\nb\r\n` → `A\nb\n`）。
   我在 §4.2 版本号批改时对 `build_exe.bat` 用过 `sed -i` —— **这一步很可能就是它变 LF 的原因**。
   （项目行尾本来就是**混的**：`start.bat` / `css/app.css` / `js/views/gatingView.js` 是 CRLF，
   `serve.js` / `index.html` / `calcs/gating.js` 是 LF，不是我一个人造成的。）

**修法**：把 `build_exe.bat` 恢复成 CRLF（**只动行尾，内容只有版本号那一处改动**）。
由于 `core.autocrlf=true` 在提交时会把 CRLF 归一成 LF，**入库的 blob 与改动前完全一致**——
也就是说这次行尾修复**对仓库内容零影响**，只影响本机能不能用 cmd 跑这个 bat。

**教训（值得记住）**：这个项目里**改 `.bat` / 任何给 cmd 用的文件，不要用 `sed -i`**，用编辑工具。

### 6.3 未修、仅记录（98.txt §三：与本次无关的不要顺手重构）

- `build_exe.bat` 是 **UTF-8 但开头 `chcp 936`**，中文注释在 GBK 控制台下会花屏，并多打一行无害的错误提示
  （构建 exit 0 不受影响）。
- `PRODUCT_HUNT_LAUNCH.md` 里仍写 v1.0.0 —— 那是 **v1.0.0 那次 Product Hunt 提交的历史记录**，
  按 98.txt §七.6（不要删除旧版本正式文件）**故意不改**。
- `_edge_p93inspect/` 等 Edge profile 残留目录（已被 `.gitignore` 的 `_edge_*/` 覆盖，未入库）。

---

## 7. Windows EXE 是否成功生成 —— 是

沿用既有正式方式（**没有自创流程**）：

```
cmd /c build_exe.bat          ← SEA：node.exe → 图标 + 版本元数据 → postject 注入 blob
node scripts/pack_win.mjs     ← 显式文件清单 → 文件夹 + zip
```

- `💉 Injection done!` / `[set_exe_icon] 图标/版本设置成功` / `Build OK` / **exit 0**
- 元数据核对：`FileVersion=1.1.0.0` · `ProductVersion=1.1.0` · `ProductName=Casting Toolbox` **✓ 版本号为 V1.1**
- **基本运行验证**：启动 EXE → `http://localhost:8090/` 返回 **HTTP 200**，
  服务出来的 `index.html` 里 `id="appVersion">v1.1.0`、
  `data-i18n="app.wechat">📱 微信公众号：铸造工具箱`、
  服务出来的 `calcs/gating.js` 里含 `坎贝勒推荐`，`js/engine/**` 全部 200 → 验证后已关闭进程

### 7.1 EXE 文件的实际路径和文件名

| 项 | 路径 | 大小 |
|---|---|---|
| 便携目录 | `D:\CDXProject\CCproject\CastingToolbox\dist\CastingToolbox-v1.1.0-win64\` | 11 个条目 |
| **发布 zip** | **`D:\CDXProject\CCproject\CastingToolbox\dist\CastingToolbox-v1.1.0-win64.zip`** | **35,823,832 B（34.2 MB）** |
| 裸 EXE | `D:\CDXProject\CCproject\CastingToolbox\CastingToolbox.exe` | 92,466,176 B |

### 7.2 未混入测试/临时文件（98.txt §七.7）

zip 实际内容：**292 个条目**，顶层只有 `assets/ calcs/ css/ data/ js/ vendor/` +
`CastingToolbox.exe` `index.html` `favicon.svg` `LICENSE` `README.md`。
脚本化检查 `tests/ | scripts/ | _p98 | _edge_ | node_modules | *.log | screenshot`
→ **命中 0 个**。

**旧版本文件未删除**：`dist/` 下 `CastingToolbox-v1.0.0-win64.zip`、`v1.0.0.apk`、`v0.16`、`v0.15` 原样保留。
**未生成 APK**（98.txt §七：本次只打 Windows）。

---

## 8. 已知问题 / 需要你关注什么

### 8.1 两条仍待你裁决的（沿用前几阶段，本阶段未动）

1. **「有效截面积」口径**：现为「沿自身主轴、中段 20%~80% 的**中位截面**」，另一种合理口径是**最小截面（阻流截面）**
   （改 `sectionProfile` 的 `rep` → `min` 一行常量）。
2. **「一模几件」输入**：目前产品件数 = STL 连通分量数（89.txt §二）。

### 8.2 PHASE 97 遗留（本阶段未动）

**项目里仍然没有任何真实浇注系统 STL**，连接面定向只有程序生成几何验证过；
`CONN_TOL_ABS = 2.0mm` 需要真件校准。**这是下一步最该做的事。**

### 8.3 本阶段新引入的、需要你复核的判断

1. **`坎贝勒推荐` 的 `type = '开放'`**（§2.1）—— 影响 R7 审核上限取 1.0 还是 1.5 m/s。
2. **版本显示为 `v1.1.0` 而非字面 `v1.1`**（§4.2）。

### 8.4 其他（既有，未动）

- 术语三写并存（热节 / 热结 / 热点）
- `large thin` 性能 9~12s > 8s（§5.1，独立未计分脚本）
- 英文覆盖缺口（动态 key 需手工登记）

---

## 9. Git commit 与 GitHub V1.1 发布结果

### 9.1 commit

```
07001b3  release: CastingToolbox v1.1.0 —— 工艺检测中心 + 浇注系统检测 + 坎贝勒推荐预设
         73 个文件（44 新增 / 29 修改，+24993 / −282）
```

这一次提交把 `ce7e87b` 之后积压的 **PHASE 83~98 全部入库**（此前一直是 untracked/modified，
一次 `git clean` 就会全丢）。提交前逐项核对：无 `_p98_*` / `_edge_*` / `screenshots/` / `dist/` /
`*.exe` / `node_modules` 混入（脚本化 grep 命中 0）。

### 9.2 推送（走 API 通道）

`github.com` 的 git 传输在本机被阻断，沿用既有 `scripts/publish_via_api.mjs`：

```
远端 main  d517fe00 → 8c883f3562fd3c490fe4134449dd83b88a1e389c
需上传 73 个 / 删除 0 个      ← 与本地 commit 的文件数精确吻合
```

（按 98.txt §八 的禁令：**全程未执行** `git clean -fd` / `git reset --hard` / 任何删除未跟踪文件的命令。）

### 9.3 Release

| 项 | 值 |
|---|---|
| Tag | `v1.1.0`（指向 `8c883f3`） |
| 标题 | `Casting Toolbox v1.1.0 · 工艺检测中心 + 内浇口连接面定向 + 坎贝勒推荐预设` |
| URL | https://github.com/thezhazhe/CastingToolbox/releases/tag/v1.1.0 |
| 状态 | **Latest** · 非草稿 · 非预发布 |
| 附件 | `CastingToolbox-v1.1.0-win64.zip` · 34.1 MB · state=`uploaded` |

命名与正文结构**逐项沿用 v1.0.0**（标题句式 / 中英双语 / Highlights / Reliability / Downloads 表 / Notes / 作者署名），
未自创格式。**本次未附 APK**（98.txt §七：只打 Windows），正文里已如实写明。

### 9.4 线上验证（实测）

| 检查 | 结果 |
|---|---|
| 下载链接 | `…/releases/download/v1.1.0/CastingToolbox-v1.1.0-win64.zip` → 302 → **200**，`Content-Length: 35823832`（与本地 zip 逐字节同尺寸） |
| 仓库 main `js/version.js` | `export const VERSION = '1.1.0'` ✓ |
| 仓库 main `calcs/gating.js` | 含 `坎贝勒推荐` ✓ |
| **GitHub Pages**（自动重建） | `https://thezhazhe.github.io/CastingToolbox/` 已是 `v1.1.0`，且 `index.html` 含 `data-i18n="app.wechat">📱 微信公众号：铸造工具箱`、`calcs/gating.js` 含 `坎贝勒推荐` ✓ |
| v1.0.0 及更早产物 | **未删除**，`dist/` 下 v0.15 / v0.16 / v1.0.0 原样保留 ✓ |

> GitHub Pages 为 legacy 构建器（源 = main 分支根目录），重建是自动的；本次重建已在数分钟内完成。
