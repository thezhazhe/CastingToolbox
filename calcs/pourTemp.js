// ============================================================
// 浇注温度推荐 · 纯函数（PHASE 28.3-F，第三个 80/20 新能力）
// 输出推荐范围/工程建议，不是绝对值；来源不可靠时明确标注"企业经验参数"
// 铸铁：壁厚→浇注温度企业表（线性插值）+ 液相线公式 + 企业过热度 50℃
// 铸钢/铝/铜：企业无温度表 → 明确提示，不猜测（39.txt §十）
// ============================================================
import { POUR_TEMP_BY_WALL, OVERHEAT_ENTERPRISE, liquidus } from '../data/pour_temp.js';

/** 一维线性插值（超界取端点，不外推） */
function interp(walls, temps, x) {
  if (x <= walls[0]) return temps[0];
  for (let i = 1; i < walls.length; i++) {
    if (x <= walls[i]) {
      return temps[i - 1] + (temps[i] - temps[i - 1]) * (x - walls[i - 1]) / (walls[i] - walls[i - 1]);
    }
  }
  return temps[temps.length - 1];
}

/** 铸铁壁厚→浇注温度（企业表插值）。验证：37.5mm → 1320℃ */
export function pourTempByWall(wall) {
  return interp(POUR_TEMP_BY_WALL.walls, POUR_TEMP_BY_WALL.temps, wall);
}

/**
 * 浇注温度推荐入口
 * @param {object} p { family: 材料大类, wall: 主体壁厚 mm, C/Si/P?: 成分 wt%（可选） }
 * @returns {object} { family, byWall, byLiquidus, range, source, note }
 */
export function recommendPourTemp({ family, wall, C, Si, P }) {
  if (family === '灰铁' || family === '球铁') {
    const byWall = pourTempByWall(wall > 0 ? wall : 20);
    const hasComposition = [C, Si, P].every(v => typeof v === 'number' && !isNaN(v));
    const byLiquidus = hasComposition ? liquidus(C, Si, P) + OVERHEAT_ENTERPRISE : null;
    const base = byLiquidus != null ? (byWall + byLiquidus) / 2 : byWall;
    return {
      family, byWall, byLiquidus, overheat: OVERHEAT_ENTERPRISE,
      range: [Math.round(base - 15), Math.round(base + 15)],
      source: '企业 Excel「查表」R73-74（壁厚表 C 级）+「材料标准」液相线（B 级）',
      note: '企业经验参数，供参考；实际浇注温度按炉前实测调整',
    };
  }
  // 铸钢/铝/铜：企业无浇注温度表 → 明确提示（不猜测）
  return {
    family, byWall: null, byLiquidus: null, range: null,
    source: '—',
    note: `${family}无企业浇注温度表，请按材料标准手工填写（浇注温度 ≥ 液相线 + 过热度）`,
  };
}
