// ============================================================
// 分片引擎回归：sliced（UI 分片版）结果必须与同步版完全一致
// 保护：导入大模型时 UI 分片执行不改变分析结果（命令6 十二节）
// ============================================================
import { parseSTL } from '../js/engine/stl.js';
import { buildMesh } from '../js/engine/mesh3d.js';
import { analyzeGeometry, analyzeGeometrySliced } from '../js/engine/geometryAnalysis.js';
import { analyzeHotspots, analyzeHotspotsSliced } from '../js/engine/hotspot.js';
import { genSTL, BOX, subtract, twoHotspots, boxShell } from './helpers/stlGen.js';

const yieldFn = () => Promise.resolve();   // 分片但不等实际定时器（结果与同步版逐位一致）

async function compare(name, model) {
  const mesh = parseSTL(genSTL(model.sdf, model.bounds, model.res ?? 48));
  const geometry = buildMesh(mesh).geometry;
  const a1 = analyzeGeometry(mesh, geometry);
  const a2 = await analyzeGeometrySliced(mesh, geometry, {}, yieldFn);
  const same = (x, y) => Math.abs(x - y) < 1e-6;
  if (!same(a1.volume, a2.volume)) throw new Error(`${name}: volume 不一致 ${a1.volume} vs ${a2.volume}`);
  if (!same(a1.wallMax, a2.wallMax)) throw new Error(`${name}: wallMax 不一致 ${a1.wallMax} vs ${a2.wallMax}`);
  if (!same(a1.wallMain, a2.wallMain)) throw new Error(`${name}: wallMain 不一致 ${a1.wallMain} vs ${a2.wallMain}`);
  if (a1.res.gs !== a2.res.gs || a1.res.insidePoints !== a2.res.insidePoints) {
    throw new Error(`${name}: 网格参数不一致 ${JSON.stringify(a1.res)} vs ${JSON.stringify(a2.res)}`);
  }
  const h1 = analyzeHotspots(mesh, geometry);
  const h2 = await analyzeHotspotsSliced(mesh, geometry, {}, yieldFn);
  if (h1.status !== h2.status) throw new Error(`${name}: hotspot 状态不一致 ${h1.status} vs ${h2.status}`);
  if (h1.hotspots.length !== h2.hotspots.length) {
    throw new Error(`${name}: 热结数量不一致 ${h1.hotspots.length} vs ${h2.hotspots.length}`);
  }
  for (let i = 0; i < h1.hotspots.length; i++) {
    const p = h1.hotspots[i], q = h2.hotspots[i];
    if (Math.abs(p.x - q.x) > 1e-6 || Math.abs(p.y - q.y) > 1e-6 || Math.abs(p.z - q.z) > 1e-6) {
      throw new Error(`${name}: 热结 #${i} 位置不一致 (${p.x},${p.y},${p.z}) vs (${q.x},${q.y},${q.z})`);
    }
    if (Math.abs(p.mc - q.mc) > 1e-6) throw new Error(`${name}: 热结 #${i} mc 不一致 ${p.mc} vs ${q.mc}`);
  }
  geometry.dispose();
}

export const tests = [
  { name: 'sliced 与同步一致（cube50 实体）', fn: () => compare('cube50', { sdf: BOX([0, 0, 0], [50, 50, 50]), bounds: [[-2, -2, -2], [52, 52, 52]] }) },
  { name: 'sliced 与同步一致（plate20 薄板）', fn: () => compare('plate20', { sdf: BOX([0, 0, 0], [200, 20, 200]), bounds: [[-2, -2, -2], [202, 22, 202]] }) },
  { name: 'sliced 与同步一致（空心筒）', fn: () => compare('tube', { sdf: subtract(BOX([0, 0, 0], [100, 100, 100]), BOX([5, 5, 5], [95, 95, 95])), bounds: [[-2, -2, -2], [102, 102, 102]], res: 72 }) },
  { name: 'sliced 与同步一致（twoHotspots 双热结）', fn: () => compare('twoHotspots', twoHotspots()) },
  { name: 'sliced 与同步一致（boxShell 空腔壳体）', fn: () => compare('boxShell', boxShell()) },
];
