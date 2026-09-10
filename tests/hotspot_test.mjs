// ============================================================
// HotSpot Engine 黄金回归
// 期望（理论解析值）：
//   cube50 Mc=25 · plate20 Mc=10 · cylinder100 Mc=25 · tube_wall10 Mc=5
// 关键断言（CastEyes Bug 防线）：
//   A. tube_wall10 热结代表点必须在实体内部（不在中空轴线上）
//   B. 热结数量 ≥ 1（黄金模型不出现"不显示"）
//   C. 空结果必须有可解释原因（status/reason 枚举）
// ============================================================
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSTL } from '../js/engine/stl.js';
import { buildMesh, isInside } from '../js/engine/mesh3d.js';
import { analyzeHotspots } from '../js/engine/hotspot.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const load = (name) => parseSTL(readFileSync(join(__dirname, 'golden', `${name}.stl`)));

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

export const tests = [
  {
    name: 'cube50（均匀实心）：NO_HOTSPOT（V2.1 相对厚区语义）',
    fn: () => {
      const mesh = load('cube50');
      const { geometry } = buildMesh(mesh);
      const r = analyzeHotspots(mesh, geometry);
      assert(r.status === 'NO_HOTSPOT', `均匀实心应 NO_HOTSPOT，实际 ${r.status}（${r.reason || ''}）`);
      assert(r.hotspots.length === 0, '均匀件不得报热结');
    },
  },
  {
    name: 'plate20（均匀板）：NO_HOTSPOT',
    fn: () => {
      const mesh = load('plate20');
      const { geometry } = buildMesh(mesh);
      const r = analyzeHotspots(mesh, geometry);
      assert(r.status === 'NO_HOTSPOT', `均匀板应 NO_HOTSPOT，实际 ${r.status}`);
      assert(r.hotspots.length === 0, '均匀板不得报热结');
    },
  },
  {
    name: 'cylinder100（均匀圆柱）：NO_HOTSPOT',
    fn: () => {
      const mesh = load('cylinder100');
      const { geometry } = buildMesh(mesh);
      const r = analyzeHotspots(mesh, geometry);
      assert(r.status === 'NO_HOTSPOT', `均匀圆柱应 NO_HOTSPOT，实际 ${r.status}`);
      assert(r.hotspots.length === 0, '均匀圆柱不得报热结');
    },
  },
  {
    name: 'tube_wall10：弱热结 mc≈5 且在壁内（Bug A 防线；端部 MC 圆角伪厚）',
    fn: () => {
      const mesh = load('tube_wall10');
      const { geometry } = buildMesh(mesh);
      const r = analyzeHotspots(mesh, geometry);
      assert(r.status === 'ok', `状态应为 ok，实际 ${r.status}（${r.reason || ''}）`);
      assert(r.hotspots.length >= 1, '必须检测到热结（不能"不显示"）');
      const hs = r.hotspots[0];
      assert(Math.abs(hs.mc - 5) < 1.5, `Mc 应≈5，实际 ${hs.mc.toFixed(2)}`);
      assert(hs.confidence < 0.85, `端部伪厚应为弱热结，实际 conf=${hs.confidence}`);
      // Bug A：代表点必须在实体内部（r = sqrt(x²+z²) ≈ 45 壁中心，而非轴线 0）
      const rDist = Math.sqrt(hs.x * hs.x + hs.z * hs.z);
      assert(rDist > 42 && rDist < 48, `代表点应在壁内（r≈45），实际 r=${rDist.toFixed(1)}（CastEyes 旧算法落轴线=0）`);
      assert(isInside(geometry, [hs.x, hs.y, hs.z]), '代表点必须通过 inside-solid 终检');
    },
  },
  {
    name: '空结果必须有可解释原因（status/reason 枚举）',
    fn: () => {
      const mesh = load('cube50');
      const { geometry } = buildMesh(mesh);
      // 人为设置极高候选门槛 → 无候选 → 必须返回枚举状态 + 原因
      const r = analyzeHotspots(mesh, geometry, { CANDIDATE_FLOOR: 10 });
      assert(['NO_HOTSPOT', 'LOW_CONFIDENCE', 'INSUFFICIENT_RESOLUTION'].includes(r.status),
        `状态必须枚举之一，实际 ${r.status}`);
      assert(['no_candidate', 'uniform', 'all_low_confidence', 'invalid_mesh', 'no_inside_points', 'refine_limit'].includes(r.reason),
        `原因必须是枚举之一，实际 ${r.reason}`);
      assert(r.hotspots.length === 0, '空结果不得返回假热点');
    },
  },
];
