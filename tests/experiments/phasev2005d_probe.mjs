// ============================================================
// PHASE V2.0-05D · refineMaxPoints 收敛探针（107.txt）
//
// 目的：验证 refineMaxPoints 是否构成"真正单调变细"的 Mc 采样轴。
//   （05C 已证 experimentalGs 扫错了轴：它只动 coarse，而 Mc 来自 refine。）
//
// 只跑 thickEnd × refineMaxPoints ∈ {8000, 32000, 128000} = 3 次
// 固定 experimentalGs = 96（05C 已证它能正常进入 V3）
//
// 铁律（107.txt §二）：不改生产代码 / 引擎 / riser.js / 默认参数 /
//   experimentalGs 行为 / opts.resolution / Gate 阈值 / expected；不 commit。
//   临时脚本落 tests/experiments/，不伪装成生产代码。
//
// 用法：node tests/experiments/phasev2005d_probe.mjs
// ============================================================
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { analyzeHotspotsV3 } from '../../js/engine/v3/hotspotV3.js';
import { V3_DEFAULTS } from '../../js/engine/v3/configV3.js';
import { generate } from '../tools/hotspotGeometryGenerator.mjs';
import { runRiser } from '../../calcs/riser.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, 'out');

const KIND = 'thickEnd';
const FIXED_Gs = 96;                      // 107.txt §三 推荐固定
const R_LIST = [8000, 32000, 128000];     // LOW / MID / HIGH

/** refineSample（sampling.js:326）实际公式 —— debug 不暴露 refine stride，故推导并标注 */
const refineStride = (refGs, R) => Math.max(1, Math.ceil(Math.cbrt(refGs ** 3 / R)));

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* ============================================================ */
console.log('='.repeat(100));
console.log(`PHASE V2.0-05D · ${KIND} × refineMaxPoints ∈ {${R_LIST.join(', ')}}  (experimentalGs=${FIXED_Gs} 固定)`);
console.log('='.repeat(100));

const { mesh, gt, triCount } = generate(KIND, {});
console.log(`夹具：${KIND}  triCount=${triCount}  GT.expectMc=${gt.expectedHotspots[0].mc}（仅参照，非本阶段判据）`);
console.log('');

const runs = [];

for (const R of R_LIST) {
  const t0 = Date.now();
  const geometry = buildMesh(mesh).geometry;
  const r = analyzeHotspotsV3(mesh, geometry, { experimentalGs: FIXED_Gs, refineMaxPoints: R });
  const analyzeMs = Date.now() - t0;

  const dc = r.debug?.coarse || {};
  const dr = r.debug?.refine || [];

  const refineEntries = dr.map((x, i) => {
    const stride = refineStride(x.gs, R);
    return {
      idx: i,
      peakPoint: x.region.map(v => +v.toFixed(2)),
      refGs: x.gs,
      vs: +x.vs.toFixed(6),
      stride,
      strideSource: 'derived（debug 不暴露 refine stride；按 sampling.js:326 公式）',
      spacing: +(x.vs * stride).toFixed(6),
      pointCount: x.pts,
      maxM: x.maxM != null ? +x.maxM.toFixed(4) : null,
      peaks: (x.peaks || []).map(p => ({ M: +p.M.toFixed(4), pt: p.pt })),
    };
  });

  const spacings = refineEntries.map(e => e.spacing);
  const strides = refineEntries.map(e => e.stride);

  const hotspots = (r.hotspots || []).map((h, i) => ({
    index: i, hotspotId: h.hotspotId,
    position: h.position.map(v => +v.toFixed(4)),
    mc: +h.peakModulus.toFixed(6),
    regionVolumeMm3: Math.round(h.regionVolume),
    confidence: +h.confidence.toFixed(4),
  }));
  const main = hotspots[0] || null;
  const riserInputMc = main ? main.mc : null;

  const rs = riserInputMc != null
    ? runRiser({ mat: '球铁', mc_mode: 'direct', mc: riserInputMc, shape: 'cyl', hd_ratio: 1.0, cast_wt: 0 })
    : null;

  // 主热点最可能来自哪个 refine 区域：按其 maxM 与 Mc 接近程度 + peakPoint 与 position 距离
  let mainEntry = null;
  if (main) {
    const cand = refineEntries
      .map(e => ({ idx: e.idx, d: Math.hypot(e.peakPoint[0] - main.position[0], e.peakPoint[1] - main.position[1], e.peakPoint[2] - main.position[2]) }))
      .sort((a, b) => a.d - b.d);
    mainEntry = cand.length ? { idx: cand[0].idx, distMm: +cand[0].d.toFixed(2) } : null;
  }

  const rec = {
    geometry: KIND,
    experimentalGs: FIXED_Gs,
    experimentalGsHonored: dc.gs === FIXED_Gs,
    refineMaxPoints: R,
    coarse: {
      gs: dc.gs ?? null, vs: dc.vs != null ? +dc.vs.toFixed(6) : null,
      stride: dc.stride ?? null,
      spacing: (dc.vs != null && dc.stride != null) ? +(dc.vs * dc.stride).toFixed(6) : null,
      pointCount: dc.pts ?? null,
      estMinWall: dc.estMinWall != null ? +dc.estMinWall.toFixed(4) : null,
      maxM: dc.maxM != null ? +dc.maxM.toFixed(4) : null,
      peaks: dc.peaks ?? null,
    },
    refine: {
      entries: refineEntries,
      entryCount: refineEntries.length,
      strides,
      strideDist: { s1: strides.filter(s => s === 1).length, s2: strides.filter(s => s === 2).length, s3: strides.filter(s => s >= 3).length },
      minSpacing: spacings.length ? Math.min(...spacings) : null,
      maxSpacing: spacings.length ? Math.max(...spacings) : null,
      medianSpacing: median(spacings),
      // ★ 与 Mc 直接相关的那个区域（主热点所在 refine 区域）的采样间距 —— 真正的轴
      mainRegionSpacing: mainEntry ? refineEntries[mainEntry.idx].spacing : null,
      mainRegionRefGs: mainEntry ? refineEntries[mainEntry.idx].refGs : null,
      mainRegionStride: mainEntry ? refineEntries[mainEntry.idx].stride : null,
    },
    status: r.status,
    reason: r.reason ?? null,
    hotspotCount: hotspots.length,
    hotspots,
    mainHotspot: main ? { position: main.position, mc: main.mc } : null,
    mainEntry,
    riserInputMc,
    riser: rs ? {
      D: rs.D, H: rs.H, Vr: Math.round(rs.Vr),
      Mr_need: +rs.Mr_need.toFixed(6), Mr_act: +rs.Mr_act.toFixed(6),
      final_f: rs.final_f, modOk: rs.modOk, volOk: rs.volOk, d_neck: rs.d_neck,
    } : null,
    analyzeMs,
  };
  runs.push(rec);

  console.log(`R=${String(R).padStart(6)}  coarse[gs=${rec.coarse.gs} vs=${rec.coarse.vs} stride=${rec.coarse.stride} pts=${rec.coarse.pointCount}]`);
  console.log(`          refine: ${rec.refine.entryCount} 区  strides=${JSON.stringify(strides)}  (s1=${rec.refine.strideDist.s1}/${rec.refine.entryCount})`);
  console.log(`          spacing: min=${rec.refine.minSpacing}  median=${rec.refine.medianSpacing}  max=${rec.refine.maxSpacing}   ★主区(refGs=${rec.refine.mainRegionRefGs}) stride=${rec.refine.mainRegionStride} spacing=${rec.refine.mainRegionSpacing}`);
  console.log(`          status=${rec.status}  hot=${rec.hotspotCount}  mainMc=${rec.mainHotspot ? rec.mainHotspot.mc : '—'}  mainPos=${rec.mainHotspot ? JSON.stringify(rec.mainHotspot.position) : '—'}`);
  console.log(`          riser: Mc=${riserInputMc} → D=${rs?.D} H=${rs?.H} Vr=${rs ? Math.round(rs.Vr) : '—'} Mr_need=${rs?.Mr_need.toFixed(3)} Mr_act=${rs?.Mr_act.toFixed(3)}`);
  console.log('');
}

