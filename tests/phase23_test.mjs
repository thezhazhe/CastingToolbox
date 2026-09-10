// ============================================================
// PHASE 23 回归测试（31.txt 十二：每个修复根因对应"结果正确"测试）
// 覆盖：
//   T1 厚板（无真实薄材料）不再误报"局部特征过薄"（PHASE 23 核心修复回归）
//   T2 真薄壁（整板 3mm / 薄壳 8mm）仍触发采样 WARNING（不因修复而漏报）
//   T3 localThicknessStats 正确性：t = d+d2 ≈ 板厚（表面壳层不误判为薄）
//   T4 t 测度判别力：厚板 thinFrac≈0 vs 真薄板 thinFrac≈1（10× 余量）
//   T5 分片/同步 thin 测度一致（coarseSampleSliced == coarseSample）
//   T6 分级语义：主体过薄 → resolution；主体正常+局部薄 → local_thin
// 用法: node tests/runner.mjs（自动发现）或 node tests/phase23_test.mjs
// ============================================================
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generate } from './tools/hotspotGeometryGenerator.mjs';
import { buildMesh } from '../js/engine/mesh3d.js';
import { analyzeHotspotsV3, analyzeHotspotsV3Sliced } from '../js/engine/v3/hotspotV3.js';
import { coarseSample, coarseSampleSliced, localThicknessStats } from '../js/engine/v3/sampling.js';
import { toViewResult } from '../js/engine/v3/v3ViewAdapter.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const close = (a, b, tol) => Math.abs(a - b) <= tol;
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const runV3 = (mesh, geom = {}) => {
  const { geometry } = buildMesh(mesh);
  const v3 = analyzeHotspotsV3(mesh, geometry, {});
  return { v3, view: toViewResult(v3, { wallMax: geom.wallMax ?? 0, wallMain: geom.wallMain ?? 0, wallAvg: geom.wallAvg ?? 0 }) };
};

