# -*- coding: utf-8 -*-
"""脱敏扫描：检查 data/**/*.json 是否残留公司信息"""
import re, sys, io
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

DATA = Path(r"D:\CCproject\CastingToolbox\data")

# 敏感词表（公司名/客户名/人名/品牌/内部编号）
SENSITIVE = [
    "格力", "武安", "精密装备", "凌达", "大连新院", "大连新苑", "博戈", "德尚",
    "宇众", "祥瑞", "瑞立", "立博", "群山", "川联", "宏德", "富康", "埃肯",
    "刘佃柱", "付晓康", "铸铁事业部", "QJ/WJ", "QJ\\WJ", "4403", "SF2",
    "技术规格书", "标准号", "受控状态", "分发号", "物料编码", "版本号：A",
    "编制", "审核人", "批准人", "更改记录", "更改履历",
    # 新资料来源（材料对照表 / 铝合金3D打印规范）
    "东安", "Kocel", "Magics", "武钢", "株洲", "自贡", "山特维克",
    "肯纳", "住友", "三菱金属", "东芝钨业", "瓦尔特", "赫尔特", "可乐满",
    "维迪亚", "长城", "钻石", "亚当斯", "卡波洛依", "万耐特", "山高",
    "天津硬质合金", "北方工具厂",
]

hits = []
for f in DATA.rglob("*.json"):
    txt = f.read_text(encoding="utf-8")
    for word in SENSITIVE:
        if word in txt:
            # 找到上下文
            idx = txt.index(word)
            ctx = txt[max(0, idx-25):idx+30].replace("\n", " ")
            hits.append(f"{f.relative_to(DATA)}: [{word}] ...{ctx}...")

if hits:
    print(f"⚠️  发现 {len(hits)} 处敏感信息：")
    for h in hits:
        print("  " + h)
else:
    print("✅ 全部数据 JSON 无公司信息残留（脱敏通过）")

# 额外：检查是否有非法的内部文件编号模式
pat = re.compile(r"[A-Z]{1,4}/[A-Z]{1,4}-[A-Z]{1,4}")
for f in DATA.rglob("*.json"):
    txt = f.read_text(encoding="utf-8")
    for m in pat.finditer(txt):
        print(f"  ⚠️ {f.relative_to(DATA)}: 疑似编号 {m.group(0)}")
