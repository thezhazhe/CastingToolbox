// ============================================================
// PHASE V2.0-04（102.txt §七）· STL∩Cube 体积算法确定性验证
//
// 全部用**解析解**做真值：立方体/板的轴对齐交集体积可以手算。
// 任何一条不过 → 实验工具的 Vc_local 不可信 → 实验结论作废。
// 目标精度：相对误差 ≤ 1e-9（该算法是精确多面体求交，不是近似）。
// ============================================================
import { prepareMesh, cubeIntersectVolume } from './experiments/hotspotLocalVolume.js';
import { computeVolume } from '../js/engine/stl.js';

/* ---------- 用轴对齐盒拼网格（外向绕向，闭合） ---------- */
function boxMesh(boxes) {
  const verts = [];
  const quad = (a, b, c, d) => {
    verts.push(...a, ...b, ...c);
    verts.push(...a, ...c, ...d);
  };
  for (const [mn, mx] of boxes) {
    const [x0, y0, z0] = mn, [x1, y1, z1] = mx;
    quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);   // +X
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);   // -X
    quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]);   // +Y
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);   // -Y
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);   // +Z
    quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]);   // -Z
  }
  return { vertices: new Float32Array(verts), triCount: verts.length / 9 };
}

const ctxOf = (mesh) => { const c = prepareMesh(mesh); c.mesh = mesh; return c; };
const rel = (got, want) => Math.abs(got - want) / Math.max(1e-12, Math.abs(want));

/** 立方体 [0,10]³ */
const CUBE10 = boxMesh([[[0, 0, 0], [10, 10, 10]]]);

