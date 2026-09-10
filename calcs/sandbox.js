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

  // 砂型最小壁厚（表5）：语义=结构可制造下限；>4000mm 超出表5 → 不静默取值（minWallOut 提示）
  const minWallOut = dim > (SB_MIN_WALL.large.max || 4000);
  const minWall = dim < SB_MIN_WALL.small.max ? SB_MIN_WALL.small.wall
    : minWallOut ? null : SB_MIN_WALL.large.wall;
  const minWallRange = dim < SB_MIN_WALL.small.max ? '<100' : minWallOut ? '>4000（超表5）' : '100~4000';

  // 埋箱：查表
  if (mode === '埋箱（树脂砂埋箱）') {
    const wt = Number(input.wt) || 0;
    const row = SB_BURROW.find(r => r.dimLo < dim && dim <= r.dimHi && r.wtLo < wt && wt <= r.wtHi);
    if (!row) {
      // 未命中分两类（61 拆分，原文案一律归"超表"误导）：真超总范围 vs 组合落在离散档之间的空洞
      const dimRow = SB_BURROW.filter(r => r.dimLo < dim && dim <= r.dimHi);
      const inOverall = dim <= 2000 && wt <= 1800;
      const conservative = dimRow.length ? Math.max(...dimRow.map(r => r.load)) : null;
      const warnings = [];
      if (minWallOut) warnings.push('砂型最大轮廓 >4000mm，超出表5（砂型最小壁厚）范围——壁厚须按结构强度/打印可行性专门评估，未自动给下限值');
      warnings.push(inOverall
        ? '该 轮廓×重量 组合未落在表3离散分档内（表按常用档位划分，非所有组合都有档）：暂取同尺寸段承重上限作保守参考，建议按结构强度校核'
        : '尺寸/重量超出表3覆盖范围（轮廓 ≤2000mm · 重量 ≤1800kg）：取同尺寸段承重上限保守参考，较大砂型建议按结构强度评估或实测校核');
      return {
        mode, dim, wt, minWall, minWallRange, minWallOut,
        warning: warnings.join('；'),
        noload: SB_BURROW_NOLOAD,
        load: conservative,
        basis: conservative ? `未命中档位：取同尺寸段承重壁厚上限 ${conservative}mm（保守参考）` : null,
      };
    }
    return {
      mode, dim, wt, minWall, minWallRange, minWallOut: false,
      noload: SB_BURROW_NOLOAD, load: row.load,
      basis: `轮廓 ${row.dimLo}~${row.dimHi}mm · 重量 ${row.wtLo}~${row.wtHi}kg`,
    };
  }

  // 裸浇：按资料公式 吃砂量 = 溃散层(5) + (静水压头高度 − 铸件高度)，最低 40mm；底面 = 1.5×侧壁
  // 口径说明：静水压头高度 = 浇口盆/浇杯液面至基准面的高度差（企业规范原表为图示，此处原则换算）；
  //   侧壁按"压头超出铸件顶面段"的附加压力取均匀厚度，铸件高度内壁厚由型腔结构决定。
  const castH = Number(input.castH) || 0;
  const headH = Number(input.headH) || 0;
  const sideRaw = SB_BARE.softLayer + (headH - castH);
  const side = Math.max(SB_BARE.min, sideRaw);
  const bottom = Math.round(side * SB_BARE.bottomFactor);
  const warnings = [];
  if (minWallOut) warnings.push('砂型最大轮廓 >4000mm，超出表5（砂型最小壁厚）范围——壁厚须专门评估');
  if (headH < castH) warnings.push(`静水压头 ${headH}mm 低于铸件高度 ${castH}mm：公式中间值 ${sideRaw}mm 为负，侧壁按最低 ${SB_BARE.min}mm 计——请人工确认压头口径（基准面是否取浇口盆液面）`);
  return {
    mode, dim, castH, headH, minWall, minWallRange, minWallOut,
    side, bottom,
    warning: warnings.join('；') || null,
    basis: `吃砂量 = 溃散层 ${SB_BARE.softLayer}mm + (静水压头 ${headH} − 铸件高 ${castH})mm${sideRaw <= 0 ? '' : ' = ' + sideRaw + 'mm'} → 取 ${side}mm（最低 ${SB_BARE.min}mm）`,
  };
}
