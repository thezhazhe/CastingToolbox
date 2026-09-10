// ============================================================
// PHASE 71.6（76.txt）· Design Center 输入区 / 任务区 / 冒口结果展示修正
//   T1  固定任务集：无"分析任务选择"，六个工艺结果固定产出（76.txt 一/二/十四 Case 1）
//   T2  冒口结果链路闭环：STL → mcHotspot/wallHot → runRiser → Page2 渲染（Case 2）
//   T3  冒口门禁读用户 Mc：无热点时手改 Mc 实际生效、结果页如实标注"用户输入"（Case 2/5）
//   T4  用户修改自动值（重量/壁厚/Mc）→ 下游使用当前采用值（Case 3）
//   T5  恢复自动值 → 下游回到 STL 原始值（Case 4）
//   T6  NO_HOTSPOT 不伪装成可靠热点（Case 5）
//   T7  重量语义：gating/yield = 毛坯重，riser 体积校核 = 铸件净重（Case 8 / 76.txt 十一）
//   T8  Page2 完整展示 riser 全部字段 + "来自现有冒口计算器"（76.txt 三）
// 说明：T2/T3/T4/T6 为端到端链（真实 cube50 STL → engine → calculate → 结果页 HTML）
// ============================================================
import { readFileSync } from 'node:fs';
import { parseSTL } from '../js/engine/stl.js';
import { buildMesh } from '../js/engine/mesh3d.js';
import { analyzeGeometry } from '../js/engine/geometryAnalysis.js';
import { analyzeHotspotsV3 as _v3 } from '../js/engine/v3/hotspotV3.js';
import { toViewResult, bodyRefOf } from '../js/engine/v3/v3ViewAdapter.js';
import * as proj from '../js/model/CastingProject.js';
import { SRC, CONF } from '../js/model/CastingProject.js';
import { CALC_MANIFEST, RUN_ORDER, allOptionalInputs } from '../calcs/calcManifest.js';
import { MATERIALS as GATING_MATS } from '../calcs/gating.js';
import { RISER_MATERIALS } from '../calcs/riser.js';
import { runRiser } from '../calcs/riser.js';
import { runGating } from '../calcs/gating.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

/* 固定任务集（与 designCenter.js FIXED_CALC_TASKS 保持一致——契约断言） */
const FIXED_CALC_TASKS = ['shrinkage', 'machining', 'riser', 'gating', 'yield'];
const CORE_RESULTS = ['shrinkage', 'machining', 'riser', 'gating', 'yield'];

let _meshCache = null;
function cubeAnalysis() {
  if (_meshCache) return _meshCache;
  const buf = readFileSync(new URL('./golden/cube50.stl', import.meta.url));
  const mesh = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const geometry = buildMesh(mesh).geometry;
  const geom = analyzeGeometry(mesh, geometry, {});
  const hs = toViewResult(_v3(mesh, geometry, {}), {
    wallMax: geom.wallMax, wallMain: geom.wallMain, wallAvg: geom.wallAvg,
  });
  _meshCache = { mesh, geom, hs };
  return _meshCache;
}

