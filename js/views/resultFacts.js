// ============================================================
// 结果事实层 · 纯派生（无 DOM、无工程计算）
// ------------------------------------------------------------
// R6-S3.1（154.txt §六/§八）：结果页与工艺计算报告**共用同一套权威派生口径**：
//   · RH 的物理含义/来源/是否用户指定
//   · 浇注系统三段（直/横/内）+ 排气 + 整模重量账目
//   · 冒口形状尺寸字段（球形只有一个尺寸自由度）
//   · 需要主界面展示的 P0/P1 风险
// 本模块只读取 calcs 已有输出与 CastingProject 元数据，**不改变任何公式/数值**。
// ============================================================
import * as proj from '../model/CastingProject.js';
import { RISER_SHAPES } from '../../calcs/riser.js';
import { buildYieldLedger } from './yieldLedger.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pos = (v) => { const n = num(v); return n != null && n > 0 ? n : null; };
const cm3 = (mm3) => (num(mm3) != null ? mm3 / 1000 : null);

/** RH 的权威读取口径：唯一存储 = process.riserHeight；只有 USER_INPUT/USER_OVERRIDE 才算用户指定。 */
export function rhInfo() {
  const p = proj.get('process.riserHeight');
  const value = pos(p?.v);
  const src = p?.src || null;
  const isUser = !!value && (src === proj.SRC.USER_OVERRIDE || src === proj.SRC.USER_INPUT);
  const isLegacyAuto = src === proj.SRC.CALC_RESULT;
  return {
    value: value || 0,
    src,
    isUser,
    isLegacyAuto,
    hasValue: !!value,
    needsReview: !isUser,
    labelKey: isUser ? '用户指定' : (value ? '非用户来源（需复核）' : '未指定（按 0 计）'),
  };
}

/** 浇注系统是否给出物理上可用的静压头/阻流面积（不改变计算结果，只给出有效性）。 */
export function gatingValidity(g) {
  if (!g) return { ok: true, level: null, code: null };
  if (!(pos(g.Hp))) {
    return {
      ok: false, level: 'P0', code: 'gating_hp_invalid',
      textKey: '平均静压头 Hp ≤ 0：RH 与铸件高度组合不成立，阻流面积不可用。请减小 RH 或核对 ph / Ho。',
    };
  }
  if (!(pos(g.A))) {
    return {
      ok: false, level: 'P0', code: 'gating_a_invalid',
      textKey: '阻流截面 A ≤ 0：浇注系统尺寸不可用，请核对 RH、Ho、ph 与出品率。',
    };
  }
  return { ok: true, level: null, code: null };
}

