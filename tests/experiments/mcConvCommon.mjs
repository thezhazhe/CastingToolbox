// ============================================================
// PHASE V2.0-05E / 05F 共享运行器（108.txt）
//
// 「combined resolution axis」= (experimentalGs, refineMaxPoints) 两参数组合：
//   experimentalGs   → 控制 coarse M field resolution（真正的场分辨率）
//   refineMaxPoints  → 控制 refine sampling stride（采样补偿轴）
// 05C 证明单看 experimentalGs 会混淆（采样反向变粗）；05D 证明单看 refineMaxPoints
// 对 Mc 零响应。本模块把两者组合，使 **field 变细的同时 refine 采样不反向变粗**。
//
// 铁律：不改任何生产代码 / 默认参数 / 引擎 / riser.js；本模块只调用现有导出。
// ============================================================
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSTL } from '../../js/engine/stl.js';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { analyzeHotspotsV3 } from '../../js/engine/v3/hotspotV3.js';
import { generate } from '../tools/hotspotGeometryGenerator.mjs';
import { runRiser } from '../../calcs/riser.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..', '..');

/**
 * 三个 combined resolution levels（108.txt §六 审计结论：默认候选满足全部 6 条条件）
 *   field 分辨率（coarse vs）：7.1875 → 4.7917 → 3.5938  严格变细
 *   主区 refine spacing      ：14.375 → 9.5833 → 7.1875  严格不变粗
 */
export const LEVELS = [
  { name: 'L1', experimentalGs: 64, refineMaxPoints: 8000 },
  { name: 'L2', experimentalGs: 96, refineMaxPoints: 32000 },
  { name: 'L3', experimentalGs: 128, refineMaxPoints: 128000 },
];

/** refineSample（sampling.js:326）实际公式 —— debug 不暴露 refine stride，故推导并标注 */
export const refineStride = (refGs, R) => Math.max(1, Math.ceil(Math.cbrt(refGs ** 3 / R)));

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : +((s[m - 1] + s[m]) / 2).toFixed(6);
};
export { median };

/* ---------- 夹具装载 ---------- */
export function loadGeometry(spec) {
  if (spec.stlPath) {
    const buf = readFileSync(spec.stlPath);
    const mesh = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    return { mesh, triCount: mesh.triCount, gt: null, source: spec.stlPath };
  }
  const { mesh, gt, triCount } = generate(spec.kind, spec.params || {});
  return { mesh, triCount, gt, source: `generator:${spec.kind}` };
}