/** 真实 cube50 全链写入项目（等价 designCenter 的 STL 导入路径），返回 {geom, hs, bodyRef} */
function loadCube50() {
  const { geom, hs } = cubeAnalysis();
  proj.reset();
  proj.set('material.family', '灰铁');
  proj.set('material.liquidDensity', GATING_MATS['灰铁(HT)'].rho, SRC.SCENARIO, CONF.MEDIUM);
  proj.set('material.solidDensity', RISER_MATERIALS['灰铁'].rho, SRC.SCENARIO, CONF.MEDIUM);
  proj.set('material.yieldSug', GATING_MATS['灰铁(HT)'].y_sug, SRC.SCENARIO, CONF.MEDIUM);
  proj.set('geometry.valid', true, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.geomStatus', 'VALID', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.size', geom.size.map(v => Math.round(v * 10) / 10), SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.volumeCm3', parseFloat((geom.volume / 1000).toFixed(2)), SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.areaCm2', parseFloat((geom.area / 100).toFixed(1)), SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.wallMax', parseFloat(geom.wallMax.toFixed(1)), SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.wallAvg', parseFloat(geom.wallAvg.toFixed(1)), SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.refreshWeight();
  const br = bodyRefOf(geom, hs.debug?.v3?.coarse?.thin || {});   // 可信主体壁厚链（PHASE 26）
  proj.set('process.wallUsed', parseFloat(br.bodyRef.toFixed(1)), SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('process.wallHot', parseFloat((br.bodyRef / 2).toFixed(1)), SRC.DERIVED, CONF.MEDIUM);
  proj.set('hotspots.status', hs.status, SRC.STL_GEOMETRY_ANALYSIS, CONF.MEDIUM);
  proj.set('hotspots.reason', hs.reason || '', SRC.STL_GEOMETRY_ANALYSIS, CONF.MEDIUM);
  proj.set('hotspots.items', hs.hotspots.map(h => ({ id: h.id, x: h.x, y: h.y, z: h.z, mc: h.mc })), SRC.STL_GEOMETRY_ANALYSIS, CONF.MEDIUM);
  if (hs.status === 'ok' && hs.hotspots.length) {
    proj.set('process.mcHotspot', Math.round(hs.hotspots[0].mc * 10) / 10, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  }
  return { geom, hs, bodyRef: br.bodyRef, sampling: hs.sampling, ctx: { sampling: hs.sampling, bodyRef: br.bodyRef, hasStl: true, manual: false } };
}

/** 固定任务集执行（等价 designCenter.runAnalysis 的循环体） */
function runFixed() {
  const results = {};
  for (const id of RUN_ORDER) {
    if (!FIXED_CALC_TASKS.includes(id)) continue;
    const m = CALC_MANIFEST.find(c => c.id === id);
    const r = m.calculate(results);
    results[id] = r;
    if (id === 'riser' && r && !r.blocked && proj.get('process.riserHeight').src !== SRC.USER_OVERRIDE) {
      proj.setResult('process.riserHeight', r.H);
    }
  }
  return results;
}

export const tests = [
  {
    name: '71.6-T1 固定任务集：六个工艺结果固定产出，独立计算器不进入流程（76.txt 一/二）',
    fn: () => {
      assert(FIXED_CALC_TASKS.length === 5, '固定任务集 = 5 个 manifest 计算器');
      // RUN_ORDER 中核心项全覆盖；chill/sandbox/charge/shakeout 不在固定集（仍可独立使用）
      for (const id of FIXED_CALC_TASKS) {
        assert(RUN_ORDER.includes(id), `${id} 在执行顺序中`);
        assert(CALC_MANIFEST.some(c => c.id === id), `${id} 仍在 manifest（文件未删）`);
      }
      for (const id of ['charge', 'sandbox', 'shakeout', 'chill']) {
        assert(!FIXED_CALC_TASKS.includes(id), `${id} 不进入设计中心流程`);
        assert(CALC_MANIFEST.some(c => c.id === id), `${id} 独立计算器仍存在`);
      }
      loadCube50();
      const R = runFixed();
      for (const id of CORE_RESULTS) assert(R[id], `${id} 结果产出`);
      // 线收缩率 / 加工余量 现在是核心结果（此前默认不跑）
      assert(R.shrinkage.combined > 0, '线收缩率结果有效');
      assert(R.machining.mid > 0, '加工余量结果有效');
    },
  },
  {
    name: '71.6-T2 冒口链路闭环：STL 参数 → riser calculate → 结果对象完整（Case 2）',
    fn: () => {
      const { hs, bodyRef } = loadCube50();
      const R = runFixed();
      const r = R.riser;
      assert(r && !r.blocked, 'riser 未被门禁阻止');
      assert(r.Mc > 0, `Mc 有值（${r.Mc}）`);
      // 无热点路径：Mc = wallHot = 主体壁厚/2（诚实兜底链）
      if (hs.status !== 'ok') {
        assert(Math.abs(r.Mc - bodyRef / 2) < 0.05, `无热点时 Mc = 主体壁厚/2（${r.Mc} vs ${bodyRef / 2}）`);
        assert(/未检测到可靠热点/.test(r.note || ''), `结果携带"未检测到可靠热点"说明（${r.note}）`);
      }
      for (const k of ['D', 'H', 'Mr_act', 'Mr_need', 'Vr', 'effV', 'eff', 'd_neck', 'M_neck', 'cw', 'needVol', 'modOk', 'volOk', 'level']) {
        assert(r[k] !== undefined && r[k] !== null, `riser 结果字段 ${k} 存在`);
      }
      assert(r.D > 0 && r.H > 0, `冒口尺寸有效（⌀${r.D}×${r.H}）`);
      assert(r.modOk === true, '实际模数 ≥ 所需模数（自动迭代保证）');
    },
  },
  {
    name: '71.6-T3 冒口门禁读用户 Mc：无热点时手改 Mc 实际生效并如实标注（Case 2/5）',
    fn: () => {
      loadCube50();
      // UI 在无热点时把 Mc 写到 process.wallHot（mcDisplayPath）——门禁必须识别为用户输入
      proj.set('process.wallHot', 15);
      const R1 = runFixed();
      assert(R1.riser.Mc === 15, `用户 Mc=15 实际进入计算（实际 ${R1.riser.Mc}）`);
      assert(/用户确认的热节模数/.test(R1.riser.note || ''), `结果说明标注用户输入（${R1.riser.note}）`);
      assert(R1.riser.level === 'WARNING_REVIEW', '人工放行 → 需人工复核等级');
      // 覆盖前的自动值仍可恢复（orig 语义）
      assert(proj.get('process.wallHot').orig && proj.get('process.wallHot').orig.v > 0, 'orig 保留自动原值');
      // 有热点路径：UI 写 mcHotspot，同样生效
      proj.set('hotspots.status', 'ok', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
      proj.set('hotspots.items', [{ id: 1, x: 0, y: 0, z: 0, mc: 20 }, { id: 2, x: 5, y: 0, z: 0, mc: 12 }], SRC.STL_GEOMETRY_ANALYSIS, CONF.MEDIUM);
      proj.set('process.mcHotspot', 20, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
      assert(runFixed().riser.Mc === 20, 'STL 热结 Mc 生效');
      proj.set('process.mcHotspot', 25);
      const R2 = runFixed();
      assert(R2.riser.Mc === 25, `有热点时用户覆盖 Mc 生效（${R2.riser.Mc}）`);
      assert(R2.riser.level === 'WARNING_REVIEW', '用户覆盖 → 需人工复核');
    },
  },
  {
    name: '71.6-T4 用户修改自动值 → 下游使用当前采用值（Case 3）',
    fn: () => {
      loadCube50();
      proj.set('process.wallUsed', 12);          // 用户改主体壁厚（自动值 50）
      const R1 = runFixed();
      assert(Math.abs(R1.gating.wall - 12) < 1e-6, `gating 主体壁厚 = 用户值（${R1.gating.wall}）`);
      const t1 = R1.gating.t;
      proj.set('process.wallUsed', 30);
      const R2 = runFixed();
      assert(Math.abs(R2.gating.wall - 30) < 1e-6, '再次修改后 gating 跟随当前采用值');
      assert(Math.abs(R2.gating.t - t1) > 0.5, `浇注时间随壁厚变化（${t1.toFixed(2)} → ${R2.gating.t.toFixed(2)}）`);
      // 用户改毛坯重 → gating/yield 跟随（毛坯口径）
      proj.set('geometry.blankWeightKg', 1.5);
      const R3 = runFixed();
      assert(Math.abs(R3.gating.pw - 1.5) < 1e-6, `gating pw = 用户毛坯重（${R3.gating.pw}）`);
      assert(Math.abs(R3.yield.castWt - 1.5) < 1e-6, `yield castWt = 用户毛坯重（${R3.yield.castWt}）`);
      assert(R3.gating.G > R2.gating.G, '浇注重量随毛坯重上升');
    },
  },
  {
    name: '71.6-T5 恢复自动值 → 下游回到 STL 原始值（Case 4）',
    fn: () => {
      const { bodyRef } = loadCube50();
      const autoBlank = proj.getV('geometry.blankWeightKg');
      proj.set('geometry.blankWeightKg', 9.9);
      assert(proj.getV('geometry.blankWeightKg') === 9.9, '用户覆盖生效');
      assert(proj.restoreAutoValue('geometry.blankWeightKg'), '可恢复自动值');
      assert(proj.getV('geometry.blankWeightKg') === autoBlank, `恢复为 STL 派生原值（${proj.getV('geometry.blankWeightKg')}）`);
      const R = runFixed();
      assert(Math.abs(R.gating.pw - autoBlank) < 1e-6, `gating 回到 STL 原始毛坯重（${R.gating.pw}）`);
      // 壁厚恢复同理
      proj.set('process.wallUsed', 8);
      proj.restoreAutoValue('process.wallUsed');
      assert(Math.abs(proj.getV('process.wallUsed') - bodyRef) < 0.05, '壁厚恢复为 STL 主体壁厚');
      const R2 = runFixed();
      assert(Math.abs(R2.gating.wall - bodyRef) < 0.05, 'gating 回到 STL 壁厚');
    },
  },
  {
    name: '71.6-T6 NO_HOTSPOT 不伪装成可靠热点（Case 5）',
    fn: () => {
      const { hs } = loadCube50();
      assert(hs.status === 'NO_HOTSPOT', `cube50 当前引擎状态（${hs.status}）`);
      const R = runFixed();
      const r = R.riser;
      assert(r.note && r.note.includes('未检测到可靠热点'), '结果明确标注"未检测到可靠热点"');
      assert(r.note.includes('初步估算'), '明确是初步估算（非精确冒口设计）');
      assert(r.level !== 'SAFE_TO_RECOMMEND', '不标为可直接采用');
      assert(r.note.includes('不是 STL 识别出'), '显式声明这不是 STL 识别出的热点');
      // 分析失败（INSUFFICIENT_RESOLUTION）→ 门禁阻止（不绕过）
      proj.reset();   // 清掉可能的用户 Mc 覆盖（人工放行是唯一旁路——此处验证无人工输入时被阻止）
      proj.set('material.family', '灰铁');
      proj.set('material.solidDensity', RISER_MATERIALS['灰铁'].rho, SRC.SCENARIO, CONF.MEDIUM);
      proj.set('material.yieldSug', 75, SRC.SCENARIO, CONF.MEDIUM);
      proj.set('geometry.geomStatus', 'VALID', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
      proj.set('geometry.blankWeightKg', 0.875, SRC.DERIVED, CONF.HIGH);
      proj.set('geometry.netWeightKg', 0.875, SRC.DERIVED, CONF.HIGH);
      proj.set('hotspots.status', 'INSUFFICIENT_RESOLUTION', SRC.STL_GEOMETRY_ANALYSIS, CONF.MEDIUM);
      proj.set('hotspots.items', [], SRC.STL_GEOMETRY_ANALYSIS, CONF.MEDIUM);
      proj.set('process.wallHot', 25, SRC.DERIVED, CONF.MEDIUM);
      const R2 = runFixed();
      assert(R2.riser && R2.riser.blocked === true, '分析失败时自动冒口建议被阻止');
      assert(R2.riser.level === 'BLOCK_AUTO_RECOMMEND', '阻止等级如实（不是静默出结果）');
      // 阻止状态下出品率仍须产出（riser 缺失不得让 yield 崩溃——PHASE 71.6 健壮性修复）
      assert(R2.yield && R2.yield.pourWt > 0, '冒口被阻止时出品率结果不受影响');
      assert(R2.yield.riserWt === null, '阻止状态下冒口重量如实为 null（不编造）');
    },
  },
  {
    name: '71.6-T7 重量语义：gating/yield = 毛坯重；riser 体积校核 = 铸件净重（Case 8 / §十一）',
    fn: () => {
      loadCube50();
      proj.set('geometry.blankWeightKg', 1.2);    // 毛坯（含加工余量）
      const net = proj.getV('geometry.netWeightKg');   // 净重（STL 体积×固态密度）
      assert(Math.abs(net - 0.875) < 0.02, `净重 = STL 体积×固态密度（${net}）`);
      const R = runFixed();
      // gating/yield：浇注重量口径 → 毛坯重
      assert(Math.abs(R.gating.pw - 1.2) < 1e-6, 'gating.pw = 毛坯重');
      assert(Math.abs(R.yield.castWt - 1.2) < 1e-6, 'yield.castWt = 毛坯重');
      // riser：补缩金属量 → 净重（体积校核对象）
      assert(Math.abs(R.riser.cw - net) < 1e-6, `riser.cw = 铸件净重（${R.riser.cw} vs 净重 ${net}）`);
      const expectVc = net * 1e6 / R.riser.rhoUsed;
      assert(Math.abs(R.riser.Vc - expectVc) < 1, `riser Vc 换算自净重（${R.riser.Vc.toFixed(0)} mm³）`);
      // 与独立计算器契约一致：runRiser 的 cast_wt 就是"要补缩的铸件金属重量"
      const direct = runRiser({ mat: '灰铁', cast_wt: net, mc_mode: 'direct', mc: R.riser.Mc, shape: 'sphere_head', hd_ratio: 1.0 });
      assert(direct.D === R.riser.D && direct.volOk === R.riser.volOk, '设计中心与独立计算器同一输入同结果');
      // 反向证据：用毛坯重算体积校核会要求更大冒口（证明两者不可混用）
      const withBlank = runRiser({ mat: '灰铁', cast_wt: 1.2, mc_mode: 'direct', mc: R.riser.Mc, shape: 'sphere_head', hd_ratio: 1.0 });
      assert(withBlank.needVol > direct.needVol, '毛坯重口径会高估所需补缩量（语义不可混用）');
    },
  },
  {
    name: '71.6-T8 Page2 完整展示 riser 结果 + 来源标注（76.txt 三）',
    fn: async () => {
      const { ctx } = loadCube50();
      const R = runFixed();
      const { renderResultsCenter } = await import('../js/views/resultsCenter.js');
      const container = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null, _nav: null };
      renderResultsCenter(container, R, { ctx, active: 'riser' });
      const html = container.innerHTML;
      for (const [label, key] of [['冒口直径', 'D'], ['冒口高度', 'H'], ['实际冒口模数', 'Mr_act'], ['冒口体积', 'Vr'], ['冒口颈', 'd_neck'], ['体积校核', 'volOk'], ['补缩效率', 'eff'], ['所需补缩金属量', 'needVol']]) {
        assert(html.includes(label), `Page2 展示「${label}」`);
      }
      assert(html.includes(String(R.riser.D)) && html.includes(String(Math.round(R.riser.H))), 'Page2 含实际数值');
      assert(html.includes('冒口结果来自现有冒口计算器'), 'Page2 明确注明结果出处');
      assert(html.includes('来源：') && /壁厚\/结构参考值|STL 热结检测|用户输入/.test(html), 'Page2 标注 Mc 来源');
      assert(html.includes('Campbell'), 'Campbell 布置提示保留');
      // 用户输入路径的来源标注
      proj.set('process.wallHot', 18);
      const R2 = runFixed();
      const c2 = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
      renderResultsCenter(c2, R2, { ctx, active: 'riser' });
      assert(c2.innerHTML.includes('用户输入'), '用户 Mc → Page2 来源 = 用户输入');
      assert(!c2.innerHTML.includes('壁厚/结构参考值'), '用户 Mc 时不再显示兜底来源');
    },
  },
];
