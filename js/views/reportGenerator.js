// ============================================================
// 工艺计算报告生成（19.txt 十二：完整报告，只含用户选择的模块）
// 数据全部来自 CastingProject（含参数来源 SRC）+ 本次 results（calcs 输出），
// 与 Design Center 页面状态一致；不复制任何计算公式。
// 结构：铸件信息 / STL 分析 / 输入参数(含来源) / 热结 / 工艺计算结果 /
//       WARNING / 版本信息
// ============================================================
import * as proj from '../model/CastingProject.js';
import { CALC_MANIFEST } from '../../calcs/calcManifest.js';
import { VERSION_LABEL } from '../version.js';   // PHASE 73：版本号唯一来源（原先写死 v0.3.0，与应用不一致）

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? parseFloat(v.toFixed(d)).toString() : '—');

/** PHASE 28.5：网格校验行状态（geomStatus + 问题清单）——INVALID/WARNING 明确标注，不静默 */
function statusLabel(geomStatus, meshIssues) {
  const n = (meshIssues || []).length;
  if (geomStatus === 'INVALID') return `<span class="bad">无效（${n} 项问题）</span>`;
  if (geomStatus === 'WARNING') return `<span class="warn">有风险（${n} 项提示，仅供参考）</span>`;
  return n ? `通过（${n} 项提示）` : '通过';
}

/** SRC → 报告文字徽章 */
export const SRC_BADGE_TEXT = {
  STL_GEOMETRY_ANALYSIS: '🟢 STL 自动',
  DERIVED: '🔵 计算得到',
  USER_INPUT: '🟡 用户输入',
  USER_OVERRIDE: '🟠 用户修改',
  SCENARIO: '🟡 生产场景',
  DEFAULT: '🟡 系统默认',
  CALC_RESULT: '🔵 计算结果',
};

const STYLE = `<style>
  body{font-family:system-ui,sans-serif;color:#1f2937;font-size:13px;padding:24px;max-width:860px;margin:0 auto}
  h1{font-size:20px;margin:0 0 4px} h2{font-size:15px;border-left:4px solid #2563eb;padding-left:8px;margin:26px 0 10px}
  .meta{color:#6b7280;font-size:12px;margin-bottom:14px}
  table{border-collapse:collapse;width:100%;margin:8px 0}
  th,td{border:1px solid #d1d5db;padding:5px 9px;text-align:left}
  th{background:#f3f4f6} td:first-child{width:34%;color:#6b7280}
  .warn{background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:8px 12px;margin:8px 0}
  .ok{color:#059669} .bad{color:#dc2626}
  .sec{page-break-inside:avoid}
</style>`;

/** 参数表（含来源徽章）：paths = [[路径, 显示名, 单位]] */
function paramsTable(paths) {
  return `<table><tr><th>参数</th><th>数值</th><th>来源</th></tr>` +
    paths.map(([path, label, unit = '']) => {
      const p = proj.get(path);
      if (!p || p.v == null || p.v === '' || (Array.isArray(p.v) && !p.v.some(x => x > 0))) return '';
      const v = Array.isArray(p.v) ? p.v.map(x => fmt(x, 1)).join('×') : fmt(p.v, 2);
      return `<tr><td>${label}</td><td><b>${v}</b> ${unit}</td><td>${SRC_BADGE_TEXT[p.src] || p.src}</td></tr>`;
    }).join('') + `</table>`;
}

/** 热结表 */
function hotspotTable() {
  const items = proj.getV('hotspots.items') || [];
  if (!items.length) return `<p class="meta">未检出热结（${proj.getV('hotspots.reason') || '—'}）</p>`;
  return `<table><tr><th>#</th><th>Mc (mm)</th><th>区域体积 (cm³)</th><th>代表点 (x,y,z)</th><th>置信度</th></tr>` +
    items.map(h => `<tr><td>${h.id}</td><td>${fmt(h.mc, 1)}</td><td>${fmt(h.regionVolumeCm3, 1)}</td>` +
      `<td>(${fmt(h.x, 0)}, ${fmt(h.y, 0)}, ${fmt(h.z, 0)})</td><td>${h.confidence ? Math.round(h.confidence * 100) + '%' : '—'}</td></tr>`).join('') +
    `</table>`;
}

