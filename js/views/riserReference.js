// ============================================================
// 冒口颈 / 补缩距离 · 工程经验参考（纯计算 + 共享卡片）
//
// 产品口径（162.txt / 164.txt）：
//   · 冒口颈：M_N ≥ M_F / 3（DISA 经验规则）；M_F = 当前冒口的**实际有效模数**
//     （runRiser 返回的 Mr_act），不是 Mc，也不是冒口直径。
//   · 补缩距离：板状 2s、杆状 1.2s；s = 现有 STL 主体壁厚（process.wallUsed）。
//   · 164：发热/保温从参考卡升级为正式形状选项；主结果由 V1=0.4V0 与当前 H/D
//     反算，视图层通过 applyInsulatedRiserResult 整体替换，核心 riser.js 不改。
//   · 卡片 HTML 与主结果转换集中在共享模块，避免两个入口各写一套公式/取整/边界。
// ============================================================
import { t as tr } from '../i18n/index.js';

const EPS = 1e-9;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const fmt2 = (v) => (typeof v === 'number' && Number.isFinite(v) ? parseFloat(v.toFixed(2)).toString() : '—');
const ceilMm = (v) => Math.ceil(v - 1e-9);   // 理论值→实际尺寸：只向上取整到整数 mm

/** 圆形/正方形/长方形的颈模数参考范围 */
export function calcNeckReference({ modulus, shape = 'circle', sideA } = {}) {
  const Mf = num(Number(modulus));
  if (Mf == null || Mf <= 0) return { ok: false, reason: 'no_modulus' };
  const MnMin = Mf / 3;
  const MnMax = (2 * Mf) / 3;
  if (shape === 'circle' || shape === 'square') {
    const theoreticalMin = 4 * MnMin;
    const theoreticalMax = 4 * MnMax;
    let recommendedMin = ceilMm(theoreticalMin);
    while (recommendedMin / 4 < MnMin - EPS) recommendedMin += 1;
    let recommendedMax = ceilMm(theoreticalMax);
    while (recommendedMax / 4 < MnMax - EPS) recommendedMax += 1;
    const actualMin = recommendedMin / 4;
    const actualMax = recommendedMax / 4;
    const minWithin = actualMin >= MnMin - EPS && actualMin <= MnMax + EPS;
    const maxWithin = actualMax >= MnMin - EPS && actualMax <= MnMax + EPS;
    return {
      ok: true, Mf, MnMin, MnMax, shape,
      theoreticalMin, theoreticalMax, recommendedMin, recommendedMax,
      actualMin, actualMax, minWithin, maxWithin,
      /* 只有上下限的实际回算都落在 [M_N,min, M_N,max] 内才叫“范围内”。
         上限因整数向上取整通常会略高于 M_N,max；此时 verified=false，界面必须明示。 */
      verified: minWithin && maxWithin,
      exceedsUpper: actualMax > MnMax + EPS,
      belowLower: actualMin < MnMin - EPS,
    };
  }
  if (shape === 'rect') {
    const a = num(Number(sideA));
    if (a == null || a <= 0) return { ok: false, reason: 'bad_side', Mf, MnMin, MnMax };
    if (a <= 2 * MnMax + EPS) return { ok: false, reason: 'side_too_small', Mf, MnMin, MnMax, sideA: a };
    const theoreticalMin = (2 * a * MnMin) / (a - 2 * MnMin);
    const theoreticalMax = (2 * a * MnMax) / (a - 2 * MnMax);
    const modOf = (b) => (a * b) / (2 * (a + b));
    let recommendedMin = ceilMm(theoreticalMin);
    while (modOf(recommendedMin) < MnMin - EPS) recommendedMin += 1;
    let recommendedMax = ceilMm(theoreticalMax);
    while (modOf(recommendedMax) < MnMax - EPS) recommendedMax += 1;
    const actualMin = modOf(recommendedMin);
    const actualMax = modOf(recommendedMax);
    const minWithin = actualMin >= MnMin - EPS && actualMin <= MnMax + EPS;
    const maxWithin = actualMax >= MnMin - EPS && actualMax <= MnMax + EPS;
    return {
      ok: true, Mf, MnMin, MnMax, shape, sideA: a,
      theoreticalMin, theoreticalMax, recommendedMin, recommendedMax,
      actualMin, actualMax, minWithin, maxWithin,
      verified: minWithin && maxWithin,
      exceedsUpper: actualMax > MnMax + EPS,
      belowLower: actualMin < MnMin - EPS,
    };
  }
  return { ok: false, reason: 'bad_shape' };
}

