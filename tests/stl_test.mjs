// ============================================================
// STL 解析 + 基础几何量黄金回归
// 期望值：tests/golden/golden.json（理论解析值，容差 ±2%）
// ============================================================
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSTL, computeVolume, computeArea, computeBounds } from '../js/engine/stl.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(__dirname, 'golden', 'golden.json'), 'utf-8'));

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const approx = (got, want, tol, label) => {
  const rel = Math.abs(got - want) / want;
  assert(rel <= tol, `${label}：期望 ${want}，实际 ${got}（偏差 ${(rel * 100).toFixed(2)}% > ${tol * 100}%）`);
};

export const tests = golden.cases.map(c => ({
  name: `${c.name}：解析 + 体积 + 表面积 + 尺寸`,
  fn: () => {
    const buf = readFileSync(join(__dirname, 'golden', c.file));
    const m = parseSTL(buf);
    assert(m.triCount > 0, '三角面数为 0');
    assert(m.vertices.length === m.triCount * 9, '顶点数不正确');

    const vol = computeVolume(m.vertices, m.triCount);
    const area = computeArea(m.vertices, m.triCount);
    const b = computeBounds(m.vertices, m.triCount);

    approx(vol, c.volume, 0.02, `${c.name} 体积`);
    approx(area, c.area, 0.02, `${c.name} 表面积`);
    // 尺寸容差 1%（STL 三角化会产生少量偏差）
    for (let k = 0; k < 3; k++) approx(b.size[k], c.size[k], 0.01, `${c.name} 尺寸[${k}]`);
  },
}));

// 附加：ASCII/Binary 双格式解析 + 有符号体积方向
export const more = null; // 占位，避免空导出
