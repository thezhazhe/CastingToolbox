# -*- coding: utf-8 -*-
"""从 docx_materials.json 挑选铸造相关物料，紧凑写入审阅文件"""
import json
from pathlib import Path

OUT = Path(r"D:\CCproject\CastingToolbox\_extract\_read\rawmaterials_curated.txt")
data = json.loads(Path(r"D:\CCproject\CastingToolbox\_extract\_read\docx_materials.json").read_text(encoding="utf-8"))

# 铸造相关关键词
KEY = ["生铁", "废钢", "锰铁", "硅铁", "磷铁", "铬铁", "钼铁", "金属铜", "锑", "锡", "镍",
       "硫化亚铁", "碳化硅", "增碳剂", "孕育剂", "球化剂", "喂丝", "硅砂", "膨润土", "煤粉",
       "混配土", "覆膜砂", "锆英粉", "石墨涂料", "水基涂料", "砂芯粘结剂", "过滤片", "陶瓷过滤",
       "除渣剂", "脱硫剂", "钢丸", "砂芯修补泥", "树脂"]
SKIP = ["木托盘", "塑料胶袋", "塑料胶带", "隔板", "木板", "方木", "木条", "珍珠棉", "蜂窝纸箱",
        "塑料袋", "平口袋", "缠绕薄膜", "瓦楞纸板", "底漆", "脱脂剂", "磷化", "电泳", "消泡剂",
        "碱性调节", "防锈剂", "打磨砂轮", "锆刚玉砂轮", "云母纸", "热电偶", "取样杯", "氩气",
        "甲醇", "防锈油", "脱模剂", "加热砂芯", "气缸体砂芯", "蹄基涂料"]

lines = []
for m in data:
    name = m["name"]
    if any(k in name for k in SKIP):
        continue
    if not any(k in name for k in KEY):
        continue
    lines.append(f"\n### {name} [表{m['table']}]")
    for it in m["items"]:
        vals = " / ".join(it["values"])
        lines.append(f"  {it['no']}. {it['item']}: {vals[:220]}")
    for n in m["notes"]:
        lines.append(f"  NOTE: {n[:200]}")
OUT.write_text("\n".join(lines), encoding="utf-8")
print(f"written {len(lines)} lines -> {OUT}")
