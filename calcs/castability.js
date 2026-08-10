// ============================================================
// 铸件结构工艺性 · 纯计算模块
// 最小壁厚 / 临界壁厚 / 铸造圆角 / 拔模斜度(JB/T 5105) / 最小铸孔
// 数据来源：铸造工程师手册（壁厚分档）+ JB/T 5105-2022（起模斜度），置信度中高
// ============================================================

export const CAST_MATS = ['铸钢(ZG)', '灰铸铁(HT)', '球墨铸铁(QT)', '可锻铸铁(KTH)', '铝合金(Al)', '铜合金(Cu)'];

// 砂型铸造最小壁厚（mm），按铸件最大轮廓尺寸分档：s≤200 · m=200~500 · l>500
// 参考《铸造工程师手册 第2版》按最大轮廓尺寸分档（<200/200~400/400~800/800~1250）融合
export const MIN_WALL_TABLE = {
  '铸钢(ZG)':      { s: '6~8',   m: '9~12',  l: '14~18' },
  '灰铸铁(HT)':    { s: '3~4',   m: '5~7',   l: '8~12' },
  '球墨铸铁(QT)':  { s: '4~6',   m: '6~10',  l: '10~15' },
  '可锻铸铁(KTH)': { s: '3~4',   m: '4~6',   l: '8~12' },
  '铝合金(Al)':    { s: '3',     m: '4~5',   l: '6~8' },
  '铜合金(Cu)':    { s: '3~5',   m: '5~8',   l: '10~12' },
};

// 灰铸铁按牌号最小壁厚（mm，GB/T 9439 配套）
export const HT_MIN_WALL_BY_GRADE = {
  'HT100/HT150': '4~6', 'HT200': '6~8', 'HT250': '8~15',
  'HT300/HT350': '15~20', 'HT400': '≥20',
};

export const SIZE_BUCKET = {
  s: '轮廓≤200×200', m: '200×200~500×500', l: '＞500×500',
};

export function sizeBucketOf(maxDim) {
  return maxDim <= 200 ? 's' : maxDim <= 500 ? 'm' : 'l';
}

/** 取范围中值（如 "6~8" → 7），纯数字直接返回 */
export function midOf(text) {
  const m = String(text).match(/([\d.]+)\s*~\s*([\d.]+)/);
  if (m) return (parseFloat(m[1]) + parseFloat(m[2])) / 2;
  const n = parseFloat(String(text).replace(/[^\d.]/g, ''));
  return isNaN(n) ? 0 : n;
}

export function minWallOf(mat, maxDim) {
  const row = MIN_WALL_TABLE[mat] || MIN_WALL_TABLE['灰铸铁(HT)'];
  const b = sizeBucketOf(maxDim);
  return { text: row[b], bucket: b, bucketLabel: SIZE_BUCKET[b], mid: midOf(row[b]) };
}

/** 临界壁厚 ≈ 3 × 最小壁厚（适宜壁厚在最小与临界之间） */
export function criticalWallOf(minMid) {
  return Math.round(minMid * 3 * 10) / 10;
}

/** 铸造圆角：相邻两壁厚度均值 avg → 外/内圆角（内取 1/3~1/2、外取 1/5~1/3 中值法） */
export function filletRadii(avgWall) {
  const a = Math.max(1, avgWall);
  const inner = Math.max(3, Math.round(a / 2.5 * 10) / 10);   // 中值 ~0.4×壁厚
  const outer = Math.max(2, Math.round(a / 4 * 10) / 10);     // 中值 ~0.25×壁厚
  return {
    outer, inner,
    outerRange: `${(a / 5).toFixed(1)}~${(a / 3).toFixed(1)}`,
    innerRange: `${(a / 3).toFixed(1)}~${(a / 2).toFixed(1)}`,
  };
}

