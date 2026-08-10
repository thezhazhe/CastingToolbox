// ============================================================
// 3D 打印砂型吃砂量 · 逻辑层（纯函数）
// 埋箱：按 轮廓×重量 查表 → 承重/非承重壁厚
// 裸浇：原则换算（溃散层5 + 静水压头 − 铸件高度，最低40，底面1.5×）
// 砂型最小壁厚：<100 → 8，100~4000 → 30
// ============================================================
import { SB_BURROW, SB_BURROW_NOLOAD, SB_BARE, SB_MIN_WALL } from '../data/sandbox_calc.js';

export function runSandbox(input) {
  const dim = Number(input.dim) || 0;
  const mode = input.mode || '埋箱（树脂砂埋箱）';
  if (dim <= 0) return null;

  // 砂型最小壁厚（表5）
  const minWall = dim < SB_MIN_WALL.small.max ? SB_MIN_WALL.small.wall : SB_MIN_WALL.large.wall;

  // 埋箱：查表
  if (mode === '埋箱（树脂砂埋箱）') {
    const wt = Number(input.wt) || 0;
    const row = SB_BURROW.find(r => r.dimLo < dim && dim <= r.dimHi && r.wtLo < wt && wt <= r.wtHi);
    if (!row) {
      // 超出表3：退而取"同尺寸段内承重壁厚的最大值"作保守建议，并明确提示按强度评估
      const dimRow = SB_BURROW.filter(r => r.dimLo < dim && dim <= r.dimHi);
      const conservative = dimRow.length ? Math.max(...dimRow.map(r => r.load)) : null;
      return {
        mode, dim, wt, minWall,
        warning: '尺寸/重量超出表3覆盖范围（轮廓 ≤2000mm · 重量 ≤1800kg）。较大砂型建议按结构强度评估或实测校核',
        noload: SB_BURROW_NOLOAD,
        load: conservative,
        basis: conservative ? `超表：取同尺寸段承重壁厚上限 ${conservative}mm（保守参考）` : null,
      };
    }
    return {
      mode, dim, wt, minWall,
      noload: SB_BURROW_NOLOAD, load: row.load,
      basis: `轮廓 ${row.dimLo}~${row.dimHi}mm · 重量 ${row.wtLo}~${row.wtHi}kg`,
    };
  }

  // 裸浇：按资料公式 吃砂量 = 溃散层(5) + (静水压头高度 − 铸件高度)，最低 40mm；底面 = 1.5×侧壁
  const castH = Number(input.castH) || 0;
  const headH = Number(input.headH) || 0;
  const sideRaw = SB_BARE.softLayer + (headH - castH);
  const side = Math.max(SB_BARE.min, sideRaw);
  const bottom = Math.round(side * SB_BARE.bottomFactor);
  return {
    mode, dim, castH, headH, minWall,
    side, bottom,
    basis: `吃砂量 = 溃散层 ${SB_BARE.softLayer}mm + (静水压头 ${headH} − 铸件高 ${castH})mm = ${sideRaw}mm → 取 ${side}mm（最低 ${SB_BARE.min}mm）`,
  };
}
