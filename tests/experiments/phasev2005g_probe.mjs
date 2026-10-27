// ============================================================
// PHASE V2.0-05G · Mc 系统性漂移根因诊断 / V3 冻结前最终探针（109.txt）
//
// 三个 geometry（GOOD / REAL / WORST）：thickEnd · HR4012 · pvpPair
// 四个 combined resolution level（L1/L2/L3 沿用 05E/05F；L4 新增）
//
// 本探针做两件事：
//   ① 正式结果 → 全部来自现有 production engine（analyzeHotspotsV3）——不替换、不注入
//   ② 诊断结果 → **DERIVED DIAGNOSTIC**：用 engine 已导出的部件（coarseSample /
//      findPeaks / refineSample / refineRegion / buildModulusField）等价复现
//      「主热点所在 refine 区域」的 M 场，用于统计 modulusCeilRatio 的截断情况。
//      复现保真度由 debug.refine[i].maxM / peaks[].M 与 engine 输出**逐位比对**保证；
//      不一致即报 REPLAY_MISMATCH，该档 ceiling 诊断作废。
//
// 铁律（109.txt §二）：不改 js/engine/**、calcs/riser.js、V3 默认参数、任何阈值、
//   expected/golden/baseline；不 commit。本文件只读调用现有导出。
//
// 用法：node tests/experiments/phasev2005g_probe.mjs thickEnd|HR4012|pvpPair|all
// ============================================================
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { computeBounds } from '../../js/engine/stl.js';
import { analyzeHotspotsV3 } from '../../js/engine/v3/hotspotV3.js';
import { coarseSample, refineSample, refineRegion, buildGridToPt } from '../../js/engine/v3/sampling.js';
import { buildModulusField } from '../../js/engine/v3/modulusField.js';
import { findPeaks } from '../../js/engine/v3/peakRegion.js';
import { V3_DEFAULTS } from '../../js/engine/v3/configV3.js';
import { runRiser } from '../../calcs/riser.js';
import { ROOT, loadGeometry, refineStride, median } from './mcConvCommon.mjs';

const OUT_DIR = join(ROOT, 'tests', 'experiments', 'out');
const RISER = { mat: '球铁', shape: 'cyl', hdRatio: 1.0, castWt: 0 };   // cast_wt=0 → 隔离 volume path（109.txt §十六）

/**
 * 四个 combined resolution level。
 * L1/L2/L3 = 05E/05F 已验证的轴（未改动）。
 * L4 = 109.txt §四：experimentalGs 优先 192；refineMaxPoints **按实际代码与几何推导**，
 *      不是机械取值 —— 推导见 docs/PHASE_V2.0-05G_MC_DRIFT_DIAGNOSTIC.md §2。
 */
const LEVELS = [
  { name: 'L1', experimentalGs: 64, refineMaxPoints: 8000 },
  { name: 'L2', experimentalGs: 96, refineMaxPoints: 32000 },
  { name: 'L3', experimentalGs: 128, refineMaxPoints: 128000 },
  { name: 'L4', experimentalGs: 192, refineMaxPoints: 600000 },
];

const GEOM_SPECS = {
  thickEnd: { kind: 'thickEnd' },
  pvpPair: { kind: 'pvpPair', params: { tA: 30, tB: 30, v: 15 } },
  HR4012: { stlPath: join(ROOT, 'tests', 'real-stl', 'HR4012塑料模具v4最早大板.stl') },
};

/* ============================================================
   ceiling 诊断（DERIVED —— 不是 engine 输出）
   ============================================================ */

/**
 * 对一个已算好的 M 场（field = buildModulusField 结果）统计 modulusCeilRatio 截断。
 * 判据（等价复现 modulusField.js:71-72 的语义）：
 *   未封顶 raw = V/A；封顶 M = min(raw, ratio × d)；capped ⟺ raw > M + eps
 * @param {{M,V,A:Float64Array}} field
 * @param {object} sample  与 field 对应的 sample（需 .dists）
 * @param {number} ratio   V3_DEFAULTS.modulusCeilRatio（只读引用，不修改）
 */
