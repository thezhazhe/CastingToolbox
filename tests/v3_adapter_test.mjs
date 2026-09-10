// ============================================================
// PHASE 16-A 测试（17.txt 十五 L：V3 正确接入 Design Center）
// 验证 v3ViewAdapter：字段映射（peakModulus→mc、regionVolume→regionVolumeCm3、
//   position→x/y/z）、V2 消费兼容字段完整性、空结果/状态透传、采样 WARNING。
// 纯引擎层测试（Node，不依赖 DOM）；designCenter 调用点替换由字段契约保证。
// ============================================================
import { MODELS } from './engineering-generated/gen_engineering.mjs';
import { tetMC, BOX } from './helpers/stlGen.js';
import { pickRes } from './tools/hotspotGeometryGenerator.mjs';
import { buildMesh } from '../js/engine/mesh3d.js';
import { analyzeHotspotsV3 } from '../js/engine/v3/hotspotV3.js';
import { toViewResult } from '../js/engine/v3/v3ViewAdapter.js';
import { HS_STATUS } from '../js/engine/hotspot.js';

/** SDF → 网格（tetMC + padding，与 phase15 同法） */
const pad2 = (b, e = 4) => [b[0].map(v => v - e), b[1].map(v => v + e)];
function meshOf(sdf, bounds, mdim, minFeature) {
  const mesh = { vertices: tetMC(sdf, pad2(bounds), pickRes(mdim, minFeature)), triCount: 0 };
  mesh.triCount = mesh.vertices.length / 9;
  return mesh;
}
function runV3(mesh, geom = {}) {
  const geometry = buildMesh(mesh).geometry;
  const raw = analyzeHotspotsV3(mesh, geometry);
  return { raw, view: toViewResult(raw, geom) };
}
/** 断言设计中心消费点字段齐全（writeHotspotsToProject/3D 标记/热结列表/logDebug） */
function assertViewShape(h) {
  if (typeof h.id !== 'number') throw new Error('缺 id');
  for (const k of ['x', 'y', 'z']) if (typeof h[k] !== 'number' || !Number.isFinite(h[k])) throw new Error(`缺/非法 ${k}`);
  if (typeof h.mc !== 'number' || !(h.mc > 0)) throw new Error(`缺/非法 mc=${h.mc}`);
  if (typeof h.regionVolumeCm3 !== 'number' || !(h.regionVolumeCm3 > 0)) throw new Error(`缺/非法 regionVolumeCm3=${h.regionVolumeCm3}`);
  if (typeof h.confidence !== 'number') throw new Error('缺 confidence');
  if (!Array.isArray(h.peaks) || typeof h.peaks[0]?.score !== 'number') throw new Error('缺 peaks[0].score');
}
function assertDebugShape(d) {
  for (const k of ['gs', 'vs', 'insidePoints', 'totalPoints', 'candidates', 'regions', 'peaks', 'rejected', 'elapsedMs']) {
    if (typeof d[k] !== 'number') throw new Error(`debug 缺字段 ${k}`);
  }
  if (!d.v3?.coarse) throw new Error('debug 缺 v3 原始信息');
}

