// ============================================================
// 工程化测试集生成器（命令 14.txt）
// 生成 20 个"接近真实铸件结构"的参数化模型 + manifest.json + expected.json
//
// 纪律（14.txt 第一节）：
//   - GT 全部由独立几何参数解析计算，在运行 V3 之前写入 expected.json
//   - 禁止根据 V3 结果反推/修改 GT
//   - 每个模型只验证一个问题
//
// 模型清单（14.txt 第四节 测试1~20）：
//   t01_boss100          A  20mm 主体 + 100mm Boss（居中）
//   t02_thin10_boss60    A  10mm 主体 + 60mm Boss（薄壁自适应重点）
//   t03_twoDiff_60_100   F  20mm 主体 + 60mm 与 100mm 两厚区（区分强弱）
//   t04_twoSame_60_60    F  20mm 主体 + 两个相同 60mm 厚区（不得随机丢一个）
//   t05_threeSizes       E  20mm 主体 + 60/80/100 三厚区（排序）
//   t06_taperStairs      G  20→30→40→60 阶梯渐变（观察是否全报）
//   t07_eccentric80      H  20mm 主体 + 偏心 80mm 厚块（代表点）
//   t08_pipeFlange70     C  20mm 管壁 + 70mm 法兰（环形结构）
//   t09_boxInner80       D  20mm 箱体壁 + 内部 80mm 厚块（封闭结构）
//   t10_multiDirBoss     E  多个不同方向 Boss（旋转影响）
//   t11_edgeThick80      H  厚区靠薄壁边缘（边界效应）
//   t12_closePair        F  两个距离很近的厚区（Region 合并）
//   t13_farPair          F  两个距离较远的厚区（分别识别）
//   t14_taperSeries      G  厚区逐渐减小 120→100→80→60→40（识别边界）
//   t15_weakRamp         F  厚区接近主体 20→25→30→35→40（弱热结边界）
//   t16_extreme_10_100   A  主体 10mm + Boss 100mm（极端厚薄比）
//   t17_weak_30_60       A  主体 30mm + Boss 60mm（弱厚度差）
//   t18_multiSizeBoss    E  主体 20mm + 多个不同大小 Boss（排序）
//   t19_valveLike        J  类阀体（主管+法兰+Boss+孔+厚薄变化）
//   t20_combinedBox      I  综合工程件（箱体+法兰环+侧Boss+内块+底板加厚）
//
// 用法: node tests/engineering-generated/gen_engineering.mjs
// ============================================================
import { tetMC, BOX, CYL_Y, union, subtract } from '../helpers/stlGen.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = join(HERE, 'models');

/* ================= 轴向圆柱（中心式；stlGen 只有轴向 Y） ================= */
/** 轴向 X：中心 (cx, cy)（yz 平面），半径 r，x∈[cx-h/2, cx+h/2] */
const CYL_X = (cx, cy, r, h) => (p) => Math.max(
  Math.hypot(p[1] - cy, p[2]) - r, Math.abs(p[0] - cx) - h / 2,
);
/** 轴向 Y：中心 y0 */
const CYL_Y_AT = (cx, cz, y0, r, h) => (p) => Math.max(
  Math.hypot(p[0] - cx, p[2] - cz) - r, Math.abs(p[1] - y0) - h / 2,
);
/** 轴向 Z：中心 (cx, cy, cz) */
const CYL_Z = (cx, cy, cz, r, h) => (p) => Math.max(
  Math.hypot(p[0] - cx, p[1] - cy) - r, Math.abs(p[2] - cz) - h / 2,
);

/* ================= 公共结构 ================= */
/** 板（中心在原点，厚 t，顶面 z=+t/2） */
const plate = (l, w, t) => BOX([-l / 2, -w / 2, -t / 2], [l / 2, w / 2, t / 2]);
/** 立在板上表面的盒体厚块（板顶 z=topZ） */
const boxBoss = (ox, oy, topZ, bL, bW, bH) => BOX([ox - bL / 2, oy - bW / 2, topZ], [ox + bL / 2, oy + bW / 2, topZ + bH]);
/** 盒体 V/A（6 面全散热，解析） */
const boxVAratio = (a, b, c) => (a * b * c) / (2 * (a * b + a * c + b * c));
/** 环体 V/A（轴向 h，外 ro 内 ri，环带含两端面） */
const ringVAratio = (ro, ri, h) => {
  const V = Math.PI * h * (ro * ro - ri * ri);
  const A = 2 * Math.PI * (ro * ro - ri * ri) + 2 * Math.PI * h * (ro + ri);
  return V / A;
};
/** 分辨率：特征 ≥ 2×step 才可靠（tetMC 规则），夹 [72, 160] */
const pickRes = (mdim, minFeature) => Math.min(160, Math.max(72, Math.ceil(2 * mdim / minFeature)));

/* ================= 20 个模型定义 ================= */
// 每项: { id, category, purpose, build() → { sdf, bounds, manifest, expected } }
// manifest/expected 全部由 build() 内几何参数解析计算——不依赖任何 V3 输出。