/** 单模块结果 → HTML 摘要（复用结果中心的展示数据，无公式） */
function moduleResultHtml(id, r) {
  const out = [];
  const stat = (k, v, ok = null) => `<tr><td>${k}</td><td><b>${v}</b>${ok === null ? '' : ok ? ' ✅' : ' ⚠️'}</td></tr>`;
  if (id === 'gating' && r) {
    // PHASE 73 P1 修复：s_r/r_r/g_r 缺失时原样插值会打印 "undefined : undefined : undefined"
    //   → 三值齐备才显示比例，否则整段省略（只留比例预设名），报告里绝不出现 undefined
    const ratioTxt = [r.s_r, r.r_r, r.g_r].every(v => typeof v === 'number' && Number.isFinite(v))
      ? `（${fmt(r.s_r, 2)} : ${fmt(r.r_r, 2)} : ${fmt(r.g_r, 2)}）` : '';
    out.push(`<table>${stat('浇注重量 G', fmt(r.G, 1) + ' kg')}${stat('浇注时间 t', fmt(r.t, 1) + ' s')}${stat('阻流截面 A', fmt(r.A, 0) + ' mm²')}${stat('系统比例', esc(r.ratioKey || '—') + ratioTxt)}${stat('直浇道', '⌀' + fmt(r.D_sp, 0) + ' mm')}${stat('横浇道', `${r.rc ?? '—'} 条 × ${r.rt ?? '—'}mm × ${fmt(r.L_r, 0)}mm`)}${
      stat('内浇道', `${r.gc ?? '—'} 个 × ${r.gt ?? '—'}mm × ${fmt(r.L_g, 0)}mm`)}${stat('内浇口流速', fmt(r.v, 2) + ` m/s（${r.rd?.type ? r.rd.type + '式' : ''}≤${r.vLimit ?? '—'}）`, r.v_ok)}${stat('排气', `⌀${fmt(r.ventD, 2)} × ${r.ventN ?? '—'} 个 → ${fmt(r.vt, 1)} mm²（比值 ${fmt(r.vr, 2)}）`, r.vr_ok)}</table>`);
  } else if (id === 'riser' && r) {
    if (r.blocked) {
      out.push(`<div class="warn">⛔ ${esc(r.note || '自动冒口建议不可用')}</div>`);
    } else {
      // PHASE 79（79.txt 三）：尺寸称谓随形状（正方柱=边长，球形=球径，柱=⌀×H）——用形状库自带的 label
      const dim = r.sd?.label ? r.sd.label(r.D, r.H) : '⌀' + fmt(r.D, 0) + '×H' + fmt(r.H, 0);
      out.push(`<table>${stat('冒口形状', esc(r.sd?.name || '圆柱形'))}${stat('冒口尺寸', dim)}${stat('实际模数', fmt(r.Mr_act, 2) + ' mm（≥所需 ' + fmt(r.Mr_need, 2) + '）', r.modOk)}${stat('补缩效率', fmt(r.eff * 100, 0) + '%')}${stat('冒口体积', fmt(r.Vr / 1000, 1) + ' cm³')}${stat('冒口颈', '⌀' + fmt(r.d_neck, 0) + ' mm')}${stat('体积补缩', r.volOk ? '充足' : '不足，需加大冒口或加冷铁', r.volOk)}</table>`);
      // PHASE 71.7（77.txt 二）：多热结逐热结方案（与结果页一致）
      if (r.items?.length > 1) {
        out.push(`<table><tr><th>热结</th><th>设计模数 Mc</th><th>冒口尺寸</th><th>体积校核</th></tr>` +
          r.items.map(it => `<tr><td>H${it.hsId ?? '—'}</td><td>${fmt(it.Mc, 1)} mm</td><td>⌀${fmt(it.D, 0)}×H${fmt(it.H, 0)}</td><td>${it.volOk ? '充足 ✅' : '不足 ⚠️'}</td></tr>`).join('') +
          `</table>`);
      }
      if (r.note) out.push(`<div class="meta">${esc(r.note)}</div>`);
    }
  } else if (id === 'yield' && r) {
    out.push(`<table>${stat('铸件重量', fmt(r.castWt, 2) + ' kg')}${stat('浇注重量', fmt(r.pourWt, 2) + ' kg')}${stat('出品率', fmt(r.castWt / r.pourWt * 100, 1) + '%')}${stat('参考区间', (r.range || []).join('~') + '%')}${stat('浇注系统重', fmt(r.runnerWt, 2) + ' kg')}${r.riserWt != null ? stat('冒口重量', fmt(r.riserWt, 2) + ' kg') : ''}</table>`);
  } else if (id === 'chill' && r) {
    if (r.blocked) {
      out.push(`<div class="warn">⛔ ${esc(r.note || '自动冷铁推荐不可用')}</div>`);
    } else {
      out.push(`<table>${stat('冷铁厚度', Array.isArray(r.thickness) ? r.thickness.map(v => fmt(v, 1)).join('~') + ' mm' : fmt(r.mid, 1) + ' mm')}${stat('推荐值', fmt(r.mid, 1) + ' mm')}${stat('类型', esc(r.type))}</table>`);
      if (r.warnings?.length) out.push(`<div class="warn">${r.warnings.slice(0, 4).map(w => esc(w.replace(/^[❌⚠️✅]+\s*/, '')) + '<br>').join('')}</div>`);
    }
  } else if (id === 'sandbox' && r) {
    out.push(`<table>${stat('砂型最小壁厚', fmt(r.minWall, 0) + ' mm')}${stat('砂型轮廓', fmt(r.dim, 0) + ' mm')}${stat('铸件重', fmt(r.wt, 1) + ' kg')}</table>`);
    if (r.warning) out.push(`<div class="warn">${esc(r.warning)}</div>`);
  } else if (id === 'machining' && r) {
    if (r.unsupported) {
      out.push(`<div class="warn">ℹ️ ${esc(r.note || '该工艺×材质无标准 RMA 等级')}</div>`);
    } else {
      out.push(`<table>${stat('余量范围', fmt(r.min, 1) + '~' + fmt(r.max, 1) + ' mm')}${stat('推荐值', fmt(r.mid, 1) + ' mm')}${stat('等级', (r.grades || []).join('~'))}</table>`);
    }
  } else if (id === 'charge' && r) {
    if (r.unsupported) {
      out.push(`<div class="warn">${esc(r.note || '暂不支持该牌号')}</div>`);
    } else {
      out.push(`<table>${stat('牌号', esc(r.defGrade))}${stat('铁水总重', fmt(r.pourWt, 1) + ' kg')}${stat('目标碳当量 CE', r.targetCE ? fmt(r.targetCE, 2) + '%' : '—')}${stat('成分平衡', r.allOk ? '全部达标' : '有差额，见补料建议', r.allOk)}</table>`);
      if (r.sugs?.length) out.push(`<div class="warn">${r.sugs.slice(0, 4).map(s => esc(`${s.label} +${s.kg} kg`) + '<br>').join('')}</div>`);
    }
  } else if (id === 'shakeout' && r) {
    const [lo, hi] = r.timeRange || [0, 0];
    out.push(`<table>${stat('型内冷却时间', fmt(lo, 0) + (r.unit === 'h' ? '~' + fmt(hi, 1) + ' h' : '~' + fmt(hi, 0) + ' min'))}${stat('开箱温度', fmt(r.shakeTemp, 0) + ' ℃')}</table>`);
    if (r.warnings?.length) out.push(`<div class="warn">${r.warnings.slice(0, 3).map(w => esc(w.replace(/^[❌⚠️✅]+\s*/, '')) + '<br>').join('')}</div>`);
  } else if (id === 'shrinkage' && r) {
    out.push(`<table><tr><th>方向 (mm)</th><th>收缩率</th><th>放尺量 (mm)</th><th>样板尺寸 (mm)</th></tr>` +
      (r.dirs || []).map(d => `<tr><td>${fmt(d.size, 0)}</td><td>${fmt(d.rate, 2)}%</td><td>${fmt(d.amount, 2)}</td><td>${fmt(d.pattern, 1)}</td></tr>`).join('') + `</table>`);
    out.push(`<p class="meta">综合比例：${r.combined != null ? fmt(r.combined, 2) + '%' : '不推荐（方向差 ' + fmt(r.spread, 2) + '% ≥ 0.2%，建议分方向放缩水）'} · 参考区间 ${esc(r.range || '')}</p>`);
  }
  return out.join('');
}

