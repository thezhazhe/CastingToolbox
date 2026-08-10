// ============================================================
// 浇注系统设计 · 纯计算模块（从 casting_design_web.html v3.8 提取）
// 公式来源：《铸造手册》浇注系统章节 —— Dietert 浇注时间、奥赞阻流截面
// ============================================================

// ---- 材料数据库（密度 ρ / 材质系数 f / 出品率区间） ----
export const MATERIALS = {
  '灰铁(HT)':   { rho: 7.0, fc: 1.00, y_min: 65, y_max: 85, y_sug: 75 },
  '球铁(QT)':   { rho: 6.9, fc: 0.85, y_min: 55, y_max: 75, y_sug: 65 },
  '铸钢(ZG)':   { rho: 7.5, fc: 0.80, y_min: 50, y_max: 65, y_sug: 58 },
  '铝合金(Al)': { rho: 2.6, fc: 1.20, y_min: 70, y_max: 90, y_sug: 80 },
  '铜合金(Cu)': { rho: 8.4, fc: 0.90, y_min: 55, y_max: 70, y_sug: 62 },
};

// ---- 浇注比例预设（S直 : S横 : S内） ----
export const RATIO_PRESETS = {
  '封闭式 保守型(灰铁)': { type: '封闭', r: [1.0, 1.5, 0.8],  note: '阻流在内浇口' },
  '封闭式 常用型':       { type: '封闭', r: [1.0, 2.0, 0.85], note: '阻流在内浇口' },
  '封闭式 大件型':       { type: '封闭', r: [1.0, 2.5, 0.9],  note: '阻流在内浇口' },
  '开放式 标准型':       { type: '开放', r: [1.0, 2.0, 2.0],  note: '阻流在直浇道' },
  '开放式 宽大型':       { type: '开放', r: [1.0, 2.5, 2.5],  note: '阻流在直浇道' },
  '开放式 铝合金属':     { type: '开放', r: [1.0, 3.0, 3.0],  note: '阻流在直浇道' },
};

// ---- 浇注系统类型智能推荐（按材料家族 + 铸件重量） ----
// 原理：有色合金（铝/铜）与球铁/铸钢常用开放式（阻流在直浇道）平稳充型防氧化；
//       灰铁常用封闭式（阻流在内浇口）；大件升档为大件型。
export function recommendGatingRatio(matKey, partWt) {
  const byMat = {
    '灰铁(HT)':   '封闭式 常用型',
    '球铁(QT)':   '开放式 标准型',
    '铸钢(ZG)':   '开放式 宽大型',
    '铝合金(Al)': '开放式 铝合金属',
    '铜合金(Cu)': '开放式 标准型',
  };
  let rec = byMat[matKey] || '封闭式 常用型';
  if (partWt > 200) {
    const big = {
      '灰铁(HT)':   '封闭式 大件型',
      '球铁(QT)':   '开放式 宽大型',
      '铸钢(ZG)':   '开放式 宽大型',
      '铝合金(Al)': '开放式 宽大型',
      '铜合金(Cu)': '开放式 宽大型',
    }[matKey];
    if (big) rec = big;
  }
  return rec;
}

// 水口盆高度 Hb 查表（按浇注重量 G 分段）
function calc_Hb(G) {
  if (G < 10)     return 150;
  if (G < 50)     return 200;
  if (G < 200)    return 250;
  if (G < 1000)   return 300;
  if (G < 3000)   return 500;
  if (G < 8000)   return 750;
  return 1100;
}

// 浇注时间 t (s) —— Dietert：t = f × (√G + ∛(w×G/5)) × 2/3
export function calc_t(G, w, f) {
  return f * (Math.sqrt(G) + Math.pow(w * G / 5, 1 / 3)) * 2 / 3;
}

// 平均静压头 Hp (mm)：顶注 / 中注 / 底注
export function calc_Hp(pos, Ho, Hb, P, C, rh) {
  if (pos === '顶注') return Ho + Hb / 2 - rh * rh / (2 * C);
  if (pos === '中注') return Ho + Hb / 2 - (P + C - rh) * (P + C - rh) / (2 * C);
  return Ho + Hb / 2 - Ho / 2; // 底注
}

// 阻流截面积 A_choke (mm²) —— 奥赞：A = 71.47 × G / (ρ×t×fv×√Hp) × 100
export function calc_A(G, rho, t, fv, Hp) {
  if (t <= 0 || Hp <= 0) return 0;
  return 71.47 * G / (rho * t * fv * Math.sqrt(Hp)) * 100;
}

// 内浇口流速 v (m/s) 校核 —— 标准 ≤ 1.8
export function calc_v(G, rho, t, F) {
  if (t > 0 && F > 0) return 10 * G / (t * rho * F / 100);
  return 0;
}