function ceilingStats(field, sample, ratio) {
  const n = field.M.length;
  const dArr = sample.dists || null;
  let nValid = 0, nCapped = 0, sumRaw = 0, sumM = 0, sumD = 0, nD = 0, nAtCap = 0;
  const overshoots = [];
  const raws = [];
  let maxOver = -Infinity;
  for (let t = 0; t < n; t++) {
    if (!(field.A[t] > 1e-9)) continue;
    nValid++;
    const raw = field.V[t] / field.A[t];
    const d = dArr ? dArr[t] : null;
    const cap = (d !== null && d > 0) ? ratio * d : Infinity;
    const capped = raw > field.M[t] + 1e-9;
    if (capped) { const ov = raw - field.M[t]; nCapped++; overshoots.push(ov); if (ov > maxOver) maxOver = ov; }
    if (d !== null && d > 0) { sumD += d; nD++; }
    if (cap !== Infinity && Math.abs(field.M[t] - cap) < 1e-12) nAtCap++;
    sumRaw += raw; sumM += field.M[t];
    raws.push(raw);
  }
  return {
    nValid, nCapped, nAtCap,
    cappedRatio: nValid ? +(nCapped / nValid).toFixed(6) : null,
    meanRaw: nValid ? +(sumRaw / nValid).toFixed(6) : null,
    meanM: nValid ? +(sumM / nValid).toFixed(6) : null,
    medianRaw: median(raws),
    meanD: nD ? +(sumD / nD).toFixed(6) : null,
    medianOvershoot: overshoots.length ? median(overshoots) : null,
    maxOvershoot: overshoots.length ? +maxOver.toFixed(6) : null,
  };
}

/** 单点 ceiling 诊断（主峰用） */
function pointCeiling(field, sample, t, ratio) {
  const A = field.A[t], V = field.V[t];
  const raw = A > 1e-9 ? V / A : null;
  const d = sample.dists ? sample.dists[t] : null;
  const cap = (d !== null && d > 0) ? ratio * d : null;
  return {
    raw: raw != null ? +raw.toFixed(6) : null,
    finalM: +field.M[t].toFixed(6),
    d: d != null ? +d.toFixed(6) : null,
    ceiling: cap != null ? +cap.toFixed(6) : null,
    capped: raw != null && raw > field.M[t] + 1e-9,
    R: +field.R[t].toFixed(6),
  };
}

/* ============================================================
   单档：正式 engine 结果 + 主区 ceiling 诊断
   ============================================================ */
