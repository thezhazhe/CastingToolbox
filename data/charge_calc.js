// ============================================================
// 熔炼加料计算 · 数据层（机器可读）
// 目标成分 = 原铁液目标（已扣除球化剂/孕育剂带入的硅）
// 吸收率默认值：主源《铸造工程师手册 第3版》表3-316（无芯感应炉）
//              +《铸造手册》熔炼卷，中频炉实践取中值；confidence 标注，用户可改
// 可疑值说明：FeMo 库内"50~55%"偏低、网络"Cr 烧损39.4%"与惯例矛盾 → 本表不用
// ============================================================

/** 支持的首批牌号（批B 牌号补全时在此扩展） */
export const CHARGE_GRADES = [
  'HT150', 'HT200', 'HT250',
  'QT400-18', 'QT450-10', 'QT500-7', 'QT600-3', 'QT700-2',
];

/**
 * 原铁液目标成分（%）
 * - C/Si/Mn/P/S：电炉熔炼的原铁液目标（球铁 Si 已扣除默认球化剂1.3%/孕育剂0.6%带入的硅）
 * - SiF：成铁最终硅（回炉料即成品金属，按 SiF 计）
 * - Mg：球铁残留镁目标；addons 为空表示灰铁（无球化/孕育）
 * - CE：成铁碳当量目标范围（材料卡引用，CE = C + 0.33(Si+P)）
 */
export const CHARGE_TARGETS = {
  HT150:     { C: 3.65, Si: 2.30, Mn: 0.65, P: 0.15, S: 0.10, SiF: 2.30, CE: '3.9~4.3', addons: null },
  HT200:     { C: 3.45, Si: 2.15, Mn: 0.70, P: 0.12, S: 0.10, SiF: 2.15, CE: '3.8~4.2', addons: null },
  HT250:     { C: 3.35, Si: 2.05, Mn: 0.80, P: 0.10, S: 0.10, SiF: 2.05, CE: '3.7~4.1', addons: null },
  'QT400-18':{ C: 3.75, Si: 1.90, Mn: 0.35, P: 0.05, S: 0.03, SiF: 2.75, Mg: 0.04, CE: '4.3~4.7', addons: { sphero: 1.3, inoc: 0.6 } },
  'QT450-10':{ C: 3.70, Si: 1.70, Mn: 0.40, P: 0.06, S: 0.03, SiF: 2.60, Mg: 0.04, CE: '4.3~4.6', addons: { sphero: 1.3, inoc: 0.6 } },
  'QT500-7': { C: 3.70, Si: 1.55, Mn: 0.45, P: 0.06, S: 0.03, SiF: 2.45, Mg: 0.04, CE: '4.3~4.5', addons: { sphero: 1.3, inoc: 0.6 } },
  'QT600-3': { C: 3.60, Si: 1.35, Mn: 0.60, P: 0.06, S: 0.03, SiF: 2.25, Mg: 0.04, CE: '4.1~4.4', addons: { sphero: 1.3, inoc: 0.6 } },
  'QT700-2': { C: 3.50, Si: 1.25, Mn: 0.60, P: 0.06, S: 0.03, SiF: 2.15, Mg: 0.04, CE: '4.0~4.3', addons: { sphero: 1.3, inoc: 0.6 } },
};