/* ---- 起模斜度：JB/T 5105-2022（单位：分 ′，1°=60′；值为上限/最小值） ---- */
export const DRAFT_HEIGHTS = [10, 40, 100, 160, 250, 400, 630, 1000];   // H≤10 · ≤40 · ≤100 · … · ≤1000

// 常用砂种 → 归入 JB/T 5105 的两类（标准只区分 粘土砂 / 自硬砂 两档，砂种是给用户的常见称谓）
export const SAND_TYPES = [
  { key: '潮模砂（湿型）', cat: '粘土砂' },
  { key: '干型砂（粘土）', cat: '粘土砂' },
  { key: '树脂砂（自硬）', cat: '自硬砂' },
  { key: '水玻璃砂（CO₂/酯）', cat: '自硬砂' },
  { key: '覆膜砂（壳型）', cat: '自硬砂' },
  { key: '其他（按粘土砂取小值）', cat: '粘土砂' },
];
export const DRAFT_SANDS = SAND_TYPES.map(s => s.key);
export const sandCategory = (key) => (SAND_TYPES.find(s => s.key === key) || SAND_TYPES[0]).cat;
// 粘土砂（表1/表2）：金属模与木模分开
const DRAFT_OUTER = { '金属/塑料': [140, 70, 30, 25, 20, 20, 20, 15], 木模: [175, 85, 40, 30, 25, 25, 20, 20] };
const DRAFT_INNER = { '金属/塑料': [275, 140, 65, 45, 40, 40, 35, 30], 木模: [345, 170, 75, 55, 45, 45, 40, 35] };
// 自硬砂（表3 外表面）：内表面按表3值再增加 50%
const DRAFT_SELF_OUTER = { '金属/塑料': [210, 110, 50, 35, 30, 30, 25, 20], 木模: [240, 125, 55, 40, 35, 35, 30, 25] };

/** 分 → "2°20′" / "30′" */
export function fmtAngle(min) {
  const m = Math.round(min);
  if (m <= 0) return '0°';
  const d = Math.floor(m / 60), r = m % 60;
  return r === 0 ? `${d}°` : d === 0 ? `${r}′` : `${d}°${r}′`;
}

/** 按 起模面高度 H(mm) × 模样材质 × 砂种 查起模斜度（砂种自动归入 粘土砂/自硬砂 两类） */
export function draftAngles(height, mold, sandType = '潮模砂（湿型）') {
  const h = Math.max(1, height || 50);
  const cat = sandCategory(sandType);
  let i = 0;
  for (let k = 0; k < DRAFT_HEIGHTS.length; k++) { if (h <= DRAFT_HEIGHTS[k]) { i = k; break; } i = k; }
  let outArr, inArr;
  if (cat === '自硬砂') {
    outArr = DRAFT_SELF_OUTER[mold] || DRAFT_SELF_OUTER['金属/塑料'];
    inArr = outArr.map(x => Math.round(x * 1.5));   // 内表面按表3再增 50%
  } else {
    outArr = DRAFT_OUTER[mold] || DRAFT_OUTER['金属/塑料'];
    inArr = DRAFT_INNER[mold] || DRAFT_INNER['金属/塑料'];
  }
  return {
    outerMin: outArr[i], innerMin: inArr[i], bucket: i, sandType, cat,
    outer: fmtAngle(outArr[i]), inner: fmtAngle(inArr[i]),
    outerRaw: outArr[i], innerRaw: inArr[i],
  };
}

export const DRAFT_MODELS = ['金属/塑料', '木模'];

/* ---- 工艺快速参考（按造型工艺，度）· 补充 JB/T 精确值，供快速选型 ----
   来源：Casting Assistant 设计规则（学习版）+ 行业经验，权威精确值仍以 JB/T 5105 为准 */
