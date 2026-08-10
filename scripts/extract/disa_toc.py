# -*- coding: utf-8 -*-
"""提取 DISA 手册文本层 + 目录结构，写入 _extract/_read/"""
import sys, io, re
from pathlib import Path
import fitz
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

SRC = Path(r"D:\技术文件\学习资料\DISA砂造型系统应用手册.pdf")
OUT = Path(r"D:\CCproject\CastingToolbox\_extract\_read")
OUT.mkdir(parents=True, exist_ok=True)

d = fitz.open(SRC)
full = []
for pi, pg in enumerate(d):
    t = pg.get_text().strip()
    full.append(f"\n===== P{pi+1} =====\n{t}")
d.close()

full_text = "".join(full)
(OUT / "disa_manual.txt").write_text(full_text, encoding="utf-8")
print(f"DISA 手册全文 {len(full_text)} 字符 → disa_manual.txt")

# ---- 找章节标题 ----
lines = full_text.split("\n")
headings = []
for i, l in enumerate(lines):
    s = l.strip()
    # 常见章节标题模式：纯中文短句 / 数字编号 / "第X章"
    if (re.match(r"^第[一二三四五六七八九十]+[章节]", s) or
        (len(s) <= 18 and re.match(r"^[一-鿿]+$", s) and s not in ("DISA", "Contents", "目录")) or
        re.match(r"^\d+(\.\d+)*\s+\S", s)):
        headings.append((i, s))
print(f"\n候选标题 {len(headings)} 个（前 80）：")
for i, s in headings[:80]:
    print(f"  L{i}: {s}")
