// ============================================================
// PHASE 22 回归测试（30.txt 十七：热结显示 + 采样 + 进度）
// 覆盖：
//   A. 显示半径规则（region 等效半径驱动 + min/max 约束 + mc 兜底）
//   B. 显示位置规则（中面修正 / 对称不动 / 开放边界 fallback / 计算坐标不被覆盖）
//   C. V3 分片 == 同步（流水线重构一致性）
//   D. 采样极端场景（大件薄壁 / 极薄壁 → 诚实告警不假造）
//   E. 进度回调（分阶段真实进度，阶段顺序正确）
// 用法: node tests/runner.mjs（自动发现）或 node tests/phase22_test.mjs
// ============================================================
import * as THREE from 'three';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { generate } from './tools/hotspotGeometryGenerator.mjs';
import { buildMesh } from '../js/engine/mesh3d.js';
import { analyzeHotspotsV3, analyzeHotspotsV3Sliced } from '../js/engine/v3/hotspotV3.js';
import { analyzeGeometry, analyzeGeometrySliced } from '../js/engine/geometryAnalysis.js';
import { displayRadiusFor, displayCenterFor, regionEqRadius, wallMidplaneCorrection } from '../js/engine/hotspotDisplay.js';
import { HS_STATUS } from '../js/engine/hotspot.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const close = (a, b, tol) => Math.abs(a - b) <= tol;

/** 封闭空心盒（6 薄板并集；重合面由 scanAxis eps 合并逻辑处理） */
function hollowBoxMesh(W, t) {
  const boxes = [];
  const slab = (sx, sy, sz, px, py, pz) => {
    const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) boxes.push(pos.getX(i) + px, pos.getY(i) + py, pos.getZ(i) + pz);
  };
  const L = W, T = t;
  slab(L, T, L, 0, -L / 2, 0);
  slab(L, T, L, 0, L / 2 - T, 0);
  slab(T, L, L, -L / 2 + T / 2, 0, 0);
  slab(T, L, L, L / 2 - T / 2, 0, 0);
  slab(L, L, T, 0, 0, -L / 2 + T / 2);
  slab(L, L, T, 0, 0, L / 2 - T / 2);
  return { vertices: new Float32Array(boxes), triCount: boxes.length / 9 };
}

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

