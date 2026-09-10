// ============================================================
// PHASE 71.5（75.txt §九/§十四）：Page1「铸件工艺分析」纯逻辑模块
// 职责：把已有 STL/项目数据 + castability.js 工程参考组织成两个板块
//   板块 A —— STL 基础信息（"这个 STL 本身是什么样"，检测到了什么）
//   板块 B —— 铸造工艺性（"建议怎么做"，参考值；不伪造未检测信息）
// 纯函数（无 DOM、无状态）：buildPage1Data(pack) → 数据对象；page1Html(d) → HTML。
// 纪律：引擎零修改；只做数据装配 + 三个启发阈值（薄区/厚薄比/热结数）——
//       不新建任何检测算法，无孔/尖角/圆角曲率/拔模方向识别（74.txt 明示不做）。
// ============================================================
import { minWallOf, criticalWallOf, filletRadii, draftAngles, MIN_HOLE_BATCH, MATERIAL_TIPS, sizeBucketOf, SIZE_BUCKET } from '../../calcs/castability.js';
import { reliabilityLevel } from '../../calcs/calcManifest.js';
// PHASE 72（80.txt §九）：Page1 铸件结构工艺性 UI 中英双语（展示层；判定阈值与数据表不动）
import { t as tr } from '../i18n/index.js';

/* ---- 族名 → castability 材料键（砂型口径） ---- */
export const CAST_MAT_KEY = {
  '灰铁': '灰铸铁(HT)', '球铁': '球墨铸铁(QT)', '铸钢': '铸钢(ZG)',
  '铝合金': '铝合金(Al)', '铜合金': '铜合金(Cu)',
};

/* ---- 最小铸孔批量判定（按目标产量；仅参考分档，用户可在独立工具中调整） ---- */
export const BATCH_BY_QTY = [
  { min: 10000, label: '大量生产' },
  { min: 200, label: '成批生产' },
  { min: 0, label: '单件小批' },
];
export const batchOfQty = (qty) => {
  const n = Math.max(0, qty || 0);
  return (BATCH_BY_QTY.find(b => n >= b.min) || BATCH_BY_QTY[BATCH_BY_QTY.length - 1]).label;
};

/* ---- 厚薄比启发阈值（检测信号，非算法） ---- */
export const THICK_RATIO_WARN = 3;
export const thinnRatioOf = (wallMax, body) => (wallMax > 0 && body > 0 ? wallMax / body : 0);

/* ---- 热结分析状态 → 简要状态文案（板块 A 状态行） ---- */
export const HS_STATUS_TEXT = {
  ok: '已检出热结（分析正常）',
  NO_HOTSPOT: '未检出热结候选',
  LOW_CONFIDENCE: '有候选但置信度不足',
  INSUFFICIENT_RESOLUTION: '采样分辨率不足，分析未完成',
  none: '未执行（手动输入模式）',
};

/* ---- 热结 reason → 长提示（原 resultsCenter 文案迁入，保持不变） ---- */
const HS_NOTE = {
  no_candidate: '无候选区域', uniform: '模型壁厚均匀，无相对厚区',
  all_low_confidence: '候选置信度不足', invalid_mesh: '网格无效',
  no_inside_points: '模型过薄，无法可靠分析', refine_limit: '局部细化超限，置信度不足',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? parseFloat(v.toFixed(d)).toString() : null);
const fmtN = (v, d = 1) => { const s = fmt(v, d); return s == null ? '—' : s; };

