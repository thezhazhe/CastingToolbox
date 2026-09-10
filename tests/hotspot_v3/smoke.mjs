// ============================================================
// V3 冒烟测试：验证管线跑通 + 基础判定合理（PHASE 2-6 集成验证）
// 用法: node tests/hotspot_v3/smoke.mjs
// 覆盖：均匀件 NO_HOTSPOT / 多结构 OK / 位置合理性
// ============================================================
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../tools/hotspotGeometryGenerator.mjs';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { analyzeHotspotsV3 } from '../../js/engine/v3/hotspotV3.js';
import { HS_STATUS } from '../../js/engine/hotspot.js';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  ok ? pass++ : fail++;
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const CASES = [
  { kind: 'uniformCube',    name: 'cube → NO_HOTSPOT', expect: 'NO_HOTSPOT' },
  { kind: 'uniformPlate',   name: 'plate → NO_HOTSPOT', expect: 'NO_HOTSPOT' },
  { kind: 'uniformCylinder', name: 'cylinder → NO_HOTSPOT', expect: 'NO_HOTSPOT' },
  { kind: 'uniformTube',    name: 'tube → NO_HOTSPOT', expect: 'NO_HOTSPOT' },
  { kind: 'bossOnPlate',    name: 'boss on plate → OK@boss', expect: 'OK', kind2: 'boss' },
  { kind: 'thickBlockThinWall', name: 'thick block + thin wall → OK', expect: 'OK' },
  { kind: 'flange',         name: 'flange → OK x2', expect: 'OK' },
  { kind: 'hollowThickRing', name: 'hollow ring → OK', expect: 'OK' },
];

for (const c of CASES) {
  const t0 = Date.now();
  const { mesh, gt, mdim } = generate(c.kind);
  const geometry = buildMesh(mesh).geometry;
  const hs = analyzeHotspotsV3(mesh, geometry);
  const ms = Date.now() - t0;
  const hstr = hs.hotspots.map(h => `H${h.hotspotId}@(${h.position.map(v => v.toFixed(0)).join(',')}) M=${h.peakModulus.toFixed(1)} n=${h.normalizedModulus.toFixed(2)} c=${h.confidence.toFixed(2)}`).join(' | ') || '-';
  console.log(`\n[${c.name}] ${hs.status} ${ms}ms tri=${mesh.triCount} mdim=${mdim.toFixed(0)}`);
  console.log(`  ${hstr}`);

  if (c.expect === 'NO_HOTSPOT') {
    check(c.name, hs.status === HS_STATUS.NO_HOTSPOT, `${hs.status} (${hs.reason})`);
  } else {
    check(`${c.name}: OK`, hs.status === HS_STATUS.OK, hs.status);
    if (hs.status === HS_STATUS.OK && gt.expectedHotspots?.length) {
      const h0 = hs.hotspots[0];
      const g0 = gt.expectedHotspots[0];
      if (g0 && g0.x !== null && g0.x !== undefined) {
        const d = dist(h0.position, [g0.x, g0.y, g0.z]);
        const tol = Math.max(30, mdim * 0.15);
        check(`${c.name}: 主热结位置误差 < ${tol.toFixed(0)}mm`, d < tol, `d=${d.toFixed(0)} 期望=(${g0.x},${g0.y},${g0.z})`);
      } else {
        check(`${c.name}: 位置（径向/环形，跳过坐标断言）`, true, 'gt 无固定坐标');
      }
    }
  }
}

console.log(`\n冒烟结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