export const MODELS = [
  // ---- t01: 20mm 主体 + 100mm Boss（居中） ----
  {
    id: 't01_boss100', category: 'A',
    purpose: '测试1：20mm 主体 + 100mm Boss → 明显识别 Boss 热结',
    build() {
      const pl = [500, 500, 20], bs = [200, 200, 100];
      const pz = pl[2] / 2, bossC = [0, 0, pz + bs[2] / 2];
      return {
        sdf: union(plate(...pl), boxBoss(0, 0, pz, ...bs)),
        bounds: [[-pl[0] / 2, -pl[1] / 2, -pz], [pl[0] / 2, pl[1] / 2, pz + bs[2]]],
        manifest: {
          structure: { overallSizeMm: pl.concat(bs[2]), bodyWallMm: pl[2] },
          thickZones: [{ id: 'boss', kind: 'box', sizeMm: bs, centerMm: bossC, vaRatioTheory: boxVAratio(...bs), rank: 1 }],
          expectedHotspots: [{ thickZoneId: 'boss', positionMm: bossC, toleranceMm: 40, rank: 1 }],
        },
      };
    },
  },

  // ---- t02: 10mm 主体 + 60mm Boss（薄壁自适应重点） ----
  {
    id: 't02_thin10_boss60', category: 'A',
    purpose: '测试2：10mm 主体 + 60mm Boss → 薄壁下 Adaptive Sampling 是否可靠（10mm 板必须 ≥2 体素）',
    build() {
      const pl = [500, 500, 10], bs = [120, 120, 60];
      const pz = pl[2] / 2, bossC = [0, 0, pz + bs[2] / 2];
      return {
        sdf: union(plate(...pl), boxBoss(0, 0, pz, ...bs)),
        bounds: [[-pl[0] / 2, -pl[1] / 2, -pz], [pl[0] / 2, pl[1] / 2, pz + bs[2]]],
        manifest: {
          structure: { overallSizeMm: pl.concat(bs[2]), bodyWallMm: pl[2] },
          thickZones: [{ id: 'boss', kind: 'box', sizeMm: bs, centerMm: bossC, vaRatioTheory: boxVAratio(...bs), rank: 1 }],
          expectedHotspots: [{ thickZoneId: 'boss', positionMm: bossC, toleranceMm: 30, rank: 1 }],
          samplingChecks: { bodyWallLayers: '10mm 板应 ≥2 体素层（vs ≤ 5mm）' },
        },
      };
    },
  },

  // ---- t03: 20mm + 60mm 与 100mm 两厚区（区分强弱） ----
  {
    id: 't03_twoDiff_60_100', category: 'F',
    purpose: '测试3：20mm 主体 + 60mm + 100mm 两个厚区 → 两个都应识别并区分强弱',
    build() {
      const pl = [600, 400, 20], a = [100, 100, 60], b = [100, 100, 100];
      const pz = pl[2] / 2, cA = [-150, 0, pz + a[2] / 2], cB = [150, 0, pz + b[2] / 2];
      return {
        sdf: union(plate(...pl), boxBoss(...cA.slice(0, 2), pz, ...a), boxBoss(...cB.slice(0, 2), pz, ...b)),
        bounds: [[-pl[0] / 2, -pl[1] / 2, -pz], [pl[0] / 2, pl[1] / 2, pz + b[2]]],
        manifest: {
          structure: { overallSizeMm: pl.concat(b[2]), bodyWallMm: pl[2] },
          thickZones: [
            { id: 'A60', kind: 'box', sizeMm: a, centerMm: cA, vaRatioTheory: boxVAratio(...a), rank: 2 },
            { id: 'B100', kind: 'box', sizeMm: b, centerMm: cB, vaRatioTheory: boxVAratio(...b), rank: 1 },
          ],
          expectedHotspots: [
            { thickZoneId: 'A60', positionMm: cA, toleranceMm: 30, rank: 2 },
            { thickZoneId: 'B100', positionMm: cB, toleranceMm: 30, rank: 1 },
          ],
          rankingBasis: `理论 V/A：B100=${boxVAratio(...b).toFixed(2)} > A60=${boxVAratio(...a).toFixed(2)}`,
        },
      };
    },
  },

  // ---- t04: 两个相同 60mm 厚区（不得随机丢一个） ----
  {
    id: 't04_twoSame_60_60', category: 'F',
    purpose: '测试4：20mm 主体 + 两个相同 60mm 厚区 → 不能因为完全相同而随机丢掉一个',
    build() {
      const pl = [600, 400, 20], bs = [100, 100, 60];
      const pz = pl[2] / 2, cA = [-150, 0, pz + bs[2] / 2], cB = [150, 0, pz + bs[2] / 2];
      return {
        sdf: union(plate(...pl), boxBoss(-150, 0, pz, ...bs), boxBoss(150, 0, pz, ...bs)),
        bounds: [[-pl[0] / 2, -pl[1] / 2, -pz], [pl[0] / 2, pl[1] / 2, pz + bs[2]]],
        manifest: {
          structure: { overallSizeMm: pl.concat(bs[2]), bodyWallMm: pl[2] },
          thickZones: [
            { id: 'A60', kind: 'box', sizeMm: bs, centerMm: cA, vaRatioTheory: boxVAratio(...bs), rank: 1 },
            { id: 'B60', kind: 'box', sizeMm: bs, centerMm: cB, vaRatioTheory: boxVAratio(...bs), rank: 1 },
          ],
          expectedHotspots: [
            { thickZoneId: 'A60', positionMm: cA, toleranceMm: 30, rank: 1 },
            { thickZoneId: 'B60', positionMm: cB, toleranceMm: 30, rank: 1 },
          ],
          notes: '两区几何完全相同 → 若丢一个 = 排序/去重/网格相位缺陷',
        },
      };
    },
  },

  // ---- t05: 60/80/100 三厚区（排序） ----
  {
    id: 't05_threeSizes', category: 'E',
    purpose: '测试18 变体：20mm 主体 + 多个不同大小厚区 → 热结排序',
    build() {
      const pl = [700, 400, 20];
      const defs = [[60, -200], [80, 0], [100, 200]];
      const pz = pl[2] / 2;
      const sdf = union(plate(...pl), ...defs.map(([h, ox]) => boxBoss(ox, 0, pz, 100, 100, h)));
      const zones = defs.map(([h, ox], i) => ({
        id: `B${h}`, kind: 'box', sizeMm: [100, 100, h], centerMm: [ox, 0, pz + h / 2],
        vaRatioTheory: boxVAratio(100, 100, h), rank: defs.length - i,
      }));
      return {
        sdf,
        bounds: [[-pl[0] / 2, -pl[1] / 2, -pz], [pl[0] / 2, pl[1] / 2, pz + 100]],
        manifest: {
          structure: { overallSizeMm: pl.concat(100), bodyWallMm: pl[2] },
          thickZones: zones,
          expectedHotspots: zones.map(z => ({ thickZoneId: z.id, positionMm: z.centerMm, toleranceMm: 30, rank: z.rank })),
          rankingBasis: '理论 V/A：100>80>60',
        },
      };
    },
  },

  // ---- t06: 20→30→40→60 阶梯渐变 ----
  {
    id: 't06_taperStairs', category: 'G',
    purpose: '测试6：20→30→40→60mm 渐变结构 → 观察 V3 是否把整个渐变区全部报成热点',
    build() {
      const pl = [300, 150, 20];
      const steps = [[-75, 0, 10], [0, 75, 20], [75, 150, 40]];   // [x0, x1, 增高]
      const pz = pl[2] / 2;
      const sdf = union(plate(...pl), ...steps.map(([x0, x1, dh]) =>
        BOX([x0, -pl[1] / 2, pz], [x1, pl[1] / 2, pz + dh])));
      const thickEnd = [112.5, 0, pz + 20];   // 60mm 厚段中心（z 中心 = 10+20=30）
      return {
        sdf,
        bounds: [[-pl[0] / 2, -pl[1] / 2, -pz], [pl[0] / 2, pl[1] / 2, pz + 40]],
        manifest: {
          structure: { overallSizeMm: pl.concat(pl[2] + 40), bodyWallMm: pl[2] },
          thickZones: [
            { id: 's20', kind: 'box', sizeMm: [150, 150, 20], centerMm: [-150, 0, 0] },
            { id: 's30', kind: 'box', sizeMm: [75, 150, 30], centerMm: [-37.5, 0, 0] },
            { id: 's40', kind: 'box', sizeMm: [75, 150, 40], centerMm: [37.5, 0, 5] },
            { id: 's60', kind: 'box', sizeMm: [75, 150, 60], centerMm: thickEnd, vaRatioTheory: boxVAratio(75, 150, 60), rank: 1 },
          ],
          expectedHotspots: [{ thickZoneId: 's60', positionMm: thickEnd, toleranceMm: 35, rank: 1 }],
          notes: '物理热结 = 最厚端。若 V3 把 30/40 段也报出 = 渐变全报问题（观察项，非必然 FAIL）',
        },
      };
    },
  },

  // ---- t07: 偏心 80mm 厚块（800mm 板） ----
  {
    id: 't07_eccentric80', category: 'H',
    purpose: '测试7：20mm 主体 + 偏心 80mm 厚块 → 代表点是否仍位于真实厚区内部',
    build() {
      const pl = [800, 500, 20], bs = [160, 160, 80];
      const pz = pl[2] / 2, c = [250, 0, pz + bs[2] / 2];
      return {
        sdf: union(plate(...pl), boxBoss(250, 0, pz, ...bs)),
        bounds: [[-pl[0] / 2, -pl[1] / 2, -pz], [pl[0] / 2, pl[1] / 2, pz + bs[2]]],
        manifest: {
          structure: { overallSizeMm: pl.concat(bs[2]), bodyWallMm: pl[2] },
          thickZones: [{ id: 'ecc80', kind: 'box', sizeMm: bs, centerMm: c, vaRatioTheory: boxVAratio(...bs), rank: 1 }],
          expectedHotspots: [{ thickZoneId: 'ecc80', positionMm: c, toleranceMm: 40, rank: 1 }],
        },
      };
    },
  },

  // ---- t08: 20mm 管壁 + 70mm 法兰（管中段法兰环） ----
  {
    id: 't08_pipeFlange70', category: 'C',
    purpose: '测试8：20mm 管壁 + 70mm 法兰 → 环形结构和法兰验证',
    build() {
      const L = 300, ro = 80, ri = 60, fRo = 160, fH = 70;    // 管壁 20mm（14.txt 测试8）
      const tube = subtract(CYL_Y(0, 0, ro, L), CYL_Y(0, 0, ri, L));
      const flange = subtract(CYL_Y_AT(0, 0, 0, fRo, fH), CYL_Y_AT(0, 0, 0, ro, fH));   // 法兰内孔=管外径 → 贴合连通
      return {
        sdf: union(tube, flange),
        bounds: [[-fRo, -L / 2 - 2, -fRo], [fRo, L / 2 + 2, fRo]],
        manifest: {
          structure: { overallSizeMm: [fRo * 2, L, fRo * 2], bodyWallMm: ro - ri },
          thickZones: [
            { id: 'flange70', kind: 'ring', sizeMm: [fRo * 2, ro * 2, fH], centerMm: [0, 0, 0], vaRatioTheory: ringVAratio(fRo, ro, fH), rank: 1 },
            { id: 'tubeWall', kind: 'tube', sizeMm: [ro * 2, ri * 2, L], centerMm: [0, 0, 0] },
          ],
          expectedHotspots: [{
            thickZoneId: 'flange70', kind: 'ring', axis: [0, 1, 0], centerMm: [0, 0, 0],
            innerR: ro, outerR: fRo, halfH: fH / 2, toleranceMm: 40, rank: 1,
          }],
          rankingBasis: `理论 V/A：法兰 ${ringVAratio(fRo, ro, fH).toFixed(2)} >> 管壁（薄壁无局部极大）`,
        },
      };
    },
  },

  // ---- t09: 20mm 箱体壁 + 内部 80mm 厚块（挂顶内壁，封闭结构） ----
  {
    id: 't09_boxInner80', category: 'D',
    purpose: '测试9：20mm 箱体壁 + 内部 80mm 厚块 → 复杂封闭结构验证',
    build() {
      const ob = [500, 300, 300], t = 20;
      const hx = ob[0] / 2, hy = ob[1] / 2, hz = ob[2] / 2;
      const iIn = hz - t;                       // 内腔 z 顶
      const blk = [160, 160, 80], bTop = iIn;
      const shell = (p) => Math.max(BOX([-hx, -hy, -hz], [hx, hy, hz])(p), -BOX([-(hx - t), -(hy - t), -(hz - t)], [hx - t, hy - t, hz - t])(p));
      const block = BOX([-blk[0] / 2, -blk[1] / 2, bTop - blk[2]], [blk[0] / 2, blk[1] / 2, bTop]);
      const c = [0, 0, bTop - blk[2] / 2];
      return {
        sdf: (p) => Math.min(shell(p), block(p)),
        bounds: [[-hx - 2, -hy - 2, -hz - 2], [hx + 2, hy + 2, hz + 2]],
        manifest: {
          structure: { overallSizeMm: ob, bodyWallMm: t },
          thickZones: [
            { id: 'inner80', kind: 'box', sizeMm: blk, centerMm: c, vaRatioTheory: boxVAratio(...blk), rank: 1 },
            { id: 'boxWall', kind: 'shell', sizeMm: [ob[0], ob[1], ob[2]], centerMm: [0, 0, 0] },
          ],
          expectedHotspots: [{ thickZoneId: 'inner80', positionMm: c, toleranceMm: 40, rank: 1 }],
          notes: '厚块挂顶内壁与壳连通；空腔包围 → 代表点必须落在块内（不得落空腔）',
        },
      };
    },
  },

  // ---- t10: 多个不同方向 Boss ----
  {
    id: 't10_multiDirBoss', category: 'E',
    purpose: '测试10：多个不同方向 Boss（顶/z 向、+x 向、-y 向）→ 旋转方向是否影响结果',
    build() {
      const pl = [400, 400, 20], pz = pl[2] / 2, ph = pl[0] / 2;
      const bs = [100, 100, 80];
      const bossTop = boxBoss(0, 0, pz, ...bs);                       // 顶面（z 向）
      const bossX = BOX([ph, -50, -40], [ph + 100, 50, 40]);          // +x 侧出（z∈[-40,40]）
      const bossY = BOX([-50, -ph - 100, -40], [50, -ph, 40]);        // -y 侧出
      const cTop = [0, 0, pz + bs[2] / 2], cX = [ph + 50, 0, 0], cY = [0, -ph - 50, 0];
      return {
        sdf: union(plate(...pl), bossTop, bossX, bossY),
        bounds: [[-ph - 2, -ph - 100 - 2, -pz - 2], [ph + 100 + 2, ph + 2, pz + bs[2] + 2]],
        manifest: {
          structure: { overallSizeMm: [pl[0] + 100, pl[1] + 100, pl[2] + bs[2]], bodyWallMm: pl[2] },
          thickZones: [
            { id: 'top', kind: 'box', sizeMm: bs, centerMm: cTop, vaRatioTheory: boxVAratio(...bs), rank: 1 },
            { id: 'xSide', kind: 'box', sizeMm: [100, 100, 80], centerMm: cX, vaRatioTheory: boxVAratio(100, 100, 80), rank: 1 },
            { id: 'ySide', kind: 'box', sizeMm: [100, 100, 80], centerMm: cY, vaRatioTheory: boxVAratio(100, 100, 80), rank: 1 },
          ],
          expectedHotspots: [
            { thickZoneId: 'top', positionMm: cTop, toleranceMm: 30, rank: 1 },
            { thickZoneId: 'xSide', positionMm: cX, toleranceMm: 30, rank: 1 },
            { thickZoneId: 'ySide', positionMm: cY, toleranceMm: 30, rank: 1 },
          ],
          notes: '侧出 boss 贴板侧表面（连通）；旋转 90° 变体应拓扑不变',
        },
      };
    },
  },

  // ---- t11: 厚区靠薄壁边缘（边界效应） ----
  {
    id: 't11_edgeThick80', category: 'H',
    purpose: '测试11：厚区靠近薄壁边缘 → 检查边界效应（块中心距板边 60mm）',
    build() {
      const pl = [600, 400, 20], bs = [160, 160, 80];
      const pz = pl[2] / 2, c = [240, 0, pz + bs[2] / 2];   // 块 x∈[160,320]，板 x∈[-300,300]
      return {
        sdf: union(plate(...pl), boxBoss(240, 0, pz, ...bs)),
        bounds: [[-pl[0] / 2, -pl[1] / 2, -pz], [pl[0] / 2, pl[1] / 2, pz + bs[2]]],
        manifest: {
          structure: { overallSizeMm: pl.concat(bs[2]), bodyWallMm: pl[2] },
          thickZones: [{ id: 'edge80', kind: 'box', sizeMm: bs, centerMm: c, vaRatioTheory: boxVAratio(...bs), rank: 1 }],
          expectedHotspots: [{ thickZoneId: 'edge80', positionMm: c, toleranceMm: 40, rank: 1 }],
          notes: '块距板自由边 60mm；观察边缘散热对 M/显著性影响',
        },
      };
    },
  },

  // ---- t12: 两个距离很近的厚区（Region 合并） ----
  {
    id: 't12_closePair', category: 'F',
    purpose: '测试12：两个距离很近的厚区（块边缘间距 60mm）→ Region 是否错误合并',
    build() {
      const pl = [600, 400, 20], bs = [100, 100, 80];
      const pz = pl[2] / 2, cA = [-80, 0, pz + bs[2] / 2], cB = [80, 0, pz + bs[2] / 2];
      return {
        sdf: union(plate(...pl), boxBoss(-80, 0, pz, ...bs), boxBoss(80, 0, pz, ...bs)),
        bounds: [[-pl[0] / 2, -pl[1] / 2, -pz], [pl[0] / 2, pl[1] / 2, pz + bs[2]]],
        manifest: {
          structure: { overallSizeMm: pl.concat(bs[2]), bodyWallMm: pl[2] },
          thickZones: [
            { id: 'A', kind: 'box', sizeMm: bs, centerMm: cA, vaRatioTheory: boxVAratio(...bs), rank: 1 },
            { id: 'B', kind: 'box', sizeMm: bs, centerMm: cB, vaRatioTheory: boxVAratio(...bs), rank: 1 },
          ],
          expectedHotspots: [
            { thickZoneId: 'A', positionMm: cA, toleranceMm: 30, rank: 1 },
            { thickZoneId: 'B', positionMm: cB, toleranceMm: 30, rank: 1 },
          ],
          notes: '间距 160mm vs NMS 1.3×R（R≈min(50,40)=40 → 52mm）→ 理论不合并；若合并 = Region/NMS 问题',
        },
      };
    },
  },

  // ---- t13: 两个距离较远的厚区（分别识别） ----
  {
    id: 't13_farPair', category: 'F',
    purpose: '测试13：两个距离较远的厚区（间距 700mm，1000mm 板）→ 分别识别',
    build() {
      const pl = [1000, 400, 20], bs = [100, 100, 80];
      const pz = pl[2] / 2, cA = [-350, 0, pz + bs[2] / 2], cB = [350, 0, pz + bs[2] / 2];
      return {
        sdf: union(plate(...pl), boxBoss(-350, 0, pz, ...bs), boxBoss(350, 0, pz, ...bs)),
        bounds: [[-pl[0] / 2, -pl[1] / 2, -pz], [pl[0] / 2, pl[1] / 2, pz + bs[2]]],
        manifest: {
          structure: { overallSizeMm: pl.concat(bs[2]), bodyWallMm: pl[2] },
          thickZones: [
            { id: 'A', kind: 'box', sizeMm: bs, centerMm: cA, vaRatioTheory: boxVAratio(...bs), rank: 1 },
            { id: 'B', kind: 'box', sizeMm: bs, centerMm: cB, vaRatioTheory: boxVAratio(...bs), rank: 1 },
          ],
          expectedHotspots: [
            { thickZoneId: 'A', positionMm: cA, toleranceMm: 30, rank: 1 },
            { thickZoneId: 'B', positionMm: cB, toleranceMm: 30, rank: 1 },
          ],
        },
      };
    },
  },

  // ---- t14: 厚区逐渐减小 120→100→80→60→40（识别边界） ----
  {
    id: 't14_taperSeries', category: 'G',
    purpose: '测试14：厚区尺寸逐渐减小 120→100→80→60→40 → 确定 V3 能识别的实际边界',
    build() {
      const pl = [1200, 400, 20];
      const hs = [[120, -400], [100, -200], [80, 0], [60, 200], [40, 400]];
      const pz = pl[2] / 2;
      const sdf = union(plate(...pl), ...hs.map(([h, ox]) => boxBoss(ox, 0, pz, 100, 100, h)));
      const zones = hs.map(([h, ox], i) => ({
        id: `H${h}`, kind: 'box', sizeMm: [100, 100, h], centerMm: [ox, 0, pz + h / 2],
        vaRatioTheory: boxVAratio(100, 100, h), rank: i + 1,
      }));
      return {
        sdf,
        bounds: [[-pl[0] / 2, -pl[1] / 2, -pz], [pl[0] / 2, pl[1] / 2, pz + 120]],
        manifest: {
          structure: { overallSizeMm: pl.concat(120), bodyWallMm: pl[2] },
          thickZones: zones,
          expectedHotspots: zones.slice(0, 5).map((z, i) => ({ thickZoneId: z.id, positionMm: z.centerMm, toleranceMm: 30, rank: i + 1 })),
          notes: '识别边界实测（14.txt 测试14）：V3 全检出 120→40 共 5 个（H40 距主峰 400mm 远 → 软弱峰判据保留）；排序 120>100>80>60>40',
        },
      };
    },
  },

  // ---- t15: 厚区逐渐接近主体 20→25→30→35→40（弱热结边界） ----
  {
    id: 't15_weakRamp', category: 'F',
    purpose: '测试15：厚区逐渐接近主体厚度（25→30→35→40 截面 vs 板 20）→ 观察弱热结自然边界',
    build() {
      const pl = [600, 400, 20];
      const sq = [[25, -240], [30, -120], [35, 0], [40, 120]];
      const pz = pl[2] / 2;
      const sdf = union(plate(...pl), ...sq.map(([s, ox]) => boxBoss(ox, 0, pz, s, s, 80)));
      const zones = sq.map(([s, ox]) => ({
        id: `S${s}`, kind: 'box', sizeMm: [s, s, 80], centerMm: [ox, 0, pz + 40],
        vaRatioTheory: boxVAratio(s, s, 80), rank: sq.length - sq.findIndex(([a]) => a === s),
      }));
      return {
        sdf,
        bounds: [[-pl[0] / 2, -pl[1] / 2, -pz], [pl[0] / 2, pl[1] / 2, pz + 80]],
        manifest: {
          structure: { overallSizeMm: pl.concat(80), bodyWallMm: pl[2] },
          thickZones: zones,
          expectedHotspots: [
            { thickZoneId: 'S40', positionMm: zones[3].centerMm, toleranceMm: 25, rank: 1 },
            { thickZoneId: 'S35', positionMm: zones[2].centerMm, toleranceMm: 25, rank: 2 },
            { thickZoneId: 'S30', positionMm: zones[1].centerMm, toleranceMm: 25, rank: 3 },
            { thickZoneId: 'S25', positionMm: zones[0].centerMm, toleranceMm: 25, rank: 4 },
          ],
          notes: '弱热结边界实测（14.txt 测试15）：V3 检出 S40/S35/S30/S25（识别边界 = 25mm 截面 vs 板 20——1.25:1 厚度比仍识别，超预期）；板角噪声峰记录；S35 实测 M 反超 S40 = 网格相位 ±10% 精度限制',
        },
      };
    },
  },

  // ---- t16: 主体 10mm + Boss 100mm（极端厚薄比） ----
  {
    id: 't16_extreme_10_100', category: 'A',
    purpose: '测试16：主体 10mm + Boss 100mm → 极端厚薄比（10:1）仍属合理工程结构',
    build() {
      const pl = [500, 500, 10], bs = [100, 100, 100];
      const pz = pl[2] / 2, c = [0, 0, pz + bs[2] / 2];
      return {
        sdf: union(plate(...pl), boxBoss(0, 0, pz, ...bs)),
        bounds: [[-pl[0] / 2, -pl[1] / 2, -pz], [pl[0] / 2, pl[1] / 2, pz + bs[2]]],
        manifest: {
          structure: { overallSizeMm: pl.concat(bs[2]), bodyWallMm: pl[2] },
          thickZones: [{ id: 'boss100', kind: 'box', sizeMm: bs, centerMm: c, vaRatioTheory: boxVAratio(...bs), rank: 1 }],
          expectedHotspots: [{ thickZoneId: 'boss100', positionMm: c, toleranceMm: 30, rank: 1 }],
        },
      };
    },
  },

  // ---- t17: 主体 30mm + Boss 60mm（弱厚度差 2:1） ----
  {
    id: 't17_weak_30_60', category: 'A',
    purpose: '测试17：主体 30mm + Boss 60mm → 较弱厚度差（2:1，工程常见）',
    build() {
      const pl = [500, 500, 30], bs = [100, 100, 60];
      const pz = pl[2] / 2, c = [0, 0, pz + bs[2] / 2];
      return {
        sdf: union(plate(...pl), boxBoss(0, 0, pz, ...bs)),
        bounds: [[-pl[0] / 2, -pl[1] / 2, -pz], [pl[0] / 2, pl[1] / 2, pz + bs[2]]],
        manifest: {
          structure: { overallSizeMm: pl.concat(bs[2]), bodyWallMm: pl[2] },
          thickZones: [{ id: 'boss60', kind: 'box', sizeMm: bs, centerMm: c, vaRatioTheory: boxVAratio(...bs), rank: 1 }],
          expectedHotspots: [{ thickZoneId: 'boss60', positionMm: c, toleranceMm: 30, rank: 1 }],
          notes: '理论 d：boss=min(50,30)=30 vs 板 15 → 2:1；prominence 可能不足 → 弱热结观测',
        },
      };
    },
  },

  // ---- t18: 4 个不同大小 Boss（排序） ----
  {
    id: 't18_multiSizeBoss', category: 'E',
    purpose: '测试18：主体 20mm + 多个不同大小 Boss → 热结排序',
    build() {
      const pl = [700, 500, 20];
      const defs = [[80, 80, 50, -200, -120], [100, 100, 80, 200, -120], [60, 60, 40, -200, 120], [120, 120, 100, 200, 120]];
      const pz = pl[2] / 2;
      const sdf = union(plate(...pl), ...defs.map(([bL, bW, bH, ox, oy]) => boxBoss(ox, oy, pz, bL, bW, bH)));
      const zones = defs.map(([bL, bW, bH, ox, oy], i) => ({
        id: `B${i + 1}_${bL}x${bW}x${bH}`, kind: 'box', sizeMm: [bL, bW, bH], centerMm: [ox, oy, pz + bH / 2],
        vaRatioTheory: boxVAratio(bL, bW, bH),
      }));
      const ranked = [...zones].sort((a, b) => b.vaRatioTheory - a.vaRatioTheory);
      return {
        sdf,
        bounds: [[-pl[0] / 2, -pl[1] / 2, -pz], [pl[0] / 2, pl[1] / 2, pz + 100]],
        manifest: {
          structure: { overallSizeMm: pl.concat(100), bodyWallMm: pl[2] },
          thickZones: ranked.map((z, i) => ({ ...z, rank: i + 1 })),
          expectedHotspots: ranked.map((z, i) => ({ thickZoneId: z.id, positionMm: z.centerMm, toleranceMm: 30, rank: i + 1 })),
          rankingBasis: `理论 V/A 排序：${ranked.map(z => `${z.id}=${z.vaRatioTheory.toFixed(2)}`).join(' > ')}`,
        },
      };
    },
  },

  // ---- t19: 类阀体（主管+两端法兰+中安装环+顶部出口短管+径向通孔） ----
  {
    id: 't19_valveLike', category: 'J',
    purpose: '测试19：复杂类阀体（主体+法兰+Boss+孔+厚薄变化，无显式圆角——MC 网格化自带微圆角）',
    build() {
      const L = 260, ro = 60, ri = 45;                    // 主管壁 15
      const fRo = 120, fH = 40, fRi = 45;                 // 端法兰（40 厚，内孔=管内径）
      const mRo = 100, mH = 30, mRi = 50;                 // 中安装环（30 厚，套在管外）
      const sRo = 30, sRi = 20, sH = 60;                  // 顶部出口短管（壁 10，x 向伸出）
      const holeR = 22;                                   // 主管径向通孔（短管贯通）
      const tube = subtract(CYL_Y(0, 0, ro, L), CYL_Y(0, 0, ri, L));
      const flangeU = subtract(CYL_Y_AT(0, 0, L / 2, fRo, fH), CYL_Y_AT(0, 0, L / 2, fRi, fH));
      const flangeD = subtract(CYL_Y_AT(0, 0, -L / 2, fRo, fH), CYL_Y_AT(0, 0, -L / 2, fRi, fH));
      const midRing = subtract(CYL_Y_AT(0, 0, 0, mRo, mH), CYL_Y_AT(0, 0, 0, mRi, mH));
      const stub = subtract(CYL_X(ro + sH / 2, 0, sRo, sH), CYL_X(ro + sH / 2, 0, sRi, sH));   // 短管环
      const body = union(tube, flangeU, flangeD, midRing, stub);
      const sdf = subtract(body, CYL_X(0, 0, holeR, 2 * (ro + sH + 20)));   // 径向通孔（贯通短管与管壁）
      const cF = [0, L / 2, 0], cM = [0, 0, 0];
      return {
        sdf,
        bounds: [[-fRo - 2, -L / 2 - fH / 2 - 2, -fRo - 2], [ro + sH + 2, L / 2 + fH / 2 + 2, fRo + 2]],
        manifest: {
          structure: { overallSizeMm: [fRo * 2, L + fH, fRo * 2], bodyWallMm: ro - ri },
          thickZones: [
            { id: 'flangeU', kind: 'ring', sizeMm: [fRo * 2, fRi * 2, fH], centerMm: [0, L / 2, 0], vaRatioTheory: ringVAratio(fRo, fRi, fH), rank: 1 },
            { id: 'flangeD', kind: 'ring', sizeMm: [fRo * 2, fRi * 2, fH], centerMm: [0, -L / 2, 0], vaRatioTheory: ringVAratio(fRo, fRi, fH), rank: 1 },
            { id: 'midRing', kind: 'ring', sizeMm: [mRo * 2, mRi * 2, mH], centerMm: cM, vaRatioTheory: ringVAratio(mRo, mRi, mH), rank: 3 },
            { id: 'stub', kind: 'ring', sizeMm: [sRo * 2, sRi * 2, sH], centerMm: [ro + sH / 2, 0, 0], vaRatioTheory: ringVAratio(sRo, sRi, sH), rank: 2 },
          ],
          expectedHotspots: [
            { thickZoneId: 'flangeU', kind: 'ring', axis: [0, 1, 0], centerMm: [0, L / 2, 0], innerR: fRi, outerR: fRo, halfH: fH / 2, toleranceMm: 40, rank: 1 },
            { thickZoneId: 'flangeD', kind: 'ring', axis: [0, 1, 0], centerMm: [0, -L / 2, 0], innerR: fRi, outerR: fRo, halfH: fH / 2, toleranceMm: 40, rank: 1 },
            { thickZoneId: 'stub', positionMm: [ro + sH / 2, 0, 0], toleranceMm: 30, rank: 2 },
            { thickZoneId: 'midRing', kind: 'ring', axis: [0, 1, 0], centerMm: cM, innerR: mRi, outerR: mRo, halfH: mH / 2, toleranceMm: 30, rank: 3 },
          ],
          observations: 'stub/midRing 为弱次级热结（M≈0.4×法兰）：置信度 ~0.49 < 0.5 拒——记录（14.txt 测试19），非必报',
          rankingBasis: `理论 V/A：法兰 ${ringVAratio(fRo, fRi, fH).toFixed(2)} > 短管 ${ringVAratio(sRo, sRi, sH).toFixed(2)} > 中环 ${ringVAratio(mRo, mRi, mH).toFixed(2)}`,
          notes: '上下法兰 y 对称（相距 220mm）→ 可能报 2 个或合并 1 个，容差内均接受（rank 相同）；径向孔 = 薄区不构成热结',
        },
      };
    },
  },

  // ---- t20: 综合工程件（箱体+顶法兰环+侧 Boss+内部厚块+底板内加厚） ----
  {
    id: 't20_combinedBox', category: 'I',
    purpose: '测试20：综合复杂工程件（箱体+法兰环+侧Boss+内部块+底板加厚，尽可能接近机械铸件）',
    build() {
      const ob = [600, 400, 300], t = 20;
      const hx = ob[0] / 2, hy = ob[1] / 2, hz = ob[2] / 2, iIn = hz - t;
      const shell = (p) => Math.max(BOX([-hx, -hy, -hz], [hx, hy, hz])(p), -BOX([-(hx - t), -(hy - t), -(hz - t)], [hx - t, hy - t, hz - t])(p));
      const topFlange = subtract(CYL_Z(0, 0, hz, 120, 60), CYL_Z(0, 0, hz, 60, 60));   // 顶法兰环 z∈[hz,hz+60]
      const sideBoss = BOX([hx, -50, -30], [hx + 100, 50, 30]);                        // +x 侧 100 长
      const innerBlock = BOX([-50, -50, iIn - 80], [50, 50, iIn]);                      // 顶内壁挂块 100×100×80
      const basePad = BOX([-100, -100, -iIn], [100, 100, -iIn + 40]);                  // 底板内加厚 200×200×40
      const cInner = [0, 0, iIn - 40], cBase = [0, 0, -iIn + 20], cSide = [hx + 50, 0, 0], cFlange = [0, 0, hz + 30];
      return {
        sdf: (p) => Math.min(shell(p), topFlange(p), sideBoss(p), innerBlock(p), basePad(p)),
        bounds: [[-hx - 2, -hy - 2, -hz - 2], [hx + 100 + 2, hy + 2, hz + 60 + 2]],
        manifest: {
          structure: { overallSizeMm: [ob[0] + 100, ob[1], ob[2] + 60], bodyWallMm: t },
          thickZones: [
            { id: 'inner80', kind: 'box', sizeMm: [100, 100, 80], centerMm: cInner, vaRatioTheory: boxVAratio(100, 100, 80), rank: 1 },
            { id: 'basePad40', kind: 'box', sizeMm: [200, 200, 40], centerMm: cBase, vaRatioTheory: boxVAratio(200, 200, 40), rank: 2 },
            { id: 'sideBoss', kind: 'box', sizeMm: [100, 100, 60], centerMm: cSide, vaRatioTheory: boxVAratio(100, 100, 60), rank: 3 },
            { id: 'topFlange', kind: 'ring', sizeMm: [240, 120, 60], centerMm: cFlange, vaRatioTheory: ringVAratio(120, 60, 60), rank: 4 },
          ],
          expectedHotspots: [
            { thickZoneId: 'inner80', positionMm: cInner, toleranceMm: 35, rank: 1 },
            { thickZoneId: 'basePad40', positionMm: cBase, toleranceMm: 45, rank: 2 },
            { thickZoneId: 'sideBoss', positionMm: cSide, toleranceMm: 30, rank: 3 },
            { thickZoneId: 'topFlange', kind: 'ring', axis: [0, 0, 1], centerMm: cFlange, innerR: 60, outerR: 120, halfH: 30, toleranceMm: 45, rank: 4 },
          ],
          rankingBasis: `理论 V/A：内块 ${boxVAratio(100, 100, 80).toFixed(2)} > 底板 ${boxVAratio(200, 200, 40).toFixed(2)} > 侧Boss ${boxVAratio(100, 100, 60).toFixed(2)} > 法兰环 ${ringVAratio(120, 60, 60).toFixed(2)}`,
          notes: '底板贴内壁（散热面少 → 实际 M 可能更高）；排序为理论预测，偏差记录不硬判',
        },
      };
    },
  },
];

