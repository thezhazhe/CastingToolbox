// ============================================================
// Hotspot V2.1 Self Validation · 参数化几何生成器（命令文件 7.txt 第一节/第二节）
// 生成 22 种铸件几何（内存 mesh，可落盘 STL）+ 解析 Ground Truth（全部自动计算，不写死坐标）
//
// GT 约定（半壁厚语义，与引擎一致）：
//   d       = 最大内切距离（引擎 score/mc 的解析值）
//   thickness = 2×d（局部壁厚）
//   mc      = d（引擎 refineMcGlobal 返回最大到表面距离）
//   expectedHotspots[].x 可为 null → runner 跳过该轴（环形等对称热结，用 radialRange 验证）
// ============================================================
import { tetMC, BOX, CYL_Y, SPHERE, union, subtract } from '../helpers/stlGen.js';

/* ================= 基础 ================= */

/** MC 网格化 → 内存 mesh（与 parseSTL 同构：{vertices:Float32Array, triCount}） */
export function makeMesh(sdf, bounds, res) {
  const verts = tetMC(sdf, bounds, res);
  return { vertices: verts, triCount: verts.length / 9 };
}

/** 落盘 ASCII STL（复现/报告用） */
export function writeSTL(mesh, file) {
  const { writeFileSync } = awaitImport('node:fs');
  const lines = ['solid gen'];
  const v = mesh.vertices;
  for (let t = 0; t < mesh.triCount; t++) {
    lines.push('  facet normal 0 0 0', '    outer loop');
    for (let k = 0; k < 3; k++) {
      lines.push(`      vertex ${v[t * 9 + k * 3].toFixed(6)} ${v[t * 9 + k * 3 + 1].toFixed(6)} ${v[t * 9 + k * 3 + 2].toFixed(6)}`);
    }
    lines.push('    endloop', '  endfacet');
  }
  lines.push('endsolid gen');
  writeFileSync(file, lines.join('\n'));
}
const awaitImport = (m) => import(m);   // 懒加载 fs（生成器在浏览器/Node 双环境可选）

/** 特征 ≥ 2×step 才网格化可靠（memory：MC 特征要求）；capped 180 保性能 */
export function pickRes(mdim, minFeature, base = 72) {
  const need = Math.ceil(2 * mdim / minFeature);
  return Math.min(180, Math.max(base, need));
}

/** 顶点变换（旋转/平移/缩放）——旋转绕指定轴过原点 */
export function transformMesh(mesh, fn) {
  const v = mesh.vertices;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i += 3) {
    const [x, y, z] = fn(v[i], v[i + 1], v[i + 2]);
    out[i] = x; out[i + 1] = y; out[i + 2] = z;
  }
  return { vertices: out, triCount: mesh.triCount };
}
export const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return (x, y, z) => [x, y * c - z * s, y * s + z * c]; };
export const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return (x, y, z) => [x * c + z * s, y, -x * s + z * c]; };
export const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return (x, y, z) => [x * c - y * s, x * s + y * c, z]; };
export const trans = (dx, dy, dz) => (x, y, z) => [x + dx, y + dy, z + dz];
export const scaleMesh = (mesh, s) => transformMesh(mesh, (x, y, z) => [x * s, y * s, z * s]);
export const translateMesh = (mesh, dx, dy, dz) => transformMesh(mesh, trans(dx, dy, dz));
export function rotateMesh(mesh, axis, deg) {
  const r = deg * Math.PI / 180;
  const f = axis === 'x' ? rotX(r) : axis === 'y' ? rotY(r) : rotZ(r);
  return transformMesh(mesh, f);
}

/* ================= 梯形棱柱（taper 用；凸多边形截面，内为负） ================= */
/** 凸多边形有符号距离（内负外正，顶点逆时针）：
 *  内部点每条边外法线点积 < 0 → max < 0；顶点处为圆角近似（误差 < step，MC 可接受） */
