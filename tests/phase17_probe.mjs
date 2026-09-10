// ============================================================
// PHASE 17 只读诊断（21.txt 三：先验证根因，不改代码）
// 对每个模型完整追踪：
//   STL → geometry(wallMain/wallAvg/wallMax) → 16³探测(char 分布/p10)
//   → estMinWall → vs → layers → 正式采样 insidePoints → V3 status → warning 判据
// 模型：工程测试集 t01/t02（真实文件）+ 构造模型（内存直传，标注"构造"）
// 用法: node tests/phase17_probe.mjs
// ============================================================
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSTL } from '../js/engine/stl.js';
import { buildMesh } from '../js/engine/mesh3d.js';
import { analyzeGeometry } from '../js/engine/geometryAnalysis.js';
import { scanInside } from '../js/engine/distanceField.js';
import { distanceToSurface } from '../js/engine/mesh3d.js';
import { adaptiveVs, coarseSample } from '../js/engine/v3/sampling.js';
import { analyzeHotspotsV3 } from '../js/engine/v3/hotspotV3.js';
const HS_STATUS = { OK: 'OK', NO_HOTSPOT: 'NO_HOTSPOT', LOW_CONFIDENCE: 'LOW_CONFIDENCE', INSUFFICIENT_RESOLUTION: 'INSUFFICIENT_RESOLUTION' };
import { V3_DEFAULTS } from '../js/engine/v3/configV3.js';
import { tetMC, BOX, subtract } from './helpers/stlGen.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/* ================= 构造模型（内存直传 tetMC 顶点） ================= */
/** 壳：外 L×W×H，壁厚 w（差集构造，表面干净） */
const shell = (L, W, H, w) => ({
  sdf: subtract(
    BOX([-L / 2, -W / 2, -H / 2], [L / 2, W / 2, H / 2]),
    BOX([-(L / 2 - w), -(W / 2 - w), -(H / 2 - w)], [L / 2 - w, W / 2 - w, H / 2 - w]),
  ),
  bounds: [[-L / 2 - 5, -W / 2 - 5, -H / 2 - 5], [L / 2 + 5, W / 2 + 5, H / 2 + 5]],
});
/** 板 + 中部浅槽（槽底薄区）：主体厚 t，槽底剩 w 薄 */
const plateWithSlot = (L, W, t, w, slotW) => ({
  sdf: subtract(
    BOX([-L / 2, -W / 2, -t / 2], [L / 2, W / 2, t / 2]),
    BOX([-slotW / 2, -slotW / 2, t / 2 - (t - w)], [slotW / 2, slotW / 2, t / 2 + 1]),
  ),
  bounds: [[-L / 2 - 5, -W / 2 - 5, -t / 2 - 5], [L / 2 + 5, W / 2 + 5, t / 2 + 5]],
});
const plate = (L, W, t) => ({
  sdf: BOX([-L / 2, -W / 2, -t / 2], [L / 2, W / 2, t / 2]),
  bounds: [[-L / 2 - 5, -W / 2 - 5, -t / 2 - 5], [L / 2 + 5, W / 2 + 5, t / 2 + 5]],
});
const pickRes = (mdim, minFeature) => Math.min(160, Math.max(72, Math.ceil(2 * mdim / minFeature)));

/** 模型清单：{ id, src:'构造'|'工程文件', build() → {sdf, bounds, res} } */
const MODELS = [
  { id: 'shell1000_w20', src: '构造', desc: '1m 壳，壁 20mm（本次真实问题回归）', build: () => ({ ...shell(1000, 800, 600, 20), res: pickRes(1000, 20) }) },
  { id: 'shell1000_w30', src: '构造', desc: '1m 壳，壁 30mm', build: () => ({ ...shell(1000, 800, 600, 30), res: pickRes(1000, 30) }) },
  { id: 'shell500_w20', src: '构造', desc: '500mm 壳，壁 20mm', build: () => ({ ...shell(500, 400, 300, 20), res: pickRes(500, 20) }) },
  { id: 'shell1000_w3', src: '构造', desc: '1m 壳，壁 3mm（真薄壁）', build: () => ({ ...shell(1000, 800, 600, 3), res: 160 }) },
  { id: 'plate500_w10', src: '构造', desc: '500×500×10 板（探测失败兜底路径）', build: () => ({ ...plate(500, 500, 10), res: pickRes(500, 10) }) },
  { id: 'plate1000_w10', src: '构造', desc: '1000×1000×10 板（探测失败兜底路径）', build: () => ({ ...plate(1000, 1000, 10), res: pickRes(1000, 10) }) },
  { id: 'plate500_w20', src: '构造', desc: '500×500×20 板（p10 低估对照）', build: () => ({ ...plate(500, 500, 20), res: pickRes(500, 20) }) },
  { id: 'plate1000_w20_slot4', src: '构造', desc: '1m 板主体 20mm + 中部 4mm 薄区（主体正常+局部薄）', build: () => ({ ...plateWithSlot(1000, 800, 20, 4, 400), res: pickRes(1000, 4) }) },
  { id: 't01_boss100', src: '工程文件', desc: '20mm 主体 + 100mm Boss', build: () => null },
  { id: 't02_thin10_boss60', src: '工程文件', desc: '10mm 主体 + 60mm Boss', build: () => null },
];

