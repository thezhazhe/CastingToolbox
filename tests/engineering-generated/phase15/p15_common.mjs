// ============================================================
// PHASE 15 共享工具（命令 15.txt）：V3 运行包装 + 旋转逆变换 + 热点匹配
// 只读验证基础设施——不修改 V3 核心，不调参
// ============================================================
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMesh } from '../../../js/engine/mesh3d.js';
import { analyzeHotspotsV3 } from '../../../js/engine/v3/hotspotV3.js';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(HERE, 'data');

/** 运行 V3 一次（含 buildMesh），返回 {v3, parseMs, engineMs} */
export function runV3(mesh) {
  const t1 = Date.now();
  const geometry = buildMesh(mesh).geometry;
  const t2 = Date.now();
  const v3 = analyzeHotspotsV3(mesh, geometry);
  return { v3, parseMs: t2 - t1, engineMs: Date.now() - t2 };
}

/** 90° 旋转的逆变换（旋转结果 → 原坐标系） */
export const invRX90 = (p) => [p[0], p[2], -p[1]];   // RX90: (x,y,z)→(x,−z,y)
export const invRY90 = (p) => [-p[2], p[1], p[0]];   // RY90: (x,y,z)→(z,y,−x)
export const invRZ90 = (p) => [p[1], -p[0], p[2]];   // RZ90: (x,y,z)→(−y,x,z)

/** 基准热点与变体热点（已逆变换）的最近邻匹配，返回配对列表 */
export function matchPairs(base, moved, tol) {
  const pairs = [];
  const usedBase = new Set();
  const extra = [];   // moved 中找不到基准的（新增）
  for (let mi = 0; mi < moved.length; mi++) {
    const h = moved[mi];
    let best = -1, bd = Infinity;
    base.forEach((b, i) => {
      if (usedBase.has(i)) return;
      const d = Math.hypot(h[0] - b[0], h[1] - b[1], h[2] - b[2]);
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0 && bd <= tol) { usedBase.add(best); pairs.push({ base: best, moved: mi, dist: bd }); }
    else extra.push(h);
  }
  const missing = base.map((_, i) => i).filter(i => !usedBase.has(i));
  return { pairs, extra, missing };
}

/** 单一检查项判定：PASS/WARNING/FAIL */
export const verdict = (ok, warn, val, passTxt, warnTxt) => (ok ? 'PASS' : warn ? 'WARNING' : 'FAIL');

/** 位置容差：max(25mm, 3×vs)（vs = 体素尺寸；25mm 覆盖已知代表点相位偏移 ~39mm 的工程容差） */
export const posTol = (vs) => Math.max(25, 3 * vs);

/** 排序判定：M 序与基准一致，或仅 <10% M 差的结构翻转（网格相位 ±10% 精度限制） */
export function rankCheck(baseMs, movedMs) {
  for (let i = 0; i < Math.min(baseMs.length, movedMs.length) - 1; i++) {
    const a = movedMs[i], b = movedMs[i + 1];
    if (a < b && (b - a) > 0.10 * b) return false;
  }
  return true;
}
