# -*- coding: utf-8 -*-
"""检查参考书 PDF 文本层情况，决定是否需要 OCR"""
import sys, io
from pathlib import Path
import fitz
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

SRC = Path(r"D:\技术文件\学习资料")
pdfs = [
    ("铸造手册第5卷", "A-1铸造手册 第5卷 铸造工艺(第3版).pdf"),
    ("铸造工程师手册", "A优秀参考-铸造工程师手册.pdf"),
    ("铸造原理", "铸造原理  第2版.pdf"),
    ("现场铸造技术实例集300例", "A-2现场铸造技术实例集300例.pdf"),
    ("GB/T 6414", "GB-T 6414-1999 铸件尺寸公差与机械加工余量.pdf"),
    ("DISA砂造型系统应用手册", "DISA砂造型系统应用手册.pdf"),
    ("GB/T 1173", "GB-T-1173-2013-铸造铝合金.pdf"),
]
for name, fn in pdfs:
    p = SRC / fn
    try:
        d = fitz.open(p)
        pages = d.page_count
        # 抽样前30页统计文本层
        sample = min(30, pages)
        total_chars = 0
        text_pages = 0
        for i in range(sample):
            t = d[i].get_text().strip()
            total_chars += len(t)
            if len(t) > 50:
                text_pages += 1
        ratio = text_pages / sample * 100 if sample else 0
        print(f"{name}: {pages}页 | 前{sample}页文本层 {total_chars}字符, 有文本页 {text_pages}/{sample} ({ratio:.0f}%)")
        d.close()
    except Exception as e:
        print(f"{name}: ERROR {e}")
