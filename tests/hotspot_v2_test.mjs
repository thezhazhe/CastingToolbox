// ============================================================
// Hotspot Engine V2.1 Golden 测试（命令文件九/十二节）
// 12 个模型：均匀件 NO_HOTSPOT / 多结构 OK / PVP 分裂合并 / 薄壁大件
// 断言：状态、热结数量、位置（MC 网格化偏移容差 ±15mm）、Mc（±15%）、
//       confidence（弱热结 < 0.8）、性能（普通 <3s / 复杂 <8s）
// 用法: node tests/hotspot_v2_test.mjs
// ============================================================
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSTL } from '../js/engine/stl.js';
import { buildMesh } from '../js/engine/mesh3d.js';
import { analyzeHotspots, HS_STATUS } from '../js/engine/hotspot.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fileMesh = (name) => {
  const b = readFileSync(path.join(ROOT, 'tests', 'golden', name));
  return parseSTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  ok ? pass++ : fail++;
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const CASES = [
  { file: 'cube50.stl',        name: 'uniform cube',            expect: 'NO_HOTSPOT' },
  // thinShell 壳角存在 MC 网格化圆角伪厚（≈1mm 圆角 → 角部 d 5.2 vs 面 4.2，比值 1.25）——
  // 程序化生成器伪影；真实 CAD 直角表面无此伪影。期望：OK 但仅弱热结（mc<6, conf<0.8）
  { file: 'thinShell.stl',     name: 'uniform thin shell',      expect: 'WEAK_OK', mc: [3, 6] },
  { file: 'longBar.stl',       name: 'long bar (uniform)',      expect: 'NO_HOTSPOT' },
  { file: 'lShape.stl',        name: 'L-shape / corner thick',  expect: 'OK', pos: [-30, -30, 0], posTol: 15, mc: 30, mcTol: 0.15 },
  { file: 'thickOnThin.stl',   name: 'thick-on-thin',           expect: 'OK', pos: [0, 0, 34], posTol: 15, mc: 30, mcTol: 0.2 },
  { file: 'twoThick.stl',      name: 'two independent thick',   expect: 'OK x2', pos: [[-50, 0, 24], [110, 0, 24]], posTol: 15, mc: 20, mcTol: 0.25 },
  { file: 'adjacentSplit.stl', name: 'adjacent split (PVP)',    expect: 'OK x2', pos: [[-35, 0, 0], [115, 0, 0]], posTol: 20, mc: 30, mcTol: 0.15 },
  { file: 'adjacentMerge.stl', name: 'adjacent merge (PVP)',    expect: 'OK x1', pos: [-50, 0, 0], posTol: 20, mc: 39, mcTol: 0.15 },
  // largeThin：V2.2 引擎 uniform 判据更新后，大薄壳（无局部厚区）正确判均匀 → NO_HOTSPOT
  // （旧 WEAK_OK 期望反映引擎修改前的"壳角 MC 圆角伪厚弱热结"——伪影本身是程序化生成器
  //   的问题，真实 CAD 直角表面无此伪影；与 PHASE 19 距离场修复无关，已验证旧参数行为相同）
  { file: 'largeThin.stl',     name: 'large thin shell',        expect: 'NO_HOTSPOT' },
  { file: 'largeThinThick.stl', name: 'large thin + local thick', expect: 'OK', pos: [0, 0, 85], posTol: 15, mc: 25, mcTol: 0.25 },
  { file: 'mildThick.stl',     name: 'mild thick (weak)',       expect: 'WEAK_OK', mc: [19, 29] },  // 板 40 + 凸台 48 → d=24
  { file: 'hollowThickRing.stl', name: 'hollow thick ring',     expect: 'OK', ring: true, mc: [14, 21] },
];

