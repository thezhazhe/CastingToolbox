// ============================================================
// STL Diagnostic（命令 10.txt 第一节）：导入后完整链路数据
// 纯函数，Node 可测；UI 在 debug 面板渲染。
// 输出：bbox / 几何质量 / 距离场统计 / 厚壁代表采样点 / INSUF 具体原因
// ============================================================
import { computeBounds, computeVolume } from './stl.js';
import { validateMesh } from './meshValidation.js';
import { buildDistanceField } from './distanceField.js';

/**
 * 全链路诊断
 * @param {object} mesh  解析后的 STL 网格
 * @param {object} geometry  three 几何（buildMesh 结果）
 * @param {object} hs     analyzeHotspots 结果（可选：复用其 debug）
 * @returns 诊断数据对象（JSON 可序列化）
 */
export function diagnoseSTL(mesh, geometry, hs) {
  const bounds = computeBounds(mesh.vertices, mesh.triCount);
  const mdim = Math.max(...bounds.size);
  // 几何质量（validateMesh 复用）
  const mv = validateMesh(mesh);
  const vol = computeVolume(mesh.vertices, mesh.triCount);
  const d = hs?.debug || {};

  const out = {
    stl: {
      triCount: mesh.triCount,
      bboxMin: bounds.min, bboxMax: bounds.max,
      size: bounds.size, mdim: +mdim.toFixed(2),
      volumeCm3: +(vol / 1000).toFixed(2),
      assumedUnit: 'mm',   // 系统假设 STL 单位 = mm（命令 10.txt 十：明确报告）
    },
    quality: {
      watertight: mv.closed,
      issues: mv.issues?.map(i => ({ code: i.code, level: i.level, msg: i.msg })) || [],
    },
    distanceField: {
      gs: d.gs ?? null, vs: d.vs ?? null,
      insidePoints: d.insidePoints ?? null, totalPoints: d.totalPoints ?? null,
    },
    hotspot: { status: hs?.status ?? null, reason: hs?.reason ?? null, hotspots: hs?.hotspots?.length ?? 0 },
  };

  // 距离场厚度统计（诊断准确性优先：单独算一次距离场，与引擎同路径）
  if (geometry) {
    const df = buildDistanceField(mesh, geometry, {});
    out.distanceField = { gs: df.gs, vs: +df.vs.toFixed(3), insidePoints: df.insideIdx.length, totalPoints: df.gs ** 3 };
    out.thickness = thicknessStats(df);
  }
  return out;
}

/** 距离场 → 厚度统计 + 厚壁代表采样点（命令 10.txt 一.4） */
export function thicknessStats(df) {
  const dists = df.dists.filter(x => x !== null && x > 0.001).sort((a, b) => a - b);
  const n = dists.length;
  if (!n) return { samples: 0, status: 'INSUFFICIENT_NO_SAMPLE', reason: '距离场无有效采样：壁厚可能小于网格采样极限' };
  const pct = (q) => dists[Math.floor(n * q)];
  const vs = df.vs;
  const tP95 = pct(0.95) * 2, tMax = dists[n - 1] * 2;
  const voxels = tP95 / vs;
  const status = voxels < 1 ? 'INSUFFICIENT' : voxels < 2 ? 'LOW' : 'OK';
  const reason = voxels < 1
    ? `估计壁厚 ${tP95.toFixed(1)}mm 仅 ${voxels.toFixed(2)} voxel（vs=${vs.toFixed(2)}mm，由 bbox 主维 ${Math.max(...df.bounds.size).toFixed(0)}mm ÷ ${df.gs} 格决定）→ 无法可靠测厚`
    : voxels < 2 ? `估计壁厚 ${tP95.toFixed(1)}mm 仅 ${voxels.toFixed(2)} voxel → 精度低` : '';
  // 厚壁代表采样点（按距离降序取 5 个不同区域：跳过相邻格）
  const byIdx = df.dists.map((x, i) => ({ x, i })).filter(a => a.x !== null && a.x > 0.001).sort((a, b) => b.x - a.x);
  const picks = [];
  for (const a of byIdx) {
    if (picks.length >= 5) break;
    if (picks.some(p => Math.hypot(p.position[0] - df.pts[df.insideIdx[a.i]][0], p.position[1] - df.pts[df.insideIdx[a.i]][1], p.position[2] - df.pts[df.insideIdx[a.i]][2]) < vs * 2)) continue;
    const q = df.pts[df.insideIdx[a.i]];
    picks.push({ position: q.map(v => +v.toFixed(1)), thickness: +(a.x * 2).toFixed(2) });
  }
  return {
    samples: n, status, reason,
    min: +(dists[0] * 2).toFixed(2), p50: +(pct(0.5) * 2).toFixed(2),
    p90: +(pct(0.9) * 2).toFixed(2), p95: +tP95.toFixed(2), max: +tMax.toFixed(2),
    voxelsAcross: +voxels.toFixed(2),
    thickSamples: picks,
  };
}