/* ---------- 单档运行 ---------- */
export function runLevel(mesh, L, riserCfg, prebuiltGeometry = null) {
  const t0 = Date.now();
  const geometry = prebuiltGeometry || buildMesh(mesh).geometry;
  const r = analyzeHotspotsV3(mesh, geometry, {
    experimentalGs: L.experimentalGs,
    refineMaxPoints: L.refineMaxPoints,
  });
  const ms = Date.now() - t0;

  const dc = r.debug?.coarse || {};
  const dr = r.debug?.refine || [];

  const refineEntries = dr.map((x, i) => {
    const stride = refineStride(x.gs, L.refineMaxPoints);
    return {
      idx: i,
      peakPoint: x.region.map(v => +v.toFixed(2)),
      refGs: x.gs,
      vs: +x.vs.toFixed(6),
      stride,
      strideSource: 'derived（debug 不暴露 refine stride；按 sampling.js:326）',
      spacing: +(x.vs * stride).toFixed(6),
      pointCount: x.pts,
      maxM: x.maxM != null ? +x.maxM.toFixed(4) : null,
      peaks: (x.peaks || []).map(p => ({ M: +p.M.toFixed(4), pt: p.pt })),
    };
  });

  const hotspots = (r.hotspots || []).map((h, i) => ({
    index: i, hotspotId: h.hotspotId,
    position: h.position.map(v => +v.toFixed(4)),
    mc: +h.peakModulus.toFixed(6),
    regionVolumeMm3: Math.round(h.regionVolume),
    confidence: +h.confidence.toFixed(4),
    normalizedModulus: +h.normalizedModulus.toFixed(4),
  }));
  const main = hotspots[0] || null;

  // 主热点 ↔ refine 区域对应（按 peakPoint 距离；并用 maxM≈mainMc 交叉验证）
  let mainRegion = null;
  if (main && refineEntries.length) {
    const cand = refineEntries
      .map(e => ({
        idx: e.idx, refGs: e.refGs, spacing: e.spacing, stride: e.stride, maxM: e.maxM,
        dPeak: +Math.hypot(e.peakPoint[0] - main.position[0], e.peakPoint[1] - main.position[1], e.peakPoint[2] - main.position[2]).toFixed(2),
        dM: e.maxM != null ? +Math.abs(e.maxM - main.mc).toFixed(4) : null,
      }))
      .sort((a, b) => a.dPeak - b.dPeak);
    mainRegion = cand[0];
  }

  const rs = main
    ? runRiser({ mat: riserCfg.mat, mc_mode: 'direct', mc: main.mc, shape: riserCfg.shape, hd_ratio: riserCfg.hdRatio, cast_wt: riserCfg.castWt })
    : null;

  const spacings = refineEntries.map(e => e.spacing);

  return {
    level: L.name,
    experimentalGs: L.experimentalGs,
    refineMaxPoints: L.refineMaxPoints,
    coarse: {
      requestedGs: L.experimentalGs,
      actualGs: dc.gs ?? null,
      gsHonored: dc.gs === L.experimentalGs,
      vs: dc.vs != null ? +dc.vs.toFixed(6) : null,
      stride: dc.stride ?? null,
      spacing: (dc.vs != null && dc.stride != null) ? +(dc.vs * dc.stride).toFixed(6) : null,
      pointCount: dc.pts ?? null,
      estMinWall: dc.estMinWall != null ? +dc.estMinWall.toFixed(4) : null,
      maxM: dc.maxM != null ? +dc.maxM.toFixed(4) : null,
      peaks: dc.peaks ?? null,
    },
    refine: {
      regionCount: refineEntries.length,
      entries: refineEntries,
      minSpacing: spacings.length ? Math.min(...spacings) : null,
      maxSpacing: spacings.length ? Math.max(...spacings) : null,
      medianSpacing: median(spacings),
      strideDist: {
        s1: refineEntries.filter(e => e.stride === 1).length,
        s2: refineEntries.filter(e => e.stride === 2).length,
        s3: refineEntries.filter(e => e.stride >= 3).length,
      },
      totalPoints: refineEntries.reduce((a, e) => a + e.pointCount, 0),
    },
    mainRegion,
    // M field spacing = coarse 体素尺寸 vs（M 场就是在这个间距上定义的）
    mFieldSpacing: dc.vs != null ? +dc.vs.toFixed(6) : null,
    status: r.status,
    reason: r.reason ?? null,
    hotspotCount: hotspots.length,
    hotspots,
    mainHotspot: main,
    riserInputMc: main ? main.mc : null,
    riser: rs ? {
      Mr_need: +rs.Mr_need.toFixed(6), D: rs.D, H: rs.H, Vr: Math.round(rs.Vr),
      Mr_act: +rs.Mr_act.toFixed(6), final_f: rs.final_f,
      modOk: rs.modOk, volOk: rs.volOk, d_neck: rs.d_neck,
    } : null,
    analyzeMs: ms,
  };
}

