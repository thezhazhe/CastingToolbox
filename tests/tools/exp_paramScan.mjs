// ============================================================
// Exp 01-03 · 参数扫描（命令文件 7.txt 第四/五/六节）
//   01 厚度梯度：板+凸台，凸台厚度 10→20 步进 2 / 10→40 —— 观察 candidate/hotspot 产生阈值与连续性
//   02 位置扫描：固定凸台 100×100×60，X∈11 点 × Y∈5 点 —— 边缘定位系统性偏差
//   03 尺寸扫描：boss 尺寸 20..200 × 高度 10..80 —— 有效工作区间 + refine 保护
// 输出：raw/exp01_gradient / exp02_position / exp03_size
// ============================================================
import { generate } from './hotspotGeometryGenerator.mjs';
import { runAnalyze, makeRecord, appendRaw } from './validationCommon.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAW_DIR } from './validationConfig.mjs';

/* ---- 01 厚度梯度 ---- */
function gradientSeq() {
  const seqs = [
    { name: 'g10_20', plate: [300, 200, 10], heights: [10, 12, 14, 16, 18, 20] },
    { name: 'g10_40', plate: [300, 200, 10], heights: [10, 15, 20, 30, 40] },
  ];
  const out = [];
  for (const { name, plate, heights } of seqs) {
    const dPlate = plate[2] / 2;
    for (const H of heights) {
      const bossH = H;                       // 凸台高 H → d = H/2（80×80×H）
      const ratio = (bossH / 2) / dPlate;    // 凸台 d / 板 d
      const { mesh, gt } = generate('bossOnPlate', { pl: plate, bs: [80, 80, bossH], ox: 0, oy: 0 });
      const r = runAnalyze(mesh);
      const rec = makeRecord(`${name}_h${H}`, { bossH, thicknessRatio: ratio }, gt, r);
      rec.parameters.thicknessRatio = +ratio.toFixed(3);
      const det = rec.detected.hotspots[0];
      out.push({
        ...rec, classification: null,
        thicknessRatio: +ratio.toFixed(3),
        hasCandidate: (r.debug.candidates || 0) > 0,
        hasHotspot: rec.detected.hotspots.length > 0,
        prominenceScore: det?.prominenceScore ?? null,
        confidence: det?.confidence ?? null,
        status: rec.status,
      });
    }
  }
  return out;
}

/* ---- 02 位置扫描 ---- */
function positionScan() {
  const X = [-150, -125, -100, -75, -50, 0, 50, 75, 100, 125, 150];
  const Y = [-50, -25, 0, 25, 50];
  const out = [];
  for (const ox of X) for (const oy of Y) {
    const { mesh, gt } = generate('bossOnPlate', { pl: [400, 200, 8], bs: [100, 100, 60], ox, oy });
    const r = runAnalyze(mesh);
    const rec = makeRecord(`pos_${ox}_${oy}`, { ox, oy }, gt, r);
    const det = rec.detected.hotspots[0];
    // 到模型中心距离（基准=板中心）→ 边缘性
    out.push({
      ...rec, classification: null,
      ox, oy, distFromCenter: Math.hypot(ox, oy),
      detX: det?.x ?? null, detY: det?.y ?? null, detZ: det?.z ?? null,
    });
  }
  return out;
}

/* ---- 03 尺寸扫描 ---- */
function sizeScan() {
  const sizes = [20, 30, 40, 50, 75, 100, 150, 200];
  const heights = [10, 15, 20, 30, 40, 60, 80];
  const out = [];
  for (const s of sizes) for (const H of heights) {
    const { mesh, gt } = generate('bossOnPlate', { pl: [600, 400, 10], bs: [s, s, H], ox: 0, oy: 0 });
    const r = runAnalyze(mesh);
    const rec = makeRecord(`size_${s}_${H}`, { bossSize: s, bossH: H }, gt, r);
    const det = rec.detected.hotspots[0];
    out.push({
      ...rec, classification: null,
      bossSize: s, bossH: H,
      dPeak: det?.localThickness ? det.localThickness / 2 : null,
      refineLimit: rec.audit.some(a => a.rejected?.includes('refine limit')),
    });
  }
  return out;
}

const start = Date.now();
const G = gradientSeq();
console.log(`gradient: ${G.length} 条`);
for (const g of G) console.log(`  ratio=${g.thicknessRatio.toFixed(2)} cand=${g.hasCandidate} HS=${g.hasHotspot} status=${g.status} conf=${g.confidence ?? '—'} prom=${g.prominenceScore ?? '—'}`);
appendRaw('exp01_gradient', G, { elapsedSec: ((Date.now() - start) / 1000).toFixed(1) });

const P = positionScan();
console.log(`position: ${P.length} 条`);
const gradeCounts = {};
for (const p of P) { const g = p.positionGrade || 'none'; gradeCounts[g] = (gradeCounts[g] || 0) + 1; }
console.log('  分级分布: ' + JSON.stringify(gradeCounts));
appendRaw('exp02_position', P, { elapsedSec: ((Date.now() - start) / 1000).toFixed(1) });

const S = sizeScan();
console.log(`size: ${S.length} 条`);
const stat = { ok: 0, noHs: 0, refineLimit: 0, noCand: 0 };
for (const s of S) { stat[s.status === 'ok' ? 'ok' : s.status === 'NO_HOTSPOT' ? 'noHs' : s.status === 'LOW_CONFIDENCE' ? 'refineLimit' : 'noCand']++; if (s.refineLimit) stat.refineLimit++; }
console.log('  状态分布: ' + JSON.stringify(stat));
appendRaw('exp03_size', S, { elapsedSec: ((Date.now() - start) / 1000).toFixed(1) });

for (const [name, rows] of [['exp01_gradient', G], ['exp02_position', P], ['exp03_size', S]]) {
  writeFileSync(join(RAW_DIR, name + '.csv'), [
    'model,thicknessRatio,distFromCenter,bossSize,bossH,status,positionError,positionGrade,confidence,prominenceScore,classification',
    ...rows.map(r => [r.model, r.thicknessRatio ?? '', r.distFromCenter ?? '', r.bossSize ?? '', r.bossH ?? '',
      r.status, r.positionError ?? '', r.positionGrade ?? '', r.confidence ?? '', r.prominenceScore ?? '', r.classification ?? ''].join(',')),
  ].join('\n'));
}
console.log(`完成 ${((Date.now() - start) / 1000).toFixed(1)}s`);
