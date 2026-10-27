// ============================================================
// R6-S4（155.txt）· 出品率整模口径 + 保存/分析分离 + 提示分层
//   数值证据走真实入口：CALC_MANIFEST / buildYieldLedger。
//   交互契约的静态守卫只检查“保存函数体内不得触发分析”，
//   真实点击行为由 scripts/browser_s4_test.mjs 覆盖。
// ============================================================
import { readFileSync } from 'node:fs';
import * as proj from '../js/model/CastingProject.js';
import { SRC, CONF } from '../js/model/CastingProject.js';
import { getCalcManifest } from '../calcs/calcManifest.js';
import { buildYieldLedger } from '../js/views/yieldLedger.js';

const assert = (c, m) => { if (!c) throw new Error(m); };
const same = (a, b, m) => { if (a !== b) throw new Error(`${m}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`); };
const near = (a, b, t, m) => { if (!(Math.abs(a - b) <= t)) throw new Error(`${m}（期望 ${b}±${t}，实际 ${a}）`); };

function seedAll(cav = 1) {
  proj.reset();
  proj.set('material.family', '球铁');
  proj.set('material.solidDensity', 7.1, SRC.SCENARIO, CONF.MEDIUM);
  proj.set('material.liquidDensity', 6.9, SRC.SCENARIO, CONF.MEDIUM);
  proj.set('material.yieldSug', 65, SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('geometry.geomStatus', 'VALID', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.netWeightKg', 20, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
  proj.set('geometry.blankWeightKg', 20, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
  proj.set('process.wallUsed', 10, SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('production.cavities', cav, SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('production.line', '水平线', SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('production.method', '砂型 · 机器造型/壳型', SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('process.pourPos', '顶注', SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('process.Ho', 150, SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('process.ph', 100, SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('process.riserShape', 'cyl', SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('hotspots.status', 'ok', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('hotspots.items', [{ id: 1, mc: 8 }], SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('process.mcHotspot', 8, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
}

function calcAll() {
  const g = getCalcManifest('gating').calculate({});
  const r = getCalcManifest('riser').calculate({});
  const y = getCalcManifest('yield').calculate({ gating: g, riser: r });
  return { g, r, y };
}

/** 取函数体（按花括号配对；先去掉注释，避免注释里的字样影响契约判断）。 */
function bodyOf(src, signature) {
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
  const start = clean.indexOf(signature);
  if (start < 0) throw new Error('找不到函数：' + signature);
  /* 跳过参数表（`function f(a, opts = {}) {` 里的 `{}` 不是函数体）。 */
  const sigEnd = clean.indexOf(') {', start);
  if (sigEnd < 0) throw new Error('找不到函数体：' + signature);
  const open = sigEnd + 2;
  let depth = 0;
  for (let i = open; i < clean.length; i++) {
    if (clean[i] === '{') depth++;
    else if (clean[i] === '}') {
      depth--;
      if (depth === 0) return clean.slice(open, i + 1);
    }
  }
  throw new Error('函数体未闭合：' + signature);
}

const DC_SRC = readFileSync(new URL('../js/views/designCenter.js', import.meta.url), 'utf8');

export const tests = [
  {
    name: 'S4-Y1 核心新增整模字段：castingMass / riserUnit / riserWtTotal / gatingWtResidual / finalYield=null',
    fn: () => {
      for (const cav of [1, 2, 4]) {
        seedAll(cav);
        const { g, r, y } = calcAll();
        near(y.castingMass, g.castingMass, 1e-12, `cav=${cav} castingMass 必须取浇注链实际值`);
        near(y.castingMass, 20 * cav, 1e-12, `cav=${cav} castingMass = 单件 × 型腔数`);
        near(y.riserUnit, y.riserWt, 1e-12, `cav=${cav} riserUnit 与旧 riserWt 同值（单套）`);
        near(y.riserWtTotal, y.riserUnit * cav, 1e-12, `cav=${cav} riserWtTotal = 单套 × 型腔数`);
        near(y.gatingWtResidual, g.G - y.castingMass - y.riserWtTotal, 1e-9,
          `cav=${cav} gatingWtResidual = G − 整模铸件 − 整模冒口`);
        same(y.cavityCount, cav, `cav=${cav} 型腔数回显`);
        same(y.finalYield, null, `cav=${cav} 无实测浇道/浇注重量时 finalYield 必须为 null`);
        same(y.designYield, g.yv, `cav=${cav} designYield 回显浇注链设计值`);
      }
    },
  },
  {
    name: 'S4-Y2 旧字段语义未被改写（castWt 单件 / runnerWt = G−单件 / riserWt 单套）',
    fn: () => {
      seedAll(2);
      const { g, y } = calcAll();
      near(y.castWt, 20, 1e-12, '旧 castWt 仍是单件');
      near(y.runnerWt, g.G - 20, 1e-12, '旧 runnerWt 仍是 G − 单件（兼容字段，不改语义）');
      near(y.riserWt, y.riserUnit, 1e-12, '旧 riserWt 仍是单套');
      near(y.castWt / y.pourWt * 100, 32.5, 1e-9, '旧口径 2 腔仍会得到 32.5% —— 只有展示层禁止用它当最终出品率');
    },
  },
  {
    name: 'S4-Y3 整模账目优先消费核心新字段；残差浇道重不被标成实测',
    fn: () => {
      seedAll(2);
      const { g, y } = calcAll();
      const L = buildYieldLedger({
        cav: g.cav, blankWt: g.pw, pourWt: g.G,
        riserWt: y.riserUnit, castingMass: y.castingMass,
        riserWtTotal: y.riserWtTotal, gatingWtResidual: y.gatingWtResidual,
        designYield: g.ya,
      });
      near(L.blankTotal, y.castingMass, 1e-12, '账目整模铸件重必须取核心新字段');
      near(L.riserTotal, y.riserWtTotal, 1e-12, '账目整模冒口重必须取核心新字段');
      near(L.gatingEst, y.gatingWtResidual, 1e-12, '账目浇道重必须取核心反推残差');
      same(L.finalYield, null, '账目不得伪造最终实重出品率');
      same(L.finalYieldReason, 'missing_independent_gating_weight', '缺口原因必须可解释');
      // 旧结果对象（无新字段）仍能回退
      const legacy = buildYieldLedger({ cav: 2, blankWt: 20, pourWt: g.G, riserWt: y.riserWt, designYield: g.yv });
      near(legacy.blankTotal, 40, 1e-12, '旧结果回退：整模铸件重 = 单件 × 腔数');
      near(legacy.riserTotal, y.riserWt * 2, 1e-12, '旧结果回退：整模冒口重 = 单套 × 腔数');
    },
  },
  {
    name: 'S4-I1 保存函数体不得触发分析；顶部 ④ 才执行分析',
    fn: () => {
      const saveBody = bodyOf(DC_SRC, 'function saveParamDraft');
      assert(!/autoRecompute\s*\(/.test(saveBody), 'saveParamDraft 仍调用 autoRecompute —— 保存与分析未分离');
      assert(!/\brunAnalysis\s*\(/.test(saveBody), 'saveParamDraft 仍直接调用 runAnalysis —— 保存与分析未分离');
      assert(/if \(!paths\.length && !restorePaths\.length\)/.test(saveBody), '缺少“无修改保存不得标记过期”的守卫');
      assert(/参数未发生变化/.test(saveBody), '无修改保存必须明确提示');
      const saveBtn = DC_SRC.match(/id="dc_pfSave"[^>]*>([^<]*)</);
      assert(saveBtn, '找不到保存按钮');
      assert(saveBtn[1].includes("tr('保存')") && !saveBtn[1].includes('保存并分析'), '保存按钮文案仍含“保存并分析”');
      const startBody = bodyOf(DC_SRC, 'function startAnalysis');
      assert(/saveParamDraft\(container, \{ fromAnalysis: true \}\)/.test(startBody),
        '有未保存修改时，分析必须先经用户确认再保存');
      assert(/\brunAnalysis\(container/.test(startBody), 'startAnalysis 必须执行完整分析');
    },
  },
  {
    name: 'S4-I2 结果页/报告不得把“换形状不改 D/H”的公式段放在默认可见区；报告用“反推残差”标注',
    fn: () => {
      const rc = readFileSync(new URL('../js/views/resultsCenter.js', import.meta.url), 'utf8');
      assert(!/const shapeDiffNote\s*=/.test(rc), '结果页仍构造默认可见的 shapeDiffNote');
      assert(!/shapeDiffNote\s*\}/.test(rc), '结果页仍把 shapeDiffNote 插进主卡片');
      const report = readFileSync(new URL('../js/views/reportGenerator.js', import.meta.url), 'utf8');
      assert(report.includes('反推残差'), '报告未把浇道重标成反推残差');
      assert(!report.includes('浇道重（差值 − 整模冒口）'), '报告仍用旧的“差值”标签暗示独立实重');
    },
  },
];
