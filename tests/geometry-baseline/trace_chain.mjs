// ============================================================
// 链路追踪（命令 10.txt 第三/十节）：
// STL → bbox → voxel → inside → distance field → thickness → hotspot
// 模型：wall20_cyl100（板 20 + 圆柱 100）——用户报告的"100mm 圆柱无法识别"案例
// 同时做尺度不变量测试（1× / 0.1× / 10×）
// 目标：找出第一次出错的位置（不修）
// ============================================================
import { buildMesh } from '../../js/engine/mesh3d.js';
import { buildDistanceField } from '../../js/engine/distanceField.js';
import { analyzeHotspots } from '../../js/engine/hotspot.js';
import { BOX, union, tetMC, CYL_Y } from '../helpers/stlGen.js';

const f = (v, d = 2) => typeof v === 'number' && Number.isFinite(v) ? parseFloat(v.toFixed(d)) : v;

function meshFromSdf(sdf, bounds, res = 96) {
  const verts = tetMC(sdf, bounds, res);
  return { vertices: verts, triCount: verts.length / 9 };
}

/** 完整链路 dump：每个阶段的"第一次异常"标注 */
function trace(label, sdf, bounds, scale = 1) {
  const sdfS = (p) => sdf([p[0] / scale, p[1] / scale, p[2] / scale]) * scale;   // 尺度化：采样点缩回原坐标系，距离值×scale
  const bS = [bounds[0].map(v => v * scale), bounds[1].map(v => v * scale)];
  const mesh = meshFromSdf(sdfS, bS);
  const geo = buildMesh(mesh).geometry;
  const b = geo.boundingBox;
  const mdim = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
  const size = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map(v => f(v, 1));
  console.log(`\n=== ${label} (scale=${scale}) ===`);
  console.log(`① STL bbox: ${size.join('×')} mm  mdim=${f(mdim, 1)}  triCount=${mesh.triCount}`);
  // ② 距离场（引擎默认路径）
  const df = buildDistanceField(mesh, geo, {});
  console.log(`② 距离场: gs=${df.gs}³ vs=${f(df.vs, 3)}mm  → 壁厚 20mm 采样层 = ${f(20 * scale / df.vs, 2)} voxel`);
  const dists = df.dists.filter(d => d !== null && d > 0.001).sort((a, b) => a - b);
  const n = dists.length;
  const pct = (q) => dists[Math.floor(n * q)];
  console.log(`③ inside: ${df.insideIdx.length}/${df.gs ** 3} 有效距离采样 ${n}`);
  if (n) {
    console.log(`④ 距离场统计（半壁厚语义）: min=${f(dists[0], 2)} P50=${f(pct(0.5), 2)} P95=${f(pct(0.95), 2)} max=${f(dists[n - 1], 2)}`);
    console.log(`   厚度估计: P95×2=${f(pct(0.95) * 2, 2)}  max×2=${f(dists[n - 1] * 2, 2)}（圆柱/环用 max×2=直径）`);
  } else {
    console.log(`④ 距离场: 无有效采样 → INSUFFICIENT 第一出错点 = ③ inside 阶段`);
  }
  // ⑤ hotspot 全链路（含 uniform 判据信号）
  const hs = analyzeHotspots(mesh, geo);
  console.log(`⑤ hotspot: ${hs.status}${hs.reason ? ' (' + hs.reason + ')' : ''} H=${hs.hotspots.length}`);
  for (const a of hs.audit) {
    if (a.uniform !== undefined) {
      const rl = a.regionLevel || {};
      console.log(`   uniform 判据: uniform=${a.uniform} 候选=${hs.debug?.candidates} 区域=${hs.debug?.regions} ${rl.outsideMaxima !== undefined ? `outsideMaxima=${rl.outsideMaxima} thicknessRatio=${f(rl.thicknessRatio, 3)} centroidOffset=${f(rl.centroidOffsetRatio, 4)}` : ''}`);
    }
  }
  const d = hs.debug || {};
  console.log(`   debug: 候选=${d.candidates} 区域=${d.regions} 峰=${d.peaks} 拒绝=${d.rejected} inside=${d.insidePoints}/${d.totalPoints}`);
}

// 用户案例：板 20 + 圆柱 100（bbox 810×610×140 模拟真实铸件大 bbox）
const wall20_cyl100 = union(
  BOX([-400, -300, -10], [400, 300, 10]),
  CYL_Y(0, 0, 50, 120),
);
trace('wall20_cyl100 板20+圆柱100', wall20_cyl100, [[-405, -305, -70], [405, 305, 70]]);

// 对比：紧凑 bbox（升分辨率触发）——证明 vs 是唯一变量
trace('wall20_cyl100 紧凑bbox', wall20_cyl100, [[-410, -310, -70], [410, 310, 70]]);

// 尺度不变量：同一模型 1× / 0.1× / 10×
console.log('\n── 尺度不变量（模型=板 20 + 圆柱 100，bbox 同比例缩放）──');
for (const s of [1, 0.1, 10]) {
  trace('scale', wall20_cyl100, [[-405, -305, -70], [405, 305, 70]], s);
}
