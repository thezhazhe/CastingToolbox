// ============================================================
// Golden 快照（V2.1 实施纪律：BEFORE/AFTER diff）
// 对每个 golden 模型跑当前版本热结分析，输出机器可读快照：
//   { model, status, reason, hotspots: [{x,y,z,mc,score,regionBBox}], debug: {...}, elapsedMs }
// 用法: node scripts/snapshot_golden.mjs <before|after>
// 输出: tests/golden/<TAG>_V2_1_GOLDEN.json
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSTL } from '../js/engine/stl.js';
import { buildMesh } from '../js/engine/mesh3d.js';
import { analyzeHotspots } from '../js/engine/hotspot.js';
import { genSTL, lShape, boxShell, longBlock, twoHotspots, tShape } from '../tests/helpers/stlGen.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tag = process.argv[2] || 'BEFORE';

/** 生成 stlGen 模型 → mesh（ASCII → parseSTL） */
function genMesh(specFn) {
  const spec = specFn();   // lShape() 等返回 {sdf, bounds, res}
  const text = genSTL(spec.sdf, spec.bounds, spec.res);
  return parseSTL(new TextEncoder().encode(text).buffer);
}

/** 读 golden 目录 STL 文件 */
function fileMesh(name) {
  const buf = readFileSync(path.join(ROOT, 'tests', 'golden', name));
  return parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const MODELS = [
  ['cube50.stl', () => fileMesh('cube50.stl')],
  ['plate20.stl', () => fileMesh('plate20.stl')],
  ['cylinder100.stl', () => fileMesh('cylinder100.stl')],
  ['tube_wall10.stl', () => fileMesh('tube_wall10.stl')],
  ['thinShell.stl', () => fileMesh('thinShell.stl')],
  ['lShape', () => genMesh(lShape)],
  ['boxShell', () => genMesh(boxShell)],
  ['longBlock', () => genMesh(longBlock)],
  ['twoHotspots', () => genMesh(twoHotspots)],
  ['tShape', () => genMesh(tShape)],
];

const out = { tag, generatedAt: new Date().toISOString(), models: [] };
for (const [name, getMesh] of MODELS) {
  const t0 = Date.now();
  try {
    const mesh = getMesh();
    const geometry = buildMesh(mesh).geometry;
    const hs = analyzeHotspots(mesh, geometry);
    out.models.push({
      model: name,
      triCount: mesh.triCount,
      status: hs.status,
      reason: hs.reason || null,
      hotspots: hs.hotspots.map(h => ({
        id: h.id, x: +h.x.toFixed(3), y: +h.y.toFixed(3), z: +h.z.toFixed(3),
        mc: +h.mc.toFixed(3), score: +(h.peaks?.[0]?.score ?? h.mc).toFixed(3),
        regionBBox: h.regionBBox || null,
      })),
      debug: { candidates: hs.debug.candidates, regions: hs.debug.regions, peaks: hs.debug.peaks, rejected: hs.debug.rejected, insidePoints: hs.debug.insidePoints, totalPoints: hs.debug.totalPoints, gs: hs.debug.gs, vs: hs.debug.vs ? +hs.debug.vs.toFixed(3) : null, elapsedMs: hs.debug.elapsedMs },
      elapsedMs: Date.now() - t0,
    });
  } catch (e) {
    out.models.push({ model: name, error: e.message });
  }
  console.log(`${name}: ${out.models[out.models.length - 1].status ?? 'ERR'} (${Date.now() - t0}ms)`);
}

const file = path.join(ROOT, 'tests', 'golden', `${tag}_V2_1_GOLDEN.json`);
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`\n已写入 ${file}`);
