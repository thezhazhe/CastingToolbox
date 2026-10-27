// ============================================================
// PHASE V2.0-13（123.txt §四）· C′ 取整校核修复的守卫
//
//   修复内容（calcs/riser.js）：候选尺寸取整后，**用取整后的实际尺寸复核模数**；
//   不足则升一个最小尺寸档（+1mm），并重算受尺寸影响的几何量（H 随 D 重算）。
//   背景与根因见 docs/PHASE_V2.0-12_C1_NON_MONOTONIC_INVESTIGATION.md
//
//   断言纪律（123.txt §六）：
//     · 只走**真实生产调用路径**（runRiser / getCalcManifest），不测私有辅助函数；
//     · **最终尺寸必须与它自己的校核结果一致**（D 组逐条重算 sd.M / sd.V 对照）；
//     · 修复前的数值基线取自 PHASE V2.0-12 的实测 CSV（`phasev2012_c1_sweep.csv`），
//       该文件由**修复前**代码生成 ⇒ 它就是"修复前基线"，不是事后编的数；
//     · 缺失该 CSV 时**跳过**对照（不失败）—— 与本仓对大夹具的既有约定一致。
// ============================================================
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { runRiser, RISER_SHAPES, RISER_EFF, RISER_MATERIALS, meetsTarget } from '../calcs/riser.js';

const assert = (c, m) => { if (!c) throw new Error(m); };
const same = (a, b, m) => assert(Object.is(a, b), `${m}（实际 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}）`);
const near = (a, b, tol, m) => assert(Math.abs(a - b) <= tol, `${m}（实际 ${a}，期望 ${b}±${tol}）`);

const CSV = 'tests/engineering-generated/phasev2012_c1_sweep.csv';

/* ---------- 真实生产入口 ---------- */
const R = (mc, o = {}) => runRiser({
  mat: o.mat || '球铁', cast_wt: o.cw || 0, mc_mode: 'direct', mc,
  shape: o.shape || 'cyl', hd_ratio: 1.0,
});
/** 独立重算：给定 (mat, shape, cw, D, H) 时的模数与体积校核（不复用 runRiser 的输出） */
function recheck(mc, D, H, o = {}) {
  const md = RISER_MATERIALS[o.mat || '球铁'] || RISER_MATERIALS.球铁;
  const sd = RISER_SHAPES[o.shape || 'cyl'];
  const eff = RISER_EFF[sd.effKey] / 100;
  const rhoUsed = md.rho;
  const Vr = sd.V(D, H), effV = Vr * eff;
  const Vc = (o.cw || 0) > 0 ? (o.cw) * 1000000 / rhoUsed : 0;
  const needVol = Vc * md.shrink;
  return { Mr_act: sd.M(D, H), Vr, effV, modOk: sd.M(D, H) >= (mc) * 0.99, volOk: (o.cw || 0) > 0 ? effV >= needVol : true };
}

/* ---------- 修复前基线（PHASE V2.0-12 实测，见报告 §2） ---------- */
const PRE = {
  3.37: { D: 47, H: 47, f: 2.30, Mr_act: 7.833333333333333, Mr_need: 7.751 },
  3.38: { D: 37, H: 37, f: 1.8, Mr_act: 6.166666666666667, Mr_need: 6.084 },
};
/** 修复前实测的非单调区间（V2.0-12 §5.1，步长 0.01） */
const PRE_JUMPS = [
  [3.10, 3.11], [3.25, 3.26], [3.36, 3.37], [3.37, 3.38], [3.38, 3.39], [3.39, 3.40], [3.40, 3.41],
  [3.53, 3.54], [3.54, 3.55], [3.55, 3.56], [3.56, 3.57], [3.68, 3.69], [3.69, 3.70], [3.71, 3.72],
  [3.84, 3.85], [3.86, 3.87], [3.98, 3.99],
];
/** V2.0-08 的硬编码数值基线（球铁/cyl/hd=1/77.56kg）
 *  ⚠ PHASE V2.0-22（138.txt §3.4）：**已重新基线化** —— 尺寸改由目标模数 `Mr = Mc × 1.2`
 *  决定，旧体积约束不再参与（旧值 D=106/144/144/147/144/198 与 f=3.55…1.10 是迭代产物）。
 *  `neck` 只由 Mc 决定 ⇒ 与本阶段之前逐位相同；`volOk` 是**诊断值**（整件净重口径）。 */