function runLevel(mesh, geometry, bounds, L, riserCfg) {
  const o = { ...V3_DEFAULTS, experimentalGs: L.experimentalGs, refineMaxPoints: L.refineMaxPoints };
  const ratio = V3_DEFAULTS.modulusCeilRatio;   // 只读；严禁修改

  /* ---- ① 正式结果：production engine ---- */
  const t0 = Date.now();
  const r = analyzeHotspotsV3(mesh, geometry, o);
  const engineMs = Date.now() - t0;

  const dc = r.debug?.coarse || {};
  const dr = r.debug?.refine || [];
  const refineEntries = dr.map((x, i) => {
    const stride = refineStride(x.gs, L.refineMaxPoints);
    return {
      idx: i, skipped: x.skipped || null,
      center: x.region ? x.region.map(v => +v.toFixed(3)) : null,
      refGs: x.gs, vs: x.vs != null ? +x.vs.toFixed(6) : null,
      stride, spacing: x.vs != null ? +(x.vs * stride).toFixed(6) : null,
      pointCount: x.pts ?? null,
      maxM: x.maxM != null ? +x.maxM.toFixed(6) : null,
      // 注：engine debug 的 peaks[].pt 是**坐标数组**（hotspotV3.js: peaks.map(p => ({M, pt: ref.pts[p.pt]}))），不是索引
      peaks: (x.peaks || []).map(p => ({ M: +p.M.toFixed(6), pos: Array.isArray(p.pt) ? p.pt.map(v => +v.toFixed(3)) : null })),
    };
  });

  const hotspots = (r.hotspots || []).map((h, i) => ({
    index: i, position: h.position.map(v => +v.toFixed(4)),
    mc: +h.peakModulus.toFixed(6), normalizedModulus: +h.normalizedModulus.toFixed(4),
    confidence: +h.confidence.toFixed(4), regionVolumeMm3: Math.round(h.regionVolume),
    source: h.geometrySource,
  }));
  const main = hotspots[0] || null;
  const rs = main
    ? runRiser({ mat: riserCfg.mat, mc_mode: 'direct', mc: main.mc, shape: riserCfg.shape, hd_ratio: riserCfg.hdRatio, cast_wt: riserCfg.castWt })
    : null;

  // 主热点 → refine 区域（按 peak 位置距代表点最近，且 M 与 Mc 一致）
  let mainRegion = null;
  if (main) {
    const cand = [];
    for (const e of refineEntries) {
      if (e.skipped) continue;
      for (const p of e.peaks) {
        const dPeak = Math.hypot(p.pos[0] - main.position[0], p.pos[1] - main.position[1], p.pos[2] - main.position[2]);
        cand.push({ idx: e.idx, refGs: e.refGs, vs: e.vs, stride: e.stride, spacing: e.spacing, peakPos: p.pos, peakM: p.M, dPeak: +dPeak.toFixed(3), dM: +Math.abs(p.M - main.mc).toFixed(6) });
      }
    }
    cand.sort((a, b) => (a.dM - b.dM) || (a.dPeak - b.dPeak));
    mainRegion = cand[0] || null;
  }

  /* ---- ② 诊断复现：coarse 链 + 主区 M 场 ---- */
  const diag = { replay: 'not_run' };
  try {
    const tc = Date.now();
    const coarse = coarseSample(mesh, geometry, o);
    coarse.gridToPt = buildGridToPt(coarse.gs, coarse.vox.inside, coarse.insideIdx);
    const coarseField = buildModulusField(coarse.vox, coarse, o, 1.0);
    const coarsePeaks = findPeaks(coarseField.M, coarse, coarseField, o);
    diag.coarseCeiling = ceilingStats(coarseField, coarse, ratio);

    // coarse maxM 的峰点 ceiling（Mc 常等于 coarse maxM —— 需要知道它是否被封顶）
    let cMaxT = -1, cMaxV = -1;
    for (let t = 0; t < coarseField.M.length; t++) if (coarseField.M[t] > cMaxV) { cMaxV = coarseField.M[t]; cMaxT = t; }
    diag.coarseMaxPoint = cMaxT >= 0 ? pointCeiling(coarseField, coarse, cMaxT, ratio) : null;

    if (mainRegion) {
      const entry = dr[mainRegion.idx];
      // 用 engine debug 给出的 region 中心反查 coarsePeaks 中对应的 cp
      const c = entry.region;
      let cp = null;
      for (const p of coarsePeaks) {
        const q = coarse.pts[p.pt];
        if (Math.abs(q[0] - c[0]) < 1e-6 && Math.abs(q[1] - c[1]) < 1e-6 && Math.abs(q[2] - c[2]) < 1e-6) { cp = p; break; }
      }
      if (!cp) {
        diag.replay = 'CP_NOT_FOUND';
      } else {
        const rMed = Math.max(V3_DEFAULTS.charFloor, 1.0 * cp.R);
        const toCenter = Math.hypot(coarse.pts[cp.pt][0] - bounds.center[0], coarse.pts[cp.pt][1] - bounds.center[1], coarse.pts[cp.pt][2] - bounds.center[2]);
        const regR = Math.max(rMed, Math.min(toCenter, 2 * rMed));
        const region = refineRegion(bounds, coarse.pts[cp.pt], regR, 1.0);
        const ref = refineSample(geometry, region, coarse.globalMin, coarse.vs, o);
        ref.gridToPt = buildGridToPt(ref.gs, ref.vox.inside, ref.insideIdx);
        const refField = buildModulusField(coarse.vox, ref, o, 1.0);
        const peaks = findPeaks(refField.M, ref, refField, o);

        // 保真度校验：refField.maxM 与 engine debug 逐位一致
        const maxMOk = entry.maxM != null && Math.abs(refField.maxM - entry.maxM) < 1e-9;
        const engPeakMs = (entry.peaks || []).map(p => +p.M.toFixed(6)).sort((a, b) => b - a);
        const myPeakMs = peaks.map(p => +p.M.toFixed(6)).sort((a, b) => b - a);
        const peaksOk = engPeakMs.length === myPeakMs.length && engPeakMs.every((v, i) => Math.abs(v - myPeakMs[i]) < 1e-9);
        diag.replay = (maxMOk && peaksOk) ? 'OK' : (maxMOk ? 'PEAKS_MISMATCH' : 'MAXM_MISMATCH');
        diag.replayFields = { engineMaxM: entry.maxM, replayMaxM: +refField.maxM.toFixed(6), enginePeaks: engPeakMs.length, replayPeaks: myPeakMs.length };
        diag.refineCeiling = ceilingStats(refField, ref, ratio);
        diag.refineVs = +ref.vs.toFixed(6);
        diag.refineGs = ref.gs;
        diag.refineStride = ref.stride;
        diag.refinePts = ref.pts.length;
        // 主峰点自身的 ceiling
        const mt = peaks.find(p => Math.abs(p.M - main.mc) < 1e-9) || peaks[0];
        diag.mainPeakCeiling = mt ? pointCeiling(refField, ref, mt.pt, ratio) : null;
      }
    }
    diag.replayMs = Date.now() - tc;
  } catch (e) {
    diag.replay = 'ERROR: ' + e.message;
  }

  return {
    level: L.name, experimentalGs: L.experimentalGs, refineMaxPoints: L.refineMaxPoints,
    engineMs,
    coarse: {
      requestedGs: L.experimentalGs, actualGs: dc.gs ?? null, honored: dc.gs === L.experimentalGs,
      vs: dc.vs != null ? +dc.vs.toFixed(6) : null, stride: dc.stride ?? null,
      pointCount: dc.pts ?? null, maxM: dc.maxM != null ? +dc.maxM.toFixed(6) : null,
      peaks: dc.peaks ?? null, estMinWall: dc.estMinWall != null ? +dc.estMinWall.toFixed(4) : null,
    },
    refine: { regionCount: dr.filter(x => !x.skipped).length, entries: refineEntries },
    mainRegion, status: r.status, reason: r.reason ?? null,
    hotspotCount: hotspots.length, hotspots, mainHotspot: main,
    riser: rs ? { Mr_need: +rs.Mr_need.toFixed(6), D: rs.D, H: rs.H, Vr: Math.round(rs.Vr), Mr_act: +rs.Mr_act.toFixed(6), modOk: rs.modOk, d_neck: rs.d_neck } : null,
    diag,
  };
}