/** 浇注系统展示事实：结果页卡片与报告共用（数值全部来自 runGating 输出）。 */
export function gatingFacts(g, results = {}) {
  if (!g) return null;
  const y = results?.yield || null;
  const ledger = buildYieldLedger({
    cav: g.cav, blankWt: g.pw, pourWt: g.G,
    /* S4：优先消费核心新增的整模字段；旧结果对象回退到 riserWt（单套）。 */
    riserWt: y && (y.riserUnit ?? y.riserWt) != null ? (y.riserUnit ?? y.riserWt) : null,
    castingMass: y?.castingMass,
    riserWtTotal: y?.riserWtTotal,
    gatingWtResidual: y?.gatingWtResidual,
    /* g.ya 是未舍入的实际反算值（=castingMass/G），g.yv 是取整后的输入回显。
       展示统一用 g.ya，避免同一页同时出现 69% 与 68.5%。 */
    designYield: (g.ya != null ? g.ya : (g.yv != null ? g.yv : y?.designYield)),
  });
  return {
    g,
    rh: rhInfo(),
    validity: gatingValidity(g),
    ledger,
    production: {
      cav: num(g.cav), designYield: num(g.ya) ?? num(g.yv),
      line: proj.getV('production.line') || '不指定',
      method: proj.getV('production.method') || '不指定',
    },
    hydraulic: {
      Cmm: num(g.Cmm), Hp: num(g.Hp), Hb: num(g.Hb), Pv: num(g.Pv),
      A: num(g.A), t: num(g.t), fv: num(g.fv),
    },
    areas: [
      {
        key: 'sprue', titleKey: '直浇道',
        diameter: num(g.D_sp), area: num(g.Fs_act), reference: num(g.A_sp),
      },
      {
        key: 'runner', titleKey: '横浇道',
        count: num(g.rc), thickness: num(g.rt), length: num(g.L_r),
        area: num(g.Fr_act), reference: num(g.A_run),
        /* 164 §五：截面类型与梯形几何（主结果只属于当前选中方案）。 */
        section: g.runnerSection?.kind || 'rect',
        sectionLabel: g.runnerSection?.label || '矩形',
        isTrapezoid: g.runnerSection?.isTrapezoid === true,
        top: num(g.runnerSection?.top), bottom: num(g.runnerSection?.bottom),
        height: num(g.runnerSection?.height), actualEach: num(g.runnerSection?.actualEach),
        targetEach: num(g.runnerSection?.targetEach),
        actualTotal: num(g.runnerSection?.actualTotal), targetTotal: num(g.runnerSection?.targetTotal),
      },
      {
        key: 'ingate', titleKey: '内浇道', shape: g.gateShape || '方形',
        count: num(g.gc), thickness: num(g.gt), length: num(g.L_g), diameter: num(g.D_g),
        area: num(g.Fg), reference: num(g.A_gt), velocity: num(g.vFinal), targetVelocity: num(g.vTarget),
      },
    ],
    vent: {
      diameter: num(g.ventD), count: num(g.ventN), area: num(g.vt),
      ratio: num(g.vr), ok: g.vr_ok === true, target: num(g.ventNeed),
    },
  };
}

/** 一个冒口结果的尺寸字段（球形只有球径一个自由度；不再把 H 当成第二个尺寸）。 */
export function riserDimensions(it) {
  const k = it?.shapeKey || 'cyl';
  const D = num(it?.D), H = num(it?.H);
  const mm = (v) => (v == null ? '—' : String(v));
  if (k === 'sphere') return [{ key: 'D', labelKey: '冒口球径 D', value: '⌀' + mm(D), unit: 'mm' }];
  if (k === 'square') return [
    { key: 'a', labelKey: '冒口边长 a（长 × 宽）', value: mm(D) + ' × ' + mm(D), unit: 'mm' },
    { key: 'H', labelKey: '冒口高度 H', value: mm(H), unit: 'mm' },
  ];
  if (k === 'sphere_head') return [
    { key: 'D', labelKey: '冒口直径 D', value: '⌀' + mm(D), unit: 'mm' },
    { key: 'H', labelKey: '冒口高度 H', value: mm(H), unit: 'mm' },
    { key: 'R', labelKey: '球顶半径 R', value: 'R' + (D == null ? '—' : fmtHalf(D)), unit: 'mm' },
  ];
  return [
    { key: 'D', labelKey: '冒口直径 D', value: '⌀' + mm(D), unit: 'mm' },
    { key: 'H', labelKey: '冒口高度 H', value: mm(H), unit: 'mm' },
  ];
}
const fmtHalf = (D) => String(parseFloat((D / 2).toFixed(1)));