// ---- 主计算：返回完整结果对象 ----
export function runGating(input) {
  const md = MATERIALS[input.mat] || MATERIALS['灰铁(HT)'];
  const rho = md.rho, fc = md.fc;

  const pw   = input.pw || 0;
  const cav  = input.cav || 1;
  const yv   = (input.yr || md.y_sug) / 100;
  const wall = input.wall || 0;
  const Ho   = input.Ho || 0;
  const ph   = input.ph || 0;
  const rh   = input.rh || 0;
  const pos  = input.pos || '顶注';

  // 比例预设 or 自定义
  let rd;
  if (input.custom) {
    rd = { type: '自定义', r: [input.cs || 1, input.cr || 1, input.cg || 1], note: '用户自定义比例' };
  } else {
    rd = RATIO_PRESETS[input.ratioKey] || RATIO_PRESETS['封闭式 保守型(灰铁)'];
  }
  const [s_r, r_r, g_r] = rd.r;

  // 浇注重量 G = 单件毛重 × 一模件数 ÷ 出品率
  const G = yv > 0 ? pw * cav / yv : 0;
  const Cmm = ph + rh;
  const Hb = calc_Hb(G);

  // P 值依浇注方向
  const Pv = pos === '顶注' ? 0 : pos === '中注' ? Cmm / 2 : Cmm;

  const Hp = calc_Hp(pos, Ho, Hb, Pv, Cmm, rh);
  const fv = { 顶注: 0.8, 中注: 0.6, 底注: 0.45 }[pos] || 0.8;

  const t = calc_t(G, wall, fc);
  const A = calc_A(G, rho, t, fv, Hp);

  // 面积比例分配
  const min_r = Math.min(s_r, r_r, g_r);
  const A_sp  = A * (s_r / min_r);   // 直浇道参考面积
  const A_run = A * (r_r / min_r);   // 横浇道参考面积
  const A_gt  = A * (g_r / min_r);   // 内浇道参考面积
  const cp = min_r === g_r ? '内浇口' : min_r === s_r ? '直浇道' : '横浇道';

  // 内浇道尺寸（方形）：个数×厚度，自动算长度
  const gc = input.gc || 0, gt = input.gt || 0;
  let L_g = 0, Fg = 0;
  if (gc > 0 && gt > 0) {
    L_g = Math.max(5, Math.round(A_gt / (gc * gt) / 5) * 5);
    Fg = gt * L_g * gc;
  }

  // 横浇道尺寸（长方形）：条数×厚度
  const rc = input.rc || 0, rt = input.rt || 0;
  let L_r = 0, Fr_act = 0;
  if (rc > 0 && rt > 0) {
    L_r = Math.max(10, Math.round(A_run / (rc * rt) / 5) * 5);
    Fr_act = rt * L_r * rc;
  }

  // 直浇道（1根圆形）
  const D_sp = Math.max(5, Math.round(Math.sqrt(4 * A_sp / Math.PI)));
  const Fs_act = Math.PI * D_sp * D_sp / 4;

  // 实际比例
  let rrv = 0, rgv = 0;
  if (Fs_act > 0 && Fr_act > 0) {
    rrv = Fr_act / Fs_act;
    rgv = Fg / Fs_act;
  }

  // 流速校核
  const v = Fg > 0 ? calc_v(G, rho, t, Fg) : 0;
  const v_ok = v <= 1.8;

  // 排气计算：圆孔 + 方片
  const vrd = input.vr || 0, vrc = input.vrc || 0;
  const vsw = input.vs || 0, vst = input.vst || 0, vsc = input.vsc || 0;
  const vt  = Math.PI * vrd * vrd / 4 * vrc + vsw * vst * vsc;
  const vr  = Fs_act > 0 ? vt / Fs_act : 0;
  const vr_ok = vr >= 1.5;

  // 实际出品率
  const ya = G > 0 ? pw * cav / G * 100 : 0;

  // 优化建议
  const sugs = [];
  if (!v_ok)    sugs.push(`❌ 流速 ${v.toFixed(2)} > 1.8 m/s！需增大内浇道或加瓷管`);
  if (!vr_ok)   sugs.push(`❌ 排气 ${vr.toFixed(1)} < 1.5 倍！需增加排气面积`);
  if (Fg < A_gt * 0.7) sugs.push(`⚠️ 内浇道偏小（参考 ${A_gt.toFixed(0)} mm²）`);
  if (Fg > A_gt * 1.3) sugs.push(`⚠️ 内浇道偏大（可适当减小）`);
  if (Fr_act < A_run * 0.8) sugs.push(`⚠️ 横浇道不足（需 ${A_run.toFixed(0)} mm²）`);
  if (sugs.length === 0) sugs.push('✅ 参数合理，无需优化');
  const allOk = v_ok && vr_ok;

  return {
    mat: input.mat, rho, fc, pw, cav, wall,
    yv: Math.round(yv * 100), pos, Ho, ph, rh,
    ratioKey: input.ratioKey, rd,
    G, Cmm, Hb, Pv, Hp, fv, t, A,
    A_sp, A_run, A_gt, cp,
    gc, gt, L_g, Fg, rc, rt, L_r, Fr_act,
    D_sp, Fs_act, rrv, rgv, v, v_ok, vr, vr_ok, ya, sugs, allOk,
    s_r, r_r, g_r, min_r,
  };
}
