// ============================================================
// 垂直造型线小件浇注系统 · 布置/截面积标注示意图（V1.3）
// 纯函数模块（无 DOM）→ SVG 输出，供 verticalGatingView 渲染与测试断言。
// V1.3：引入方式【全局三选】顶入/中入/底入；中入口在铸件侧面中部（B=口→产品+冒口最高点）；
//   流道标注改为白话读法（梯形 底X/顶Y/高H → 面积），附梯形说明。
// 图面约定（参考经典 gatingDiagram 风格；示意 + 真值标注）：
//   - 浇口杯液面线(顶) → 垂直流道竖管（橙）→ 各层铸件块（灰）
//   - 内浇口黄条：顶入=块顶部 / 底入=块底部（全局一致），连接线自流道引出
//   - 各截面【标注来自计算结果真值】：口 s×L（单口 mm²）/H；流道段 dims = 面积
//   - ★ = 节流截面（加压/混合=口；减压=流道底段入口）
//   - 层间等距为示意，真实高度在右侧 H（mm）标注
// ============================================================

const fmt1 = (v) => (Number.isFinite(v) ? String(parseFloat(v.toFixed(1))) : String(v));
const f0 = (v) => (Number.isFinite(v) ? String(parseFloat(v.toFixed(0))) : String(v));

/**
 * @param {{res:object, layers:Array<{a:number}>, mode:'top'|'bottom', C:number}} p
 *   res = runVerticalGating 结果；layers = 各层 A（第 1 行=最上层）；mode 全局浇口方式；
 *   C = 产品+冒口总高（mode=bottom 时使用）
 * @returns {string} SVG；非法返回 ''
 */