function polyDist(x, z, poly) {
  let d = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % poly.length];
    const ex = x2 - x1, ez = z2 - z1, px = x - x1, pz = z - z1;
    const cross = ex * pz - ez * px;   // 逆时针：内部 cross > 0
    const len = Math.hypot(ex, ez);
    d = Math.max(d, -cross / len);     // 外法线点积：内部负、外部正
  }
  return d;
}
/** 棱柱：截面 poly（x-z 平面，逆时针），y∈[cy-h/2, cy+h/2] */
export const PRISM = (cy, h, poly) => (p) => Math.max(
  Math.abs(p[1] - cy) - h / 2,
  polyDist(p[0], p[2], poly),
);

/* ================= 解析 GT helper ================= */

const dBox = (min, max) => Math.min((max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2);
const centerOf = (min, max) => [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
const pad = (min, max, e = 2) => [min.map(v => v - e), max.map(v => v + e)];

/**
 * 生成一个模型：{ kind, params, sdf, bounds, res, gt }
 * 工厂 fn(params) → { sdf, bounds(min,max 不含 padding), res, gt }
 */
export const KINDS = {
  // ---- 1-5 均匀件（期望 NO_HOTSPOT） ----
  uniformCube: ({ size = 100 } = {}) => {
    const h = size / 2;
    return {
      sdf: BOX([-h, -h, -h], [h, h, h]), bounds: [[-h, -h, -h], [h, h, h]],
      gt: { expectedUniform: true, expectedHotspots: [], expectedThicknessZones: [{ x: 0, y: 0, z: 0, thickness: size }],
        tolerances: {} },
    };
  },
  uniformCylinder: ({ r = 40, h = 120 } = {}) => ({
    sdf: CYL_Y(0, 0, r, h), bounds: [[-r, -h / 2, -r], [r, h / 2, r]],
    gt: { expectedUniform: true, expectedHotspots: [], expectedThicknessZones: [{ x: 0, y: 0, z: 0, thickness: 2 * Math.min(r, h / 2) }], tolerances: {} },
  }),
  uniformPlate: ({ l = 300, w = 200, t = 40 } = {}) => ({
    sdf: BOX([-l / 2, -w / 2, -t / 2], [l / 2, w / 2, t / 2]), bounds: [[-l / 2, -w / 2, -t / 2], [l / 2, w / 2, t / 2]],
    gt: { expectedUniform: true, expectedHotspots: [], expectedThicknessZones: [{ x: 0, y: 0, z: 0, thickness: t }], tolerances: {} },
  }),
  uniformTube: ({ ro = 50, ri = 40, h = 100 } = {}) => {
    const t = ro - ri;
    return {
      sdf: subtract(CYL_Y(0, 0, ro, h), CYL_Y(0, 0, ri, h)), bounds: [[-ro, -h / 2, -ro], [ro, h / 2, ro]],
      gt: { expectedUniform: true, expectedHotspots: [],
        expectedThicknessZones: [{ x: ri + t / 2, y: 0, z: 0, thickness: t }],
        tolerances: {},
        notes: '端部 MC 圆角伪厚（tube_wall10 已知伪影）→ 可能报弱热结 TEST_ARTIFACT' },
    };
  },
  thinShell: ({ l = 400, w = 200, h = 100, t = 8 } = {}) => {
    const b = [l / 2, w / 2, h / 2], i = [l / 2 - t, w / 2 - t, h / 2 - t];
    return {
      sdf: subtract(BOX([-b[0], -b[1], -b[2]], [b[0], b[1], b[2]]), BOX([-i[0], -i[1], -i[2]], [i[0], i[1], i[2]])),
      bounds: [[-b[0], -b[1], -b[2]], [b[0], b[1], b[2]]],
      res: pickRes(Math.max(l, w, h), t),
      gt: { expectedUniform: true, expectedHotspots: [],
        expectedThicknessZones: [{ x: 0, y: 0, z: 0, thickness: t }], tolerances: {},
        notes: '角部 MC 圆角伪厚 → 可能报弱热结 TEST_ARTIFACT' },
    };
  },

  // ---- 6/7/14/15 板 + 凸台（中央/偏心/多凸台共用） ----
  bossOnPlate: ({ pl = [400, 200, 8], bs = [100, 100, 60], ox = 0, oy = 0 } = {}) => {
    const [plL, plW, plT] = pl, [bL, bW, bH] = bs;
    const pz = plT / 2;                       // 板上表面 z
    const bMin = [ox - bL / 2, oy - bW / 2, pz], bMax = [ox + bL / 2, oy + bW / 2, pz + bH];
    const d = dBox(bMin, bMax);               // = min(bH, bL, bW)/2（凸台中心）
    return {
      sdf: union(
        BOX([-plL / 2, -plW / 2, -pz], [plL / 2, plW / 2, pz]),
        BOX(bMin, bMax),
      ),
      bounds: pad([-plL / 2, -plW / 2, -pz], [Math.max(plL / 2, bMax[0]), Math.max(plW / 2, bMax[1]), bMax[2]]),
      gt: {
        expectedUniform: false,
        expectedHotspots: [{ x: ox, y: oy, z: pz + bH / 2, thickness: 2 * d, mc: d, ratio: d / d }],
        expectedThicknessZones: [{ x: ox, y: oy, z: pz + bH / 2, thickness: 2 * d }, { x: 0, y: 0, z: 0, thickness: plT }],
        expectedThermalCenters: [{ x: ox, y: oy, z: pz + bH / 2 }],
        tolerances: {},
        notes: '凸台中心为唯一热结；板 d=plT/2 薄区',
      },
    };
  },

  // ---- 9 台阶厚度（厚薄突变） ----
  steppedThickness: ({ l = 300, w = 100, tThin = 20, tThick = 60, junction = 0 } = {}) => {
    // 薄段 x∈[-l/2, junction]，厚段 x∈[junction, l/2]（junction 处厚度突变）
    const lt = l / 2, th = tThick / 2, tn = tThin / 2;
    return {
      sdf: subtract(
        BOX([-lt, -w / 2, -th], [lt, w / 2, th]),                    // 整块厚 tThick
        BOX([-lt, -w / 2, -th], [junction, w / 2, -tn]),             // 薄段下方挖（z∈[-th,-tn]）
        BOX([-lt, -w / 2, tn], [junction, w / 2, th]),               // 薄段上方挖
      ),
      bounds: [[-lt - 2, -w / 2 - 2, -th - 2], [lt + 2, w / 2 + 2, th + 2]],
      gt: {
        expectedUniform: false,
        expectedHotspots: [{ x: junction + (lt - junction) / 2, y: 0, z: 0, thickness: tThick, mc: th, ratio: 1 }],
        expectedThicknessZones: [
          { x: junction + (lt - junction) / 2, y: 0, z: 0, thickness: tThick },
          { x: -lt / 2, y: 0, z: 0, thickness: tThin },
        ],
        tolerances: { positionMm: 8 },
        notes: '厚端单一热结；台阶突变处为边界（薄端无局部极大）',
      },
    };
  },

  // ---- 10 L 形（角部加厚：角部 60 高，臂 40 高 → 角部 d=30 臂 d=20） ----
  lShape: ({ corner = 60, armH = 40, len = 120 } = {}) => {
    const h = corner / 2, ah = armH / 2;   // 整块高 corner，臂保留 armH
    const dCorner = Math.min(corner, corner, corner) / 2;
    const dArm = Math.min(corner, armH) / 2;
    return {
      sdf: subtract(
        BOX([-len / 2, -len / 2, -h], [len / 2, len / 2, h]),
        BOX([0, 0, -h], [len / 2, len / 2, h]),                    // 右上象限
        BOX([0, -len / 2, -h], [len / 2, 0, -ah]),                 // 底臂右半 z∈[-h,-ah]
        BOX([0, -len / 2, ah], [len / 2, 0, h]),                   // 底臂右半 z∈[ah,h]
        BOX([-len / 2, 0, -h], [0, len / 2, -ah]),                 // 立臂上半
        BOX([-len / 2, 0, ah], [0, len / 2, h]),                   // 立臂上半
      ),
      bounds: [[-len / 2 - 2, -len / 2 - 2, -h - 2], [len / 2 + 2, len / 2 + 2, h + 2]],
      gt: {
        expectedUniform: false,
        expectedHotspots: [{ x: -len / 4, y: -len / 4, z: 0, thickness: 2 * dCorner, mc: dCorner, ratio: 1 }],
        expectedThicknessZones: [
          { x: -len / 4, y: -len / 4, z: 0, thickness: 2 * dCorner },
          { x: -len / 4, y: -corner / 2, z: 0, thickness: 2 * dArm },
        ],
        expectedThermalCenters: [{ x: -len / 4, y: -len / 4, z: 0 }],
        tolerances: { positionMm: 6 },
        notes: '角部热结（60 高）d=min(corner)/2=30；臂 40 高 d=armH/2=20（构造：挖掉臂区上下段）',
      },
    };
  },

  // ---- 11 T 形 ----
  tShape: ({ w = 40, t = 80, armH = 100, h = 40 } = {}) => {
    // 竖板 x∈[-w/2,w/2] 全高 armH；横板 x∈[-armW/2,armW/2] 上段（从 y=tBot 到 armH）
    const armW = 100;
    const yBase = armH - t;                       // 横板底部 y
    const d = Math.min(w / 2, armH / 2, h / 2);
    return {
      sdf: subtract(
        BOX([-armW / 2, 0, -h / 2], [armW / 2, armH, h / 2]),
        BOX([-armW / 2, yBase, -h / 2], [-w / 2, armH, h / 2]),
        BOX([w / 2, yBase, -h / 2], [armW / 2, armH, h / 2]),
      ),
      bounds: [[-armW / 2 - 2, -2, -h / 2 - 2], [armW / 2 + 2, armH + 2, h / 2 + 2]],
      gt: {
        expectedUniform: false,
        // V2.2 修正：热结 = 竖板厚区（半厚 20 > 交汇区 10）→ 平台中心 = 竖板 y 向中心
        // 旧公式 yBase+t/2=60 把 t=80 误当横板厚（实际横板 y∈[0,yBase] 由减法确定）
        expectedHotspots: [{ x: 0, y: armH / 2, z: 0, thickness: 2 * d, mc: d, ratio: 1 }],
        expectedThicknessZones: [{ x: 0, y: armH / 2, z: 0, thickness: 2 * d }],
        tolerances: { positionMm: 6 },
        notes: 'T 形竖板厚区热结 d=min(竖板半宽,竖板半高,半厚)；GT=竖板平台中心',
      },
    };
  },

  // ---- 12 法兰（圆盘 + 中央毂坐盘上 + 边缘厚环） ----
  // 毂中心 y=hubH/2+h/2（底面与盘顶面 z=h/2 对齐，无重叠）→ 毂 d 平台 z 向窄（定位准）
  flange: ({ r = 200, h = 10, hubR = 45, hubH = 40, rimR0 = 160, rimH = 25 } = {}) => {
    const hubCz = hubH / 2 + h / 2;              // 毂轴向中心 z
    const dHub = Math.min(hubR, hubH / 2), dRim = Math.min(rimH / 2, r - rimR0);
    return {
      sdf: union(
        CYL_Y(0, 0, r, h),
        CYL_Y(0, hubCz, hubR, hubH),
        subtract(CYL_Y(0, 0, r, rimH), CYL_Y(0, 0, rimR0, rimH)),
      ),
      bounds: [[-r - 2, -hubH / 2 - h / 2 - 2, -r - 2], [r + 2, hubH / 2 + h / 2 + 2, r + 2]],
      gt: {
        expectedUniform: false,
        expectedHotspots: [
          { x: 0, y: 0, z: hubCz, thickness: 2 * dHub, mc: dHub, ratio: 1 },
          { x: null, y: 0, z: 0, thickness: 2 * dRim, mc: dRim, ratio: dRim / dHub, radialRange: [rimR0, r] },
        ],
        expectedThicknessZones: [{ x: 0, y: 0, z: hubCz, thickness: 2 * dHub }, { x: rimR0, y: 0, z: 0, thickness: 2 * dRim }],
        expectedThermalCenters: [{ x: 0, y: 0, z: hubCz }],
        tolerances: { positionMm: 6 },
        notes: '中央毂主热结（坐盘上，d 平台窄） + 边缘环弱热结（x 向对称 → radialRange）',
      },
    };
  },

  // ---- 13 空心厚环 ----
  hollowThickRing: ({ ro = 60, ri = 40, h = 100, ringRo = 75, ringH = 60 } = {}) => {
    const tWall = ro - ri, tRing = ringRo - ri;
    return {
      sdf: union(
        subtract(CYL_Y(0, 0, ro, h), CYL_Y(0, 0, ri, h)),
        subtract(CYL_Y(0, 0, ringRo, ringH), CYL_Y(0, 0, ri, ringH)),
      ),
      bounds: [[-ringRo - 2, -h / 2 - 2, -ringRo - 2], [ringRo + 2, h / 2 + 2, ringRo + 2]],
      gt: {
        expectedUniform: false,
        expectedHotspots: [{ x: null, y: 0, z: null, thickness: 2 * tRing / 2, mc: tRing / 2, ratio: 1, radialRange: [ri, ringRo] }],
        expectedThicknessZones: [{ x: ri + tRing / 2, y: 0, z: 0, thickness: tRing }],
        tolerances: { positionMm: 6 },
        notes: '环壁内热结（x/z 对称 → radialRange；不落空腔是 Bug A 防线）',
      },
    };
  },

  // ---- 16 PVP：两柱 + 细颈连接带（peak A/B d=15，谷=V/2 → depth=1-V/30） ----
  pvpPair: ({ tA = 30, tB = 30, v = 15, width = 60 } = {}) => {
    // 柱 x∈[-95,-15] / [15,95]（宽 80，z 厚 tA/tB，d=tA/2）；连接带 x∈[-15,15] y/z 厚 v（d=v/2）
    const dA = tA / 2, dB = tB / 2, dV = v / 2;
    const depthA = (Math.min(dA, dB) - dV) / Math.min(dA, dB);
    const split = depthA >= 0.15;   // PVP 分裂期望（0.15 阈值，与引擎一致）
    return {
      sdf: union(
        BOX([-95, -width / 2, -dA], [-15, width / 2, dA]),
        BOX([15, -width / 2, -dB], [95, width / 2, dB]),
        BOX([-15, -v / 2, -v / 2], [15, v / 2, v / 2]),
      ),
      bounds: [[-97, -width / 2 - 2, -Math.max(dA, dB) - 2], [97, width / 2 + 2, Math.max(dA, dB) + 2]],
      gt: {
        expectedUniform: false,
        expectedHotspots: split
          ? [
            { x: -55, y: 0, z: 0, thickness: tA, mc: dA, ratio: dA / Math.max(dA, dB) },
            { x: 55, y: 0, z: 0, thickness: tB, mc: dB, ratio: dB / Math.max(dA, dB) },
          ]
          : [{ x: -55, y: 0, z: 0, thickness: tA, mc: dA, ratio: 1 }],   // MERGE → 主峰
        expectedThicknessZones: [
          { x: -55, y: 0, z: 0, thickness: tA }, { x: 55, y: 0, z: 0, thickness: tB }, { x: 0, y: 0, z: 0, thickness: v },
        ],
        tolerances: { positionMm: 5 },
        params: { peakA: dA, peakB: dB, valley: dV, valleyDepthRatioTheory: depthA, expectSplit: split },
        notes: `PVP 压力模型：谷深理论 (min(${dA},${dB})−${dV})/min = ${depthA.toFixed(3)}，0.15 阈值 → ${split ? 'SPLIT(2)' : 'MERGE(1)'}`,
      },
    };
  },

  // ---- 17 三凸台 ----
  threeBosses: ({ pl = [400, 300, 10], bs = [80, 80, 50], gap = 130 } = {}) => {
    const [plL, plW, plT] = pl, [bL, bW, bH] = bs, pz = plT / 2;
    const d = dBox([0, 0, pz], [bL, bW, pz + bH]);
    const pos = [[-gap, -gap / 2], [gap, -gap / 2], [0, gap]];
    return {
      sdf: union(BOX([-plL / 2, -plW / 2, -pz], [plL / 2, plW / 2, pz]),
        ...pos.map(([ox, oy]) => BOX([ox - bL / 2, oy - bW / 2, pz], [ox + bL / 2, oy + bW / 2, pz + bH]))),
      bounds: pad([-plL / 2, -plW / 2, -pz], [plL / 2, plW / 2, pz + bH]),
      gt: {
        expectedUniform: false,
        expectedHotspots: pos.map(([ox, oy]) => ({ x: ox, y: oy, z: pz + bH / 2, thickness: 2 * d, mc: d, ratio: 1 })),
        expectedThicknessZones: pos.map(([ox, oy]) => ({ x: ox, y: oy, z: pz + bH / 2, thickness: 2 * d })),
        tolerances: { positionMm: 5 },
        notes: `3 独立凸台 → 3 热结（间距 ${gap}mm > 6 体素，不触发均匀判据）`,
      },
    };
  },

  // ---- 18 筋 + 凸台 ----
  ribBoss: ({ pl = [300, 300, 10], ribW = 30, ribH = 50, bs = [80, 80, 50] } = {}) => {
    const [plL, plW, plT] = pl, [bL, bW, bH] = bs, pz = plT / 2;
    const dRib = Math.min(ribW / 2, ribH);
    const dB = dBox([0, 0, pz], [bL, bW, pz + bH]);
    return {
      sdf: union(
        BOX([-plL / 2, -plW / 2, -pz], [plL / 2, plW / 2, pz]),
        BOX([-ribW / 2, -plW / 2, pz], [ribW / 2, plW / 2, pz + ribH]),       // 十字筋（y 向）
        BOX([-plL / 2, -ribW / 2, pz], [plL / 2, ribW / 2, pz + ribH]),       // 十字筋（x 向）
        BOX([-bL / 2, -bW / 2, pz], [bL / 2, bW / 2, pz + bH]),               // 中心凸台（盖在筋上）
      ),
      bounds: pad([-plL / 2, -plW / 2, -pz], [plL / 2, plW / 2, pz + bH]),
      gt: {
        expectedUniform: false,
        expectedHotspots: [{ x: 0, y: 0, z: pz + bH / 2, thickness: 2 * dB, mc: dB, ratio: 1 }],
        expectedThicknessZones: [
          { x: 0, y: 0, z: pz + bH / 2, thickness: 2 * dB },
          { x: 0, y: -plW / 4, z: pz + ribH / 2, thickness: 2 * dRib },
        ],
        tolerances: { positionMm: 6 },
        notes: `中心凸台主热结 d=${dB.toFixed(1)}；筋 d=${dRib.toFixed(1)} 弱（prominence ${(dRib / dB).toFixed(2)}）——可能不报`,
      },
    };
  },

  // ---- 19 厚角（90° 弯板角部加厚） ----
  thickCorner: ({ armL = 300, armT = 20, h = 80, corner = 60 } = {}) => {
    const dCorner = Math.min(corner / 2, h / 2);
    return {
      sdf: union(
        BOX([-armL, -armT / 2, -h / 2], [0, armT / 2, h / 2]),        // x 向臂（宽 20）
        BOX([-armT / 2, -armL, -h / 2], [armT / 2, 0, h / 2]),        // y 向臂
        BOX([-corner / 2, -corner / 2, -h / 2], [corner / 2, corner / 2, h / 2]),  // 角块 60×60
      ),
      bounds: [[-armL - 2, -armL - 2, -h / 2 - 2], [corner / 2 + 2, corner / 2 + 2, h / 2 + 2]],
      gt: {
        expectedUniform: false,
        expectedHotspots: [{ x: 0, y: 0, z: 0, thickness: 2 * dCorner, mc: dCorner, ratio: 1 }],
        expectedThicknessZones: [{ x: 0, y: 0, z: 0, thickness: 2 * dCorner }, { x: -armL / 2, y: 0, z: 0, thickness: armT }],
        tolerances: { positionMm: 6 },
        notes: '弯板角部热结 d=min(corner,h)/2',
      },
    };
  },

  // ---- 20 厚端（长条端部加厚） ----
  thickEnd: ({ l = 400, body = 40, endL = 120, endS = 60 } = {}) => {
    const dEnd = Math.min(endS / 2, endL / 2), dB = body / 2;
    return {
      sdf: subtract(
        BOX([-l, -endS / 2, -endS / 2], [endL / 2, endS / 2, endS / 2]),   // 全段 60 宽
        BOX([-l, -endS / 2, -endS / 2], [-endL / 2, -body / 2, endS / 2]), // 主体段左下
        BOX([-l, body / 2, -endS / 2], [-endL / 2, endS / 2, endS / 2]),   // 主体段左上
        BOX([-l, -endS / 2, -endS / 2], [-endL / 2, endS / 2, -body / 2]), // 主体段前下
        BOX([-l, -endS / 2, body / 2], [-endL / 2, endS / 2, endS / 2]),   // 主体段前上
      ),
      bounds: [[-l - 2, -endS / 2 - 2, -endS / 2 - 2], [endL / 2 + 2, endS / 2 + 2, endS / 2 + 2]],
      gt: {
        expectedUniform: false,
        expectedHotspots: [{ x: 0, y: 0, z: 0, thickness: endS, mc: dEnd, ratio: 1 }],
        expectedThicknessZones: [
          { x: 0, y: 0, z: 0, thickness: endS },
          { x: -(l + endL / 2) / 2, y: 0, z: 0, thickness: body },
        ],
        expectedThermalCenters: [{ x: 0, y: 0, z: 0 }],
        tolerances: { positionMm: 6 },
        notes: '端部加厚块（x∈[-endL/2,endL/2] 中心 0）主热结；主体 d=body/2',
      },
    };
  },

  // ---- 21 渐变厚度（梯形棱柱：x 向厚度线性渐变 t0→t1） ----
  gradualTaper: ({ l = 300, w = 100, t0 = 20, t1 = 60 } = {}) => {
    // 截面：x 从 -l/2(t0) 线性变到 +l/2(t1)；y 向高 w；梯形顶点（逆时针）
    const h0 = t0 / 2, h1 = t1 / 2;
    const poly = [[-l / 2, -h0], [l / 2, -h1], [l / 2, h1], [-l / 2, h0]];
    return {
      sdf: PRISM(0, w, poly),
      bounds: [[-l / 2 - 2, -w / 2 - 2, -Math.max(h0, h1) - 2], [l / 2 + 2, w / 2 + 2, Math.max(h0, h1) + 2]],
      gt: {
        expectedUniform: false,
        expectedHotspots: [],   // 渐变无局部极大 → 预期无热点（物理上厚端是热节 → 产品定义问题待观察）
        expectedThicknessZones: [
          { x: -l / 2, y: 0, z: 0, thickness: t0 }, { x: l / 2, y: 0, z: 0, thickness: t1 },
        ],
        tolerances: { positionMm: 10 },
        notes: '渐变厚度：d 单调递增无局部极大。引擎预期无候选；物理上厚端慢冷为热节 → 语义边界待实验揭示',
      },
    };
  },

  // ---- 22 突变过渡（薄板 + 厚块直接对接） ----
  suddenTransition: ({ l = 300, w = 100, tThin = 20, tThick = 60 } = {}) => {
    const th = tThick / 2, tn = tThin / 2;
    return {
      sdf: subtract(
        BOX([-l / 2, -w / 2, -th], [l / 2, w / 2, th]),
        BOX([-l / 2, -w / 2, -th], [0, w / 2, -tn]),
        BOX([-l / 2, -w / 2, tn], [0, w / 2, th]),
      ),
      bounds: [[-l / 2 - 2, -w / 2 - 2, -th - 2], [l / 2 + 2, w / 2 + 2, th + 2]],
      gt: {
        expectedUniform: false,
        expectedHotspots: [{ x: l / 4, y: 0, z: 0, thickness: tThick, mc: th, ratio: 1 }],
        expectedThicknessZones: [{ x: l / 4, y: 0, z: 0, thickness: tThick }, { x: -l / 4, y: 0, z: 0, thickness: tThin }],
        tolerances: { positionMm: 8 },
        notes: '台阶突变：厚块单一热结',
      },
    };
  },
};

/** kind 别名（用户清单 14/15 = 板+凸台 特例；6/7 参数化） */
const ALIASES = {
  thickBlockThinWall: 'bossOnPlate',
  eccentricBoss: 'bossOnPlate',
  centralBoss: 'bossOnPlate',
  offsetBoss: 'bossOnPlate',
  twoAdjacentBosses: 'pvpPair',
  multipleBosses: null,   // 单独实现（N 个凸台）
};

/** 多凸台（数量参数化，两两间距自动排布） */
function multiBoss(pl, bs, n) {
  const [plL, plW, plT] = pl, [bL, bW, bH] = bs, pz = plT / 2;
  const d = dBox([0, 0, pz], [bL, bW, pz + bH]);
  // 网格排布：cols×rows ≥ n，间距 gap = max(bL, bW) + 40
  const gap = Math.max(bL, bW) + 40;
  const cols = Math.ceil(Math.sqrt(n));
  const pos = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    pos.push([(c - (cols - 1) / 2) * gap, (r - (cols - 1) / 2) * gap]);
  }
  return {
    sdf: union(BOX([-plL / 2, -plW / 2, -pz], [plL / 2, plW / 2, pz]),
      ...pos.map(([ox, oy]) => BOX([ox - bL / 2, oy - bW / 2, pz], [ox + bL / 2, oy + bW / 2, pz + bH]))),
    bounds: pad([-plL / 2, -plW / 2, -pz], [plL / 2, plW / 2, pz + bH]),
    gt: {
      expectedUniform: n === 0,
      expectedHotspots: pos.map(([ox, oy]) => ({ x: ox, y: oy, z: pz + bH / 2, thickness: 2 * d, mc: d, ratio: 1 })),
      expectedThicknessZones: pos.map(([ox, oy]) => ({ x: ox, y: oy, z: pz + bH / 2, thickness: 2 * d })),
      tolerances: { positionMm: 5 },
      notes: `${n} 独立凸台 → ${Math.min(n, 5)} 热结（maxHotspots=5 截断）`,
    },
  };
}

/**
 * 生成模型
 * @param {string} kind  KINDS 键名（含别名）
 * @param {object} [params]
 * @returns {{kind, params, mesh:{vertices,triCount}, gt, triCount}}
 */
export function generate(kind, params = {}) {
  const key = ALIASES[kind] || kind;
  let fn;
  if (key === 'multipleBosses') {
    fn = (p) => multiBoss(p.pl || [400, 300, 10], p.bs || [80, 80, 50], p.n ?? 4);
  } else if (kind === 'multipleBosses') {
    fn = (p) => multiBoss(p.pl || [400, 300, 10], p.bs || [80, 80, 50], p.n ?? 4);
  } else {
    fn = KINDS[key];
    if (!fn) throw new Error(`unknown kind: ${kind}`);
  }
  const { sdf, bounds, res, gt } = fn(params);
  const [min, max] = bounds;
  const mdim = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const effRes = res || 72;
  const mesh = makeMesh(sdf, bounds, effRes);
  return { kind, params, mesh, gt, mdim, bounds, res: effRes, triCount: mesh.triCount };
}

/* ================= 自检 ================= */
import { pathToFileURL } from 'node:url';
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const kinds = [...new Set([...Object.keys(KINDS), 'multipleBosses', 'thickBlockThinWall', 'eccentricBoss', 'centralBoss', 'offsetBoss', 'twoAdjacentBosses'])];
  for (const k of kinds) {
    const { mesh, triCount, gt } = generate(k);
    console.log(`${k.padEnd(20)} ${String(triCount).padStart(7)} tri  uniform=${gt.expectedUniform}  H${gt.expectedHotspots.length}`);
  }
  // PVP 边界验证
  for (const v of [5, 24, 26, 29]) {
    const { gt } = generate('pvpPair', { tA: 30, tB: 30, v });
    console.log(`pvp v=${v}: depth=${gt.params.valleyDepthRatioTheory.toFixed(3)} → ${gt.notes.split('→ ')[1]}`);
  }
}
