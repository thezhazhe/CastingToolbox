// ============================================================
// Hotspot 显示几何（PHASE 22 · 纯显示层，不碰计算坐标）
// 职责：热结 marker 的「显示半径」与「显示中心」——两者都只允许做
// 有几何依据的视觉修正，绝不覆盖引擎输出的计算坐标（hotspot.x/y/z）。
//
// 显示半径：displayRadius = clamp(k × hotSpotCharacteristicSize, minR, maxR)
//   - characteristicSize = 热结区域等效球半径 r_eq = (3V/4π)^(1/3)
//     （区域体积 V 是 V2/V3 都有的真实空间尺度数据；mc/modulus 是
//     V/A 类长度量，对显示太小——r_eq 反映热结实际占多大空间）
//   - minR / maxR 相对模型最小包围盒尺寸（小模型不遮零件，大模型不消失）
//
// 显示中心（命令文件 30.txt 五：三级规则）：
//   一级：引擎位置本身 = 热结区域内部采样点几何质心（V2 0.95 连通域 /
//         V3 region centroid——引擎已实现，此处不重算）
//   三级：沿局部壁厚方向（BVH 最近表面 → 局部法线）将 marker 调整到
//         有效厚度区间的中部——修正体素网格相位造成的"偏左/偏右"漂移
//   （均匀壁厚件中，region 质心 = 网格约束均值，偏差 ≤ vs/2 且随网格
//   相位左右摆；中面修正用真实几何把 marker 拉回局部壁厚中心）
//   四级：无法可靠计算（无远侧表面/修正超限）→ 保持引擎位置，
//         displayCenterReliable = false（供后续诊断，不强行修正）
// 纯引擎模块，Node 可测。
// ============================================================
import * as THREE from 'three';

export const DISPLAY_DEFAULTS = {
  radiusK: 1.0,               // 视觉比例系数：显示半径 = k × 区域等效半径
  minRadiusAbs: 2.5,          // 最小显示半径下限（mm，小热结仍可见）
  minRadiusRatio: 0.02,       // 最小显示半径 = max(下限, minSize × 此值)
  maxRadiusAbs: 8,            // 最大显示半径下限（mm）
  maxRadiusRatio: 0.25,       // 最大显示半径 = max(下限, minSize × 此值)（不遮零件）
  midplaneCapRatio: 0.5,      // 中面修正上限 = 此值 × 区域等效半径
                              //   （网格相位偏差 ≤ vs/2 ≤ 壁厚/4 ≈ r_eq/2；
                              //   超限 = 局部几何非壁型（T 交叉/长段），保持原位置）
  sameSurfaceEpsRatio: 0.02,  // 射线命中跳过同一表面（距离 < d×此比例）
};

/** 热结区域等效球半径（mm³ → mm）；无体积数据返回 null */
export function regionEqRadius(volumeMm3) {
  if (!volumeMm3 || volumeMm3 <= 0 || !Number.isFinite(volumeMm3)) return null;
  return Math.cbrt(3 * volumeMm3 / (4 * Math.PI));
}

/** 取热结区域体积（mm³）：regionVolumeMm3 → regionVolumeCm3×1000 → 0 */
function regionVolumeOf(hs) {
  if (hs.regionVolumeMm3 != null) return hs.regionVolumeMm3;
  if (hs.regionVolumeCm3 != null) return hs.regionVolumeCm3 * 1000;
  if (hs.regionVolume != null) return hs.regionVolume;   // V3 原生形态（mm³）
  return 0;
}

/** 取热结 ENGINE 坐标：[x,y,z] 或 V3 原生 position:[x,y,z] */
function hsPositionOf(hs) {
  if (hs.x != null) return [hs.x, hs.y, hs.z];
  return hs.position ? [hs.position[0], hs.position[1], hs.position[2]] : null;
}

/**
 * 显示半径（显示层专用；hs.x/y/z/mc 等计算数据一律不修改）
 * @param {object} hs      {mc, regionVolumeCm3 或 regionVolumeMm3}
 * @param {number} minSize 模型最小包围盒尺寸（mm，ModelView3D 持有）
 * @returns {{radius, characteristic, minR, maxR}}
 */
export function displayRadiusFor(hs, minSize, opts = {}) {
  const o = { ...DISPLAY_DEFAULTS, ...opts };
  const minSizeSafe = minSize > 0 ? minSize : 1;
  let char = regionEqRadius(regionVolumeOf(hs));
  if (char === null) char = hs.mc > 0 ? hs.mc : 5;   // 无体积 → mc 兜底（Fake/旧数据）
  const minR = Math.max(o.minRadiusAbs, minSizeSafe * o.minRadiusRatio);
  const maxR = Math.max(o.maxRadiusAbs, minSizeSafe * o.maxRadiusRatio);
  return {
    radius: Math.min(Math.max(o.radiusK * char, minR), maxR),
    characteristic: char, minR, maxR,
  };
}

