// ============================================================
// PHASE 15-A：Rotation Invariance（命令 15.txt 二）
// 全部 20 个工程模型 × RX90/RY90/RZ90
// 旋转热点位置逆变换回原坐标系后与基准比较：
//   数量 / M 相对误差 / position 误差 / 排序 / confidence
// 判定：M 差 ≤10% PASS（voxel 离散化）；位置 ≤max(25, 3×vs) PASS
// 用法: node tests/engineering-generated/phase15/p15_rotation.mjs
// ============================================================
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseSTL } from '../../../js/engine/stl.js';
import { rotX, rotY, rotZ, transformMesh } from '../../tools/hotspotGeometryGenerator.mjs';
import { HERE, DATA_DIR, runV3, invRX90, invRY90, invRZ90, matchPairs, posTol, rankCheck } from './p15_common.mjs';

const MODELS_DIR = join(HERE, '..', 'models');
const names = readdirSync(MODELS_DIR).filter(d => readdirSync(join(MODELS_DIR, d)).includes('model.stl')).sort();

const AXES = {
  RX90: { fn: rotX(90 * Math.PI / 180), inv: invRX90 },
  RY90: { fn: rotY(90 * Math.PI / 180), inv: invRY90 },
  RZ90: { fn: rotZ(90 * Math.PI / 180), inv: invRZ90 },
};

/** 单模型单轴判定 */
function compareRotation(name, axis, baseHot, rotHot, vs) {
  const tol = posTol(vs);
  const baseTop = baseHot.length ? baseHot[0].peakModulus : 0;
  // 数量
  const countDiff = rotHot.length - baseHot.length;
  const countVerdict = countDiff === 0 ? 'PASS'
    : (Math.abs(countDiff) === 1 && (!baseTop || rotHot.some(h => h.peakModulus < 0.5 * baseTop))) ? 'WARNING'
    : 'FAIL';

  // 配对（base → rotated，逆变换后）
  const { pairs, extra, missing } = matchPairs(
    baseHot.map(h => h.position), rotHot.map(h => h.position), tol);

  // M / confidence / position 误差
  const mErr = [], confDiff = [], posErrs = [];
  for (const p of pairs) {
    const b = baseHot[p.base], m = rotHot[p.moved];
    mErr.push(Math.abs(m.peakModulus - b.peakModulus) / b.peakModulus);
    confDiff.push(Math.abs(m.confidence - b.confidence));
    posErrs.push(p.dist);
  }
  const maxMErr = mErr.length ? Math.max(...mErr) : 0;
  const maxConf = confDiff.length ? Math.max(...confDiff) : 0;
  const maxPos = posErrs.length ? Math.max(...posErrs) : 0;

  const mVerdict = maxMErr <= 0.10 ? 'PASS' : maxMErr <= 0.20 ? 'WARNING' : 'FAIL';
  const posVerdict = maxPos <= tol ? 'PASS' : maxPos <= 2 * tol ? 'WARNING' : 'FAIL';
  const confVerdict = maxConf <= 0.15 ? 'PASS' : maxConf <= 0.30 ? 'WARNING' : 'FAIL';
  // 排序：rotated 的 M 序 vs 基准 M 序（匹配对中）
  const baseMs = pairs.map(p => baseHot[p.base].peakModulus);
  const movedMs = pairs.map(p => rotHot[p.moved].peakModulus);
  const rankVerdict = rankCheck(baseMs, movedMs) ? 'PASS' : 'WARNING';

  const overall = [countVerdict, mVerdict, posVerdict, confVerdict, rankVerdict].includes('FAIL') ? 'FAIL'
    : [countVerdict, mVerdict, posVerdict, confVerdict, rankVerdict].includes('WARNING') ? 'WARNING' : 'PASS';

  return { axis, countBase: baseHot.length, countRot: rotHot.length, countDiff, countVerdict,
    pairs: pairs.length, extra: extra.length, missing: missing.length,
    maxMErr: +maxMErr.toFixed(4), maxPos: +maxPos.toFixed(1), maxConf: +maxConf.toFixed(3),
    mVerdict, posVerdict, confVerdict, rankVerdict, overall, tol: +tol.toFixed(1), vs: +vs.toFixed(2) };
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const rows = [];
  console.log(`PHASE 15-A Rotation Invariance：${names.length} 模型 × 3 轴\n`);
  for (const name of names) {
    const mesh = parseSTL(readFileSync(join(MODELS_DIR, name, 'model.stl')));
    const base = runV3(mesh);
    const baseHot = base.v3.hotspots;
    const row = { model: name, baseStatus: base.v3.status, baseCount: baseHot.length, baseMs: base.v3.engineMs, axes: {} };
    for (const [axis, { fn, inv }] of Object.entries(AXES)) {
      const rotated = runV3(transformMesh(mesh, fn));
      const rotHot = rotated.v3.hotspots.map(h => ({ ...h, position: inv(h.position) }));
      row.axes[axis] = compareRotation(name, axis, baseHot, rotHot, rotated.v3.debug.coarse?.vs ?? 0);
    }
    rows.push(row);
    const flags = Object.values(row.axes).map(a => a.overall[0]).join('/');
    console.log(`${name.padEnd(22)} base H${baseHot.length}  RX/RY/RZ=${flags}  ${base.v3.engineMs}ms`);
  }
  writeFileSync(join(DATA_DIR, 'rotation.json'), JSON.stringify(rows, null, 2));
  const n = rows.length;
  const tally = (axis, key) => rows.reduce((acc, r) => acc + (r.axes[axis][key] === 'FAIL' ? 1 : 0), 0);
  console.log('\n════ 汇总（FAIL 计数）════');
  for (const axis of Object.keys(AXES)) {
    console.log(`${axis}: 数量${tally(axis, 'countVerdict')} M${tally(axis, 'mVerdict')} 位置${tally(axis, 'posVerdict')} conf${tally(axis, 'confVerdict')} 排序${tally(axis, 'rankVerdict')} 综合${tally(axis, 'overall')}`);
  }
  console.log(`\n→ ${join(DATA_DIR, 'rotation.json')}`);
}
main().catch(e => { console.error(e); process.exit(1); });
