// ============================================================
// 几何引擎黄金回归：buildMesh / 距离查询 / 内外判断
// 关键：tube_wall10（空心圆筒）轴线上的点必须判为"实体外"——
// CastEyes Bug A（热结跑到实体外）的复现条件，新引擎从这里开始防。
// ============================================================
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSTL } from '../js/engine/stl.js';
import { buildMesh, distanceToSurface, isInside } from '../js/engine/mesh3d.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const load = (name) => parseSTL(readFileSync(join(__dirname, 'golden', `${name}.stl`)));

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const close = (a, b, tol) => Math.abs(a - b) <= tol;

export const tests = [
  {
    name: 'cube50：中心在实体内部，到表面距离=25',
    fn: () => {
      const mesh = load('cube50');
      const { geometry } = buildMesh(mesh);
      assert(isInside(geometry, [0, 0, 0]), '立方体中心应判为内部');
      const d = distanceToSurface(geometry, [[0, 0, 0]])[0];
      assert(close(d, 25, 0.5), `中心到表面距离应≈25，实际 ${d}`);
    },
  },
  {
    name: 'tube_wall10：空心轴线上点判为实体外（Bug A 防线）',
    fn: () => {
      const mesh = load('tube_wall10');
      const { geometry } = buildMesh(mesh);
      // 圆筒轴线沿 Y（size 100×50×100），中心 (0,0,0) 在中空孔内
      assert(!isInside(geometry, [0, 0, 0]), '圆筒孔轴中心必须判为外部');
      // 壁内点（外半径 50、内半径 40：r=45 在壁内）
      assert(isInside(geometry, [45, 0, 0]), 'r=45 应判为壁内实体');
      // 壁内点到最近表面距离 ≈ min(50-45, 45-40) = 5
      const d = distanceToSurface(geometry, [[45, 0, 0]])[0];
      assert(close(d, 5, 0.8), `壁内点到表面距离应≈5，实际 ${d.toFixed(2)}`);
    },
  },
  {
    name: 'plate20：薄板中心距离=10（半厚）',
    fn: () => {
      const mesh = load('plate20');
      const { geometry } = buildMesh(mesh);
      const d = distanceToSurface(geometry, [[0, 0, 0]])[0];
      assert(close(d, 10, 0.5), `平板中心到表面距离应≈10，实际 ${d.toFixed(2)}`);
    },
  },
  {
    name: 'meshValidation：4 个黄金 STL 均为闭合网格',
    fn: async () => {
      const { validateMesh } = await import('../js/engine/meshValidation.js');
      for (const name of ['cube50', 'plate20', 'cylinder100', 'tube_wall10']) {
        const mesh = load(name);
        const r = validateMesh(mesh);
        assert(r.closed, `${name} 应为闭合网格，实际 ${r.boundaryEdges} 条边界边`);
        assert(r.degenerateTris === 0, `${name} 不应有退化三角形`);
      }
    },
  },
  {
    name: '壁厚提取：wallMain/wallMax 与 golden 期望一致',
    fn: async () => {
      const { analyzeGeometry } = await import('../js/engine/geometryAnalysis.js');
      const expect = { cube50: 50, plate20: 20, cylinder100: 50, tube_wall10: 10 };
      for (const name of Object.keys(expect)) {
        const mesh = load(name);
        const { geometry } = buildMesh(mesh);
        const g = analyzeGeometry(mesh, geometry);
        const want = expect[name];
        // 均匀厚度件：主体壁厚 = 最大壁厚；容差 = 体素尺寸量级
        assert(Math.abs(g.wallMain - want) <= 3, `${name} wallMain 应≈${want}，实际 ${g.wallMain.toFixed(1)}`);
        assert(Math.abs(g.wallMax - want) <= 3, `${name} wallMax 应≈${want}，实际 ${g.wallMax.toFixed(1)}`);
      }
    },
  },
  {
    name: '几何分析性能：4 模型单次分析 < 10s（48-60³ 体素）',
    fn: async () => {
      const { analyzeGeometry } = await import('../js/engine/geometryAnalysis.js');
      let worst = 0;
      for (const name of ['cube50', 'plate20', 'cylinder100', 'tube_wall10']) {
        const mesh = load(name);
        const { geometry } = buildMesh(mesh);
        const g = analyzeGeometry(mesh, geometry);
        if (g.res.elapsedMs > worst) worst = g.res.elapsedMs;
      }
      assert(worst < 10000, `最慢模型 ${worst}ms 超时`);
    },
  },
];