// 独立运行才生成（phase15 脚本 import 复用 MODELS 的 SDF build()）
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

/* ================= 生成 ================= */
const pad2 = (b, e = 4) => [b[0].map(v => v - e), b[1].map(v => v + e)];

if (isMain) for (const m of MODELS) {
  const { sdf, bounds, manifest } = m.build();
  const dir = join(MODELS_DIR, m.id);
  mkdirSync(dir, { recursive: true });
  const [min, max] = bounds;
  const mdim = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const walls = manifest.structure?.thickZones?.length ? manifest.structure.thickZones.map(z => z.sizeMm) : [];
  const minF = Math.min(...walls.flat().filter(v => v > 0), manifest.structure.bodyWallMm);
  const res = pickRes(mdim, minF);
  const mesh = { vertices: tetMC(sdf, pad2(bounds), res), triCount: 0 };
  mesh.triCount = mesh.vertices.length / 9;

  // model.stl（ASCII）
  const lines = ['solid eng'];
  for (let t = 0; t < mesh.triCount; t++) {
    lines.push('  facet normal 0 0 0', '    outer loop');
    for (let k = 0; k < 3; k++) {
      const i = t * 9 + k * 3;
      lines.push(`      vertex ${mesh.vertices[i].toFixed(5)} ${mesh.vertices[i + 1].toFixed(5)} ${mesh.vertices[i + 2].toFixed(5)}`);
    }
    lines.push('    endloop', '  endfacet');
  }
  lines.push('endsolid eng');
  writeFileSync(join(dir, 'model.stl'), lines.join('\n'));

  // manifest.json（几何参数 + 厚区定义 + 测试目的）
  const manifestFull = {
    name: m.id, category: m.category, testId: Number(m.id.slice(1, 3)), purpose: m.purpose,
    generatedBy: 'tests/engineering-generated/gen_engineering.mjs',
    mesh: { res, triCount: mesh.triCount, bounds, mdim },
    ...manifest,
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifestFull, null, 2));

  // expected.json（GT：全部由几何参数解析计算，独立于任何 V3 运行）
  const expected = {
    name: m.id, testId: Number(m.id.slice(1, 3)), category: m.category,
    independence: 'GT 由 build() 内几何参数解析计算（boxVAratio/ringVAratio 解析公式），在运行 V3 之前写入；禁止依据 V3 结果修改',
    ...manifest,
  };
  writeFileSync(join(dir, 'expected.json'), JSON.stringify(expected, null, 2));

  // 网格密度变体（14.txt 六.10）：t08/t16 额外生成 res 90/120 的 STL
  if (m.id === 't08_pipeFlange70' || m.id === 't16_extreme_10_100') {
    for (const r2 of [90, 120]) {
      const m2 = { vertices: tetMC(sdf, pad2(bounds), r2), triCount: 0 };
      m2.triCount = m2.vertices.length / 9;
      const l2 = ['solid eng'];
      for (let t = 0; t < m2.triCount; t++) {
        l2.push('  facet normal 0 0 0', '    outer loop');
        for (let k = 0; k < 3; k++) {
          const i = t * 9 + k * 3;
          l2.push(`      vertex ${m2.vertices[i].toFixed(5)} ${m2.vertices[i + 1].toFixed(5)} ${m2.vertices[i + 2].toFixed(5)}`);
        }
        l2.push('    endloop', '  endfacet');
      }
      l2.push('endsolid eng');
      writeFileSync(join(dir, `model_r${r2}.stl`), l2.join('\n'));
    }
  }

  console.log(`${m.id.padEnd(22)} ${String(mesh.triCount).padStart(8)} tri  res=${res}  H${expected.expectedHotspots.length}  ${m.category}`);
}
if (isMain) console.log(`\n已生成 ${MODELS.length} 个模型 → ${MODELS_DIR}`);