/* ---------- 三档汇总与收敛统计 ---------- */
export function summarizeRuns(runs, riserCfg) {
  const mc = runs.map(r => r.mainHotspot?.mc ?? null);
  const D = runs.map(r => r.riser?.D ?? null);
  const H = runs.map(r => r.riser?.H ?? null);
  const Vr = runs.map(r => r.riser?.Vr ?? null);
  const pos = runs.map(r => r.mainHotspot?.position ?? null);
  const posFromL1 = pos[0] ? pos.map(p => p ? +Math.hypot(p[0] - pos[0][0], p[1] - pos[0][1], p[2] - pos[0][2]).toFixed(3) : null) : [];

  const rel = (a, b) => (a != null && b != null && b !== 0) ? +(((a - b) / b) * 100).toFixed(4) : null;
  const pct = (a, b) => (a != null && b != null && b !== 0) ? +(((a - b) / b) * 100).toFixed(4) : null;

  const finite = mc.filter(v => v != null);
  const span = finite.length >= 2
    ? +(((Math.max(...finite) - Math.min(...finite)) / Math.min(...finite)) * 100).toFixed(4)
    : null;

  // 工程输出观察项（05B Gate v1 的 |ΔD| ≤ 1mm，仅作观察）
  const dD12 = (D[0] != null && D[1] != null) ? D[1] - D[0] : null;
  const dD23 = (D[1] != null && D[2] != null) ? D[2] - D[1] : null;

  return {
    mc, dMc12: (mc[0] != null && mc[1] != null) ? +(mc[1] - mc[0]).toFixed(6) : null,
    dMc23: (mc[1] != null && mc[2] != null) ? +(mc[2] - mc[1]).toFixed(6) : null,
    dMc12pct: rel(mc[1], mc[0]), dMc23pct: rel(mc[2], mc[1]),
    mcSpanPct: span,
    D, H, Vr,
    dD12, dD23, dH12: (H[0] != null && H[1] != null) ? H[1] - H[0] : null,
    dH23: (H[1] != null && H[2] != null) ? H[2] - H[1] : null,
    dVr12pct: pct(Vr[1], Vr[0]), dVr23pct: pct(Vr[2], Vr[1]),
    hotspotCounts: runs.map(r => r.hotspotCount),
    mainPosition: pos,
    mainPositionDriftFromL1mm: posFromL1,
    prev: null,
    // 相邻档位置漂移
    mainPositionDrift12mm: (pos[0] && pos[1]) ? +Math.hypot(pos[1][0] - pos[0][0], pos[1][1] - pos[0][1], pos[1][2] - pos[0][2]).toFixed(3) : null,
    mainPositionDrift23mm: (pos[1] && pos[2]) ? +Math.hypot(pos[2][0] - pos[1][0], pos[2][1] - pos[1][1], pos[2][2] - pos[1][2]).toFixed(3) : null,
    mainRegionTrackable: runs.every(r => r.mainRegion && r.mainRegion.refGs === runs[0].mainRegion?.refGs) ? 'same-refGs' : 'changed',
    mFieldSpacings: runs.map(r => r.mFieldSpacing),
    mainRegionSpacings: runs.map(r => r.mainRegion?.spacing ?? null),
    riserConfig: riserCfg,
  };
}

/** §十四 变化分类 */
export function classify(sum) {
  const posDriftMax = Math.max(sum.mainPositionDrift12mm ?? 0, sum.mainPositionDrift23mm ?? 0);
  const mcSmall = sum.mcSpanPct != null && sum.mcSpanPct <= 5;
  const posSmall = posDriftMax <= 10;
  const engStable = (sum.dD12 == null || Math.abs(sum.dD12) <= 1) && (sum.dD23 == null || Math.abs(sum.dD23) <= 1);
  const counts = new Set(sum.hotspotCounts.filter(v => v != null));
  const peakSetChanged = counts.size > 1;
  const converging = sum.mcSpanPct != null && sum.mcSpanPct > 5
    && Math.abs(sum.dMc23pct ?? 999) < Math.abs(sum.dMc12pct ?? 999);

  if (peakSetChanged) return 'PEAK_SELECTION_SENSITIVE';
  if (mcSmall && posSmall && engStable) return 'STABLE';
  if (mcSmall && !posSmall) return 'NUMERICALLY_STABLE_POSITION_SENSITIVE';
  if (converging) return 'CONVERGING';
  if (sum.mcSpanPct != null && sum.mcSpanPct > 5) return 'UNSTABLE';
  return 'STABLE';
}

/* ---------- CSV ---------- */
export function toCsv(rows, cols) {
  const esc = (v) => v == null ? '' : (typeof v === 'string' && v.includes(',') ? `"${v}"` : String(v));
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
}
