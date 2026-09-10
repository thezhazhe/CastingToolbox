// V2.3 诊断：thinShell 代表点路径（isSpike 判定/域质心/校验/fallback）
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSTL } from '../../js/engine/stl.js';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { analyzeHotspots } from '../../js/engine/hotspot.js';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const b = readFileSync(join(ROOT, 'tests', 'golden', 'thinShell.stl'));
const mesh = parseSTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const geo = buildMesh(mesh).geometry;
const hs = analyzeHotspots(mesh, geo);
const h = hs.hotspots[0];
console.log('H1:', JSON.stringify({ x: +h.x.toFixed(2), y: +h.y.toFixed(2), z: +h.z.toFixed(2), mc: +h.mc.toFixed(2), conf: +h.confidence.toFixed(3) }));
for (const a of hs.audit) {
  if (a.localThickness !== undefined) {
    console.log(`audit: peak=${a.peak} localThickness=${a.localThickness} regionVol=${a.regionVolumeCm3} rejected=${a.rejected ?? '-'}`);
  }
}
const d = hs.debug || {};
console.log('debug:', JSON.stringify({ gs: d.gs, vs: d.vs, insidePoints: d.insidePoints, candidates: d.candidates, regions: d.regions, peaks: d.peaks }));
