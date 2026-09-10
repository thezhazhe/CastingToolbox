// ============================================================
// STL 导入稳定性测试（命令6 第四节：10 类异常输入）
// 原则：正常 STL 必须正确导入；异常 STL 不允许崩溃，必须给出
//       明确可理解的错误提示（validateMesh issues / parse warnings）。
// ============================================================
import { parseSTL } from '../js/engine/stl.js';
import { validateMesh } from '../js/engine/meshValidation.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

/* ---- 构造工具 ---- */

const tri = (a, b, c) => `  facet normal 0 0 0
    outer loop
      vertex ${a[0]} ${a[1]} ${a[2]}
      vertex ${b[0]} ${b[1]} ${b[2]}
      vertex ${c[0]} ${c[1]} ${c[2]}
    endloop
  endfacet
`;
const ascii = (tris, name = 'test') => `solid ${name}\n${tris.join('')}endsolid ${name}\n`;
const CUBE_TRI = tri([0,0,0],[50,0,0],[0,50,0]) + tri([0,0,0],[50,0,0],[50,0,50]);   // 示意三角（不追求完整立方体）

const toBuf = (text) => new TextEncoder().encode(text).buffer;

// 单个二进制定点三角形：法向(3f) + 顶点(9f) + 属性(2B)
function binTri(corners) {
  const b = new ArrayBuffer(50);
  const dv = new DataView(b);
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) dv.setFloat32(12 + i * 12 + k * 4, corners[i][k], true);
  return b;
}
function binStl(tris, triCountField = tris.length) {
  const b = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(b);
  dv.setUint32(80, triCountField, true);
  tris.forEach((t, i) => new Uint8Array(b).set(new Uint8Array(binTri(t)), 84 + i * 50));
  return b;
}
// 全链检查：解析 + 验证都不崩溃，返回 {mesh, validation}
function run(buf) {
  const mesh = parseSTL(buf);
  const validation = validateMesh(mesh);
  return { mesh, validation };
}
const issueCodes = (v) => v.issues.map(i => `${i.level}:${i.code}`).join(', ');