/* ---- 来源标签（§十四：颜色 + 文字，不依赖单色） ---- */
const SRC_TAG = {
  STL_GEOMETRY_ANALYSIS: { cls: 'stl', txt: 'STL 自动' },
  DERIVED: { cls: 'cal', txt: '自动计算' },
  USER_INPUT: { cls: 'usr', txt: '用户输入' },
  USER_OVERRIDE: { cls: 'ovr', txt: '用户修改' },
  SCENARIO: { cls: 'usr', txt: '生产场景' },
  DEFAULT: { cls: 'dft', txt: '系统默认' },
  CALC_RESULT: { cls: 'cal', txt: '计算结果' },
};
/** 来源标签 HTML（含 orig 悬浮提示：STL 原始值 vs 当前采用值） */
export function srcTagHtml(p, hasStl = false) {
  const t = SRC_TAG[p?.src] || { cls: 'dft', txt: '—' };
  let title = '';
  if (p?.src === 'USER_OVERRIDE' && p.orig) {
    const ov = Array.isArray(p.orig.v) ? p.orig.v.join('×') : fmtN(p.orig.v, 2);
    title = `title="${esc(tr('STL/自动原始值 {v} · 当前采用用户修改值（↺ 可恢复）', [ov]))}"`;
  } else if (p?.src === 'STL_GEOMETRY_ANALYSIS' && p.orig && hasStl) {
    title = `title="${esc(tr('STL 自动值'))}"`;
  }
  return `<span class="dc-src-tag ${t.cls}" ${title}>${tr(t.txt)}</span>`;
}

/* ============================================================
   buildPage1Data(pack)
   pack = {
     v(path), ps(path),            // CastingProject getV/get（测试注入桩）
     sampling: {warning,level,detail,minWall,minWallReliable}|null,  // V3 采样定性信号（内存态）
     bodyRef: number|null,         // 可信主体壁厚（V3 完整链；fallback 用 process.wallUsed）
     hasStl: bool, manual: bool, geomStatus: string,
   }
   → { A:[{key,label,value,unit,src,orig,note,ok}], statusChip, statusNote,
       B:[{key,title,chip,chipCls,lines:[{cls,text}]}], risks:[{cls,text}], tip, hasStl, level }
   ============================================================ */
