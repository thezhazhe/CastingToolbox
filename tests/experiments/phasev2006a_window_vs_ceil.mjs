// ============================================================
// PHASE V2.0-06A · 「窗口 V/A」vs「(1/3)d」对解析模数的逼近（**只读**）
//
// 目的：排除采样格点相位的干扰，单独看**估值器本身**的对错。
//   做法：直接在解析已知的热中心坐标上，用不同 vs 做体素化，
//         手工调 windowVoxels(vox, center, R = 2×d_true)，得到窗口 V/A。
//   ——不经采样格点、不经 M 场、不经 ceiling，是纯几何量。
//
// 对照：解析模数 = 经典凝固模数公式（该几何的公认值）
//       (1/3)·d_true = 引擎 ceiling 会给出的值
//
// 注意（112.txt §三）：窗口 V/A、整体 V/A、距离场、引擎 Mc 是**四个不同的量**，
//   本表只比较「窗口 V/A」与「(1/3)d」各自作为**同一物理位置上的模数估计**的表现。
// ============================================================
import { buildMesh } from '../../js/engine/mesh3d.js';
import { voxelize, windowVoxels } from '../../js/engine/v3/windowV.js';
import { generate } from '../tools/hotspotGeometryGenerator.mjs';

const CASES = [
  {
    kind: 'uniformPlate', params: { l: 300, w: 200, t: 40 }, center: [0, 0, 0], dTrue: 20,
    // 中心离四边 > 2t（150>80, 100>80）→ 局部就是无限板
    ref: 40 / 2, refLabel: 't/2 = 20（无限板；中心离边 100/150 > 2t）',
  },
  {
    kind: 'uniformCube', params: { size: 100 }, center: [0, 0, 0], dTrue: 50,
    ref: 100 / 6, refLabel: 'a/6 = 16.667（立方六面散热）',
  },
  {
    kind: 'uniformCylinder', params: { r: 40, h: 120 }, center: [0, 0, 0], dTrue: 40,
    ref: 2 * 40 * 120 / (4 * 40 + 4 * 120), refLabel: 'D·H/(2D+4H) = 15（圆柱标准式）',
  },
  {
    kind: 'thickEnd', params: undefined, center: [0, 0, 0], dTrue: 30,
    // 端块 120×60×60：y/z 面全裸 + x=+60 面裸 + x=−60 面被 40×40 主体遮挡一部分
    ref: 120 * 60 * 60 / (4 * (120 * 60) + 60 * 60 + (60 * 60 - 40 * 40)),
    refLabel: '端块（5 面露、x=−60 面扣主体遮挡 40×40）',
  },
  {
    kind: 'pvpPair', params: { tA: 30, tB: 30, v: 15 }, center: [-55, 0, 0], dTrue: 15,
    // 板 80×60×30；x=−55 距 x=−95 端 40 > 2t=60? 否（40<60）→ 取整板 6 面 V/A 为下限
    ref: 80 * 60 * 30 / (2 * (80 * 60) + 2 * (80 * 30) + 2 * (60 * 30)),
    refLabel: '板 80×60×30 整板 6 面 V/A = 8（下限；上限 t/2=15）',
  },
];

const VS_LIST = [10, 5, 2.5, 1.25];
const f3 = (v) => (v == null ? '—' : String(+v.toFixed(3)));

console.log('几何'.padEnd(17), '解析'.padStart(8), '(1/3)d'.padStart(8), '(1/3)d/解析'.padStart(12),
  VS_LIST.map(v => `ws${v}`.padStart(9)).join(''), '  窗口/解析（收敛后）');

const rows = [];
for (const c of CASES) {
  const { mesh } = generate(c.kind, c.params);
  const { geometry } = buildMesh(mesh);
  const b = (mesh.vertices.length ? bounds(mesh) : null);
  const out = [];
  for (const vs of VS_LIST) {
    const gs = Math.max(16, Math.ceil(Math.max(b.size[0], b.size[1], b.size[2]) / vs) + 2);
    const vox = voxelize(geometry, { min: b.min, max: b.max }, gs, vs, b.min);
    const w = windowVoxels(vox, c.center, 2 * c.dTrue);
    out.push({ vs, gs, R: 2 * c.dTrue, v: w.v, a: w.a, VA: w.a > 1e-9 ? w.v / w.a : 0 });
  }
  rows.push({ ...c, out });
  console.log(c.kind.padEnd(17), f3(c.ref).padStart(8), f3(c.dTrue / 3).padStart(8),
    f3((c.dTrue / 3) / c.ref).padStart(12),
    out.map(o => f3(o.VA).padStart(9)).join(''),
    '  ' + out.map(o => f3(o.VA / c.ref)).join(' / '));
}

console.log('\n参照：');
for (const r of rows) console.log(`  ${r.kind.padEnd(17)} ${r.refLabel}`);

function bounds(mesh) {
  const v = mesh.vertices;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) {
    if (v[i + k] < min[k]) min[k] = v[i + k];
    if (v[i + k] > max[k]) max[k] = v[i + k];
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}
