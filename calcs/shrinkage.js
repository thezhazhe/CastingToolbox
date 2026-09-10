// ============================================================
// 线收缩率 · 纯计算模块
// 三档：自由收缩（开放结构）/ 常用值（生产·模具缩尺）/ 受阻收缩（复杂结构）
// 同一合金：受阻 < 常用 < 自由。生产中实际用的是考虑型芯/筋板阻碍的受阻值。
// 方向性：同一材质可按各方向尺寸分别推荐收缩率——
//   按【绝对尺寸】锚定：≥1000mm 的方向取档位上限（阻碍相对小），
//   ≤100mm 的方向取档位下限（薄壁小件受约束、收缩小），之间线性插值。
//   注：收缩率是"率"，同材同约束下与尺寸大小关系不大（1500 与 10 都是 ~1%），
//   真正拉开差距的是【绝对放尺量】(mm)；尺寸悬殊方向仅率差超过阈值才提示分开放缩水。
// 数据来源：《木模结构工艺》《铸钢手册》《金属液态成型原理》（参考值，以试制修正为准）
// ============================================================

export const SHRINKAGE = {
  '灰铁(HT)':   { free: 1.0, common: 0.85, restrained: 0.8,  range: '0.9~1.1%', note: '石墨化膨胀补偿部分凝固收缩' },
  '球铁(QT)':   { free: 1.0, common: 0.8,  restrained: 0.6,  range: '0.8~1.1%', note: '铁素体偏低/珠光体偏高，缩前石墨化膨胀大' },
  '铸钢(ZG)':   { free: 2.2, common: 1.8,  restrained: 1.5,  range: '1.8~2.4%', note: '无石墨化，线收缩最大' },
  '铝合金(Al)': { free: 1.1, common: 1.0,  restrained: 0.8,  range: '1.0~1.2%', note: '近共晶铝硅合金' },
  '铜合金(Cu)': { free: 1.4, common: 1.3,  restrained: 1.2,  range: '1.3~1.5%', note: '锡青铜' },
};

export const SHRINK_MODE_LABEL = { free: '自由收缩', common: '常用值（生产·模具）', restrained: '受阻收缩' };

/** 各方向推荐收缩率差达到该百分点 → 分方向放缩水，不推荐综合比例 */
export const SPLIT_RATE_DIFF = 0.2;

/** 各档位的区间 [小方向取值, 大方向取值]（大方向阻碍相对小、取上限） */
const MODE_BAND = {
  free:       (d) => [d.common, d.free],
  common:     (d) => [d.restrained, d.common],
  restrained: (d) => [d.restrained, d.restrained],
};

/** 绝对尺寸锚定点：≤100mm 取下限、≥1000mm 取上限，之间线性 */
export const SIZE_SMALL = 100;
export const SIZE_LARGE = 1000;

/**
 * 按方向计算收缩推荐。
 * dims = [长, 宽, 高...]，mode = 'free' | 'common' | 'restrained'
 * 返回 { dirs:[{size,rate,amount,pattern,idx}], directional, combined, spread }
 *   - dirs: 每个有效方向的推荐收缩率（大方向=档位上限，小方向=下限）
 *           idx = 该方向在 dims 中的原始下标（PHASE 63 P1-7：任一方尺寸为空时
 *           不允许数组移位 —— 渲染层必须按 idx 对应 长/宽/高）
 *   - directional: 各方向收缩率差 ≥ 0.2 个百分点 → 不推荐综合比例
 *   - combined: 方向均衡时给统一综合比例；directional 时为 null
 *   - spread: 最大/最小推荐率之差（百分点）
 */
export function calcShrinkageDir(mat, dims, mode) {
  const d = SHRINKAGE[mat] || SHRINKAGE['灰铁(HT)'];
  const active = dims.map((v, i) => ({ v, i })).filter(x => x.v > 0);
  if (active.length === 0) return null;
  const band = (MODE_BAND[mode] || MODE_BAND.common)(d);
  const [lo, hi] = band;
  const dirs = active.map(({ v: size, i }) => {
    // 绝对尺寸锚定：≥1000mm → hi，≤100mm → lo，之间线性（不再以 maxDim 归一，
    // 否则 maxDim=1500 时 10mm 方向也几乎取 hi，看起来"同一比例"）
    const t = Math.min(1, Math.max(0, (size - SIZE_SMALL) / (SIZE_LARGE - SIZE_SMALL)));
    const rate = lo + (hi - lo) * t;
    return { size, rate, amount: size * rate / 100, pattern: size * (1 + rate / 100), idx: i };
  });
  const rates = dirs.map(x => x.rate);
  const spread = Math.max(...rates) - Math.min(...rates);
  const directional = spread >= SPLIT_RATE_DIFF;
  const combined = directional ? null : hi;
  return { dirs, directional, combined, spread, maxDim: Math.max(...active.map(x => x.v)), mode, range: d.range };
}

/** 兼容旧接口：单一档位应用到所有方向 */
export function calcShrinkage(mat, dims, mode) {
  const d = SHRINKAGE[mat] || SHRINKAGE['灰铁(HT)'];
  const rate = d[mode] ?? d.common;
  return dims.filter(v => v > 0).map(size => ({
    size, rate, amount: size * rate / 100, pattern: size * (1 + rate / 100),
  }));
}