const FROZEN = [
  { mc: 5, D: 36, H: 36, f: 1.2, Mr: 6, Vr: 36643.536711471344, neck: 20, volOk: false, modOk: true },
  { mc: 8, D: 58, H: 58, f: 1.2, Mr: 9.666666666666666, Vr: 153240.60645680293, neck: 32, volOk: false, modOk: true },
  { mc: 11.43, D: 83, H: 83, f: 1.2, Mr: 13.833333333333334, Vr: 449080.4596545368, neck: 46, volOk: false, modOk: true },
  { mc: 14, D: 101, H: 101, f: 1.2, Mr: 16.833333333333332, Vr: 809196.5131465544, neck: 56, volOk: false, modOk: true },
  { mc: 20, D: 144, H: 144, f: 1.2, Mr: 24, Vr: 2345186.349534166, neck: 80, volOk: true, modOk: true },
  { mc: 30, D: 216, H: 216, f: 1.2, Mr: 36, Vr: 7915003.9296778105, neck: 120, volOk: true, modOk: true },
];

function sweep(lo, hi, step, o = {}) {
  const out = [];
  const n = Math.round((hi - lo) / step);
  for (let i = 0; i <= n; i++) out.push({ mc: +(lo + i * step).toFixed(6), r: R(+(lo + i * step).toFixed(6), o) });
  return out;
}
/** 非单调点 = 后一个 Mc 的 D **小于** 前一个（Mc 单调递增） */
function nonMono(rows) {
  const bad = [];
  for (let i = 1; i < rows.length; i++) {
    const p = rows[i - 1].r, c = rows[i].r;
    if (!p || !c) continue;
    if (c.D < p.D) bad.push({ from: rows[i - 1].mc, to: rows[i].mc, dD: c.D - p.D });
  }
  return bad;
}

