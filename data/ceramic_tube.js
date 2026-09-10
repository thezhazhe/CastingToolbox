// ============================================================
// 内浇道瓷管规格（企业工艺设计说明书 V3.2.2「浇注系统形式」瓷管规格表）
// 规格：F25/F35/F40/F50/F60/F70；a=内径 mm（过流内孔），b/c=外形尺寸，d=壁厚
// 来源：工艺设计说明书-V3.2.2-2.xlsx 浇注系统形式 瓷管规格（企业标准）
// ============================================================

export const CERAMIC_TUBES = [
  { id: 'F25', inner: 22, outerW: 40, outerH: 45, wall: 3 },
  { id: 'F35', inner: 32, outerW: 55, outerH: 60, wall: 3 },
  { id: 'F40', inner: 37, outerW: 60, outerH: 65, wall: 4 },
  { id: 'F50', inner: 47, outerW: 70, outerH: 75, wall: 4 },
  { id: 'F60', inner: 57, outerW: 80, outerH: 85, wall: 5 },
  { id: 'F70', inner: 67, outerW: 95, outerH: 100, wall: 5 },
];

/**
 * 内浇道直径建议（PHASE 45-B）：按阻流参考面积÷个数反推直径，
 * 匹配企业瓷管规格——首个内径 ≥ 需求直径的规格（保守保证过流）；
 * 超出最大规格（>F70 内径 67）→ 返回 outOfRange=true，不伪造建议。
 * @param {number} d 需求直径 mm（圆形内浇道）
 * @returns {{tube, d} | {outOfRange: true, d, maxInner}} 匹配建议或超出提示
 */
export function suggestCeramicTube(d) {
  if (!(d > 0)) return null;
  const tube = CERAMIC_TUBES.find(t => t.inner >= d) || null;
  if (!tube) return { outOfRange: true, d, maxInner: CERAMIC_TUBES[CERAMIC_TUBES.length - 1].inner };
  return { tube, d };
}