/* ---------- 轴单调性检查 ---------- */
console.log('='.repeat(100));
console.log('轴单调性（refineMaxPoints ↑ ⇒ spacing ↓ ?）');
const mins = runs.map(r => r.refine.minSpacing);
const meds = runs.map(r => r.refine.medianSpacing);
const maxs = runs.map(r => r.refine.maxSpacing);
const mains = runs.map(r => r.refine.mainRegionSpacing);
const mono = (a, dir) => a.every((v, i) => i === 0 || (dir > 0 ? v >= a[i - 1] : v <= a[i - 1]));
console.log(`  min    : ${mins.join('  →  ')}   ${mono(mins, -1) ? '✓ 单调不增' : '✗'} （注：被 vs 地板锁住时恒等）`);
console.log(`  median : ${meds.join('  →  ')}   ${mono(meds, -1) ? '✓ 单调不增' : '✗'}`);
console.log(`  max    : ${maxs.join('  →  ')}   ${mono(maxs, -1) ? '✓ 单调不增' : '✗'}`);
console.log(`  ★主区  : ${mains.join('  →  ')}   ${mono(mains, -1) ? '✓ 单调不增' : '✗'}`);

mkdirSync(OUT_DIR, { recursive: true });
const outFile = join(OUT_DIR, 'phase_v2005d_refine_probe.json');
writeFileSync(outFile, JSON.stringify({
  phase: 'V2.0-05D', baseline: 'main @ da1c822', kind: KIND, triCount,
  fixedExperimentalGs: FIXED_Gs, refineMaxPointsList: R_LIST,
  gtExpectMc: gt.expectedHotspots[0].mc,
  gtNote: '仅参照：107.txt §八 明确禁止把 expectedMc=30 当作本阶段判据',
  riserConfig: { mat: '球铁', shape: 'cyl', hd_ratio: 1.0, cast_wt: 0, note: 'cw=0 隔离模数路径' },
  axisMonotonic: {
    min: { values: mins, nonIncreasing: mono(mins, -1) },
    median: { values: meds, nonIncreasing: mono(meds, -1) },
    max: { values: maxs, nonIncreasing: mono(maxs, -1) },
    mainRegion: { values: mains, nonIncreasing: mono(mains, -1) },
  },
  runs,
}, null, 2));
console.log(`\n→ ${outFile}`);