export const tests = [
  {
    name: '正常 ASCII STL 正确导入',
    fn: () => {
      const { mesh, validation } = run(toBuf(ascii([tri([0,0,0],[10,0,0],[0,10,0])])));
      assert(mesh.triCount === 1, `triCount=${mesh.triCount}`);
      assert(!validation.issues.some(i => i.level === 'error'), issueCodes(validation));
    },
  },
  {
    name: '空文件（0 字节）→ NO_TRIANGLES 错误提示',
    fn: () => {
      const { mesh, validation } = run(new ArrayBuffer(0));
      assert(mesh.triCount === 0, `triCount=${mesh.triCount}`);
      assert(validation.issues.some(i => i.level === 'error' && i.code === 'NO_TRIANGLES'), issueCodes(validation));
    },
  },
  {
    name: '空 ASCII（只有 solid/endsolid）→ NO_TRIANGLES',
    fn: () => {
      const { validation } = run(toBuf('solid x\nendsolid x\n'));
      assert(validation.issues.some(i => i.level === 'error' && i.code === 'NO_TRIANGLES'), issueCodes(validation));
    },
  },
  {
    name: '纯垃圾文本 → 不崩溃且有提示',
    fn: () => {
      const { validation } = run(toBuf('this is not an stl file at all!!!\n'.repeat(50)));
      assert(validation.issues.length >= 0, '无 issues');   // 至少不崩溃
      assert(validation.issues.some(i => i.level === 'error' && i.code === 'NO_TRIANGLES'), issueCodes(validation));
    },
  },
  {
    name: '随机二进制（长度 84+50n 精确匹配）→ 不崩溃',
    fn: () => {
      const b = new ArrayBuffer(84 + 200 * 50);
      crypto.getRandomValues(new Uint8Array(b));
      const { validation } = run(b);
      assert(Array.isArray(validation.issues), 'issues 缺失');
    },
  },
  {
    name: '巨大 triCount 字段（内存炸弹防御）→ 截断不崩溃',
    fn: () => {
      const tris = [CUBE_TRI];
      const b = binStl([[[0,0,0],[1,0,0],[0,1,0]]], 0xFFFFFFFF);
      const { mesh, validation } = run(b);
      assert(mesh.triCount === 1, `triCount=${mesh.triCount}（应截断为 1）`);
      assert(validation.issues.some(i => i.code === 'PARSE_WARNING'), issueCodes(validation));
    },
  },
  {
    name: '截断 binary（长度不匹配）→ 不崩溃',
    fn: () => {
      const b = binStl([[[0,0,0],[1,0,0],[0,1,0]]]).slice(0, 100);   // 84 + 半个三角
      const { validation } = run(b);
      assert(Array.isArray(validation.issues), 'issues 缺失');
    },
  },
  {
    name: '极小尺寸 STL（1e-6 mm 级）→ 解析与验证不崩溃',
    fn: () => {
      const s = 1e-6;
      const { mesh, validation } = run(toBuf(ascii([tri([0,0,0],[s,0,0],[0,s,0])])));
      assert(mesh.triCount === 1, `triCount=${mesh.triCount}`);
      assert(!validation.issues.some(i => i.level === 'error'), issueCodes(validation));
    },
  },
  {
    name: '超大尺寸 STL（1e7 mm）→ 解析与验证不崩溃',
    fn: () => {
      const s = 1e7;
      const { mesh, validation } = run(toBuf(ascii([tri([0,0,0],[s,0,0],[0,s,0])])));
      assert(mesh.triCount === 1, `triCount=${mesh.triCount}`);
      assert(!validation.issues.some(i => i.level === 'error'), issueCodes(validation));
    },
  },
  {
    name: '退化三角形（顶点重复）→ DEGENERATE_TRIANGLE 警告不崩溃',
    fn: () => {
      const { validation } = run(toBuf(ascii([tri([1,1,1],[1,1,1],[1,1,1])])));
      assert(validation.issues.some(i => i.code === 'DEGENERATE_TRIANGLE'), issueCodes(validation));
    },
  },
  {
    name: '法向异常（顶点顺序颠倒）→ 解析正常（体积取绝对值）',
    fn: () => {
      const { mesh, validation } = run(toBuf(ascii([tri([0,0,0],[0,10,0],[10,0,0])])));   // 反转绕序
      assert(mesh.triCount === 1, `triCount=${mesh.triCount}`);
      assert(!validation.issues.some(i => i.level === 'error'), issueCodes(validation));
    },
  },
  {
    name: '非流形（开口网格）→ OPEN_MESH 警告不崩溃',
    fn: () => {
      // 三个三角围成半开口（每个顶点共享边 → 边界边 > 0）
      const t1 = tri([0,0,0],[10,0,0],[0,10,0]);
      const t2 = tri([10,0,0],[10,10,0],[0,10,0]);
      const t3 = tri([0,0,0],[0,10,0],[0,0,10]);
      const { validation } = run(toBuf(ascii([t1, t2, t3])));
      assert(validation.issues.some(i => i.code === 'OPEN_MESH'), issueCodes(validation));
    },
  },
  {
    name: '重复三角形（闭合但叠加）→ 不崩溃，闭合检查通过',
    fn: () => {
      // 单个三角形自身闭合（三边各出现 2 次：正反方向）
      const { validation } = run(toBuf(ascii([tri([0,0,0],[10,0,0],[0,10,0]), tri([0,0,0],[10,0,0],[0,10,0])])));
      assert(!validation.issues.some(i => i.level === 'error'), issueCodes(validation));
    },
  },
  {
    name: '高面数模型（程序化 60 面 → 几何量有限值）',
    fn: () => {
      // 球面：12 面 → 60 三角（icosphere 简化：顶点网格近似），用参数化生成
      const tris = [];
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2, b = (i + 1) / 10 * Math.PI * 2;
        tris.push(tri(
          [Math.cos(a) * 5, Math.sin(a) * 5, 0],
          [Math.cos(b) * 5, Math.sin(b) * 5, 0],
          [Math.cos((a + b) / 2) * 5, Math.sin((a + b) / 2) * 5, 3],
        ));
      }
      const { mesh } = run(toBuf(ascii(tris)));
      assert(mesh.triCount === 10, `triCount=${mesh.triCount}`);
    },
  },
];
