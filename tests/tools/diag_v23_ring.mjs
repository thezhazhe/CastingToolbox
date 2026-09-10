// V2.3 诊断：hollowThickRing 代表点路径（isSpike/域质心/校验）
import { buildMesh } from '../../js/engine/mesh3d.js';
import { analyzeHotspots } from '../../js/engine/hotspot.js';
import { generate } from './hotspotGeometryGenerator.mjs';

const { mesh, gt } = generate('hollowThickRing');
const geo = buildMesh(mesh).geometry;
const hs = analyzeHotspots(mesh, geo);
const h = hs.hotspots[0];
console.log(`H1: rp=(${h.x.toFixed(2)},${h.y.toFixed(2)},${h.z.toFixed(2)}) mc=${h.mc.toFixed(2)}`);
console.log(`peakPosition: ${JSON.stringify(h.peakPosition)}`);
// 手动重算 BFS 路径（从 audit 的细化参数重建——简化：直接检查 isSpike 用阈值 0.9 的域大小）
// 用与引擎相同的细化网格：打印 audit refineRes
for (const a of hs.audit) {
  if (a.localThickness !== undefined) {
    console.log(`audit: peak=${a.peak} refineRes=${a.refineRes} localThickness=${a.localThickness} rejected=${a.rejected ?? '-'}`);
  }
}
