# Engineering Truth Suite · 当前代码基线

> 这个文件存在的唯一目的：**防止再有人引用过期的通过率。**
> 数据文件 `summary.json` 是一份**快照**，不带出处，离开这个文件无法判断它属于哪个版本的代码。

```
Current algorithm baseline: 9/20          ← Legacy score（旧判定体系，历史指标）
```

## PHASE 85 起：两层基线

判定体系在 PHASE 85 被拆成两层，**legacy 逐字保留、诊断层新增**。两层都读同一份 V3 输出。

| 层 | 指标 | 分母 | 值 |
|---|---|---|---|
| **legacy** | Legacy score | 20 模型 | **9** |
| 诊断 | Peak detection（必检厚区都有峰点落进去） | 20 模型 | **19** |
| 诊断 | Peak accuracy（必检热点的峰点都在容差内） | 20 模型 | **14** |
| 诊断 | Zone detection（必检厚区都有代表点落进去） | 20 模型 | **14** |
| 诊断 | Representative accuracy（峰+代表都达标） | 20 模型 | **7** |
| 诊断 | Peak within tolerance | 47 热点 | **38** |
| 诊断 | Representative within tolerance | 47 热点 | **28** |
| 诊断 | Representative-drift（峰点对、代表点漂） | 47 热点 | **15** |
| 诊断 | In-zone-but-offset | 47 热点 | **7** |
| 诊断 | Unexpected / outside-zone | 47 热点 | **2** |

**一句话**：算法**找到**热点没问题（19/20），**摆位置**是短板（7/20）。
详见 `docs/PHASE85_REPORT.md` 与 `docs/PHASE84_REPORT.md`。

⚠️ `expectedHotspots` 在 PHASE 85 被修正过（t19 的 stub/midRing 移入 `optionalHotspots`）。
legacy 判定读的是 `expected.json` 里**冻结的** `legacy.expectedHotspots`，所以 9/20 仍可复现。
**不要删掉那个 legacy 块**，删了 legacy 基线就断了。

## 基线的完整出处

| 项 | 值 |
|---|---|
| 执行时间 | **2026-09-23**（PHASE 84 审计建立；PHASE 85 复现并扩展为两层）；**2026-09-29 PHASE 95 复跑一次，结果不变（9/20，通过的 9 个逐项吻合），主运行 43.1 s** |
| 执行命令 | `node tests/engineering-generated/run_engineering.mjs` |
| GT 修订 | PHASE 85：`gtRevision: 2`（ring 补 `axis`；t19 拆 optional；t06 厚区 centerMm 修正） |
| metadata 重生成 | `node tests/engineering-generated/gen_engineering.mjs --meta-only`（**不碰 model.stl**） |
| 测试环境 | Windows 11 · Node **v24.18.0** · 本机 |
| 代码版本 | git HEAD **`ce7e87b`**（2026-09-22 21:00），`js/engine/` **工作区干净、零改动** |
| 引擎文件指纹 | hotspotV3 `d774532a` · peakRegion `b8d3ab9e` · sampling `5957831c` · modulusField `ad80da9d` · configV3 `80a763ef` · meshValidation `5af64ae4` · v3ViewAdapter `1e3d96cc`（sha256 前 8 位） |
| 测试夹具 | `models/*/model.stl` 生成于 **2026-08-22 17:35**（生成器 `gen_engineering.mjs`，此后未改） |
| 运行时间 | 20 个模型主运行合计 **68.5 s**；含变体约 **93 s** |
| 结果 | **PASS 9 / 20**（`✅ t01 t02 t09 t11 t12 t13 t14 t16 t17`） |

## ⚠️ 旧数字的处置

`summary.json` 在同一目录下曾长期保存 **16/20**。那份是 **2026-08-22 17:44** 生成的，
而引擎在 **2026-08-25 ~ 08-27** 有改动（`configV3` / `sampling` / `modulusField` / `peakRegion` /
`hotspotV3` / `meshValidation` 全部改过），**改完之后这套套件一次都没有重跑**。

**结论：旧 summary 与当前代码不一致，旧结果不可作为当前代码基线。**
这不构成"算法退化"的判定依据——两者不是同一次测量的对比。

## 失败清单（当前基线）

| 模型 | 检出 | 漏检 | 误报 | Δmax |
|---|---|---|---|---|
| t03_twoDiff_60_100 | 2/2 | A60, B100 | 2 | — |
| t04_twoSame_60_60 | 2/2 | A60, B60 | 2 | — |
| t05_threeSizes | 3/3 | B60, B100 | 2 | 25.8 |
| t06_taperStairs | 2/1 | — | 1 | 34.8 |
| t07_eccentric80 | 1/1 | ecc80 | 1 | — |
| t08_pipeFlange70 | 2/1 | — | 1 | 38.0 |
| t10_multiDirBoss | 3/3 | xSide | 1 | 14.1 |
| t15_weakRamp | 5/4 | S40,S35,S30,S25 | 5 | — |
| t18_multiSizeBoss | 4/4 | B3_60x60x40 | 1 | 20.7 |
| t19_valveLike | 5/4 | stub, midRing | 0 | 30.5 |
| t20_combinedBox | 3/4 | inner80, basePad40, sideBoss, topFlange | 3 | — |

失败分类与根因见 `docs/PHASE84_REPORT.md`。

## 怎么重新生成

```bash
node tests/engineering-generated/run_engineering.mjs     # 覆盖 models/*/result.json 与 summary.json
```

跑完请**顺手更新本文件的出处表**（时间 / commit / 引擎 sha / 结果）——否则又会产生一份没有出处的数字。