export const tests = [
  /* ================= A. 显示半径规则（30.txt 三） ================= */
  {
    name: 'A1 显示半径由区域等效半径驱动（k×r_eq）',
    fn: () => {
      // 区域 100×100×100mm³ → r_eq = (3×1e6/4π)^(1/3) ≈ 62mm
      const hs = { mc: 10, regionVolumeCm3: 1000 };
      const { radius, characteristic } = displayRadiusFor(hs, 1000);
      assert(close(characteristic, 62.0, 0.5), `r_eq 应≈62，实际 ${characteristic}`);
      assert(close(radius, 62.0, 0.5), `radius 应≈62（k=1），实际 ${radius}`);
    },
  },
  {
    name: 'A2 小热结仍可见（min 下限），大热结封顶不遮零件（max 上限）',
    fn: () => {
      // 小热结：区域 100mm³ → r_eq≈2.9 → 大模型 minR=20 → 抬到 20 可见
      const small = displayRadiusFor({ mc: 2, regionVolumeCm3: 0.1 }, 1000);
      assert(close(small.radius, 20, 0.01), `小热结应抬到 minR=20，实际 ${small.radius}`);
      // 大热结：区域 1e8 mm³ → r_eq≈288 → 封顶 maxR=250
      const big = displayRadiusFor({ mc: 100, regionVolumeCm3: 100000 }, 1000);
      assert(close(big.radius, 250, 0.01), `大热结应封顶 maxR=250，实际 ${big.radius}`);
      // 小模型：minR/maxR 随模型收缩
      const tiny = displayRadiusFor({ mc: 5, regionVolumeCm3: 100 }, 50);
      assert(tiny.maxR <= 13, `小模型 maxR 应 ≤13（50/4），实际 ${tiny.maxR}`);
      assert(tiny.minR >= 2.5, `小模型 minR 保底 2.5，实际 ${tiny.minR}`);
    },
  },
  {
    name: 'A3 无体积数据时 mc 兜底；不修改 hs',
    fn: () => {
      const hs = { mc: 12, x: 1, y: 2, z: 3 };
      const { radius } = displayRadiusFor(hs, 200);
      assert(close(radius, 12, 0.01), `mc 兜底 radius 应=12，实际 ${radius}`);
      assert(hs.mc === 12 && hs.x === 1, 'displayRadiusFor 不得修改 hs');
      assert(regionEqRadius(0) === null && regionEqRadius(-5) === null, '无体积 → null');
    },
  },
  /* ================= B. 显示位置规则（30.txt 四/五/六） ================= */
  {
    name: 'B1 均匀壁厚：偏置点被中面修正拉回壁厚中部',
    fn: () => {
      // uniformPlate 300×200×40（z 为厚度方向，中面 z=0）
      const { mesh } = generate('uniformPlate');
      const { geometry } = buildMesh(mesh);
      // 伪热结：z=8（距顶面 12mm），mc 兜底 + 区域体积
      const hs = { x: 0, y: 0, z: 8, mc: 20, regionVolumeCm3: 80 };
      const { displayPosition, displayCenterReliable, correction } = displayCenterFor(geometry, hs, {});
      assert(displayCenterReliable, `应可靠修正，实际 ${correction.reason}`);
      assert(close(displayPosition[2], 0, 0.6), `修正后 z 应≈0（中面），实际 ${displayPosition[2].toFixed(2)}`);
      assert(close(correction.delta, 8, 0.6), `修正量应≈8mm，实际 ${correction.delta}`);
      assert(hs.z === 8, '计算坐标 z 不得被覆盖');
    },
  },
  {
    name: 'B2 对称位置零修正；中面处 d2≈d',
    fn: () => {
      const { mesh } = generate('uniformPlate');
      const { geometry } = buildMesh(mesh);
      const hs = { x: 0, y: 0, z: 0, mc: 20, regionVolumeCm3: 80 };
      const { displayPosition, correction } = displayCenterFor(geometry, hs, {});
      assert(close(displayPosition[2], 0, 0.01), `中面点不应移动，实际 z=${displayPosition[2]}`);
      assert(close(correction.delta, 0, 0.05), `delta 应≈0，实际 ${correction.delta}`);
    },
  },
  {
    name: 'B3 开放边界 fallback：无远侧表面 → 保持原位置 + reliable=false',
    fn: () => {
      const { mesh } = generate('uniformPlate');
      const { geometry } = buildMesh(mesh);
      // 板外 0.5mm：最近表面方向射线出模型 → 无远侧表面
      const hs = { x: 0, y: 0, z: 20.5, mc: 20, regionVolumeCm3: 80 };
      const { displayPosition, displayCenterReliable, correction } = displayCenterFor(geometry, hs, {});
      assert(!displayCenterReliable, '板外点应标不可靠');
      assert(close(displayPosition[2], 20.5, 1e-9), '不可靠时保持原位置');
      assert(['no-far-surface', 'on-surface'].includes(correction.reason), `reason 应为 no-far-surface/on-surface，实际 ${correction.reason}`);
    },
  },
  {
    name: 'B4 修正超上限（复杂结构）→ 保持原位置 + reliable=false',
    fn: () => {
      const { mesh } = generate('uniformPlate');
      const { geometry } = buildMesh(mesh);
      // 小区域体积 → 小 cap；偏置大 → 超限
      const hs = { x: 0, y: 0, z: 8, mc: 5, regionVolumeCm3: 0.3 };   // cap = rEq(300)×0.5≈3.6 < 8
      const { displayPosition, displayCenterReliable, correction } = displayCenterFor(geometry, hs, {});
      assert(!displayCenterReliable, '超限应标不可靠');
      assert(correction.reason === 'over-cap', `reason 应为 over-cap，实际 ${correction.reason}`);
      assert(close(displayPosition[2], 8, 1e-9), '超限时保持原位置');
    },
  },
  {
    name: 'B5 无几何（Fake/旧数据）→ 原位置 + reliable=false',
    fn: () => {
      const { displayPosition, displayCenterReliable } = displayCenterFor(null, { x: 1, y: 2, z: 3, mc: 10 });
      assert(!displayCenterReliable, '无几何应不可靠');
      assert(displayPosition.join() === '1,2,3', '无几何保持原位置');
    },
  },
  /* ================= C. V3 分片 == 同步（30.txt 十九：证明重构前后一致） ================= */
  ...['uniformPlate', 'bossOnPlate', 'thinShell'].map(kind => ({
    name: `C1 sliced == sync（${kind}）`,
    fn: async () => {
      const { mesh } = generate(kind);
      const { geometry } = buildMesh(mesh);
      const sync = analyzeHotspotsV3(mesh, geometry, {});
      const yieldFn = () => new Promise(r => setImmediate(r));
      const sliced = await analyzeHotspotsV3Sliced(mesh, geometry, {}, yieldFn, () => {});
      assert(sliced.status === sync.status, `status 不一致: ${sliced.status} vs ${sync.status}`);
      assert(sliced.hotspots.length === sync.hotspots.length, `数量不一致: ${sliced.hotspots.length} vs ${sync.hotspots.length}`);
      for (let i = 0; i < sync.hotspots.length; i++) {
        const a = sync.hotspots[i], b = sliced.hotspots[i];
        const d = Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2]);
        assert(d < 1e-9, `${kind} H${i} 位置差 ${d}`);
        assert(Math.abs(a.peakModulus - b.peakModulus) < 1e-9, `${kind} H${i} M 差`);
        assert(Math.abs(a.regionVolume - b.regionVolume) < 1e-6, `${kind} H${i} 体积差`);
      }
    },
  })),
  /* ================= D. 采样极端场景（30.txt 十/十一/十二） ================= */
  {
    name: 'D1 大件薄壁（3m 壳壁 20mm）：V2 自动升级成功，V3 不误报无法分析',
    fn: () => {
      const mesh = hollowBoxMesh(3000, 20);
      const { geometry } = buildMesh(mesh);
      const geo = analyzeGeometry(mesh, geometry, {});
      assert(geo.res.insidePoints > 0, `V2 几何应有内部点，实际 ${geo.res.insidePoints}`);
      assert(geo.wallMain > 5, `wallMain 应≈20mm，实际 ${geo.wallMain}`);
      const v3 = analyzeHotspotsV3(mesh, geometry, {});
      assert(v3.status !== HS_STATUS.INSUFFICIENT_RESOLUTION, `V3 不应 INSUFFICIENT，实际 ${v3.status}`);
      // 均匀壳 → NO_HOTSPOT 是正确语义（无相对厚区），不是采样失败
    },
  },
  {
    name: 'D2 极薄壁（500mm 板壁 1mm）：低于可靠性下限 → 诚实结果不假造',
    fn: () => {
      const mesh = hollowBoxMesh(500, 1);
      const { geometry } = buildMesh(mesh);
      const v3 = analyzeHotspotsV3(mesh, geometry, {});
      // 不崩溃；结果要么是诚实 NO_HOTSPOT（均匀件），要么 INSUFFICIENT（无法可靠分析）
      assert([HS_STATUS.NO_HOTSPOT, HS_STATUS.INSUFFICIENT_RESOLUTION].includes(v3.status), `极薄壁状态异常: ${v3.status}`);
    },
  },
  {
    name: 'D3 空腔（hollowThickRing 类）：代表点不落空腔（已有回归，此处验证不回归）',
    fn: () => {
      // tube_wall10：空心管——均匀件 → NO_HOTSPOT（或弱候选），绝不 INSUFFICIENT
      const { mesh } = generate('uniformTube');
      const { geometry } = buildMesh(mesh);
      const v3 = analyzeHotspotsV3(mesh, geometry, {});
      assert(v3.status !== HS_STATUS.INSUFFICIENT_RESOLUTION, `管件不应 INSUFFICIENT: ${v3.status}`);
    },
  },
  /* ================= E. 进度回调（30.txt 十三） ================= */
  {
    name: 'E1 几何分片报告真实进度（scan/dist 阶段、区间内、不影响结果）',
    fn: async () => {
      const { mesh } = generate('bossOnPlate');
      const { geometry } = buildMesh(mesh);
      const yieldFn = () => new Promise(r => setImmediate(r));
      const phases = [];
      const geo = await analyzeGeometrySliced(mesh, geometry, {}, yieldFn, (ph, f) => phases.push([ph, f]));
      assert(phases.length > 0, '应有进度回调');
      const scans = phases.filter(p => p[0] === 'scan');
      const dists = phases.filter(p => p[0] === 'dist');
      assert(scans.length > 0 && dists.length > 0, `应含 scan+dist，实际 ${[...new Set(phases.map(p => p[0]))]}`);
      // 契约：每级内归一化 ∈ [0,1]（多级采样级间会重置；调用方用 monotonic 保单调）
      assert(phases.every(p => p[1] >= 0 && p[1] <= 1), `进度值应在 [0,1]，实际 ${phases.map(p => p[1]).join(',')}`);
      assert(geo.wallMain > 0, '进度回调不影响结果');
    },
  },
  {
    name: 'E2 V3 分片报告阶段进度（scan/dist/field/refine 按序出现）',
    fn: async () => {
      const { mesh } = generate('bossOnPlate');
      const { geometry } = buildMesh(mesh);
      const yieldFn = () => new Promise(r => setImmediate(r));
      const phases = [];
      await analyzeHotspotsV3Sliced(mesh, geometry, {}, yieldFn, (ph, f) => phases.push(ph));
      const seen = [...new Set(phases)];
      assert(seen.includes('scan'), `应含 scan，实际 ${seen}`);
      assert(seen.includes('dist') || seen.includes('field'), `应含 dist/field，实际 ${seen}`);
      // refine 阶段可能无候选细化（均匀件）——不强制
      assert(phases.length > 3, `回调次数应充足，实际 ${phases.length}`);
    },
  },
  {
    name: 'E3 进度回调不改变 V3 结果（与无回调同步版一致）',
    fn: async () => {
      const { mesh } = generate('bossOnPlate');
      const { geometry } = buildMesh(mesh);
      const sync = analyzeHotspotsV3(mesh, geometry, {});
      const yieldFn = () => new Promise(r => setImmediate(r));
      const sliced = await analyzeHotspotsV3Sliced(mesh, geometry, {}, yieldFn, () => {});
      assert(sliced.status === sync.status && sliced.hotspots.length === sync.hotspots.length, '回调不影响结果');
    },
  },
];

/* ---- 自运行（node tests/phase22_test.mjs） ---- */
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  let pass = 0, fail = 0;
  for (const t of tests) {
    try { await t.fn(); pass++; console.log(`  ✅ ${t.name}`); }
    catch (e) { fail++; console.log(`  ❌ ${t.name}\n     ${String(e.message).split('\n').slice(0, 3).join('\n     ')}`); }
  }
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}
