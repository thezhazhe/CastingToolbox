# 真实 STL 最小测试集（命令 10.txt 第四节）

每个 STL 保存：
- 原始 STL：`*.stl`
- 诊断 JSON：`<name>_diag.json`（由 run_real_stl.mjs 生成）
- 热结结果 + 厚度统计：随诊断 JSON 一并保存
- 人工标注：`<name>.md`（实际尺寸/壁厚/期望热结——用户提供）

## 覆盖要求（至少 5 类）

| 类别 | 文件名建议 | 说明 |
|---|---|---|
| 1. 普通均匀壁厚铸件 ~20mm | `uniform20.stl` | 壁厚约 20mm 均匀件 |
| 2. ~20mm 壁厚复杂铸件 | `complex20.stl` | 多特征/多厚度 |
| 3. ~100mm 圆柱/圆环结构 | `cyl100_ring.stl` | 厚圆柱/厚环 |
| 4. 明显厚薄变化普通铸件 | `thickThin.stl` | 厚区+薄区 |
| 5. 较大真实铸件 | `large_part.stl` | bbox 500mm+ |

## 用法

```bash
# 生成 STL（ASCII 或 Binary 均可，放入本目录）
# 运行诊断（自动处理目录内所有 *.stl）：
node tests/real-stl/run_real_stl.mjs
```

## 人工标注模板（<name>.md）

```markdown
# <name>
- 实际尺寸（用户）：X×Y×Z mm
- 单位：mm（默认假设）
- 实际壁厚：约 XX mm（厚区 XX / 薄区 XX）
- 期望：检出 N 个热结 @ 位置
- 实际表现（用户描述）：……
```

## 当前状态

（等待用户提供 STL——见根因诊断报告）