/**
 * 生成完整工艺报告 HTML（19.txt 十二：只含用户实际选择的模块）
 * @param {object} results  designCenter 本次执行结果（模块 id → calcs 输出）
 * @param {object} [extra]  { fileName, sampling, stlStatus }  STL 会话信息
 */
export function buildWorkflowReport(results, extra = {}) {
  const size = proj.getV('geometry.size') || [0, 0, 0];
  const m = CALC_MANIFEST;
  const doneIds = Object.keys(results || {}).filter(id => results[id]);
  const stl = proj.get('meta.stlSession')?.v;
  const fileName = extra.fileName || stl?.fileName || '—';

  // WARNING 段：采样欠解析 + 各模块警告
  const warns = [];
  if (extra.sampling?.warning) warns.push(extra.sampling.detail);
  for (const id of doneIds) {
    const r = results[id];
    const ws = r?.warnings || r?.sug?.filter?.(s => /⚠|❌/.test(String(s))) || [];
    if (Array.isArray(r?.warnings)) for (const w of r.warnings.slice(0, 3)) warns.push(`[${m.find(x => x.id === id)?.name}] ${w.replace(/^[❌⚠️✅]+\s*/, '')}`);
  }

  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8">
<title>工艺计算报告 · ${esc(fileName)}</title>${STYLE}</head>
<body>
  <h1>🧭 铸造工艺计算报告</h1>
  <div class="meta">生成时间：${new Date().toLocaleString('zh-CN')} ｜ Casting Toolbox ${VERSION_LABEL} ｜ 引擎：Hotspot V3 + calcs 单一计算核心</div>

  <div class="sec"><h2>1. 铸件信息</h2>${paramsTable([
    ['material.family', '材料大类'], ['material.liquidDensity', '液态密度', 'g/cm³'], ['material.solidDensity', '固态密度', 'g/cm³'],
    ['geometry.netWeightKg', '净重（STL）', 'kg'], ['geometry.blankWeightKg', '毛坯重量', 'kg'], ['geometry.volumeCm3', '体积', 'cm³'],
    ['geometry.size', '外形尺寸', 'mm'], ['geometry.wallMax', '最大壁厚', 'mm'],
    ['process.wallUsed', '主体壁厚', 'mm'],
    ['production.cavities', '一模件数', '件'], ['production.qty', '目标产量', '件'],
  ])}</div>

  <div class="sec"><h2>2. STL 分析</h2>
  <table><tr><th>项目</th><th>数值</th></tr>
    <tr><td>STL 文件</td><td><b>${esc(fileName)}</b></td></tr>
    <tr><td>三角面数量</td><td>${fmt(proj.getV('geometry.triCount'), 0)}</td></tr>
    <tr><td>网格校验</td><td>${statusLabel(proj.getV('geometry.geomStatus'), proj.getV('geometry.meshIssues'))}</td></tr>
    <tr><td>STL 会话</td><td>${stl?.fingerprint ? '已绑定（' + esc(stl.fileName) + '）' : '未导入（手动模式）'}</td></tr>
  </table></div>

  <div class="sec"><h2>3. 热结分析</h2>${hotspotTable()}</div>

  <div class="sec"><h2>4. 输入参数（含来源）</h2>${paramsTable([
    ['geometry.volumeCm3', '体积', 'cm³'], ['geometry.blankWeightKg', '毛坯重量', 'kg'], ['geometry.netWeightKg', '净重', 'kg'],
    ['geometry.wallMax', '最大壁厚', 'mm'], ['geometry.wallAvg', '平均壁厚', 'mm'],
    ['process.wallUsed', '主体壁厚', 'mm'],
    ['material.family', '材料'], ['material.liquidDensity', '液态密度', 'g/cm³'], ['material.solidDensity', '固态密度', 'g/cm³'],
    ['production.cavities', '一模件数', '件'], ['process.pourPos', '浇注方向'],
    ['process.Ho', '内浇道至上箱面', 'mm'], ['process.ph', '铸件高度', 'mm'],
  ])}</div>

  <div class="sec"><h2>5. 工艺计算结果（已选择模块）</h2>
    ${doneIds.length ? doneIds.map(id => {
      const c = m.find(x => x.id === id);
      return `<h3 style="margin:14px 0 4px">${c?.icon || ''} ${c?.name || id}</h3>${moduleResultHtml(id, results[id])}`;
    }).join('') : '<p class="meta">未执行任何计算模块。</p>'}
  </div>

  <div class="sec"><h2>6. WARNING / 数据可靠性</h2>
    ${warns.length ? warns.map(w => `<div class="warn">⚠️ ${esc(w)}</div>`).join('') : '<p class="meta">无警告。</p>'}
    ${extra.sampling?.warning ? '' : '<p class="meta">采样分辨率正常。</p>'}
  </div>

  <div class="sec"><h2>7. 版本信息</h2>
  <table>
    <tr><td>热结引擎</td><td>Hotspot Engine V3（Local V/A + Adaptive Sampling）</td></tr>
    <tr><td>计算核心</td><td>calcs/ 单一核心（与独立计算器一致）</td></tr>
    <tr><td>参数来源</td><td>🟢 STL 自动 / 🔵 计算得到 / 🟡 用户输入 / 🟠 用户修改</td></tr>
  </table></div>
</body></html>`;
}
