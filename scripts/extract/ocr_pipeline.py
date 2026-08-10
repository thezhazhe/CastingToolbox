# -*- coding: utf-8 -*-
"""扫描 PDF OCR 管线：PDF页 → 300DPI PNG → RapidOCR → 文本
用法: python ocr_pipeline.py <pdf路径> <页码(1基)> [--dpi 300]
输出: _extract/_ocr/<name>_p<页码>.txt  （含识别文本与置信度）
"""
import sys, io, argparse, time
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import fitz
from rapidocr_onnxruntime import RapidOCR

OUT = Path(r"D:\CCproject\CastingToolbox\_extract\_ocr")
OUT.mkdir(parents=True, exist_ok=True)

parser = argparse.ArgumentParser()
parser.add_argument("pdf")
parser.add_argument("page", type=int)
parser.add_argument("--dpi", type=int, default=300)
args = parser.parse_args()

pdf = Path(args.pdf)
dpi = args.dpi
zoom = dpi / 72

t0 = time.time()
doc = fitz.open(pdf)
page = doc[args.page - 1]
pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
img_path = OUT / f"{pdf.stem[:40]}_p{args.page}.png"
pix.save(img_path)
print(f"[render] 第{args.page}页 → {img_path.name} ({pix.width}x{pix.height}, {dpi}DPI) {time.time()-t0:.1f}s")

engine = RapidOCR()
t0 = time.time()
result, elapse = engine(str(img_path))
print(f"[ocr] {time.time()-t0:.1f}s")

lines = []
if result:
    for box, text, score in result:
        try:
            s = float(score)
        except (TypeError, ValueError):
            s = 0.0
        lines.append((text, s))
    out_txt = OUT / f"{pdf.stem[:40]}_p{args.page}.txt"
    out_txt.write_text("\n".join(f"{t}  [{s:.2f}]" for t, s in lines), encoding="utf-8")
    print(f"[write] {out_txt.name} ({len(lines)}行)")
    print("\n----- 识别内容 -----")
    for t, s in lines:
        print(f"{t}  [{s:.2f}]")
else:
    print("[ocr] 未识别到文字")
