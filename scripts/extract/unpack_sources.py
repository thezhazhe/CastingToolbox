# -*- coding: utf-8 -*-
"""解包知识库补充资料：配料单.zip / 问题知识库.7z / 设备维护保养.7z / 密码docx
输出到 _extract/（不入库，.gitignore 忽略）。
"""
import zipfile, shutil, sys, io
from pathlib import Path

SRC = Path(r"D:\技术文件\学习资料")
OUT = Path(__file__).resolve().parents[2] / "_extract"  # CastingToolbox/_extract

def extract_zip(name):
    src = SRC / name
    dst = OUT / name.replace(".zip", "")
    if dst.exists():
        print(f"[skip] {name} 已解压")
        return
    with zipfile.ZipFile(src) as z:
        z.extractall(dst)
    print(f"[ok] {name} -> {dst}")

def extract_7z(name):
    src = SRC / name
    dst = OUT / name.replace(".7z", "")
    if dst.exists():
        print(f"[skip] {name} 已解压")
        return
    import py7zr
    with py7zr.SevenZipFile(src, mode="r") as z:
        z.extractall(path=dst)
    print(f"[ok] {name} -> {dst}")

def extract_docx():
    import msoffcrypto
    src = SRC / "原、辅材料技 术标准（20230207密码是1.docx"
    dst = OUT / "原辅材料技术标准.docx"
    if dst.exists():
        print(f"[skip] docx 已解密")
        return
    with open(src, "rb") as f:
        of = msoffcrypto.OfficeFile(f)
        of.load_key(password="1")
        with open(dst, "wb") as out:
            of.decrypt(out)
    print(f"[ok] docx 已解密 -> {dst}")

OUT.mkdir(parents=True, exist_ok=True)
extract_zip("配料单.zip")
extract_7z("问题知识库.7z")
extract_7z("设备维护保养.7z")
extract_docx()