export function buildPage1Data(pack) {
  const { v, ps, sampling = null, bodyRef = null, hasStl = false, manual = false, geomStatus = 'VALID', results = null } = pack;
  const fam = v('material.family') || '';
  const matKey = CAST_MAT_KEY[fam] || null;
  const size = v('geometry.size') || [];
  const maxDim = size.length ? Math.max(...size) : 0;
  const body = bodyRef != null ? bodyRef : (v('process.wallUsed') || 0);
  const wallMax = v('geometry.wallMax') || 0;
  const hsItems = v('hotspots.items') || [];
  const hsStatus = v('hotspots.status') || 'none';
  const hsReasonRaw = v('hotspots.reason') || '';
  const hsReason = HS_NOTE[hsReasonRaw] || '';
  const qty = v('production.qty') || 0;
  const level = reliabilityLevel({ geomStatus, hsStatus });
  const mcVal = hsStatus === 'ok' && hsItems.length ? (v('process.mcHotspot') || 0) : null;

  const A = [];
  const aRow = (key, label, value, unit, srcPath, ok = null, note = null) => {
    if (srcPath && !ps(srcPath)) return;
    const p = srcPath ? ps(srcPath) : null;
    A.push({ key, label, value, unit, src: p ? p.src : null, orig: p?.orig?.v, ok, note, editable: p?.editable });
  };
  aRow('size', tr('外形尺寸'), size.length ? size.map(x => fmtN(x, 1)).join(' × ') : null, 'mm', 'geometry.size');
  aRow('vol', tr('体积'), fmtN(v('geometry.volumeCm3'), 1), 'cm³', 'geometry.volumeCm3');
  aRow('area', tr('表面积'), fmtN(v('geometry.areaCm2'), 0), 'cm²', 'geometry.areaCm2');
  aRow('netWt', tr('净重估算'), fmtN(v('geometry.netWeightKg'), 2), 'kg', 'geometry.netWeightKg');
  aRow('blankWt', tr('毛坯重量（计算口径）'), fmtN(v('geometry.blankWeightKg'), 2), 'kg', 'geometry.blankWeightKg');
  aRow('body', tr('主体/代表壁厚'), fmtN(body, 1), 'mm', 'process.wallUsed');
  aRow('wallMax', tr('最大壁厚'), fmtN(wallMax, 1), 'mm', 'geometry.wallMax');
  aRow('hsN', tr('热节数量'), hsItems.length ? tr('{n} 个', [hsItems.length]) : (hasStl ? tr('{n} 个', [0]) : '—'), '', null);
  aRow('mc', tr('最大热节 Mc'), mcVal != null ? fmtN(mcVal, 1) : (hsStatus === 'NO_HOTSPOT' ? tr('（无热结 → 冒口按主体壁厚/2 估算）') : null), 'mm', 'process.mcHotspot');

  // 状态/置信度行 + 状态长提示
  const statusChipCls = level === 'BLOCK_AUTO_RECOMMEND' ? 'dc-chip-bad'
    : level === 'WARNING_REVIEW' ? 'dc-chip-warn' : 'chip-ok';
  let statusText = tr(HS_STATUS_TEXT[hsStatus] || '—');
  if (hasStl && hsStatus === 'ok') statusText = tr('✅ {n} 个热结 · 分析正常', [hsItems.length]);
  // PHASE 71.5 诚实口径：uniform（真均匀）≠ no_candidate（未达阈值），后者不冒充"均匀属正常"
  else if (hasStl && hsStatus === 'NO_HOTSPOT') {
    statusText = hsReasonRaw === 'uniform'
      ? tr('未检出热结（模型壁厚均匀，无相对厚区）')
      : tr('未检出热结候选（未达检出阈值；不排除复杂结构/薄特征超采样能力）');
  }
  const A_status = { label: tr('Hotspot 状态 / 置信度'), value: statusText, chip: statusChipCls,
    note: hsItems.some(h => h.confidence) ? tr('逐结置信度：') + hsItems.map(h => `${h.id}:${Math.round((h.confidence || 0) * 100)}%`).join(' · ') : (hsStatus === 'ok' ? tr('置信度达标（自动建议可用）') : '') };
  A.push(A_status);

  // 最小壁厚检测行（板块 A 诚实口径：只给定性薄区信号，不给伪精确值）
  const thin = sampling ? {
    warn: !!sampling.warning,
    level: sampling.level || 'ok',
    detail: sampling.detail || '',
    minWall: sampling.minWall,
    minWallReliable: !!sampling.minWallReliable,
  } : null;
  let thinLine = null;   // B1 检测侧配对行
  if (thin && thin.warn) {
    const vv = thin.minWallReliable && thin.minWall > 0 ? tr('约 {v} mm 量级（定性，非精确测量）', [fmtN(thin.minWall, 1)]) : tr('低于采样下限（无法给出可靠数值）');
    aRow('minwall', tr('最小壁厚（检测）'), thin.level === 'resolution' || thin.level === 'failed' ? tr('无法可靠测量（{a}）', [sampling.detail || tr('采样不足')]) : vv, '', null, false, sampling.detail || '');
    thinLine = { warn: true, minWall: thin.minWallReliable ? thin.minWall : null, text: tr('检测到薄壁区域：{v}——存在充型/组织风险，需重点关注', [vv]) };
  } else if (hasStl && thin) {
    aRow('minwall', tr('最小壁厚（检测）'), tr('采样正常：未见低于采样下限的薄区'), '', null, true, tr('V3 采样为定性探测，不输出精确最小壁厚'));
  } else {
    aRow('minwall', tr('最小壁厚（检测）'), manual ? tr('手动输入模式：无 STL 检测') : '—', '', null);
  }

  /* ---- 板块 B：铸造工艺性（参考/建议/检测配对，不混） ---- */
  const B = [];
  const bRow = (title, chip, chipCls, lines) => B.push({ title, chip, chipCls, lines });

  // ① 最小壁厚（建议参考 + 薄区检测配对）
  if (matKey && maxDim > 0) {
    const mw = minWallOf(matKey, maxDim);
    const crit = criticalWallOf(mw.mid);
    const lines = [{ cls: 'ok', text: tr('建议最小壁厚 {a} mm（{b} · {c}砂型档）', [mw.text, tr(matKey), mw.bucketLabel]) }];
    if (crit > 0) lines.push({ cls: 'info', text: tr('临界壁厚 ≈ {v} mm：超过后需重点考虑补缩与圆角（该档为中值推算）', [fmtN(crit, 1)]) });
    if (thinLine) lines.unshift({ cls: 'warn', text: thinLine.text });
    bRow(tr('最小壁厚'), thinLine ? tr('检测 + 建议') : tr('建议参考'), thinLine ? 'warn' : 'info', lines);
  } else if (!fam) {
    bRow(tr('最小壁厚'), tr('建议参考'), 'info', [{ cls: 'info', text: tr('先在②选择材料大类，按「材料 × 轮廓档」给出可追溯参考（铸造工程师手册）') }]);
  }

  // ② 铸造圆角（参考；不做局部曲率/尖角检测）
  if (body > 0) {
    const fr = filletRadii(body);
    bRow(tr('铸造圆角'), tr('建议参考'), 'info', [
      { cls: 'ok', text: tr('相邻壁均值 {a} mm → 外圆角 ≈{b} mm（{c}）', [fmtN(body, 1), fr.outer, fr.outerRange]) },
      { cls: 'ok', text: tr('内圆角 ≈{a} mm（{b}，按《机械设计手册》口径）', [fr.inner, fr.innerRange]) },
      { cls: 'info', text: tr('未做尖角/曲率检测：局部小圆角、厚薄壁交界处仍建议结合分型面人工复核（V1 不做复杂曲率分析）') },
    ]);
  }

  // ③ 拔模斜度（只给参考档，不伪造"当前拔模角"）
  {
    const h = Math.max(10, maxDim || 50);
    const da = draftAngles(h, '金属/塑料', '潮模砂（湿型）');
    bRow(tr('拔模斜度'), tr('工程参考'), 'ref', [
      { cls: 'ok', text: tr('铸造拔模参考：外壁 {a} · 内表面 {b}（JB/T 5105-2022，按高度 ≤{c} mm 档）', [da.outer, da.inner, fmtN(h, 0)]) },
      { cls: 'info', text: tr('实际值需根据分型面与模具材质确认——本工具未做拔模方向识别（{a} · 金属/塑料模为默认查表档）', [tr(da.sandType)]) },
    ]);
  }

  // ④ 最小铸出孔径（参考；不做孔识别，绝不判"当前孔径满足"）
  {
    const row = matKey ? (MIN_HOLE_BATCH[matKey] || null) : null;
    const batch = batchOfQty(qty);
    const hole = row ? (row[batch] || '—') : null;
    bRow(tr('最小铸出孔径'), tr('工程参考'), 'ref', [
      { cls: 'ok', text: tr('砂型最小可铸孔径参考：{a}（{b} · {c}，按目标产量 {d} 件判定）', [hole != null ? '≥' + hole + ' mm' : '—', matKey ? tr(matKey) : tr('材料未定'), tr(batch), qty || '—']) },
      { cls: 'info', text: tr('未做孔特征识别：本工具不输出"当前孔径 Y mm"，也不做 ✓/⚠ 铸出判定（74.txt 明示 V1 不做复杂孔识别）') },
    ]);
  }

  /* PHASE 78（78.txt 六）：本页做减法——**只保留 4 张关键卡片**（最小壁厚 / 铸造圆角 / 拔模斜度 / 最小铸出孔径）。
     原「⑤ 厚薄壁过渡」「⑥ 结构风险摘要」两张卡移除：其内容与顶部风险条、右侧「② 热结列表」
     （可点击定位 3D）重复。其中**必须保留的诚实提示**（多热结 V1 口径 / no_candidate 不冒充"均匀属正常"）
     压缩成 notes 单行提示，不随卡片一起删掉。 */
  const notes = [];
  if (hsStatus === 'ok' && hsItems.length > 1) {
    notes.push({ cls: 'warn', text: tr('多热结（{n} 处）：V1 不做分区补缩自动划分——请在「参数与执行条件 → 冒口参数」勾选需要补缩的热结（可多选，各自出冒口方案），未勾选的不计算。', [hsItems.length]) });
  }
  if (hsStatus === 'NO_HOTSPOT' && hsReasonRaw !== 'uniform') {
    notes.push({ cls: 'warn', text: tr('未检出热结候选：未发现明显厚大区域——复杂薄壁/加厚结构可能超出采样分辨率（引擎限制），自动冒口按主体壁厚保守估算，建议结合工艺复核。') });
  }
  const thickRatio = thinnRatioOf(wallMax, body);
  if (body > 0 && wallMax > 0 && thickRatio >= THICK_RATIO_WARN) {
    notes.push({ cls: 'warn', text: tr('厚薄突变信号：最大壁厚 {a} / 主体 {b} = {c}×（启发阈值 ≥{d}×）——交接处建议圆滑过渡、避免截面突变。', [fmtN(wallMax, 1), fmtN(body, 1), fmtN(thickRatio, 1), THICK_RATIO_WARN]) });
  }

  /* ---- 关联工艺卡片（PHASE 71.7 · 77.txt 五）：线收缩率（只综合比例）+ 加工余量（只推荐值）
     —— 计算仍由「线收缩率 / 加工余量」计算器完成，本页只做卡片化展示（不新增页） ---- */
  const C = [];
  const sh = results?.shrinkage;
  if (sh) {
    C.push({
      key: 'shrinkage', title: tr('线收缩率'), chip: sh.directional ? tr('需分方向') : tr(sh.modeLabel || '常用值（生产·模具）'),
      chipCls: sh.directional ? 'warn' : 'ok',
      value: sh.combined != null ? fmtN(sh.combined, 2) + ' %' : tr('分方向放缩水'),
      lines: [sh.directional
        ? { cls: 'warn', text: tr('各方向收缩率差 ≥0.2%，建议分方向放缩水（详见工艺计算报告）') }
        : { cls: 'info', text: tr('造型缩尺按综合比例放大（详细分方向数值见工艺计算报告）') }],
    });
  }
  const ma = results?.machining;
  if (ma) {
    C.push({
      key: 'machining', title: tr('加工余量'), chip: ma.unsupported ? tr('无标准档') : tr(ma.methodLabel || ''),
      chipCls: ma.unsupported ? 'warn' : 'ok',
      // 小余量（<5mm）保留两位小数（0.55 不应显示成 0.6）
      value: ma.unsupported ? '—' : fmtN(ma.mid, Math.abs(ma.mid) < 5 ? 2 : 1) + ' mm',
      lines: [ma.unsupported
        ? { cls: 'warn', text: ma.note || tr('该工艺 × 材质无标准 RMA 等级') }
        : { cls: 'info', text: tr('推荐范围 {a}~{b} mm（等级 {c} · GB/T 6414 口径）', [fmtN(ma.min, 1), fmtN(ma.max, 1), (ma.grades || []).join('~')]) }],
    });
  }

  // 材料提示
  const tip = fam ? tr(MATERIAL_TIPS[CAST_MAT_KEY[fam]] || '') : null;

  /* ---- 三信号风险条（板块顶，一眼区分检测 vs 建议入口） ---- */
  const risks = [];
  if (hsItems.length) risks.push({ cls: 'warn', text: tr('{n} 处厚大热结', [hsItems.length]) });
  if (thinLine) risks.push({ cls: 'warn', text: tr('检出薄区（充型风险）') });
  if (body > 0 && wallMax > 0 && wallMax / body >= THICK_RATIO_WARN) risks.push({ cls: 'warn', text: tr('厚薄突变 {v}×', [fmtN(wallMax / body, 1)]) });
  if (!risks.length && hasStl) risks.push({ cls: 'ok', text: tr('未检出明显结构风险（热结 / 薄区 / 厚薄比三信号）') });
  if (!risks.length && !hasStl) risks.push({ cls: 'info', text: hasStl === false ? tr('（未导入 STL——手动参数模式，无检测信号）') : '—' });

  return { A, C, statusChip: statusChipCls, hsStatus, hsItems, hsReason, fam, matKey, maxDim, body, wallMax,
    B, tip, risks, notes, hasStl, manual, level, thinLine };
}

