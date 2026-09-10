// manifest 冒烟测试：共享参数 → 8 计算器计算链
import { CALC_MANIFEST, allMissingInputs } from '../../calcs/calcManifest.js';
import * as proj from '../../js/model/CastingProject.js';
proj.reset();
proj.set('material.family', '球铁');
proj.set('geometry.volumeCm3', 800000);
proj.set('material.solidDensity', 7.1);   // PHASE 28.7-A 批准值（球铁）
proj.refreshWeight();
proj.set('geometry.size', [300, 200, 100]);
proj.set('process.wallUsed', 25);
proj.set('process.wallHot', 12.5);
proj.set('production.cavities', 2);
proj.set('process.pourPos', '顶注');
console.log('缺失参数:', allMissingInputs(CALC_MANIFEST.map(c => c.id)).map(p => `${p.label}(${p.input})`).join(', ') || '（无）');
const results = {};
let fail = 0;
for (const c of CALC_MANIFEST) {
  const r = c.calculate(results);
  results[c.id] = r;
  const ok = r !== null && r !== undefined;
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${c.id.padEnd(10)} ${ok ? JSON.stringify(Object.keys(r)).slice(0, 80) : '无结果'}`);
}
console.log(`\ngating.G=${results.gating?.G?.toFixed(1)}kg riser.D=${results.riser?.D}mm yield.pourWt=${results.yield?.pourWt?.toFixed(1)}kg`);
console.log(`chill: ${JSON.stringify(results.chill?.thickness)}mm sandbox.minWall=${results.sandbox?.minWall}mm machining.range=${JSON.stringify(results.machining?.range)} shakeout.time=${JSON.stringify(results.shakeout?.timeRange)}`);
console.log(`charge: ${results.charge ? `grade=${results.charge.defGrade} pourWt=${results.charge.pourWt.toFixed(1)}kg` : '✗'}`);
console.log(fail ? `\n${fail} 个计算器无结果` : '\n全部计算器正常');
