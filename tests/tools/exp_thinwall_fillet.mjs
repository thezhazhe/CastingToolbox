// ============================================================
// Exp 04/05 · 薄壁极限 + 圆角噪声（命令文件 7.txt 第七/八节）
//   04 薄壁扫描：thinShell(size, wall)，壁 0.25..20 × 尺寸 {100,200,400} 全组合
//     + {800,1000} × {2..20} 子集 —— 寻找"应可分析却 INSUFFICIENT"或"应无热结却报出"边界
//   05 圆角扫描：圆角实心箱 R0..R10 —— 量化小圆角敏感性
// ============================================================
import { generate, makeMesh } from './hotspotGeometryGenerator.mjs';
import { BOX, SPHERE, union } from '../helpers/stlGen.js';
import { runAnalyze, makeRecord, appendRaw } from './validationCommon.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAW_DIR } from './validationConfig.mjs';

/** 任意轴圆柱（axis x/y/z，中心 (cx,cy,cz)，半径 r，长度 len） */
const CYL_AXIS = (axis, cx, cy, cz, r, len) => (p) => {
  const [a, b, c] = [p[0] - cx, p[1] - cy, p[2] - cz];
  const along = axis === 'x' ? a : axis === 'y' ? b : c;
  const radial = axis === 'x' ? Math.hypot(b, c) : axis === 'y' ? Math.hypot(a, c) : Math.hypot(a, b);
  return Math.max(radial - r, Math.abs(along) - len / 2);
};

/* ---- 04 薄壁极限 ---- */
function thinWallScan() {
  const walls = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 15, 20];
  const sizes = [100, 200, 400, 800, 1000];
  const combos = [];
  for (const s of sizes) for (const w of walls) {
    if (s >= 800 && w < 2) continue;    // 大尺寸极薄壁 → MC 网格化必失败，跳过（测试模型极限）
    combos.push([s, w]);
  }
  const out = [];
  for (const [size, wall] of combos) {
    const { mesh, gt, res } = generate('thinShell', { l: size, w: size * 0.6, h: size * 0.4, t: wall });
    const r = runAnalyze(mesh);
    const rec = makeRecord(`shell_${size}_${wall}`, { size, wall, mcRes: res }, gt, r);
    out.push({
      ...rec, classification: null,
      size, wall,
      mcStepMm: size / res,          // MC 网格化步长
      mdimWallRatio: +(size / wall).toFixed(1),   // 主尺寸/壁厚（薄壁度）
    });
  }
  return out;
}

/* ---- 05 圆角扫描：实心箱 200×200×100 + 12 棱外圆角 R（角部 8 球衔接） ---- */
function filletScan() {
  const Rs = [0, 0.5, 1, 1.5, 2, 3, 5, 10];
  const L = 200, W = 200, H = 100;
  const half = [L / 2, W / 2, H / 2];
  const out = [];
  for (const R of Rs) {
    if (R === 0) {
      const { mesh, gt } = generate('uniformCube', { size: 200 });   // 退化：纯箱
      const r = runAnalyze(mesh);
      const rec = makeRecord(`fillet_R0`, { R }, gt, r);
      out.push({ ...rec, classification: null, R, cornerD: null });
      continue;
    }
    // 12 条棱圆柱（去掉端部 2R）+ 8 角球 → 标准圆角箱
    const cylLen = L - 2 * R;
    const shapes = [BOX([-half[0], -half[1], -half[2]], [half[0], half[1], half[2]])];
    const addCyl = (cx, cy, cz, axis, len) => {
      if (len > 0.001) shapes.push(CYL_AXIS(axis, cx, cy, cz, R, len));
    };
    // X 向棱（y=±W/2, z=±H/2）
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) addCyl(0, sy * half[1], sz * half[2], 'x', cylLen);
    // Y 向棱
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) addCyl(sx * half[0], 0, sz * half[2], 'y', W - 2 * R);
    // Z 向棱
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) addCyl(sx * half[0], sy * half[1], 0, 'z', H - 2 * R);
    // 8 角球
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      shapes.push(SPHERE([sx * (half[0] - R), sy * (half[1] - R), sz * (half[2] - R)], R));
    }
    const sdf = union(...shapes);
    const mesh = makeMesh(sdf, [[-half[0] - 2, -half[1] - 2, -half[2] - 2], [half[0] + 2, half[1] + 2, half[2] + 2]], 72);
    const gt = { expectedUniform: R === 0, expectedHotspots: [], expectedThicknessZones: [], tolerances: {} };
    const r = runAnalyze(mesh);
    const rec = makeRecord(`fillet_R${R}`, { R }, gt, r);
    out.push({ ...rec, classification: null, R, cornerD: rec.detected.hotspots[0]?.localThickness / 2 ?? null });
  }
  return out;
}

const start = Date.now();
const T = thinWallScan();
console.log(`thinWall: ${T.length} 条`);
const b = { INSUFFICIENT: 0, NO_HOTSPOT: 0, ok: 0, other: 0, belowMc: 0 };
for (const t of T) {
  const c = t.status === 'INSUFFICIENT_RESOLUTION' ? 'INSUFFICIENT' : t.status === 'NO_HOTSPOT' ? 'NO_HOTSPOT' : t.status === 'ok' ? 'ok' : 'other';
  b[c]++; if (t.mcStepMm > t.wall) b.belowMc++;
}
console.log('  状态: ' + JSON.stringify(b));
console.log('  MC 步长 > 壁厚（网格化不可靠）: ' + b.belowMc + ' 条');
appendRaw('exp04_thinWall', T, { elapsedSec: ((Date.now() - start) / 1000).toFixed(1) });

const F = filletScan();
console.log(`fillet: ${F.length} 条`);
for (const f of F) {
  const det = f.detected.hotspots[0];
  console.log(`  R=${String(f.R).padEnd(4)} status=${f.status.padEnd(12)} H${f.detected.hotspots.length} cornerD=${f.cornerD ?? '—'} conf=${det?.confidence ?? '—'}`);
}
appendRaw('exp05_fillet', F, { elapsedSec: ((Date.now() - start) / 1000).toFixed(1) });

writeFileSync(join(RAW_DIR, 'exp04_thinWall.csv'), [
  'model,size,wall,mcStepMm,mdimWallRatio,status,reason,confidence,positionError,insidePoints,vs',
  ...T.map(t => [t.model, t.size, t.wall, t.mcStepMm.toFixed(3), t.mdimWallRatio, t.status, t.reason ?? '',
    t.confidence ?? '', t.positionError ?? '', t.debug.insidePoints, t.debug.vs.toFixed(3)].join(',')),
].join('\n'));
writeFileSync(join(RAW_DIR, 'exp05_fillet.csv'), [
  'model,R,status,H,cornerD,confidence,prominenceScore',
  ...F.map(f => [f.model, f.R, f.status, f.detected.hotspots.length, f.cornerD ?? '', f.confidence ?? '', f.prominenceScore ?? ''].join(',')),
].join('\n'));
console.log(`完成 ${((Date.now() - start) / 1000).toFixed(1)}s`);
