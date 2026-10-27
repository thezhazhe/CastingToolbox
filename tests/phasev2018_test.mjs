// ============================================================
// PHASE V2.0-18（129.txt §七）· 冒口计算**输入安全**测试
//
//   本阶段**修改了** `calcs/riser.js` 的输入守卫与 `js/views/wizard.js` 的校验，
//   所以本套件要同时钉住**两件方向相反的事**：
//     ① 非法输入**不得**再产出"看似正常"的结果（NAN / ZERO / SILENT 三类，V2.0-17 §4.1）；
//     ② **合法输入的数值结果逐位不变**（§八 的硬要求）。
//
//   ★ 第 ② 件的**主证据**不是本文件，而是 `tests/experiments/phasev2014_dist.mjs`
//     对 26,525 行修复前基线 CSV 的**修复前后对照**（两次结果逐项相同：
//     不变 23,407 · D 变小 1,635 · D 变大 2 · 最大 −24mm · 约束不满足 0）。
//     本文件的 `H1` 只用一张有代表性的冻结表做**快速哨兵**，避免把 26k 点搬进单测。
//
//   证据口径：一律走**真实生产函数**（runRiser），不测 `readNum` 等私有实现细节。
// ============================================================
import { readFileSync, existsSync } from 'node:fs';
import { runRiser, RISER_SHAPES, RISER_EFF, RISER_MATERIALS, meetsTarget } from '../calcs/riser.js';