/* ============================================================
   主流程
   ============================================================ */
const arg = (process.argv[2] || 'all').trim();
const names = arg === 'all' ? ['thickEnd', 'HR4012', 'pvpPair'] : [arg];
for (const n of names) if (!GEOM_SPECS[n]) { console.error(`未知 geometry: ${n}`); process.exit(1); }

console.log('='.repeat(120));
console.log('PHASE V2.0-05G · Mc 系统性漂移根因诊断');
console.log('  L1 gs64/R8000   L2 gs96/R32000   L3 gs128/R128000   L4 gs192/R600000');
console.log('  riser: 球铁 / cyl / hd=1 / cast_wt=0（隔离 volume path）');
console.log('  modulusCeilRatio = ' + V3_DEFAULTS.modulusCeilRatio + '（只读，严禁修改）');
console.log('='.repeat(120));

const out = [];
for (const name of names) {
  const t0 = Date.now();
  const { mesh, gt, triCount, source } = loadGeometry(GEOM_SPECS[name]);
  const geometry = buildMesh(mesh).geometry;
  const bounds = computeBounds(mesh.vertices, mesh.triCount);   // 与 engine 同一实现
  const mdim = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]);
  console.log(`\n${'█'.repeat(3)} 【${name}】 tri=${triCount}  mdim=${mdim.toFixed(1)}mm  来源=${source.startsWith('generator') ? source : 'file'}${gt ? '  GT.expectMc=' + gt.expectedHotspots[0]?.mc + '（仅参考）' : ''}`);

  const runs = [];
  for (const L of LEVELS) {
    const r = runLevel(mesh, geometry, bounds, L, RISER);
    runs.push(r);
    const mr = r.mainRegion;
    console.log(
      `  ${L.name} gs=${String(r.coarse.actualGs).padStart(3)} vs=${String(r.coarse.vs).padStart(9)} | 主区 refGs=${String(mr?.refGs).padStart(3)} vs=${String(mr?.vs).padStart(9)} stride=${mr?.stride} spacing=${String(mr?.spacing).padStart(9)} | ${String(r.status).padEnd(5)} hot=${r.hotspotCount} Mc=${r.mainHotspot ? r.mainHotspot.mc.toFixed(4) : '—'} | D=${r.riser?.D} H=${r.riser?.H} Vr=${r.riser?.Vr} | ${r.engineMs}ms | replay=${r.diag.replay}`);
    if (r.diag.refineCeiling) {
      const c = r.diag.refineCeiling;
      console.log(`        ceiling: 主区点=${c.nValid} 封顶=${c.nCapped} (${(c.cappedRatio * 100).toFixed(2)}%) | 峰点 raw=${r.diag.mainPeakCeiling?.raw} M=${r.diag.mainPeakCeiling?.finalM} d=${r.diag.mainPeakCeiling?.d} ceil=${r.diag.mainPeakCeiling?.ceiling} capped=${r.diag.mainPeakCeiling?.capped}`);
    }
  }

  /* ---- 四档表 ---- */
  const mc = runs.map(r => r.mainHotspot?.mc ?? null);
  const rel = (a, b) => (a != null && b != null && b !== 0) ? +(((a - b) / b) * 100).toFixed(4) : null;
  const finite = mc.filter(v => v != null);
  const span = finite.length >= 2 ? +(((Math.max(...finite) - Math.min(...finite)) / Math.min(...finite)) * 100).toFixed(4) : null;
  const summary = {
    mc,
    dMc: [rel(mc[1], mc[0]), rel(mc[2], mc[1]), rel(mc[3], mc[2])],
    mcSpanPct: span,
    D: runs.map(r => r.riser?.D ?? null), H: runs.map(r => r.riser?.H ?? null), Vr: runs.map(r => r.riser?.Vr ?? null),
    dD: [
      (runs[1].riser && runs[0].riser) ? runs[1].riser.D - runs[0].riser.D : null,
      (runs[2].riser && runs[1].riser) ? runs[2].riser.D - runs[1].riser.D : null,
      (runs[3].riser && runs[2].riser) ? runs[3].riser.D - runs[2].riser.D : null,
    ],
    dVrPct: [rel(runs[1].riser?.Vr, runs[0].riser?.Vr), rel(runs[2].riser?.Vr, runs[1].riser?.Vr), rel(runs[3].riser?.Vr, runs[2].riser?.Vr)],
    mFieldVs: runs.map(r => r.coarse.vs),
    mainSpacing: runs.map(r => r.mainRegion?.spacing ?? null),
    spacingMonotoneNonIncreasing: (() => {
      const s = runs.map(r => r.mainRegion?.spacing ?? null);
      return s.every((v, i) => i === 0 || (v != null && s[i - 1] != null && v <= s[i - 1] + 1e-9));
    })(),
    fieldVsMonotoneDecreasing: (() => {
      const s = runs.map(r => r.coarse.vs);
      return s.every((v, i) => i === 0 || (v != null && s[i - 1] != null && v < s[i - 1] - 1e-9));
    })(),
    repPosDrift: [0, 1, 2].map(i => (runs[i + 1].mainHotspot && runs[i].mainHotspot)
      ? +Math.hypot(runs[i + 1].mainHotspot.position[0] - runs[i].mainHotspot.position[0], runs[i + 1].mainHotspot.position[1] - runs[i].mainHotspot.position[1], runs[i + 1].mainHotspot.position[2] - runs[i].mainHotspot.position[2]).toFixed(3) : null),
    // 主**峰点**（argmax，与代表点质心是两件事——109.txt §十五）逐档漂移
    peakPosDrift: [0, 1, 2].map(i => {
      const a = runs[i].mainRegion?.peakPos, b = runs[i + 1].mainRegion?.peakPos;
      return (a && b) ? +Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]).toFixed(3) : null;
    }),
    hotspotCounts: runs.map(r => r.hotspotCount),
    cappedRatio: runs.map(r => r.diag.refineCeiling?.cappedRatio ?? null),
    cappedCount: runs.map(r => r.diag.refineCeiling?.nCapped ?? null),
    validCount: runs.map(r => r.diag.refineCeiling?.nValid ?? null),
    coarseCappedRatio: runs.map(r => r.diag.coarseCeiling?.cappedRatio ?? null),
    confidences: runs.map(r => r.mainHotspot?.confidence ?? null),
    replayStatus: runs.map(r => r.diag.replay),
  };

  console.log(`  ── ΔMc(L1→L2/L2→L3/L3→L4) = ${summary.dMc.map(v => v == null ? '—' : v.toFixed(4) + '%').join(' / ')}   span=${span}%`);
  console.log(`  ── field vs 严格下降=${summary.fieldVsMonotoneDecreasing}  ${summary.mFieldVs.join(' > ')}`);
  console.log(`  ── 主区 spacing 不增=${summary.spacingMonotoneNonIncreasing}  ${summary.mainSpacing.join(' >= ')}`);
  console.log(`  ── capped ratio = ${summary.cappedRatio.map(v => v == null ? '—' : (v * 100).toFixed(2) + '%').join(' / ')}   （全部点）`);
  console.log(`  ── 代表点漂移 = ${summary.repPosDrift.map(v => v == null ? '—' : v + 'mm').join(' / ')}   主峰点漂移 = ${summary.peakPosDrift.map(v => v == null ? '—' : v + 'mm').join(' / ')}`);
  console.log(`  ── D=${summary.D.join('/')}  H=${summary.H.join('/')}  Vr=${summary.Vr.join('/')}  ΔVr=${summary.dVrPct.map(v => v == null ? '—' : v.toFixed(2) + '%').join('/')}`);
  console.log(`  ── 总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  out.push({ geometry: name, triCount, mdim: +mdim.toFixed(3), gtExpectMc: gt?.expectedHotspots?.[0]?.mc ?? null, runs, summary });
}

/* ---- 输出 ---- */
if (arg === 'all') {
  mkdirSync(OUT_DIR, { recursive: true });
  const jf = join(OUT_DIR, 'phasev2005g_mc_drift.json');
  writeFileSync(jf, JSON.stringify({
    phase: 'V2.0-05G', baseline: 'main @ da1c822', levels: LEVELS,
    riserConfig: RISER, modulusCeilRatio: V3_DEFAULTS.modulusCeilRatio,
    note: 'diag.* = DERIVED DIAGNOSTIC（等价复现主区 M 场，非 engine 输出）；Mc/position/riser 均来自 production engine',
    geometries: out,
  }, null, 2));
  const rows = [];
  for (const g of out) for (const r of g.runs) {
    rows.push({
      geometry: g.geometry, level: r.level, experimentalGs: r.experimentalGs, refineMaxPoints: r.refineMaxPoints,
      coarseGs: r.coarse.actualGs, coarseVs: r.coarse.vs, coarseStride: r.coarse.stride, coarsePts: r.coarse.pointCount, coarseMaxM: r.coarse.maxM,
      mainRefGs: r.mainRegion?.refGs, mainRefVs: r.mainRegion?.vs, mainStride: r.mainRegion?.stride, mainSpacing: r.mainRegion?.spacing,
      refineRegionCount: r.refine.regionCount, hotspotCount: r.hotspotCount,
      mc: r.mainHotspot?.mc, x: r.mainHotspot?.position[0], y: r.mainHotspot?.position[1], z: r.mainHotspot?.position[2],
      confidence: r.mainHotspot?.confidence, regionVolumeMm3: r.mainHotspot?.regionVolumeMm3,
      D: r.riser?.D, H: r.riser?.H, Vr: r.riser?.Vr, Mr_need: r.riser?.Mr_need, Mr_act: r.riser?.Mr_act, modOk: r.riser?.modOk,
      cappedRatio: r.diag.refineCeiling?.cappedRatio, cappedCount: r.diag.refineCeiling?.nCapped, validCount: r.diag.refineCeiling?.nValid,
      coarseCappedRatio: r.diag.coarseCeiling?.cappedRatio,
      peakRaw: r.diag.mainPeakCeiling?.raw, peakM: r.diag.mainPeakCeiling?.finalM, peakD: r.diag.mainPeakCeiling?.d,
      peakCeiling: r.diag.mainPeakCeiling?.ceiling, peakCapped: r.diag.mainPeakCeiling?.capped,
      replay: r.diag.replay, engineMs: r.engineMs,
    });
  }
  const cols = Object.keys(rows[0]);
  writeFileSync(join(OUT_DIR, 'phasev2005g_mc_drift.csv'),
    [cols.join(','), ...rows.map(r => cols.map(c => r[c] == null ? '' : String(r[c])).join(','))].join('\n'));
  console.log(`\n→ ${jf}`);
}