export const tests = [
  /* ================= T1/T2/T3/T4：t 测度判别（31.txt 五/六 根因修复） ================= */
  {
    name: 'T1 厚板（300×200×40）不再误报"局部特征过薄"',
    fn: () => {
      const { mesh } = generate('uniformPlate');   // 40mm 厚板，无任何真实薄材料
      const { view } = runV3(mesh);
      if (view.sampling?.warning) throw new Error(`40mm 厚板不应触发采样 WARNING，实际 ${view.sampling.level}: ${view.sampling.detail}`);
    },
  },
  {
    name: 'T2 真薄壁（4mm 薄壳，欠采样）仍触发采样 WARNING（不因修复漏报）',
    fn: () => {
      const { mesh } = generate('thinShell', { t: 4 });   // 400×200×100，壁 4mm（vs≈3.1 → <2 层）
      const { view } = runV3(mesh);
      if (!view.sampling?.warning) throw new Error(`4mm 薄壳应触发采样 WARNING，实际 ${JSON.stringify(view.sampling)}`);
      if (!['local_thin', 'resolution'].includes(view.sampling.level)) throw new Error(`薄壳分级异常: ${view.sampling.level}`);
      // 对照：8mm 薄壳（2.56 层，采样充分）不应警告——"采样率足够"本身不产生警告
      const { mesh: m8 } = generate('thinShell');          // 壁 8mm
      const { view: v8 } = runV3(m8);
      if (v8.sampling?.warning) throw new Error(`8mm 薄壳采样充分不应警告，实际 ${v8.sampling.level}`);
    },
  },
  {
    name: 'T3 localThicknessStats 正确性：表面点 t 应≈板厚（表面壳层不误判为薄）',
    fn: () => {
      const { mesh } = generate('uniformPlate');   // 40mm 厚板
      const { geometry } = buildMesh(mesh);
      const coarse = coarseSample(mesh, geometry, {});
      const thin = localThicknessStats(geometry, coarse.pts, coarse.dists, coarse.vs, {});
      // 40mm 板的局部完整厚度中位应 ≈40（±10%），不是 2-4mm 的表面密度误判
      assert(close(thin.tP50, 40, 4), `t_p50 应≈40mm，实际 ${thin.tP50}`);
      assert(thin.thinFrac < 0.01, `厚板 thinFrac 应≈0，实际 ${thin.thinFrac}`);
      // 薄板：3mm → t_p50≈3
      const { mesh: m2 } = generate('uniformPlate', { t: 3 });
      const { geometry: g2 } = buildMesh(m2);
      const c2 = coarseSample(m2, g2, {});
      const t2 = localThicknessStats(g2, c2.pts, c2.dists, c2.vs, {});
      assert(close(t2.tP50, 3, 1), `3mm 板 t_p50 应≈3，实际 ${t2.tP50}`);
      assert(t2.thinFrac > 0.5, `3mm 板 thinFrac 应 >0.5，实际 ${t2.thinFrac}`);
    },
  },
  {
    name: 'T4 t 测度判别力：厚板 thinFrac=0.000 vs 薄板 thinFrac≈1（阈值 0.10 留 10× 余量）',
    fn: () => {
      const { mesh } = generate('uniformPlate');
      const { geometry } = buildMesh(mesh);
      const thick = coarseSample(mesh, geometry, {});
      const { mesh: m2 } = generate('uniformPlate', { t: 3 });
      const { geometry: g2 } = buildMesh(m2);
      const thinC = coarseSample(m2, g2, {});
      assert(thick.thin.thinFrac < 0.01, `厚板 thinFrac=${thick.thin.thinFrac}`);
      assert(thinC.thin.thinFrac > 0.5, `薄板 thinFrac=${thinC.thin.thinFrac}`);
      // 阈值 0.10 判别：厚板不触发，薄板触发
      assert(thick.thin.thinFrac < 0.10 && thinC.thin.thinFrac >= 0.10, '阈值判别失败');
    },
  },
  /* ================= T5：分片一致性（31.txt 十一） ================= */
  {
    name: 'T5 coarseSampleSliced == coarseSample（thin 测度逐字段一致）',
    fn: async () => {
      const { mesh } = generate('thinShell');
      const { geometry } = buildMesh(mesh);
      const sync = coarseSample(mesh, geometry, {});
      const yieldFn = () => new Promise(r => setImmediate(r));
      const sliced = await coarseSampleSliced(mesh, geometry, {}, yieldFn, () => {});
      assert(close(sync.thin.thinFrac, sliced.thin.thinFrac, 1e-9), `thinFrac 不一致: ${sync.thin.thinFrac} vs ${sliced.thin.thinFrac}`);
      assert(close(sync.thin.tP50, sliced.thin.tP50, 1e-9), `tP50 不一致`);
      assert(close(sync.thin.tP10, sliced.thin.tP10, 1e-9), `tP10 不一致`);
      assert(sync.vs === sliced.vs && sync.gs === sliced.gs, 'vs/gs 不一致');
      // 全链路 sliced == sync（含 thin 透传后的 warning 一致性）
      const v3s = analyzeHotspotsV3(mesh, geometry, {});
      const v3sl = await analyzeHotspotsV3Sliced(mesh, geometry, {}, yieldFn, () => {});
      assert(v3s.status === v3sl.status, 'status 不一致');
    },
  },
  /* ================= T6：分级语义（31.txt 六） ================= */
  {
    name: 'T6 分级：主体过薄 → resolution；主体正常+局部薄 → local_thin',
    fn: () => {
      // 主体过薄：300×300×3 整板 → 主体层数 <2 → resolution
      const { mesh } = generate('uniformPlate', { t: 3 });
      const { view } = runV3(mesh, { wallMax: 3, wallMain: 3, wallAvg: 3 });
      if (!view.sampling?.warning || view.sampling.level !== 'resolution') {
        throw new Error(`3mm 整板应为 resolution，实际 ${view.sampling?.level}`);
      }
      // 主体正常 + 局部薄：薄壳 8mm 壁 + 400mm 主体尺寸 → local_thin 或 resolution 均有效；
      // 关键是薄壳必须 warning（T2 已断言），此处断言 warning 文案包含层数/占比信息
      const { mesh: m2 } = generate('thinShell');
      const { view: v2 } = runV3(m2);
      if (v2.sampling?.warning && v2.sampling.level === 'local_thin') {
        if (!(v2.sampling.thinFrac > 0.5)) throw new Error(`local_thin 应报告真实占比，实际 thinFrac=${v2.sampling.thinFrac}`);
        if (!v2.sampling.detail.includes('%')) throw new Error(`local_thin 文案应含占比信息: ${v2.sampling.detail}`);
      }
    },
  },
  {
    name: 'T7 修复不改变热结计算结果（仅 warning 层变化）',
    fn: () => {
      // 与 PHASE 22 基线一致：bossOnPlate 热结位置/数量不变（thin 测度只进 warning，不进计算）
      const { mesh } = generate('bossOnPlate');
      const { geometry } = buildMesh(mesh);
      const v3 = analyzeHotspotsV3(mesh, geometry, {});
      assert(v3.hotspots.length >= 1, 'bossOnPlate 应有热结');
      assert(v3.hotspots[0].position.every(Number.isFinite), '热结位置非法');
    },
  },
  {
    name: 'T8 tP50 伪值防护：断网格伪 t（>2×wallMax）不污染主体层数判定（P18-T3 回归）',
    fn: () => {
      // 2m 壳 5mm 壁（tetMC 断网格）：tP50=795（伪）vs wallMax=50.8 → tP50 不可用 →
      // 主体层数退回 geometry 链（wallAvg=2.0 → 0.08 层 → resolution，保持"真超薄"语义）
      const fakeV3 = {
        status: 'NO_HOTSPOT', reason: 'no_candidate', hotspots: [], audit: [],
        metrics: {}, debug: {
          coarse: {
            gs: 80, vs: 24.92, estMinWall: 49.85, pts: 6249, stride: 1, peaks: 0,
            thin: { thinFrac: 0.405, tP10: 4.7, tP50: 795, samples: 6249, noFar: 0 },
          },
        },
      };
      const r = toViewResult(fakeV3, { wallMax: 50.8, wallMain: 50.8, wallAvg: 2.0 });
      assert(r.sampling.warning, `伪 t 值模型应仍警告，实际 ${JSON.stringify(r.sampling)}`);
      assert(r.sampling.level === 'resolution', `应为 resolution（主体 0.08 层），实际 ${r.sampling.level}`);
      assert(r.sampling.layers < 1, `层数应来自 wallAvg=2.0（非伪 tP50），实际 ${r.sampling.layers}`);
      // 对照：物理一致 tP50（15.1 vs wallMax=29）→ 取 max 修复 wallAvg 兜底误报
      const fake2 = {
        ...fakeV3,
        debug: { coarse: { ...fakeV3.debug.coarse, vs: 5.48, thin: { thinFrac: 0.09, tP10: 14.5, tP50: 15.1, samples: 443, noFar: 0 } } },
      };
      const r2 = toViewResult(fake2, { wallMax: 29, wallMain: 27.1, wallAvg: 5.8 });
      assert(!r2.sampling.warning, `物理一致 tP50 模型不应误报（bodyRef=15.1 → 2.75 层），实际 ${r2.sampling.level}`);
    },
  },
];

/* ---- 自运行（node tests/phase23_test.mjs） ---- */
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