/** 金属炉料：元素含量（%）+ 默认整行吸收率 abs（对行内所有元素统一生效，可改） */
export const CHARGE_MATERIALS = {
  pigZ14: { label: '生铁 Z14', C: 3.5, Si: 1.5, Mn: 0.4,  P: 0.08, S: 0.04, abs: 0.90, note: '铸造生铁（GB/T 718）' },
  pigZ18: { label: '生铁 Z18', C: 3.5, Si: 1.8, Mn: 0.4,  P: 0.08, S: 0.04, abs: 0.90, note: '铸造生铁（GB/T 718）' },
  pigZ22: { label: '生铁 Z22', C: 3.5, Si: 2.2, Mn: 0.4,  P: 0.08, S: 0.04, abs: 0.90, note: '铸造生铁（GB/T 718）' },
  pigZ26: { label: '生铁 Z26', C: 3.5, Si: 2.6, Mn: 0.4,  P: 0.08, S: 0.04, abs: 0.90, note: '铸造生铁（GB/T 718）' },
  pigQ10: { label: '球墨生铁 Q10', C: 3.5, Si: 0.8, Mn: 0.15, P: 0.045, S: 0.025, abs: 0.90, note: '球墨用生铁（GB/T 1412）' },
  pigQ12: { label: '球墨生铁 Q12', C: 3.5, Si: 1.2, Mn: 0.15, P: 0.045, S: 0.025, abs: 0.90, note: '球墨用生铁（GB/T 1412）' },
  scrapC: { label: '废钢（普通）', C: 0.2,  Si: 0.3, Mn: 0.6,  P: 0.03, S: 0.03, abs: 0.90, note: '普通碳钢废钢' },
  scrapD: { label: '废钢（球铁返回）', C: 0.15, Si: 0.25, Mn: 0.5, P: 0.03, S: 0.02, abs: 0.90, note: '低 Cr 球铁废钢' },
  feSi75: { label: '75硅铁', Si: 75, abs: 0.85, note: '增硅' },
  feSi72: { label: '72硅铁', Si: 72, abs: 0.85, note: '增硅' },
  feMn65: { label: '锰铁 Mn65', Mn: 65, abs: 0.82, note: '增锰' },
  feMn78: { label: '锰铁 Mn78', Mn: 78, abs: 0.82, note: '增锰' },
  carb95: { label: '石墨增碳剂', C: 95, abs: 0.85, note: '石墨化增碳' },
  carb98: { label: '低硫低氮增碳剂', C: 98, abs: 0.85, note: '增碳，S<0.05%' },
};

/** 球化剂类型（含量% + 各元素吸收率） */
export const SPHERO_TYPES = {
  '稀土镁 Mg5.5': { Mg: 5.5, RE: 2.5, Si: 45, abs: { Mg: 0.45, RE: 0.55, Si: 0.80 }, note: '冲入法；喂丝法 Mg 吸收可到 0.6' },
  '稀土镁 Mg6':   { Mg: 6.0, RE: 2.5, Si: 45, abs: { Mg: 0.45, RE: 0.55, Si: 0.80 }, note: 'Mg 略高，适合硫偏高原铁液' },
};

/** 孕育剂类型 */
export const INOC_TYPES = {
  '75硅铁': { Si: 75, abs: { Si: 0.85 }, note: '炉前孕育' },
  '硅钡孕育剂': { Si: 65, Ba: 1.0, abs: { Si: 0.85 }, note: '含钡，抗衰退' },
};

/** 默认配比（金属炉料占铁液总重 %；种子取自库内脱敏配料案例） */
export const CHARGE_DEFAULTS = {
  HT: { pig: 'pigZ18', scrap: 'scrapC', pigPct: 20, scrapPct: 40, retPct: 40 },   // 参考 charge_HT200_cylinder
  QT: { pig: 'pigQ10', scrap: 'scrapD', pigPct: 30, scrapPct: 30, retPct: 40 },   // 参考 charge_QT450
};

/** 牌号 → 族（HT / QT） */
export function chargeFamily(grade) {
  return String(grade || '').startsWith('HT') ? 'HT' : 'QT';
}

/** 回炉料成分：即成品金属（灰铁=目标成分；球铁=成铁成分含残留 Mg、最终 Si） */
export function returnComposition(grade) {
  const t = CHARGE_TARGETS[grade];
  if (!t) return {};
  const ret = { C: t.C, Si: t.SiF, Mn: t.Mn, P: t.P, S: t.S };
  if (t.addons) ret.Mg = t.Mg;
  return ret;
}

/** 碳当量（CE = C + 0.33(Si+P)） */
export function carbonEquivalent(comp) {
  return (comp.C || 0) + 0.33 * ((comp.Si || 0) + (comp.P || 0));
}
