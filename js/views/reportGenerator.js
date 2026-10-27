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
// PHASE V2.0-15（126.txt §三 · 导出报告）：**未收敛警告不得在报告里缺席**。
//   与结果卡共用 riserStatus 的判定与文案（单一来源）；报告是中文单语，故用 fillWarning 本地代入占位符。
import { riserWarning, fillWarning } from './riserStatus.js';
import { buildYieldLedger } from './yieldLedger.js';
import { gatingFacts, riserItemFacts, collectRisks } from './resultFacts.js';
import { minWallOf, criticalWallOf, filletRadii, draftAngles, MIN_HOLE_BATCH } from '../../calcs/castability.js';
import { batchOfQty, CAST_MAT_KEY, THICK_RATIO_WARN } from './processPage1.js';

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

/** PHASE V2.0-08-FINAL（118.txt §二）：可靠度等级 → 文字。
 *  **与结果页共用同一张表**（resultsCenter 从这里 import）——
 *  页面与导出报告对"确定性"的表达必须同一口径，不允许两处各写一份标签（D1 根因就是两处各判一次）。
 *  `[0]` 图标、`[1]` 文字（结果页过 tr() 走双语，报告为中文单语）。 */
export const LEVEL_TEXT = {
  SAFE_TO_RECOMMEND: ['✅', '可直接采用'],
  WARNING_REVIEW: ['🟡', '需人工复核'],
  BLOCK_AUTO_RECOMMEND: ['⛔', '自动建议已阻止'],
};

/** PHASE V2.0-08-FINAL：冒口 **Mc 的来源** → 报告文字。
 *  口径与结果页 `mcSourceLine` 一致；**只认 calcManifest 在选值处标注的 `mcSrc`**，
 *  不从任何别的字段反推（反推会把多热结路径的用户值标成 STL 检出值）。
 *  来源缺失/未知 → 返回 null ⇒ 调用处**不出行**，绝不编造。 */
function mcSrcText(src) {
  if (src === proj.SRC.USER_OVERRIDE || src === proj.SRC.USER_INPUT) return '🟠 用户确认';
  if (src === proj.SRC.STL_GEOMETRY_ANALYSIS) return '🟢 STL 自动检测（未经确认）';
  if (src === proj.SRC.DERIVED) return '🔵 壁厚/结构参考值';
  return null;
}

const STYLE = `<style>
  body{font-family:system-ui,sans-serif;color:#1f2937;font-size:13px;padding:24px;max-width:860px;margin:0 auto}
  h1{font-size:20px;margin:0 0 4px} h2{font-size:15px;border-left:4px solid #2563eb;padding-left:8px;margin:26px 0 10px}
  .meta{color:#6b7280;font-size:12px;margin-bottom:14px}
  table{border-collapse:collapse;width:100%;margin:8px 0}
  th,td{border:1px solid #d1d5db;padding:5px 9px;text-align:left}
  th{background:#f3f4f6} td:first-child{width:34%;color:#6b7280}
  .warn{background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:8px 12px;margin:8px 0}
  .ok{color:#059669} .bad{color:#dc2626}
  .lvl{border:1px solid #e5e7eb;background:#f9fafb;border-radius:6px;padding:6px 10px;margin:6px 0;font-weight:600}
  .lvl-s{color:#059669;border-color:#a7f3d0;background:#ecfdf5}
  .lvl-w{color:#b45309;border-color:#fde68a;background:#fffbeb}
  .lvl-b{color:#dc2626;border-color:#fecaca;background:#fef2f2}
  .sec{page-break-inside:avoid}
</style>`;

