// ============================================================
// PHASE 1 追踪诊断（命令 8.txt）：重建粗扫 pipeline 定位 n=5 异常
// 以下内部函数为 hotspot.js 的诊断副本（仅本脚本使用，标注同步源行号）
// ============================================================
import { generate } from './hotspotGeometryGenerator.mjs';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { buildDistanceField } from '../../js/engine/distanceField.js';
import { HOTSPOT_DEFAULTS } from '../../js/engine/hotspotConfig.js';

/* ---- hotspot.js 诊断副本 ---- */
function idx3(i, j, k, dim) { return i * dim * dim + j * dim + k; }
function buildGrid(df) {
  const dim = df.gs;
  const grid = new Int32Array(dim * dim * dim).fill(-1);
  const gIdx = new Int32Array(df.insideIdx.length);
  const coord = new Int32Array(df.insideIdx.length * 3);
  for (let i = 0; i < df.insideIdx.length; i++) {
    const p = df.pts[df.insideIdx[i]];
    const gi = Math.min(dim - 1, Math.floor((p[0] - df.bounds.min[0]) / df.vs));
    const gj = Math.min(dim - 1, Math.floor((p[1] - df.bounds.min[1]) / df.vs));
    const gk = Math.min(dim - 1, Math.floor((p[2] - df.bounds.min[2]) / df.vs));
    grid[idx3(gi, gj, gk, dim)] = i;
    gIdx[i] = idx3(gi, gj, gk, dim);
    coord[i * 3] = gi; coord[i * 3 + 1] = gj; coord[i * 3 + 2] = gk;
  }
  return { grid, gIdx, coord };
}
function localMaxima(df, score, grid, coord, minScore) {
  const dim = df.gs;
  const n = score.length;
  const localMax = [];
  for (let i = 0; i < n; i++) {
    if (score[i] < minScore) continue;
    const gi = coord[i * 3], gj = coord[i * 3 + 1], gk = coord[i * 3 + 2];
    let isMax = true;
    for (let a = -1; a <= 1 && isMax; a++) for (let b = -1; b <= 1 && isMax; b++) for (let c = -1; c <= 1 && isMax; c++) {
      if (a === 0 && b === 0 && c === 0) continue;
      const ni = gi + a, nj = gj + b, nk = gk + c;
      if (ni < 0 || nj < 0 || nk < 0 || ni >= dim || nj >= dim || nk >= dim) continue;
      const idx = grid[idx3(ni, nj, nk, dim)];
      if (idx >= 0 && score[idx] > score[i]) isMax = false;
    }
    if (isMax) localMax.push({ i, gi, gj, gk, score: score[i] });
  }
  return localMax;
}
function nmsDedup(localMax, gap) {
  const candidates = [];
  for (const c of localMax.sort((a, b) => b.score - a.score)) {
    const dup = candidates.some(k =>
      Math.abs(k.gi - c.gi) <= gap && Math.abs(k.gj - c.gj) <= gap && Math.abs(k.gk - c.gk) <= gap);
    if (dup) continue;
    candidates.push(c);
  }
  return candidates;
}
function growRegions(df, score, candidates, coord, grid, o) {
  const n = score.length;
  const dim = df.gs;
  const regionId = new Int32Array(n).fill(-1);
  const regions = [];
  for (const c of candidates.sort((a, b) => b.score - a.score)) {
    if (regionId[c.i] >= 0) continue;
    const rid = regions.length;
    const thresh = c.score * o.growRatio;
    const cells = [];
    const queue = [c.i];
    regionId[c.i] = rid;
    while (queue.length) {
      const cur = queue.pop();
      cells.push(cur);
      const gi = coord[cur * 3], gj = coord[cur * 3 + 1], gk = coord[cur * 3 + 2];
      for (const [da, db, dc] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
        const ni = gi + da, nj = gj + db, nk = gk + dc;
        if (ni < 0 || nj < 0 || nk < 0 || ni >= dim || nj >= dim || nk >= dim) continue;
        const idx = grid[idx3(ni, nj, nk, dim)];
        if (idx < 0 || regionId[idx] >= 0 || score[idx] < thresh) continue;
        regionId[idx] = rid;
        queue.push(idx);
      }
    }
    cells.sort((a, b) => b - a);
    regions.push({ peakIdx: c.i, cells });
  }
  return regions;
}
function mergeOverlapping(regions, score) {
  const sorted = [...regions].sort((a, b) => score[b.peakIdx] - score[a.peakIdx]);
  const merged = [];
  for (const r of sorted) {
    const cells = new Set(r.cells);
    let owner = null;
    for (const m of merged) {
      let shared = 0;
      for (const c of r.cells) if (m.cellSet.has(c)) shared++;
      if (shared >= r.cells.length * 0.3) { owner = m; break; }
    }
    if (owner) {
      if (score[owner.peakIdx] < score[r.peakIdx]) owner.peakIdx = r.peakIdx;
      for (const c of r.cells) { owner.cellSet.add(c); owner.cells.push(c); }
    } else {
      merged.push({ peakIdx: r.peakIdx, cells: [...r.cells], cellSet: cells });
    }
  }
  return merged.map(m => ({ peakIdx: m.peakIdx, cells: m.cells }));
}

