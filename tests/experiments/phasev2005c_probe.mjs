// ============================================================
// PHASE V2.0-05C · Mc 收敛门禁**最小探针**（106.txt）
//
// 目的：只验证 V2.0-05B 的测试驱动能否真正改变 V3 采样分辨率，
//       并正确记录 Mc → riser D/H/Vr。**不做 Gate 判定**。
//
// 只跑 thickEnd × experimentalGs ∈ {64, 96, 128} = 3 次。
//
// 铁律（106.txt §一）：不改任何生产代码 / 引擎 / riser.js / V3 参数 /
//   opts.resolution / phase24 T5 / BASELINE.md / expected / 历史数据；不 commit。
//   本脚本是临时实验脚本（§一.13），落 tests/experiments/，不伪装成生产代码。
//
// 用法：node tests/experiments/phasev2005c_probe.mjs
// ============================================================
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { analyzeHotspotsV3 } from '../../js/engine/v3/hotspotV3.js';
import { coarseSample } from '../../js/engine/v3/sampling.js';
import { V3_DEFAULTS } from '../../js/engine/v3/configV3.js';
import { generate } from '../tools/hotspotGeometryGenerator.mjs';
import { runRiser } from '../../calcs/riser.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT_DIR = join(HERE, 'out');

const GS_LIST = [64, 96, 128];
const KIND = 'thickEnd';

