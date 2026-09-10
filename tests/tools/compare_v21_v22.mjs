// ============================================================
// V2.1 vs V2.2 对比（PHASE 7）：定位误差 / 状态 / H 数量变化
// 数据源：raw_v21/（V2.1 快照） vs raw/（V2.2 全量）
// 用法: node tests/tools/compare_v21_v22.mjs
// ============================================================
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW_V21 = join(HERE, '..', 'golden', 'analytical', 'raw_v21');
const RAW_V22 = join(HERE, '..', 'golden', 'analytical', 'raw');

const FILES = ['exp00_core', 'exp01_gradient', 'exp02_position', 'exp03_size', 'exp04_thinWall',
  'exp05_fillet', 'exp05b_filletShell', 'exp06_pvp', 'exp07_multi', 'exp08_rotation', 'exp08_translation', 'exp08_scale'];

function load(dir, f) {
  const p = join(dir, f + '.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')).records || [];
}

/** 匹配 key：model + 参数 JSON（排除非参数键） */
function recKey(r) {
  const p = r.parameters || {};
  return `${r.model}|${JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k]) => !['label', 'n'].includes(k) || k === 'n')))}`;
}

let improved = 0, worsened = 0, same = 0, statusChanged = 0, noV21 = 0;
const detail = [];
for (const f of FILES) {
  const v21 = load(RAW_V21, f);
  const v22 = load(RAW_V22, f);
  if (!v21 || !v22) { console.log(`${f}: 缺数据 v21=${!!v21} v22=${!!v22}`); continue; }
  const m21 = new Map(v21.map(r => [recKey(r), r]));
  const m22 = new Map(v22.map(r => [recKey(r), r]));
  for (const [k, r22] of m22) {
    const r21 = m21.get(k);
    if (!r21) { noV21++; continue; }
    const e21 = r21.positionError, e22 = r22.positionError;
    const s21 = r21.status, s22 = r22.status;
    if (s21 !== s22) statusChanged++;
    let delta = null;
    if (e21 !== null && e21 !== undefined && e22 !== null && e22 !== undefined) {
      delta = +(e22 - e21).toFixed(2);
      if (delta < -0.01) improved++;
      else if (delta > 0.01) worsened++;
      else same++;
    }
    detail.push({
      file: f, key: k, s21, s22, e21: e21 === null ? null : +e21.toFixed(2),
      e22: e22 === null ? null : +e22.toFixed(2), delta,
      h21: r21.detected?.hotspots?.length, h22: r22.detected?.hotspots?.length,
    });
  }
}

console.log(`对比完成：改善 ${improved} / 恶化 ${worsened} / 不变 ${same} / 状态变化 ${statusChanged} / V2.1 无对应 ${noV21}`);
console.log('\n── 定位误差变化明细（delta < -1mm 改善 / > +1mm 恶化）──');
for (const d of detail) {
  if (d.delta !== null && (d.delta < -1 || d.delta > 1)) {
    console.log(`  ${d.key.padEnd(36)} ${d.e21 ?? '—'}mm → ${d.e22 ?? '—'}mm (${d.delta > 0 ? '+' : ''}${d.delta}) ${d.s21}→${d.s22}`);
  }
}
console.log('\n── 状态变化 ──');
for (const d of detail) if (d.s21 !== d.s22) console.log(`  ${d.key.padEnd(36)} ${d.s21} → ${d.s22} (H ${d.h21}→${d.h22})`);
