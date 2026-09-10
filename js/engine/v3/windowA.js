// ============================================================
// V3 Local A：窗口内冷却表面积（12.txt §11 — 最重要的技术点）
// 只计"与模具接触的真实外表面"，窗口切割的人工截面严禁计入。
//
// 主方案（距离场法）：A ≈ nShell × vs²
//   窗口微网格中"表面层点"（距表面 ≤ 1 层 vs）的数量 × 面元面积。
//   物理依据：薄壳体积 V_shell = A × t（t→0）→ A = V_shell/t = nShell·vs³/vs。
//   优点：成本 O(窗口微网格点)，与模型三角片数无关——shapecast 全模型遍历
//   的 O(N×M) 灾难（实心件窗口≈全模型时实测卡死）被彻底规避。
//   人工截面免疫：内部微网格点距表面>vs → 不计（窗口切割面不是表面）。
//   已知代价：微网格相位敏感 → 由多尺度稳定性 + 粗/细化场平均抑制（12.txt §30）。
//
// 备选（PHASE 3 benchmark 对比）：shapecast 质心法 / 精确裁剪法（保留导出）。
// 纯引擎模块，Node 可测。
// ============================================================
import { distanceToSurface } from '../mesh3d.js';
import { V3_DEFAULTS } from './configV3.js';

/**
 * 距离场法冷却面积：窗口内表面层点（距表面 ≤ vs）数 × vs²
 * @param {THREE.BufferGeometry} geometry
 * @param {{insidePts:number[][], vs:number}} win  windowScan 结果
 * @param {number} [layerRatio] 表面层厚度系数（默认 1.0 层）
 * @returns {{area:number, nShell:number, nInside:number, ms:number}}
 */
export function areaFromScan(geometry, win, layerRatio = 1.0) {
  const t0 = Date.now();
  const t = win.vs * layerRatio;
  const insidePts = win.insidePts;
  const dists = distanceToSurface(geometry, insidePts);
  let nShell = 0;
  for (const d of dists) if (d !== null && d <= t) nShell++;
  const area = nShell * win.vs * win.vs;
  return { area, nShell, nInside: insidePts.length, ms: Date.now() - t0 };
}

/* ---- 备选方法（PHASE 3 benchmark 对比用，默认不走） ---- */

/**
 * shapecast 质心法：窗口内三角片（质心在窗口内）面积和
 * 局限：窗口内三角片数与模型规模成正比（实心件窗口≈全模型时 O(N) 退化）
 */
export function coolingAreaCentroid(geometry, p, R, type = 'cube') {
  const t0 = Date.now();
  let area = 0, tris = 0;
  const boundsTree = geometry.boundsTree;
  if (!boundsTree) throw new Error('coolingAreaCentroid: geometry 缺少 boundsTree（需 buildMesh）');
  const center = { x: p[0], y: p[1], z: p[2] };
  const r2 = R * R;
  boundsTree.shapecast({
    intersectsBounds: (box) => {
      if (type === 'cube') {
        return box.min.x < p[0] + R && box.max.x > p[0] - R &&
               box.min.y < p[1] + R && box.max.y > p[1] - R &&
               box.min.z < p[2] + R && box.max.z > p[2] - R;
      }
      const cx = Math.max(box.min.x, Math.min(center.x, box.max.x)) - center.x;
      const cy = Math.max(box.min.y, Math.min(center.y, box.max.y)) - center.y;
      const cz = Math.max(box.min.z, Math.min(center.z, box.max.z)) - center.z;
      return cx * cx + cy * cy + cz * cz <= r2;
    },
    intersectsTriangle: (tri) => {
      const mid = tri.getMidpoint();
      if (type === 'cube') {
        if (mid.x < p[0] - R || mid.x > p[0] + R || mid.y < p[1] - R || mid.y > p[1] + R || mid.z < p[2] - R || mid.z > p[2] + R) return;
      } else if ((mid.x - p[0]) ** 2 + (mid.y - p[1]) ** 2 + (mid.z - p[2]) ** 2 > r2) return;
      area += tri.getArea();
      tris++;
    },
  });
  return { area, tris, ms: Date.now() - t0 };
}

/** 统一入口：默认距离场法；areaMethod='centroid' 走 shapecast 质心法（对比用） */
export function localArea(geometry, p, R, opts = {}, win = null) {
  const o = { ...V3_DEFAULTS, ...opts };
  if (o.areaMethod === 'centroid') return coolingAreaCentroid(geometry, p, R, o.windowType === 'sphere' ? 'sphere' : 'cube');
  if (!win) throw new Error('localArea(距离场法) 需要 windowScan 结果 win');
  return areaFromScan(geometry, win);
}
