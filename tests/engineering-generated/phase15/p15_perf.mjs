// ============================================================
// PHASE 15-G：性能测试（命令 15.txt 八）
// 同一几何体（管 ro250/ri200/h1000，壁 50）不同 tetMC 分辨率 →
// 三角数 ≈ 10万 / 30万 / 50万 / 100万（自动逼近）
// 分阶段计时：STL parse → buildMesh → voxelization(scanMs) → V/A+M场(fieldMs)
//            → detection(engineMs−scanMs−fieldMs) → total
// 确认无 O(N×M) 回潮（V2 实测：100 万面 raycast≈325s）
// 用法: node tests/engineering-generated/phase15/p15_perf.mjs
// ============================================================
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CYL_Y, subtract, tetMC } from '../../helpers/stlGen.js';
import { parseSTL } from '../../../js/engine/stl.js';
import { buildMesh } from '../../../js/engine/mesh3d.js';
import { analyzeHotspotsV3 } from '../../../js/engine/v3/hotspotV3.js';
import { DATA_DIR } from './p15_common.mjs';

const RO = 250, RI = 200, H = 1000;   // 管壁 50，mdim 1000
const BOUNDS = [[-RO, -H / 2, -RO], [RO, H / 2, RO]];
const PAD = [BOUNDS[0].map(v => v - 4), BOUNDS[1].map(v => v + 4)];
const SDF = subtract(CYL_Y(0, 0, RO, H), CYL_Y(0, 0, RI, H));
// 经验公式：tri ≈ 2×A/cell² = 5.94×res²（本几何 A≈2.97e6 mm²）
const RES_FOR = (target) => Math.round(Math.sqrt(target / 5.94));

function writeBinarySTL(vertices, triCount, file) {
  const buf = Buffer.alloc(84 + triCount * 50);
  buf.write('phase15 perf tube', 0, 80, 'ascii');
  buf.writeUInt32LE(triCount, 80);
  let o = 84;
  for (let t = 0; t < triCount; t++) {
    buf.writeFloatLE(0, o); buf.writeFloatLE(0, o + 4); buf.writeFloatLE(0, o + 8); o += 12;
    for (let k = 0; k < 3; k++) {
      const i = t * 9 + k * 3;
      buf.writeFloatLE(vertices[i], o); buf.writeFloatLE(vertices[i + 1], o + 4); buf.writeFloatLE(vertices[i + 2], o + 8); o += 12;
    }
    buf.writeUInt16LE(0, o); o += 2;
  }
  writeFileSync(file, buf);
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const TARGETS = [100_000, 300_000, 500_000, 1_000_000];
  const rows = [];
  console.log('PHASE 15-G 性能测试（管 ro250/ri200/h1000）\n');
  for (const target of TARGETS) {
    let res = RES_FOR(target);
    let verts = tetMC(SDF, PAD, res);
    let tri = verts.length / 9;
    // 一次自动校正（tri 偏差 >25% 时按 sqrt 比例调整）
    if (Math.abs(tri - target) > 0.25 * target) {
      res = Math.round(res * Math.sqrt(target / tri));
      verts = tetMC(SDF, PAD, res);
      tri = verts.length / 9;
    }
    const file = join(DATA_DIR, `perf_tube_${res}.stl`);
    writeBinarySTL(verts, tri, file);
    const fileSizeMB = (84 + tri * 50) / 1e6;

    // ① STL parse
    let t = Date.now();
    const mesh = parseSTL(readFileSync(file));
    const tParse = Date.now() - t;
    // ② buildMesh（BVH）
    t = Date.now();
    const geometry = buildMesh(mesh).geometry;
    const tGeom = Date.now() - t;
    // ③ 引擎（内部 scanMs/fieldMs）
    t = Date.now();
    const v3 = analyzeHotspotsV3(mesh, geometry);
    const tEngine = Date.now() - t;
    const scanMs = v3.debug.coarse?.scanMs ?? 0;
    const fieldMs = v3.debug.coarse?.fieldMs ?? 0;
    const detection = Math.max(0, tEngine - scanMs - fieldMs);

    rows.push({
      target, res, triCount: tri, fileSizeMB: +fileSizeMB.toFixed(1),
      ms: { parse: tParse, buildMesh: tGeom, voxelization: scanMs, vaField: fieldMs, detection, engine: tEngine, total: tParse + tGeom + tEngine },
      status: v3.status, hotspotCount: v3.hotspots.length,
      sampling: { vs: +(v3.debug.coarse?.vs ?? 0).toFixed(2), estMinWall: +(v3.debug.coarse?.estMinWall ?? 0).toFixed(1), pts: v3.debug.coarse?.pts, gs: v3.debug.coarse?.gs },
    });
    console.log(
      `${String(tri).padStart(8)} tri (res=${res})  parse=${tParse}ms  geom=${tGeom}ms  vox=${scanMs}ms  V/A=${fieldMs}ms  detect=${detection}ms  引擎=${tEngine}ms  总=${tParse + tGeom + tEngine}ms  ${v3.status}`);
  }
  writeFileSync(join(DATA_DIR, 'perf.json'), JSON.stringify(rows, null, 2));
  console.log(`\n→ ${join(DATA_DIR, 'perf.json')}`);
}
main().catch(e => { console.error(e); process.exit(1); });
