// ============================================================
// 149.txt §三 · 热结状态 → Mc 来源文案（**单一来源**，纯函数，无 DOM）
//
// 为什么单独成模块：148-S0 §3.2 实测的根因是 `mcSourceNote()` 判据写成
//   `hotspots.items` 有没有，而不是 `hotspots.status` —— 于是
//     · LOW_CONFIDENCE（有候选 → items 非空）显示「来源：STL 热结检测（最大热结 H1）」
//     · INSUFFICIENT_RESOLUTION（无候选 → items 空）显示「按主体壁厚 ÷ 2 估算」
//   而这两态下 `calcManifest` 实际是 `return {blocked:true}`，**根本不计算**。
//   文字与实际计算路径相反，是本轮必须修掉的东西（149 §三.1）。
//
// 做法上照搬 V2.0-15 的 `riserStatus.js` 范式：**把判定与文案收进一个可单测的纯模块**，
//   调用方只负责渲染。判定依据一律取自 `calcs/calcManifest.js` 的真实分支，
//   不重复实现任何计算规则（§二「不为了恢复帮助而复制一份重复的计算逻辑」）。
//
// 五态 → 实际计算路径（`calcs/calcManifest.js:213-265` 逐支核对）：
//   ok                      → `process.mcHotspot`（STL 检出）或用户确认值
//   NO_HOTSPOT              → `process.wallHot`（= 可信主体壁厚 ÷ 2）
//   LOW_CONFIDENCE          → **blocked**，除非用户显式填了 Mc（人工放行）
//   INSUFFICIENT_RESOLUTION → **blocked**，除非用户显式填了 Mc（人工放行）
//   none（无 STL / 已清空）  → 用户填的 mcHotspot，或 wallHot
//   另：几何 `geomStatus === 'INVALID'` ⇒ **硬阻断**，人工放行也不适用（V2.0-10 定案）。
// ============================================================

/** 判定结论的种类（供测试断言，不参与任何数值计算） */
export const HS_SRC_KIND = {
  STL: 'stl',                 // ok：STL 检出的最大热结模数
  STL_MULTI: 'stl-multi',     // ok + 勾选了热结：逐热结各自计算
  USER: 'user',               // 用户显式输入的 Mc（含人工放行）
  WALL: 'wall',               // NO_HOTSPOT：主体壁厚 ÷ 2 兜底
  BLOCKED_LOWCONF: 'blocked-lowconf',
  BLOCKED_RESOLUTION: 'blocked-resolution',
  NONE: 'none',               // 无 STL / 已清空
  UNCOMPUTABLE: 'uncomputable', // 有 STL 但 wallHot 也是 0 —— 算不出 Mc
};

/** 用户显式给过值（与 `calcManifest` 的 `isUserVal` 同口径：来源 + 正值，两个条件都要） */
const isUserVal = (p) => !!p && (p.src === 'USER_OVERRIDE' || p.src === 'USER_INPUT') && p.v > 0;

/**
 * 热结状态 → Mc 来源说明。
 *
 * @param {object} inp
 * @param {string} inp.status     `hotspots.status`（'ok' | 'NO_HOTSPOT' | 'LOW_CONFIDENCE' | 'INSUFFICIENT_RESOLUTION' | 'none'）
 * @param {string} [inp.reasonText] 已翻译的失败原因（由调用方用 hsReasonText 生成；不传则用占位符）
 * @param {number} [inp.itemCount]  `hotspots.items` 的长度（**判定"有热结项/无热结项"用**，
 *   与 `calcManifest` 的 `hs.length > 0` 逐字对应 —— 主分支判定仍以 `status` 为准）
 * @param {Array}  [inp.itemIds]    `hotspots.items` 的 id 列表（有则按它过滤 picks，同 `hsById.has`）
 * @param {object} [inp.mcHotspot]  `process.mcHotspot` 参数对象 {v, src}
 * @param {object} [inp.wallHot]    `process.wallHot` 参数对象 {v, src}
 * @param {Array}  [inp.picks]      `process.hsPick`（[{id, mc}]）
 * @param {string} [inp.geomStatus] `geometry.geomStatus`
 * @returns {{kind:string, tone:'ok'|'warn'|'bad', blocked:boolean, mc:number|null,
 *            text:string, params:Array, extra:string|null, extraParams:Array,
 *            hardBlocked:boolean}}
 *   `text` / `extra` 是**中文原文（即 i18n key）**，调用方用 `tr(text, params)` 渲染。
 */