const o = { ...V3_DEFAULTS };

/** 复刻 sampling.adaptiveVs Stage 1-2：16³ 探测 → char 分布（验证 p10 语义） */
function probeChars(geometry, bounds, globalMin, mdim) {
  const probeGs = 16;
  const probeVs = mdim / probeGs;
  const probe = scanInside(geometry, bounds, probeGs, probeVs, globalMin);
  const probePts = [];
  for (let i = 0; i < probeGs; i++) for (let j = 0; j < probeGs; j++) for (let k = 0; k < probeGs; k++) {
    if (!probe[(i * probeGs + j) * probeGs + k]) continue;
    probePts.push([bounds.min[0] + (i + 0.5) * probeVs, bounds.min[1] + (j + 0.5) * probeVs, bounds.min[2] + (k + 0.5) * probeVs]);
  }
  const dists = probePts.length ? distanceToSurface(geometry, probePts) : [];
  const chars = dists.filter(d => d !== null && d > 0.001 && d * 2 >= o.charFilterMin).map(d => d * 2).sort((a, b) => a - b);
  const q = (p) => chars.length ? chars[Math.min(chars.length - 1, Math.floor(chars.length * p))] : null;
  return {
    probeInside: probePts.length,
    nChars: chars.length,
    p10: q(0.10), p25: q(0.25), p50: q(0.50), p75: q(0.75), p90: q(0.90), cmax: chars.length ? chars[chars.length - 1] : null,
  };
}

async function main() {
  const rows = [];
  for (const m of MODELS) {
    let mesh;
    if (m.src === '工程文件') {
      mesh = parseSTL(readFileSync(join(HERE, 'engineering-generated', 'models', m.id, 'model.stl')));
    } else {
      const { sdf, bounds, res } = m.build();
      const verts = tetMC(sdf, bounds, res);
      mesh = { vertices: verts, triCount: verts.length / 9 };
    }
    const { geometry } = buildMesh(mesh);
    const g = analyzeGeometry(mesh, geometry);
    const bounds = { min: g.bounds.min, max: g.bounds.max, size: g.size };
    const mdim = Math.max(...g.size);
    const globalMin = bounds.min;

    // 16³ 探测 char 分布（验证 p10）
    const pc = probeChars(geometry, bounds, globalMin, mdim);

    // adaptiveVs（官方路径）
    const av = adaptiveVs(geometry, bounds, globalMin, o);

    // 正式粗采样
    const coarse = coarseSample(mesh, geometry, o);
    const layers = av.estMinWall ? +(av.estMinWall / av.vs).toFixed(2) : null;

    // V3 完整分析
    const v3 = analyzeHotspotsV3(mesh, geometry, {});
    const reason = v3.reason || null;

    // samplingWarn 判据复刻（v3ViewAdapter.samplingWarn 逻辑）
    const causes = [];
    if (layers !== null && layers < 2) causes.push(`判据① estMinWall/vs=${layers}<2`);
    if (g.wallMax > 0 && av.vs > g.wallMax) causes.push(`判据② vs=${av.vs.toFixed(1)}>wallMax=${g.wallMax.toFixed(1)}`);
    if (v3.status === HS_STATUS.INSUFFICIENT_RESOLUTION) causes.push(`判据③ status=INSUFFICIENT_RESOLUTION(${reason})`);

    rows.push({
      name: m.id, src: m.src, desc: m.desc,
      mdim: Math.round(mdim), size: g.size.map(v => Math.round(v)),
      wallMain: +g.wallMain.toFixed(1), wallAvg: +g.wallAvg.toFixed(1), wallMax: +g.wallMax.toFixed(1),
      estMinWall: +av.estMinWall.toFixed(1), vs: +av.vs.toFixed(2), layers,
      probeInside: pc.probeInside, nChars: pc.nChars,
      charP10: pc.p10 ? +pc.p10.toFixed(1) : null, charP50: pc.p50 ? +pc.p50.toFixed(1) : null,
      charP90: pc.p90 ? +pc.p90.toFixed(1) : null, charMax: pc.cmax ? +pc.cmax.toFixed(1) : null,
      insidePts: coarse.pts.length, status: v3.status, reason,
      warnCauses: causes,
    });
    console.log(`[${rows.length}/${MODELS.length}] ${m.id}: estMinWall=${rows.at(-1).estMinWall} vs=${rows.at(-1).vs} layers=${rows.at(-1).layers} pts=${rows.at(-1).insidePts} ${rows.at(-1).status} ${rows.at(-1).warnCauses.join(' | ')}`);
  }

  console.log('\n===== 诊断表 =====');
  console.log('name | src | mdim | wallMain | wallAvg | wallMax | estMinWall | vs | layers | probeIn | nChars | p10 | p50 | p90 | cMax | insidePts | status | warnCauses');
  for (const r of rows) {
    console.log([
      r.name, r.src, r.mdim, r.wallMain, r.wallAvg, r.wallMax, r.estMinWall, r.vs, r.layers,
      r.probeInside, r.nChars, r.charP10, r.charP50, r.charP90, r.charMax,
      r.insidePts, r.status, r.warnCauses.join(';') || '—',
    ].join(' | '));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