export const DRAFT_PROCESS = [
  { process: '手工湿型砂 · 外壁', min: '1°', rec: '2°', safe: '3°' },
  { process: '自动造型 · 湿型砂', min: '0.5°', rec: '1°', safe: '2°' },
  { process: '树脂砂（自硬）', min: '0.5°', rec: '1.5°', safe: '2.5°' },
  { process: '金属型（重力/低压）', min: '0.5°', rec: '1°', safe: '1.5°' },
  { process: '压铸', min: '0.5°', rec: '1°', safe: '2°' },
];
// 起模高度修正：随高度每增高，斜度适当增大
export const DRAFT_HEIGHT_ADJ = [
  { h: '0~50 mm', adj: '基础角度' },
  { h: '50~150 mm', adj: '+0.5°' },
  { h: '150~300 mm', adj: '+1°' },
  { h: '>300 mm', adj: '考虑结构优化 / 增加脱模措施' },
];

/* ---- 铸造圆角 · 两种口径（默认取《机械设计手册》值） ---- */
export const FILLET_ALT_NOTE = '部分设计规范采用更大圆角（按局部壁厚 T）：外 0.5T~1.5T（推荐 1T）、内 0.5T~2T（推荐 1.5T），以降低应力集中与热裂风险；但内圆角过大易构成新热节，需配合冷铁/冒口。本工具默认取《机械设计手册》值：外 1/5~1/3、内 1/3~1/2 壁厚均值。';

/* ---- 最小铸出孔 · 金属型/压铸（模具条件决定，孔径更小） ---- */
export const METAL_HOLE = { min: '3', rec: '5~8', note: '金属型/压铸由模具保证，孔径可小至 Φ3mm；砂型按批量查表' };

/* ---- 材料修正提示（按材质给设计注意点） ---- */
export const MATERIAL_TIPS = {
  '铸钢(ZG)': '收缩大、流动性差，壁厚宜偏大、注意补缩与圆角',
  '灰铸铁(HT)': 'HT250 流动性较好、可接受较薄壁厚；HT300+ 需偏厚并注意孕育与冷却',
  '球墨铸铁(QT)': 'QT450 收缩倾向较高，圆角和补缩更重要；QT500+ 关注热节、缩松风险',
  '可锻铸铁(KTH)': '石墨化退火阶段体积变化大，结构过渡要平缓',
  '铝合金(Al)': '关注氧化膜、气孔与充型，薄壁可至 3mm，注意排气',
  '铜合金(Cu)': '收缩较大、易吸气，注意补缩与浇注系统',
};

/** 最小铸出孔直径（mm），按材质+批量（《铸造工程师手册》· 铸造手册 综合） */
export const MIN_HOLE_BATCH = {
  '灰铸铁(HT)':   { '大量生产': '12~15', '成批生产': '15~30', '单件小批': '30~50' },
  '球墨铸铁(QT)': { '大量生产': '12~15', '成批生产': '15~30', '单件小批': '30~50' },
  '铸钢(ZG)':     { '大量生产': '—',     '成批生产': '30~50', '单件小批': '≥50' },
  '铝合金(Al)':   { '大量生产': '10~15', '成批生产': '12~20', '单件小批': '20~30' },
  '铜合金(Cu)':   { '大量生产': '10~12', '成批生产': '12~18', '单件小批': '18~25' },
};
export const MIN_HOLE_NOTE = '太小的孔留待钻孔更经济；熔模铸造孔可小至 Φ2mm。可锻铸铁可参照灰铁并偏小。';

/** 组装一条完整建议（视图直接消费） */
export function suggestCastability(mat, maxDim, avgWall, batch, draftH = 50, draftMold = '金属/塑料', sandType = '粘土砂') {
  const mw = minWallOf(mat, maxDim);
  const crit = criticalWallOf(mw.mid);
  const fillet = filletRadii(avgWall);
  const draft = draftAngles(draftH, draftMold, sandType);
  const holeRow = MIN_HOLE_BATCH[mat];
  return { mat, maxDim, avgWall, mw, crit, fillet, draft, holeRow, batch, sandType, tip: MATERIAL_TIPS[mat] || '' };
}