/* ---- 主流程 ---- */
const n = Number(process.argv[2] ?? 5);
const { mesh, gt } = generate('multipleBosses', { pl: [600, 500, 10], bs: [80, 80, 50], n });
const { geometry } = buildMesh(mesh);
const o = { ...HOTSPOT_DEFAULTS };

const df = buildDistanceField(mesh, geometry, o);
const score = new Float32Array(df.insideIdx.length);
let maxS = 0;
for (let i = 0; i < df.insideIdx.length; i++) {
  const d = df.dists[i];
  const s = d !== null && d > 0.001 ? d : 0;
  score[i] = s;
  if (s > maxS) maxS = s;
}
console.log(`粗扫: gs=${df.gs} vs=${df.vs.toFixed(2)} inside=${df.insideIdx.length} maxS=${maxS.toFixed(2)}`);

const { grid, coord } = buildGrid(df);
const maxima = localMaxima(df, score, grid, coord, maxS * o.CANDIDATE_FLOOR);
const candidates = nmsDedup(maxima, o.candidateNMS);
console.log(`\n候选（NMS 后 ${candidates.length} 个，score 降序）:`);
for (const c of candidates) {
  const p = df.pts[df.insideIdx[c.i]];
  console.log(`  score=${c.score.toFixed(2)} @(${p[0].toFixed(1)},${p[1].toFixed(1)},${p[2].toFixed(1)})`);
}

let regions = growRegions(df, score, candidates, coord, grid, o);
regions = mergeOverlapping(regions, score);
console.log(`\nRegion（grow+merge 后 ${regions.length} 个）:`);
for (const r of regions) {
  const p = df.pts[df.insideIdx[r.peakIdx]];
  const cellsMin = Math.min(...r.cells), cellsMax = Math.max(...r.cells);
  const boundsMin = df.pts[df.insideIdx[cellsMin]], boundsMax = df.pts[df.insideIdx[cellsMax]];
  console.log(`  #${regions.indexOf(r)} peak=${score[r.peakIdx].toFixed(2)} @(${p[0].toFixed(1)},${p[1].toFixed(1)},${p[2].toFixed(1)}) cells=${r.cells.length} cellsMin@(${boundsMin[0].toFixed(1)},${boundsMin[1].toFixed(1)},${boundsMin[2].toFixed(1)}) cellsMax@(${boundsMax[0].toFixed(1)},${boundsMax[1].toFixed(1)},${boundsMax[2].toFixed(1)})`);
}

console.log(`\nGT 凸台: ${gt.expectedHotspots.map(p => `(${p.x},${p.y})`).join(' ')}`);
