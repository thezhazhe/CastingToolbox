// ============================================================
// Validation 报告生成器：读 raw/*.json → 统计 → validation_report.json
// （结论文字部分由最终报告人工撰写，本工具输出全部统计数字）
// 用法: node tests/tools/report.mjs
// ============================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { OUT_DIR, RAW_DIR } from './validationConfig.mjs';

const RAW_FILES = ['exp00_core', 'exp01_gradient', 'exp02_position', 'exp03_size',
  'exp04_thinWall', 'exp05_fillet', 'exp06_pvp', 'exp07_multi',
  'exp08_rotation', 'exp08_translation', 'exp08_scale', 'exp08_determinism', 'exp09_perf'];

const all = [];
for (const f of RAW_FILES) {
  const p = join(RAW_DIR, f + '.json');
  if (!existsSync(p)) { console.log(`缺失 raw: ${f}`); continue; }
  const j = JSON.parse(readFileSync(p, 'utf8'));
  all.push(...j.records.map(r => ({ ...r, _exp: f })));
}

const R = {};

/* 分类计数（exp00_core 有真实 classification） */
const cls = {};
for (const r of all.filter(r => r.classification)) cls[r.classification] = (cls[r.classification] || 0) + 1;
R.classification = cls;

/* 位置误差分布 */
const grades = {};
const posErrs = all.filter(r => r.positionError !== null && r.positionError !== undefined)
  .map(r => ({ model: r.model, err: r.positionError, grade: r.positionGrade, exp: r._exp }));
for (const p of posErrs) grades[p.grade] = (grades[p.grade] || 0) + 1;
R.positionGrades = grades;
R.positionCount = posErrs.length;
const sorted = [...posErrs].sort((a, b) => b.err - a.err);
R.positionWorst = sorted.slice(0, 10).map(p => `${p.model}: ${p.err}mm (${p.grade})`);

/* 状态分布（全部记录） */
const states = {};
for (const r of all) states[r.status] = (states[r.status] || 0) + 1;
R.states = states;

/* 各实验记录数 */
const byExp = {};
for (const r of all) { byExp[r._exp] = (byExp[r._exp] || 0) + 1; }
R.byExperiment = byExp;
R.totalRecords = all.length;

/* 定位误差 vs 距中心（位置扫描） */
const posScan = all.filter(r => r._exp === 'exp02_position' && r.distFromCenter !== undefined);
const buckets = {};
for (const p of posScan) {
  const b = Math.floor(p.distFromCenter / 50) * 50;
  const key = `${b}-${b + 50}`;
  (buckets[key] = buckets[key] || []).push(p.positionError);
}
R.posErrorVsDist = Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, { n: v.length, avg: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1), max: +Math.max(...v).toFixed(1) }]));

/* 厚度梯度行为曲线 */
const grad = all.filter(r => r._exp === 'exp01_gradient' && r.thicknessRatio !== undefined);
R.gradient = grad.map(g => ({ ratio: g.thicknessRatio, cand: g.hasCandidate, HS: g.hasHotspot, status: g.status, conf: g.confidence, prom: g.prominenceScore }));

/* PVP 边界 */
const pvp = all.filter(r => r._exp === 'exp06_pvp');
R.pvp = { total: pvp.length, mismatches: pvp.filter(p => p.expectSplit !== p.gotSplit).map(p => `${p.tA}/${p.tB} v=${p.v} theory=${p.theoryDepth} actual=${p.actualDepth}`) };
R.pvp.actualDepthRange = pvp.filter(p => p.actualDepth > 0).map(p => p.actualDepth);

/* 性能 */
const perf = all.filter(r => r._exp === 'exp09_perf');
R.perf = perf.map(p => ({ faces: p.triCount, totalMs: p.runtime, dfMs: p._dfMs, candRefineMs: p._candRefineMs, budgetOk: p.budgetOk, vs: p.debug.vs }));

/* 不变量 */
R.rotation = all.filter(r => r._exp === 'exp08_rotation' && r.rotErr !== null).map(r => `${r.model}: ${r.rotErr}mm`);
R.translation = all.filter(r => r._exp === 'exp08_translation' && r.transErr !== null).map(r => `${r.model}: ${r.transErr}mm`);
R.scale = all.filter(r => r._exp === 'exp08_scale').map(r => `scale${r.parameters.scale}: ${r.scaleErr}mm`);
const det = all.filter(r => r._exp === 'exp08_determinism');
R.determinism = det.length ? det[0].identical : null;

/* 薄壁 */
const tw = all.filter(r => r._exp === 'exp04_thinWall');
R.thinWall = {
  total: tw.length,
  byState: Object.fromEntries(Object.entries(Object.groupBy ? Object.groupBy(tw, t => t.status) : {}).map(([k, v]) => [k, v.length])),
  belowMcStep: tw.filter(t => t.mcStepMm > t.wall).length,
  smallestReliable: tw.filter(t => t.status !== 'INSUFFICIENT_RESOLUTION' && t.mcStepMm <= t.wall).sort((a, b) => a.wall / a.size - b.wall / b.size)[0]?.model,
};

/* 圆角 */
const fl = all.filter(r => r._exp === 'exp05_fillet');
R.fillet = fl.map(f => ({ R: f.R, status: f.status, H: f.detected.hotspots.length, conf: f.confidence, cornerD: f.cornerD }));

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'validation_report.json'), JSON.stringify(R, null, 1));
console.log(`统计完成：${all.length} 条记录 → tests/golden/analytical/validation_report.json`);
console.log('分类: ' + JSON.stringify(cls));
console.log('位置分级: ' + JSON.stringify(grades));
