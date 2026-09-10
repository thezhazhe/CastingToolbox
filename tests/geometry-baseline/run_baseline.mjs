// ============================================================
// 基础几何厚度基准测试（命令 10.txt 第九节）
// 目标：输入数学上明确知道真实厚度的 STL → 系统能否正确测出厚度
// 不测 Hotspot 是否正确，只测"厚度识别链路"：
//   STL → bbox → voxel/gs/vs → inside → distance field → 厚度统计 → 状态
// 记录：GT 真实厚度 / bbox / voxel size / 计算厚度（距离场中位×2）/
//       误差 / inside 采样数 / 状态（OK/LOW/INSUFFICIENT）
// 重点：模拟真实铸件"壁厚 << bbox"的大件场景（minDim 升分辨率失效路径）
// 用法: node tests/geometry-baseline/run_baseline.mjs
// ============================================================
import { buildMesh } from '../../js/engine/mesh3d.js';
import { buildDistanceField } from '../../js/engine/distanceField.js';
import { analyzeHotspots } from '../../js/engine/hotspot.js';
import { BOX, union, subtract, tetMC, CYL_Y } from '../helpers/stlGen.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** sdf → mesh */
function meshFromSdf(sdf, bounds, res = 96) {
  const verts = tetMC(sdf, bounds, res);
  return { vertices: verts, triCount: verts.length / 9 };
}

/** 半壁厚距离场（复用引擎 buildDistanceField 同一路径） */
function thicknessStats(sdf, bounds, label) {
  const mesh = meshFromSdf(sdf, bounds);
  const geo = buildMesh(mesh).geometry;
  // 距离场（引擎默认路径：resolution 48 / minWallLayers 6 / maxResolution 96）
  const df = buildDistanceField(mesh, geo, {});
  const vs = df.vs, gs = df.gs;
  const inside = df.insideIdx.length;
  const dists = df.dists.filter(d => d !== null && d > 0.001).sort((a, b) => a - b);
  const n = dists.length;
  const pct = (q) => dists[Math.floor(n * q)];
  // 厚度估计方法学说明（命令 10.txt 九）：距离场 = 到最近表面距离（半壁厚语义）。
  // 对板/管/壳（两侧平行面）：内点距离 0~半壁厚均匀分布 → 中位 = 半壁厚/2；
  // 中位×2 只等于半壁厚（错）。壁厚应从"中面层"估计：
  //   P95×2（中面附近高百分位距离）或 max×2（最厚采样点）。
  // 引擎内部 mc = 局部极大（= 壁中面半壁厚）→ mc×2 = 壁厚（语义正确）。
  const tP95 = n ? +(pct(0.95) * 2).toFixed(2) : null;
  const tMax = n ? +(dists[n - 1] * 2).toFixed(2) : null;
  // 状态判定（模拟引擎路径：壁厚 < 1 voxel → 无法可靠采样）
  const voxelsAcross = (tP95 ?? 0) / vs;
  const status = n === 0 ? 'INSUFFICIENT(NO_INSIDE)' : voxelsAcross < 1 ? 'INSUFFICIENT(<1voxel)' : voxelsAcross < 2 ? 'LOW(1-2voxel)' : 'OK';
  return { label, gs, vs: +vs.toFixed(3), inside, nSamples: n,
    tMedian: n ? +(pct(0.5) * 2).toFixed(2) : null,
    tP90: n ? +(pct(0.9) * 2).toFixed(2) : null, tP95, tMax,
    voxelsAcross: +voxelsAcross.toFixed(2), status };
}

/* ---- 模型定义：GT 真实厚度 + sdf + bbox（紧凑 bbox 与大 bbox 双场景） ---- */
const R = (label, gtT, sdf, bounds) => ({ label, gtT, sdf, bounds });