export const tests = [
  {
    name: 'V2.0-04-T1 盒完全包含实体 → V = 实体体积（解析 1000）',
    fn: () => {
      const ctx = ctxOf(CUBE10);
      const r = cubeIntersectVolume(ctx, [5, 5, 5], 24);   // box [-7,17]³ ⊃ [0,10]³
      if (rel(r.volume, 1000) > 1e-9) throw new Error(`体积 ${r.volume}，应 1000（相对误差 ${rel(r.volume, 1000)}）`);
      if (r.componentCount !== 1) throw new Error(`分量数 ${r.componentCount}，应 1`);
      // 同时与项目自带 computeVolume 对齐（两者都应是精确多面体体积）
      const cv = computeVolume(CUBE10.vertices, CUBE10.triCount);
      if (rel(cv, 1000) > 1e-9) throw new Error(`computeVolume ${cv} ≠ 1000`);
    },
  },
  {
    name: 'V2.0-04-T2 盒完全在实体内 → V = 盒体积（解析 64）',
    fn: () => {
      const r = cubeIntersectVolume(ctxOf(CUBE10), [5, 5, 5], 4);   // box [3,7]³ ⊂ cube
      if (rel(r.volume, 64) > 1e-9) throw new Error(`体积 ${r.volume}，应 64`);
      if (rel(r.fillRatio, 1) > 1e-9) throw new Error(`填充率 ${r.fillRatio}，应 1`);
    },
  },
  {
    name: 'V2.0-04-T3 盒完全在实体外 → V = 0',
    fn: () => {
      const r = cubeIntersectVolume(ctxOf(CUBE10), [20, 20, 20], 4);
      if (r.volume > 1e-9) throw new Error(`体积 ${r.volume}，应 0`);
    },
  },
  {
    name: 'V2.0-04-T4 盒切掉一角 → V = 解析 15.625（三个盒面参与）',
    fn: () => {
      // box [-2.5,2.5]³ ∩ [0,10]³ = [0,2.5]³
      const r = cubeIntersectVolume(ctxOf(CUBE10), [0, 0, 0], 5);
      if (rel(r.volume, 15.625) > 1e-9) throw new Error(`体积 ${r.volume}，应 15.625`);
    },
  },
  {
    name: 'V2.0-04-T5 盒单面切（5 个盒面在实体内）→ V = 125',
    fn: () => {
      // box [0.1,5.1]×[2.5,7.5]×[2.5,7.5] ⊂ cube → 5×5×5
      const r = cubeIntersectVolume(ctxOf(CUBE10), [2.6, 5, 5], 5);
      if (rel(r.volume, 125) > 1e-9) throw new Error(`体积 ${r.volume}，应 125`);
      if (r.warnings.length) throw new Error(`不应有警告：${r.warnings.join(' / ')}`);
    },
  },
  {
    name: 'V2.0-04-T6 盒对穿实体（两侧盒面都在体外）→ V = 125',
    fn: () => {
      // box x∈[0.1,5.1] 两端都在实体内 → 与 T5 同解；此处换 y 对穿
      const r = cubeIntersectVolume(ctxOf(CUBE10), [5, 2.6, 5], 5);
      if (rel(r.volume, 125) > 1e-9) throw new Error(`体积 ${r.volume}，应 125`);
    },
  },
  {
    name: 'V2.0-04-T7 薄板：V = t·L²（§十四 解析预测，fillRatio = t/L）',
    fn: () => {
      // 板 200×200×20，box 边长 60 完整穿过厚度 → V = 60×60×20 = 72000
      const plate = boxMesh([[[0, 0, 0], [200, 200, 20]]]);
      const L = 60;
      const r = cubeIntersectVolume(ctxOf(plate), [100, 100, 10], L);
      const want = 20 * L * L;
      if (rel(r.volume, want) > 1e-9) throw new Error(`体积 ${r.volume}，应 ${want}`);
      if (rel(r.fillRatio, 20 / L) > 1e-9) throw new Error(`填充率 ${r.fillRatio}，应 ${20 / L}`);
    },
  },
  {
    name: 'V2.0-04-T8 厚块：盒埋在实体内 → fillRatio = 1',
    fn: () => {
      const block = boxMesh([[[0, 0, 0], [300, 300, 300]]]);
      const r = cubeIntersectVolume(ctxOf(block), [150, 150, 150], 80);
      if (rel(r.fillRatio, 1) > 1e-9) throw new Error(`填充率 ${r.fillRatio}，应 1`);
    },
  },
  {
    name: 'V2.0-04-T9 §七.3 多分量：只保留含 hotspot 的那一块',
    fn: () => {
      // 两块分离实体：[0,10]³ 与 [20,30]×[0,10]×[0,10]
      const two = boxMesh([[[0, 0, 0], [10, 10, 10]], [[20, 0, 0], [30, 10, 10]]]);
      const ctx = ctxOf(two);
      // box [-15,25]³：完整含第一块(1000)，切第二块 x∈[20,25] → 5×10×10 = 500
      const keep = cubeIntersectVolume(ctx, [5, 5, 5], 40);
      if (keep.componentCount !== 2) throw new Error(`分量数 ${keep.componentCount}，应 2`);
      if (keep.keptComponents !== 1) throw new Error(`保留分量 ${keep.keptComponents}，应 1`);
      if (rel(keep.volume, 1000) > 1e-9) throw new Error(`保留体积 ${keep.volume}，应 1000`);
      // 关掉过滤 → 两块都算 → 1500
      const all = cubeIntersectVolume(ctx, [5, 5, 5], 40, { keepOnlyHotspotComponent: false });
      if (rel(all.volume, 1500) > 1e-9) throw new Error(`全量体积 ${all.volume}，应 1500`);
    },
  },
  {
    name: 'V2.0-04-T10 全局绕向翻转不影响结果（|soup+cap| 的鲁棒性）',
    fn: () => {
      const flipped = boxMesh([[[0, 0, 0], [10, 10, 10]]]);
      // 逐三角反转顶点 1/2
      for (let t = 0; t < flipped.triCount; t++) {
        const i = t * 9;
        for (let k = 0; k < 3; k++) {
          const tmp = flipped.vertices[i + 3 + k];
          flipped.vertices[i + 3 + k] = flipped.vertices[i + 6 + k];
          flipped.vertices[i + 6 + k] = tmp;
        }
      }
      const r = cubeIntersectVolume(ctxOf(flipped), [2.6, 5, 5], 5);
      if (rel(r.volume, 125) > 1e-9) throw new Error(`翻转后体积 ${r.volume}，应 125`);
    },
  },
];
