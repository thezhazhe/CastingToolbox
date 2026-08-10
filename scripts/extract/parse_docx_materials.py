# -*- coding: utf-8 -*-
"""把 docx 中每张材料规格表解析为结构化 JSON（脱敏：去公司名/标准号/编制人名）
输出: _extract/_read/docx_materials.json
"""
import sys, io, json, re
from pathlib import Path
from docx import Document
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[2] / "_extract"
doc = Document(ROOT / "原辅材料技术标准.docx")

SKIP_HEAD_WORDS = ["标准号", "版本号", "受控状态", "格力", "编制", "审核", "会签", "批准",
                   "技术规格书", "物料编码", "更", "改", "记", "录", "分发号"]

def clean(t):
    t = t.replace("\n", " ").replace("　", " ").strip()
    t = re.sub(r"\s+", " ", t)
    return t

def extract_material_name(table):
    """从表头格提取物料名：'技术规格书\\n灰铁用生铁（高磷）\\n物料编码：...'（实际是换行分隔）"""
    for r in table.rows[:4]:
        for c in r.cells:
            lines = [l.strip() for l in c.text.split("\n") if l.strip()]
            for i, l in enumerate(lines):
                if "技术规格书" in l and i + 1 < len(lines):
                    return lines[i + 1]
    return None

def parse_table(ti, table):
    """返回 {name, items:[{no,item,value}], notes:[], special:[]}"""
    out = {"table": ti, "name": None, "items": [], "notes": [], "special": []}
    out["name"] = extract_material_name(table)
    # 找到管理项目数据区：表头行含 'No' 且 '管理项目'
    data_start = None
    for ri, r in enumerate(table.rows):
        cells = [clean(c.text) for c in r.cells]
        if any("管理项目" in c for c in cells) and any(re.match(r"^No\.?$", c) or c == "No" for c in cells):
            data_start = ri + 1
            break
    if data_start is None:
        return out
    for r in table.rows[data_start:]:
        cells = [clean(c.text) for c in r.cells]
        joined = " ".join(cells)
        if not joined.strip():
            continue
        if re.search(r"^注\d", joined) or "判定规则" in joined or "组批规定" in joined:
            out["notes"].append(joined)
            continue
        if "特别要求" in cells[0] or "必须满足" in joined:
            out["special"].append(joined)
            continue
        # 管理项目行：第一格为数字
        m = re.match(r"^(\d+)", cells[0])
        if m:
            no = m.group(1)
            item = cells[1] if len(cells) > 1 else ""
            # 管理值 = 去掉前两格(No/管理项目)后的文本（去重合并）
            vals = []
            for v in cells[2:]:
                v = v.strip()
                if v and v not in vals and "验证方法" not in v and "测试仪器" not in v and not re.match(r"^注\d", v):
                    vals.append(v)
            out["items"].append({"no": no, "item": item, "values": vals})
    return out

materials = []
seen = set()
for ti, table in enumerate(doc.tables):
    if ti == 0:
        continue  # 封面更改记录
    if ti == 1:
        continue  # 物料总清单（125行索引）
    m = parse_table(ti, table)
    if not m["name"]:
        # 无标题表（如木托盘标题被合并到钼铁表），用首格文本兜底
        continue
    if m["name"] in seen:
        continue
    seen.add(m["name"])
    materials.append(m)

print(f"共解析 {len(materials)} 种物料：")
for m in materials:
    print(f"  - {m['name']} ({len(m['items'])}项)")

with open(ROOT / "_read" / "docx_materials.json", "w", encoding="utf-8") as f:
    json.dump(materials, f, ensure_ascii=False, indent=1)
print("\n已写入 docx_materials.json")