const CASES = [
  // ① 20mm 均匀实心板（紧凑 bbox：minDim=壁厚 → 升分辨率应触发）
  R('plate20_compact', 20, BOX([-300, -200, -10], [300, 200, 10]), [[-305, -205, -15], [305, 205, 15]]),
  // ② 20mm 板（大 bbox 场景：板 800×600×20 埋在 1000 箱体 bbox 中——真实铸件）
  R('plate20_largeBbox', 20, BOX([-400, -300, -10], [400, 300, 10]), [[-500, -400, -200], [500, 400, 200]]),
  // ③ 20mm 均匀圆柱（⌀20×H300 细长 bar，大 bbox）
  R('cyl20_bar', 20, CYL_Y(0, 0, 10, 300), [[-15, -155, -15], [15, 155, 15]]),
  // ④ 20mm 厚圆管（ro=60/ri=40，大 bbox 箱体包围模拟）
  R('tube20', 20, subtract(CYL_Y(0, 0, 60, 500), CYL_Y(0, 0, 40, 500)), [[-80, -260, -260], [80, 260, 260]]),
  // ⑤ 100mm 实心圆柱（⌀100×H300）
  R('cyl100', 100, CYL_Y(0, 0, 50, 300), [[-60, -160, -60], [60, 160, 60]]),
  // ⑥ 100mm 厚圆环（ro=150/ri=50）
  R('ring100', 100, subtract(CYL_Y(0, 0, 150, 200), CYL_Y(0, 0, 50, 200)), [[-160, -110, -160], [160, 110, 160]]),
  // ⑦ 10/20/30mm 三段阶梯厚度（阶梯板）
  R('step10_20_30', 20, (() => {
    // 板长 900：0-300 厚 10 / 300-600 厚 20 / 600-900 厚 30（z 从 -t/2 到 t/2）
    const seg = (x0, x1, t) => BOX([x0, -200, -t / 2], [x1, 200, t / 2]);
    return union(seg(-450, -150, 10), seg(-150, 150, 20), seg(150, 450, 30));
  })(), [[-455, -205, -20], [455, 205, 20]]),
  // ⑧ 20mm 壁 + 50mm 局部厚区（厚块在薄板上）
  R('wall20_boss50', 50, union(
    BOX([-400, -300, -10], [400, 300, 10]),
    BOX([-100, -100, -10], [100, 100, 40]),
  ), [[-405, -305, -45], [405, 305, 45]]),
  // ⑨ 20mm 壁 + 100mm 局部厚圆柱（薄板 + 大圆柱）
  R('wall20_cyl100', 100, union(
    BOX([-400, -300, -10], [400, 300, 10]),
    CYL_Y(0, 0, 50, 120),
  ), [[-405, -305, -70], [405, 305, 70]]),
  // ⑩ 薄壁 5mm 壳体（大 bbox）
  R('shell5', 5, subtract(BOX([-300, -200, -100], [300, 200, 100]), BOX([-295, -195, -95], [295, 195, 95])), [[-305, -205, -105], [305, 205, 105]]),
  // ⑪ 薄壁 10mm 壳体
  R('shell10', 10, subtract(BOX([-300, -200, -100], [300, 200, 100]), BOX([-290, -190, -90], [290, 190, 90])), [[-305, -205, -105], [305, 205, 105]]),
  // ⑫ 真实铸件形态：箱体 800×600×700 壁 20（大 bbox + 空腔——minDim 升分辨率失效的核心场景）
  R('box20_wall', 20, subtract(
    BOX([-400, -300, -350], [400, 300, 350]),
    BOX([-380, -280, -330], [380, 280, 330]),
  ), [[-405, -305, -355], [405, 305, 355]]),
];

const rows = [];
console.log('模型'.padEnd(18) + ' GT   gs   vs     inside  P95厚  层数   状态');
for (const c of CASES) {
  const s = thicknessStats(c.sdf, c.bounds, c.label);
  rows.push({ model: c.label, gtThickness: c.gtT, ...s });
  const err = s.tP95 !== null ? Math.abs(s.tP95 - c.gtT) : null;
  const pass = err !== null && err <= c.gtT * 0.15;
  console.log(`${c.label.padEnd(18)} ${String(c.gtT).padStart(3)} ${String(s.gs).padStart(3)} ${String(s.vs).padStart(6)} ${String(s.inside).padStart(6)} ${String(s.tP95).padStart(6)} ${String(s.voxelsAcross).padStart(6)}  ${s.status}${pass ? ' ✓' : ' ✗'}`);
  // 同时跑 hotspot 引擎看状态
  const mesh = meshFromSdf(c.sdf, c.bounds);
  const hs = analyzeHotspots(mesh, buildMesh(mesh).geometry);
  console.log(`    → hotspot: ${hs.status}${hs.reason ? ' (' + hs.reason + ')' : ''}`);
}

// 保存 JSON（GT/计算/误差/状态）
mkdirSync(HERE, { recursive: true });
writeFileSync(join(HERE, 'baseline_results.json'), JSON.stringify(rows.map(r => ({
  ...r,
  thicknessErrorP95: r.tP95 !== null ? +(r.tP95 - r.gtThickness).toFixed(2) : null,
  pass: r.tP95 !== null && Math.abs(r.tP95 - r.gtThickness) <= r.gtThickness * 0.15,
})), null, 2));
console.log(`\n结果已保存: tests/geometry-baseline/baseline_results.json`);