/* ============================================================
   page1Html(d) —— 板块 A/B 两卡 + 来源标签 + 检测/建议分色
   ============================================================ */
export function page1Html(d) {
  // PHASE 71.7（77.txt 末）：STL 基础信息不再在本页重复——已在 ① 分析结果概览（模型信息枢纽）展示；
  //   本页只保留「铸造工艺性」建议卡片 + 关联工艺卡片（线收缩率 / 加工余量）。
  const cCards = (d.C || []).map(c => `
    <div class="dc-p1-bcard dc-p1-ccard">
      <div class="dc-p1-bhead"><b>${esc(c.title)}</b><span class="chip ${c.chipCls === 'warn' ? 'dc-chip-warn' : c.chipCls === 'ok' ? 'chip-ok' : ''}">${esc(c.chip)}</span></div>
      <div class="dc-p1-cval">${esc(String(c.value))}</div>
      ${c.lines.map(l => `<div class="dc-p1-bline ${l.cls === 'warn' ? 'warn' : l.cls === 'ok' ? 'ok' : ''}">${l.text}</div>`).join('')}
    </div>`).join('');
  const bCards = d.B.map(b => `
    <div class="dc-p1-bcard">
      <div class="dc-p1-bhead"><b>${esc(b.title)}</b><span class="chip ${b.chipCls === 'warn' ? 'dc-chip-warn' : b.chipCls === 'ok' ? 'chip-ok' : ''}">${esc(b.chip)}</span></div>
      ${b.lines.map(l => `<div class="dc-p1-bline ${l.cls === 'warn' ? 'warn' : l.cls === 'ok' ? 'ok' : ''}">${l.text}</div>`).join('')}
    </div>`).join('');
  const riskChips = d.risks.map(r =>
    `<span class="chip ${r.cls === 'warn' ? 'dc-chip-warn' : r.cls === 'ok' ? 'chip-ok' : ''}">${r.cls === 'warn' ? '⚠ ' : r.cls === 'ok' ? '✅ ' : ''}${esc(r.text)}</span>`).join('');
  // PHASE 73 P2 修复：原来先无条件产出 <div class="dc-blocked">（带警示底色），
  //   内层文案对 NO_HOTSPOT 等状态是空串 → 页面上出现**一个没有文字的空黄色框**（盲测发现）。
  //   改为先算文案、有文案才出框。
  const hsNoticeMsg = !d.hsItems.length && d.hsStatus === 'LOW_CONFIDENCE'
    ? tr('检出低置信度热结候选（{r}）——未获得足够可信热结分析，自动冒口建议已阻止；可手工输入热节模数 Mc 后继续。', [esc(tr(d.hsReason))])
    : (!d.hsItems.length && d.hsStatus === 'INSUFFICIENT_RESOLUTION'
      ? tr('热结分析未能完成（{r}）——无法可靠判断热结，自动冒口建议已阻止；可检查模型尺度/网格质量后重新导入，或手工输入 Mc。', [esc(tr(d.hsReason))])
      : '');
  const hsNotice = hsNoticeMsg ? `<div class="dc-blocked" style="margin-top:8px">${hsNoticeMsg}</div>` : '';

  // PHASE 78（78.txt 六）：只保留 4 张关键卡片 + 必要提示条（做减法，不是做加法）
  const noteRows = (d.notes || []).map(n =>
    `<div class="dc-p1-bline ${n.cls === 'warn' ? 'warn' : n.cls === 'ok' ? 'ok' : ''}">${n.text}</div>`).join('');
  return `<div class="dc-result-sec dc-page1">
    <div class="dc-sec-title">① ${tr('铸件结构工艺性')}
      <span class="chip">${tr('关键工艺性建议 + 线收缩率 / 加工余量')}</span></div>
    <div class="dc-p1-risks">${riskChips || '<span class="chip">—</span>'}</div>
    ${hsNotice}

    <div class="dc-p1-parthead">${tr('铸造工艺性')} <span class="chip">${tr('参考值可追溯 · 不伪造未检测信息')}</span></div>
    <div class="dc-p1-bgrid">${bCards}</div>
    ${noteRows ? `<div class="dc-p1-notes">${noteRows}</div>` : ''}

    ${cCards ? `<div class="dc-p1-parthead" style="margin-top:14px">${tr('关联工艺参数')} <span class="chip">${tr('由对应计算器给出（同一结果同时进入工艺计算报告）')}</span></div>
    <div class="dc-p1-bgrid">${cCards}</div>` : ''}
    ${d.tip ? `<div class="dc-p1-tip">💡 ${esc(d.tip)}</div>` : ''}
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
      <button class="btn btn-ghost" data-calc-link="castability">📖 ${tr('完整铸造工艺性工具（可调批量/砂型档）')}</button>
    </div>
  </div>`;
}

/** 仅供 html 内部：由 A 行还原参数对象显示来源标签（orig 等已折叠进行内，不引入 ps 依赖） */
function psBySrc(r) {
  return { src: r.src, orig: r.orig ? { v: r.orig } : null };
}