/** 参数表（含来源徽章）：paths = [[路径, 显示名, 单位]] */
function paramsTable(paths) {
  return `<table><tr><th>参数</th><th>数值</th><th>来源</th></tr>` +
    paths.map(([path, label, unit = '']) => {
      const p = proj.get(path);
      if (!p || p.v == null || p.v === '' || (Array.isArray(p.v) && !p.v.some(x => x > 0))) return '';
      /* R6-S3.1：字符串参数（材料/浇注方向/造型线/形状…）不能走数值 fmt，否则报告显示“—”。 */
      const v = Array.isArray(p.v)
        ? p.v.map(x => fmt(x, 1)).join('×')
        : (typeof p.v === 'string' ? esc(p.v) : fmt(p.v, 2));
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

/** 报告与结果页共用同一条结果有效性状态（由 resultsCenter 传入 `status`）。 */
function statusSection(extra = {}) {
  const st = extra.status;
  if (!st) {
    return `<div class="sec"><h2>0. 结果有效性</h2><div class="warn">⚠️ 未提供结果状态。本报告由当前内存结果生成，不能替代结果页的有效性判定。</div></div>`;
  }
  const bad = st.k === 'stale' || st.k === 'failed' || st.k === 'needparam';
  return `<div class="sec"><h2>0. 结果有效性</h2>
    <div class="${bad ? 'warn' : 'ok'}">${bad ? '⛔' : '✅'} <b>${esc(st.text || '—')}</b></div>
    <p class="meta">报告与屏幕结果读取同一批 results / CastingProject 参数；若状态为“待重新分析 / 分析失败”，本报告只代表上一次成功结果，不得作为当前参数下的设计依据。</p>
  </div>`;
}

/** 铸件结构性检查（报告是中文单语；直接复用 castability 的数值函数，不经过 UI 的 i18n 层）。 */
function page1ReportHtml() {
  const fam = proj.getV('material.family') || '';
  const matKey = CAST_MAT_KEY[fam] || null;
  const size = proj.getV('geometry.size') || [0, 0, 0];
  const maxDim = Math.max(...size);
  const body = proj.getV('process.wallUsed') || proj.getV('geometry.wallAvg') || 0;
  const wallMax = proj.getV('geometry.wallMax') || 0;
  const qty = proj.getV('production.qty') || 0;
  const rows = [];
  if (matKey && maxDim > 0) {
    const mw = minWallOf(matKey, maxDim);
    const crit = criticalWallOf(mw.mid);
    rows.push(['最小壁厚', `建议 ${mw.text} mm（${matKey} · ${mw.bucketLabel}砂型档）；临界壁厚 ≈ ${crit} mm`]);
  } else {
    rows.push(['最小壁厚', '材料大类或外形尺寸未就绪，无法给出参考。']);
  }
  if (body > 0) {
    const fr = filletRadii(body);
    rows.push(['铸造圆角', `相邻壁均值 ${fmt(body, 1)} mm → 外圆角 ≈${fr.outer} mm（${fr.outerRange}），内圆角 ≈${fr.inner} mm（${fr.innerRange}）`]);
    const h = Math.max(10, maxDim || 50);
    const da = draftAngles(h, '金属/塑料', '潮模砂（湿型）');
    rows.push(['拔模斜度', `外壁 ${da.outer} · 内表面 ${da.inner}（JB/T 5105-2022，按高度 ≤${fmt(h, 0)} mm 档）`]);
  }
  if (matKey) {
    const batch = batchOfQty(qty);
    const hole = (MIN_HOLE_BATCH[matKey] || {})[batch];
    rows.push(['最小铸出孔径', `砂型参考 ${hole != null ? '≥' + hole + ' mm' : '—'}（${matKey} · ${batch}，按目标产量 ${qty || '—'} 件判定）`]);
  }
  const risks = [];
  if (wallMax > 0 && body > 0 && wallMax / body >= THICK_RATIO_WARN) {
    risks.push(`厚薄突变：最大壁厚 ${fmt(wallMax, 1)} / 主体 ${fmt(body, 1)} = ${fmt(wallMax / body, 1)}×（阈值 ≥${THICK_RATIO_WARN}×）`);
  }
  const hsN = (proj.getV('hotspots.items') || []).length;
  if (hsN) risks.push(`${hsN} 处厚大热结（详见第 3 节）`);
  return `<table><tr><th>检查项</th><th>结论 / 参考依据</th></tr>${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table>
    <p class="meta">结构风险信号：${esc(risks.length ? risks.join('；') : '未检出明显结构风险信号。')}</p>`;
}

/** P0/P1 风险（与结果页共用 collectRisks；报告不重复各模块 note，避免同一句话出现两次）。 */
const fillVars = (s, vars = {}) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
function riskSection(results) {
  const risks = collectRisks(results || {}, { limit: 20 });
  if (!risks.length) return '';
  return `<h3 style="margin:14px 0 4px">待复核 / 风险</h3>
    ${risks.map(r => `<div class="warn" style="border-color:${r.level === 'P0' ? '#dc2626' : '#f59e0b'}">
      <b>${r.level}</b> ${esc(fillVars(r.textKey, r.params))}</div>`).join('')}`;
}

/** 单模块结果 → HTML 摘要（复用结果中心的展示数据，无公式） */
function moduleResultHtml(id, r, allResults = {}) {
  const out = [];
  const stat = (k, v, ok = null) => `<tr><td>${k}</td><td><b>${v}</b>${ok === null ? '' : ok ? ' ✅' : ' ⚠️'}</td></tr>`;
  if (id === 'gating' && r) {
    /* R6-S3.1（154.txt §八）：报告与结果页共用 gatingFacts 的三段/整模账目/RH 口径。
       所有缺失字段一律 fmt → '—'，不出现 undefined / NaN。 */
    const gf = gatingFacts(r, allResults);
    const ledger = gf.ledger;
    // PHASE 73 P1 修复：s_r/r_r/g_r 缺失时原样插值会打印 "undefined : undefined : undefined"
    const ratioTxt = [r.s_r, r.r_r, r.g_r].every(v => typeof v === 'number' && Number.isFinite(v))
      ? `（${fmt(r.s_r, 2)} : ${fmt(r.r_r, 2)} : ${fmt(r.g_r, 2)}）` : '';
    const rf = gf.areas[1];
    const runnerDim = rf?.isTrapezoid
      ? `${fmt(rf.count, 0)} 条 × 上底 ${fmt(rf.top, 2)} mm × 下底 ${fmt(rf.bottom, 2)} mm × 高 ${fmt(rf.height, 2)} mm（${esc(rf.sectionLabel)}）`
      : `${fmt(rf?.count, 0)} 条 × 厚 ${fmt(rf?.thickness, 0)} mm × 长 ${fmt(rf?.length, 0)} mm（矩形）`;
    if (!gf.validity.ok) out.push(`<div class="warn" style="border-color:#dc2626">⛔ <b>P0</b> ${esc(gf.validity.textKey)}</div>`);
    out.push(`<h3 style="margin:14px 0 4px">总体结果</h3><table>
      ${stat('浇注重量 G（单件 × 型腔数 ÷ 预估出品率）', fmt(r.G, 1) + ' kg')}
      ${stat('浇注时间 t', fmt(r.t, 1) + ' s')}
      ${stat('阻流截面 A', fmt(r.A, 0) + ' mm²')}
      ${stat('内浇口流速', fmt(gf.areas[2]?.velocity, 2) + ' m/s（R7 ≤' + fmt(r.vLimit, 1) + '）', r.vState !== 'high')}
      ${stat('系统比例', esc(r.ratioKey || '—') + ratioTxt)}
    </table>
    <h3 style="margin:14px 0 4px">生产条件与 RH</h3><table>
      ${stat('型腔数', `${fmt(gf.production.cav, 0)} 件`)}
      ${stat('设计预估出品率', fmt(gf.production.designYield, 1) + '%（用于反算 G，不是实称最终出品率）')}
      ${stat('造型线 / 铸造方法', `${esc(gf.production.line)} / ${esc(gf.production.method)}`)}
      ${stat('RH（冒口顶面高出铸件顶面）', fmt(r.rh, 1) + ' mm（' + gf.rh.labelKey + '；C = ph + RH）')}
      ${stat('铸件高度 ph / 平均静压头 Hp', `${fmt(r.ph, 1)} / ${fmt(r.Hp, 1)} mm（${esc(r.pos || '—')}，Ho=' + fmt(r.Ho, 0) + '）`)}
    </table>
    <h3 style="margin:14px 0 4px">直浇道 / 横浇道 / 内浇道</h3><table>
      <tr><th>部位</th><th>实际尺寸 / 数量</th><th>实际总截面</th><th>参考截面</th></tr>
      <tr><td>直浇道 S</td><td>⌀${fmt(gf.areas[0]?.diameter, 0)} mm</td><td>${fmt(gf.areas[0]?.area, 0)} mm²</td><td>${fmt(gf.areas[0]?.reference, 0)} mm²</td></tr>
      <tr><td>横浇道 R</td><td>${runnerDim}</td><td>${fmt(rf?.area, 0)} mm²</td><td>${fmt(rf?.reference, 0)} mm²</td></tr>
      <tr><td>内浇道 G</td><td>${fmt(gf.areas[2]?.count, 0)} 个 × ${gf.areas[2]?.shape === '圆形' ? '⌀' + fmt(gf.areas[2]?.diameter, 0) + ' mm' : '厚 ' + fmt(gf.areas[2]?.thickness, 0) + ' mm × 长 ' + fmt(gf.areas[2]?.length, 0) + ' mm'}</td><td>${fmt(gf.areas[2]?.area, 0)} mm²</td><td>${fmt(gf.areas[2]?.reference, 0)} mm²</td></tr>
      <tr><td>排气（次级）</td><td>⌀${fmt(gf.vent.diameter, 2)} × ${fmt(gf.vent.count, 0)} 个</td><td>${fmt(gf.vent.area, 1)} mm²（${fmt(gf.vent.ratio, 2)} 倍）</td><td>企业标准 1.5~4 倍 ${gf.vent.ok ? '✅' : '⚠️'}</td></tr>
    </table>
    ${rf?.isTrapezoid ? `<div class="meta">梯形横浇道：A_run 为全部横浇道目标总面积，按条数均分后反算单条尺寸；表中实际总截面由最终显示尺寸回算。阻流位置/面积比按实际总截面积重算（P51 面积判定同规则）；未进行梯形流动仿真，不能视为矩形流动校核的等价验证。</div>` : ''}
    <h3 style="margin:14px 0 4px">整模重量口径与出品率</h3><table>
      ${stat('单件毛坯重 / 整模铸件重', `${fmt(ledger.blankWt, 2)} / ${fmt(ledger.blankTotal, 2)} kg（× ${ledger.cav} 腔）`)}
      ${stat('浇注重量 G', fmt(ledger.pourWt, 2) + ' kg')}
      ${stat('差值 = G − 整模铸件重', fmt(ledger.delta, 2) + ' kg（含冒口 + 浇道）')}
      ${stat('整模冒口重（假设每腔一套）', fmt(ledger.riserTotal, 2) + ' kg')}
      ${stat('浇道重（反推残差，假设每腔一套冒口）', fmt(ledger.gatingEst, 2) + ' kg')}
    </table>
    <div class="meta">当前为工艺预估值。获得实际出品率后，可手动输入并回算相关参数（独立「出品率与铁水重量」计算器）。</div>`);
    const sugs = (r.sugs || []).filter(s => /⚠|❌|ℹ/.test(String(s)));
    if (sugs.length) out.push(`<div class="warn">${sugs.slice(0, 5).map(s => esc(String(s)) + '<br>').join('')}</div>`);
  } else if (id === 'riser' && r) {
    if (r.blocked) {
      out.push(`<div class="warn">⛔ ${esc(r.note || '自动冒口建议不可用')}</div>`);
    } else if (r.designType === 'insulated') {
      /* 164 §4：发热/保温为当前设计类型；报告只印换算后的几何与体积，
         不把普通圆柱的目标模数/补缩效率冒充成新方案结果。 */
      const dim = r.sd?.label ? r.sd.label(r.D, r.H) : `⌀${fmt(r.D, 0)}×H${fmt(r.H, 0)}`;
      const hdAct = r.D > 0 ? r.H / r.D : null;
      const dimOf = (it) => `⌀${fmt(it.D, 0)}×H${fmt(it.H, 0)}`;
      out.push(`<table>
        ${stat('冒口类型', '发热/保温冒口（经验估算）')}
        ${stat('冒口尺寸', dim)}
        ${stat('实际 H/D', fmt(hdAct, 2) + `（沿用名义 ${fmt(r.hd, 2)}）`)}
        ${stat('普通圆柱基准体积 V0', fmt(r.V0 / 1000, 1) + ' cm³（几何体积，不含补缩效率修正）')}
        ${stat('目标体积 V1 = 0.4 × V0', fmt(r.V1 / 1000, 1) + ' cm³（40% 为本产品经验系数）')}
        ${stat('实际几何体积（按显示尺寸回算）', fmt(r.Vactual / 1000, 1) + ' cm³' + (r.volumeOk ? ' ✅' : ' ⚠️ 小于目标'))}
        ${stat('几何模数（参考）', fmt(r.Mr_act, 2) + ' mm（由新几何 D×H 计算，不作普通目标模数判定）')}
        ${r.weightKg != null ? stat('冒口重量（按几何体积与密度）', fmt(r.weightKg, 3) + ' kg') : ''}
      </table>
      <div class="meta">发热/保温冒口以普通圆柱几何体积 V0 乘 0.4 得到目标体积，再沿用当前 H/D 反算尺寸；未重复应用补缩效率或其它体积修正。该模式属于经验估算，不套用普通目标模数判定，实际补缩效果需通过铸造模拟或生产验证。</div>`);
      if (r.items?.length > 1) {
        out.push(`<table><tr><th>热结</th><th>设计模数 Mc</th><th>Mc 来源</th><th>发热/保温尺寸</th><th>目标体积</th><th>实际几何体积</th></tr>` +
          r.items.map(it => `<tr><td>H${it.hsId ?? '—'}</td><td>${fmt(it.Mc, 1)} mm</td><td>${mcSrcText(it.mcSrc) || '—'}</td><td>${dimOf(it)}</td><td>${fmt(it.V1 / 1000, 1)} cm³</td><td>${fmt(it.Vactual / 1000, 1)} cm³</td></tr>`).join('') +
          `</table>`);
      }
      if (r.note) out.push(`<div class="meta">${esc(r.note)}</div>`);
    } else {
      // PHASE V2.0-08-FINAL（118.txt §二）：**可靠度等级必须随报告一起印出**。
      //   页面上「🟡 需人工复核 / ✅ 可直接采用」是结果卡上最醒目的 chip；报告原来一处也不提，
      //   只列 ✅ 校核行 ⇒ 读者会把"自动估计值算出的尺寸"读成"已验证的设计"。
      //   等级未知（旧结果/合成数据）时**不出行**，不编造一个等级。
      const lv = r.level && LEVEL_TEXT[r.level];
      if (lv) {
        const cls = r.level === 'SAFE_TO_RECOMMEND' ? 'lvl-s' : r.level === 'BLOCK_AUTO_RECOMMEND' ? 'lvl-b' : 'lvl-w';
        out.push(`<div class="lvl ${cls}">可靠度：${lv[0]} ${lv[1]}</div>`);
      }
      // PHASE 79（79.txt 三）：尺寸称谓随形状（正方柱=边长，球形=球径，柱=⌀×H）——用形状库自带的 label
      const dim = r.sd?.label ? r.sd.label(r.D, r.H) : '⌀' + fmt(r.D, 0) + '×H' + fmt(r.H, 0);
      // PHASE V2.0-08-FINAL：**Mc 及其来源随结果一起印出**。
      //   页面早有"来源：…"一行，报告原来一处也没有 ⇒ 读者无法判断这个冒口是按
      //   "STL 自动估计的 Mc"还是"用户确认的 Mc"算出来的（Mc 来源缺失 = 关键事实缺失）。
      const mcSrc = mcSrcText(r.mcSrc);
      // PHASE V2.0-22（138.txt §五）：报告与页面同口径 —— 目标模数必须印出；旧体积模型降级为
      //   "参考值"，**不再**以红/绿判定出现（它已不是设计判据）。
      const MrT = r.Mr_target != null ? r.Mr_target : r.Mr_need;
      const rf = riserItemFacts(r);
      /* S5-05：报告与页面使用同一 H/D 口径 —— 实际值由最终 D/H 计算，名义值来自设计输入。 */
      const hdAct = (r.D > 0 && r.H > 0) ? r.H / r.D : null;
      const hdNom = Number(r.hd);
      const hdTxt = r.shapeKey === 'sphere'
        ? 'H ≡ D（球形）'
        : (hdAct != null
          ? hdAct.toFixed(2) + (Number.isFinite(hdNom) && Math.abs(hdAct - hdNom) > 0.005 ? '（名义 ' + hdNom.toFixed(2) + '）' : '')
          : '—');
      out.push(`<table>${mcSrc ? stat('设计模数 Mc', fmt(r.Mc, 1) + ' mm（' + mcSrc + '）') : ''}${stat('冒口形状', esc(r.sd?.name || '圆柱形'))}${stat('冒口尺寸', dim)}${stat('H/D（高度 / 直径）', hdTxt)}${stat('目标冒口模数 Mr_target', fmt(MrT, 2) + ' mm（Mc × ' + fmt(r.targetRatio != null ? r.targetRatio : 1.2, 2) + '）')}${stat('实际模数 Mr_actual', fmt(r.Mr_act, 2) + ' mm（≥目标 ' + fmt(MrT, 2) + '）', r.modOk)}${stat('补缩效率', fmt(r.eff * 100, 0) + '%')}${stat('冒口体积 Vr', fmt(r.Vr / 1000, 1) + ' cm³')}${stat('可补缩量 = Vr × 补缩效率', fmt(rf?.effVCm3, 1) + ' cm³')}</table>`);
      // PHASE V2.0-15（126.txt §三 / §五）：**导出报告必须带未收敛警告**。
      //   本行紧随尺寸表，说明"哪条约束通过/未通过 + 不是收敛解 + 不可当作已通过全部约束的设计结果"。
      //   措辞只描述**算法约束状态**，不外推"真实铸件会缩孔"，也不把理论计算说成已验证的生产尺寸。
      const wWarn = fillWarning(riserWarning(r));
      if (wWarn) out.push(`<div class="warn">${wWarn}</div>`);
      // PHASE 71.7（77.txt 二）：多热结逐热结方案（与结果页一致）
      // PHASE V2.0-08-FINAL：① 逐项标 Mc 来源 —— 混合场景（部分用户改、部分仍是检出值）下
      //   报告原来把两类数字并列成完全同质的两行，读者无从分辨；
      //   ② 尺寸改用形状库的 label —— 原来写死「⌀D×H」，正方柱印成"⌀134"、球形印成"⌀147×H147"，是标注错误。
      if (r.items?.length > 1) {
        const dimOf = (it) => it.sd?.label ? it.sd.label(it.D, it.H) : '⌀' + fmt(it.D, 0) + '×H' + fmt(it.H, 0);
        // S5-01：旧体积参考列已移除（不是设计判据，也不再作为用户需要处理的提示）。
        out.push(`<table><tr><th>热结</th><th>设计模数 Mc</th><th>Mc 来源</th><th>冒口尺寸</th><th>目标模数 Mr_target</th></tr>` +
          r.items.map(it => `<tr><td>H${it.hsId ?? '—'}</td><td>${fmt(it.Mc, 1)} mm</td><td>${mcSrcText(it.mcSrc) || '—'}</td><td>${dimOf(it)}</td><td>${fmt(it.Mr_target != null ? it.Mr_target : it.Mr_need, 2)} mm</td></tr>`).join('') +
          `</table>`);
        // PHASE V2.0-15（126.txt §三）：多热结路径**逐个热结**给出未收敛警告 ——
        //   上表是汇总，某个热结未收敛时那一行只是"体积校核：不足"，读者无法区分
        //   「体积不足但尺寸是收敛解」与「迭代根本没收敛」。此处按热结点名，避免遗漏。
        for (const it of r.items) {
          const wt = fillWarning(riserWarning(it));
          if (wt) out.push(`<div class="warn">热结 H${it.hsId ?? '—'}：${wt}</div>`);
        }
      }
      /* S5-02：Mc 估计值说明放在冒口结果最下方，普通说明文字，不用警告样式。 */
      const mcItems = (r.items && r.items.length) ? r.items : [r];
      const hasAutoMc = mcItems.some(it => it.mcSrc !== proj.SRC.USER_OVERRIDE && it.mcSrc !== proj.SRC.USER_INPUT);
      if (hasAutoMc) out.push(`<div class="meta">Mc 为基于 STL 几何计算的估计值，实际热节情况仍需结合铸件结构和工艺经验复核。</div>`);
      if (r.note) out.push(`<div class="meta">${esc(r.note)}</div>`);
    }
  } else if (id === 'yield' && r) {
    /* R6-S3（153.txt §四）/ S4（155.txt §2.2）：原报告写「铸件重量 = r.castWt（单件）」
       再除以「r.pourWt（整模 G）」，型腔数 > 1 时出品率被除以型腔数；`r.runnerWt` 还包含冒口。
       S4 在核心**新增**整模字段（旧字段语义未改），报告优先消费新字段并列整模账目；
       仍不把任何“铸件 ÷ G”百分比当作实称最终出品率。 */
    const g = allResults?.gating || null;
    /* S4：没有浇注系统结果时，单件 pourWt 不能与整模 castingMass 拼成一张账。
       整模账目明确标为不可核对，不把单件/整模混算。 */
    if (!g || !(g.G > 0)) {
      out.push(`<table>
        ${stat('单件毛坯重', fmt(r.castWt, 2) + ' kg')}
        ${stat('浇注重量 G', '缺少浇注系统结果，整模账目不可核对')}
      </table>
      <div class="meta">⚠️ 本模块没有可用的浇注系统结果：不得用“单件 ÷ 单件估算”反推整模出品率，也不得把单件字段乘型腔数后当作整模账目。</div>`);
    } else {
      const ledger = buildYieldLedger({
        cav: g.cav ?? (proj.getV('production.cavities') || 1),
        blankWt: g.pw ?? r.castWt,
        pourWt: g.G,
        riserWt: r.riserUnit ?? r.riserWt,
        castingMass: r.castingMass,
        riserWtTotal: r.riserWtTotal,
        gatingWtResidual: r.gatingWtResidual,
        designYield: (g.ya != null ? g.ya : (g.yv ?? r.designYield ?? null)),
      });
      out.push(`<table>
        ${stat('单件毛坯重', fmt(ledger.blankWt, 2) + ' kg')}
        ${stat('整模铸件毛坯重', fmt(ledger.blankTotal, 2) + ' kg（× ' + ledger.cav + ' 腔）')}
        ${stat('浇注重量 G', fmt(ledger.pourWt, 2) + ' kg')}
        ${stat('设计预估出品率（用于反算 G）', (ledger.designYield != null ? fmt(ledger.designYield, 1) : '—') + '%')}
        ${stat('铸件占 G（恒等反算，不是实重统计）', ledger.productShare != null ? fmt(ledger.productShare, 1) + '%' : '—')}
        ${stat('参考区间', (r.range || []).join('~') + '%')}
        ${stat('单套冒口重（现有输出）', ledger.riserUnit != null ? fmt(ledger.riserUnit, 2) + ' kg' : '—')}
        ${stat('整模冒口重（假设每腔一套）', ledger.riserTotal != null ? fmt(ledger.riserTotal, 2) + ' kg' : '—')}
        ${stat('浇道重（反推残差，假设每腔一套冒口）', ledger.gatingEst != null ? fmt(ledger.gatingEst, 2) + ' kg' : '—')}
      </table>
      <div class="meta">口径说明：整模铸件/冒口重优先取核心新增整模字段；G 由预估出品率反推，
        浇道重是“G − 整模铸件 − 整模冒口”的反推残差，不是实测浇道重量。本表是设计口径的重量分解，不是实称产出。
        当前为工艺预估值；获得实际出品率后，可手动输入并回算相关参数（独立「出品率与铁水重量」计算器）。</div>`);
    }
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

  ${statusSection(extra)}

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

  <div class="sec"><h2>3.5 铸件结构性检查</h2>${page1ReportHtml()}</div>

  <div class="sec"><h2>4. 输入参数（含来源）</h2>${paramsTable([
    ['geometry.volumeCm3', '体积', 'cm³'], ['geometry.blankWeightKg', '毛坯重量', 'kg'], ['geometry.netWeightKg', '净重', 'kg'],
    ['geometry.wallMax', '最大壁厚', 'mm'], ['geometry.wallAvg', '平均壁厚', 'mm'],
    ['process.wallUsed', '主体壁厚', 'mm'],
    ['material.family', '材料'], ['material.liquidDensity', '液态密度', 'g/cm³'], ['material.solidDensity', '固态密度', 'g/cm³'],
    ['production.cavities', '一模件数', '件'], ['material.yieldSug', '预估出品率（设计口径）', '%'],
    ['production.line', '造型线'], ['production.method', '铸造方法'],
    ['process.pourPos', '浇注方向'],
    ['process.Ho', '内浇道至上箱面', 'mm'], ['process.ph', '铸件高度', 'mm'],
    ['process.riserHeight', 'RH（冒口顶面高出铸件顶面）', 'mm'],
    ['process.riserShape', '冒口形状'],
    ['process.ratioKey', '浇注系统比例'],
    ['process.gateThk', '内浇道厚度', 'mm'], ['production.ingateN', '内浇道个数', '个'],
    ['process.runnerThk', '横浇道厚度', 'mm'], ['production.runnerN', '横浇道条数', '条'],
    ['process.ventD', '排气孔直径', 'mm'],
  ])}</div>

  <div class="sec"><h2>5. 工艺计算结果（已选择模块）</h2>
    ${doneIds.length ? doneIds.map(id => {
      const c = m.find(x => x.id === id);
      return `<h3 style="margin:14px 0 4px">${c?.icon || ''} ${c?.name || id}</h3>${moduleResultHtml(id, results[id], results)}`;
    }).join('') : '<p class="meta">未执行任何计算模块。</p>'}
  </div>

  <div class="sec"><h2>6. WARNING / 数据可靠性</h2>
    ${riskSection(results)}
    ${warns.length ? warns.map(w => `<div class="warn">⚠️ ${esc(w)}</div>`).join('') : '<p class="meta">无模块警告。</p>'}
    ${extra.sampling?.warning ? '' : '<p class="meta">采样分辨率正常。</p>'}
    ${results?.gating ? `<p class="meta">出品率口径：主界面与报告只展示设计预估出品率和设计口径的重量分解，不把推算值称为实际出品率。实际出品率请用本厂实绩在独立「出品率与铁水重量」计算器中手动输入并回算。</p>` : ''}
  </div>

  <div class="sec"><h2>7. 版本信息</h2>
  <table>
    <tr><td>热结引擎</td><td>Hotspot Engine V3（Local V/A + Adaptive Sampling）</td></tr>
    <tr><td>计算核心</td><td>calcs/ 单一核心（与独立计算器一致）</td></tr>
    <tr><td>参数来源</td><td>🟢 STL 自动 / 🔵 计算得到 / 🟡 用户输入 / 🟠 用户修改</td></tr>
  </table></div>
</body></html>`;
}
