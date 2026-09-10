# 测试夹具说明（哪些不入库、怎么补）

本仓库**不包含**下列两类测试夹具，这不是漏打包，是刻意的：

| 类别 | 文件 | 为什么不入库 |
|---|---|---|
| 程序生成的大件 STL | `tests/golden/largeThin.stl`(168MB) · `largeThinThick.stl`(141MB) · `thinShell.stl` · `adjacentSplit.stl` · `hollowThickRing.stl` · `mildThick.stl` · `adjacentMerge.stl` · `lShape.stl` · `twoThick.stl` · `thickOnThin.stl` · `longBar.stl` | 合计 1.4GB，单件超过 GitHub 单文件 100MB 硬上限；而且它们是**程序生成物**，可一条命令再生 |
| 真实产品模具模型 | `tests/real-stl/ALR2510*.stl` · `ALHR4510*.stl` · `HR4012*.stl` | 作者真实产品的几何，不适合公开 |
| 工程级生成模型 | `tests/engineering-generated/models/` · `phase15/data/`（858MB） | 同样是程序生成物（`gen_engineering.mjs`），体积过大 |

**行为**：缺失时，引用到它们的测试文件会被 `tests/runner.mjs` **跳过（不是失败）**，
输出一行 `⏭ … 跳过（缺 N 个夹具）`，汇总行会注明跳过数量。其余测试照常运行。

**补回来**：

```bash
node scripts/gen_v2_golden.mjs                          # 重新生成 tests/golden 下的全部大件（确定性）
node tests/engineering-generated/gen_engineering.mjs    # 重新生成工程级模型（models/ 与 phase15/data/）
# 真实件模型：把你自己的 STL 放进 tests/real-stl/，文件名对齐引用即可
node tests/runner.mjs                   # 再跑一次，跳过的文件会自动恢复执行
```

`tests/golden` 里的小件（`cube50.stl` / `plate20.stl` / `cylinder100.stl` / `tube_wall10.stl`，合计 <0.2MB）
**是入库的**，所以大部分测试开箱即可运行。
