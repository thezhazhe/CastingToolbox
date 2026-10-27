// ============================================================
// PHASE V2.0-16（127.txt §三 / §五）· 边界案例裁决 + D_req 恒等式测试
//
//   本阶段**不改任何生产代码**。因此本套件只做两件事：
//     A. 把 V2.0-13→V2.0-15 记录的两个 limit→收敛边界案例**正式钉死**，
//        并补上此前**没有测到**的那一半：**"D−1 为什么不行"** ——
//        即证明这两个案例确实在边界上、+1mm 是**必需**而不是保守。
//     B. 钉住下一阶段 `D_req` 所依赖的**解析恒等式**（Vr = k·D³），
//        使将来若有人改动 `RISER_SHAPES.*.V` 时能立刻发现推导基础被动摇。
//
//   覆盖口径说明（127.txt §六.4/§六.5）：
//     · 已由 `tests/phasev2015_test.mjs` 的 `V2.0-15-G2` 覆盖的部分**不重复**：
//       输入条件（mc/shape/cw）、当前 D/H、`converged===true`、`modOk && volOk`。
//     · 本文件**只补**它没覆盖的：完整数值字段、`bind`、f，以及**边界性质**本身。
//     · 夹具基线来源：`tests/engineering-generated/phasev2012_c1_sweep.csv`
//       （修复前，sha256 0f8f940b…）——下面的"修复前"数值即取自该文件，**只作对照记录**。
//
//   ★ PHASE V2.0-22（138.txt §3.4）重新基线化：尺寸改由**目标模数** Mr_target = Mc×1.2 反求，
//     旧体积约束（整件净重口径）不再决定尺寸、`bind` 恒为 'modulus'、`final_f` 恒为 1.2。
//     因此 `after` 数值全部更新；A2/A3/A4 中"两条校核都过 / volOk 是判据 / 体积薄裕度"的前提
//     随之失效，已改写为**新契约下仍然成立**的守卫（见各用例内的 PHASE V2.0-22 注释）。
// ============================================================
import { runRiser, RISER_SHAPES, meetsTarget } from '../calcs/riser.js';

