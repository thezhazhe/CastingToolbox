// ============================================================
// PHASE V2.0-05H · 零距离采样点边界漏洞（111.txt §四）
//
// 直接对 M 场构造含 d = 0 / d = null / d > 0 的**合成输入**，不依赖真实 STL
// 恰好产生该情况。覆盖 111.txt §四 的 5 个场景表 + §四 末段"排除后不得出现
// 空集合 / 缺失值 / 索引错位"。
//
// 被测量：js/engine/v3/modulusField.js 的 fieldPoint（buildModulusField 与
//   buildModulusFieldSliced 共用同一函数，故同步/分片两条路径同时被覆盖）。
// ============================================================
import assert from 'node:assert/strict';
import { buildModulusField, buildModulusFieldSliced } from '../js/engine/v3/modulusField.js';
import { findPeaks } from '../js/engine/v3/peakRegion.js';
import { buildGridToPt, coarseSample } from '../js/engine/v3/sampling.js';
import { V3_DEFAULTS } from '../js/engine/v3/configV3.js';
import { buildMesh } from '../js/engine/mesh3d.js';
import { generate } from './tools/hotspotGeometryGenerator.mjs';
import { analyzeHotspotsV3 } from '../js/engine/v3/hotspotV3.js';

const RATIO = V3_DEFAULTS.modulusCeilRatio;   // 只读引用；本测试不改动它

/**
 * 合成板坯体素块：inside 仅 k ∈ [kLo, kHi]；boundary 按**与生产同一约定**标记
 * （inside 且 6 邻域有 outside，值为接触面数 —— 见 windowV.js:29-40）。
 * 窗口只要与板坯相交就必然含散热面（A > 0），故任意采样点都有定义良好的 V/A。
 */
function makeVox(gs = 21, vs = 1, kLo = 0, kHi = 5) {
  const idx = (i, j, k) => (i * gs + j) * gs + k;
  const inside = new Uint8Array(gs * gs * gs);
  const boundary = new Uint8Array(gs * gs * gs);
  for (let i = 0; i < gs; i++) for (let j = 0; j < gs; j++) for (let k = kLo; k <= kHi; k++) inside[idx(i, j, k)] = 1;
  for (let i = 0; i < gs; i++) for (let j = 0; j < gs; j++) for (let k = kLo; k <= kHi; k++) {
    let b = 0;
    if (k + 1 >= gs || !inside[idx(i, j, k + 1)]) b++;
    if (k - 1 < 0 || !inside[idx(i, j, k - 1)]) b++;
    if (i + 1 >= gs || !inside[idx(i + 1, j, k)]) b++;
    if (i - 1 < 0 || !inside[idx(i - 1, j, k)]) b++;
    if (j + 1 >= gs || !inside[idx(i, j + 1, k)]) b++;
    if (j - 1 < 0 || !inside[idx(i, j - 1, k)]) b++;
    if (b) boundary[idx(i, j, k)] = b;
  }
  return { inside, boundary, gs, vs, bounds: { min: [0, 0, 0], max: [gs * vs, gs * vs, gs * vs] }, globalMin: [0, 0, 0] };
}

/** 采样点：网格中心坐标 + 指定 char / dists */
function makeSample(vox, specs) {
  const { gs, vs } = vox;
  const pts = specs.map(s => [(s.i + 0.5) * vs, (s.j + 0.5) * vs, (s.k + 0.5) * vs]);
  return {
    pts,
    char: specs.map(s => (s.char === undefined ? 4 : s.char)),
    dists: specs.map(s => (s.d === undefined ? 2 : s.d)),
    gs, vs,
    insideIdx: specs.map(s => (s.i * gs + s.j) * gs + s.k),
    stride: 1,
  };
}

const rawOf = (f, t) => (f.A[t] > 1e-9 ? f.V[t] / f.A[t] : 0);

