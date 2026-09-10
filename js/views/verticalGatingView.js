// ============================================================
// 垂直造型线小件浇注系统 · 视图（V1.3，用户评审第 4 轮）
//   ① 引入方式恢复三选【顶入/中入/底入】且全型一致；中入需 B；
//   ② 浇注时间"怎么定"二选一：以设备为主（填型/h）/ 以产品为主（自动按
//      浇注不满标准）——两者不再同时让用户填；
//   ③ C（产品+冒口总高）/B（口→最高点）全局单值，显眼独立行放置；
//   ④ 界面减法：材料提升到主输入、hint 精简、分层表 A→H 直填直看；
//   ⑤ 位置标注图三张（顶入 A / 中入 A+B / 底入 A+C），经典风格；
// ============================================================
import {
  runVerticalGating, VG_SYSTEMS, VG_MATERIALS, M_RUNNER,
  YIELD_DEFAULT, recommendIngateS, headFromPosition, gateLossMFromRatio, expIngateM,
} from '../../calcs/verticalGating.js';
import { renderNextSteps } from './nextSteps.js';
import { verticalDiagramSvg } from './verticalDiagram.js';
import { checkNum, firstErr, parseNum } from './numcheck.js';

const SYS = VG_SYSTEMS;
const fmt = (v, d) => (typeof v === 'number' && !isNaN(v) ? parseFloat(v.toFixed(d)).toString() : String(v));
const row = (label, value, unit, cls = '', note = '') =>
  `<div class="rrow ${cls}"><span class="rl">${label}</span><span class="rv">${value}${unit ? `<span class="ru">${unit}</span>` : ''}${note ? `<span class="rf">${note}</span>` : ''}</span></div>`;

const SYS_UI = Object.fromEntries(Object.entries(SYS).filter(([k]) => k !== 'nonpressurized'));
const POS_OPT = [
  { v: 'top', name: '顶入' }, { v: 'side', name: '中入' }, { v: 'bottom', name: '底入' },
];
const POS_H = { top: 'H = A', side: 'H = A − B/2', bottom: 'H = A − C/2' };
const POS_TXT = {
  top: '顶入：内浇口在铸件（含冒口）顶部进入 → 只需填 A',
  side: '中入：内浇口在铸件侧面中部进入 → 填 A 和 B（B=入水口到产品+冒口最高点）',
  bottom: '底入：内浇口在铸件底部进入，自下而上充型 → 填 A 和 C（C=产品+冒口总高）',
};

// ═══════════ 位置标注图（经典 gatingDiagram 风格，三张）═══════════
function gDefs(mid) {
  return `<defs><marker id="${mid}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
    <path d="M0,0 L10,5 L0,10 z" fill="#0f172a"/></marker></defs>
    <style>.cap{font-size:10px;fill:#475569;stroke:#ffffff;stroke-width:2.5;paint-order:stroke}.lab{font-size:11px;font-weight:700}</style>`;
}
function dDim(x, y1, y2, label, mid, tx) {
  return `<line x1="${x - 5}" y1="${y1}" x2="${x + 5}" y2="${y1}" stroke="#64748b" stroke-width="1"/>
  <line x1="${x - 5}" y1="${y2}" x2="${x + 5}" y2="${y2}" stroke="#64748b" stroke-width="1"/>
  <line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="#0f172a" stroke-width="1.2" marker-start="url(#${mid})" marker-end="url(#${mid})"/>
  <text x="${tx ?? x - 8}" y="${(y1 + y2) / 2 + 4}" font-size="13" font-weight="700" fill="#c92a2a" text-anchor="end">${label}</text>`;
}
const guideTop = () => `<svg viewBox="0 0 620 350" width="100%" style="background:#fafafa;border:1px solid #e2e8f0;border-radius:8px" role="img" aria-label="顶入标注图">
  ${gDefs('gvT')}
  <line x1="70" y1="40" x2="360" y2="40" stroke="#0f766e" stroke-width="1.6"/><text x="76" y="34" class="lab" fill="#0f766e">浇口杯液面</text>
  <polygon points="150,14 190,14 182,40 158,40" fill="#ffe8cc" stroke="#e8590c" stroke-width="1.2"/><text x="146" y="27" class="cap" text-anchor="end">浇口杯</text>
  <polygon points="158,40 182,40 176,176 164,176" fill="#ffd8a8" stroke="#e8590c" stroke-width="1.2"/><text x="198" y="100" class="cap">直浇道</text>
  <rect x="176" y="146" width="78" height="8" fill="#ffd43b" stroke="#e67700" stroke-width="1"/><text x="184" y="172" class="cap">内浇口（顶部进入）</text>
  <rect x="254" y="146" width="120" height="120" fill="#ced4da" stroke="#495057" stroke-width="1.4"/><text x="292" y="212" class="cap" font-size="12">铸件</text>
  ${dDim(400, 40, 150, 'A', 'gvT')}<text x="392" y="62" font-size="9" fill="#475569" text-anchor="end">A = 浇口杯液面 → 内浇口</text>
  <text x="70" y="292" font-size="14" font-weight="700" fill="#0b7285">H = A</text>
  <text x="70" y="314" font-size="10" fill="#495057">顶入：口在铸件（含冒口）顶部进入，全程自由表面不变 → 平均有效静压头 H = A</text>
  <text x="70" y="334" font-size="9" fill="#94a3b8">依据：DISA 230 手册 6.9.2.3（p6.65）</text></svg>`;
