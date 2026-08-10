# -*- coding: utf-8 -*-
"""解析全部配料单 xlsx，按指纹去重，输出结构化 JSON + 审阅文本
输出: _extract/_read/batching_recipes.json / batching_curated.txt
"""
import json, re
from pathlib import Path
import openpyxl

SRC = Path(r"D:\CCproject\CastingToolbox\_extract\配料单")
OUT_JSON = Path(r"D:\CCproject\CastingToolbox\_extract\_read\batching_recipes.json")
OUT_TXT = Path(r"D:\CCproject\CastingToolbox\_extract\_read\batching_curated.txt")

def cell_grid(ws):
    """非空单元格表 {coord: value}"""
    d = {}
    for row in ws.iter_rows():
        for c in row:
            if c.value is not None and str(c.value).strip():
                d[c.coordinate] = str(c.value).strip()
    return d

def extract_sheet(ws):
    g = cell_grid(ws)
    if not g:
        return None
    title = g.get("A1", "")
    grade = g.get("C2", "")  # 材质列通常在 C2
    # 化学成份表头行（含 碳/硅/锰 的行）与目标值行
    comp = {}
    target_row = None
    for coord, v in g.items():
        if "化学成分" in v or (coord.startswith("E") and ("碳" in v or "碳当量" in v)):
            pass
    # 找"目标值"所在行
    for coord, v in g.items():
        if v in ("目标值", "炉前成分"):
            row = re.match(r"([A-Z]+)(\d+)", coord)
            if row:
                target_row = int(row.group(2))
                break
    if target_row:
        comp_cols = {}
        # 表头行通常为 target_row-1
        for coord, v in g.items():
            m = re.match(r"([A-Z]+)(\d+)", coord)
            if not m:
                continue
            col, row = m.group(1), int(m.group(2))
            if row == target_row - 1 and len(v) <= 4 and v in ("碳", "硅", "锰", "磷", "硫", "锑", "镁", "钼", "铬", "铜", "碳当量"):
                comp_cols[col] = v
        for col, name in comp_cols.items():
            val = g.get(f"{col}{target_row}")
            if val:
                comp[name] = val
    # 炉料配比
    charge = {}
    for coord, v in g.items():
        m = re.match(r"([A-Z]+)(\d+)", coord)
        if not m:
            continue
        col, row = m.group(1), int(m.group(2))
        if v in ("废钢", "回炉料", "生铁", "钢屑") and g.get(f"C{row}"):
            charge[v] = g[f"C{row}"]
    # 温度
    temps = {}
    for label in ("出铁温度", "浇注温度", "硬度规格", "硬度目标"):
        for coord, v in g.items():
            if v == label:
                m = re.match(r"([A-Z]+)(\d+)", coord)
                if not m:
                    continue
                r = int(m.group(2))
                # 目标值在同行后面几列
                for c2 in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
                    cand = g.get(f"{c2}{r}")
                    if cand and cand != label and cand not in ("版本号", "文件编号", "状态", "编制", "审核"):
                        temps[label] = cand
                        break
                break
    # 备注
    notes = []
    for coord, v in g.items():
        if coord.startswith("C") and re.match(r"^\d+\.", v):
            notes.append(v)
    # 更改履历
    return {"title": title, "grade": grade, "comp": comp, "charge": charge,
            "temps": temps, "notes": notes}

results = []
seen_fp = set()
for f in sorted(SRC.glob("*.xlsx")):
    if f.name.startswith("~$"):
        continue
    try:
        wb = openpyxl.load_workbook(f, data_only=True)
    except Exception as e:
        print(f"skip {f.name}: {e}")
        continue
    for sn in wb.sheetnames:
        if sn.startswith("Sheet1") or True:
            try:
                rec = extract_sheet(wb[sn])
            except Exception as e:
                print(f"  error {f.name}/{sn}: {e}")
                continue
            if not rec or not rec["grade"]:
                continue
            fp = (rec["grade"], rec["title"], rec["charge"].get("废钢"), rec["charge"].get("回炉料"), rec["charge"].get("生铁"))
            if fp in seen_fp:
                continue
            seen_fp.add(fp)
            rec["source_file"] = f.name
            results.append(rec)

# 输出 JSON
OUT_JSON.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
# 输出审阅文本
lines = []
for r in results:
    lines.append(f"\n### {r['source_file']}")
    lines.append(f"  title: {r['title'][:60]}")
    lines.append(f"  grade: {r['grade']}")
    if r["comp"]:
        lines.append("  成分: " + " | ".join(f"{k}={v}" for k, v in r["comp"].items()))
    if r["charge"]:
        lines.append("  炉料: " + " | ".join(f"{k}={v}" for k, v in r["charge"].items()))
    if r["temps"]:
        lines.append("  温度: " + " | ".join(f"{k}={v}" for k, v in r["temps"].items()))
    if r["notes"]:
        lines.append("  备注:")
        for n in r["notes"][:8]:
            lines.append(f"    - {n[:120]}")
OUT_TXT.write_text("\n".join(lines), encoding="utf-8")
print(f"共 {len(results)} 个独立配料方案")
for r in results:
    print(f"  - {r['source_file']} | {r['grade']} | {list(r['charge'].values())}")