export const tests = [

  /* ---------- 场景 1：d > 0 → 原有 ceiling 行为完全不变 ---------- */
  {
    name: 'H1 d > 0：仍执行 ceiling，且 M == min(V/A, ratio×d)（逐点恒等式）',
    fn: async () => {
      const vox = makeVox();
      const s = makeSample(vox, [{ i: 10, j: 10, k: 4, char: 6, d: 3 }]);
      const f = buildModulusField(vox, s, V3_DEFAULTS, 1.0);
      const raw = rawOf(f, 0);
      assert.ok(raw > 0, `合成点应有正的未封顶 V/A，实际 ${raw}`);
      assert.equal(f.M[0], Math.min(raw, RATIO * 3), 'M 必须等于 min(V/A, ratio×d)');
      assert.ok(f.M[0] <= RATIO * 3 + 1e-12, 'M 必须被 ceiling 封住');
    },
  },
  {
    name: 'H2 d > 0 且 ceiling 不生效（V/A 本就低于上限）时 M == V/A（不误伤）',
    fn: async () => {
      const vox = makeVox();
      // d 很大 → 上限 ratio×d 很高 → ceiling 不绑定，M 应等于原始 V/A
      const s = makeSample(vox, [{ i: 10, j: 10, k: 3, char: 2, d: 1e6 }]);
      const f = buildModulusField(vox, s, V3_DEFAULTS, 1.0);
      assert.equal(f.M[0], rawOf(f, 0), 'ceiling 未绑定时 M 必须等于原始 V/A');
    },
  },

  /* ---------- 场景 2 + 5：d = 0（含高 V/A 区域）→ 不得携带未封顶 M 进入 M 场 ---------- */
  {
    name: 'H3 d = 0：M 必须为 0，不得等于未封顶 V/A（高 V/A 区域亦然）',
    fn: async () => {
      const vox = makeVox();
      const s0 = makeSample(vox, [{ i: 10, j: 10, k: 4, char: 6, d: 3 }]);   // 参照点
      const ref = buildModulusField(vox, s0, V3_DEFAULTS, 1.0);
      const rawRef = rawOf(ref, 0);

      const s = makeSample(vox, [{ i: 10, j: 10, k: 4, char: 6, d: 0 }]);
      const f = buildModulusField(vox, s, V3_DEFAULTS, 1.0);
      assert.equal(rawOf(f, 0), rawRef, '（前置）同一点同一窗口的 V/A 应与参照一致');
      assert.ok(rawRef > RATIO * 3, `（前置）该点未封顶 V/A ${rawRef} 应高于 ceiling ${RATIO * 3}，才构成"高 V/A"场景`);
      assert.equal(f.M[0], 0, `d = 0 时 M 必须为 0，实际 ${f.M[0]}（未封顶 V/A = ${rawOf(f, 0)}）`);
    },
  },
  {
    name: 'H4 d = 0：不得抬高 maxM（field.maxM 必须来自有效点）',
    fn: async () => {
      const vox = makeVox();
      const s = makeSample(vox, [
        { i: 10, j: 10, k: 2, char: 6, d: 0 },    // 洞点：未封顶 V/A 偏高
        { i: 10, j: 10, k: 3, char: 4, d: 2 },    // 正常点
      ]);
      const f = buildModulusField(vox, s, V3_DEFAULTS, 1.0);
      assert.equal(f.M[0], 0, '洞点 M 必须为 0');
      assert.ok(f.M[1] > 0, '正常点应有正 M');
      assert.equal(f.maxM, Math.max(...f.M), 'maxM 必须等于 M 数组最大值');
      assert.ok(f.maxM <= RATIO * 2 + 1e-12, `maxM 必须仍受 ceiling 约束，实际 ${f.maxM}`);
    },
  },
  {
    name: 'H5 d = 0：不得成为峰值候选（构造"若未修复则洞点必胜"的场）',
    fn: async () => {
      const vox = makeVox();
      // 布局（全部在板坯 k∈[0,5] 内）：
      //   idx0 洞点 (10,10,2) char=6 d=0  → 未封顶 V/A ≈ 3.0，若未修复则为全场最大
      //   idx1 正常峰 (10,10,3) char=4 d=3 → M = min(V/A, 1.0) = 1.0
      //   idx2..9 背景：4 个落在 idx0 的环带 [6,12]、4 个落在 idx1 的环带 [4,8]
      // 未修复时：idx0 满足 isMax + 环带 ≥3 + prominence 高 → 必然成为第一峰，
      //   且 NMS（距离 1 < 1.3×max(R)=7.8）会把 idx1 挤掉。故本用例有真实区分力。
      const s = makeSample(vox, [
        { i: 10, j: 10, k: 2, char: 6, d: 0 },
        { i: 10, j: 10, k: 3, char: 4, d: 3 },
        { i: 3, j: 10, k: 2, char: 4, d: 0.5 },   // 距 idx0 = 7 ∈ [6,12]
        { i: 17, j: 10, k: 2, char: 4, d: 0.5 },  // 距 idx0 = 7
        { i: 10, j: 3, k: 2, char: 4, d: 0.5 },   // 距 idx0 = 7
        { i: 10, j: 17, k: 2, char: 4, d: 0.5 },  // 距 idx0 = 7
        { i: 5, j: 10, k: 3, char: 4, d: 0.5 },   // 距 idx1 = 5 ∈ [4,8]
        { i: 15, j: 10, k: 3, char: 4, d: 0.5 },  // 距 idx1 = 5
        { i: 10, j: 5, k: 3, char: 4, d: 0.5 },   // 距 idx1 = 5
        { i: 10, j: 15, k: 3, char: 4, d: 0.5 },  // 距 idx1 = 5
      ]);
      s.gridToPt = buildGridToPt(s.gs, vox.inside, s.insideIdx);
      const f = buildModulusField(vox, s, V3_DEFAULTS, 1.0);

      // 前置：洞点的**未封顶** V/A 确实高于正常峰的 M（否则用例无区分力）
      assert.ok(rawOf(f, 0) > f.M[1], `（前置）洞点未封顶 V/A ${rawOf(f, 0)} 应高于正常峰 M ${f.M[1]}`);
      assert.equal(f.M[0], 0, '洞点 M 必须为 0');

      const peaks = findPeaks(f.M, s, f, V3_DEFAULTS);
      assert.ok(peaks.length >= 1, '应至少检出正常峰');
      assert.ok(!peaks.some(p => p.pt === 0), `洞点（索引 0）不得成为峰，实际 peaks=${JSON.stringify(peaks.map(p => p.pt))}`);
      assert.equal(peaks[0].pt, 1, `第一峰必须是正常峰 idx1，实际 idx${peaks[0].pt}`);
      assert.ok(peaks.every(p => f.M[p.pt] > 0), '所有峰的 M 必须 > 0');
    },
  },

  /* ---------- 场景 3：d = null → 行为明确 ---------- */
  {
    name: 'H6 d = null（提供了 dists 数组但该点为 null）：M 必须为 0，与 d = 0 同类处理',
    fn: async () => {
      const vox = makeVox();
      const s = makeSample(vox, [{ i: 10, j: 10, k: 4, char: 6, d: null }]);
      const f = buildModulusField(vox, s, V3_DEFAULTS, 1.0);
      assert.equal(f.M[0], 0, `d = null 时 M 必须为 0，实际 ${f.M[0]}`);
      assert.ok(!Number.isNaN(f.M[0]), '不得产生 NaN');
    },
  },
  {
    name: 'H7 未提供 dists（旧调用）时行为不变：仍不封顶（向后兼容）',
    fn: async () => {
      const vox = makeVox();
      const s = makeSample(vox, [{ i: 10, j: 10, k: 4, char: 6, d: 3 }]);
      delete s.dists;                      // ★ 模拟不传 dists 的调用方
      const f = buildModulusField(vox, s, V3_DEFAULTS, 1.0);
      assert.equal(f.M[0], rawOf(f, 0), '无 dists 时 M 必须等于原始 V/A（旧行为保持）');
      assert.ok(f.M[0] > 0, 'M 应为正');
    },
  },
  {
    name: 'H8 d 为非有限/负值：同样不得保留未封顶 V/A',
    fn: async () => {
      const vox = makeVox();
      for (const bad of [NaN, -1, -0]) {
        const s = makeSample(vox, [{ i: 10, j: 10, k: 4, char: 6, d: bad }]);
        const f = buildModulusField(vox, s, V3_DEFAULTS, 1.0);
        assert.equal(f.M[0], 0, `d = ${bad} 时 M 必须为 0，实际 ${f.M[0]}`);
      }
    },
  },

  /* ---------- 场景 4：正常几何体 → 不变量成立、无索引错位 ---------- */
  {
    name: 'H9 正常几何（thickEnd）：M 场不变量逐点成立（d>0 ⇒ min(V/A,ratio·d)；d≤0/null ⇒ 0）',
    fn: async () => {
      const { mesh } = generate('thickEnd');
      const geometry = buildMesh(mesh).geometry;
      const coarse = coarseSample(mesh, geometry, V3_DEFAULTS);
      const f = buildModulusField(coarse.vox, coarse, V3_DEFAULTS, 1.0);
      assert.equal(f.M.length, coarse.pts.length, 'M 长度必须与采样点数一致（无索引错位）');
      let nInvalid = 0;
      for (let t = 0; t < f.M.length; t++) {
        const d = coarse.dists[t];
        if (d !== null && d > 0) {
          assert.equal(f.M[t], Math.min(rawOf(f, t), RATIO * d), `点 ${t}：d>0 时 M 必须等于 min(V/A, ratio·d)`);
        } else {
          nInvalid++;
          assert.equal(f.M[t], 0, `点 ${t}：d 无效（${d}）时 M 必须为 0，实际 ${f.M[t]}`);
        }
        assert.ok(!Number.isNaN(f.M[t]), `点 ${t} 出现 NaN`);
      }
      assert.equal(f.maxM, Math.max(0, ...f.M), 'maxM 必须等于 M 数组最大值');
      assert.ok(f.maxM > 0, '正常几何的 maxM 应为正');
      void nInvalid;
    },
  },
  {
    name: 'H10 分片版与同步版逐点一致（含 d = 0 点）',
    fn: async () => {
      const vox = makeVox();
      const s = makeSample(vox, [
        { i: 10, j: 10, k: 2, char: 6, d: 0 },
        { i: 10, j: 10, k: 3, char: 4, d: 2 },
        { i: 5, j: 5, k: 5, char: null, d: null },
      ]);
      const a = buildModulusField(vox, s, V3_DEFAULTS, 1.0);
      const b = await buildModulusFieldSliced(vox, s, V3_DEFAULTS, 1.0);
      for (let t = 0; t < a.M.length; t++) {
        assert.equal(b.M[t], a.M[t], `点 ${t}：分片 ${b.M[t]} != 同步 ${a.M[t]}`);
      }
      assert.equal(b.maxM, a.maxM, 'maxM 必须一致');
    },
  },
  {
    name: 'H11 全为无效点：不崩溃、不产生 NaN、findPeaks 返回空集',
    fn: async () => {
      const vox = makeVox();
      const s = makeSample(vox, [
        { i: 10, j: 10, k: 2, char: 6, d: 0 },
        { i: 10, j: 10, k: 3, char: 4, d: null },
      ]);
      s.gridToPt = buildGridToPt(s.gs, vox.inside, s.insideIdx);
      const f = buildModulusField(vox, s, V3_DEFAULTS, 1.0);
      assert.deepEqual(Array.from(f.M), [0, 0], '全无效 → M 全 0');
      assert.equal(f.maxM, 0, 'maxM 必须为 0');
      assert.equal(f.meanM, 0, 'meanM 必须为 0');
      const peaks = findPeaks(f.M, s, f, V3_DEFAULTS);
      assert.deepEqual(peaks, [], '空 M 场不得产生峰（且不得抛错）');
    },
  },
  {
    name: 'H12 端到端：thickEnd L1（真实含 d = 0 的配置）不再出现 refine maxM > Mc 的污染',
    fn: async () => {
      const { mesh } = generate('thickEnd');
      const geometry = buildMesh(mesh).geometry;
      const r = analyzeHotspotsV3(mesh, geometry, { experimentalGs: 64, refineMaxPoints: 8000 });
      assert.equal(r.status, 'ok', `状态应为 ok，实际 ${r.status}`);
      const mc = r.hotspots[0].peakModulus;
      const maxRefine = Math.max(...r.debug.refine.filter(e => !e.skipped).map(e => e.maxM));
      assert.ok(maxRefine <= mc + 1e-9,
        `refine 区 maxM（${maxRefine}）不得高于报告 Mc（${mc}）—— 修复前该值为 14.375`);
      assert.ok(r.hotspots.every(h => h.normalizedModulus <= 1 + 1e-12), 'normalizedModulus 不得超过 1');
    },
  },
];