const guideSide = () => `<svg viewBox="0 0 620 400" width="100%" style="background:#fafafa;border:1px solid #e2e8f0;border-radius:8px" role="img" aria-label="中入标注图">
  ${gDefs('gvS')}
  <line x1="70" y1="40" x2="360" y2="40" stroke="#0f766e" stroke-width="1.6"/><text x="76" y="34" class="lab" fill="#0f766e">浇口杯液面</text>
  <polygon points="150,14 190,14 182,40 158,40" fill="#ffe8cc" stroke="#e8590c" stroke-width="1.2"/><text x="146" y="27" class="cap" text-anchor="end">浇口杯</text>
  <polygon points="158,40 182,40 176,212 164,212" fill="#ffd8a8" stroke="#e8590c" stroke-width="1.2"/><text x="198" y="120" class="cap">直浇道</text>
  <rect x="268" y="126" width="92" height="34" fill="#ffe066" stroke="#e67700" stroke-width="1"/><text x="292" y="148" class="cap">冒口</text>
  <rect x="254" y="160" width="120" height="100" fill="#ced4da" stroke="#495057" stroke-width="1.4"/><text x="292" y="216" class="cap" font-size="12">铸件</text>
  <rect x="176" y="206" width="82" height="8" fill="#ffd43b" stroke="#e67700" stroke-width="1"/><text x="180" y="232" class="cap">内浇口（侧面中部进入）</text>
  ${dDim(406, 40, 210, 'A', 'gvS', 398)}<text x="392" y="120" font-size="9" fill="#475569" text-anchor="end">A = 液面 → 内浇口</text>
  ${dDim(452, 210, 126, 'B', 'gvS', 444)}<text x="438" y="172" font-size="9" fill="#475569" text-anchor="end">B = 入水口 → 产品+冒口最高点</text>
  <text x="70" y="330" font-size="14" font-weight="700" fill="#0b7285">H = A − B/2</text>
  <text x="70" y="352" font-size="10" fill="#495057">中入：金属先顶注到口位、后自下而上充满口以上高度 B 的部分 → 平均 H = A − B/2</text>
  <text x="70" y="372" font-size="9" fill="#94a3b8">依据：DISA 230 手册 6.9.2.3 公式 4（p6.67）</text></svg>`;
const guideBottom = () => `<svg viewBox="0 0 620 400" width="100%" style="background:#fafafa;border:1px solid #e2e8f0;border-radius:8px" role="img" aria-label="底入标注图">
  ${gDefs('gvB')}
  <line x1="70" y1="40" x2="360" y2="40" stroke="#0f766e" stroke-width="1.6"/><text x="76" y="34" class="lab" fill="#0f766e">浇口杯液面</text>
  <polygon points="150,14 190,14 182,40 158,40" fill="#ffe8cc" stroke="#e8590c" stroke-width="1.2"/><text x="146" y="27" class="cap" text-anchor="end">浇口杯</text>
  <polygon points="158,40 182,40 176,262 164,262" fill="#ffd8a8" stroke="#e8590c" stroke-width="1.2"/><text x="198" y="150" class="cap">直浇道</text>
  <rect x="268" y="128" width="92" height="34" fill="#ffe066" stroke="#e67700" stroke-width="1"/><text x="292" y="150" class="cap">冒口</text>
  <rect x="254" y="162" width="120" height="100" fill="#ced4da" stroke="#495057" stroke-width="1.4"/><text x="292" y="218" class="cap" font-size="12">铸件</text>
  <rect x="176" y="256" width="82" height="8" fill="#ffd43b" stroke="#e67700" stroke-width="1"/><text x="182" y="282" class="cap">内浇口（底部进入）</text>
  ${dDim(406, 262, 128, 'C', 'gvB', 398)}<text x="392" y="202" font-size="9" fill="#475569" text-anchor="end">C = 产品+冒口总高</text>
  ${dDim(452, 40, 260, 'A', 'gvB', 444)}<text x="440" y="150" font-size="9" fill="#475569" text-anchor="end">A = 液面 → 内浇口</text>
  <text x="70" y="330" font-size="14" font-weight="700" fill="#0b7285">H = A − C/2</text>
  <text x="70" y="352" font-size="10" fill="#495057">底入：开始口处静压 A，充满高度 C 后降至 A−C → 平均 H = A − C/2</text>
  <text x="70" y="372" font-size="9" fill="#94a3b8">依据：DISA 230 手册 6.9.2.3 公式 3（p6.65）</text></svg>`;
const guideSvg = (mode) => (mode === 'side' ? guideSide() : mode === 'bottom' ? guideBottom() : guideTop());

const DEF_LAYERS = [{ a: 135 }, { a: 260 }, { a: 385 }];
const DEF_CB = 100; // 全局 C/B 示例值

const layerRowHtml = (A, idx, canDel) => `
  <div class="rrow" style="border-bottom:1px dashed #e2e8f0;align-items:center">
    <span class="rl" style="min-width:64px">层 ${idx + 1}${idx === 0 ? '（上）' : '（下）'}</span>
    <span class="rv" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
      <span class="ru" style="margin-right:0">A =</span>
      <input class="field-input" type="number" step="1" min="1" style="width:88px;padding:2px 4px" data-la value="${A}">
      <span class="ru">mm</span>
      <span class="field-hint" data-hs style="display:inline-block;min-width:150px;color:#0f766e"></span>
      ${canDel ? `<button class="btn btn-ghost" data-del style="padding:1px 7px;font-size:.72rem">✕</button>` : ''}
    </span>
  </div>`;