/** 发热/保温冒口（164.txt 四）：V1 = 0.4 × 普通圆柱基准 V0；沿用圆柱 H/D。
 *
 *  V0 的口径：调用方必须传普通圆柱结果的 **几何体积 Vr**，不是 `effV`
 *  （`effV = Vr × 补缩效率`）。0.4 是产品采用的体积经验系数，本函数不再乘任何
 *  补缩效率或其它体积修正，避免重复应用。
 *
 *  尺寸取整与现有冒口一致：D 为整数 mm，H = round(k·D)（k = H/D 名义值）；
 *  若按该整数尺寸回算的几何体积仍小于 V1，则逐毫米上探 D，直到达到目标体积；
 *  最后再下探，保证 D 是满足 V1 的最小整数档。返回目标体积与尺寸回算体积两个口径。 */
export const INSULATED_VOLUME_RATIO = 0.4;
export function calcInsulatedRiser({ referenceVolume, hdRatio = 1.0 } = {}) {
  const V0 = num(Number(referenceVolume));
  if (V0 == null || V0 <= 0) return { ok: false, reason: 'no_volume' };
  const kRaw = num(Number(hdRatio));
  if (kRaw == null || kRaw <= 0) return { ok: false, reason: 'bad_hd' };
  const V1 = INSULATED_VOLUME_RATIO * V0;
  const hOf = (d) => Math.max(1, Math.round(kRaw * d));
  const volOf = (d, h) => (Math.PI * d * d * h) / 4;
  let D = Math.max(1, Math.ceil(Math.cbrt((4 * V1) / (Math.PI * kRaw)) - 1e-9));
  let H = hOf(D);
  let Vactual = volOf(D, H);
  for (let i = 0; i < 64 && Vactual < V1 - 1e-6; i++) {
    D += 1; H = hOf(D); Vactual = volOf(D, H);
  }
  for (let i = 0; i < 64 && D > 1; i++) {
    const dPrev = D - 1, hPrev = hOf(dPrev), vPrev = volOf(dPrev, hPrev);
    if (vPrev >= V1 - 1e-6) { D = dPrev; H = hPrev; Vactual = vPrev; }
    else break;
  }
  const MrGeom = (D * H) / (2 * D + 4 * H);
  return {
    ok: true, V0, V1, Vnew: V1, hd: kRaw,
    D, H, Vactual,
    MrGeom, Mr_act: MrGeom,
    volumeOk: Vactual >= V1 - 1e-6,
    volumeDelta: Vactual - V1,
  };
}

/** 把普通圆柱结果转换为“发热/保温”主结果（两个入口共用）。
 *  只替换选中的设计参数与由其可靠派生的事实；普通圆柱的模数目标/补缩效率判定
 *  不再冒充新方案的结果。核心 runRiser 的输出对象不被修改。 */
export function applyInsulatedRiserResult(result, { hdRatio } = {}) {
  if (!result || result.blocked) return result;
  const convert = (it) => {
    if (!it) return it;
    /* 高径比三态：有效正数 → 用当前值；否则回退到核心结果已采用的名义值；
       再缺失才用现有合法默认 1.0（与 calcManifest 的回退口径一致）。 */
    const hRaw = num(Number(hdRatio));
    const itHd = num(Number(it.hd));
    const k = (hRaw != null && hRaw > 0) ? hRaw
      : (itHd != null && itHd > 0 ? itHd : 1.0);
    const c = calcInsulatedRiser({ referenceVolume: it.Vr, hdRatio: k });
    if (!c.ok) {
      return {
        ...it, designType: 'insulated', insulated: true, insulatedError: c.reason,
        D: null, H: null, Vr: null, eff: null, effV: null,
        Mr_target: null, Mr_need: null, Mr_act: null, targetRatio: null,
        modOk: null, volOk: null, converged: true, bind: 'insulated',
        d_neck: null, M_neck: null, dModOnly: null, dimLabel: '直径 D',
      };
    }
    const rho = it.rhoUsed || it.md?.rho || 0;
    const weightKg = rho > 0 ? c.Vactual / 1e6 * rho : null;
    return {
      ...it,
      designType: 'insulated', insulated: true,
      baseShapeKey: it.shapeKey || 'cyl',
      baseD: it.D, baseH: it.H, baseVr: it.Vr, baseHd: it.hd,
      V0: c.V0, V1: c.V1, Vactual: c.Vactual, volumeRatio: INSULATED_VOLUME_RATIO,
      volumeDelta: c.volumeDelta, volumeOk: c.volumeOk,
      D: c.D, H: c.H, Vr: c.Vactual,
      hd: c.hd, hdActual: c.D > 0 ? c.H / c.D : null,
      Mr_act: c.MrGeom, Mr_target: null, Mr_need: null, targetRatio: null,
      modOk: null, volOk: null, converged: true, bind: 'insulated',
      eff: null, effV: null, needVol: null,
      d_neck: null, M_neck: null, dModOnly: null,
      weightKg,
      yieldPct: it.cw > 0 && c.Vactual > 0 ? it.Vc / (it.Vc + c.Vactual) * 100 : null,
      dimLabel: '直径 D',
      shapeKey: 'cyl',
    };
  };
  const converted = convert(result);
  const items = Array.isArray(result.items) && result.items.length
    ? result.items.map(convert) : null;
  const out = {
    ...result, ...converted,
    designType: 'insulated', insulated: true,
    level: 'WARNING_REVIEW',
  };
  if (items) out.items = items;
  return out;
}