export const tests = [
  {
    name: '16-A.1 t01_boss100：字段映射正确（mc/regionVolumeCm3/x-y-z/peaks/confidence）',
    fn() {
      const { sdf, bounds } = MODELS.find(m => m.id === 't01_boss100').build();
      const mesh = meshOf(sdf, bounds, 500, 20);
      const { raw, view: r } = runV3(mesh);
      if (r.engine !== 'v3') throw new Error('engine 标记缺失');
      if (r.status !== HS_STATUS.OK) throw new Error(`期望 OK，实际 ${r.status}`);
      if (r.hotspots.length < 1) throw new Error('t01 应检出 ≥1 热结');
      const h = r.hotspots[0];
      // 与原始 V3 结果逐字段对照（peakModulus→mc、regionVolume→cm³、position→x/y/z）
      const raw0 = raw.hotspots[0];
      if (h.mc !== raw0.peakModulus) throw new Error(`mc=${h.mc} ≠ peakModulus=${raw0.peakModulus}`);
      if (h.regionVolumeCm3 !== +(raw0.regionVolume / 1000).toFixed(2)) throw new Error(`regionVolumeCm3=${h.regionVolumeCm3} ≠ ${raw0.regionVolume / 1000}`);
      if (h.x !== raw0.position[0] || h.y !== raw0.position[1] || h.z !== raw0.position[2]) throw new Error('x/y/z ≠ position');
      if (h.peaks[0].score !== h.mc) throw new Error('peaks[0].score ≠ mc');
      if (h.id !== 1) throw new Error(`主热结 id 应为 1，实际 ${h.id}`);
      if (h.confidence < 0 || h.confidence > 1) throw new Error(`confidence 越界 ${h.confidence}`);
      assertViewShape(h);
      assertDebugShape(r.debug);
    },
  },
  {
    name: '16-A.2 t05_threeSizes：多热结排序 + id 顺序（H1 最大 M）',
    fn() {
      const { sdf, bounds } = MODELS.find(m => m.id === 't05_threeSizes').build();
      const mesh = meshOf(sdf, bounds, 700, 20);
      const { view: r } = runV3(mesh);
      if (r.status !== HS_STATUS.OK) throw new Error(`期望 OK，实际 ${r.status}`);
      if (r.hotspots.length < 2) throw new Error(`t05 应检出 ≥2 热结，实际 ${r.hotspots.length}`);
      r.hotspots.forEach(assertViewShape);
      // 按 mc 降序（V3 输出已排序，Adapter 保序）
      for (let i = 1; i < r.hotspots.length; i++) {
        if (r.hotspots[i].mc > r.hotspots[i - 1].mc) throw new Error('热结未按 M 降序');
      }
      r.hotspots.forEach((h, i) => {
        if (h.id !== i + 1) throw new Error(`id 应连续 1-based，第 ${i} 个 id=${h.id}`);
      });
    },
  },
  {
    name: '16-A.3 均匀板：NO_HOTSPOT 状态 + 空数组透传 + debug 兼容',
    fn() {
      const L = 400, W = 400, T = 20;
      const b = [[-L / 2, -W / 2, -T / 2], [L / 2, W / 2, T / 2]];
      const mesh = meshOf(BOX(b[0], b[1]), b, L, T);
      const { view: r } = runV3(mesh, { wallMax: T, wallMain: T });
      if (r.status !== HS_STATUS.NO_HOTSPOT) throw new Error(`均匀板期望 NO_HOTSPOT，实际 ${r.status}`);
      if (!Array.isArray(r.hotspots) || r.hotspots.length !== 0) throw new Error('空结果应为空数组');
      assertDebugShape(r.debug);
      if (r.sampling?.warning) throw new Error(`均匀板不应有采样 WARNING：${r.sampling.detail}`);
      if (!r.reason) throw new Error('空结果应带 reason');
    },
  },
  {
    name: '16-A.4 薄壁大板（400×400×3）：采样 WARNING 触发（17.txt 十三）',
    fn() {
      const L = 400, W = 400, T = 3;
      const b = [[-L / 2, -W / 2, -T / 2], [L / 2, W / 2, T / 2]];
      const mesh = meshOf(BOX(b[0], b[1]), b, L, T);
      // 真实壁厚 3mm 由几何分析提供（vs≈5mm > wallMax=3mm → 判据②触发）
      const { view: r } = runV3(mesh, { wallMax: 3, wallMain: 3 });
      if (!r.sampling?.warning) throw new Error(`薄壁板应触发采样 WARNING，实际 ${JSON.stringify(r.sampling)}`);
      if (!(r.sampling.vs > 3)) throw new Error(`采样格应大于壁厚，实际 vs=${r.sampling.vs}`);
      if (!r.sampling.detail) throw new Error('WARNING 缺 detail 文案');
    },
  },
  {
    name: '16-A.4b 判据单元：大薄板（1000mm + 10mm 壁）触发 WARNING 且 fallback 被识别（PHASE 17）',
    fn() {
      // 构造 V3 结果（不跑真模型）：探测失败兜底 estMinWall=25（=mdim/40）、vs=12.5
      // + 几何主体壁厚 10mm → 主体/vs=0.8<2 → 🟠 resolution（PHASE 17：兜底路径由主体层数判据接管）
      const fakeV3 = {
        status: 'NO_HOTSPOT', reason: 'no_candidate', hotspots: [], audit: [],
        metrics: {}, debug: { coarse: { gs: 80, vs: 12.5, estMinWall: 25, pts: 100, stride: 1, peaks: 0 } },
      };
      const r = toViewResult(fakeV3, { wallMax: 10, wallMain: 10, wallAvg: 9.6 });
      if (!r.sampling?.warning) throw new Error(`大薄板应触发 WARNING，实际 ${JSON.stringify(r.sampling)}`);
      if (r.sampling.level !== 'resolution') throw new Error(`应分级为 resolution，实际 ${r.sampling.level}`);
      if (r.sampling.minWallReliable !== false) throw new Error(`fallback 路径应标记 minWallReliable=false，实际 ${r.sampling.minWallReliable}`);
      // body=wallAvg=9.6（wallMain=10 未通过区间校验：10 > 0.9×wallMax=9）→ 层数=9.6/12.5=0.77
      if (Math.abs(r.sampling.layers - 0.77) > 0.01) throw new Error(`层数应为主体壁厚/vs=0.77（PHASE 17 语义），实际 ${r.sampling.layers}`);
    },
  },
  {
    name: '16-A.4c 判据单元：正常板（300×300×20）不触发 WARNING',
    fn() {
      const L = 300, W = 300, T = 20;
      const b = [[-L / 2, -W / 2, -T / 2], [L / 2, W / 2, T / 2]];
      const mesh = meshOf(BOX(b[0], b[1]), b, L, T);
      const { view: r } = runV3(mesh, { wallMax: 20, wallMain: 20 });
      if (r.sampling?.warning) throw new Error(`正常板不应触发 WARNING：${r.sampling?.detail}`);
    },
  },
  {
    name: '16-A.5 V2 消费契约：writeHotspotsToProject 所需字段逐项存在',
    fn() {
      const { sdf, bounds } = MODELS.find(m => m.id === 't03_twoDiff_60_100').build();
      const mesh = meshOf(sdf, bounds, 600, 20);
      const { view: r } = runV3(mesh);
      if (r.status !== HS_STATUS.OK) throw new Error(`期望 OK，实际 ${r.status}`);
      r.hotspots.forEach(h => {
        assertViewShape(h);
        // 3D 标记（designCenter restore/importFile 平移后 setHotspots）：只读 x/y/z + 可选 regionBBox
        if (![h.x, h.y, h.z].every(Number.isFinite)) throw new Error('3D 标记坐标不可用');
        // writeHotspotsToProject 的 round 路径不越界
        const mcRound = Math.round(h.mc * 10) / 10;
        const volRound = Math.round(h.regionVolumeCm3 * 100) / 100;
        if (!(mcRound > 0) || !(volRound > 0)) throw new Error('round 后非法值');
      });
    },
  },
  {
    name: '16-A.6 空状态 debug.v3 保留：采样信息可供 16-C/D 的模型信息卡使用',
    fn() {
      const { sdf, bounds } = MODELS.find(m => m.id === 't02_thin10_boss60').build();
      const mesh = meshOf(sdf, bounds, 500, 10);
      const { view: r } = runV3(mesh, { wallMax: 10, wallMain: 10 });
      const c = r.debug.v3.coarse;
      if (!(c.vs > 0) || !(c.estMinWall > 0)) throw new Error('debug.v3.coarse 缺采样信息');
      if (r.sampling && typeof r.sampling.ok !== 'boolean') throw new Error('sampling.ok 缺失');
    },
  },
];
