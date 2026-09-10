// ============================================================
// Exp 05b · 薄壁壳圆角敏感性（命令文件 7.txt 第八节补充）
// 壳 200×200×100 壁 10 + 12 棱外圆角 R（真实 CAD 圆角场景）
// 观察：R 多大开始报弱热结 → 程序对小圆角的敏感度
// ============================================================
import { makeMesh } from './hotspotGeometryGenerator.mjs';
import { BOX, SPHERE, union, subtract } from '../helpers/stlGen.js';
import { runAnalyze, makeRecord, appendRaw } from './validationCommon.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAW_DIR } from './validationConfig.mjs';

const CYL_AXIS = (axis, cx, cy, cz, r, len) => (p) => {
  const [a, b, c] = [p[0] - cx, p[1] - cy, p[2] - cz];
  const along = axis === 'x' ? a : axis === 'y' ? b : c;
  const radial = axis === 'x' ? Math.hypot(b, c) : axis === 'y' ? Math.hypot(a, c) : Math.hypot(a, b);
  return Math.max(radial - r, Math.abs(along) - len / 2);
};

const Rs = [0, 0.5, 1, 1.5, 2, 3, 5, 10];
const L = 200, W = 200, H = 100, wall = 10;
const half = [L / 2, W / 2, H / 2];

const out = [];
for (const R of Rs) {
  const shapes = [
    subtract(
      BOX([-half[0], -half[1], -half[2]], [half[0], half[1], half[2]]),
      BOX([-half[0] + wall, -half[1] + wall, -half[2] + wall], [half[0] - wall, half[1] - wall, half[2] - wall]),
    ),
  ];
  if (R > 0) {
    const addCyl = (cx, cy, cz, axis, len) => { if (len > 0.001) shapes.push(CYL_AXIS(axis, cx, cy, cz, R, len)); };
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) addCyl(0, sy * half[1], sz * half[2], 'x', L - 2 * R);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) addCyl(sx * half[0], 0, sz * half[2], 'y', W - 2 * R);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) addCyl(sx * half[0], sy * half[1], 0, 'z', H - 2 * R);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      shapes.push(SPHERE([sx * (half[0] - R), sy * (half[1] - R), sz * (half[2] - R)], R));
    }
  }
  const mesh = makeMesh(union(...shapes), [[-half[0] - 2, -half[1] - 2, -half[2] - 2], [half[0] + 2, half[1] + 2, half[2] + 2]], 96);
  const gt = { expectedUniform: R === 0, expectedHotspots: [], expectedThicknessZones: [], tolerances: {} };
  const r = runAnalyze(mesh);
  const rec = makeRecord(`shellFillet_R${R}`, { R }, gt, r);
  const det = rec.detected.hotspots[0];
  out.push({ ...rec, classification: null, R, cornerD: det?.localThickness / 2 ?? null });
  console.log(`  R=${String(R).padEnd(4)} status=${r.status.padEnd(12)} H${r.hotspots.length} conf=${det?.confidence ?? '—'} cornerD=${det ? (det.localThickness / 2).toFixed(1) : '—'}`);
}
appendRaw('exp05b_filletShell', out);
writeFileSync(join(RAW_DIR, 'exp05b_filletShell.csv'), [
  'model,R,status,H,cornerD,confidence,prominenceScore',
  ...out.map(f => [f.model, f.R, f.status, f.detected.hotspots.length, f.cornerD ?? '', f.confidence ?? '', f.prominenceScore ?? ''].join(',')),
].join('\n'));
console.log('完成');