export const insulatedFormulaNote = () => tr('发热/保温冒口：以普通圆柱冒口的几何体积 V0 为基准，目标体积 V1 = 0.4 × V0；沿用当前 H/D（k），按 D = ∛(4V1/(πk))、H = kD 反算，再按整数尺寸回算体积。40% 为本产品经验系数，不是普遍工程标准。');
export const insulatedLimitNote = () => tr('该模式不使用普通冒口的目标模数判定，也不套用补缩效率表；显示的是经验估算几何与几何模数参考，实际补缩效果需通过工艺验证。');
export const insulatedNoEfficiencyNote = () => tr('本结果未重复应用补缩效率或其它体积修正：V1 直接由 V0（普通圆柱几何体积）乘 0.4 得到。');

/** 补缩距离经验参考：s 必须是有效主体壁厚（mm） */
export function calcFeedingReference({ wallThickness } = {}) {
  const s = num(Number(wallThickness));
  if (s == null || s <= 0) return { ok: false, reason: 'no_wall' };
  return { ok: true, s, plate: 2 * s, bar: 1.2 * s };
}

export const referenceNote = () => tr('以上为经验参数，仅供工艺设计参考。实际尺寸与补缩效果仍需通过铸造模拟和生产实践验证，并结合实际结果持续优化。');
export const riserTopNote = () => tr('冒口顶部应保持开放并可靠通气，避免封顶。可设置压力锥（又称威廉锥），形成顶部热节；锥体高度参考取冒口总高的 1/4 及以上。具体结构应结合冒口形式与工艺条件确定，并通过铸造模拟或生产实践验证。');

function neckResultHtml(res) {
  if (!res.ok) {
    if (res.reason === 'no_modulus') return `<div class="dc-ref-main dc-ref-bad">${tr('无法计算：缺少冒口有效模数')}</div>`;
    if (res.reason === 'bad_side') return `<div class="dc-ref-main dc-ref-bad">${tr('输入不适用：边长必须为正数')}</div>`;
    if (res.reason === 'side_too_small') return `<div class="dc-ref-main dc-ref-bad">${tr('输入不适用：a 必须大于 2M_N,max = {v} mm', [fmt2(2 * res.MnMax)])}</div>`;
    return `<div class="dc-ref-main dc-ref-bad">${tr('输入不适用：无法按当前条件计算')}</div>`;
  }
  const unit = res.shape === 'circle' ? '⌀' : '';
  const label = res.shape === 'circle' ? tr('圆形直径') : res.shape === 'square' ? tr('正方形边长') : tr('b');
  const theoryTxt = res.shape === 'rect'
    ? `${tr('a')} ${fmt2(res.sideA)} mm · ${tr('b 参考范围')} ${fmt2(res.theoreticalMin)} ~ ${fmt2(res.theoreticalMax)} mm`
    : `${label} ${tr('参考范围')} ${unit}${fmt2(res.theoreticalMin)} ~ ${fmt2(res.theoreticalMax)} mm`;
  const recTxt = res.shape === 'rect'
    ? `${tr('建议取整 b')} ${res.recommendedMin} ~ ${res.recommendedMax} mm`
    : `${tr('建议取整范围')} ${unit}${res.recommendedMin} ~ ${res.recommendedMax} mm`;
  const rangeState = res.verified
    ? tr('上下限均在参考范围内')
    : res.exceedsUpper ? tr('上限取整后超出 M_N,max') : tr('下限取整后低于 M_N,min');
  const warnTxt = res.exceedsUpper
    ? `<div class="dc-ref-current" style="color:#b45309">${tr('上限建议尺寸向上取整后 M_N = {a} mm > M_N,max = {b} mm；该尺寸不在参考范围内，需按上限复核。', [fmt2(res.actualMax), fmt2(res.MnMax)])}</div>`
    : (res.belowLower
      ? `<div class="dc-ref-current" style="color:#b45309">${tr('下限建议尺寸回算后 M_N = {a} mm < M_N,min = {b} mm；请复核取整输入。', [fmt2(res.actualMin), fmt2(res.MnMin)])}</div>`
      : '');
  return `<div class="dc-ref-main">
    <div>${tr('颈模数参考范围 M_N')}：${fmt2(res.MnMin)} ~ ${fmt2(res.MnMax)} mm</div>
    <div>${theoryTxt}</div>
    <div><b>${recTxt}</b> <span class="chip">${rangeState}</span></div>
    <div>${tr('回算实际 M_N')}：${tr('下限尺寸')} <b>${fmt2(res.actualMin)}</b> mm · ${tr('上限尺寸')} <b>${fmt2(res.actualMax)}</b> mm</div>
    ${warnTxt}
  </div>`;
}