export function verticalDiagramSvg({ res, layers, mode = 'top', C = 0, B = 0 }) {
  if (!res || !res.ok || !Array.isArray(layers) || layers.length === 0) return '';
  const L = layers.length;
  const sys = res.system;
  const deco = sys === 'decompressed' || sys === 'mixed';
  const modeName = mode === 'bottom' ? '底入' : mode === 'side' ? '中入' : '顶入';
  const extra = mode === 'bottom' ? C : mode === 'side' ? B : 0; // C 或 B（全局单值）
  const gatesByH = new Map(res.gates.map((g) => [Math.round(g.H), g]));

  const CX = 117, RW = 22, BLOCK_X = 190, BLOCK_W = 122, BLOCK_H = 66;
  const yTop = (i) => 92 + i * 150;
  // 口条垂直位置：顶入=块顶缘、中入=块中部、底入=块底缘（全局一致）
  const gy = (i) => yTop(i) + (mode === 'bottom' ? BLOCK_H - 2 : mode === 'side' ? BLOCK_H / 2 - 2 : -2);
  const Hpx = 60 + L * 150 + 118;
  const hOf = (i) => (mode === 'bottom' || mode === 'side' ? Number(layers[i].a) - Number(extra) / 2 : Number(layers[i].a));

  const parts = [];
  const P = (s) => parts.push(s);

  P(`<svg viewBox="0 0 660 ${Hpx}" width="100%" role="img" aria-label="垂直造型线布置与截面积标注示意图" xmlns="http://www.w3.org/2000/svg" style="background:#fafafa;border:1px solid #e2e8f0;border-radius:8px">
  <style>.cap{font-size:9px;fill:#475569;stroke:#ffffff;stroke-width:2.5;paint-order:stroke}</style>`);

  // 浇口杯 + 液面线
  P(`<line x1="30" y1="44" x2="430" y2="44" stroke="#0f766e" stroke-width="1.4"/>
     <text x="36" y="40" font-size="10" fill="#0f766e" font-weight="600">浇口杯液面</text>
     <polygon points="${CX - 22},22 ${CX + 22},22 ${CX + 14},44 ${CX - 14},44" fill="#ffe8cc" stroke="#e8590c" stroke-width="1.1"/>
     <text x="${CX - 30}" y="32" class="cap" text-anchor="end">浇口杯</text>`);

  // 垂直流道竖管
  const runnerBottom = yTop(L - 1) + BLOCK_H + 24;
  P(`<rect x="${CX - RW / 2}" y="44" width="${RW}" height="${runnerBottom - 44}" fill="#ffd8a8" stroke="#e8590c" stroke-width="1.1"/>`);

  for (let i = 0; i < L; i++) {
    const A = Number(layers[i].a);
    const y = gy(i);
    P(`<rect x="${BLOCK_X}" y="${yTop(i)}" width="${BLOCK_W}" height="${BLOCK_H}" fill="#ced4da" stroke="#495057" stroke-width="1.1"/>`);
    P(`<line x1="${CX + RW / 2}" y1="${y + 2}" x2="${BLOCK_X - 8}" y2="${y + 2}" stroke="#e8590c" stroke-width="1.4"/>`);
    const bW = 52;
    P(`<rect x="${BLOCK_X - 8}" y="${y}" width="${bW}" height="5" fill="#ffd43b" stroke="#e67700" stroke-width="0.8"/>`);
    if ((sys === 'pressurized' || sys === 'mixed') && i === L - 1) {
      P(`<text x="${BLOCK_X + bW + 4}" y="${y + 4}" class="cap" fill="#c92a2a">★节流(口)</text>`);
    }
    const g = gatesByH.get(Math.round(hOf(i)));
    const gTxt = g
      ? `H=${f0(g.H)} · 单口 ${fmt1(g.Fsingle)}mm² · 口 ${g.dims.s}×${g.dims.l}（=${f0(g.dims.area)}）${g.sameForAllLevels ? '' : ` · 层总 ${f0(g.Flevel)}`}`
      : `H=${f0(hOf(i))}（A=${f0(A)}${mode !== 'top' ? `，${mode === 'bottom' ? 'C' : 'B'}=${f0(extra)}` : ''}）`;
    const gLbl = g && g.sameForAllLevels ? `（各层同尺寸 ${g.dims.s}×${g.dims.l}）` : '';
    P(`<text x="400" y="${yTop(i) + 12}" font-size="11" font-weight="700" fill="#0f172a">层 ${i + 1} · ${modeName}</text>
       <text x="400" y="${yTop(i) + 26}" font-size="10" font-weight="600" fill="#0b7285">${gTxt}</text>
       <text x="400" y="${yTop(i) + 40}" font-size="9" fill="#868e96">${gLbl}A=${f0(A)} mm（浇口杯液面 → 内浇口）</text>`);
  }

  // 流道标注
  if (sys === 'pressurized') {
    const sg = (res.runnerSegs || [])[0];
    if (sg) P(`<text x="${CX - RW / 2 - 8}" y="62" text-anchor="end" class="cap" font-weight="700" fill="#e8590c">垂直流道：${f0(sg.Fstd)}mm²</text>
      <text x="${CX - RW / 2 - 8}" y="73" text-anchor="end" class="cap">梯形 ${sg.dims}（≥需 ${f0(sg.req)}）</text>`);
  } else if (deco) {
    (res.runnerSegs || []).forEach((sg) => {
      const idx = layers.findIndex((ly) => Math.abs(hOf(layers.indexOf(ly)) - sg.H) < 1e-6);
      const y = idx >= 0 ? gy(idx) - 16 : 60 + (sg.segNo || 0) * 60;
      P(`<text x="${CX - RW / 2 - 8}" y="${y}" text-anchor="end" class="cap" fill="#e8590c">段${sg.segNo}：${f0(sg.Fstd)}mm²</text>
         <text x="${CX - RW / 2 - 8}" y="${y + 11}" text-anchor="end" class="cap">梯形 ${sg.dims}</text>`);
    });
    if (sys === 'decompressed') P(`<text x="${CX + RW / 2 + 6}" y="${runnerBottom - 6}" class="cap" fill="#c92a2a">★节流(段入口)</text>`);
    if (res.horiz) P(`<text x="400" y="${runnerBottom - 2}" font-size="9.5" fill="#495057">层横浇道：${res.horiz.F8dims} = ${f0(res.horiz.F8std)} mm²（每层两侧，各层同）</text>`);
  }

  const hTxt = mode === 'bottom' ? '底入 H = A − C/2（C = 产品+冒口总高）'
    : mode === 'side' ? '中入 H = A − B/2（B = 入水口 → 产品+冒口最高点）' : '顶入 H = A（A = 浇口杯液面 → 内浇口距离）';
  P(`<text x="30" y="${Hpx - 104}" font-size="9" fill="#868e96">图例：浇口杯/流道=橙 · 内浇口=黄 · 铸件=灰 · ★=节流截面（决定浇注时间）</text>
     <text x="30" y="${Hpx - 92}" font-size="9" fill="#868e96">流道梯形标注 X/Y×H：X=底宽、Y=顶宽、H=高 → 面积=(X+Y)÷2×H（如 7.5/15×15：(7.5+15)÷2×15≈169）</text>
     <text x="30" y="${Hpx - 80}" font-size="9" fill="#868e96">H 定义（手册 6.9.2.3）：${hTxt}；输入真值取自上方输入</text>
     <text x="30" y="${Hpx - 68}" font-size="9" fill="#868e96">层间高度为示意等距，真实尺寸以右侧 H/面积标注为准；面积为计算值（Calculation），选型为建议（Recommendation）</text>
     <text x="30" y="${Hpx - 56}" font-size="9" fill="#94a3b8">方法：DISA 230 Application Manual（2003）§6.8~6.12</text>
  </svg>`);
  return parts.join('');
}
