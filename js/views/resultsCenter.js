// ============================================================
// 工艺分析结果中心（命令3 第15节 / 19.txt 八 / PHASE 71.5 §2 / PHASE 71.7 · 77.txt 五）
// 结构（产品级三页）：结果导航 + 当前页结果 + 操作区
//   Page1 ① 铸件结构工艺性 —— 铸造工艺性卡片（castability.js 复用）+ 线收缩率/加工余量小卡片
//   Page2 ② 冒口设计       —— riserSection（runRiser 输出；多热结逐块展示）
//   Page3 ③ 经典浇注系统   —— gatingSection（尺寸与总截面积 → 校核 → 详细折叠）
//   出品率与铁水重量页按 77.txt 从设计中心剔除（计算仍执行，供报告/熔炼加料使用）
//   其余可选模块（chill/sandbox/charge/shakeout）若被外部注入结果则殿后
// 数据来自 designCenter 执行结果（calcs/ 纯函数输出）；本文件无任何公式，只做编排/展示
// ============================================================
import * as proj from '../model/CastingProject.js';
import { CALC_MANIFEST, ingateRec, runnerRec, VENT_D_DEFAULT } from '../../calcs/calcManifest.js';
import { RISER_SHAPES } from '../../calcs/riser.js';
import { saveFile } from '../download.js';
import { buildWorkflowReport } from './reportGenerator.js';
import { buildPage1Data, page1Html } from './processPage1.js';
import { t as tr } from '../i18n/index.js';

const fmt = (v, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? parseFloat(v.toFixed(d)).toString() : '—');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const t = (label, val, ok = null) => `<tr><td>${label}</td><td>${val}${ok === null ? '' : ok ? ' ✅' : ' ⚠️'}</td></tr>`;
const stat = (k, v) => `<div class="dc-stat"><div>${k}</div><div class="dc-stat-v">${v}</div></div>`;
const dt = (label, val) => `<tr><td>${label}</td><td>${val}</td></tr>`;

const HS_REASON_TEXT = {
  no_candidate: '无候选区域', uniform: '模型壁厚均匀，无相对厚区',
  all_low_confidence: '候选置信度不足', invalid_mesh: '网格无效',
  no_inside_points: '模型过薄，无法可靠分析', refine_limit: '局部细化超限，置信度不足',
};

/* ================= Page2 冒口设计（保持冻结样式 + Mc 来源 + 多热结说明） ================= */
const LEVEL_TEXT = {
  SAFE_TO_RECOMMEND: ['✅', '可直接采用'],
  WARNING_REVIEW: ['🟡', '需人工复核'],
  BLOCK_AUTO_RECOMMEND: ['⛔', '自动建议已阻止'],
};
/** Mc 来源说明（PHASE 71.6 76.txt 三/十二：结果页必须明确 Mc 输入/来源与"来自现有冒口计算器"）
 *  PHASE 72：显示层双语（来源判定逻辑不变） */