export const tests = [

  /* ================= A. 原始异常 ================= */
  {
    name: 'V2.0-13-A1 ★ Mc=3.37 / 3.38：非单调跳变已消除，且尺寸仍满足模数校核',
    fn: () => {
      const a = R(3.37), b = R(3.38);
      // 修复前：3.37→47，3.38→37（Mc 增大而 D 下降 10mm / −21.3%）
      // ⚠ PHASE V2.0-22：尺寸改由目标模数反求 ⇒ 两点的 D 都变成 25（旧值 23/23 是 f=1.10 时代的产物）
      same(a.D, 25, 'Mc=3.37 的 D'); same(a.H, 25, 'Mc=3.37 的 H');
      same(b.D, 25, 'Mc=3.38 的 D'); same(b.H, 25, 'Mc=3.38 的 H');
      assert(b.D >= a.D, `异常跳变仍在：Mc 3.37→3.38 时 D ${a.D}→${b.D}`);
      // 记录完整中间量（§四 A 要求）
      same(a.final_f, 1.2, 'Mc=3.37 的目标模数比');
      same(b.final_f, 1.2, 'Mc=3.38 的目标模数比');
      near(a.Mr_act, 25 / 6, 1e-12, 'Mc=3.37 的 Mr_act'); near(a.Mr_target, 3.37 * 1.2, 1e-12, 'Mc=3.37 的 Mr_target');
      near(b.Mr_act, 25 / 6, 1e-12, 'Mc=3.38 的 Mr_act'); near(b.Mr_target, 3.38 * 1.2, 1e-12, 'Mc=3.38 的 Mr_target');
      same(a.Mr_need, a.Mr_target, 'Mr_need 必须是 Mr_target 的兼容别名');
      same(a.modOk, true, 'Mc=3.37 的 modOk'); same(b.modOk, true, 'Mc=3.38 的 modOk');
      same(a.volOk, true, 'Mc=3.37 的 volOk'); same(b.volOk, true, 'Mc=3.38 的 volOk');
      // 修复前的基线本身必须"确实是异常的"——否则本用例证明不了任何东西
      assert(PRE[3.37].D > PRE[3.38].D, '修复前基线本身不是非单调的，本用例失效');
    },
  },
  {
    name: 'V2.0-13-A2 ★ 异常邻域整体单调：Mc 3.36~3.40 步长 0.01 逐点非递减',
    fn: () => {
      const rows = sweep(3.36, 3.40, 0.01);
      const bad = nonMono(rows);
      assert(bad.length === 0, `仍有非单调点：${JSON.stringify(bad)}`);
      // 修复前该邻域 D 依次 22→47→37→31→26→23（V2.0-12 §5.1）
      assert(rows[0].r.D <= rows[rows.length - 1].r.D, '邻域内 D 净下降');
    },
  },
  {
    name: 'V2.0-13-A3 ★ Mc 3.00~4.00 全域：D 恒为满足**目标模数**的最小整数（PHASE V2.0-22 重写）',
    fn: () => {
      // ⚠ 旧用例守的是"未升档的点与修复前基线逐位一致"。那条前提随 f 迭代与旧体积约束一并消失
      //   （138.txt §3.4）。改为守一个**更强且不依赖基线**的性质：全域每一点的 D 都是
      //   "满足 M(D,H) ≥ Mr_target 的最小整数档"——上探与下探两侧都被钉住。
      let n = 0, bad = [];
      for (let i = 0; i <= 100; i++) {
        const mc = +(3.00 + i * 0.01).toFixed(2);
        const r = R(mc);
        const sd = RISER_SHAPES.cyl;
        const Mr = mc * 1.2;
        let dmin = Math.round(sd.DfromM(Mr, 1.0));
        while (sd.M(dmin, dmin) < Mr) dmin++;
        while (dmin > 1 && sd.M(dmin - 1, dmin - 1) >= Mr) dmin--;
        n++;
        if (r.D !== dmin) bad.push({ mc, D: r.D, expect: dmin });
      }
      assert(n === 101, `采样点数（${n}）`);
      assert(bad.length === 0, `D 不是满足目标模数的最小整数：${JSON.stringify(bad)}`);
    },
  },

  /* ================= B. 密集扫描 ================= */
  {
    name: 'V2.0-13-B1 ★ Mc 3.00~4.00 步长 0.01：非单调点 = 0（修复前 16 处）',
    fn: () => {
      const rows = sweep(3.00, 4.00, 0.01);
      same(rows.length, 101, '采样点数');
      const bad = nonMono(rows);
      assert(bad.length === 0, `仍有 ${bad.length} 处非单调：${JSON.stringify(bad.slice(0, 5))}`);
      // 全部收敛解都存在（不产生新的无解）
      const nul = rows.filter(x => !x.r || x.r.D == null);
      same(nul.length, 0, '出现无解点');
      // 绝不出现"新的无解"与"bind=limit"（cw=0 时体积约束不参与）
      same(rows.filter(x => x.r.bind === 'limit').length, 0, '模数主导区不应出现 limit');
    },
  },
  {
    name: 'V2.0-13-B2 ★ 修复前全部突变边界局部细化（步长 0.001）：非单调点 = 0',
    fn: () => {
      const all = [];
      for (const [lo, hi] of PRE_JUMPS) {
        const rows = sweep(lo - 0.001, hi + 0.001, 0.001, {});
        const bad = nonMono(rows);
        if (bad.length) all.push({ lo, hi, bad: bad.slice(0, 3) });
      }
      assert(all.length === 0, `以下修复前突变区仍有非单调：${JSON.stringify(all.slice(0, 4))}`);
    },
  },
  {
    name: 'V2.0-13-B3 ★ 原异常下坡段 Mc 3.377~3.400 步长 0.001：非单调点 = 0（修复前净降 14mm）',
    fn: () => {
      const rows = sweep(3.377, 3.400, 0.001);
      const bad = nonMono(rows);
      assert(bad.length === 0, `下坡段仍有非单调：${JSON.stringify(bad.slice(0, 5))}`);
      const d0 = rows[0].r.D, d1 = rows[rows.length - 1].r.D;
      assert(d1 >= d0, `该段 D 仍净下降（${d0}→${d1}）`);
      // 修复前该段 D 从 40 一路降到 26
      assert(d1 - d0 <= 2, `该段 D 跨度异常偏大（${d0}→${d1}），与 C′ 的"仅缩不涨"预期不符`);
    },
  },

  /* ================= C. 回归检查 ================= */
  {
    name: 'V2.0-13-C1 模数主导全域（Mc 1~12 步长 0.01，cw=0）：单调非递减 + 无无解',
    fn: () => {
      const rows = sweep(1.00, 12.00, 0.01);
      const bad = nonMono(rows);
      assert(bad.length === 0, `模数主导全域仍有 ${bad.length} 处非单调：${JSON.stringify(bad.slice(0, 5))}`);
      same(rows.filter(x => !x.r || x.r.D == null).length, 0, '出现无解点');
    },
  },
  {
    name: 'V2.0-13-C2 ★★ 原"体积主导区"（cw=77.56）：尺寸不再随铸件重量变（PHASE V2.0-22 重写）',
    fn: () => {
      // ⚠ 旧用例把 cw=77.56 的输出与 `phasev2012_c1_sweep.csv` **逐位比对**。该 CSV 由
      //   "体积约束决定尺寸"时代的代码生成；138.txt §3.4 已裁决体积约束不再改变推荐尺寸
      //   ⇒ 与旧基线的逐位一致**不可能也不应该**再成立。**CSV 文件本身保留**（历史资产，不删不改）。
      //   改为守住新契约：同一 Mc 下 D/H 与 cw 无关，且尺寸仍满足目标模数、仍是最小整数档。
      const sd = RISER_SHAPES.cyl;
      let n = 0;
      const bad = [];
      for (let i = 0; i <= 300; i++) {
        const mc = +(1 + i * 0.05).toFixed(2);
        const heavy = R(mc, { cw: 77.56 }), light = R(mc, { cw: 0 });
        if (!heavy || !light) { bad.push({ mc, why: 'null' }); continue; }
        n++;
        if (heavy.D !== light.D || heavy.H !== light.H) bad.push({ mc, why: '尺寸随重量变了', heavy: heavy.D, light: light.D });
        const Mr = mc * 1.2;
        if (!meetsTarget(heavy.Mr_act, Mr)) bad.push({ mc, why: 'Mr_act < Mr_target' });
        let dmin = Math.round(sd.DfromM(Mr, 1.0));
        while (sd.M(dmin, dmin) < Mr) dmin++;
        while (dmin > 1 && sd.M(dmin - 1, dmin - 1) >= Mr) dmin--;
        if (heavy.D !== dmin) bad.push({ mc, why: 'not minimal', D: heavy.D, expect: dmin });
      }
      assert(n > 290, `样本过少（${n}）`);
      assert(bad.length === 0, `新契约不成立：${JSON.stringify(bad.slice(0, 6))}`);
      // 旧基线 CSV 必须仍然在（不得被删除或改写）
      if (existsSync(CSV)) {
        const lines = readFileSync(CSV, 'utf8').trim().split('\n');
        assert(lines.length > 1000, `旧基线 CSV 被改动（行数 ${lines.length}）`);
      } else {
        console.log('     （缺 phasev2012_c1_sweep.csv —— 历史基线文件，本用例不依赖它）');
      }
    },
  },
  {
    name: 'V2.0-13-C3 四种冒口形状：全部单调 + 各自满足自身校核',
    fn: () => {
      for (const shape of ['cyl', 'sphere_head', 'sphere', 'square']) {
        const rows = sweep(1.00, 12.00, 0.01, { shape });
        const bad = nonMono(rows);
        assert(bad.length === 0, `形状 ${shape} 仍有 ${bad.length} 处非单调：${JSON.stringify(bad.slice(0, 3))}`);
        for (const { mc, r } of rows) {
          assert(r && r.D > 0, `形状 ${shape} Mc=${mc} 无解`);
          const sd = RISER_SHAPES[shape];
          near(r.Mr_act, sd.M(r.D, r.H), 1e-12, `${shape} Mc=${mc}：Mr_act 与最终尺寸不一致`);
          assert(meetsTarget(r.Mr_act, r.Mr_need), `${shape} Mc=${mc}：最终尺寸未通过模数校核`);
        }
      }
    },
  },
  {
    name: 'V2.0-13-C4 五种材料：D/H 与材料无关（既有事实）；颈径随 neck_k 变',
    fn: () => {
      const mats = Object.keys(RISER_MATERIALS);
      assert(mats.length === 5, `材料数变了：${mats.length}`);
      const ref = R(3.37, { mat: '球铁' });
      for (const m of mats) {
        const r = R(3.37, { mat: m });
        same(r.D, ref.D, `${m} 的 D 应与材料无关`);
        same(r.H, ref.H, `${m} 的 H 应与材料无关`);
        same(r.d_neck, Math.round(3.37 * 4 * RISER_MATERIALS[m].neck_k), `${m} 的颈径`);
      }
    },
  },
  {
    name: 'V2.0-13-C5 原三类场景（体积主导 / 起点即通过 / limit）在新规则下统一为模数主导',
    fn: () => {
      // ⚠ 旧的 volume / start / limit 三分法是 f 迭代的产物。138.txt §3.4 移除迭代后，
      //   同一 Mc 不论铸件多重，尺寸都只由目标模数决定 ⇒ 三类场景合并为一类。
      for (const [mc, cw, expectD] of [[14, 77.56, 101], [30, 77.56, 216], [5, 77.56, 36]]) {
        const r = R(mc, { cw });
        same(r.D, expectD, `Mc=${mc} 的 D`);
        same(r.bind, 'modulus', `Mc=${mc} 的 bind`);
        same(r.final_f, 1.2, `Mc=${mc} 的 final_f`);
        same(r.converged, true, `Mc=${mc} 的 converged`);
        same(r.D, R(mc, { cw: 0 }).D, `Mc=${mc}：尺寸随铸件重量变了`);
        assert(r.dModOnly <= r.D, `Mc=${mc}：dModOnly 不应大于 D`);
      }
      // 旧体积诊断仍在算，但它不再是判据
      same(R(5, { cw: 77.56 }).volOk, false, '旧体积诊断（Mc=5 时不够）');
      same(R(20, { cw: 77.56 }).volOk, true, '旧体积诊断（Mc=20 时够）—— 两种取值都不影响尺寸');
    },
  },
  {
    name: 'V2.0-13-C6 ★ bind 归因：新规则下恒为 modulus（volume/limit/start/both 全不可达）',
    fn: () => {
      // ⚠ 旧用例守的是"start/volume/limit 三者都应可达、modulus/both 不可达"——那是 f 迭代的语义。
      //   迭代移除后（138.txt §3.4），尺寸**只**由目标模数反求 ⇒ 归因恒为 `'modulus'`，
      //   旧取值不得再出现（否则就是在暗示"尺寸仍被体积约束决定"，138.txt §四.1 明令禁止）。
      const seen = new Set();
      let n = 0;
      for (let i = 0; i <= 1100; i++) {
        const mc = +(1 + i * 0.01).toFixed(2);
        for (const cw of [0, 0.5, 20, 77.56]) for (const shape of ['cyl', 'sphere_head']) {
          const r = R(mc, { cw, shape });
          if (r) { seen.add(r.bind); n++; }
        }
      }
      assert(n > 8000, `样本过少（${n}）`);
      same([...seen].join(','), 'modulus', `bind 取值应恒为 modulus，实际出现：${[...seen].join(',')}`);
      same(R(30, { cw: 77.56 }).final_f, 1.2, 'final_f 恒为设计规则常量（不再有"停在起点/撞上限"之分）');
    },
  },

  /* ================= D. 工程约束一致性 ================= */
  {
    name: 'V2.0-13-D1 ★★ 全部受测案例：最终尺寸与其校核数据逐项一致（不靠字段自述）',
    fn: () => {
      let n = 0;
      for (const cw of [0, 0.5, 20, 77.56]) for (const shape of ['cyl', 'sphere_head', 'sphere', 'square']) {
        const rows = sweep(1.00, 12.00, 0.05, { cw, shape });
        for (const { mc, r } of rows) {
          if (!r) continue;
          n++;
          const chk = recheck(mc, r.D, r.H, { cw, shape });
          near(r.Mr_act, chk.Mr_act, 1e-12, `cw=${cw} ${shape} Mc=${mc}：Mr_act ≠ M(D,H)`);
          near(r.Vr, chk.Vr, 1e-9, `cw=${cw} ${shape} Mc=${mc}：Vr ≠ V(D,H)`);
          same(r.volOk, chk.volOk, `cw=${cw} ${shape} Mc=${mc}：volOk 与基线规则不一致`);
          // 收敛解必须满足模数校核；limit 不是收敛解，单独豁免（其行为本阶段不变）
          if (r.bind !== 'limit') {
            assert(meetsTarget(r.Mr_act, r.Mr_need),
              `cw=${cw} ${shape} Mc=${mc}：最终尺寸 D=${r.D} 未通过模数校核（Mr_act=${r.Mr_act} < ${r.Mr_need * 0.99}）`);
            same(r.modOk, true, `cw=${cw} ${shape} Mc=${mc}：modOk 字段与几何不符`);
          }
          near(r.d_neck, Math.round(4 * mc * RISER_MATERIALS['球铁'].neck_k), 1e-12,
            `cw=${cw} ${shape} Mc=${mc}：d_neck 不应受本次修改影响`);
        }
      }
      assert(n > 3000, `受测案例过少（${n}）`);
    },
  },
  {
    name: 'V2.0-13-D2 ★ 重量不改变尺寸；旧体积诊断与设计结论彻底分离（PHASE V2.0-22 重写）',
    fn: () => {
      // ⚠ 旧用例断言"撞上限时 volOk 必然 false、收敛解必然 volOk true"。新规则下：
      //   ① 没有"撞上限"这回事（不再迭代）；② volOk 与"尺寸是否合格"**完全脱钩**
      //   —— 这正是 138.txt §3.5 要求的分离。故改为守住这个分离本身。
      const rows = sweep(1.00, 12.00, 0.05, { cw: 77.56 });
      assert(rows.every(x => x.r && x.r.converged === true), '存在未收敛样本（新算法应恒收敛）');
      assert(rows.every(x => x.r.bind === 'modulus'), 'bind 不是 modulus');
      for (const { mc, r } of rows) {
        assert(meetsTarget(r.Mr_act, r.Mr_target), `Mc=${mc}：尺寸未达目标模数`);
        same(r.modOk, true, `Mc=${mc}：modOk 必须为 true —— 且**与 volOk 无关**`);
        assert(typeof r.volOk === 'boolean', `Mc=${mc}：volOk 应是布尔诊断值`);
        // 尺寸与重量无关（旧用例里"重量决定尺寸"的现象不得复活）
        same(r.D, R(mc, { cw: 0 }).D, `Mc=${mc}：尺寸随铸件重量变了`);
      }
    },
  },
  {
    name: 'V2.0-13-D3 ★ D 恰好是满足**目标模数**的最小整数（不虚增一档以上）',
    fn: () => {
      let bumped = 0;
      for (let i = 0; i <= 1000; i++) {
        const mc = +(1 + i * 0.01).toFixed(2);
        const r = R(mc);
        const sd = RISER_SHAPES.cyl;
        const Mr = mc * 1.2;                       // PHASE V2.0-22：判据由 Mc×1.10×0.99 改为目标模数（严格）
        const rd = Math.round(sd.DfromM(Mr, 1.0));
        const passAt = (d) => sd.M(d, d) >= Mr;
        let dmin = rd; while (!passAt(dmin)) dmin++;                  // 上探
        while (dmin > 1 && passAt(dmin - 1)) dmin--;                  // 下探（最小性）
        same(r.D, dmin, `Mc=${mc}：D 不是最小可行整数（虚增了档位）`);
        if (dmin !== rd) bumped++;
      }
      assert(bumped > 0, '样本里没有任何升档点 —— 本用例没测到修复本身');
    },
  },

  /* ================= E. 结果语义 ================= */
  {
    name: 'V2.0-13-E1 ★ dModOnly 保持纯理论口径（不跟随升档）',
    fn: () => {
      for (const mc of [2, 3.37, 3.38, 5, 14, 30]) {
        const r = R(mc, { cw: mc >= 14 ? 77.56 : 0 });
        const sd = RISER_SHAPES.cyl;
        // PHASE V2.0-22（138.txt §三.1）：比例随设计规则同步 —— 原为硬编码的 1.10，现为目标模数比
        same(r.dModOnly, Math.round(sd.DfromM(mc * 1.2, 1.0)),
          `Mc=${mc}：dModOnly 必须保持"仅按 Mc×1.2 连续解取整"的理论口径`);
      }
      // 升档点上 dModOnly 可以比 D 小 1 —— 这是 124.txt §二 有意保留的差异
      const a = R(3.37);
      same(a.D, 25, 'Mc=3.37 的 D'); same(a.dModOnly, 24, 'Mc=3.37 的 dModOnly（理论值）');
      assert(a.dModOnly <= a.D, 'dModOnly 不应大于实际尺寸');
    },
  },
  {
    name: 'V2.0-13-E2 ★ 结果卡不得再出现"体积主导尺寸"的旧归因（PHASE V2.0-22 重写）',
    fn: () => {
      // ⚠ 旧用例守的是"dModOnly 只在 bind==='volume' 分支渲染、且措辞为'仅按模数所需'"。
      //   138.txt §四.1 明令：不得再让旧状态暗示"当前尺寸由体积约束决定"
      //   ⇒ 该分支与那句文案**已删除**。本用例改为守住"删除"这一事实（防复活）。
      // 注释剥离后再判"不得存在"：源码注释里会**引用**被删除的旧文案（那是文档，不是渲染）
      const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
      const V = readFileSync('js/views/resultsCenter.js', 'utf8');
      const Vc = strip(V);
      assert(!Vc.includes("it.bind === 'volume'"), '结果卡仍存在 volume 归因分支');
      assert(!Vc.includes('本尺寸由'), '结果卡仍渲染"本尺寸由体积主导"的旧文案');
      assert(!Vc.includes('需加大冒口或加冷铁'), '结果卡仍有"体积不足 ⇒ 需加大冒口"的失败态文案');
      // S5-01：旧体积提示已移除；目标模数规则 + 尚需生产验证的提示必须保留。
      assert(!Vc.includes('旧体积模型参考') && !Vc.includes('旧体积参考不足'),
        'S5-01：结果页不得再显示旧体积模型提示');
      assert(V.includes('推荐尺寸依据当前目标模数规则计算'), '缺少"目标模数规则 + 尚需生产验证"的提示句');
      // riser.js 侧仍须写明 dModOnly 是纯理论参考值（口径未变，只是比例 1.10 → 1.2）
      const R2 = readFileSync('calcs/riser.js', 'utf8');
      assert(R2.includes('本字段是纯理论参考值'), 'riser.js 未标注 dModOnly 是纯理论参考值');
      // "不得存在"类断言走注释剥离版（注释里会引用旧写法作为说明）
      const R2c = strip(R2);
      assert(!/Mc \* 1\.10|mc \* 1\.10/.test(R2c), 'riser.js 仍有硬编码的 1.10（应与 MODULUS_TARGET_RATIO 同源）');
      assert(R2c.includes('MODULUS_TARGET_RATIO'), 'riser.js 未使用目标模数常量');
    },
  },
  {
    name: 'V2.0-13-E3 ★ 修复不得影响与 M(D,H) 无关的既有字段（数值冻结）',
    fn: () => {
      for (const b of FROZEN) {
        const r = R(b.mc, { cw: 77.56 });
        same(r.D, b.D, `Mc=${b.mc}：D 变了`); same(r.H, b.H, `Mc=${b.mc}：H 变了`);
        near(r.final_f, b.f, 1e-9, `Mc=${b.mc}：final_f 变了`);
        near(r.Mr_act, b.Mr, 1e-9, `Mc=${b.mc}：Mr_act 变了`);
        near(r.Vr, b.Vr, 1e-6, `Mc=${b.mc}：Vr 变了`);
        same(r.d_neck, b.neck, `Mc=${b.mc}：d_neck 变了`);
        same(r.volOk, b.volOk, `Mc=${b.mc}：volOk 变了`);
        same(r.modOk, b.modOk, `Mc=${b.mc}：modOk 变了`);
      }
    },
  },
];

/* ---- 自运行（node tests/phasev2013_test.mjs）---- */
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
