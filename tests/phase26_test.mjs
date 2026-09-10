// ============================================================
// PHASE 26 回归测试（34.txt 一/十："主体壁厚" UI 语义修复锁定）
// 覆盖：
//   T1 bodyRefOf(ALR2510 v1) ≈ 3.6（2-4mm 验收范围；bodyWallOf→wallAvg=2.3 fallback）
//   T2 bodyRefOf(cube50) ≈ 50（tP50 取大修复均匀实心件 wallAvg=12.5 低估）
//   T3 samplingWarn 与 bodyRefOf 一致性（layers×vs == bodyRef，行为零变化）
//   T4 bodyWallOf 可信校验语义（ALR2510→wallAvg；cube50→wallAvg；可信 wallMain 直返）
//   T5 验收语义共存：ALR2510 UI 主体壁厚 2-4mm 且 最大壁厚仍 ~17mm 且 热结仍 5 个
// 用法: node tests/runner.mjs（自动发现）或 node tests/phase26_test.mjs
// ============================================================
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSTL } from '../js/engine/stl.js';
import { buildMesh } from '../js/engine/mesh3d.js';
import { analyzeHotspotsV3 } from '../js/engine/v3/hotspotV3.js';
import { analyzeGeometry } from '../js/engine/geometryAnalysis.js';
import { toViewResult, bodyWallOf, bodyRefOf } from '../js/engine/v3/v3ViewAdapter.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const loadFile = (rel) => {
  const buf = readFileSync(path.join(ROOT, rel));
  return parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};

/** 完整流水线：geometry + V3 + view（与生产 UI 同链） */
function runReal(rel) {
  const mesh = loadFile(rel);
  const { geometry } = buildMesh(mesh);
  const geo = analyzeGeometry(mesh, geometry, {});
  const v3 = analyzeHotspotsV3(mesh, geometry, {});
  const view = toViewResult(v3, { wallMax: geo.wallMax, wallMain: geo.wallMain, wallAvg: geo.wallAvg });
  return { mesh, geo, v3, view };
}

export const tests = [
  {
    name: 'T1 ALR2510 v1：bodyRef≈3.6（2-4mm 验收范围），bodyWall fallback wallAvg=2.3',
    fn: () => {
      const { geo, view } = runReal('tests/real-stl/ALR2510塑料模具v1.stl');
      const thin = view.debug.v3.coarse.thin;
      const br = bodyRefOf(geo, thin);
      assert(br.bodyRef != null && br.bodyRef >= 2 && br.bodyRef <= 4,
        `ALR2510 UI 主体壁厚应在 2-4mm，实际 bodyRef=${br?.bodyRef}`);
      assert(Math.abs(br.bodyRef - 3.6) < 0.5, `bodyRef 应≈3.6（与 samplingWarn 同链），实际 ${br.bodyRef?.toFixed(2)}`);
      assert(Math.abs(br.bodyWall - 2.34) < 0.3,
        `bodyWallOf 应 fallback 到 wallAvg≈2.34（wallMain=17.2 不可信），实际 ${br.bodyWall?.toFixed(2)}`);
      assert(geo.wallMain === geo.wallMax, `前置条件：wallMain 应退化 = wallMax（${geo.wallMain}）`);
    },
  },
  {
    name: 'T2 cube50：bodyRef≈50（tP50 取大修复 wallAvg=12.5 低估）',
    fn: () => {
      const { geo, view } = runReal('tests/golden/cube50.stl');
      const thin = view.debug.v3.coarse.thin;
      const br = bodyRefOf(geo, thin);
      // 均匀实心件：bodyWallOf 落到 wallAvg（半距平均=边/8×2=12.5，低估 4×）——
      // 必须由 tP50≈50（全域 t=d+d2）取大修正（design_center_test 断言 UI ≈50mm）
      assert(br.bodyRef != null && Math.abs(br.bodyRef - 50) < 3,
        `cube50 bodyRef 应≈50（design_center_test 验收），实际 ${br.bodyRef?.toFixed(1)}`);
      assert(br.bodyWall != null && br.bodyWall < 20,
        `前置条件：bodyWallOf(cube50) 应低估 <20（wallMain=wallMax=50 不可信）`);
    },
  },
  {
    name: 'T3 samplingWarn 与 bodyRefOf 一致性（行为零变化）',
    fn: () => {
      for (const rel of ['tests/real-stl/ALHR4510塑料模具v2-2.1.stl', 'tests/real-stl/ALR2510塑料模具v1.stl', 'tests/golden/cube50.stl', 'tests/golden/thinShell.stl']) {
        const { geo, view } = runReal(rel);
        const thin = view.debug.v3.coarse.thin;
        const br = bodyRefOf(geo, thin);
        const s = view.sampling;
        // sampling.layers = bodyRef / vs → bodyRef 应与 samplingWarn 内部计算一致
        if (s.layers != null && s.vs > 0) {
          const fromLayers = s.layers * s.vs;
          // layers 经 toFixed(2) 舍入（±0.005×vs ≈ ±0.01mm），容差 0.02
          assert(Math.abs(fromLayers - br.bodyRef) < 0.02,
            `${rel} samplingWarn bodyRef(${fromLayers.toFixed(2)}) 应等于 bodyRefOf(${br.bodyRef?.toFixed(2)})`);
        }
      }
    },
  },
  {
    name: 'T4 bodyWallOf 可信校验语义（wallMain 可信直返 / 不可信 fallback wallAvg）',
    fn: () => {
      // wallMain 可信（居中值）：直返 wallMain
      assert(bodyWallOf({ wallMain: 20, wallAvg: 18, wallMax: 40 }) === 20, '可信 wallMain 应直返');
      assert(bodyWallOf({ wallMain: 17.2, wallAvg: 2.34, wallMax: 17.2 }) === 2.34, 'wallMain=wallMax 应 fallback wallAvg');
      assert(bodyWallOf({ wallMain: 0, wallAvg: 0, wallMax: 30 }) === 30, '无 wallAvg 时应 fallback wallMax');
      assert(bodyWallOf({ wallMain: 4, wallAvg: 9.4, wallMax: 30 }) === 9.4, 'wallMain 伪低桶（<0.7×wallAvg）应 fallback wallAvg');
    },
  },
  {
    name: 'T5 验收语义共存：ALR2510 主体壁厚 2-4mm 且最大壁厚 ~17mm 且热结仍 5 个',
    fn: () => {
      const { geo, v3 } = runReal('tests/real-stl/ALR2510塑料模具v1.stl');
      assert(v3.hotspots.length === 5, `热结数量应仍为 5（不得受 UI 语义修复影响），实际 ${v3.hotspots.length}`);
      assert(geo.wallMax >= 16 && geo.wallMax <= 18, `最大壁厚应仍 ~17mm，实际 ${geo.wallMax}`);
      // 两条厚大轨仍被检出（PHASE 24 边界条件）
      const rails = v3.hotspots.filter(h =>
        Math.abs(h.position[0] - 31) < 12 && (Math.abs(h.position[1] + 90) < 15 || Math.abs(h.position[1] + 166) < 15));
      assert(rails.length >= 2, `两条厚大轨应仍被检出，实际 ${rails.length}`);
    },
  },
];

/* ---- 自运行（node tests/phase26_test.mjs） ---- */
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
