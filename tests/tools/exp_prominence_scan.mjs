// ============================================================
// PHASE 5 · MIN_PROMINENCE_RATIO 参数扫描（命令 8.txt）
// 值：0.35/0.40/0.45/0.50/0.55/0.60
// 模型：steppedThickness（薄端弱热结）/ thickCorner（臂端弱热结）/
//       bossOnPlate（thickOnThin 语义）/ lShape / pvpPair（twoThick）/
//       twoHotspots（过渡区弱热结 H3）
// 指标：主热结（mc 最大）检出 ✓ / 弱热结误报数（prominence < 0.8 的额外热结）
// 只报告数据，不自动选择参数
// ============================================================
import { generate } from './hotspotGeometryGenerator.mjs';
import { twoHotspots, genSTL } from '../helpers/stlGen.js';
import { parseSTL } from '../../js/engine/stl.js';
import { runAnalyze } from './validationCommon.mjs';
import { appendRaw, csvRows } from './validationCommon.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAW_DIR } from './validationConfig.mjs';

const VALUES = [0.35, 0.40, 0.45, 0.50, 0.55, 0.60];
const MODELS = ['steppedThickness', 'thickCorner', 'bossOnPlate', 'lShape', 'pvpPair', 'twoHotspots'];

const start = Date.now();
const out = [];
// 表格结构：rows[model][param] = { H, mainProm, extra: [prom...] }
const rows = {};
for (const m of MODELS) {
  rows[m] = {};
  for (const v of VALUES) {
    const mesh = m === 'twoHotspots'
      ? parseSTL(new TextEncoder().encode(genSTL(twoHotspots().sdf, twoHotspots().bounds, twoHotspots().res)).buffer)
      : generate(m).mesh;
    const r = runAnalyze(mesh, { MIN_PROMINENCE_RATIO: v });
    const hs = r.hotspots;
    const main = hs[0];   // 引擎按 confidence 排序（H1 为主热结）
    const extras = hs.slice(1).map(h => +h.prominenceScore.toFixed(3));
    rows[m][v] = { H: hs.length, status: r.status, mainProm: main?.prominenceScore ?? null, extras };
    out.push({
      model: m, parameter: v, status: r.status,
      H: hs.length, mainProminence: main?.prominenceScore ?? null,
      extraProminences: extras, note: null,
      classification: null,
    });
  }
}

// 表格输出
console.log('MIN_PROMINENCE_RATIO 扫描（H 数量）');
console.log('模型'.padEnd(18) + VALUES.map(v => String(v).padStart(7)).join(''));
for (const m of MODELS) {
  const cell = v => {
    const d = rows[m][v];
    const tag = d.status === 'ok' ? `${d.H}` : d.status === 'LOW_CONFIDENCE' ? 'LOW' : d.status === 'NO_HOTSPOT' ? 'NONE' : d.status;
    return tag.padStart(7);
  };
  console.log(m.padEnd(18) + VALUES.map(cell).join(''));
}

// 主热结保持性检查
console.log('\n主热结（mc 最大）在全部参数值下保持检出：');
for (const m of MODELS) {
  const ok = VALUES.every(v => rows[m][v].H >= 1);
  console.log(`  ${m.padEnd(18)} ${ok ? '✓' : '✗'}`);
}

// 弱热结误报随参数变化
console.log('\n弱热结（extra）数量随参数变化：');
for (const m of ['steppedThickness', 'thickCorner', 'twoHotspots']) {
  console.log(`  ${m}: ` + VALUES.map(v => `${v}:${rows[m][v].H - 1}`).join('  '));
}

appendRaw('exp10_prominence', out, { values: VALUES, elapsedSec: ((Date.now() - start) / 1000).toFixed(1) });
writeFileSync(join(RAW_DIR, 'exp10_prominence.csv'), [
  'model,parameter,status,H,mainProminence,extraProminences',
  ...out.map(r => [r.model, r.parameter, r.status, r.H, r.mainProminence ?? '', r.extraProminences.join('|')].join(',')),
].join('\n'));
console.log(`\n完成 ${((Date.now() - start) / 1000).toFixed(1)}s → raw/exp10_prominence.json`);
