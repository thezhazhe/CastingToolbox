// ============================================================
// Hotspot Engine V3 回归测试（核心正确性，PHASE 2-6 达成基线）
// 覆盖 12.txt §37 成功标准核心子集：
//   plate/cube/cylinder/tube/ring → NO_HOTSPOT（标准 1-4, 9）
//   boss on plate → hotspot at boss（标准 5）
//   thick block + thin wall → OK（标准 5 变体）
//   flange → hotspot（标准 8）
// 用法: node tests/runner.mjs（自动发现）或 node tests/hotspot_v3_test.mjs
// ============================================================
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generate } from './tools/hotspotGeometryGenerator.mjs';
import { buildMesh } from '../js/engine/mesh3d.js';
import { analyzeHotspotsV3 } from '../js/engine/v3/hotspotV3.js';
import { HS_STATUS } from '../js/engine/hotspot.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const run = (kind, params = {}) => {
  const g = generate(kind, params);
  const geometry = buildMesh(g.mesh).geometry;
  const t0 = Date.now();
  const hs = analyzeHotspotsV3(g.mesh, geometry);
  return { ...hs, ms: Date.now() - t0, gt: g.gt, mdim: g.mdim };
};

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export const tests = [
  {
    name: 'uniform cube → NO_HOTSPOT',
    fn: () => {
      const r = run('uniformCube');
      if (r.status !== HS_STATUS.NO_HOTSPOT) throw new Error(`cube: ${r.status} ${JSON.stringify(r.hotspots)}`);
      if (r.ms > 120000) throw new Error(`cube 耗时 ${r.ms}ms 超 120s`);
    },
  },
  {
    name: 'uniform plate → NO_HOTSPOT',
    fn: () => {
      const r = run('uniformPlate');
      if (r.status !== HS_STATUS.NO_HOTSPOT) throw new Error(`plate: ${r.status}`);
    },
  },
  {
    name: 'uniform cylinder → NO_HOTSPOT',
    fn: () => {
      const r = run('uniformCylinder');
      if (r.status !== HS_STATUS.NO_HOTSPOT) throw new Error(`cylinder: ${r.status}`);
    },
  },
  {
    name: 'uniform tube → NO_HOTSPOT',
    fn: () => {
      const r = run('uniformTube');
      if (r.status !== HS_STATUS.NO_HOTSPOT) throw new Error(`tube: ${r.status}`);
    },
  },
  {
    // 12.txt §37 成功标准 8：hollow thick ring → 厚区（管 60/40 + 外扩环 75/40 双结构，
    //   环壁 35 > 管壁 20 → 环为热节）。14.txt 测试集确认：环形厚区必须报出
    //   （t08 管法兰同构——V3 uniform 判据旧版把轴对称厚区误判为均匀件，已修）。
    //   已知限制：环上多峰（5 个）——等高合并后仍保留 M 差 >10% 的过渡区峰，记录。
    name: 'hollow thick ring → OK@环厚区（12.txt §37 标准 8）',
    fn: () => {
      const r = run('hollowThickRing');
      if (r.status !== HS_STATUS.OK || !r.hotspots.length) throw new Error(`ring: ${r.status} ${JSON.stringify(r.hotspots)}`);
      const onRing = r.hotspots.some(h => {
        const rad = Math.hypot(h.position[0], h.position[2]);
        return rad >= 40 && rad <= 80;
      });
      if (!onRing) throw new Error(`ring: 热结不在环带内 ${JSON.stringify(r.hotspots.map(h => h.position))}`);
    },
  },
  {
    name: 'boss on plate (20mm 板) → OK@凸台',
    fn: () => {
      const r = run('bossOnPlate', { pl: [400, 200, 20] });
      if (r.status !== HS_STATUS.OK || !r.hotspots.length) throw new Error(`boss: ${r.status} ${r.reason}`);
      const h = r.hotspots[0];
      const d = dist(h.position, [0, 0, 40]);
      if (d > 35) throw new Error(`boss 位置误差 ${d.toFixed(0)}mm（期望 (0,0,40)）`);
      if (h.peakModulus < 10) throw new Error(`boss M=${h.peakModulus.toFixed(1)} 异常低`);
    },
  },
  {
    name: 'boss on plate (8mm 板) → OK@凸台（薄板不消失）',
    fn: () => {
      const r = run('bossOnPlate');
      if (r.status !== HS_STATUS.OK || !r.hotspots.length) throw new Error(`boss8: ${r.status} ${r.reason}`);
      const h = r.hotspots[0];
      const d = dist(h.position, [0, 0, 34]);
      if (d > 35) throw new Error(`boss8 位置误差 ${d.toFixed(0)}mm（期望 (0,0,34)）`);
    },
  },
  {
    name: 'thick block + thin wall → OK@厚块',
    fn: () => {
      const r = run('thickBlockThinWall');
      if (r.status !== HS_STATUS.OK || !r.hotspots.length) throw new Error(`thickBlock: ${r.status} ${r.reason}`);
      const d = dist(r.hotspots[0].position, [0, 0, 34]);
      if (d > 35) throw new Error(`thickBlock 位置误差 ${d.toFixed(0)}mm`);
    },
  },
  {
    name: 'flange → OK（厚区热结，标准 8）',
    fn: () => {
      const r = run('flange');
      if (r.status !== HS_STATUS.OK || !r.hotspots.length) throw new Error(`flange: ${r.status} ${r.reason}`);
      // hub 区（r=45）附近
      const h = r.hotspots[0];
      const dr = Math.hypot(h.position[0], h.position[1]);
      if (dr > 90) throw new Error(`flange 热点半径 ${dr.toFixed(0)}mm（期望 hub/rim 厚区）`);
    },
  },
];

// 独立运行
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  let pass = 0, fail = 0;
  for (const t of tests) {
    try {
      t.fn();
      console.log(`  ✓ ${t.name}`);
      pass++;
    } catch (e) {
      console.log(`  ✗ ${t.name}\n    ${e.message}`);
      fail++;
    }
  }
  console.log(`\nV3 核心测试：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}
