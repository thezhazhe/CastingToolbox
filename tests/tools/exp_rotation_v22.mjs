// ============================================================
// PHASE 3 · 旋转不变量（命令 8.txt）：同一几何 original/rx90/ry90/rz90/r45
// 验证：① Hotspot 数量  ② MC  ③ confidence  ④ 逆变换回原始系的位置
// 失败只报告原因，不提高 resolution
// ============================================================
import { generate, rotateMesh } from './hotspotGeometryGenerator.mjs';
import { runAnalyze } from './validationCommon.mjs';

const ROTATIONS = [
  ['r0', null, 0],
  ['rx90', 'x', 90],
  ['ry90', 'y', 90],
  ['rz90', 'z', 90],
  ['r45', 'y', 45],
];

/** 逆旋转（回原始系） */
function inverseRotate(axis, deg, p) {
  const rad = -deg * Math.PI / 180;
  if (axis === 'x') return [p[0], p[1] * Math.cos(rad) - p[2] * Math.sin(rad), p[1] * Math.sin(rad) + p[2] * Math.cos(rad)];
  if (axis === 'y') return [p[0] * Math.cos(rad) + p[2] * Math.sin(rad), p[1], -p[0] * Math.sin(rad) + p[2] * Math.cos(rad)];
  return [p[0] * Math.cos(rad) - p[1] * Math.sin(rad), p[0] * Math.sin(rad) + p[1] * Math.cos(rad), p[2]];
}

/** 逐热结匹配：旋转后每个 H 找基座最近 H，输出 数量差/位置误差/MC 差/conf 差 */
function compare(kind, base, rotR, label) {
  const out = { kind, rot: label, baseH: base.hotspots.length, rotH: rotR.hotspots.length,
    baseStatus: base.status, rotStatus: rotR.status };
  out.countMatch = base.hotspots.length === rotR.hotspots.length;
  out.hotspots = rotR.hotspots.map(h => {
    const ih = inverseRotate(label[1], label[2], [h.x, h.y, h.z]);
    // 最近基座热结
    let best = null, bestD = Infinity;
    for (const b of base.hotspots) {
      const d = Math.hypot(ih[0] - b.x, ih[1] - b.y, ih[2] - b.z);
      if (d < bestD) { bestD = d; best = b; }
    }
    return {
      id: h.id, invPos: ih.map(v => +v.toFixed(1)),
      posErr: best ? +bestD.toFixed(2) : null,
      mc: h.mc, baseMc: best?.mc ?? null, mcDiff: best ? +Math.abs(h.mc - best.mc).toFixed(2) : null,
      conf: h.confidence, baseConf: best?.confidence ?? null,
    };
  });
  return out;
}

const MODELS = ['lShape', 'bossOnPlate', 'twoAdjacentBosses', 'threeBosses'];
const start = Date.now();
for (const kind of MODELS) {
  const { mesh } = generate(kind);
  const base = runAnalyze(mesh);
  console.log(`\n=== ${kind}（基数 H=${base.hotspots.length} status=${base.status}）===`);
  for (const [name, axis, deg] of ROTATIONS) {
    if (!axis) { console.log(`  r0: H=${base.hotspots.length}（基准）`); continue; }
    const rm = rotateMesh(mesh, axis, deg);
    const r = runAnalyze(rm);
    const c = compare(kind, base, r, [name, axis, deg]);
    console.log(`  ${name.padEnd(5)} H=${c.rotH}（基数 ${c.baseH}${c.countMatch ? ' ✓' : ' ✗ 数量差' }） status=${c.rotStatus}`);
    for (const h of c.hotspots) {
      console.log(`    H${h.id} 逆位置=(${h.invPos.join(',')}) posErr=${h.posErr ?? '—'}mm mc=${h.mc}(${h.mcDiff ?? '—'}差) conf=${h.conf}(${h.baseConf ? Math.abs(h.conf - h.baseConf).toFixed(3) : '—'}差)`);
    }
  }
}
console.log(`\n完成 ${((Date.now() - start) / 1000).toFixed(1)}s`);