const assert = (c, m) => { if (!c) throw new Error(m); };
const same = (a, b, m) => { if (a !== b) throw new Error(`${m}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`); };
const near = (a, b, tol, m) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m}（期望 ${b}±${tol}，实际 ${a}）`); };

const R = (mc, o = {}) => runRiser({
  mat: o.mat || '球铁', cast_wt: o.cw || 0, mc_mode: 'direct', mc,
  shape: o.shape || 'cyl', hd_ratio: o.hd === undefined ? 1.0 : o.hd,
});

/** 生产 `sizeAt` 的 H 口径（与 calcs/riser.js 同规则；测试侧复述以便做反事实复核） */
function hFor(shape, d, hd) {
  let h = Math.round(d * hd);
  if (shape === 'sphere_head') { const r = d / 2; if (h < r) h = Math.round(r); }
  if (shape === 'sphere') h = d;
  return h;
}

/**
 * 两个边界案例的完整锁定值（`after` 已在 PHASE V2.0-22 按目标模数契约重新基线化）。
 * `before` = 修复前（基线 CSV，`bind='limit'`，**两条校核都不过**）—— 自 V2.0-22 起**仅作历史记录**：
 *            新规则下"D−1"与它无关（它比新解大得多），只用于 A5 的"不得退回旧 limit 值"护栏。
 * `after`  = 当前生产（尺寸由目标模数 Mr_target = Mc×1.2 反求；`bind` 恒为 'modulus'，`final_f` 恒为 1.2）。
 */
const BOUNDARY = [
  {
    tag: 'A1', mc: 1.24, shape: 'cyl', cw: 0.5, hd: 1.0,
    after: { D: 9, H: 9, f: 1.2, Mr_act: 1.5, Mr_need: 1.488, Vr: 572.5552611167398, effV: 80.15773655634358, bind: 'modulus' },
    before: { D: 26, H: 26, modOk: false, volOk: false, bind: 'limit', Mr_act: 4.33333333333, effV: 1932.58213678 },
  },
  {
    tag: 'A2', mc: 1.10, shape: 'sphere_head', cw: 0.5, hd: 1.0,
    after: { D: 8, H: 8, f: 1.2, Mr_act: 1.3333333333333333, Mr_need: 1.32, Vr: 335.1032163829112, effV: 83.7758040957278, bind: 'modulus' },
    before: { D: 23, H: 23, modOk: false, volOk: false, bind: 'limit', Mr_act: 3.83333333333, effV: 1990.82071960 },
  },
];

/** 在给定尺寸下复算**新契约**的判据（只用公开 M 与生产返回的 Mr_target；无 0.99 容差） */
function judge(sd, d, h, Mr) {
  const Mr_act = (d > 0 && h > 0) ? sd.M(d, h) : 0;
  return { Mr_act, modOk: Mr_act >= Mr };
}

export const tests = [
  /* ================= A. 两个边界案例的正式裁决（127.txt §三） ================= */
  {
    name: 'V2.0-16-A1 ★ 两个边界案例的完整数值锁定（此前只锁了 D/H，未锁 f/Mr/Vr/effV/bind）',
    fn: () => {
      for (const c of BOUNDARY) {
        const r = R(c.mc, { cw: c.cw, shape: c.shape, hd: c.hd });
        assert(r, `${c.tag} 无结果`);
        const a = c.after;
        same(r.D, a.D, `${c.tag} D`);
        same(r.H, a.H, `${c.tag} H`);
        near(r.final_f, a.f, 1e-9, `${c.tag} final_f`);
        near(r.Mr_act, a.Mr_act, 1e-12, `${c.tag} Mr_act`);
        near(r.Mr_need, a.Mr_need, 1e-9, `${c.tag} Mr_need`);
        near(r.Vr, a.Vr, 1e-6, `${c.tag} Vr`);
        near(r.effV, a.effV, 1e-6, `${c.tag} effV`);
        same(r.bind, a.bind, `${c.tag} bind（应为 modulus：尺寸只由目标模数反求）`);
        same(r.converged, true, `${c.tag} converged`);
        same(r.modOk, true, `${c.tag} modOk`);
        // PHASE V2.0-22（138.txt §3.4）：`volOk` 已**不是判据**（旧体积口径=整件净重，不再决定尺寸）
        //   ⇒ 两个案例在新尺寸下都为 false。不得删断言、也不得改回 `true`，而是守住它的新语义：诊断布尔值。
        assert(typeof r.volOk === 'boolean', `${c.tag}：volOk 应为布尔诊断值（实际 ${JSON.stringify(r.volOk)}）`);
        near(r.Mr_target, r.Mc * 1.2, 1e-12, `${c.tag} Mr_target ≠ Mc×1.2`);
        same(r.targetRatio, 1.2, `${c.tag} targetRatio`);
        // 内部自洽
        near(r.Mr_need, r.Mc * r.final_f, 1e-12, `${c.tag} Mr_need ≠ Mc×f`);
        near(r.Mr_act, RISER_SHAPES[c.shape].M(r.D, r.H), 1e-12, `${c.tag} Mr_act ≠ M(D,H)`);
        near(r.effV, r.Vr * r.eff, 1e-9, `${c.tag} effV ≠ Vr×eff`);
      }
    },
  },
  {
    name: 'V2.0-16-A2 ★★ 边界性质：D−1 **不满足目标模数**（+1mm 是必需，不是保守）',
    fn: () => {
      for (const c of BOUNDARY) {
        const r = R(c.mc, { cw: c.cw, shape: c.shape, hd: c.hd });
        const sd = RISER_SHAPES[c.shape];
        const dPrev = r.D - 1, hPrev = hFor(c.shape, dPrev, r.hd);
        // PHASE V2.0-22（138.txt §3.4）：原前提随"体积约束不再决定尺寸"失效，改为守住新契约。
        //   判据：D−1 的模数必须**严格**低于目标（不再有 0.99 容差、不再看体积校核）。
        const j = judge(sd, dPrev, hPrev, r.Mr_target);
        assert(j.modOk === false,
          `${c.tag}：D−1=(${dPrev},${hPrev}) 的模数 ${j.Mr_act} 竟已达到目标 ${r.Mr_target} —— 该点并非边界`);
        assert(meetsTarget(r.Mr_act, r.Mr_target),
          `${c.tag}：D=(${r.D},${r.H}) 必须达到目标模数（${r.Mr_act} vs ${r.Mr_target}）`);
        // 历史记录仍在（原"D−1 正是修复前那一档"的对照已随新规则失效，改为守住规则变更的**方向**）：
        //   旧 limit 值由整件净重顶上去，比新规则的目标模数解**更大** —— 这正是不再按体积定尺寸的理由。
        assert(c.before.D > r.D && c.before.H > r.H,
          `${c.tag}：旧 limit 值 (${c.before.D},${c.before.H}) 应大于新解 (${r.D},${r.H})（旧的整件净重口径把尺寸顶大了）`);
      }
    },
  },
  {
    name: 'V2.0-16-A3 ★★ 裁决依据：当前 D 是"满足目标模数 M(D,H) ≥ Mr_target 的最小整数直径"',
    fn: () => {
      for (const c of BOUNDARY) {
        const r = R(c.mc, { cw: c.cw, shape: c.shape, hd: c.hd });
        const sd = RISER_SHAPES[c.shape];
        // PHASE V2.0-22（138.txt §3.4）：原前提随"体积约束不再决定尺寸"失效，改为守住新契约。
        //   最小性定义随之改为**只对目标模数**：升序全扫，第一个满足 M(D,H) ≥ Mr_target 的整数 D。
        let dmin = null;
        for (let d = 1; d <= r.D + 5; d++) {
          const h = hFor(c.shape, d, r.hd);
          if (judge(sd, d, h, r.Mr_target).modOk) { dmin = d; break; }
        }
        same(dmin, r.D, `${c.tag}：满足目标模数的最小整数直径为 ${dmin}，但生产给出 ${r.D} —— +1mm 不再是最小可行解`);
        assert(meetsTarget(r.Mr_act, r.Mr_target), `${c.tag}：D 必须达到目标模数（${r.Mr_act} vs ${r.Mr_target}）`);
      }
    },
  },
  {
    name: 'V2.0-16-A4 ★ 裁决边界：不因"达到目标模数"就宣称真实件已验证（措辞守卫）',
    fn: () => {
      // 两个案例的"通过"只意味着**满足本算法的目标模数**（V2.0-22 起体积约束已不是判据）。
      // 本用例在测试层面禁止把这类结论写成真实铸件已验证（防止将来有人往注释/文案里塞）。
      for (const c of BOUNDARY) {
        const r = R(c.mc, { cw: c.cw, shape: c.shape, hd: c.hd });
        // PHASE V2.0-22（138.txt §3.4）：原前提随"体积约束不再决定尺寸"失效，改为守住新契约。
        //   触发条件由"modOk && volOk && converged"改为"达到目标模数 && 已收敛 && 归因=目标模数"。
        assert(r.modOk && r.converged && r.bind === 'modulus', `${c.tag} 前提变化`);
        // 结果对象里**不得**出现任何"已验证 / 实测 / 生产确认"类字段
        const keys = Object.keys(r).join('|');
        for (const bad of ['verified', 'validated', '实测', '已验证', 'production_confirmed']) {
          assert(!keys.includes(bad), `${c.tag}：返回对象出现了声称真实验证的字段「${bad}」`);
        }
        // 原"体积裕度仅 +2.4% / +7.1%（刚好过线，不是宽裕）"的记录随新旧规则交替一并失效：
        //   新尺寸按目标模数给出，必然远小于"整件净重"口径所需 ⇒ 这两个案例的旧体积校核**不通过**
        //   （margin < 0），而新契约**明确接受**该尺寸。这正是本用例要守住的边界：
        //   `volOk` 是诊断值，**不得**（a）被当作"尺寸合格/不合格"的依据，（b）反过来把尺寸顶大。
        //   ⇒ 若将来有人把体积约束接回尺寸路径（volOk 变 true / bind 变 volume），本条立刻变红。
        const margin = r.effV / r.needVol - 1;
        assert(Number.isFinite(margin) && margin < 0,
          `${c.tag}：新尺寸下旧体积校核应**不通过**（诊断裕度 ${margin}）—— 若变为通过，说明体积约束被接回了尺寸路径`);
        assert(r.bind === 'modulus', `${c.tag}：尺寸归因不得退回 volume`);
      }
    },
  },
  {
    name: 'V2.0-16-A5 回归护栏：不得退回修复前的 limit 值（26/23 那两档）',
    fn: () => {
      for (const c of BOUNDARY) {
        const r = R(c.mc, { cw: c.cw, shape: c.shape, hd: c.hd });
        assert(r.D !== c.before.D || r.H !== c.before.H,
          `${c.tag}：D/H 退回修复前的 (${c.before.D},${c.before.H}) —— C′ 的取整补偿被撤销了`);
        assert(r.converged === true, `${c.tag}：退回未收敛`);
        assert(r.bind !== 'limit', `${c.tag}：bind 退回 limit`);
      }
    },
  },

  /* ================= B. D_req 所依赖的解析恒等式（127.txt §五，**只读**） ================= */
  {
    name: 'V2.0-16-B1 ★ D_req 推导基础：Vr 是 D 的三次齐次式 Vr = k(形状,hd)·D³',
    fn: () => {
      // k 表来自 127.txt §五 的只读推导（见 docs/PHASE_V2.0-16_BOUNDARY_AND_BENCHMARK.md §D_req）
      const K = {
        cyl: (hd) => Math.PI / 4 * hd,
        square: (hd) => hd,
        sphere: () => Math.PI / 6,                 // H 恒 = D，与 hd 无关
        sphere_head: (hd) => Math.PI * (3 * hd - 0.5) / 12,   // hd ≥ 0.5
      };
      for (const [shape, kf] of Object.entries(K)) {
        const sd = RISER_SHAPES[shape];
        for (const hd of [0.8, 1.0, 1.2, 1.5, 2.0]) for (const D of [10, 23.5, 60, 144.7, 500]) {
          const got = sd.V(D, hd * D) / (D ** 3);
          near(got, kf(hd), 1e-12, `${shape} hd=${hd} D=${D} 的 k 不符（Vr 不再与 D³ 成正比 ⇒ D_req 解析式失效）`);
        }
      }
    },
  },
  {
    name: 'V2.0-16-B2 ★ 夹具 143.91mm 可复算，且与生产 eff/needVol 的翻转点一致',
    fn: () => {
      const r = R(5, { cw: 77.56, shape: 'cyl', hd: 1 });            // 与 V2.0-14 §5.3 同夹具
      near(r.needVol, 77.56 * 1e6 / 7.1 * 0.03, 1e-6, 'needVol');
      const D_req = Math.cbrt(r.needVol / (r.eff * Math.PI / 4));
      near(D_req, 143.9111, 5e-4, 'D_req 复算值（127.txt/V2.0-14 记为 143.91mm）');
      // 用生产的 eff/needVol 找真实翻转点（连续解），应与解析式重合
      let flip = null;
      for (let D = 140; D <= 150; D += 0.0005) { if (RISER_SHAPES.cyl.V(D, D) * r.eff >= r.needVol) { flip = D; break; } }
      assert(flip !== null, '143.91 附近未找到 effV≥needVol 的翻转点');
      near(flip, D_req, 1e-3, '实测翻转点 ≠ 解析 D_req');
    },
  },
  {
    name: 'V2.0-16-B3 ★ D_req 与 Mc 无关；但随 cw/形状/hd 变化（下一阶段实现的前提）',
    fn: () => {
      const dOf = (rr, shape, hd) => {
        const k = { cyl: Math.PI / 4 * hd, square: hd, sphere: Math.PI / 6, sphere_head: Math.PI * (3 * hd - 0.5) / 12 }[shape];
        return Math.cbrt(rr.needVol / (rr.eff * k));
      };
      // 固定 cw/形状/hd 扫 Mc ⇒ D_req 逐位不变
      const base = R(1, { cw: 0.5 });
      for (const Mc of [0.5, 2, 5, 20, 99]) {
        const rr = R(Mc, { cw: 0.5 });
        near(dOf(rr, 'cyl', 1), dOf(base, 'cyl', 1), 1e-12, `Mc=${Mc} 时 D_req 变了（应只依赖 needVol/eff/形状/hd）`);
      }
      // 改 cw 必须变
      assert(dOf(R(1, { cw: 200 }), 'cyl', 1) > dOf(base, 'cyl', 1) * 5, 'D_req 未随 cw 变化');
      // 改 hd 必须变（cyl: k ∝ hd）
      const hd15 = R(1, { cw: 200, hd: 1.5 });
      near(dOf(hd15, 'cyl', 1.5), dOf(R(1, { cw: 200 }), 'cyl', 1) / Math.cbrt(1.5), 1e-9, 'hd=1.5 时 D_req 未按 ∛(1/hd) 缩小');
    },
  },
];