function mcSourceLine(r, ctx) {
  const hsN = ctx.hotspotN || 0;
  const hsOk = ctx.hsStatus === 'ok' && hsN > 0;
  if (ctx.mcUser) return tr('来源：<b>用户输入</b> Mc = {m} mm（未使用 STL 自动热结点）', [fmt(r.Mc, 1)]);
  if (hsOk) return tr('来源：STL 热结检测 Mc = <b>{m} mm</b>{tail}', { m: fmt(r.Mc, 1), tail: hsN > 1 ? tr('（最大热结 H1；共 {n} 个热结）', [hsN]) : tr('（热结 H1）') });
  return tr('来源：<b>壁厚/结构参考值</b> Mc = {m} mm（未检测到可靠热点，初步估算）', [fmt(r.Mc, 1)]);
}
/** 单个冒口结果块（PHASE 71.7：多热结时逐块展示，字段全部来自 runRiser 输出） */
function riserBlock(it, ctx = {}, showHead = false) {
  const row = (label, val, ok) =>
    `<tr><td>${label}</td><td>${val}${ok === null || ok === undefined ? '' : ok ? ' ✅' : ' ⚠️'}</td></tr>`;
  // PHASE 79（79.txt 三）：形状＝正方柱时不能再用"⌀直径"——按形状给尺寸称谓（长×宽 = 边长 a）
  const isSquare = it.shapeKey === 'square';
  const isSphere = it.shapeKey === 'sphere';
  const sizeCells = isSquare
    ? stat(tr('冒口边长 a（长 × 宽）'), `${fmt(it.D, 0)} × ${fmt(it.D, 0)} mm`) + stat(tr('冒口高度 H'), fmt(it.H, 0) + ' mm')
    : isSphere
      ? stat(tr('冒口球径'), '⌀' + fmt(it.D, 0) + ' mm') + stat(tr('冒口高度 H'), fmt(it.H, 0) + ' mm')
      : stat(tr('冒口直径 D'), '⌀' + fmt(it.D, 0) + ' mm') + stat(tr('冒口高度 H'), fmt(it.H, 0) + ' mm');
  const head = showHead
    ? `<div class="dc-p1-parthead" style="margin-top:6px">${tr('热结 H{n} 的冒口', [it.hsId ?? '1'])}
        ${it.hsMc != null ? `<span class="chip">${tr('检出 Mc')} ${fmt(it.hsMc, 1)} mm</span>` : ''}
        ${it.hsMc != null && Math.abs(it.hsMc - it.Mc) > 1e-9 ? `<span class="chip dc-chip-warn">${tr('用户改为 {m} mm', [fmt(it.Mc, 1)])}</span>` : ''}</div>`
    : '';
  return `${head}
    <div class="dc-stats">
      ${sizeCells}
      ${stat(tr('补缩效率'), fmt(it.eff * 100, 0) + '%')}
      ${stat(tr('所需模数 Mr_need'), fmt(it.Mr_need, 2) + ' mm')}
    </div>
    <table class="dc-table">
      ${row(tr('实际冒口模数 Mr_act'), `${fmt(it.Mr_act, 2)} mm（${tr('需 ≥ 所需模数')}）`, it.modOk)}
      ${row(tr('冒口体积 Vr'), fmt(it.Vr / 1000, 1) + ' cm³' + (it.cw > 0 ? `（${tr('可补缩')} ${fmt(it.effV / 1000, 1)} cm³）` : ''), null)}
      ${it.cw > 0 ? row(tr('所需补缩金属量'), `${fmt(it.needVol / 1000, 2)} cm³（${tr('铸件净重')} ${fmt(it.cw, 2)} kg ÷ ${tr('固态密度')} ${fmt(it.rhoUsed, 2)}）`, null) : ''}
      ${row(tr('体积校核'), it.volOk ? tr('充足') : tr('不足——需加大冒口或加冷铁'), it.volOk)}
      ${row(tr('冒口颈'), '⌀' + fmt(it.d_neck, 0) + ' mm（' + tr('颈模数') + ' ' + fmt(it.M_neck, 2) + ' mm × ' + tr('系数') + ' ' + fmt(it.neck_k, 2) + '）', null)}
      ${row(tr('迭代倍率 f'), fmt(it.final_f, 2) + ' × Mc（' + tr('自动迭代至模数/体积双通过') + '）', null)}
    </table>`;
}
/** 冒口形状选择（PHASE 78 · 78.txt 三）：4 种冒口（riser.RISER_SHAPES），默认圆柱形；改动即重算 */
function riserShapeSel(r) {
  const cur = r.shapeKey || proj.getV('process.riserShape') || 'cyl';
  const sd = RISER_SHAPES[cur] || RISER_SHAPES.cyl;
  return `<div class="dc-shape-row">
    <span class="dc-shape-label">${tr('冒口形状')}</span>
    <select class="dc-inline-sel" id="dc_riserShape">
      ${Object.entries(RISER_SHAPES).map(([k, s]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(tr(s.name))}</option>`).join('')}
    </select>
    <span class="field-hint" style="margin:0">${esc(tr(sd.formula))}</span>
  </div>`;
}

function riserSection(r, ctx = {}) {
  if (r.blocked) {
    return `<div class="dc-result-sec">
      <div class="dc-sec-title">② ${tr('冒口设计')}</div>
      <div class="dc-blocked">⛔ ${esc(r.note || tr('自动冒口建议不可用'))}</div>
      <div class="field-hint">${tr('可在「参数与执行条件 → 冒口参数」手动填写「热节模数 Mc」后重新执行；或检查模型后重新导入 STL。')}</div>
    </div>`;
  }
  const items = (r.items && r.items.length) ? r.items : [r];
  const lv = LEVEL_TEXT[r.level] || ['🟡', '需人工复核'];
  const multi = items.length > 1;
  // PHASE 78（78.txt 五）：多热结「分页」——点「热结 1 / 热结 2」切换各自冒口信息，避免纵向堆叠
  const body = multi
    ? `<div class="dc-hs-tabs" id="dc_hsTabs">
        ${items.map((it, i) => `<button class="dc-hs-tab ${i === 0 ? 'on' : ''}" data-hs-tab="${i}">🔥 ${tr('热结')} H${it.hsId ?? i + 1}
          <span class="dc-hs-tab-mc">Mc ${fmt(it.Mc, 1)}</span></button>`).join('')}
      </div>
      ${items.map((it, i) => `<div class="dc-hs-pane" data-hs-pane="${i}" ${i === 0 ? '' : 'hidden'}>
        <div class="dc-hint-line">${it.hsMc != null && Math.abs(it.hsMc - it.Mc) > 1e-9
          ? tr('来源：<b>用户输入</b> Mc = {m} mm（该热结检出 {d} mm）', [fmt(it.Mc, 1), fmt(it.hsMc, 1)])
          : tr('来源：STL 热结检测 Mc = <b>{m} mm</b>（热结 H{n}）', [fmt(it.Mc, 1), it.hsId ?? i + 1])}</div>
        ${riserBlock(it, ctx, false)}
      </div>`).join('')}`
    : `<div class="dc-hint-line">${mcSourceLine(r, ctx)}</div>${riserBlock(r, ctx, false)}`;
  return `<div class="dc-result-sec">
    <div class="dc-sec-title">② ${tr('冒口设计')} <span class="chip">${lv[0]} ${tr(lv[1])}</span>
      ${multi ? `<span class="chip">${tr('{n} 个热结 · 分别设计', [items.length])}</span>` : ''}</div>
    ${riserShapeSel(r)}
    ${body}
    <div class="field-hint">${tr('res.riser.campbell')}</div>
    ${multi ? `<div class="field-hint">${tr('res.riser.multiNote')}</div>` : ''}
    ${r.note ? `<div class="field-hint p72-cn">ℹ️ ${esc(r.note)}</div>` : ''}
    <div class="dc-src-line">${tr('冒口结果来自现有冒口计算器（riser calculator），数值未经本页修改。')}</div>
  </div>`;
}

/* ================= Page3 经典浇注系统（75.txt §12：推荐方案→关键尺寸→示意图→关键计算→详细折叠） ================= */

/**
 * PHASE 78（78.txt 七）：内浇道输入框——把「内浇道厚度 / 个数」两个参数从参数区搬到结果页，
 * 直接显示为可改的框：改厚度/个数 → 内浇道长度 L_g 随之重算（runGating 内按阻流面积反算，公式零改动）。
 * 显示的是**当前生效值**（未设定时 = 推荐值），改动即写入项目（USER_INPUT）→ 触发重算。
 */
function ingateBox(g) {
  const wall = proj.getV('process.wallUsed') || proj.getV('geometry.wallAvg') || 0;
  const rec = ingateRec(wall);
  const gt = g.gt > 0 ? g.gt : rec.gt;
  const gc = g.gc > 0 ? g.gc : rec.gc;
  const isRound = g.gateShape === '圆形';
  const userSet = (proj.getV('process.gateThk') || 0) > 0 || (proj.getV('production.ingateN') || 0) > 0;
  return `<div class="dc-edit-box">
    <div class="dc-edit-head">${tr('内浇道')} <span class="chip">${tr('改厚度/个数 → 长度自动重算')}</span></div>
    <div class="dc-edit-row">
      <label class="dc-edit-fld">${tr('厚度')}
        <input class="dc-edit-inp" type="number" id="dc_gtEdit" step="any" min="0.1" value="${esc(gt)}"><span class="dc-edit-unit">mm</span>
      </label>
      <label class="dc-edit-fld">${tr('个数')}
        <input class="dc-edit-inp" type="number" id="dc_gcEdit" step="1" min="1" value="${esc(gc)}"><span class="dc-edit-unit">${tr('个')}</span>
      </label>
      <span class="dc-edit-res">→ ${isRound ? `⌀${fmt(g.D_g, 0)} mm` : `${tr('单条长')} <b>${fmt(g.L_g, 0)}</b> mm`} · ${tr('总截面')} <b>${fmt(g.Fg, 0)}</b> mm²</span>
    </div>
    <div class="dc-edit-hint">${tr('推荐：厚')} <b>${rec.gt} mm</b>（${tr('主体壁厚')} ${fmt(wall, 1)} mm ÷ 3）· ${tr('个数')} <b>2~3 ${tr('个')}</b>
      ${userSet ? ` <button class="dc-mini-btn" id="dc_gtReset">↺ ${tr('用推荐值')}</button>` : ''}
      ｜ ${isRound ? tr('当前为圆形内浇道（由独立计算器设定）') : tr('内浇道长度按阻流面积反算，取 5 mm 档')}</div>
  </div>`;
}

/**
 * PHASE 80（79.txt 追问）：横浇道框——与内浇道同级（厚度 / 条数可改）。
 * 横浇道长度由 S:R:G 比例给出的参考面积反算（runGating 内 ceil 到 5mm 档，公式零改动）：
 * 改条数/厚度 → 长度自动重算。默认值 = 工具既有默认（2 条 × 厚 25 mm），可一键恢复。
 */
function runnerBox(g) {
  const rec = runnerRec();
  const rt = g.rt > 0 ? g.rt : rec.rt;
  const rc = g.rc > 0 ? g.rc : rec.rc;
  const userSet = (proj.getV('process.runnerThk') || 0) > 0 || (proj.getV('production.runnerN') || 0) > 0;
  const need = g.A_run > 0 ? fmt(g.A_run, 0) + ' mm²' : '—';
  return `<div class="dc-edit-box">
    <div class="dc-edit-head">${tr('横浇道')} <span class="chip">${tr('改厚度/条数 → 长度自动重算')}</span></div>
    <div class="dc-edit-row">
      <label class="dc-edit-fld">${tr('厚度')}
        <input class="dc-edit-inp" type="number" id="dc_rtEdit" step="any" min="0.1" value="${esc(rt)}"><span class="dc-edit-unit">mm</span>
      </label>
      <label class="dc-edit-fld">${tr('条数')}
        <input class="dc-edit-inp" type="number" id="dc_rcEdit" step="1" min="1" value="${esc(rc)}"><span class="dc-edit-unit">${tr('条')}</span>
      </label>
      <span class="dc-edit-res">→ ${tr('单条长')} <b>${fmt(g.L_r, 0)}</b> mm · ${tr('总截面')} <b>${fmt(g.Fr_act, 0)}</b> mm²</span>
    </div>
    <div class="dc-edit-hint">${tr('横浇道参考面积')} ${need}（${tr('由系统比例的 R 系数给出')}）÷（${tr('厚度')} × ${tr('条数')}）→ ${tr('长度取 5 mm 档')}；
      ${tr('默认')} <b>${rec.rc} ${tr('条')} × ${tr('厚')} ${rec.rt} mm</b>（${tr('工具既有默认')}）
      ${userSet ? ` <button class="dc-mini-btn" id="dc_rtReset">↺ ${tr('用默认值')}</button>` : ''}
      ｜ ${tr('改条数/厚度会同步改变实际面积比 S:R:G 与阻流位置判定')}</div>
  </div>`;
}

/**
 * PHASE 79（79.txt 四）定稿口径：排气 = **用户定直径、系统算孔数**。
 *   直径可输入（默认 ⌀3，可改 ⌀2/⌀1 …）；孔数为只读结果 = ⌈目标排气面积 ÷ 单孔面积⌉，
 *   目标面积 = 企业标准下限 1.5 × 直浇道实际面积 → 比值恒 ≥1.5，不再出现"排气不足"红字。
 */
function ventBox(g) {
  const d = g.ventD || proj.getV('process.ventD') || VENT_D_DEFAULT;
  const n = g.ventN || 0;
  const hole = Math.PI * d * d / 4;
  const tooMany = n > 40;   // 与 gating 内部规则同口径：孔数过多宜增大直径
  return `<div class="dc-edit-box">
    <div class="dc-edit-head">${tr('排气')} <span class="chip">${tr('直径可改 · 孔数由总排气面积自动生成')}</span></div>
    <div class="dc-edit-row">
      <label class="dc-edit-fld">${tr('排气孔直径')}
        <input class="dc-edit-inp" type="number" id="dc_ventD" step="any" min="0.5" value="${esc(d)}"><span class="dc-edit-unit">mm</span>
      </label>
      <span class="dc-edit-res">→ <b>${n}</b> ${tr('个')} ⌀${fmt(d, 2)} mm ${tr('圆孔')} · ${tr('总排气面积')} <b>${fmt(g.vt, 1)}</b> mm² · ${tr('比值')} <b>${fmt(g.vr, 2)}</b> ${tr('倍')} ${g.vr_ok ? '✅' : '⚠️'}</span>
    </div>
    <div class="dc-edit-hint">${tr('孔数 = 目标排气面积 {a} mm²（企业标准 1.5 × 直浇道 {b} mm²）÷ 单孔面积 {c} mm² 向上取整。', [fmt(g.ventNeed, 0), fmt(g.Fs_act, 0), fmt(hole, 2)])}
      ${tooMany ? tr('res.vent.tooMany') : ''}</div>
  </div>`;
}

function gatingSection(g) {
  const shapeTxt = g.gateShape === '圆形'
    ? `${g.gc} ${tr('个')} × ⌀${fmt(g.D_g, 0)} mm`
    : `${g.gc} ${tr('个')} × ${tr('厚')} ${g.gt} mm × ${tr('长')} ${fmt(g.L_g, 0)} mm`;
  const sugs = g.sugs || [];
  const detailRows = [
    [tr('铸件质量 W_c = 单件 × 型腔数'), `${fmt(g.castingMass, 2)} kg（${g.pw} kg × ${g.cav} ${tr('件')}；${tr('仅 P47 浇注时间公式用')}）`],
    [tr('浇注重量 G（÷ 出品率）'), `${fmt(g.G, 2)} kg（${tr('出品率')} ${fmt(g.yv, 1)}%）`],
    [tr('铸件高度 ph / 冒口高 rh'), `${fmt(g.ph, 1)} / ${fmt(g.rh, 1)} mm`],
    ['C = ph + rh', `${fmt(g.Cmm, 1)} mm`],
    [tr('浇口盆高度 Hb（查表）'), `${fmt(g.Hb, 0)} mm`],
    [tr('P 值（依浇注方向）'), `${fmt(g.Pv, 1)} mm`],
    [tr('平均静压头 Hp'), `${fmt(g.Hp, 1)} mm（${esc(tr(g.pos))}，Ho=${fmt(g.Ho, 0)}）`],
    [`${tr('流速系数 fv')}（${g.filterUsed ? tr('已用过滤网 −0.1') : tr('未用过滤网')}）`, fmt(g.fv, 2)],
    [tr('浇注时间 t（PHASE 47 公式）'), fmt(g.t, 2) + ' s'],
    [tr('阻流截面 A（奥赞）'), fmt(g.A, 0) + ' mm²'],
    [tr('直浇道 S'), '⌀' + fmt(g.D_sp, 0) + ' mm → ' + fmt(g.Fs_act, 0) + ' mm²'],
    [tr('横浇道 R'), `${g.rc} ${tr('条')} × ${tr('厚')} ${g.rt} mm × ${tr('长')} ${fmt(g.L_r, 0)} mm → ${fmt(g.Fr_act, 0)} mm²`],
    [tr('内浇口 G'), shapeTxt + ` → ${fmt(g.Fg, 0)} mm²`],
    [tr('实际面积比 S:R:G'), `${fmt(g.s_r, 2)} : ${fmt(g.r_r, 2)} : ${fmt(g.g_r, 2)}（${tr('实')} ${fmt(g.rrv, 2)} : ${fmt(g.rgv, 2)}）`],
    [tr('实际阻流截面（P51 判定）'), `${esc(tr(g.chokePosition === 'boundary' ? '临界并列（≤1%）' : g.chokePosition === 'unset' ? '系统不完整（缺内浇口/横浇道输入）' : g.chokePosition))} · ${fmt(g.chokeArea, 0)} mm²`],
    [tr('理论特征流速 fv√(2gHp)'), fmt(g.vTheory, 2) + ' m/s（' + tr('内部诊断值') + '）'],
    [tr('目标内浇口速度推荐'), g.vTarget ? fmt(g.vTarget, 2) + ' m/s' : tr('铸钢/铜：本工具不设目标速度')],
    [tr('液面上升速度 vL（参考）'), fmt(g.vL, 2) + ' mm/s'],
    [tr('排气面积比'), `${fmt(g.vr, 2)} ${tr('倍')}（${tr('实际')} ${fmt(g.vt, 0)} mm² / ${tr('直浇道')} ${fmt(g.Fs_act, 0)} mm²；${tr('企业标准 1.5~4 倍')}）`],
    [tr('实际出品率'), fmt(g.ya, 1) + '%'],
  ].map(([a, b]) => dt(a, b)).join('');
  return `<div class="dc-result-sec">
    <div class="dc-sec-title">③ ${tr('经典浇注系统设计')} <span class="chip">${esc(tr(g.ratioKey) || '—')}</span>
      <span class="chip">${esc(tr(g.systemType) || '—')}</span></div>
    <div class="dc-stats">
      ${stat(tr('浇注重量 G'), fmt(g.G, 1) + ' kg')}
      ${stat(tr('浇注时间 t'), fmt(g.t, 1) + ' s')}
      ${stat(tr('阻流截面 A'), fmt(g.A, 0) + ' mm²')}
      ${stat(tr('内浇口流速'), fmt(g.vFinal, 2) + ' m/s')}
    </div>

    <div class="dc-p1-parthead" style="margin-top:10px">${tr('浇道尺寸与总截面积')} <span class="chip">${tr('面积 = 实际设计截面（校核口径）')}</span></div>
    <table class="dc-table">
      ${t(tr('系统特征'), esc(tr(g.systemType) || '—') + `（${esc(tr(g.ratioKey)) || '—'}）`)}
      ${t(tr('直浇道 S'), `⌀${fmt(g.D_sp, 0)} mm → ${tr('总截面')} ${fmt(g.Fs_act, 0)} mm²`)}
      ${t(tr('横浇道 R'), `${g.rc} ${tr('条')} × ${tr('厚')} ${g.rt} mm × ${tr('长')} ${fmt(g.L_r, 0)} mm → ${tr('总截面')} ${fmt(g.Fr_act, 0)} mm²`)}
      ${t(tr('实际面积比 S:R:G'), `${fmt(g.s_r, 2)} : ${fmt(g.r_r, 2)} : ${fmt(g.g_r, 2)}（${tr('实')} ${fmt(g.rrv, 2)} : ${fmt(g.rgv, 2)}）`)}
      ${t(tr('阻流位置'), esc(tr(g.chokePosition === 'boundary' ? '临界并列（≤1%）' : g.chokePosition === 'unset' ? '系统不完整（缺内浇道/横浇道输入）' : g.chokePosition)))}
      ${t(tr('液面上升速度 vL'), fmt(g.vL, 2) + ' mm/s（' + tr('参考') + '）')}
    </table>

    ${ingateBox(g)}
    ${runnerBox(g)}
    ${ventBox(g)}

    <div class="dc-p1-parthead" style="margin-top:10px">${tr('校核')} <span class="chip">${tr('企业口径 R7')}</span></div>
    <table class="dc-table">
      ${t(tr('内浇口流速'), fmt(g.vFinal, 2) + ` m/s（${g.rd?.type ? tr(g.rd.type) + tr('式') : ''} R7 ≤${g.vLimit ?? '—'}）`, g.vState !== 'high')}
      ${t(tr('排气面积比'), fmt(g.vr, 2) + ' ' + tr('倍（企业标准 1.5~4）'), g.vr_ok)}
      ${g.vTarget ? t(tr('目标内浇口速度'), fmt(g.vTarget, 2) + ' m/s'
        + `（${tr('当前')} ${fmt(g.vFinal, 2)}：${g.vState === 'high' ? tr('偏高，建议按目标速度优化') : g.vState === 'low' ? tr('偏低，可保留（不缩小面积）') : tr('在目标区间')}）`,
        g.vState !== 'high') : ''}
    </table>
    ${/* 建议条目由计算器内部按数值插值生成（中文模板）——本阶段保持原样，不逐条翻译 */ ''}
    ${sugs.slice(0, 4).map(s => `<div class="dc-p1-bline ${s.startsWith('✅') ? 'ok' : s.startsWith('ℹ️') ? '' : 'warn'}">${esc(s)}</div>`).join('')}
    ${g.boundaryNote ? `<div class="dc-p1-bline warn p72-cn">${esc(g.boundaryNote)}</div>` : ''}

    <details class="dc-advanced" style="margin-top:8px">
      <summary>📐 ${tr('详细计算过程')} <span class="chip">${tr('奥赞公式 · 企业口径 · 全部保留')}</span></summary>
      <table class="dc-table" style="margin-top:8px">${detailRows}</table>
    </details>
    <div class="dc-src-line">${tr('浇注系统结果来自现有浇注系统计算器（gating calculator）；浇注方向示意图见「参数与执行条件 → ② 浇注参数」。')}</div>
  </div>`;
}

function yieldSection(y, hasRiser) {
  const line = proj.getV('production.line');
  return `<div class="dc-result-sec">
    <div class="dc-sec-title">④ ${tr('出品率与铁水重量')}</div>
    <div class="dc-hint-line">${tr('参考区间依据：')}${esc(y.basis || '—')}${line && line !== '不指定' ? ` · ${tr('造型线')}：${esc(tr(line))}（${tr('参数与执行条件 → ② 基础工艺参数可改')}）` : ` · ${tr('造型线未指定（② 基础工艺参数可指定后重算）')}`}</div>
    <div class="dc-stats">
      ${stat(tr('铸件重量'), fmt(y.castWt, 2) + ' kg')}
      ${stat(tr('浇注重量'), fmt(y.pourWt, 2) + ' kg')}
      ${stat(tr('出品率'), fmt(y.castWt / y.pourWt * 100, 1) + '%')}
    </div>
    <table class="dc-table">
      ${t(tr('参考区间'), `${y.range[0]}~${y.range[1]}%（${tr('依据')}：${y.basis}）`)}
      ${t(tr('浇注系统重'), fmt(y.runnerWt, 2) + ' kg')}
      ${hasRiser ? t(tr('冒口重量'), fmt(y.riserWt, 2) + ' kg') : ''}
    </table>
  </div>`;
}

function shrinkSection(sh) {
  return `<div class="dc-result-sec">
    <div class="dc-sec-title">📏 ${tr('线收缩率')} <span class="chip">${esc(tr(sh.modeLabel) || tr('常用值（生产·模具）'))}</span></div>
    <div class="dc-stats">
      ${stat(tr('综合比例'), sh.combined != null ? fmt(sh.combined, 2) + '%' : tr('分方向放缩水'))}
      ${stat(tr('方向差'), fmt(sh.spread, 2) + '%')}
      ${stat(tr('参考区间'), esc(sh.range || '—'))}
    </div>
    <table class="dc-table">
      <tr><th>${tr('方向')} (mm)</th><th>${tr('收缩率')}</th><th>${tr('放尺量')} (mm)</th><th>${tr('样板尺寸')} (mm)</th></tr>
      ${(sh.dirs || []).map(d => `<tr><td>${fmt(d.size, 0)}</td><td>${fmt(d.rate, 2)}%</td><td>${fmt(d.amount, 2)}</td><td>${fmt(d.pattern, 1)}</td></tr>`).join('')}
    </table>
    ${sh.directional ? `<div class="field-hint">${tr('⚠️ 各方向收缩率差 ≥0.2%，建议分方向放缩水（不推荐统一综合比例）')}</div>` : ''}
  </div>`;
}

function otherSections(results) {
  const c = results?.chill, s = results?.sandbox, m = results?.machining, ch = results?.charge, sk = results?.shakeout;
  const sections = [];
  if (c) {
    if (c.blocked) {
      sections.push(`<div class="dc-result-sec">
        <div class="dc-sec-title">❄️ ${tr('冷铁计算')}</div>
        <div class="dc-blocked p72-cn">⛔ ${esc(c.note || tr('自动冷铁推荐不可用'))}</div>
        <div class="field-hint">${tr('可在自动参数区手动填写「热节壁厚 T_hot」后重新执行；或到独立「冷铁计算」工具输入。')}</div>
      </div>`);
    } else {
    sections.push(`<div class="dc-result-sec">
      <div class="dc-sec-title">❄️ ${tr('冷铁计算')}</div>
      <div class="dc-stats">
        ${stat(tr('冷铁厚度'), Array.isArray(c.thickness) ? c.thickness.map(v => fmt(v, 1)).join('~') + ' mm' : fmt(c.mid, 1) + ' mm')}
        ${stat(tr('推荐值'), fmt(c.mid, 1) + ' mm')}
        ${stat(tr('类型'), esc(tr(c.type)))}
      </div>
      ${(c.warnings || []).length ? `<table class="dc-table">${c.warnings.slice(0, 4).map(w => t(tr('注意'), esc(w.replace(/^[❌⚠️✅]+\s*/, '')))).join('')}</table>` : ''}
      <div class="field-hint">${tr('冷铁壁厚按热节壁厚（2×Mc）计算：')}${esc(c.deltaText || '')}</div>
    </div>`);
    }
  }
  if (s) {
    sections.push(`<div class="dc-result-sec">
      <div class="dc-sec-title">📦 ${tr('3D砂型吃砂量')}</div>
      <div class="dc-stats">
        ${stat(tr('砂型最小壁厚'), fmt(s.minWall, 0) + ' mm')}
        ${stat(tr('轮廓'), fmt(s.dim, 0) + ' mm')}
        ${stat(tr('铸件重'), fmt(s.wt, 1) + ' kg')}
      </div>
      ${s.warning ? `<div class="field-hint p72-cn">${esc(s.warning)}</div>` : ''}
      <div class="field-hint">${tr('砂型方式：')}${esc(tr(s.mode))}（${tr('3D 打印砂型专用，勿套用传统造型')}）</div>
    </div>`);
  }
  if (m) {
    if (m.unsupported) {
      sections.push(`<div class="dc-result-sec">
        <div class="dc-sec-title">🛠️ ${tr('加工余量')}（GB/T 6414）</div>
        <div class="dc-blocked p72-cn">ℹ️ ${esc(m.note || tr('该工艺×材质无标准 RMA 等级'))}</div>
      </div>`);
    } else {
    sections.push(`<div class="dc-result-sec">
      <div class="dc-sec-title">🛠️ ${tr('加工余量')}（GB/T 6414）</div>
      <div class="dc-stats">
        ${stat(tr('余量范围'), fmt(m.min, 1) + '~' + fmt(m.max, 1) + ' mm')}
        ${stat(tr('推荐值'), fmt(m.mid, 1) + ' mm')}
        ${stat(tr('等级'), (m.grades || []).join('~'))}
      </div>
      <div class="field-hint">${tr('按「{a}」推荐等级（等级自动，不选等级）', [esc(tr(m.methodLabel) || tr('砂型 · 机器造型/壳型'))])}</div>
    </div>`);
    }
  }
  if (ch) {
    if (ch.unsupported) {
      sections.push(`<div class="dc-result-sec">
        <div class="dc-sec-title">🏭 ${tr('熔炼加料')}（${esc(ch.defGrade)}）</div>
        <div class="field-hint p72-cn">${esc(ch.note || tr('暂不支持该牌号'))}</div>
      </div>`);
    } else {
      sections.push(`<div class="dc-result-sec">
        <div class="dc-sec-title">🏭 ${tr('熔炼加料')}（${esc(ch.defGrade)} · ${fmt(ch.pourWt, 1)} kg ${tr('铁液')}）</div>
        <div class="dc-stats">
          ${stat(tr('目标碳当量 CE'), ch.targetCE ? fmt(ch.targetCE, 2) + '%' : '—')}
          ${stat(tr('原铁液 CE'), ch.baseCE ? fmt(ch.baseCE, 2) + '%' : '—')}
          ${stat(tr('成分平衡'), ch.allOk ? tr('全部达标') : tr('有差额，见补料建议'), ch.allOk)}
        </div>
        <table class="dc-table">
          ${(ch.sugs || []).slice(0, 4).map(sg => t(tr('补料建议'), `${esc(sg.label)} +${sg.kg} kg`)).join('')}
        </table>
        <div class="field-hint">${tr('默认按 {g} 推荐配方；铁水总重 = 浇注重量（共享参数自动复用）', [esc(ch.defGrade)])}</div>
      </div>`);
    }
  }
  if (sk) {
    const [lo, hi] = sk.timeRange || [0, 0];
    sections.push(`<div class="dc-result-sec">
      <div class="dc-sec-title">⏱️ ${tr('开箱时间')}</div>
      <div class="dc-stats">
        ${stat(tr('型内冷却时间'), fmt(lo, 0) + (sk.unit === 'h' ? '~' + fmt(hi, 1) + ' h' : '~' + fmt(hi, 0) + ' min'))}
        ${stat(tr('开箱温度'), fmt(sk.shakeTemp, 0) + ' ℃')}
        ${stat(tr('依据'), esc(sk.shakeTempSource || '—'))}
      </div>
      ${(sk.warnings || []).length ? `<table class="dc-table">${sk.warnings.slice(0, 3).map(w => t(tr('风险'), esc(w.replace(/^[❌⚠️✅]+\s*/, '')))).join('')}</table>` : ''}
    </div>`);
  }
  return sections.join('');
}

/* ---- Page1 装配（板块 A/B，来自 processPage1 纯逻辑；ctx 提供内存态：V3 采样/主体壁厚） ---- */
function page1Section(results, ctx = {}) {
  const pack = {
    v: (p) => proj.getV(p), ps: (p) => proj.get(p),
    sampling: ctx.sampling || null,
    bodyRef: ctx.bodyRef ?? null,
    hasStl: !!ctx.hasStl,
    manual: !!ctx.manual,
    geomStatus: proj.getV('geometry.geomStatus') || 'VALID',
    results,   // PHASE 71.7：线收缩率 / 加工余量卡片数据（计算器既有输出）
  };
  // 热结明细已在右侧面板「② 热结列表」中（可点击定位 3D）——本页不再重复（77.txt：做减法）
  return page1Html(buildPage1Data(pack));
}

/** 当前模块结果 HTML */
function moduleHtml(id, results, ctx = {}) {
  const r = results?.[id];
  if (id === 'page1') return page1Section(results, ctx);
  if (!r) return '<div class="field-hint">该模块未执行。</div>';
  if (id === 'gating') return gatingSection(r);
  if (id === 'riser') return riserSection(r, ctx);
  if (id === 'yield') return yieldSection(r, !!results.riser);   // 设计中心不再展示（77.txt 五）；保留供报告/其他入口
  if (id === 'shrinkage') return shrinkSection(r);
  return otherSections({ [id]: r });
}

/** 结果导航顺序（PHASE 71.7 · 77.txt 五：三页——工艺性（含线收缩率/加工余量卡片）→ 冒口 → 浇注；
 *  出品率与铁水重量页按 77.txt 从设计中心结果中剔除（计算仍执行，供报告/熔炼加料使用）；
 *  其余模块（若被外部注入结果）殿后） */
const PAGE_ORDER = [
  { key: 'page1', name: '① 铸件结构工艺性', icon: '📄' },
  { key: 'riser', name: '② 冒口设计', icon: '🏗️' },
  { key: 'gating', name: '③ 经典浇注系统', icon: '🌊' },
];
const EXTRA_ORDER = ['chill', 'sandbox', 'charge', 'shakeout'];

/**
 * 渲染结果中心：结果导航 + 当前页 + 操作区（75.txt §2：①→④ 一条主链，其余模块殿后）
 * @param {HTMLElement} container
 * @param {object} results  已完成模块结果
 * @param {object} [opts]    { active: 当前页 key, onNav: 导航切换回调,
 *                             ctx: { sampling, bodyRef, hasStl, manual } }（Page1 内存态）
 */
export function renderResultsCenter(container, results, opts = {}) {
  const baseCtx = opts.ctx || {};
  // Page2 需要 Mc 来源判定（热结值/用户输入/壁厚估算）——从共享参数补齐（PHASE 71.6 三/十二）
  const mcHot = proj.getV('process.mcHotspot') || 0;
  const mcPSrc = proj.get(proj.getV('hotspots.items')?.length ? 'process.mcHotspot' : 'process.wallHot');
  const ctx = {
    ...baseCtx,
    hsStatus: proj.getV('hotspots.status'),
    mcHot,
    mcUser: !!mcPSrc && (mcPSrc.src === 'USER_OVERRIDE' || mcPSrc.src === 'USER_INPUT') && mcPSrc.v > 0,
    hotspotN: (proj.getV('hotspots.items') || []).length,
  };
  const doneIds = PAGE_ORDER.filter(p => p.key === 'page1' || results?.[p.key]).map(p => p.key)
    .concat(EXTRA_ORDER.filter(id => results?.[id]));
  const active = doneIds.includes(opts.active) ? opts.active : doneIds[0] || 'page1';
  const hsItems = proj.getV('hotspots.items') || [];
  const mc = hsItems.length ? (proj.getV('process.mcHotspot') || 0) : (proj.getV('process.wallHot') || 0);   // PHASE 28.3-A：冒口模数来源

  const navLabel = (key) => {
    const p = PAGE_ORDER.find(x => x.key === key);
    if (p) return `${p.icon} ${tr(p.name)}`;
    const c = CALC_MANIFEST.find(x => x.id === key);
    return `${c?.icon || ''} ${tr(c?.name || key)}`;
  };

  container.innerHTML = `
    <div class="page-head" style="margin-top:22px">
      <h1 class="page-title">${tr('dc.results')}</h1>
    </div>

    ${doneIds.length > 1 ? `
    <div class="dc-result-nav" id="dc_resultNav">
      ${doneIds.map(id => `<button class="dc-result-nav-btn ${id === active ? 'on' : ''}" data-nav="${id}">${navLabel(id)}</button>`).join('')}
    </div>` : ''}

    <div id="dc_resultActive">${moduleHtml(active, results, ctx)}</div>

    <div style="display:flex;gap:10px;justify-content:center;margin-top:18px;flex-wrap:wrap">
      <button class="btn btn-ghost" id="dc_again">↩️ ${tr('返回修改参数')}</button>
      <button class="btn btn-primary" id="dc_report">📄 ${tr('生成工艺计算报告')}</button>
      <button class="btn btn-ghost" id="dc_openCalcs">🧮 ${tr('打开独立计算器')}</button>
    </div>
  `;

  // 结果导航切换（19.txt 八：模块导航 + 当前页）
  container.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      opts.onNav?.(btn.dataset.nav);
      renderResultsCenter(container, results, { ...opts, active: btn.dataset.nav });
    });
  });
  // 板块内独立工具链接（Page1 castability 等；随每次重渲染重新绑定）
  container.querySelectorAll('[data-calc-link]').forEach(btn => {
    btn.addEventListener('click', () => {
      history.pushState({ view: 'calculators', id: btn.dataset.calcLink }, '', '#/calculators/' + btn.dataset.calcLink);
      window.dispatchEvent(new Event('hashchange'));
    });
  });

  /* ---- PHASE 78（78.txt 二/三/五/七/八）：结果页内联参数与子页签 ---- */
  // 参数改动 → 写项目（USER_INPUT）→ 交回设计中心重跑计算链（gating/riser/yield/charge 保持一致）
  const applyParam = (path, val) => {
    if (!(typeof val === 'string' ? val.length : Number.isFinite(val))) return;
    proj.set(path, val);
    opts.onParamChange?.();
  };
  const numOf = (sel) => { const el = container.querySelector(sel); return el ? parseFloat(el.value) : NaN; };
  // ② 冒口形状（4 种，默认圆柱形）
  container.querySelector('#dc_riserShape')?.addEventListener('change', (e) => applyParam('process.riserShape', e.target.value));
  // ③ 内浇道厚度 / 个数（改后 L_g 自动重算）
  container.querySelector('#dc_gtEdit')?.addEventListener('input', () => { const v = numOf('#dc_gtEdit'); if (v > 0) applyParam('process.gateThk', v); });
  container.querySelector('#dc_gcEdit')?.addEventListener('input', () => { const v = numOf('#dc_gcEdit'); if (v >= 1) applyParam('production.ingateN', Math.round(v)); });
  container.querySelector('#dc_gtReset')?.addEventListener('click', () => {
    proj.set('process.gateThk', 0); proj.set('production.ingateN', 0);
    opts.onParamChange?.();
  });
  // ③ 排气孔**直径**（79.txt 四：孔数由系统按总排气面积自动生成，不手填）
  container.querySelector('#dc_ventD')?.addEventListener('input', () => { const v = numOf('#dc_ventD'); if (v >= 0.5) applyParam('process.ventD', v); });
  // ③ 横浇道厚度 / 条数（PHASE 80：与内浇道同级，改后 L_r 自动重算）
  container.querySelector('#dc_rtEdit')?.addEventListener('input', () => { const v = numOf('#dc_rtEdit'); if (v > 0) applyParam('process.runnerThk', v); });
  container.querySelector('#dc_rcEdit')?.addEventListener('input', () => { const v = numOf('#dc_rcEdit'); if (v >= 1) applyParam('production.runnerN', Math.round(v)); });
  container.querySelector('#dc_rtReset')?.addEventListener('click', () => {
    proj.set('process.runnerThk', 0); proj.set('production.runnerN', 0);
    opts.onParamChange?.();
  });
  // ② 多热结子页签（点击切换该热结的冒口信息）
  container.querySelectorAll('[data-hs-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = btn.dataset.hsTab;
      container.querySelectorAll('[data-hs-tab]').forEach(b => b.classList.toggle('on', b === btn));
      container.querySelectorAll('[data-hs-pane]').forEach(p => { p.hidden = p.dataset.hsPane !== i; });
    });
  });
  // 报告（19.txt 十二：只含选择模块 + 参数来源保留）
  container.querySelector('#dc_report')?.addEventListener('click', () => {
    const html = buildWorkflowReport(results);
    saveFile(`工艺计算报告_${Date.now()}.html`, html);
  });
}