export function renderVerticalGating(container, calc) {
  container.innerHTML = `
    <div class="page-head" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
      <div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          <button class="btn btn-ghost" data-back>← 返回</button>
          <span class="tool-icon" style="width:36px;height:36px;font-size:1.05rem">${calc.icon}</span>
          <h1 class="page-title" style="font-size:1.2rem">${calc.name}</h1>
        </div>
        <p class="page-sub">${calc.desc}</p>
      </div>
      <span class="badge-status badge-ready">✓ 可用</span>
    </div>

    <div class="calc-single">
      <div class="calc-col">
        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">1</span>📋 输入</div>

          <div class="field-grid2" style="margin-bottom:10px">
            <div class="field"><label class="field-label">🧱 浇注系统</label>
              <div class="f-row"><select class="field-select" id="vg_sys">
                ${Object.entries(SYS_UI).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}
              </select></div>
              <div class="field-hint" id="vg_sysHint" style="margin-top:2px"></div>
            </div>
            <div class="field"><label class="field-label">🔩 材料</label>
              <div class="f-row"><select class="field-select" id="vg_mat">
                ${Object.entries(VG_MATERIALS).map(([k, v]) => `<option value="${k}">${k}</option>`).join('')}
              </select></div>
              <div class="field-hint" style="margin-top:2px" id="vg_matHint"></div>
            </div>
          </div>
          <div class="field-grid2" style="margin-bottom:10px">
            <div class="field"><label class="field-label">⚖️ 单件铸件重量</label>
              <div class="f-row"><input class="field-input" type="number" id="vg_gc" value="0.7" step="0.1" min="0"><span class="f-unit">kg</span></div>
              <div class="field-hint" style="margin-top:2px">按该浇口实际要浇的单件金属重量填写——如果还带着冒口一起浇，请把冒口重量也算进去</div>
            </div>
            <div class="field"><label class="field-label">📐 最薄壁厚</label>
              <div class="f-row"><input class="field-input" type="number" id="vg_wall" value="20" step="1" min="0"><span class="f-unit">mm</span></div>
            </div>
          </div>

          <!-- ⏱️ 时间依据：二选一（设备 vs 产品） -->
          <div class="group-title" style="font-size:.92rem;margin-top:2px">⏱️ 浇注时间怎么定（选一种，工具自动推荐，仍可手动改）</div>
          <div class="field-grid2" style="margin-bottom:6px">
            <div class="field"><label class="field-label">依据</label>
              <div class="f-row"><select class="field-select" id="vg_tmode">
                <option value="device">以设备为主 —— 按造型节拍</option>
                <option value="product">以产品为主 —— 按铸件质量限制</option>
              </select></div>
              <div class="field-hint" id="vg_tmodeHint" style="margin-top:2px"></div>
            </div>
            <div class="field" id="vg_msField"><label class="field-label">🏭 造型速度</label>
              <div class="f-row"><input class="field-input" type="number" id="vg_moldspeed" value="480" step="10" min="0"><span class="f-unit">型/h</span></div>
              <div class="field-hint" style="margin-top:2px">每型可浇时间 = 3600÷型数 − 3s（输送+浇道填充）；这是推荐 t 的上限之一</div>
            </div>
          </div>
          <div class="field" style="margin-bottom:10px">
            <label class="field-label">推荐浇注时间 t <small>（自动算好，可直接改成你的值）</small></label>
            <div class="f-row"><input class="field-input" type="number" id="vg_t" step="0.1" min="0" placeholder="自动推荐"><span class="f-unit">s</span><button class="btn btn-ghost" id="vg_tReset" style="padding:2px 8px;font-size:.75rem">恢复推荐</button></div>
            <div class="field-hint" id="vg_tHint" style="margin-top:2px"></div>
          </div>

          <!-- 🎯 引入方式（全型一致）＋ 标注图 ＋ 分层表 -->
          <div class="group-title" style="font-size:.92rem">🎯 内浇口从哪进（全型各层相同）</div>
          <div class="field" style="margin:2px 0 6px">
            <div class="f-row"><select class="field-select" id="vg_pos" style="width:auto">
              ${POS_OPT.map((t) => `<option value="${t.v}">${t.name}</option>`).join('')}
            </select><span class="field-hint" id="vg_posHint" style="margin-left:8px"></span></div>
          </div>
          <div id="vg_guide" style="margin-bottom:10px"></div>

          <div class="group-title" style="font-size:.92rem">分层表（自上而下；A = 浇口杯液面 → 内浇口距离）</div>
          <div class="results" id="vg_layers" style="margin-bottom:4px"></div>
          <div style="display:flex;gap:10px;align-items:center;margin:4px 0 10px;flex-wrap:wrap">
            <button class="btn btn-ghost" id="vg_layerAdd" style="padding:3px 10px;font-size:.78rem">＋ 加一层</button>
            <span class="field-hint">≤ 8 层；每层默认 2 件（对称两侧）</span>
          </div>

          <!-- C / B 显眼输入（bottom→C；side→B；top 无） -->
          <div id="vg_cbWrap" style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;padding:8px 12px;margin-bottom:10px">
            <label class="field-label" id="vg_cbLabel" style="font-size:.95rem"></label>
            <div class="f-row" style="margin-top:4px"><input class="field-input" type="number" id="vg_cb" step="1" min="1" style="width:130px;font-weight:700" value="${DEF_CB}"><span class="f-unit" style="font-weight:600">mm</span><span class="field-hint" id="vg_cbNote" style="margin-left:10px"></span></div>
          </div>

          <div class="field" style="margin-bottom:8px">
            <label class="field-label">📏 内浇口厚度 s <small>（自动推荐可改）</small></label>
            <div class="f-row"><input class="field-input" type="number" id="vg_s" step="0.5" min="1" placeholder="自动推荐"><span class="f-unit">mm</span><button class="btn btn-ghost" id="vg_sReset" style="padding:2px 8px;font-size:.75rem">恢复推荐</button></div>
            <div class="field-hint" id="vg_sHint" style="margin-top:2px"></div>
          </div>

          <details style="margin-top:4px" id="vg_sPerWrap">
            <summary style="cursor:pointer;font-size:.82rem;color:#475569;padding:2px 0;user-select:none">⌄ 分层调整内浇口厚度（可选 —— 默认全部跟随上方统一值）</summary>
            <div class="field-hint" id="vg_sPerNote" style="padding:4px 2px"></div>
            <div class="results" id="vg_sPer" style="margin-top:2px"></div>
          </details>

          <details style="margin-top:6px">
            <summary style="cursor:pointer;font-size:.82rem;color:#475569;padding:2px 0;user-select:none">⌄ 高级（产出率/损失因数 m）</summary>
            <div class="field-grid2" style="margin-top:6px">
              <div class="field"><label class="field-label">💰 产出率（铁水总重 = 铸件总重 ÷ 产出率）</label>
                <div class="f-row"><input class="field-input" type="number" id="vg_yield" value="${YIELD_DEFAULT * 100}" step="1" min="1" max="99" style="width:120px"><span class="f-unit">%</span></div>
              </div>
              <div class="field"><label class="field-label">内浇口损失因数 m <small>（留空 = 自动）</small></label>
                <div class="f-row"><input class="field-input" type="number" id="vg_mi" step="0.05" min="0.05" max="1" style="width:90px" placeholder="自动"><span class="f-unit" id="vg_miMeta"></span></div>
                <div class="field-hint">留空=按【最薄壁厚→国外现场工程经验区间】取下限（m 小→面积大=安全侧，标记 V1 策略）；DISA 图 6.38（口形状比 0.3/0.5/0.6）为另一来源参考，见 U3</div></div>
              <div class="field"><label class="field-label">流道损失因数 m（宽流道，手册 0.7）</label>
                <div class="f-row"><input class="field-input" type="number" id="vg_mr" value="${M_RUNNER}" step="0.05" min="0.05" max="1" style="width:90px"></div></div>
            </div>
          </details>
        </div>

        <!-- ── 结果 ── -->
        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">2</span>📊 计算结果</div>
          <div class="results" id="vg_head"></div>
          <div class="group-title" style="margin-top:14px">分层明细</div>
          <div class="results" id="vg_gates"></div>
          <div class="group-title" style="margin-top:14px">📐 布置与截面积（示意等距，数值为真值）</div>
          <div id="vg_diagram"></div>
          <div class="group-title" id="vg_runTitle" style="margin-top:14px"></div>
          <div class="results" id="vg_runners"></div>
          <div class="group-title" id="vg_horizTitle" style="margin-top:14px"></div>
          <div class="results" id="vg_horiz"></div>
          <div class="group-title" style="margin-top:14px">铁水总重（配料参考）</div>
          <div class="results" id="vg_cup"></div>
        </div>

        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">3</span>📖 说明</div>
          <div class="field-hint" style="line-height:1.8">
            · 方法：DISA 230 应用手册 §6.8~6.12 数字化（非自行设计）；适用于垂直造型线小件，非 DISA 设备专用。<br>
            · 加压/混合 = 各层按自身静压头 H 单独算口面积；减压 = 各层同尺寸口（同时浇注，手册明示）。<br>
            · 引入：顶入 H=A；中入 H=A−B/2；底入 H=A−C/2。不加压式已移除（手册评价最差）。<br>
            · 球铁 k 同灰铁（用户裁决）；限速 600mm/s 手册值。与"浇注系统设计"计算器为两套独立方法，勿混拼。<br>
            · 未决项（手册矛盾处）见结果页 UNRESOLVED 清单。
          </div>
        </div>
      </div>
    </div>
  `;

  container.querySelector('[data-back]').addEventListener('click', () => { location.hash = '#/calculators'; });
  const q = (id) => container.querySelector(id);
  let layers = DEF_LAYERS.map((x) => ({ ...x }));
  const layerBox = () => q('#vg_layers');
  const modeVal = () => q('#vg_pos').value;
  const modeBottom = () => modeVal() === 'bottom';
  const modeSide = () => modeVal() === 'side';

  const cbVal = () => Number(q('#vg_cb').value);
  const layerH = (A) => {
    if (modeBottom()) return headFromPosition('bottom', A, cbVal());
    if (modeSide()) return headFromPosition('side', A, cbVal());
    return headFromPosition('top', A, 0);
  };

  const renderGuide = () => {
    const pos = modeVal();
    q('#vg_guide').innerHTML = guideSvg(pos);
    q('#vg_posHint').textContent = POS_H[pos] + '；' + (pos === 'top' ? '无需 C/B' : pos === 'bottom' ? '需填下面 C（全型一个值）' : '需填下面 B（全型一个值）');
    // C/B 显眼行
    const wrap = q('#vg_cbWrap');
    if (pos === 'top') { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    q('#vg_cbLabel').textContent = pos === 'bottom' ? '🅲 C = 产品 + 冒口总高（mm）——全型共用一个值' : '🅱 B = 入水口到产品+冒口最高点（mm）——全型共用一个值';
    q('#vg_cbNote').textContent = pos === 'bottom' ? '无冒口时填产品高度；H = A − C/2' : 'H = A − B/2';
    if (q('#vg_cb').dataset.v) q('#vg_cb').value = q('#vg_cb').dataset.v;
  };
  const updateHmarks = () => {
    const rows = Array.from(layerBox().querySelectorAll('.rrow'));
    rows.forEach((r0, idx) => {
      const hs = r0.querySelector('[data-hs]');
      if (!hs) return;
      const A = Number(layers[idx].a);
      if (!(A > 0)) { hs.textContent = ''; return; }
      const h = layerH(A);
      const tag = modeBottom() ? '（A−C/2）' : modeSide() ? '（A−B/2）' : '';
      hs.textContent = Number.isFinite(h) && h > 0 ? `→ H = ${fmt(h, 0)} mm${tag}` : '⚠️ 需 A > C/2（或 B/2）';
    });
  };
  const renderLayers = () => {
    layerBox().innerHTML = layers.map((L, i) => layerRowHtml(L.a, i, layers.length > 1)).join('');
    Array.from(layerBox().querySelectorAll('.rrow')).forEach((r0, idx) => {
      const st = layers[idx];
      r0.querySelector('[data-la]').addEventListener('input', (e) => { st.a = e.target.value === '' ? '' : Number(e.target.value); debounced(); });
      const del = r0.querySelector('[data-del]');
      if (del) del.addEventListener('click', () => { layers.splice(idx, 1); overrides.splice(idx, 1); renderLayers(); update(); });
    });
    q('#vg_layerAdd').style.display = layers.length >= 8 ? 'none' : '';
    updateHmarks();
  };

  const sysMeta = () => {
    const sys = q('#vg_sys').value;
    q('#vg_sysHint').textContent = `${SYS[sys].name}：${SYS[sys].desc}`;
    q('#vg_runTitle').textContent = sys === 'decompressed' || sys === 'mixed' ? '垂直流道（自下而上逐段）' : '垂直流道（1 段）';
    q('#vg_horizTitle').textContent = (sys === 'decompressed' || sys === 'mixed') ? '层横浇道（每层两侧，限速 1 m/s）' : '';
  };
  const matMeta = () => {
    const m = VG_MATERIALS[q('#vg_mat').value];
    q('#vg_matHint').textContent = m ? `k=${m.k} · 口速上限 ${m.vGateMax} mm/s` : '';
  };

  const update = () => {
    sysMeta();
    matMeta();
    const pos = modeVal();
    renderGuide();
    updateHmarks();
    syncOverridesLen();
    renderSPer();
    // 时间依据
    const tmode = q('#vg_tmode').value;
    const wallRaw = q('#vg_wall').value;
    const wallNum = parseNum(wallRaw);
    q('#vg_msField').style.display = tmode === 'device' ? '' : 'none';
    q('#vg_tmodeHint').textContent = tmode === 'device'
      ? '先保证设备节拍：t ≤ 3600÷型数 − 3s；再与产品限制取小 → 推荐 t'
      : '只按铸件考虑：t = B×√重量（B 按最薄壁厚查表），防止浇不足/冷隔 → 推荐 t';
    const sRaw = String(q('#vg_s').value).trim();
    const sRec = wallNum > 0 ? recommendIngateS(wallNum) : null;
    if (sRec != null && sRaw === '') q('#vg_s').placeholder = `自动推荐 ${sRec} mm`;
    const sUsed = sRaw !== '' && Number.isFinite(Number(sRaw)) ? Number(sRaw) : sRec;
    q('#vg_sHint').textContent = sRec != null
      ? `工程化推荐（手册只给范围 s=模数 25~100%，6.10.12；本工具按板盘近似 模数≈壁厚/3 → s≈壁厚×15%，壁厚20→3mm 同手册例）${sRaw === '' ? '；可直接改或用"恢复推荐"' : `；已用你输入 ${fmt(Number(sRaw), 1)}mm`}`
      : '';
    const tRaw = String(q('#vg_t').value).trim();
    const needCB = pos === 'bottom' || pos === 'side';
    const cbRaw = q('#vg_cb').value;
    // M 自动依据提示（壁厚 → 工程经验区间下限）
    {
      const eM = wallNum > 0 ? expIngateM(wallNum) : null;
      const miRaw2 = String(q('#vg_mi').value).trim();
      q('#vg_miMeta').textContent = miRaw2 === '' && eM
        ? `→ 自动 ${fmt(eM.lo, 2)}${eM.over12 ? '（>12mm 经验表外 U8）' : ''}`
        : '';
    }

    const err = firstErr([
      checkNum(q('#vg_gc').value, { label: '单件铸件重量', gt: 0, required: true }),
      checkNum(wallRaw, { label: '最薄壁厚', gt: 0, required: true }),
      checkNum(q('#vg_yield').value, { label: '产出率', gt: 0, max: 99, required: true }),
      ...(String(q('#vg_mi').value).trim() !== '' ? [checkNum(q('#vg_mi').value, { label: '内浇口 m', gt: 0, max: 1 })] : []),
      checkNum(q('#vg_mr').value, { label: '流道 m', gt: 0, max: 1, required: true }),
      ...(tmode === 'device' ? [checkNum(q('#vg_moldspeed').value, { label: '造型速度', min: 0, required: true })] : []),
      ...(needCB ? [checkNum(cbRaw, { label: pos === 'bottom' ? 'C（产品+冒口总高）' : 'B（口→最高点）', gt: 0, required: true })] : []),
      ...(sRaw !== '' ? [checkNum(sRaw, { label: '内浇口厚度', gt: 0, max: 200 })] : []),
      ...layers.flatMap((L, i) => [checkNum(String(L.a), { label: `层${i + 1} A（液面→口）`, gt: 0, required: true })]),
      ...(tRaw !== '' ? [checkNum(tRaw, { label: '浇注时间', gt: 0, required: true })] : []),
    ]);
    const head = q('#vg_head'), gates = q('#vg_gates'), runners = q('#vg_runners'), cup = q('#vg_cup');
    const blank = (msg) => {
      head.innerHTML = `<div class="empty" style="padding:16px"><span class="empty-sub">⚠️ ${msg}</span></div>`;
      gates.innerHTML = runners.innerHTML = cup.innerHTML = ''; q('#vg_diagram').innerHTML = '';
    };
    if (err) { blank(err); return; }
    const Harr = layers.map((L) => layerH(Number(L.a)));
    if (Harr.some((h) => !Number.isFinite(h) || h <= 0)) { blank('某层几何不成立：需 A > C/2（或 B/2）'); return; }
    const moldSpeed = tmode === 'device' ? parseNum(q('#vg_moldspeed').value) : undefined;
    const r = runVerticalGating({
      mat: q('#vg_mat').value,
      system: q('#vg_sys').value,
      Gc: parseNum(q('#vg_gc').value),
      wallMm: wallNum,
      moldSpeed,
      H: Harr,
      n: layers.map(() => 2),
      t: tRaw !== '' ? parseNum(tRaw) : undefined,
      sIngate: sUsed,
      mIngate: String(q('#vg_mi').value).trim() !== '' ? parseNum(q('#vg_mi').value) : undefined,
      mRunner: parseNum(q('#vg_mr').value),
      yieldRate: parseNum(q('#vg_yield').value) / 100,
      sPerLayer: overrides.some((v) => v != null)
        ? layers.map((_, i) => (overrides[i] != null ? overrides[i] : sUsed))
        : undefined,
    });
    if (!r.ok) { blank(r.error || '无法计算'); return; }
    refreshSPer(r);

    q('#vg_diagram').innerHTML = verticalDiagramSvg({
      res: r, layers, mode: pos, C: modeBottom() ? cbVal() : 0, B: modeSide() ? cbVal() : 0,
    });
    if (r.tSource === 'auto') {
      q('#vg_t').value = '';
      q('#vg_t').placeholder = `自动推荐 ${r.t} s`;
      q('#vg_tHint').innerHTML = (r.tRec.note || []).map((x) => `· ${x}`).join('<br>');
    } else {
      q('#vg_tHint').innerHTML = `已用你给的 t=${r.t}s（推荐过程：${(r.tRec.note || []).join('；')}）`;
    }

    const modeName = POS_OPT.find((t) => t.v === pos).name;
    // ── 最终推荐优先（Step5）：第一眼 = 浇注时间 + 每层内浇口怎么做 ──
    const gateRows = r.gates.length && r.gates[0].sameForAllLevels
      ? [{ level: '各层', g: r.gates[0] }]
      : r.gates.map((g) => ({ level: `层${g.level}`, g }));
    const recRows = gateRows.map(({ level, g }) => row(
      `✅ ${level} 内浇口（单口）`,
      `${fmt(g.Fsingle, 1)} mm² → 推荐 ${g.dims.s} × ${g.dims.l} mm`,
      '', 'ok', `H=${fmt(g.H, 0)}mm；实际 ${fmt(g.dims.area, 0)}mm²${g.sameForAllLevels ? '（各层同尺寸）' : ''}`,
    )).join('');
    head.innerHTML = `
      ${row('✅ 浇注时间 t（推荐）', fmt(r.t, 1), 's', 'ok',
        `进型腔；t0=t+1.5=${fmt(r.t0, 1)}s${r.tSource === 'auto' ? '；依据=' + (q('#vg_tmode').value === 'device' ? '以设备为主' : '以产品为主') : ''}。两标准取小（循环/不浇满）为 V1 安全侧处理——手册例为人工取整留余量，未明文强制取小`)}
      ${recRows}
      ${row('🧱 系统 · 🎯 引入', `${SYS[r.system].name} · ${modeName}`, '', '',
        `节流：${r.summary.choke}；${pos === 'top' ? 'H=A' : pos === 'bottom' ? `H=A−C/2（C=${fmt(cbVal(), 0)}）` : `H=A−B/2（B=${fmt(cbVal(), 0)}）`}`)}
      ${r.basis.warnings.map((w) => { const i = w.indexOf('：'); return row('⚠️ ' + w.slice(0, i), w.slice(i + 1), '', 'warn', '系统固有取舍（手册表 3）'); }).join('')}
      <details style="margin-top:6px"><summary style="cursor:pointer;font-size:.82rem;color:#475569;padding:4px 0;user-select:none">⌄ 计算过程（M / k / G / t / H 均可查）</summary>
        <div class="results" style="margin-top:4px">
          ${row('M 内浇口损失系数', `${fmt(r.mInfo.used, 2)}`, '', '',
            `${r.mInfo.srcLabel}${r.mInfo.exp ? `；工程经验范围 ${r.mInfo.exp.lo.toFixed(2)}~${r.mInfo.exp.hi.toFixed(2)}` : ''}${r.mInfo.exp && r.mInfo.exp.over12 ? '；壁厚 >12mm 经验表外，保守沿用 0.52（U8）' : ''}${r.mInfo.src === 'exp-safe-low' ? '；取值=区间下限（V1 安全侧）' : ''}`)}
          ${r.process.map((p) => row('Step · ' + p, '', '', '', '')).join('')}
        </div></details>
    `;

    const sameAll = r.gates.length > 0 && r.gates[0].sameForAllLevels;
    const ratioRef = `主计算 M=${r.mInfo.used.toFixed(2)}（${r.mInfo.srcLabel}${r.mInfo.exp ? '，经验区间 ' + r.mInfo.exp.lo.toFixed(2) + '~' + r.mInfo.exp.hi.toFixed(2) : ''}）。DISA 图 6.38（口形状比 ≤1.5→0.3 · ≤3→0.5 · &gt;3→0.6）为另一来源参考，见 U3。`;
    gates.innerHTML = `
      <div class="rrow" style="border-bottom:1px solid #cbd5e1">
        <span class="rl"><b>层</b></span>
        <span class="rv" style="display:flex;gap:14px;flex-wrap:wrap">
          <span style="min-width:58px"><b>H mm</b></span><span style="min-width:86px"><b>单口面积</b></span>
          <span style="min-width:104px"><b>内浇口 厚×长</b></span><span style="min-width:78px"><b>层总</b></span>
          <span style="min-width:112px"><b>口速</b></span>
        </span>
      </div>
      ${r.gates.map((g) => `<div class="rrow">
        <span class="rl">层 ${g.level}</span>
        <span class="rv" style="display:flex;gap:14px;flex-wrap:wrap">
          <span style="min-width:58px">${fmt(g.H, 0)}</span>
          <span style="min-width:86px">${fmt(g.Fsingle, 1)} mm²</span>
          <span style="min-width:104px"><b>${g.dims.s}×${g.dims.l}</b><span style="font-size:.72rem;color:#94a3b8">（${fmt(g.dims.area, 0)} mm²）</span></span>
          <span style="min-width:78px">${fmt(g.Flevel ?? g.Fsingle, 1)} mm²</span>
          <span style="min-width:112px">${g.sameForAllLevels ? '受控 ' + fmt(g.vMs, 2) : fmt(g.vMs, 2)} m/s</span>
        </span>
      </div>`).join('')}
      <div class="field-hint" style="padding:6px 4px 0">${sameAll ? '各层同尺寸（同时浇注，手册 6.11.4.6）；减压系统内浇口按手册布置于铸件底部。' : `各层按自身 H 独立计算（手册 6.11.3.1）；层总 = 2 件 × 单口。`} ${ratioRef}</div>
    `;

    runners.innerHTML = r.runnerSegs.map((sg) => row(
      `流道 ${sg.id}${sg.segNo != null ? `（段${sg.segNo}）` : ''}`,
      `需要 ${fmt(sg.req, 1)} → ${fmt(sg.Fstd, 1)} mm²（梯形 ${sg.dims}）`, '', 'ok',
      sg.note + (sg.H != null ? `；该处 H=${fmt(sg.H, 0)}mm` : ''),
    )).join('')
      + r.basis.recommendations.map((x) => `<div class="field-hint" style="padding:4px 4px 0;color:#b45309">🔧 ${x.text}</div>`).join('');
    q('#vg_horiz').innerHTML = r.horiz ? row('层横浇道（每层两侧，同尺寸）', `${fmt(r.horiz.F8std, 0)} mm²（梯形 ${r.horiz.F8dims}）`, '', '', r.horiz.basis) : '';

    cup.innerHTML = `
      ${row('🔢 每型铸件', `${r.cup.nTotalMold} 件`, '', '', `两面 × 每面 ${r.nTotalFace} 件`)}
      ${row('⚖️ 铸件总重 → 铁水总重', `${fmt(r.cup.GcastMold, 1)} → ${fmt(r.cup.GpourTotal, 1)}`, 'kg', '', `÷ 产出率 ${Math.round(r.yieldRate * 100)}%（高级可改）`)}
      <details style="margin-top:8px"><summary style="cursor:pointer;font-size:.82rem;color:#475569;padding:4px 0;user-select:none">⚠️ UNRESOLVED / 手册差异（${r.basis.unresolved.length} 项）</summary>
        <div class="field-hint" style="padding:6px 4px;line-height:1.8">${r.basis.unresolved.map((u) => `· <b>${u.id}</b> ${u.text}`).join('<br>')}</div></details>
      <details style="margin-top:4px"><summary style="cursor:pointer;font-size:.82rem;color:#475569;padding:4px 0;user-select:none">⌄ 计算依据（出处）</summary>
        <div class="field-hint" style="padding:6px 4px;line-height:1.8">${r.basis.formulas.map((f) => `· <b>${f.key}</b> ${f.desc} —— ${f.src}${f.note ? '（' + f.note + '）' : ''}`).join('<br>')}</div></details>
      <div class="field-hint" style="padding:8px 4px 0;font-size:.72rem;color:#94a3b8">依据：DISA 230 Application Manual（2003）§6.8~6.12；Calculation methodology based on the provided DISA technical/development manual. 结果为计算参考值，首次应用请以浇注试验复核。</div>
    `;
  };

  // ── Step4：分层厚度 override（null=跟随统一值）──
  let overrides = DEF_LAYERS.map(() => null);
  const syncOverridesLen = () => {
    while (overrides.length < layers.length) overrides.push(null);
    while (overrides.length > layers.length) overrides.pop();
  };
  const renderSPer = () => {
    const sys = q('#vg_sys').value;
    const pos = modeVal();
    const allow = sys === 'pressurized' || sys === 'mixed';
    const box = q('#vg_sPerWrap');
    if (!box) return;
    box.style.display = allow ? '' : 'none';
    if (!allow) return;
    const sUnifiedRaw = q('#vg_s').value;
    q('#vg_sPerNote').textContent = '本层厚度只影响该层 建议尺寸 与 形状比（图 6.38 资料列）；不影响计算截面积 F 与他层。主计算 M 由【铸件最小壁厚】的工程经验区间确定（见高级 m），不随本层厚度变化。改某层即单独调整，点 ↺ 恢复统一。';
    q('#vg_sPer').innerHTML = `
      <div class="rrow" style="border-bottom:1px solid #cbd5e1">
        <span class="rl"><b>层</b></span>
        <span class="rv" style="display:flex;gap:10px;flex-wrap:wrap">
          <span style="min-width:56px"><b>H mm</b></span><span style="min-width:92px"><b>本层厚度 s</b></span>
          <span style="min-width:70px"><b>形状比</b></span><span style="min-width:92px"><b>图6.38 m 参考</b></span>
          <span style="min-width:84px"><b>单口面积</b></span><span style="min-width:96px"><b>建议尺寸</b></span><span style="min-width:44px"></span>
        </span>
      </div>
      ${layers.map((L, i) => `
      <div class="rrow" style="border-bottom:1px dashed #e2e8f0">
        <span class="rl">层 ${i + 1}</span>
        <span class="rv" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <span style="min-width:56px" data-f="h">—</span>
          <span style="min-width:92px"><input class="field-input" type="number" step="0.5" min="1" style="width:76px;padding:1px 4px" data-ps value="${overrides[i] ?? ''}" placeholder="跟随 ${sUnifiedRaw || '自动'}"><span class="ru">mm</span></span>
          <span style="min-width:70px" data-f="r">—</span>
          <span style="min-width:92px" data-f="m">—</span>
          <span style="min-width:84px" data-f="f">—</span>
          <span style="min-width:96px" data-f="d">—</span>
          <span style="min-width:44px">${overrides[i] != null ? `<button class="btn btn-ghost" data-pr="${i}" style="padding:1px 6px;font-size:.7rem">↺</button>` : ''}</span>
        </span>
      </div>`).join('')}
      <div class="field-hint" style="padding:4px 2px">统一厚度（上方）= ${sUnifiedRaw || `自动 ${recommendIngateS(parseNum(q('#vg_wall').value) || 0)} mm`}；改动会在结果中即时生效。</div>`;
    q('#vg_sPer').querySelectorAll('[data-ps]').forEach((el, i) => {
      el.addEventListener('input', () => {
        const v = el.value.trim();
        overrides[i] = v === '' ? null : Number(v);
        update();
      });
    });
    q('#vg_sPer').querySelectorAll('[data-pr]').forEach((btn) => {
      btn.addEventListener('click', () => { overrides[Number(btn.dataset.pr)] = null; renderSPer(); update(); });
    });
  };
  /** 刷新分层调整表的只读列（在 update 有结果后调用） */
  const refreshSPer = (r) => {
    const sys = q('#vg_sys').value;
    if (!(sys === 'pressurized' || sys === 'mixed') || !r || !r.ok) return;
    const rows = Array.from(q('#vg_sPer').querySelectorAll('.rrow')).slice(1);
    rows.forEach((r0, i) => {
      const g = r.gates[i];
      const s_i = overrides[i] != null ? overrides[i] : (q('#vg_s').value.trim() !== '' ? Number(q('#vg_s').value) : (recommendIngateS(parseNum(q('#vg_wall').value) || 0)));
      const ratio = s_i > 0 ? g.Fsingle / (s_i * s_i) : NaN;
      r0.querySelector('[data-f=h]').textContent = fmt(g.H, 0);
      r0.querySelector('[data-f=r]').textContent = Number.isFinite(ratio) ? '宽:厚=' + fmt(ratio, 1) : '—';
      r0.querySelector('[data-f=m]').textContent = Number.isFinite(ratio) ? `档→m ${gateLossMFromRatio(ratio).toFixed(1)}` : '—';
      r0.querySelector('[data-f=f]').textContent = fmt(g.Fsingle, 1) + ' mm²';
      r0.querySelector('[data-f=d]').textContent = `${g.dims.s}×${g.dims.l}（${fmt(g.dims.area, 0)}）`;
    });
  };

  let timer;
  const debounced = () => { clearTimeout(timer); timer = setTimeout(update, 160); };
  q('#vg_pos').addEventListener('change', () => { renderGuide(); renderLayers(); update(); });
  q('#vg_cb').addEventListener('input', (e) => { q('#vg_cb').dataset.v = e.target.value; debounced(); });
  q('#vg_tmode').addEventListener('change', update);
  q('#vg_tReset').addEventListener('click', () => { q('#vg_t').value = ''; update(); });
  q('#vg_sReset').addEventListener('click', () => { q('#vg_s').value = ''; update(); });
  q('#vg_layerAdd').addEventListener('click', () => {
    if (layers.length >= 8) return;
    const lastA = Number(layers[layers.length - 1].a) || 135;
    layers.push({ a: Math.round(lastA + 150) });
    overrides.push(null);
    renderLayers(); update();
  });
  container.querySelectorAll('.section-card input, .section-card select').forEach((el) => {
    el.addEventListener('input', debounced);
    if (el.tagName === 'SELECT') el.addEventListener('change', debounced);
  });
  renderGuide();
  renderLayers();
  sysMeta();
  matMeta();
  update();
  renderNextSteps(container, calc);
}