/**
 * 中面修正：沿局部壁厚方向把点调整到「有效厚度区间中部」。
 * 原理：C = 当前点；S = BVH 最近表面点（距离 d）；n̂ = (C−S)/d（指向材料内部）。
 * 从 C 沿 n̂ 射线，第一个越过 S 的命中 = 远侧表面（距离 d2）。
 * 中面 = (S + S2)/2 = C + n̂×(d2−d)/2。C 恰在中面时 d2=d → 零修正；
 * 体素相位偏 δ 时修正 δ 拉回中面。修正量超上限 → 几何非壁型，不强行。
 * @param {THREE.BufferGeometry} geometry buildMesh 结果（含 BVH）
 * @param {number[]} p ENGINE 坐标
 * @param {number} cap 修正上限（mm）
 * @returns {{position:number[], reliable:boolean, d:number|null, d2:number|null, delta:number|null, reason:string}}
 */
export function wallMidplaneCorrection(geometry, p, cap, opts = {}) {
  const o = { ...DISPLAY_DEFAULTS, ...opts };
  const bvh = geometry?.boundsTree;
  if (!bvh) return { position: p, reliable: false, d: null, d2: null, delta: null, reason: 'no-geometry' };

  const vec = new THREE.Vector3(p[0], p[1], p[2]);
  const target = new THREE.Vector3();
  const r = bvh.closestPointToPoint(vec, target, 0, Infinity);
  if (r === null) return { position: p, reliable: false, d: null, d2: null, delta: null, reason: 'no-closest-point' };
  const d = r.distance !== undefined ? r.distance : Math.sqrt(r.distanceSq);
  if (!(d > 1e-6)) return { position: p, reliable: false, d, d2: null, delta: null, reason: 'on-surface' };
  // 注意（mesh-bvh 0.9.13 API）：最近点写在返回对象的 .point 字段（Vector3），
  // 不是传入的 target——mesh3d.distanceLoop 只读 distance 所以未暴露该差异。
  const S = r.point;
  if (!S) return { position: p, reliable: false, d, d2: null, delta: null, reason: 'no-closest-point' };

  // 局部法线：表面 → 点（指向材料内部）
  const n = new THREE.Vector3(p[0] - S.x, p[1] - S.y, p[2] - S.z).normalize();
  // 射线求远侧表面（DoubleSide 必须：从内部发射会先穿过最近表面三角）
  const raycaster = new THREE.Raycaster();
  const tmpMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  raycaster.set(vec, n);
  const hits = raycaster.intersectObject(tmpMesh, false);
  tmpMesh.material.dispose();
  let d2 = null;
  const eps = d * o.sameSurfaceEpsRatio;
  for (const h of hits) { if (h.distance > d + eps) { d2 = h.distance; break; } }
  if (d2 === null) return { position: p, reliable: false, d, d2: null, delta: null, reason: 'no-far-surface' };

  const delta = (d2 - d) / 2;
  if (Math.abs(delta) > cap) {
    return { position: p, reliable: false, d, d2, delta, reason: 'over-cap' };
  }
  return {
    position: [p[0] + n.x * delta, p[1] + n.y * delta, p[2] + n.z * delta],
    reliable: true, d, d2, delta,
    reason: 'midplane',
  };
}

/**
 * 热结显示中心（显示层专用）：引擎位置 + 有界中面修正。
 * @param {THREE.BufferGeometry} geometry
 * @param {object} hs {x,y,z,mc,regionVolumeCm3|regionVolumeMm3}
 * @returns {{displayPosition:[x,y,z], displayCenterReliable:boolean, correction:object}}
 */
export function displayCenterFor(geometry, hs, opts = {}) {
  const o = { ...DISPLAY_DEFAULTS, ...opts };
  const p = hsPositionOf(hs);
  if (!p) return { displayPosition: [0, 0, 0], displayCenterReliable: false, correction: { reason: 'no-position' } };
  const char = regionEqRadius(regionVolumeOf(hs)) ?? (hs.mc > 0 ? hs.mc : 5);
  const cap = char * o.midplaneCapRatio;
  const c = wallMidplaneCorrection(geometry, p, cap, o);
  return {
    displayPosition: c.position,
    displayCenterReliable: c.reliable,
    correction: { d: c.d, d2: c.d2, delta: c.delta, reason: c.reason },
  };
}
