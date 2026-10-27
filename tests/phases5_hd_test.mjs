// ============================================================
// S5-05（158.txt §二.S5-05）· 设计中心有限 H/D 开放
//
//   契约：
//     · 默认 H/D = 1.0 时，设计中心结果与既有调用逐位一致；
//     · 0.8 / 1.0 / 1.2 / 1.5 四档只改变几何尺寸分配，不改 Mr_target = 1.2 × Mc；
//     · 球形 H ≡ D（H/D 不参与几何）；球顶柱仍保证 H ≥ R；
//     · 旧项目缺字段 / 非法值回退 1.0；
//     · 页面/报告使用实际 H/D（由最终 D/H 计算），不再出现“设计中心固定 1.00”。
//
//   本套件只走真实生产入口（calcManifest.riser.calculate / runRiser / 报告渲染），
//   不复制生产输出当期望；几何判据全部可独立推理。
// ============================================================
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRiser, RISER_SHAPES, meetsTarget } from '../calcs/riser.js';
import * as proj from '../js/model/CastingProject.js';
import { SRC, CONF } from '../js/model/CastingProject.js';
import { getCalcManifest } from '../calcs/calcManifest.js';
import { riserItemFacts } from '../js/views/resultFacts.js';
import { buildWorkflowReport } from '../js/views/reportGenerator.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, '..', p), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
const assert = (c, m) => { if (!c) throw new Error(m); };
const same = (a, b, m) => { if (a !== b) throw new Error(`${m}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`); };
const near = (a, b, tol, m) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m}（期望 ${b}±${tol}，实际 ${a}）`); };

const SHAPES = ['cyl', 'sphere_head', 'sphere', 'square'];
const HDS = [0.8, 1.0, 1.2, 1.5];
const MCS = [5, 11.43, 20];

const manifestRiser = () => getCalcManifest('riser');

/** 受控项目状态（与 phasev2022 同口径的最小子集） */
function seed({ shape = 'cyl', hd, mc = 14, netWt = 77.56 } = {}) {
  proj.reset();
  proj.set('material.family', '球铁', SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('material.solidDensity', 7.1, SRC.SCENARIO, CONF.MEDIUM);
  proj.set('geometry.geomStatus', 'VALID', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.netWeightKg', netWt, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
  proj.set('geometry.blankWeightKg', netWt, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
  proj.set('hotspots.status', 'ok', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('hotspots.items', [{ id: 1, mc }], SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('process.mcHotspot', mc, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('process.wallHot', mc / 2, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('process.riserShape', shape, SRC.USER_INPUT, CONF.USER_CONFIRMED);
  if (hd !== undefined) proj.set('process.hdRatio', hd, SRC.USER_INPUT, CONF.USER_CONFIRMED);
  return proj;
}

/** 由整数直径求高度（与 riser.js 的 hOf 同规则；本测试的独立复述） */
function hOf(shape, d, hd) {
  let h = Math.round(d * hd);
  if (shape === 'sphere_head') { const r = d / 2; if (h < r) h = Math.round(r); }
  if (shape === 'sphere') h = d;
  return h;
}
/** 满足目标模数的最小整数直径（独立暴力实现；达标判据用生产侧 meetsTarget） */
function minD(shape, Mr, hd) {
  const sd = RISER_SHAPES[shape];
  let d = Math.max(1, Math.round(sd.DfromM(Mr, hd)));
  for (let i = 0; i < 64 && !meetsTarget(sd.M(d, hOf(shape, d, hd)), Mr); i++) d++;
  for (let i = 0; i < 64 && d > 1 && meetsTarget(sd.M(d - 1, hOf(shape, d - 1, hd)), Mr); i++) d--;
  return d;
}

export const tests = [
  {
    name: 'S5-H/D-1 默认 1.0：设计中心结果与直接 runRiser(hd=1.0) 逐位一致',
    fn: () => {
      seed({ shape: 'cyl' });
      const r = manifestRiser().calculate();
      const direct = runRiser({ mat: '球铁', cast_wt: 77.56, mc_mode: 'direct', mc: 14, shape: 'cyl', hd_ratio: 1.0 });
      assert(r && direct, '两条路径都应返回结果');
      for (const k of ['D', 'H', 'Mr_act', 'Mr_target', 'Vr', 'effV', 'd_neck']) {
        near(r[k], direct[k], 1e-12, `${k} 应与 hd=1.0 基线逐位一致`);
      }
      same(r.hd, 1.0, '默认 hd 应为 1.0');
    },
  },
  {
    name: 'S5-H/D-2 旧项目缺字段/非法值：回退 1.0，结果不变',
    fn: () => {
      seed({ shape: 'cyl' });
      const base = manifestRiser().calculate();
      for (const bad of [undefined, 0, -1, NaN, Infinity, 'abc']) {
        proj.set('process.hdRatio', bad);
        const r = manifestRiser().calculate();
        assert(r, `非法 hd=${String(bad)} 不应让设计中心返回 null`);
        for (const k of ['D', 'H', 'Mr_act', 'Vr']) near(r[k], base[k], 1e-12, `非法 hd=${String(bad)} 时 ${k} 应回退 1.0`);
      }
    },
  },
  {
    name: 'S5-H/D-3 四形状 × 四比例：H 由整数 D 导出；球形 H≡D；球顶柱 H≥R；D 最小且达标',
    fn: () => {
      for (const shape of SHAPES) {
        for (const hd of HDS) {
          for (const mc of MCS) {
            seed({ shape, hd, mc });
            const r = manifestRiser().calculate();
            assert(r, `${shape}/hd=${hd}/Mc=${mc} 应有结果`);
            near(r.Mr_target, mc * 1.2, 1e-12, `${shape}/hd=${hd}/Mc=${mc} 的 Mr_target 不得随 H/D 改变`);
            near(r.hd, hd, 1e-12, `${shape}/hd=${hd}/Mc=${mc} 应把设计 H/D 送入计算`);
            if (shape === 'sphere') {
              same(r.H, r.D, `${shape}/hd=${hd}/Mc=${mc} 球形必须 H ≡ D`);
            } else {
              same(r.H, hOf(shape, r.D, hd), `${shape}/hd=${hd}/Mc=${mc} 的 H 应由整数 D 导出`);
              if (shape === 'sphere_head') assert(r.H >= r.D / 2, `${shape}/hd=${hd}/Mc=${mc} 球顶柱必须 H ≥ R`);
            }
            assert(meetsTarget(r.Mr_act, r.Mr_target), `${shape}/hd=${hd}/Mc=${mc} 的 Mr_act 未达目标`);
            same(r.D, minD(shape, r.Mr_target, hd), `${shape}/hd=${hd}/Mc=${mc} 的 D 不是最小可行整数档`);
          }
        }
      }
    },
  },
  {
    name: 'S5-H/D-4 改 H/D 只改几何分配：D/H/Vr 变化，Mr_target 不变',
    fn: () => {
      seed({ shape: 'cyl', hd: 1.0, mc: 14 });
      const a = manifestRiser().calculate();
      seed({ shape: 'cyl', hd: 1.5, mc: 14 });
      const b = manifestRiser().calculate();
      near(b.Mr_target, a.Mr_target, 1e-12, '目标模数规则不得随 H/D 改变');
      assert(a.D !== b.D || a.H !== b.H, '不同 H/D 应产生不同几何（否则参数没接进去）');
      assert(Math.abs(b.H / b.D - 1.5) <= 0.5 / b.D + 1e-12, '实际 H/D 应接近名义 1.5（取整误差 ≤0.5/D）');
      assert(a.Vr !== b.Vr, '冒口体积应随 H/D 改变');
    },
  },
  {
    name: 'S5-H/D-5 结果事实与报告：显示实际 H/D；球形写 H≡D；不再出现“固定 1.00”',
    fn: () => {
      seed({ shape: 'cyl', hd: 1.5, mc: 14 });
      const r = manifestRiser().calculate();
      const f = riserItemFacts(r);
      near(f.hd, r.H / r.D, 1e-12, '结果事实的 H/D 必须是 H/D 实际值');
      const rep = buildWorkflowReport({ riser: r });
      assert(rep.includes('H/D（高度 / 直径）'), '报告缺少 H/D 行');
      assert(rep.includes((r.H / r.D).toFixed(2)), '报告 H/D 必须与最终 D/H 一致');
      assert(!rep.includes('设计中心当前固定 hd = 1.00'), '报告不得再写“设计中心固定 hd = 1.00”');

      seed({ shape: 'sphere', hd: 1.5, mc: 14 });
      const s = manifestRiser().calculate();
      const repS = buildWorkflowReport({ riser: s });
      assert(repS.includes('H ≡ D（球形）'), '球形报告必须写 H ≡ D');
      same(s.H, s.D, '球形结果必须 H ≡ D（即使 hd=1.5）');
    },
  },
  {
    name: 'S5-H/D-6 接线护栏：calcManifest 读 process.hdRatio；模型默认 1.0；只有球形隐藏 H/D（发热/保温沿用）',
    fn: () => {
      const cm = strip(read('calcs/calcManifest.js'));
      assert(/process\.hdRatio/.test(cm), 'calcManifest 未读取 process.hdRatio');
      assert(/hd_ratio: hdRatio/.test(cm), 'calcManifest 未把 H/D 传给 runRiser');
      assert(!/hd_ratio: 1\.0/.test(cm), 'calcManifest 仍有硬编码 hd_ratio 1.0');
      const model = read('js/model/CastingProject.js');
      assert(/hdRatio: P\(1\.0/.test(model), 'CastingProject 缺少 process.hdRatio 默认 1.0');
      const dc = read('js/views/designCenter.js');
      assert(dc.includes("path: 'process.hdRatio'") && dc.includes('data-hd-field'), '参数面板缺少 H/D 输入/隐藏钩子');
      assert(dc.includes('data-hd-sphere-note'), '参数面板缺少球形 H≡D 说明');
      const rc = strip(read('js/views/resultsCenter.js'));
      assert(!rc.includes('设计中心当前固定 hd = 1.00'), '结果页仍有“固定 hd=1.00”旧口径');
      assert(rc.includes('H/D（高度 / 直径）'), '结果页缺少 H/D 行');
      const rv = read('js/views/riserView.js');
      assert(rv.includes('const fixed = shape === \'sphere\';') && rv.includes('hdField.hidden = fixed'),
        '独立计算器应只对球形隐藏 H/D');
      assert(!rv.includes("shape === 'sphere' || shape === 'insulated'"),
        '发热/保温继续沿用当前 H/D，不得再隐藏/固定为 1');
      assert(rv.includes('applyInsulatedRiserResult(base, { hdRatio: input.hd_ratio })'),
        '发热/保温主结果应使用共享转换函数并传入当前 H/D');
    },
  },
];
