// ============================================================
// Exp 08 · 不变量（命令文件 7.txt 第十一~十四节）
//   旋转：lShape + bossOnPlate × 5 种旋转 → 反向旋转对比（应 ≈ 0）
//   平移：bossOnPlate × 4 平移 → detected − original ≈ translation
//   尺度：bossOnPlate × 0.5/1/2/5 → 归一化位置/厚度/Mc 误差
//   确定性：twoAdjacentBosses × 20 次 → 结果完全一致
// ============================================================
import { generate, rotateMesh, translateMesh, scaleMesh } from './hotspotGeometryGenerator.mjs';
import { runAnalyze, makeRecord, appendRaw } from './validationCommon.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAW_DIR } from './validationConfig.mjs';

const ROT = { r0: [null, 0], rx90: ['x', 90], ry90: ['y', 90], rz90: ['z', 90], r45: ['y', 45], comb: ['y', 45] };

/* ---- 旋转不变量 ---- */
function rotationTest() {
  const out = [];
  for (const [kind, params] of [['lShape', {}], ['bossOnPlate', {}]]) {
    const { mesh, gt } = generate(kind, params);
    const base = runAnalyze(mesh);
    const bH = base.hotspots[0];
    const baseRec = makeRecord(`${kind}_rot_r0`, { rot: 'r0' }, gt, base);
    baseRec.classification = null;
    baseRec.rotErr = 0;
    out.push(baseRec);
    for (const [name, [axis, deg]] of Object.entries(ROT).slice(1)) {
      const rm = rotateMesh(mesh, axis, deg);
      const r = runAnalyze(rm);
      const det = r.hotspots[0];
      let err = null;
      if (bH && det) {
        // 反向旋转检测点回原始系
        const rad = -deg * Math.PI / 180;
        const inv = axis === 'x' ? (p) => [p[0], p[1] * Math.cos(rad) - p[2] * Math.sin(rad), p[1] * Math.sin(rad) + p[2] * Math.cos(rad)]
          : axis === 'y' ? (p) => [p[0] * Math.cos(rad) + p[2] * Math.sin(rad), p[1], -p[0] * Math.sin(rad) + p[2] * Math.cos(rad)]
          : (p) => [p[0] * Math.cos(rad) - p[1] * Math.sin(rad), p[0] * Math.sin(rad) + p[1] * Math.cos(rad), p[2]];
        const [x, y, z] = inv([det.x, det.y, det.z]);
        err = Math.hypot(x - bH.x, y - bH.y, z - bH.z);
      }
      const rec = makeRecord(`${kind}_rot_${name}`, { rot: name }, gt, r);
      rec.classification = null;
      rec.rotErr = err === null ? null : +err.toFixed(3);
      rec.note = err === null ? '旋转后无热结或基数无' : `反向旋转误差 ${err.toFixed(2)}mm`;
      out.push(rec);
    }
  }
  return out;
}

/* ---- 平移不变量 ---- */
function translationTest() {
  const tforms = [[100, 0, 0], [0, 100, 0], [0, 0, 100], [500, -300, 200]];
  const out = [];
  const { mesh, gt } = generate('bossOnPlate', {});
  const base = runAnalyze(mesh);
  const bH = base.hotspots[0];
  const baseRec = makeRecord('trans_base', { d: [0, 0, 0] }, gt, base);
  baseRec.classification = null; baseRec.transErr = 0; baseRec.transVec = '0,0,0';
  out.push(baseRec);
  for (const [i, [dx, dy, dz]] of tforms.entries()) {
    const tm = translateMesh(mesh, dx, dy, dz);
    const r = runAnalyze(tm);
    const det = r.hotspots[0];
    let err = null, comp = null;
    if (bH && det) {
      comp = [det.x - bH.x, det.y - bH.y, det.z - bH.z];
      err = Math.hypot(comp[0] - dx, comp[1] - dy, comp[2] - dz);
    }
    const rec = makeRecord(`trans_${i + 1}`, { d: [dx, dy, dz] }, gt, r);
    rec.classification = null;
    rec.transErr = err === null ? null : +err.toFixed(3);
    rec.transVec = comp ? comp.map(v => +v.toFixed(2)).join(',') : null;
    rec.note = err === null ? '平移后无热结' : `位移 ${comp.map(v => +v.toFixed(1)).join(',')} vs 理论 ${dx},${dy},${dz} → ${err.toFixed(2)}mm`;
    out.push(rec);
  }
  return out;
}

