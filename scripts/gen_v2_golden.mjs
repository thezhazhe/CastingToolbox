// ============================================================
// Hotspot V2.1 Golden 模型生成（命令文件九/十二节模型清单）
// 生成到 tests/golden/*.stl（ASCII）
// 用法: node scripts/gen_v2_golden.mjs
// ============================================================
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { genSTL, BOX, CYL_Y, SPHERE, union, subtract } from '../tests/helpers/stlGen.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GOLDEN = path.join(ROOT, 'tests', 'golden');

const MODELS = [
  // 1. 厚块+薄壁：400×200×8 板 + 中央 100×100×60 凸台 → OK，H1@(0,0,34) Mc≈30
  {
    file: 'thickOnThin.stl',
    sdf: union(
      BOX([-200, -100, -4], [200, 100, 4]),
      BOX([-50, -50, 4], [50, 50, 64]),
    ),
    bounds: [[-205, -105, -8], [205, 105, 68]],
    res: 72,
    expect: 'OK',
  },
  // 2. 两个独立厚区：薄板 + 两个独立凸台 → H1/H2
  {
    file: 'twoThick.stl',
    sdf: union(
      BOX([-200, -100, -4], [200, 100, 4]),
      BOX([-80, -30, 4], [-20, 30, 44]),      // 凸台 A 中心 (-50,0,24) d=20
      BOX([80, -30, 4], [140, 30, 44]),       // 凸台 B 中心 (110,0,24) d=20
    ),
    bounds: [[-205, -105, -8], [205, 105, 48]],
    res: 72,
    expect: 'OK x2',
  },
  // 3. 相邻应分裂：Peak A=30 / Valley=18 / Peak B=30（两柱 + 矮连接带）
  {
    file: 'adjacentSplit.stl',
    sdf: union(
      BOX([-80, -30, -30], [10, 30, 30]),     // 柱 A（90 宽，d=30）
      BOX([70, -30, -30], [160, 30, 30]),     // 柱 B（90 宽，d=30）
      BOX([10, -18, -18], [70, 18, 18]),      // 连接带（60×36×36 → d=18，明显谷）
    ),
    bounds: [[-85, -35, -35], [165, 35, 35]],
    res: 72,
    expect: 'OK x2',
  },
  // 4. 相邻应合并：哑铃（两球 r=40 心距 100 + 方柱 74×74 连接）
  //    峰 A/B d=40、谷（连接柱）d=37 → 谷深 (40-37)/40 = 0.075：≥0.05 放行 uniform、<0.15 PVP 合并
  {
    file: 'adjacentMerge.stl',
    sdf: union(
      SPHERE([-50, 0, 0], 40),
      SPHERE([50, 0, 0], 40),
      BOX([-50, -37, -37], [50, 37, 37]),
    ),
    bounds: [[-95, -45, -45], [95, 45, 45]],
    res: 72,
    expect: 'OK x1',
  },
  // 5. 长条铸件 800×40×40 → NO_HOTSPOT（均匀）
  {
    file: 'longBar.stl',
    sdf: BOX([-400, -20, -20], [400, 20, 20]),
    bounds: [[-405, -25, -25], [405, 25, 25]],
    res: 60,
    expect: 'NO_HOTSPOT',
  },
  // 6. 大尺寸薄壁铸件 600×400×120 壁 8 → NO_HOTSPOT（不再 INSUFFICIENT）
  {
    file: 'largeThin.stl',
    sdf: subtract(
      BOX([-300, -200, -60], [300, 200, 60]),
      BOX([-292, -192, -52], [292, 192, 52]),
    ),
    bounds: [[-305, -205, -65], [305, 205, 65]],
    res: 120,
    expect: 'NO_HOTSPOT',
  },
  // 7. 大尺寸薄壁 + 局部厚区（凸台 80×80×50）→ OK（薄壁大件也能检出局部厚区）
  {
    file: 'largeThinThick.stl',
    sdf: union(
      subtract(
        BOX([-300, -200, -60], [300, 200, 60]),
        BOX([-292, -192, -52], [292, 192, 52]),
      ),
      BOX([-40, -40, 60], [40, 40, 110]),     // 凸台 z∈[60,110]，中心 (0,0,85) d=25
    ),
    bounds: [[-305, -205, -65], [305, 205, 115]],
    res: 120,
    expect: 'OK',
  },
  // 8. 弱显著度（板 40 主体 + 弱凸台 80×80×48 → 凸台区 d=24 vs 板 d=20，比值 1.2）
  //    期望：OK 但 confidence 明显低于强热结（弱热结低置信）
  {
    file: 'mildThick.stl',
    sdf: union(
      BOX([-150, -100, -20], [150, 100, 20]),   // 板 300×200×40（d=20）
      BOX([-40, -40, 20], [40, 40, 68]),        // 凸台 80×80×48（总高 88，中心 d=24）
    ),
    bounds: [[-155, -105, -24], [155, 105, 72]],
    res: 72,
    expect: 'OK (low confidence)',
  },
  // 9. 空心厚环：管（壁 20）+ 中段加厚环（壁 35）→ 热结在环壁内（不误判空腔）
  {
    file: 'hollowThickRing.stl',
    sdf: union(
      subtract(CYL_Y(0, 0, 60, 100), CYL_Y(0, 0, 40, 100)),   // 基本管壁 20（d=10）
      subtract(CYL_Y(0, 0, 75, 60), CYL_Y(0, 0, 40, 60)),     // 中段环壁 35（d=17.5）
    ),
    bounds: [[-80, -65, -80], [80, 65, 80]],
    res: 72,
    expect: 'OK',
  },
];

for (const m of MODELS) {
  const t0 = Date.now();
  const text = genSTL(m.sdf, m.bounds, m.res);
  writeFileSync(path.join(GOLDEN, m.file), text);
  console.log(`${m.file}: ${(text.length / 1024).toFixed(0)}KB, ${(text.length / 230) | 0} tri, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