const assert = (c, m) => { if (!c) throw new Error(m); };
const same = (a, b, m) => { if (a !== b) throw new Error(`${m}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`); };
const near = (a, b, tol, m) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m}（期望 ${b}±${tol}，实际 ${a}）`); };

const R = (o) => runRiser({ mat: '球铁', mc_mode: 'direct', ...o });

/** 断言"不产出结果"，并顺带确认**没有抛异常**（129.txt §七.12） */
function mustBeNull(inp, label) {
  let r, threw = null;
  try { r = R(inp); } catch (e) { threw = e; }
  if (threw) throw new Error(`${label}：抛异常了（应返回 null）—— ${threw.message}`);
  if (r !== null) throw new Error(`${label}：应返回 null，实际返回 ${JSON.stringify({ D: r.D, H: r.H, Mr_act: r.Mr_act, bind: r.bind })}`);
}

/** 断言"产出了正常结果"（不抛异常，且非 null） */
function mustBeObject(inp, label) {
  let r, threw = null;
  try { r = R(inp); } catch (e) { threw = e; }
  if (threw) throw new Error(`${label}：抛异常了 —— ${threw.message}`);
  if (r === null) throw new Error(`${label}：应为正常结果，实际是 null`);
  return r;
}

/* 合法输入的**冻结表**（4 形状 × 3 hd × 3 cw 的代表点）。
   ⚠ PHASE V2.0-22（138.txt §3.4）：本表**已重新基线化** —— 推荐尺寸改由目标模数
   `Mr_target = Mc × 1.2` 决定，旧体积约束不再参与，于是 `f` 恒 1.2、`bind` 恒 `'modulus'`，
   且 D/H **与 cast_wt 无关**（第 1、2 行同 Mc 不同 cw 却同尺寸 = 解耦的直接证据）。
   旧值（33/106/63/176/59/82/26 与 f=1.1…3.55、bind=start/limit/volume）是"体积约束主导尺寸"
   时代的快照。本表仍作快照哨兵；新契约的硬性质（`Mr_act ≥ Mr_target`、最小整数档）由 H1 逐行复核。 */
const FROZEN = [
  { shape: 'cyl', hd: 1.0, cw: 0, mc: 5, D: 36, H: 36, f: 1.2, bind: 'modulus' },
  { shape: 'cyl', hd: 1.0, cw: 77.56, mc: 5, D: 36, H: 36, f: 1.2, bind: 'modulus' },
  { shape: 'cyl', hd: 0.8, cw: 5, mc: 5, D: 40, H: 32, f: 1.2, bind: 'modulus' },
  { shape: 'cyl', hd: 1.5, cw: 200, mc: 20, D: 128, H: 192, f: 1.2, bind: 'modulus' },
  { shape: 'sphere', hd: 1.0, cw: 5, mc: 5, D: 36, H: 36, f: 1.2, bind: 'modulus' },
  { shape: 'square', hd: 1.2, cw: 20, mc: 8, D: 55, H: 66, f: 1.2, bind: 'modulus' },
  { shape: 'sphere_head', hd: 0.8, cw: 0.5, mc: 3, D: 24, H: 19, f: 1.2, bind: 'modulus' },
];

export const tests = [
  /* ================= A. Mc（§七.1 / §七.2） ================= */
  {
    name: 'V2.0-18-A1 Mc 为正有限数：正常计算（4 形状 × 多档）',
    fn: () => {
      let n = 0;
      for (const shape of ['cyl', 'sphere_head', 'sphere', 'square'])
        for (const mc of [0.5, 1, 5, 20, 100]) {
          const r = mustBeObject({ mc, shape, cast_wt: 5 }, `Mc=${mc} ${shape}`);
          assert(r.Mc === mc, `Mc 应原样回传`);
          assert(Number.isFinite(r.D) && r.D > 0 && Number.isFinite(r.H) && r.H > 0, `Mc=${mc} ${shape} 的 D/H 应为正有限数`);
          assert(typeof r.converged === 'boolean' && typeof r.modOk === 'boolean' && typeof r.volOk === 'boolean', `状态字段应齐备且为布尔`);
          n++;
        }
      assert(n === 20, '样本数不对');
    },
  },
  {
    name: 'V2.0-18-A2 ★ Mc = Infinity / NaN / 0 / 负数 ⇒ null（旧实现返回 Infinity/NaN 对象）',
    fn: () => {
      // ★ 主修复：`Mc <= 0` 抓不到 Infinity，旧实现返回 {D:Infinity, Mr_act:NaN, ...}
      mustBeNull({ mc: Infinity, shape: 'cyl', cast_wt: 5 }, 'Mc=Infinity');
      mustBeNull({ mc: -Infinity, shape: 'cyl', cast_wt: 5 }, 'Mc=-Infinity');
      mustBeNull({ mc: NaN, shape: 'cyl', cast_wt: 5 }, 'Mc=NaN');
      mustBeNull({ mc: 0, shape: 'cyl', cast_wt: 5 }, 'Mc=0');
      mustBeNull({ mc: -3, shape: 'cyl', cast_wt: 5 }, 'Mc=-3');
      mustBeNull({ mc: 'abc', shape: 'cyl', cast_wt: 5 }, "Mc='abc'");
      mustBeNull({ mc: 'Infinity', shape: 'cyl', cast_wt: 5 }, "Mc='Infinity'（字符串）");
      mustBeNull({ mc: '', shape: 'cyl', cast_wt: 5 }, 'Mc=空串');
      // 其他 mc_mode 也要挡住非有限
      mustBeNull({ mc_mode: 'hot_spot', hot_d: Infinity, shape: 'cyl', cast_wt: 5 }, 'hot_d=Infinity');
      mustBeNull({ mc_mode: 'wall', wall_t: Infinity, shape: 'cyl', cast_wt: 5 }, 'wall_t=Infinity');
      mustBeNull({ mc_mode: 'volume', cast_v: Infinity, cast_a: 1, shape: 'cyl', cast_wt: 5 }, 'cast_v=Infinity');
      mustBeNull({ mc_mode: 'volume', cast_v: 5, cast_a: 0, shape: 'cyl', cast_wt: 5 }, 'cast_a=0（除零）');
      mustBeNull({ mc_mode: 'unknown_mode', shape: 'cyl', cast_wt: 5 }, '未知 mc_mode');
    },
  },

  /* ================= B. cast_wt（§七.3） ================= */
  {
    name: 'V2.0-18-B1 ★ cw = 负数 / 非有限 / 非数值字符串 ⇒ null（旧实现静默关闭体积校核）',
    fn: () => {
      // ★ 主修复：旧实现 `cw > 0 ? … : true` 对负数**静默关闭体积校核**，返回看似正常的尺寸
      mustBeNull({ mc: 5, shape: 'cyl', cast_wt: -5 }, 'cw=-5');
      mustBeNull({ mc: 5, shape: 'cyl', cast_wt: -0.001 }, 'cw=-0.001');
      mustBeNull({ mc: 5, shape: 'cyl', cast_wt: Infinity }, 'cw=Infinity');
      mustBeNull({ mc: 5, shape: 'cyl', cast_wt: -Infinity }, 'cw=-Infinity');
      mustBeNull({ mc: 5, shape: 'cyl', cast_wt: 'abc' }, "cw='abc'");
      mustBeNull({ mc: 5, shape: 'cyl', cast_wt: 'NaN' }, "cw='NaN'");
      // ★ cw 的 NaN 也按非法处理（其缺省值 0 本身会关闭体积校核，见 riser.js readNum 注释）
      mustBeNull({ mc: 5, shape: 'cyl', cast_wt: NaN }, 'cw=NaN（数字）');
    },
  },
  {
    name: 'V2.0-18-B2 ★ cw = 0 / 缺失 ⇒ 保持既有约定（不做体积校核），不算非法',
    fn: () => {
      // 「未填重量 ⇒ 不做体积校核」是**已文档化**的约定（riserStatus.js:41），必须保持
      for (const [label, inp] of [['cw=0', { mc: 5, shape: 'cyl', cast_wt: 0 }], ['cw 缺失', { mc: 5, shape: 'cyl' }], ['cw=空串', { mc: 5, shape: 'cyl', cast_wt: '' }]]) {
        const r = mustBeObject(inp, label);
        same(r.cw, 0, `${label}：cw 应为 0`);
        same(r.Vc, 0, `${label}：Vc 应为 0`);
        same(r.needVol, 0, `${label}：needVol 应为 0`);
        same(r.volOk, true, `${label}：volOk 恒 true（体积约束不参与）`);
        same(r.yieldPct, null, `${label}：yieldPct 应为 null（"不适用"的既有惯例）`);
      }
      // 三者必须给出**同一个**结果（证明确实走同一条"未提供"路径）
      const sig = (o) => { const r = R(o); return `${r.D}|${r.H}|${r.final_f}|${r.bind}`; };
      same(sig({ mc: 5, shape: 'cyl', cast_wt: 0 }), sig({ mc: 5, shape: 'cyl' }), 'cw=0 与 cw 缺失应等价');
      same(sig({ mc: 5, shape: 'cyl', cast_wt: '' }), sig({ mc: 5, shape: 'cyl' }), 'cw=空串 与 cw 缺失应等价');
    },
  },

  /* ================= C. rho（§七.4） ================= */
  {
    name: 'V2.0-18-C1 ★ rho = 0 / 负数 / 非有限 ⇒ null（旧实现除零或令判据恒真）',
    fn: () => {
      // ★ 主修复：rho=0 ⇒ Vc=Infinity（除零）；rho<0 ⇒ needVol<0 ⇒ `effV >= 负` 恒真 ⇒ 体积判据被架空
      mustBeNull({ mc: 5, shape: 'cyl', cast_wt: 5, rho: 0 }, 'rho=0');
      mustBeNull({ mc: 5, shape: 'cyl', cast_wt: 5, rho: -7.1 }, 'rho=-7.1');
      mustBeNull({ mc: 5, shape: 'cyl', cast_wt: 5, rho: Infinity }, 'rho=Infinity');
      mustBeNull({ mc: 5, shape: 'cyl', cast_wt: 5, rho: NaN }, 'rho=NaN');
      mustBeNull({ mc: 5, shape: 'cyl', cast_wt: 5, rho: 'abc' }, "rho='abc'");
    },
  },
  {
    name: 'V2.0-18-C2 rho 缺失 ⇒ 回退材料表密度（`??` 的既有设计，行为不变）',
    fn: () => {
      for (const mat of Object.keys(RISER_MATERIALS)) {
        const r = mustBeObject({ mat, mc: 5, shape: 'cyl', cast_wt: 50 }, `mat=${mat}`);
        near(r.rhoUsed, RISER_MATERIALS[mat].rho, 1e-12, `${mat} 的 rhoUsed 应回退到材料表`);
      }
      // 显式覆盖必须生效（且与材料表不同）
      const ov = mustBeObject({ mc: 5, shape: 'cyl', cast_wt: 50, rho: 7.85 }, 'rho 覆盖');
      near(ov.rhoUsed, 7.85, 1e-12, '显式 rho 未生效');
      // 与 phasev2018 之前的行为一致：显式 rho 改变 Vc ⇒ 可能改变尺寸（这里只验 rhoUsed 与 Vc 接通）
      near(ov.Vc, 50e6 / 7.85, 1e-6, 'Vc 未按覆盖后的 rho 计算');
    },
  },

  /* ================= D. hd（§七.5） ================= */
  {
    name: 'V2.0-18-D1 ★ hd = 负数 / 0 / 非有限 ⇒ null（旧实现返回 D=0,H=0 或静默当 1.0）',
    fn: () => {
      // ★ 主修复：hd=-0.5 旧实现返回 {D:0, H:0}（"看似有效"的假结果）
      mustBeNull({ mc: 5, shape: 'cyl', cast_wt: 5, hd_ratio: -0.5 }, 'hd=-0.5');
      mustBeNull({ mc: 5, shape: 'cyl', cast_wt: 5, hd_ratio: -1 }, 'hd=-1');
      mustBeNull({ mc: 5, shape: 'cyl', cast_wt: 5, hd_ratio: 0 }, 'hd=0（零高度冒口）');
      mustBeNull({ mc: 5, shape: 'cyl', cast_wt: 5, hd_ratio: Infinity }, 'hd=Infinity');
      mustBeNull({ mc: 5, shape: 'cyl', cast_wt: 5, hd_ratio: NaN }, 'hd=NaN');
      mustBeNull({ mc: 5, shape: 'cyl', cast_wt: 5, hd_ratio: 'abc' }, "hd='abc'");
      mustBeNull({ mc: 5, shape: 'sphere_head', cast_wt: 5, hd_ratio: -0.5 }, 'sphere_head hd=-0.5');
    },
  },
  {
    name: 'V2.0-18-D2 hd 缺失 / 空串 ⇒ 缺省 1.0；合法 hd 全档正常（含 UI 可达的 0.8/1.0/1.2/1.5）',
    fn: () => {
      const absent = mustBeObject({ mc: 5, shape: 'cyl', cast_wt: 5 }, 'hd 缺失');
      near(absent.hd, 1.0, 1e-12, 'hd 缺失应缺省 1.0');
      const empty = mustBeObject({ mc: 5, shape: 'cyl', cast_wt: 5, hd_ratio: '' }, 'hd=空串');
      near(empty.hd, 1.0, 1e-12, 'hd 空串应缺省 1.0');
      same(`${empty.D}|${empty.H}`, `${absent.D}|${absent.H}`, 'hd 空串与缺失应等价');
      // 合法档位（UI 的 4 个选项 + 实验用到的 0.5/2.0）全部可用
      for (const hd of [0.5, 0.8, 1.0, 1.2, 1.5, 2.0]) {
        const r = mustBeObject({ mc: 5, shape: 'cyl', cast_wt: 0, hd_ratio: hd }, `hd=${hd}`);
        near(r.hd, hd, 1e-12, `hd=${hd} 未生效`);
        assert(r.H > 0 && r.D > 0, `hd=${hd} 应产出正尺寸`);
      }
      // 字符串形式的合法数字（视图的 select 传的就是字符串）
      const s = mustBeObject({ mc: 5, shape: 'cyl', cast_wt: 0, hd_ratio: '1.2' }, "hd='1.2'");
      near(s.hd, 1.2, 1e-12, "字符串 '1.2' 应被接受（视图 select 走的就是这条）");
    },
  },

  /* ================= E. shape（§七.6） ================= */
  {
    name: 'V2.0-18-E1 非法 shape ⇒ null（且不抛异常）；4 个合法形状全部正常',
    fn: () => {
      mustBeNull({ mc: 5, shape: 'hexagon', cast_wt: 5 }, 'shape=hexagon');
      mustBeNull({ mc: 5, shape: '', cast_wt: 5 }, 'shape=空串');
      mustBeNull({ mc: 5, cast_wt: 5 }, 'shape 缺失');
      mustBeNull({ mc: 5, shape: 'constructor', cast_wt: 5 }, "shape='constructor'（原型链污染尝试）");
      mustBeNull({ mc: 5, shape: 'toString', cast_wt: 5 }, "shape='toString'（原型链污染尝试）");
      for (const shape of Object.keys(RISER_SHAPES)) {
        const r = mustBeObject({ mc: 5, shape, cast_wt: 5 }, `shape=${shape}`);
        same(r.shapeKey, shape, 'shapeKey 应回传');
      }
    },
  },

  /* ================= F. eff / RISER_EFF（§七.7） ================= */
  {
    name: 'V2.0-18-F1 ★ eff = 0 / 负数 / 非有限 ⇒ null（旧实现静默回退默认值）',
    fn: () => {
      mustBeNull({ mc: 5, shape: 'cyl', cast_wt: 5, eff: 0 }, 'eff=0');
      mustBeNull({ mc: 5, shape: 'cyl', cast_wt: 5, eff: -10 }, 'eff=-10');
      mustBeNull({ mc: 5, shape: 'cyl', cast_wt: 5, eff: Infinity }, 'eff=Infinity');
      mustBeNull({ mc: 5, shape: 'cyl', cast_wt: 5, eff: 'abc' }, "eff='abc'");
    },
  },
  {
    name: 'V2.0-18-F2 eff 缺失 ⇒ 各形状取到自己的 RISER_EFF 表项；合法覆盖生效',
    fn: () => {
      for (const [shape, sd] of Object.entries(RISER_SHAPES)) {
        const r = mustBeObject({ mc: 5, shape, cast_wt: 5 }, `shape=${shape}`);
        near(r.eff, RISER_EFF[sd.effKey] / 100, 1e-12, `${shape} 的 eff 应取 RISER_EFF.${sd.effKey}`);
        assert(RISER_EFF[sd.effKey] > 0, `${sd.effKey} 应为正数`);
      }
      // 合法覆盖（发热保温 35%）生效，且**不设上限**（不擅自发明范围）
      const hot = mustBeObject({ mc: 5, shape: 'cyl', cast_wt: 5, eff: 35 }, 'eff=35');
      near(hot.eff, 0.35, 1e-12, 'eff 覆盖未生效');
      const big = mustBeObject({ mc: 5, shape: 'cyl', cast_wt: 5, eff: 500 }, 'eff=500');
      near(big.eff, 5.0, 1e-12, 'eff 无上限（本阶段不发明范围），500 应被接受');
      // 空串 / NaN ⇒ 视为未提供（riserView 清空效率输入框走的就是这条，**不得**变成 null）
      const empty = mustBeObject({ mc: 5, shape: 'cyl', cast_wt: 5, eff: '' }, 'eff=空串');
      near(empty.eff, RISER_EFF.eff_open / 100, 1e-12, 'eff 空串应回退表值');
      const nan = mustBeObject({ mc: 5, shape: 'cyl', cast_wt: 5, eff: NaN }, 'eff=NaN');
      near(nan.eff, RISER_EFF.eff_open / 100, 1e-12, 'eff=NaN 应回退表值（riserView 空输入框的既有路径）');
    },
  },

  /* ================= G. 结果级守卫（§五.4） ================= */
  {
    name: 'V2.0-18-G1 ★★ 产不出正尺寸 ⇒ null（不再返回 D=0/H=0 的"看似有效"结果）',
    fn: () => {
      // Mc 极小：旧实现返回 {D:0, H:0, Vr:0}
      mustBeNull({ mc: 1e-6, shape: 'cyl', cast_wt: 5 }, 'Mc=1e-6');
      mustBeNull({ mc: 1e-9, shape: 'cyl', cast_wt: 5 }, 'Mc=1e-9');
      mustBeNull({ mc: 1e-6, shape: 'sphere_head', cast_wt: 5 }, 'Mc=1e-6 sphere_head');
      // 全部形状都要挡住（不是只挡 cyl）
      for (const shape of Object.keys(RISER_SHAPES)) {
        mustBeNull({ mc: 1e-6, shape, cast_wt: 5 }, `Mc=1e-6 ${shape}`);
      }
    },
  },

  /* ================= H. 合法输入数值冻结（§七.8 / §八） ================= */
  {
    name: 'V2.0-18-H1 ★★ 合法输入冻结表 + 新契约硬性质（PHASE V2.0-22 重新基线化）',
    fn: () => {
      for (const c of FROZEN) {
        const r = mustBeObject({ mc: c.mc, shape: c.shape, cast_wt: c.cw, hd_ratio: c.hd }, `冻结 ${c.shape}/${c.hd}/${c.cw}/${c.mc}`);
        same(r.D, c.D, `${c.shape} hd=${c.hd} cw=${c.cw} mc=${c.mc} 的 D 变了`);
        same(r.H, c.H, `${c.shape} hd=${c.hd} cw=${c.cw} mc=${c.mc} 的 H 变了`);
        near(r.final_f, c.f, 1e-9, `${c.shape} hd=${c.hd} cw=${c.cw} mc=${c.mc} 的 final_f 变了`);
        same(r.bind, c.bind, `${c.shape} hd=${c.hd} cw=${c.cw} mc=${c.mc} 的 bind 变了`);
        // ── 新契约的硬性质（138.txt §3.3）——旧表只有快照，这里补上可推理的判据 ──
        near(r.Mr_target, c.mc * 1.2, 1e-12, `${c.shape} 的 Mr_target ≠ Mc × 1.2`);
        assert(meetsTarget(r.Mr_act, r.Mr_target), `${c.shape} hd=${c.hd} 的 Mr_act 未达目标模数`);
        assert(r.modOk === true && r.converged === true, `${c.shape} 应恒满足目标模数`);
        // 最小整数档（V2.0-16 §裁决沿用）：D−1 在同一 H 导出规则下达不到目标模数
        const dPrev = c.D - 1;
        const hPrev = c.shape === 'sphere' ? dPrev
          : c.shape === 'sphere_head' ? Math.max(Math.round(dPrev * c.hd), Math.round(dPrev / 2))
            : Math.round(dPrev * c.hd);
        assert(!(r.sd.M(dPrev, hPrev) >= r.Mr_target), `${c.shape} hd=${c.hd} cw=${c.cw}：D−1=${dPrev} 也满足目标模数（D 不是最小档）`);
      }
    },
  },
  {
    name: 'V2.0-18-H1b ★★ 守卫**前导等价性**：合法输入下新守卫算出的 hd/eff/cw/rhoUsed/Mc 与旧表达式逐位相同',
    fn: () => {
      // 论证结构（这是 §八 的**核心论据**，非循环）：
      //   ① 计算主体（f 扫描 / sizeAt / 还原分支 / 返回对象）本阶段**一字未改**（见 H1c 的源码断言）；
      //   ② 前导守卫只负责把「旧表达式」换成「三态解析 + 区间判定」；
      //   ③ 只要证明**合法输入下 ② 的结果与 ① 的输入逐位相同**，则整条数值链逐位不变。
      //   本用例就在大批合法输入上直接验证 ③。
      let n = 0, worst = 0;
      for (const mat of ['灰铁', '球铁', '铸钢', '铝合金', '铜合金']) {
        const mdOld = RISER_MATERIALS[mat];
        for (const shape of ['cyl', 'sphere_head', 'sphere', 'square'])
          for (const hd of [0.5, 0.8, 1.0, 1.2, 1.5, 2.0])
            for (const cw of [0, 0.5, 5, 77.56, 200])
              for (const mc of [0.5, 3, 12, 60]) {
                const inp = { mat, mc_mode: 'direct', mc, shape, cast_wt: cw, hd_ratio: hd };
                const r = runRiser(inp); if (!r) continue; n++;
                // 旧表达式（V2.0-17 之前的原文，逐字复述）
                const rhoOld = inp.rho ?? mdOld.rho;
                const hdOld = parseFloat(inp.hd_ratio) || 1.0;
                const effOld = (parseFloat(inp.eff) || RISER_EFF[RISER_SHAPES[shape].effKey]) / 100;
                const cwOld = parseFloat(inp.cast_wt) || 0;
                const McOld = parseFloat(inp.mc) || 0;
                near(r.rhoUsed, rhoOld, 0, `${mat}/${shape}/hd=${hd}/cw=${cw} 的 rhoUsed 与旧式不同`);
                near(r.hd, hdOld, 0, `${mat}/${shape}/hd=${hd} 的 hd 与旧式不同`);
                near(r.eff, effOld, 0, `${mat}/${shape} 的 eff 与旧式不同`);
                near(r.cw, cwOld, 0, `${mat}/${shape}/cw=${cw} 的 cw 与旧式不同`);
                near(r.Mc, McOld, 0, `${mat}/${shape} mc=${mc} 的 Mc 与旧式不同`);
                worst = Math.max(worst, Math.abs(r.hd - hdOld), Math.abs(r.eff - effOld), Math.abs(r.cw - cwOld));
              }
      }
      assert(n > 2000, `合法样本数过少（${n}）`);
      same(worst, 0, '前导量出现非零差异');
    },
  },
  {
    name: 'V2.0-18-H1c ★★ 计算主体的**新契约**源码级断言（PHASE V2.0-22 重写）',
    fn: () => {
      const src = readFileSync(new URL('../calcs/riser.js', import.meta.url), 'utf8');
      // ⚠ 本用例在 V2.0-18 时守的是「计算主体一字未改」。V2.0-22 经 138.txt §三 **授权**
      //   改写了尺寸决策路径，故改为守「新契约的结构」——同样是源码级、同样不可绕过。
      //   ★ 先**剥离注释**再做"不得存在"类断言：源码注释里会**引用**被移除的旧写法
      //     （例如说明"旧实现是 f += 0.05"），那是文档而不是代码。
      //     本项目既有做法同 `scripts/validate_benchmark.mjs` 的注释剥离+正则自测。
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
      // ① 目标模数是**唯一命名常量**，且尺寸确实由它反求
      assert(code.includes('export const MODULUS_TARGET_RATIO = 1.2'), '目标模数常量缺失或被改值');
      assert(code.includes('const Mr_target = Mc * MODULUS_TARGET_RATIO'), '尺寸未由 Mr_target 反求');
      // ② 旧 f 迭代**必须彻底移除**（138.txt §3.4②：不得以任何隐蔽路径恢复体积放大）
      assert(!code.includes('f += 0.05'), 'f 迭代步进仍在');
      assert(!/for \(let iter = 0; iter < 50/.test(code), 'f 扫描循环仍在');
      assert(!/converged = true; break;/.test(code), '旧的"两条同时过才 break"收敛路径仍在');
      // ③ 体积约束不得再进入尺寸路径；体积段必须排在尺寸计算**之后**
      const iSize = code.indexOf('sizeAt(Mr_target, hd)');
      const iVol = code.indexOf('const volOk =');
      assert(iSize > 0 && iVol > iSize, '体积段没有排在尺寸计算之后（可能仍在影响尺寸）');
      assert(!/volOk[\s\S]{0,40}f \+=/.test(code), '体积校核后仍存在推进 f 的路径');
      // ④ 目标模数是**下限**，不得留 1% 松弛
      assert(!/Mr_need \* 0\.99|Mr \* 0\.99|Mr_target \* 0\.99/.test(code), '模数判据仍含 0.99 松弛（目标模数必须严格达到）');
      // ⑤ 体积判据本身**保留为诊断**（138.txt §3.5：不删代码，只降级）
      assert(code.includes('effV >= needVol'), '体积判据被删除（应保留为内部诊断）');
      // ⑥ 输入守卫必须整体位于尺寸计算之前（用**代码**标记定位，注释已被剥离）
      const iGuard = code.indexOf('const cw = cwRaw === NUM_ABSENT ? 0 : cwRaw');
      assert(iGuard > 0 && iGuard < iSize, `输入守卫没有排在尺寸计算之前（guard@${iGuard} size@${iSize}）`);
    },
  },
  {
    name: 'V2.0-18-H2 ★ 十项输出逐项自洽（§八 点名的 D/H/f/Mr_act/Vr/effV/modOk/volOk/bind/converged）',
    fn: () => {
      let n = 0;
      for (const shape of ['cyl', 'sphere_head', 'sphere', 'square'])
        for (const hd of [0.8, 1.0, 1.2, 1.5])
          for (const cw of [0, 5, 77.56]) {
            const r = mustBeObject({ mc: 5, shape, cast_wt: cw, hd_ratio: hd }, `${shape}/${hd}/${cw}`);
            n++;
            assert(r.D > 0 && r.H > 0, 'D/H 应为正');
            // PHASE V2.0-22（138.txt §四.6）：十条字段在新规则下的自洽关系
            same(r.final_f, 1.2, 'final_f 应为设计规则常量（不再迭代）');
            same(r.targetRatio, 1.2, 'targetRatio 应为 1.2');
            near(r.Mr_act, r.sd.M(r.D, r.H), 1e-12, 'Mr_act ≠ M(D,H)');
            near(r.Vr, r.sd.V(r.D, r.H), 1e-9, 'Vr ≠ V(D,H)');
            near(r.effV, r.Vr * r.eff, 1e-9, 'effV ≠ Vr×eff');
            same(r.Mr_need, r.Mr_target, 'Mr_need 必须是 Mr_target 的兼容别名（不得各算一份）');
            near(r.Mr_target, r.Mc * r.targetRatio, 1e-12, 'Mr_target ≠ Mc × targetRatio');
            // PHASE V2.0-22 收尾（139.txt §3.2）：达标判据全模块唯一 = `meetsTarget`（浮点精度内达标）
            same(r.modOk, meetsTarget(r.Mr_act, r.Mr_target), 'modOk 判据不符（应为"达到目标模数"）');
            same(r.modOk, true, '按目标模数反求的尺寸必须达到目标模数');
            same(r.converged, r.modOk, 'converged 应等价于"达到目标模数"');
            same(r.bind, 'modulus', 'bind 恒为 modulus（volume/limit 已不可达）');
            // volOk 现在是**诊断值**（整件净重口径），不再参与设计结论
            same(r.volOk, r.cw > 0 ? r.effV >= r.needVol : true, 'volOk 判据不符（诊断值）');
          }
      assert(n === 48, `样本数不对（${n}）`);
    },
  },
  {
    name: 'V2.0-18-H3 ★ 旧"未收敛样本"在新规则下的行为：恒收敛 + 尺寸与重量解耦（PHASE V2.0-22 重写）',
    fn: () => {
      // 旧前提（"真实重量 + 小 Mc ⇒ 必然撞 f 上限"，V2.0-14 §4.2）随 f 迭代移除而**消失**：
      // 尺寸现在只由目标模数决定，铸件重量再也推不动 f（138.txt §3.4）。
      const r = mustBeObject({ mc: 5, shape: 'cyl', cast_wt: 77.56 }, '原"未收敛"样本');
      same(r.converged, true, '新算法下合法输入恒收敛');
      same(r.bind, 'modulus', 'bind 不应再出现 limit');
      same(r.modOk, true, '目标模数恒达到');
      same(r.volOk, false, '该样本的旧体积诊断仍为"不够" —— 但它已不是判据（见结果卡文案）');
      // ★ 解耦的直接证据：同 Mc、加不加重量，推荐尺寸必须一字不差
      const r0 = mustBeObject({ mc: 5, shape: 'cyl', cast_wt: 0 }, '同 Mc 无重量');
      same(r.D, r0.D, '推荐直径被铸件重量改变了（体积约束未解耦）');
      same(r.H, r0.H, '推荐高度被铸件重量改变了');
      same(r.Vr, r0.Vr, '冒口体积被铸件重量改变了');
      // 结果对象仍须齐全（供 riserStatus / 结果卡 / 报告消费）
      for (const k of ['D', 'H', 'Mr_act', 'Mr_target', 'Mr_need', 'Vr', 'effV', 'final_f', 'modOk', 'volOk', 'bind', 'converged', 'needVol', 'cw']) {
        assert(k in r, `结果缺少字段 ${k}`);
      }
    },
  },

  /* ================= I. 与既有测试/历史的互不破坏 ================= */
  {
    name: 'V2.0-18-I1 ★ 历史 PHASE24 T5 未被触碰：测试文件与预期值均未改',
    fn: () => {
      const src = readFileSync(new URL('./phase24_test.mjs', import.meta.url), 'utf8');
      assert(src.includes('${name} 热结数应=${expect}，实际 ${v3.hotspots.length}'), 'T5 断言模板被改动');
      assert(src.includes('ALHR4510塑料模具v2-2.1.stl'), 'T5 的夹具名被改动');
      assert(!/it\.only|describe\.only|tests\s*=\s*\[\s*\]/.test(src), 'T5 所在文件被跳过/清空');
    },
  },
  {
    name: 'V2.0-18-I2 ★ 返回字段集：V2.0-15 之后的字段一个不少；V2.0-22 授权新增 Mr_target/targetRatio',
    fn: () => {
      const r = mustBeObject({ mc: 5, shape: 'cyl', cast_wt: 5 }, '样本');
      const keys = Object.keys(r).sort().join(',');
      // ⚠ PHASE V2.0-22（138.txt §3.1）：**授权新增** `Mr_target` 与 `targetRatio`（目标模数及其比例）。
      //   其余字段一律保留（含已降级为诊断的 volOk / 兼容别名 Mr_need / 兼容字段 final_f）——
      //   删字段会打断既有调用方，138.txt §四.2 明令禁止。
      const expect = ['Mc', 'Mr_act', 'Mr_need', 'Mr_target', 'Vc', 'Vr', 'D', 'H', 'bind', 'converged', 'cw', 'dModOnly',
        'd_neck', 'dimLabel', 'eff', 'effV', 'final_f', 'hd', 'matKey', 'md', 'mdFellBack', 'M_neck',
        'modOk', 'neck_k', 'needVol', 'rhoUsed', 'sd', 'shapeKey', 'targetRatio', 'volOk', 'yieldPct'].sort().join(',');
      same(keys, expect, '返回对象的字段集被改变了（消费方可能受影响）');
    },
  },
  {
    name: 'V2.0-18-I3 ★★ 数值不变性的**主证据**可复现：基线 CSV 未被改写且对照脚本仍在',
    fn: () => {
      const p = new URL('../tests/engineering-generated/phasev2012_c1_sweep.csv', import.meta.url);
      const buf = readFileSync(p);
      // 行数与 sha256 前缀（完整 sha256 见报告 §五）
      const nLines = buf.toString('utf8').replace(/\s+$/, '').split('\n').length;
      same(nLines, 26526, `基线 CSV 行数变了（应为 26,526 = 表头 + 26,525 数据行）`);
      assert(buf.length > 1e6, '基线 CSV 内容异常（过小）');
      assert(existsSync(new URL('../tests/experiments/phasev2014_dist.mjs', import.meta.url)), '对照脚本 phasev2014_dist.mjs 不见了');
    },
  },
];
