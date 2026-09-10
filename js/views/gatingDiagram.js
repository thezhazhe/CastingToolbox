// ============================================================
// 浇注方向工程示意图（PHASE 45 用户迭代 v8：用户审核通过，正式版）
// 纯函数模块（无 DOM），SVG 输出，供 gatingView 渲染与测试直接断言。
// 工程定义（全部来自代码/企业 Excel/已批准 Hp 方案 A，不猜测）：
//   Ho = 内浇道基准至上箱面的垂直距离（gating.js UI label + Excel F7）
//   ph = 浇注方向下铸件有效高度，铸件底→铸件顶（gating.js + Excel K6"铸件高度（浇注方向）"）
//   rh = 冒口高出铸件顶面的距离（铸件顶→冒口顶；Excel K15，UI"冒口高于铸件顶面的距离"）
// 图面约定（用户逐轮审核定稿）：
//   - 砂箱最宽（右沿到图片边），包住直浇道/横浇道/内浇口/冒口/铸件（浇口杯在砂箱上方）
//   - 流路一条直线：浇口杯 → 直浇道（垂直，穿过横浇道后下延）→ 横浇道（扁长横条）
//     → 内浇口（横浇道前端同轴延伸，薄=横浇道一半，深色）→ 伸入铸件
//   - 内浇口入口深度随浇注方向：顶注铸件顶内侧 / 中注铸件中部 / 底注铸件底部内
//   - 分色：浇口杯/直浇道=橙、横浇道=浅蓝、内浇口=深蓝、冒口=黄、铸件=灰
//   - 尺寸标注仅 Ho/ph/rh 三根；直浇道/横浇道无文字标识（形状自明）
//   - 图底部注释 Ho/ph/rh 含义
// ============================================================

import { t } from '../i18n/index.js';

export const POSITIONS = ['顶注', '中注', '底注'];

/** 内浇口中心层 y（Ho 基准，入口深度随浇注方向） */
const GY = { 顶注: 102, 中注: 150, 底注: 196 };

/** 竖尺寸线：两端箭头 + 基准短线 + 短标（文字在线外侧，不压线） */
function dimV(x, y1, y2, label, textX, textY, markerId) {
  return `
  <line x1="${x - 4}" y1="${y1}" x2="${x + 4}" y2="${y1}" stroke="#64748b" stroke-width="0.9"/>
  <line x1="${x - 4}" y1="${y2}" x2="${x + 4}" y2="${y2}" stroke="#64748b" stroke-width="0.9"/>
  <line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="#0f172a" stroke-width="1"
        marker-start="url(#${markerId})" marker-end="url(#${markerId})"/>
  <text x="${textX}" y="${textY}" font-size="10" fill="#0f172a" font-weight="600" dominant-baseline="middle" text-anchor="end">${label}</text>`;
}

/** 浇注方向示意图（顶注/中注/底注）；非法 pos 返回 null（view 层不渲染） */
export function gatingDiagramSvg(pos) {
  if (!POSITIONS.includes(pos)) return null;
  const gy = GY[pos];
  const mid = `arr_${pos}`;
  const gateLblY = pos === '顶注' ? gy + 12 : gy - 12;   // 内浇口标签：顶注放条下，其余放条上

  return `<svg viewBox="0 0 340 265" width="100%" role="img" aria-label="${t('{pos}浇注方向示意图', [t(pos)])}" xmlns="http://www.w3.org/2000/svg" style="background:#fafafa;border:1px solid #e2e8f0;border-radius:8px">
  <defs>
    <marker id="${mid}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#0f172a"/>
    </marker>
  </defs>
  <style>.cap{font-size:9px;fill:#475569;paint-order:stroke;stroke:#ffffff;stroke-width:2.5}</style>

  <!-- 浇注方向（浇口杯上方） -->
  <line x1="255" y1="2" x2="255" y2="6" stroke="#dc2626" stroke-width="1.6" marker-end="url(#${mid})"/>

  <!-- 浇口杯：倒梯形（橙），底宽 = 直浇道顶宽，与直浇道中心对齐成连续收窄 -->
  <polygon points="236,7 274,7 264,24 246,24" fill="#ffe8cc" stroke="#e8590c" stroke-width="1.1"/>
  <text x="232" y="15" class="cap" text-anchor="end">${t('浇口杯')}</text>

  <!-- 直浇道：垂直梯形上宽下窄（橙），穿过横浇道后下延一段 -->
  <polygon points="246,24 264,24 260,${gy + 8} 250,${gy + 8}" fill="#ffd8a8" stroke="#e8590c" stroke-width="1.1"/>

  <!-- 横浇道：扁长横条（浅蓝，厚8），从直浇道底部向左延伸 -->
  <rect x="235" y="${gy - 4}" width="23" height="8" fill="#a5d8ff" stroke="#1c7ed6" stroke-width="1"/>

  <!-- 内浇口：横浇道前端同轴延伸（深蓝，厚4=横浇道一半），伸入铸件 -->
  <rect x="215" y="${gy - 2}" width="20" height="4" fill="#1971c2"/>
  <text x="207" y="${gateLblY}" class="cap">${t('内浇口')}</text>

  <!-- 砂箱：闭合矩形最宽（右沿到图片边），包住浇道/铸件/冒口（浇口杯在框外） -->
  <rect x="15" y="25" width="322" height="195" fill="none" stroke="#0f172a" stroke-width="2.2"/>
  <text x="300" y="19" class="cap">${t('上箱面')}</text>
  <text x="300" y="230" class="cap">${t('下箱面')}</text>

  <!-- 冒口（黄，窄于铸件） -->
  <rect x="155" y="35" width="60" height="60" fill="#fef3c7" stroke="#b45309" stroke-width="1.2"/>
  <text x="185" y="68" font-size="10" fill="#7a4b06" text-anchor="middle" font-weight="600">${t('冒口')}</text>

  <!-- 铸件（灰）：铸件底 200 → 铸件顶 95 -->
  <rect x="135" y="95" width="100" height="105" fill="#e2e8f0" stroke="#334155" stroke-width="1.2"/>
  <text x="185" y="150" font-size="10" fill="#334155" text-anchor="middle" font-weight="600">${t('铸件')}</text>

  <!-- Ho：内浇口中心层(gy) → 上箱面(25)，贴近直浇道右侧 -->
  ${dimV(292, gy, 25, 'Ho', 286, (gy + 25) / 2, mid)}

  <!-- rh（冒口高，左侧贴冒口）/ ph（铸件浇注方向高，左侧贴铸件），两线错开 -->
  ${dimV(144, 35, 95, 'rh', 138, 65, mid)}
  ${dimV(118, 95, 200, 'ph', 112, 147, mid)}

  <!-- 底部注释：三个输入含义 -->
  <text x="18" y="238" font-size="9" fill="#64748b">${t('diag.ho')}</text>
  <text x="18" y="250" font-size="9" fill="#64748b">${t('diag.ph')}</text>
  <text x="18" y="262" font-size="9" fill="#64748b">${t('diag.rh')}</text>
</svg>`;
}
