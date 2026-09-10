// ============================================================
// PHASE 73（81.txt §五）· 计算器边界审计（离线，15 个计算器 × 5 组极端输入）
//   检查：计算是否产出 NaN / Infinity / undefined / 字符串脏值 / 直接崩溃。
//   口径说明：**显式 null 不算脏值** —— "无法计算 / 该字段不适用"在现有契约里就是用
//   null 或 blocked 表达的（诚实门禁），本脚本只盯真·数值污染。
// 用法: node scripts/edge_audit.mjs        （退出码 0=干净 1=有脏值）
// ============================================================
import * as proj from '../js/model/CastingProject.js';
import { CALC_MANIFEST } from '../calcs/calcManifest.js';

const S = proj.SRC, C = proj.CONF;

/** 递归找 NaN / Infinity / undefined / "NaN" / "undefined" / "[object Object]" */
function scan(o, path = '', out = []) {
  if (o === undefined) { if (path) out.push(path + ' = undefined'); return out; }
  if (typeof o === 'number' && !Number.isFinite(o)) { out.push(path + ' = ' + o); return out; }
  if (typeof o === 'string' && /^(undefined|NaN|Infinity|\[object Object\])$/.test(o)) { out.push(`${path} = "${o}"`); return out; }
  if (Array.isArray(o)) { o.forEach((v, i) => scan(v, `${path}[${i}]`, out)); return out; }
  if (o && typeof o === 'object') for (const k of Object.keys(o)) scan(o[k], path ? `${path}.${k}` : k, out);
  return out;
}

const BASE = (p) => {
  proj.reset();
  p.set('material.family', '灰铁', S.USER_INPUT, C.USER_CONFIRMED);
  p.set('material.solidDensity', 7.1, S.DERIVED, C.HIGH);
  p.set('material.liquidDensity', 7.0, S.DERIVED, C.HIGH);
  p.set('geometry.blankWeightKg', 10, S.USER_INPUT, C.USER_CONFIRMED);
  p.set('geometry.netWeightKg', 10, S.DERIVED, C.HIGH);
  p.set('geometry.volumeCm3', 1400, S.STL_GEOMETRY_ANALYSIS, C.HIGH);
  p.set('geometry.size', [200, 150, 80], S.STL_GEOMETRY_ANALYSIS, C.HIGH);
  p.set('process.wallUsed', 20, S.USER_INPUT, C.USER_CONFIRMED);
  p.set('process.mcHotspot', 12, S.USER_INPUT, C.USER_CONFIRMED);
  p.set('process.wallHot', 10, S.DERIVED, C.MEDIUM);
  p.set('process.Ho', 180, S.USER_INPUT, C.USER_CONFIRMED);
  p.set('process.ph', 76, S.USER_INPUT, C.USER_CONFIRMED);
  p.set('production.cavities', 2, S.USER_INPUT, C.USER_CONFIRMED);
};

const CASES = [
  { name: '全 0', set: (p) => { for (const k of ['geometry.blankWeightKg', 'geometry.netWeightKg', 'geometry.volumeCm3', 'process.wallUsed', 'process.mcHotspot', 'process.wallHot', 'process.Ho', 'process.ph']) p.set(k, 0); } },
  { name: '负值', set: (p) => { p.set('geometry.blankWeightKg', -5); p.set('geometry.volumeCm3', -100); p.set('process.wallUsed', -3); p.set('process.mcHotspot', -12); p.set('process.ph', -76); } },
  { name: '极小（合法下限附近）', set: (p) => { p.set('geometry.blankWeightKg', 1e-6); p.set('geometry.volumeCm3', 1e-6); p.set('process.wallUsed', 1e-6); p.set('process.mcHotspot', 0.001); } },
  { name: '极大', set: (p) => { p.set('geometry.blankWeightKg', 1e6); p.set('geometry.volumeCm3', 1e12); p.set('process.wallUsed', 1e5); p.set('process.mcHotspot', 1e5); } },
  { name: '无材料 / 密度 0', set: (p) => { p.set('material.family', ''); p.set('material.solidDensity', 0); p.set('material.liquidDensity', 0); } },
];

let dirty = 0, crashed = 0, ran = 0;
const report = [];
for (const c of CASES) {
  BASE(proj);
  c.set(proj);
  for (const m of CALC_MANIFEST) {
    let r;
    try { r = m.calculate({}); } catch (e) { crashed++; report.push(`[崩溃] ${c.name} / ${m.id}: ${e.message}`); continue; }
    ran++;
    if (r && r.blocked) continue;                       // 诚实门禁（blocked）不是脏数据
    if (r === null || r === undefined) continue;        // 显式"算不出"
    const issues = scan(r).filter(s => !/ = null$/.test(s));
    if (issues.length) { dirty++; report.push(`[脏值] ${c.name} / ${m.id}: ${issues.slice(0, 5).join(', ')}`); }
  }
}

console.log(`PHASE 73 边界审计：${CASES.length} 组极端输入 × ${CALC_MANIFEST.length} 个计算器 = ${ran} 次计算`);
if (report.length) { console.log(''); for (const l of report) console.log('  ' + l); }
console.log('');
console.log(crashed === 0 ? '  ✅ 无崩溃' : `  ❌ ${crashed} 次崩溃`);
console.log(dirty === 0 ? '  ✅ 无 NaN / Infinity / undefined 数值污染' : `  ❌ ${dirty} 处数值污染`);
process.exit(dirty || crashed ? 1 : 0);