/* ---------- 采样点集指纹（证明"是否真的用了不同网格"） ---------- */
function ptsFingerprint(pts) {
  if (!pts || !pts.length) return null;
  let h = 2166136261 >>> 0;
  for (const p of pts) {
    for (const v of p) {
      const q = Math.round(v * 1000);            // 1e-3 mm 量化（跨 gs 位级比较无意义）
      h ^= q & 0xffff; h = Math.imul(h, 16777619) >>> 0;
      h ^= (q >>> 16) & 0xffff; h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return h.toString(16).padStart(8, '0');
}

/* ---------- 未直接输出的量：按当前代码公式推导（标注 derived） ---------- */
/** refineSample（sampling.js:326）实际公式 */
const refineStrideFormula = (gs) => Math.max(1, Math.ceil(Math.cbrt(gs ** 3 / V3_DEFAULTS.refineMaxPoints)));
/** coarseSample（sampling.js:180）实际公式：注意用的是 nInside 与 coarseMaxPoints，不是 gs/8000 */
const coarseStrideFormula = (nInside) =>
  Math.max(1, Math.ceil(Math.cbrt(nInside / Math.max(1, Math.min(nInside, V3_DEFAULTS.coarseMaxPoints)))));

/* ============================================================ */
console.log('='.repeat(96));
console.log(`PHASE V2.0-05C 最小探针 —— ${KIND} × experimentalGs ∈ {${GS_LIST.join(', ')}}`);
console.log('='.repeat(96));

const { mesh, gt, triCount } = generate(KIND, {});
const geometryA = buildMesh(mesh).geometry;
console.log(`夹具：${KIND}  triCount=${triCount}  GT.expectMc=${gt.expectedHotspots[0].mc}`);
console.log('');

const runs = [];

for (const gs of GS_LIST) {
  const t0 = Date.now();

  // ① 权威路径：引擎入口（与生产同一条链）
  const geometry = buildMesh(mesh).geometry;
  const r = analyzeHotspotsV3(mesh, geometry, { experimentalGs: gs });
  const analyzeMs = Date.now() - t0;

  // ② 指纹路径：直接调 coarseSample，拿"实际采样点集"（引擎不含修改，仅复用）
  const cs = coarseSample(mesh, buildMesh(mesh).geometry, { experimentalGs: gs });
  // nInside（公式核验用；引擎未直接输出，从 vox.inside 计数）
  let nInside = 0;
  for (let i = 0; i < cs.vox.inside.length; i++) if (cs.vox.inside[i]) nInside++;

  const dc = r.debug?.coarse || {};
  const dr = r.debug?.refine || [];

  const hotspots = (r.hotspots || []).map((h, i) => ({
    index: i, hotspotId: h.hotspotId,
    position: h.position.map(v => +v.toFixed(4)),
    mc: +h.peakModulus.toFixed(6),
    regionVolumeMm3: Math.round(h.regionVolume),
    confidence: +h.confidence.toFixed(4),
  }));
  const main = hotspots[0] || null;
  const riserInputMc = main ? main.mc : null;

  // ③ riser：cw=0（隔离模数路径）。thickEnd 是合成件，无定义净重。
  const rs = riserInputMc != null
    ? runRiser({ mat: '球铁', mc_mode: 'direct', mc: riserInputMc, shape: 'cyl', hd_ratio: 1.0, cast_wt: 0 })
    : null;

  const rec = {
    geometry: KIND,
    experimentalGs: gs,
    experimentalGsHonored: dc.gs === gs,
    actualGs: dc.gs ?? null,
    actualVs: dc.vs != null ? +dc.vs.toFixed(6) : null,
    coarseStride: dc.stride ?? null,
    coarseStride_derived: coarseStrideFormula(nInside),
    coarseStride_matchesFormula: dc.stride === coarseStrideFormula(nInside),
    nInside,
    coarsePts: dc.pts ?? null,
    // ★ refine 网格的"有效采样间距"= vs × stride —— 决定 Mc 的真正的采样密度
    refineSpacings: dr.map(x => +(x.vs * refineStrideFormula(x.gs)).toFixed(4)),
    refineMinSpacing: dr.length ? Math.min(...dr.map(x => x.vs * refineStrideFormula(x.gs))) : null,
    refineMinVs: dr.length ? Math.min(...dr.map(x => x.vs)) : null,
    refineStrides: dr.map(x => refineStrideFormula(x.gs)),
    coarseSpacing: (dc.vs != null && dc.stride != null) ? +(dc.vs * dc.stride).toFixed(6) : null,
    estMinWall: dc.estMinWall != null ? +dc.estMinWall.toFixed(4) : null,
    coarseMaxM: dc.maxM != null ? +dc.maxM.toFixed(4) : null,
    coarsePeaks: dc.peaks ?? null,
    // 采样点集指纹（独立调用 coarseSample 所得）
    sampleFingerprint: {
      gs: cs.gs, vs: +cs.vs.toFixed(6), stride: cs.stride,
      ptsCount: cs.pts.length,
      spacing: +(cs.vs * cs.stride).toFixed(6),
      hash: ptsFingerprint(cs.pts),
    },
    refine: dr.map(x => ({
      peakPoint: x.region.map(v => +v.toFixed(2)),
      gs: x.gs,
      vs: +x.vs.toFixed(6),
      stride_derived: refineStrideFormula(x.gs),
      stride_source: 'derived（引擎 debug 不暴露 refine stride；按 sampling.js:326 公式）',
      spacing_derived: +(x.vs * refineStrideFormula(x.gs)).toFixed(6),
      pts: x.pts,
      maxM: x.maxM != null ? +x.maxM.toFixed(4) : null,
      peaks: (x.peaks || []).map(p => ({ M: +p.M.toFixed(4), pt: p.pt })),
    })),
    status: r.status,
    reason: r.reason ?? null,
    hotspotCount: hotspots.length,
    hotspots,
    mainHotspot: main ? { position: main.position, mc: main.mc } : null,
    riserInputMc,
    riser: rs ? {
      D: rs.D, H: rs.H, Vr: Math.round(rs.Vr),
      Mr_need: +rs.Mr_need.toFixed(6), Mr_act: +rs.Mr_act.toFixed(6),
      final_f: rs.final_f, modOk: rs.modOk, volOk: rs.volOk,
      d_neck: rs.d_neck, castWt: rs.cw,
    } : null,
    analyzeMs,
  };
  runs.push(rec);

  console.log(`gs=${String(gs).padStart(3)}  honored=${rec.experimentalGsHonored ? '✓' : '✗'}  ` +
    `actualGs=${String(rec.actualGs).padStart(3)}  vs=${rec.actualVs}  ` +
    `coarseStride=${rec.coarseStride}  coarsePts=${rec.coarsePts}  spacing=${rec.coarseSpacing}`);
  console.log(`        sampleFP: gs=${cs.gs} vs=${cs.vs.toFixed(4)} stride=${cs.stride} pts=${cs.pts.length} hash=${rec.sampleFingerprint.hash}`);
  console.log(`        status=${rec.status}  hot=${rec.hotspotCount}  mainMc=${rec.mainHotspot ? rec.mainHotspot.mc : '—'}`);
  for (const rf of rec.refine) {
    console.log(`        refine: gs=${rf.gs} vs=${rf.vs} stride(derived)=${rf.stride_derived} spacing=${rf.spacing_derived} pts=${rf.pts} maxM=${rf.maxM}`);
  }
  console.log(`        riser: Mc=${rec.riserInputMc} → D=${rs?.D} H=${rs?.H} Vr=${rs ? Math.round(rs.Vr) : '—'} Mr_need=${rs?.Mr_need.toFixed(3)} Mr_act=${rs?.Mr_act.toFixed(3)} modOk=${rs?.modOk} volOk=${rs?.volOk}`);
  console.log('');
}

/* ---------- §六 分辨率变化的三重证据 ---------- */
const gsSet = new Set(runs.map(r => r.actualGs));
const fpSet = new Set(runs.map(r => r.sampleFingerprint.hash));
const mcSet = new Set(runs.map(r => r.mainHotspot?.mc));
console.log('='.repeat(96));
console.log('§六 是否真的发生了分辨率变化');
console.log(`  actualGs 去重数 = ${gsSet.size}/3   ${[...gsSet].join(' / ')}`);
console.log(`  采样点集指纹去重数 = ${fpSet.size}/3   ${[...fpSet].join(' / ')}`);
console.log(`  主热点 Mc 去重数 = ${mcSet.size}/3   ${[...mcSet].join(' / ')}`);

mkdirSync(OUT_DIR, { recursive: true });
const outFile = join(OUT_DIR, 'phase_v2005c_mc_probe.json');
writeFileSync(outFile, JSON.stringify({
  phase: 'V2.0-05C', baseline: 'main @ da1c822', kind: KIND,
  experimentalGsList: GS_LIST, triCount, gtExpectMc: gt.expectedHotspots[0].mc,
  riserConfig: { mat: '球铁', shape: 'cyl', hd_ratio: 1.0, cast_wt: 0, note: 'cw=0 隔离模数路径（thickEnd 为合成件，无定义净重）' },
  runs,
}, null, 2));
console.log(`\n→ ${outFile}`);