/* ---- 尺度不变量 ---- */
function scaleTest() {
  const out = [];
  for (const s of [0.5, 1, 2, 5]) {
    const { mesh, gt } = generate('bossOnPlate', {});
    const sm = scaleMesh(mesh, s);
    const r = runAnalyze(sm);
    const rec = makeRecord(`scale_${s}`, { scale: s }, gt, r);
    rec.classification = null;
    const det = rec.detected.hotspots[0];
    rec.scaleErr = det ? +Math.hypot(det.x, det.y).toFixed(3) : null;   // 归一化位置（凸台在原点）→ ×s 后应 ≈ 0
    rec.note = det ? `归一化位置偏差 ${rec.scaleErr}mm（×${s}）` : '无热结';
    out.push(rec);
  }
  return out;
}

/* ---- 确定性 ---- */
function determinismTest() {
  const { mesh, gt } = generate('twoAdjacentBosses', {});
  const runs = [];
  for (let i = 0; i < 20; i++) {
    const r = runAnalyze(mesh);
    runs.push({
      run: i + 1,
      status: r.status,
      hs: (r.hotspots || []).map(h => `${h.id}:${h.x.toFixed(4)},${h.y.toFixed(4)},${h.z.toFixed(4)}:${h.mc.toFixed(4)}:${h.confidence.toFixed(4)}`),
    });
  }
  const first = JSON.stringify(runs[0].hs);
  const allSame = runs.every(r => JSON.stringify(r.hs) === first);
  const recs = runs.map((rr, i) => {
    const r = rr;
    return { model: `det_run${i + 1}`, parameters: {}, expected: {}, detected: { hotspots: [], status: r.status },
      status: r.status, positionError: null, classification: null, note: `run ${i + 1}: ${r.hs.join(' | ')}`, identical: allSame };
  });
  appendRaw('exp08_determinism', recs, { runs: 20, identical: allSame });
  return { allSame, count: runs.length, first };
}

const start = Date.now();
const R = rotationTest();
console.log(`rotation: ${R.length} 条`);
for (const r of R) console.log(`  ${r.model.padEnd(24)} status=${r.status} rotErr=${r.rotErr ?? '—'}mm ${r.note ?? ''}`);
appendRaw('exp08_rotation', R, { elapsedSec: ((Date.now() - start) / 1000).toFixed(1) });

const T = translationTest();
console.log(`translation: ${T.length} 条`);
for (const t of T) console.log(`  ${t.model.padEnd(10)} err=${t.transErr ?? '—'}mm ${t.note ?? ''}`);
appendRaw('exp08_translation', T, { elapsedSec: ((Date.now() - start) / 1000).toFixed(1) });

const S = scaleTest();
console.log(`scale: ${S.length} 条`);
for (const s of S) console.log(`  scale=${s.parameters.scale} status=${s.status} H${s.detected.hotspots.length} normErr=${s.scaleErr ?? '—'}mm ${s.note}`);
appendRaw('exp08_scale', S, { elapsedSec: ((Date.now() - start) / 1000).toFixed(1) });

const D = determinismTest();
console.log(`determinism: 20 次 ${D.allSame ? '完全一致 ✓' : '不一致 ✗'}`);
if (!D.allSame) console.log('  ' + D.first);

for (const [name, rows] of [['exp08_rotation', R], ['exp08_translation', T], ['exp08_scale', S]]) {
  writeFileSync(join(RAW_DIR, name + '.csv'), [
    'model,status,rotErr,transErr,scaleErr,positionError,confidence,note',
    ...rows.map(r => [r.model, r.status, r.rotErr ?? '', r.transErr ?? '', r.scaleErr ?? '', r.positionError ?? '', r.confidence ?? '', r.note ?? ''].join(',')),
  ].join('\n'));
}
console.log(`完成 ${((Date.now() - start) / 1000).toFixed(1)}s`);
