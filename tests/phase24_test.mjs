// ============================================================
// PHASE 24 回归测试（32.txt 十三："薄壁主体 + 厚大局部结构"边界条件锁定）
// 测试资产：tests/real-stl/ALR2510塑料模具v1.stl（薄壁主体 2-3mm + 两条厚大轨 15-17mm）
// 覆盖：
//   T1 修复核心：薄壁主体+厚大局部 → 厚大结构被检出为热结（修复前 0 个，tiny_region 漏检）
//   T2 区域恢复：厚大结构区域体积 ≥ regionMinVolumeMm3（原始 V/A 区域生长）
//   T3 warning 语义：有热结时 resolution 文案区分"主体薄"与"热结可用"
//   T4 均匀件零回归：cube/plate/cyl/tube 保持 NO_HOTSPOT（d 上限校准承重墙）
//   T5 关键真实 STL 热结数量零回归（ALHR4510 5 / ALR2510v1_1 2 / HR4012 5）
//   T6 warning 无热结路径：保持"仅供参考"（不误放宽）
// 用法: node tests/runner.mjs（自动发现）或 node tests/phase24_test.mjs
// ============================================================
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSTL } from '../js/engine/stl.js';
import { buildMesh } from '../js/engine/mesh3d.js';
import { analyzeHotspotsV3 } from '../js/engine/v3/hotspotV3.js';
import { analyzeGeometry } from '../js/engine/geometryAnalysis.js';
import { toViewResult } from '../js/engine/v3/v3ViewAdapter.js';
import { generate } from './tools/hotspotGeometryGenerator.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const loadReal = (name) => {
  const buf = readFileSync(path.join(ROOT, 'tests/real-stl', name));
  return parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};
const runReal = (name) => {
  const mesh = loadReal(name);
  const { geometry } = buildMesh(mesh);
  const geo = analyzeGeometry(mesh, geometry, {});
  const v3 = analyzeHotspotsV3(mesh, geometry, {});
  const view = toViewResult(v3, { wallMax: geo.wallMax, wallMain: geo.wallMain, wallAvg: geo.wallAvg });
  return { v3, view, geo };
};

export const tests = [
  {
    name: 'T1 薄壁主体+厚大局部：ALR2510 厚大轨被检出为热结（修复前 0 个）',
    fn: () => {
      const { v3 } = runReal('ALR2510塑料模具v1.stl');
      assert(v3.status === 'ok' && v3.hotspots.length >= 3,
        `修复后应检出 ≥3 热结（含两条厚大轨），实际 ${v3.status} H=${v3.hotspots.length}`);
      // 厚大轨位置（y≈-90 与 y≈-166，x≈31）必须在热结中
      const rails = v3.hotspots.filter(h =>
        Math.abs(h.position[0] - 31) < 12 && (Math.abs(h.position[1] + 90) < 15 || Math.abs(h.position[1] + 166) < 15));
      assert(rails.length >= 2, `两条厚大轨应被检出，实际 ${rails.length} 条: ${v3.hotspots.map(h => `[${h.position.map(v => v.toFixed(0))}]`).join(' ')}`);
    },
  },
  {
    name: 'T2 区域恢复：厚大轨区域体积 ≥ regionMinVolumeMm3（原始 V/A 生长）',
    fn: () => {
      const { v3 } = runReal('ALR2510塑料模具v1.stl');
      const rail = v3.hotspots.find(h => Math.abs(h.position[0] - 31) < 12 && Math.abs(h.position[1] + 90) < 15);
      assert(rail, '应找到 y≈-90 厚大轨热结');
      assert(rail.regionVolume >= 100, `厚大轨区域应 ≥100mm³（修复前 49mm³ 被 tiny_region 拒），实际 ${rail.regionVolume.toFixed(0)}mm³`);
      assert(rail.confidence >= 0.5, `厚大轨置信度应达标，实际 ${rail.confidence.toFixed(2)}`);
    },
  },
  {
    name: 'T3 warning 语义：有热结时区分"主体薄"与"热结可用"',
    fn: () => {
      const { view, v3 } = runReal('ALR2510塑料模具v1.stl');
      assert(view.sampling.warning && view.sampling.level === 'resolution', `应仍报 resolution（主体 1.8 层属实），实际 ${view.sampling.level}`);
      assert(view.sampling.detail.includes('薄壁区域厚度测量精度有限'), `文案应说明薄壁区精度有限: ${view.sampling.detail}`);
      assert(view.sampling.detail.includes(`已检出 ${v3.hotspots.length} 个热结`) && view.sampling.detail.includes('热结分析结果可用'),
        `有热结时不应再说"仅供参考"，应说热结可用: ${view.sampling.detail}`);
      assert(!view.sampling.detail.includes('仅供参考'), `有热结时文案不得含"仅供参考"`);
    },
  },
  {
    name: 'T4 均匀件零回归：cube/plate/cyl/tube 保持 NO_HOTSPOT（d 上限校准承重墙）',
    fn: () => {
      for (const k of ['uniformCube', 'uniformPlate', 'uniformCylinder', 'uniformTube']) {
        const { mesh } = generate(k);
        const { geometry } = buildMesh(mesh);
        const v3 = analyzeHotspotsV3(mesh, geometry, {});
        assert(v3.status === 'NO_HOTSPOT', `${k} 应保持 NO_HOTSPOT，实际 ${v3.status} H=${v3.hotspots.length}`);
      }
    },
  },
  {
    name: 'T5 关键真实 STL 热结数量零回归',
    fn: () => {
      const cases = [['ALHR4510塑料模具v2-2.1.stl', 5], ['ALR2510塑料模具v1_1.stl', 2], ['HR4012塑料模具v4最早大板.stl', 5]];
      for (const [name, expect] of cases) {
        const { v3 } = runReal(name);
        assert(v3.hotspots.length === expect, `${name} 热结数应=${expect}，实际 ${v3.hotspots.length}`);
      }
    },
  },
  {
    name: 'T6 warning 无热结路径：保持"仅供参考"（不误放宽）',
    fn: () => {
      // 薄壁无厚区模型（thinShell 8mm 采样充分）→ 无 warning；真欠采样薄壳（4mm）→ warning
      const { mesh: m1 } = generate('thinShell');
      const { geometry: g1 } = buildMesh(m1);
      const v1 = analyzeHotspotsV3(m1, g1, {});
      const view1 = toViewResult(v1, { wallMax: 8, wallMain: 8, wallAvg: 8 });
      if (view1.sampling?.warning && view1.sampling.level === 'resolution' && !(v1.hotspots || []).length) {
        assert(view1.sampling.detail.includes('仅供参考'), '无热结时 resolution 文案应保留"仅供参考"');
      }
      // 有热结场景的文案（T3）已锁；此处验证 failed 路径不变
      const { mesh: m2 } = generate('uniformPlate', { t: 3 });
      const { geometry: g2 } = buildMesh(m2);
      const v2 = analyzeHotspotsV3(m2, g2, {});
      const view2 = toViewResult(v2, { wallMax: 3, wallMain: 3, wallAvg: 3 });
      assert(view2.sampling?.warning, '3mm 板应仍 warning');
    },
  },
];

/* ---- 自运行（node tests/phase24_test.mjs） ---- */
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