export function hsSourceInfo(inp = {}) {
  const status = inp.status || 'none';
  const reasonText = inp.reasonText || '';
  const mcHotspot = inp.mcHotspot || null;
  const wallHot = inp.wallHot || null;
  const itemCount = inp.itemCount ?? 0;
  const idSet = Array.isArray(inp.itemIds) ? new Set(inp.itemIds) : null;
  const picks = (inp.picks || [])
    .filter(p => p && p.id != null && p.mc > 0)
    .filter(p => !idSet || idSet.has(p.id));   // 同 calcManifest 的 `pickedHot = picks.filter(p => hsById.has(p.id))`
  const geomStatus = inp.geomStatus || 'VALID';
  const hardBlocked = geomStatus === 'INVALID';
  const wallMc = wallHot && wallHot.v > 0 ? wallHot.v : null;

  const out = (kind, tone, blocked, mc, text, params = [], extra = null, extraParams = []) =>
    ({ kind, tone, blocked, mc, text, params, extra, extraParams, hardBlocked });

  /* ---- ① 勾选了热结：`calcManifest` 里 pickedHot 恒盖过 mcHotspot，优先级最高 ---- */
  if (picks.length) {
    const n = picks.length;
    const mx = Math.max(...picks.map(p => p.mc));
    return out(HS_SRC_KIND.STL_MULTI, 'warn', false, mx,
      n > 1
        ? '已按选中的 {n} 个热结分别设计冒口：每个热结用各自的 Mc，主结果取其中 Mc 最大者（{v} mm）。未勾选的热结不参与计算。'
        : '已按选中的 1 个热结设计冒口：Mc = {v} mm（主结果即该值）。未勾选的热结不参与计算。',
      [n, fmt1(mx)]);
  }

  /* ---- ② 用户显式填了 Mc ⇒ 人工放行（`calcManifest` 的 userMc 分支，逐支同序） ----
     优先级必须与那边**一字不差**，否则界面说"用的是用户值"而实际用了别的：
       有热结项  → 只看 mcHotspot（`else if (hs.length > 0)`）
       无热结项  → 先 wallHot（`else if (isUserVal(wallHotSrc))`），再 mcHotspot
     ⚠ 用 `itemCount` 而不是 `status` 来分这两种：`LOW_CONFIDENCE` 的 items 非空、
       `INSUFFICIENT_RESOLUTION` 的 items 为空，正是 `hs.length` 在那边区分的依据。 */
  const userMcVal = (() => {
    if (itemCount > 0) return isUserVal(mcHotspot) ? mcHotspot.v : null;
    if (isUserVal(wallHot)) return wallHot.v;
    if (isUserVal(mcHotspot)) return mcHotspot.v;
    return null;
  })();
  if (userMcVal != null) {
    // 硬阻断（几何 INVALID）在前：人工放行**不适用**，不得让人以为填了值就能算
    if (hardBlocked) {
      return out(HS_SRC_KIND.USER, 'bad', true, userMcVal,
        '来源：<b>用户确认的</b> Mc = {v} mm —— 冒口按此值计算，不是自动热结检测结果（热结分析状态：{s}）。',
        [fmt1(userMcVal), statusText(status)],
        '⚠️ 但几何校验为 INVALID：本次为<b>硬阻断</b>，自动建议一律不可用（人工输入 Mc 也<b>不能</b>放行）——请先修复或更换网格。');
    }
    return out(HS_SRC_KIND.USER, status === 'ok' ? 'ok' : 'warn', false, userMcVal,
      '来源：<b>用户确认的</b> Mc = {v} mm —— 冒口按此值计算，不是自动热结检测结果（热结分析状态：{s}）。',
      [fmt1(userMcVal), statusText(status)],
      status === 'ok' ? null
        : '该 Mc 由用户显式输入，走的是人工放行路径；上述状态下的<b>自动</b>冒口建议本应被阻止——请确认该 Mc 有工艺依据。');
  }

  /** 该参数取不到正值 ⇒ `calcManifest` 里 `if (mc <= 0) return null`（算不出来），文案不得假装有值 */
  const notComputable = (kind) => out(kind, 'warn', true, null,
    '当前没有可用的热节模数：既没有 STL 检出的热结，也没有可用的主体壁厚参考值——请先导入 STL，或直接在下方填入 Mc。');

  /* ---- ③ 未填 Mc：按真实计算路径分状态 ---- */
  switch (status) {
    case 'ok':
      if (!(mcHotspot?.v > 0)) return notComputable(HS_SRC_KIND.UNCOMPUTABLE);
      return out(HS_SRC_KIND.STL, 'warn', false, mcHotspot.v,
        '来源：STL 热结检测（最大热结 H1）——自动估计值，尚需核对。',
        [],
        '检出多个热结时，其余热结需分别勾选后才参与冒口设计；当前值尚未验证适用于所有几何，请核对热节壁厚后确认。');

    case 'NO_HOTSPOT':
      if (wallMc == null) return notComputable(HS_SRC_KIND.UNCOMPUTABLE);
      /* ⚠ 149 §三 末段：这一支必须**把 reason 带出来**。
         NO_HOTSPOT 有三种来源：uniform（真均匀）/ no_candidate（未达阈值）/ **rejected**
         （`hotspotV3.js:240` 的裸字符串，有候选但全被筛掉）。原设计中心文案不带 reason，
         于是 rejected 一律被显示成"未检测到可靠热点"，与"无热结"混为一谈。
         reason 为空时（理论上不该发生）不加这句，不显示空的"原因："。 */
      return out(HS_SRC_KIND.WALL, 'warn', false, wallMc,
        '未检测到可靠热点：冒口按壁厚/结构参考值（主体壁厚 ÷ 2 = {v} mm）估算——不是 STL 识别出的热点，建议结合工艺经验复核。',
        [fmt1(wallMc)],
        reasonText ? '热结分析原因：{r}' : null,
        reasonText ? [reasonText] : []);

    case 'LOW_CONFIDENCE':
      // 148-S0 §3.2：这一态**不计算**，绝不能说成"按 STL 热结检测"或"按主体壁厚 ÷ 2"
      return out(HS_SRC_KIND.BLOCKED_LOWCONF, 'bad', true, null,
        '热结候选置信度不足（{r}）：本次<b>不会</b>给出冒口建议——自动建议已被阻止，因此界面上的推荐值不成立，也<b>不是</b>按"主体壁厚 ÷ 2"估算。请在下方「热节模数 Mc」填入工艺确认值，填入即按用户值计算。',
        [reasonText]);

    case 'INSUFFICIENT_RESOLUTION':
      return out(HS_SRC_KIND.BLOCKED_RESOLUTION, 'bad', true, null,
        '热结分析未能完成（{r}）：本次<b>不会</b>给出冒口建议——自动建议已被阻止，也<b>不是</b>按"主体壁厚 ÷ 2"估算。可手工填入 Mc，或检查模型尺度/网格质量后重新导入。',
        [reasonText]);

    default: {
      // 'none'（无 STL / 已清空）与任何未知状态：兜底路径在 calcManifest 里取 wallHot
      if (wallMc == null) return notComputable(HS_SRC_KIND.UNCOMPUTABLE);
      return out(HS_SRC_KIND.NONE, 'warn', false, wallMc,
        '当前没有 STL 热结检测结果：冒口按壁厚/结构参考值（主体壁厚 ÷ 2 = {v} mm）估算，不是 STL 识别出的热点。',
        [fmt1(wallMc)]);
    }
  }
}

/** 状态英文枚举 → 展示用中文（只用于文案里的括号说明，不参与判定） */
function statusText(status) {
  return {
    ok: '分析正常', NO_HOTSPOT: '未检出热结', LOW_CONFIDENCE: '候选置信度不足',
    INSUFFICIENT_RESOLUTION: '采样分辨率不足', none: '未执行热结分析',
  }[status] || String(status);
}
const fmt1 = (v) => (typeof v === 'number' && Number.isFinite(v) ? parseFloat(v.toFixed(1)).toString() : '—');
