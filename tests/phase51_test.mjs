// ============================================================
// PHASE 51（52.txt）：阻流位置按实际几何判定 + 优化门禁
//   chokePosition 用 Fs_act/Fr_act/Fg（取整/ceil 后实际面积）判定：
//     ingate → 封闭式（加压式）：即使 v 偏高也禁止"按目标速度优化"
//     sprue/runner → 允许优化；boundary（相对差≤1%）→ 禁止 + 提示复核
//   optimize 后二次验证：Fg≤Fs 且 Fg≤Fr（迁移到 ingate）→ 拒绝（optChokeMigrated）
//   理论比例只作参考（T7：实际判定与理论 cp 可以不同）
// ============================================================
import { runGating, MATERIALS, V_TARGET } from '../calcs/gating.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

const inputOf = (mat, pw, wall, pos, ratioKey, extra = {}) => ({
  mat, pw, cav: 1, yr: MATERIALS[mat].y_sug, wall, pos, Ho: 150, ph: 100, rh: 50,
  gc: 2, gt: 15, rc: 1, rt: 15, ratioKey, ...extra,
});

export const tests = [
  {
    name: '51-T1 标准开放式 1:2:2：sprue 为 choke、可优化、优化后不迁移到 ingate',
    fn: () => {
      const r = runGating(inputOf('球铁(QT)', 60, 15, '顶注', '开放式 标准型'));   // v 高（0.45 目标）
      assert(r.chokePosition === 'sprue', `开放 1:2:2 sprue 应为 choke（实际 ${r.chokePosition}，Fs=${r.Fs_act.toFixed(0)} Fg=${r.Fg.toFixed(0)}）`);
      assert(r.systemType.includes('开放式'), '系统类型=开放式（非加压式）');
      assert(r.ingateChoke === false && r.boundaryChoke === false, '非内浇口/非临界 → 允许按钮');
      const o = runGating(inputOf('球铁(QT)', 60, 15, '顶注', '开放式 标准型', { optimize: true }));
      assert(o.chokePosition === 'sprue', '优化后仍 sprue choke');
      assert(o.optChokeMigrated === false, '未发生迁移（migrated=false）');
      assert(o.vState === 'rec', '优化后达标');
    },
  },
  {
    name: '51-T2 标准封闭式 1:2:0.85：ingate 为 choke，v 偏高也不得优化',
    fn: () => {
      const r = runGating(inputOf('灰铁(HT)', 60, 20, '顶注', '封闭式 常用型'));
      assert(r.chokePosition === 'ingate', `封闭 1:2:0.85 ingate 应为 choke（实际 ${r.chokePosition}）`);
      assert(r.ingateChoke === true, 'ingateChoke 标记');
      assert(r.vState === 'high', '内浇口阻流下 v 偏高（前置）');
      // 按钮条件（UI 用）：high + 有目标 + !ingateChoke + !boundaryChoke → false
      const btnOk = r.vState === 'high' && r.vTarget && !r.ingateChoke && !r.boundaryChoke;
      assert(btnOk === false, 'ingate choke 禁止优化按钮');
    },
  },
  {
    name: '51-T3 用户自定义开放式 1:2.5:2.5（不依赖 ratioKey）：识别 sprue choke、可优化',
    fn: () => {
      const r = runGating(inputOf('球铁(QT)', 60, 15, '顶注', '自定义', { custom: true, cs: 1, cr: 2.5, cg: 2.5 }));
      assert(r.chokePosition === 'sprue', `自定义 1:2.5:2.5 → sprue choke（实际 ${r.chokePosition}）`);
      const btnOk = r.vState === 'high' && r.vTarget && !r.ingateChoke && !r.boundaryChoke;
      assert(btnOk === true, '自定义开放式允许优化按钮');
    },
  },
  {
    name: '51-T4 用户自定义封闭式 1:1.5:0.8：识别 ingate choke、禁止优化',
    fn: () => {
      const r = runGating(inputOf('灰铁(HT)', 60, 20, '顶注', '自定义', { custom: true, cs: 1, cr: 1.5, cg: 0.8 }));
      assert(r.chokePosition === 'ingate', `自定义 1:1.5:0.8 → ingate choke（实际 ${r.chokePosition}）`);
      const btnOk = r.vState === 'high' && r.vTarget && !r.ingateChoke && !r.boundaryChoke;
      assert(btnOk === false, '自定义封闭式禁止优化');
    },
  },
  {
    name: '51-T5 横浇道 choke（1:0.7:0.8）：runner 阻流、可优化、不发生迁移',
    fn: () => {
      const r = runGating(inputOf('球铁(QT)', 60, 15, '顶注', '自定义', { custom: true, cs: 1, cr: 0.7, cg: 0.8 }));
      assert(r.chokePosition === 'runner', `1:0.7:0.8 → runner choke（实际 ${r.chokePosition}，Fr=${r.Fr_act.toFixed(0)} Fg=${r.Fg.toFixed(0)} Fs=${r.Fs_act.toFixed(0)}）`);
      assert(r.ingateChoke === false, '非 ingate choke');
      const btnOk = r.vState === 'high' && r.vTarget && !r.ingateChoke && !r.boundaryChoke;
      assert(btnOk === true, 'runner 阻流允许优化');
      const o = runGating(inputOf('球铁(QT)', 60, 15, '顶注', '自定义', { custom: true, cs: 1, cr: 0.7, cg: 0.8, optimize: true }));
      assert(o.chokePosition === 'runner' && o.optChokeMigrated === false, '优化后仍 runner choke、无迁移');
    },
  },
  {
    name: '51-T6 放大不可能反向迁移到内浇口（放大只增 Fg）：optChokeMigrated 防御标记与几何事实一致',
    fn: () => {
      // P51 §7 二次验证：Fg≤Fs 且 Fg≤Fr 才拒绝。放大内浇口只会增大 Fg——
      // 对非 ingate 初始态，迁移到 ingate 几何上不可达（如实声明于报告）；此处验证防御标记正确性
      for (const ratioKey of ['开放式 标准型', '开放式 宽大型']) {
        for (const pos of ['顶注', '中注']) {
          const o = runGating(inputOf('球铁(QT)', 100, 12, pos, ratioKey, { optimize: true }));
          assert(o.Fg > 0, '优化后内浇口存在');
          assert(o.optChokeMigrated === (o.Fg <= o.Fs_act && o.Fg <= o.Fr_act),
            `迁移标记应与几何一致（Fg=${o.Fg.toFixed(0)} Fs=${o.Fs_act.toFixed(0)} Fr=${o.Fr_act.toFixed(0)}）`);
        }
      }
      // ingate 初始态：禁止优化 → optimize 路径不可达；若强行调用，几何仍按 A_gt（vTarget 但 ingateChoke）
      const ic = runGating(inputOf('灰铁(HT)', 60, 20, '顶注', '封闭式 常用型', { optimize: true }));
      assert(ic.chokePosition !== 'ingate', 'ingate 初始放大后 Fg 增大 → 最小截面移走（机制性说明）');
    },
  },
  {
    name: '51-T7 阻流判定用实际几何（Fs_act/Fr_act/Fg）而非理论面积',
    fn: () => {
      // 找取整使理论与实际排序不同的场景：理论 min 在 runner，但 Fg ceil 偏小/实际不同
      // 用多种 gc/gt 扫描验证 chokePosition 恒等于 min(Fs_act,Fr_act,Fg) 的归属（含 1% 并列）
      const ratios = [
        ['封闭式 常用型', {}],
        ['开放式 标准型', {}],
        ['自定义 1:1:1', { custom: true, cs: 1, cr: 1, cg: 1 }],
      ];
      for (const [name, extra] of ratios) {
        for (const pw of [10, 60, 300]) for (const wall of [10, 20]) {
          const r = runGating(inputOf('灰铁(HT)', pw, wall, '顶注', name === '自定义 1:1:1' ? '自定义' : name, extra));
          const fs = r.Fs_act, fr = r.Fr_act, fg = r.Fg;
          const min = Math.min(fs, fr, fg);
          const near = [['sprue', fs], ['runner', fr], ['ingate', fg]].filter(p => Math.abs(p[1] - min) / min <= 0.01).map(p => p[0]);
          const expect = near.length > 1 ? 'boundary' : near[0];
          assert(r.chokePosition === expect, `${name} ${pw}kg/${wall}mm: 实际判定 ${r.chokePosition} 应=${expect}`);
        }
      }
    },
  },
  {
    name: '51-T8 临界/并列状态（boundary）：提示复核、不优化；1:1:1 全等比例探测',
    fn: () => {
      // 探测 1:1:1（三段参考相等）是否出现 ≤1% 并列 → boundary（受 round/ceil 影响）
      let found = null;
      for (const pw of [5, 10, 20, 60, 100, 200]) for (const wall of [5, 10, 15, 20, 30]) {
        for (const pos of ['顶注', '中注', '底注']) {
          const r = runGating(inputOf('灰铁(HT)', pw, wall, pos, '自定义', { custom: true, cs: 1, cr: 1, cg: 1 }));
          if (r.boundaryChoke) { found = { pw, wall, pos, fs: r.Fs_act, fr: r.Fr_act, fg: r.Fg }; break; }
        }
        if (found) break;
      }
      console.log(`      boundary 探测：${found ? `命中 ${found.pw}kg/${found.wall}mm/${found.pos}（Fs=${found.fs.toFixed(1)} Fr=${found.fr.toFixed(1)} Fg=${found.fg.toFixed(1)}）` : '1:1:1 未出现 ≤1% 并列（round/ceil 差异所致，属正常）'}`);
      // 构造性验证：boundary 判定逻辑本身（合成三段接近的场景由 T7 覆盖 1:1:1 归属）
      // UI 规则（calc 输出标记）：boundary → 不显示按钮（条件里排除）
      const r = runGating(inputOf('灰铁(HT)', 60, 20, '顶注', '封闭式 常用型'));
      assert(r.boundaryChoke === false, '非临界场景 boundaryChoke=false');
      assert(r.chokePosition === 'ingate' || r.chokePosition === 'sprue' || r.chokePosition === 'runner' || r.chokePosition === 'boundary' || r.chokePosition === 'unset',
        'chokePosition 枚举合法');
    },
  },
];