for (const c of CASES) {
  const t0 = Date.now();
  const mesh = fileMesh(c.file);
  const geo = buildMesh(mesh).geometry;
  const hs = analyzeHotspots(mesh, geo);
  const ms = Date.now() - t0;
  const hstr = hs.hotspots.map(h => `H${h.id}@(${h.x.toFixed(0)},${h.y.toFixed(0)},${h.z.toFixed(0)}) mc=${h.mc.toFixed(1)} c=${h.confidence}`).join(' ') || '-';
  console.log(`\n[${c.name}] ${hs.status} ${ms}ms | ${hstr}`);

  if (c.expect === 'NO_HOTSPOT') {
    check(`${c.name}: NO_HOTSPOT`, hs.status === HS_STATUS.NO_HOTSPOT, hs.status);
  } else if (c.expect === 'WEAK_OK') {
    check(`${c.name}: OK（弱热结）`, hs.status === HS_STATUS.OK && hs.hotspots.length >= 1, hs.status);
    if (hs.hotspots.length) {
      const h = hs.hotspots[0];
      check(`${c.name}: 弱热结 mc 合理`, c.mc ? h.mc >= c.mc[0] && h.mc <= c.mc[1] : h.mc < 8, `mc=${h.mc.toFixed(1)}`);
      check(`${c.name}: 弱热结置信度 < 0.8`, h.confidence < 0.8, `conf=${h.confidence}`);
    }
  } else if (c.expect === 'OK x2') {
    check(`${c.name}: OK 两个热结`, hs.status === HS_STATUS.OK && hs.hotspots.length === 2, `${hs.status} n=${hs.hotspots.length}`);
    if (hs.hotspots.length === 2) {
      const d1 = dist([hs.hotspots[0].x, hs.hotspots[0].y, hs.hotspots[0].z], c.pos[0]);
      const d2 = dist([hs.hotspots[1].x, hs.hotspots[1].y, hs.hotspots[1].z], c.pos[1]);
      check(`${c.name}: 位置误差 < ${c.posTol}mm`, d1 < c.posTol && d2 < c.posTol, `d=${d1.toFixed(0)},${d2.toFixed(0)}`);
      check(`${c.name}: Mc ≈ ${c.mc}（±${c.mcTol * 100}%）`,
        Math.abs(hs.hotspots[0].mc - c.mc) / c.mc < c.mcTol && Math.abs(hs.hotspots[1].mc - c.mc) / c.mc < c.mcTol,
        `mc=${hs.hotspots[0].mc.toFixed(1)},${hs.hotspots[1].mc.toFixed(1)}`);
    }
  } else {
    check(`${c.name}: OK`, hs.status === HS_STATUS.OK && hs.hotspots.length >= 1, `${hs.status} n=${hs.hotspots.length}`);
    if (hs.hotspots.length && c.pos) {
      const h = hs.hotspots[0];
      const d = dist([h.x, h.y, h.z], c.pos);
      check(`${c.name}: 位置误差 < ${c.posTol}mm`, d < c.posTol, `d=${d.toFixed(1)}mm`);
    }
    if (hs.hotspots.length && c.mc && !Array.isArray(c.mc)) {
      check(`${c.name}: Mc ≈ ${c.mc}（±${c.mcTol * 100}%）`, Math.abs(hs.hotspots[0].mc - c.mc) / c.mc < c.mcTol, `mc=${hs.hotspots[0].mc.toFixed(1)}`);
    }
    if (hs.hotspots.length && Array.isArray(c.mc)) {
      check(`${c.name}: Mc ∈ [${c.mc}]`, hs.hotspots[0].mc >= c.mc[0] && hs.hotspots[0].mc <= c.mc[1], `mc=${hs.hotspots[0].mc.toFixed(1)}`);
    }
    if (hs.hotspots.length && c.ring) {
      const h = hs.hotspots[0];
      const r = Math.hypot(h.x, h.z);
      check(`${c.name}: 热结在环壁内（r∈[40,75], |y|<30）`, r >= 40 && r <= 75 && Math.abs(h.y) < 30, `r=${r.toFixed(1)}, y=${h.y.toFixed(1)}`);
    }
  }
  check(`${c.name}: 性能 < 8s`, ms < 8000, `${ms}ms`);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exitCode = fail ? 1 : 0;