/** 单个冒口事实（结果页/报告共用；只做读取与派生，不重算工程量）。 */
export function riserItemFacts(it) {
  if (!it) return null;
  const k = it.shapeKey || 'cyl';
  const sd = RISER_SHAPES[k] || RISER_SHAPES.cyl;
  const MrT = it.Mr_target != null ? num(it.Mr_target) : num(it.Mr_need);
  const cw = num(it.cw);
  const needVolCm3 = cm3(it.needVol);
  const effVCm3 = cm3(it.effV);
  const volRefAvailable = cw != null && cw > 0 && needVolCm3 != null && effVCm3 != null;
  const insulated = it.designType === 'insulated';
  return {
    raw: it,
    shapeKey: k,
    shapeName: insulated ? '发热/保温冒口（经验估算）' : sd.name,
    shapeFormula: insulated ? 'V1 = 0.4 × 普通圆柱 V0；沿用当前 H/D' : sd.formula,
    insulated,
    V0Cm3: cm3(it.V0), V1Cm3: cm3(it.V1), VactualCm3: cm3(it.Vactual),
    weightKg: num(it.weightKg),
    shapeLabel: (() => { try { return sd.label(it.D, it.H); } catch (e) { return '—'; } })(),
    dimensions: riserDimensions(it),
    D: num(it.D), H: num(it.H), hd: (pos(it.D) && pos(it.H)) ? it.H / it.D : null,
    Mc: num(it.Mc), MrT, MrAct: num(it.Mr_act), targetRatio: num(it.targetRatio),
    modOk: it.modOk === true,
    VrCm3: cm3(it.Vr), effPct: num(it.eff) != null ? it.eff * 100 : null, effVCm3,
    needVolCm3, cw, volOk: it.volOk === true,
    volRefAvailable,
    volRefShort: volRefAvailable && it.volOk !== true,
    level: it.level || null,
    mcSrc: it.mcSrc || null,
    dNeck: num(it.d_neck),
  };
}

export function riserFacts(r) {
  if (!r || r.blocked) return null;
  const items = (r.items && r.items.length) ? r.items : [r];
  return {
    raw: r,
    items: items.map(riserItemFacts).filter(Boolean),
    multi: items.length > 1,
    level: r.level || null,
    note: r.note || null,
    mcSrc: r.mcSrc || null,
  };
}

/** 需要主界面直接展示的 P0/P1 风险（P2/P3 留在详细信息）。 */
export function collectRisks(results = {}, opts = {}) {
  const out = [];
  const g = results?.gating;
  const r = results?.riser;
  if (g) {
    const v = gatingValidity(g);
    if (!v.ok) out.push({ level: 'P0', code: v.code, textKey: v.textKey, actionPath: 'process.riserHeight' });
    if (g.vState === 'high') {
      out.push({
        level: 'P1', code: 'ingate_velocity_high',
        textKey: '内浇口平均流速 {v} m/s 高于目标 {hi} m/s：需按目标速度优化或复核内浇道尺寸。',
        params: { v: fmt1(g.vFinal), hi: fmt1(g.vTargetHi ?? g.vTarget) },
        /* 内浇道/排气入口只在**结果页**（参数面板没有这两个字段）——
           用 actionNav 切到对应结果页，不能打开一个找不到字段的参数面板。 */
        actionNav: 'gating',
      });
    }
    if (g.vr_ok === false) {
      out.push({
        level: 'P1', code: 'vent_ratio_out',
        textKey: '排气面积比 {vr} 倍不在企业标准 1.5~4 倍内：请调整排气孔直径/孔数。',
        params: { vr: fmt1(g.vr) }, actionNav: 'gating',
      });
    }
  }
  if (r && !r.blocked) {
    /* S5-01/S5-02/S5-04：旧体积参考不足、Mc 自动估计、最终实重出品率不可得
       这三条不再进入 P1 风险条。
         · 旧体积模型已确认不是设计判据，且用户明确要求不再提示采取行动；
         · Mc 估计值说明改为冒口结果底部的一行普通文字（见 resultsCenter）；
         · 实际出品率不再由工具推算展示，人工回算入口在独立计算器。 */
    if (g && !rhInfo().isUser) {
      out.push({
        level: 'P1', code: 'rh_not_user_specified',
        textKey: 'RH 未指定：浇注系统按 RH = 0 计算。请按实际冒口位置填写 RH 并复核 Hp。',
        actionPath: 'process.riserHeight',
      });
    }
  }
  const seen = new Set();
  return out.filter(x => (seen.has(x.code) ? false : (seen.add(x.code), true))).slice(0, opts.limit || 6);
}

const fmt1 = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(parseFloat(v.toFixed(1))) : '—');