/** 两卡 HTML：冒口颈 + 补缩距离（底部统一提醒由调用方加一次） */
export function renderRiserReferenceCards({ modulus, wallThickness } = {}) {
  const feed = calcFeedingReference({ wallThickness });
  const mf = num(Number(modulus));
  return `<div class="dc-ref-grid" data-ref-grid>
    <div class="dc-ref-card" data-ref-card data-modulus="${mf != null && mf > 0 ? mf : ''}">
      <div class="dc-ref-title">${tr('冒口颈尺寸参考')} <span class="chip">${tr('DISA 模数法')}</span></div>
      <div class="dc-ref-current">${tr('当前冒口模数 M_F')}：<b>${mf != null && mf > 0 ? fmt2(mf) : '—'}</b> mm</div>
      <div class="dc-ref-controls">
        <select class="field-select" data-ref-shape aria-label="${tr('参考形状')}">
          <option value="circle">${tr('圆形')}</option>
          <option value="square">${tr('正方形')}</option>
          <option value="rect">${tr('长方形')}</option>
        </select>
        <input class="field-input" data-ref-side type="number" min="0" step="any" value="100" style="width:110px" hidden aria-label="${tr('长方形一侧尺寸 a')}">
        <span class="f-unit" data-ref-side-unit hidden>mm</span>
      </div>
      <div class="dc-ref-current" data-rect-note hidden>${tr('长方形：输入已知边长 a（mm），计算另一边长 b 的参考范围。')}</div>
      <div data-ref-neck-result>${neckResultHtml(calcNeckReference({ modulus: mf }))}</div>
    </div>
    <div class="dc-ref-card" data-ref-feed>
      <div class="dc-ref-title">${tr('补缩距离经验参考')} <span class="chip">${tr('经验参考')}</span></div>
      ${feed.ok ? `<div class="dc-ref-current">${tr('主体壁厚 s')}：<b>${fmt2(feed.s)}</b> mm ${tr('（STL 主体壁厚）')}</div>
        <div class="dc-ref-stats">
          <div class="dc-ref-stat"><div>${tr('板状参考 2s')}</div><b>${fmt2(feed.plate)}</b><span> mm</span></div>
          <div class="dc-ref-stat"><div>${tr('杆状参考 1.2s')}</div><b>${fmt2(feed.bar)}</b><span> mm</span></div>
        </div>` : `<div class="dc-ref-main dc-ref-bad">${tr('无法计算：未获得有效主体壁厚')}</div>`}
    </div>
  </div>`;
}

/** 绑定一张或多张参考卡（每次 DOM 重建后调用；无副作用，不改项目） */
export function bindRiserReference(root) {
  if (!root) return;
  root.querySelectorAll('[data-ref-card]').forEach(card => {
    const shape = card.querySelector('[data-ref-shape]');
    const side = card.querySelector('[data-ref-side]');
    const sideUnit = card.querySelector('[data-ref-side-unit]');
    const rectNote = card.querySelector('[data-rect-note]');
    const out = card.querySelector('[data-ref-neck-result]');
    if (!shape || !out) return;
    const update = () => {
      const isRect = shape.value === 'rect';
      if (side) side.hidden = !isRect;
      if (sideUnit) sideUnit.hidden = !isRect;
      if (rectNote) rectNote.hidden = !isRect;
      const res = calcNeckReference({
        modulus: Number(card.dataset.modulus),
        shape: shape.value,
        sideA: side ? Number(side.value) : undefined,
      });
      out.innerHTML = neckResultHtml(res);
    };
    shape.addEventListener('change', update);
    side?.addEventListener('input', update);
    update();
  });
}
