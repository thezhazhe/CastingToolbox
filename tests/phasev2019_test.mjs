// ============================================================
// PHASE V2.0-19（130.txt §六）· `calcs/riserDreq.js` 专属测试
//
//   本阶段**新增**一个独立纯计算模块，**没有**修改 `calcs/riser.js` / `js/engine/**` /
//   任何现有冒口计算流程。所以本套件要钉住三件事：
//     ① 新模块的状态语义与数值字段契约（§3.1 / §五：`status !== 'ok' ⇒ value === null`）；
//     ② 每个成功结果的**体积约束校核 + 最小性**（§6.3）——**独立复刻**几何，不复用模块自己的函数；
//     ③ **独立性**（§6.5）：新模块没有被接进任何生产路径、没有调用 runRiser、现有结果不受影响。
//
//   ★ 校核口径（`hOf` / `vOf` / `okAt`）在**本文件内独立重写一遍**，与 `calcs/riser.js:191-198`
//     和 `:214-215` 同式。若模块内部口径漂移，B 组会立刻变红。
//   ★ 本文件的 20 个用例**会被** `tests/runner.mjs` 统计（文件名匹配 `*_test.mjs` 且导出 `tests`）。
//     实验脚本 `tests/experiments/phasev2019_dreq.mjs` **不会**被统计，两边的数字不得相加。
// ============================================================
import { readFileSync } from 'node:fs';
import { RISER_SHAPES, RISER_MATERIALS, RISER_EFF, runRiser } from '../calcs/riser.js';
import { calculateRiserDreq, riserDreqSizeAt, riserDreqVolumeAt, DREQ_DISCLAIMER } from '../calcs/riserDreq.js';

const assert = (c, m) => { if (!c) throw new Error(m); };
const same = (a, b, m) => { if (a !== b) throw new Error(`${m}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`); };
const SHAPES = ['cyl', 'square', 'sphere', 'sphere_head'];

// ── 独立校核口径（**不复用** riserDreq.js 的导出函数）────────────────────────────
//   H 的规则逐字取自 `calcs/riser.js:191-192`（sphere_head 抬到 r）与 `:196-198`（升档分支）。
const hOf = (D, shape, hd) => {
  let H = Math.round(D * hd);
  if (shape === 'sphere_head') { const r = D / 2; if (H < r) H = Math.round(r); }
  if (shape === 'sphere') H = D;
  return H;
};
const vOf = (D, shape, hd) => RISER_SHAPES[shape].V(D, hOf(D, shape, hd));
// 体积约束逐字取自 `calcs/riser.js:214-215`
const needOf = (cw, rho, shrink) => (cw * 1000000 / rho) * shrink;
const effOf = (shape, effPct) => (effPct === undefined ? RISER_EFF[RISER_SHAPES[shape].effKey] : effPct) / 100;
const okAt = (D, shape, hd, eff, needVol) => vOf(D, shape, hd) * eff >= needVol;

/** 递归断言：对象里任何数值字段都不得是 NaN / ±Infinity（§6.4「不存在非预期的 NaN/Infinity 数值字段」）。 */
function assertFiniteNumbers(o, path = '$') {
  for (const [k, v] of Object.entries(o || {})) {
    if (typeof v === 'number') {
      assert(Number.isFinite(v), `${path}.${k} = ${v} 不是有限数`);
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      assertFiniteNumbers(v, `${path}.${k}`);
    }
  }
}
const recall = (r) => ({ shape: r.used.shape, hd: r.used.hd, eff: r.used.eff, needVol: r.search.needVol, rho: r.used.rho, cw: r.used.cw });

// 常用样本（§6.1：多形状 / 多 hd / 多 cw / 多 rho）
const SAMPLES = [];
for (const shape of SHAPES) {
  for (const hd of [0.3, 0.8, 1.0, 1.5, 2.0]) {
    for (const cw of [0.5, 5, 50]) SAMPLES.push({ shape, hd_ratio: hd, cast_wt: cw, mat: '球铁' });
  }
}

export const tests = [

  // ══════════════════ A 组 · 正常输入（§6.1） ══════════════════
  {
    name: 'A1 四种形状 × 多 hd/cw 全部返回 ok，且字段类型正确',
    fn: () => {
      for (const s of SAMPLES) {
        const r = calculateRiserDreq(s);
        same(r.status, 'ok', `${s.shape} hd=${s.hd_ratio} cw=${s.cast_wt} 应成功`);
        assert(Number.isInteger(r.value) && r.value >= 1, `value 应为正整数（得到 ${r.value}）`);
        assert(Number.isInteger(r.height) && r.height >= 1, `height 应为正整数（得到 ${r.height}）`);
        // ⚠ 唯一允许 continuous/gap 为 null 的成功情形：sphere_head 且 hd < 0.5（§4.2 无定义域）
        if (s.shape === 'sphere_head' && s.hd_ratio < 0.5) {
          same(r.continuous, null, `${s.shape} hd=${s.hd_ratio}<0.5：continuous 应为 null`);
          same(r.gap, null, `${s.shape} hd=${s.hd_ratio}<0.5：gap 应为 null`);
        } else {
          assert(r.continuous !== null && r.gap !== null,
            `${s.shape} hd=${s.hd_ratio}：该情形应提供 continuous/gap`);
        }
        same(r.reason, null, '成功时 reason 应为 null');
        assert(Array.isArray(r.assumptions) && r.assumptions.length > 0, 'assumptions 应为非空数组');
        assert(typeof r.basis === 'string' && r.basis.includes('不代表实际补缩保证'), 'basis 必须声明不代表补缩保证');
        assertFiniteNumbers(r);
      }
    },
  },
  {
    name: 'A2 gap === value − continuous，且连续解与整数解同号同量级',
    fn: () => {
      let n = 0;
      for (const s of SAMPLES) {
        const r = calculateRiserDreq(s);
        if (r.continuous === null) continue;
        n++;
        assert(Math.abs(r.gap - (r.value - r.continuous)) < 1e-9, `gap 应等于 value − continuous（${s.shape} hd=${s.hd_ratio}）`);
        assert(r.continuous > 0, `连续解应为正（${r.continuous}）`);
      }
      assert(n > 40, `应有多数样本提供连续解，实际 ${n}/${SAMPLES.length}`);
    },
  },
  {
    name: 'A3 used / search 自洽：effV ≥ needVol，且 used 反映实际取值',
    fn: () => {
      const r = calculateRiserDreq({ shape: 'cyl', cast_wt: 5, hd_ratio: 0.8, eff: 20, rho: 7.8, mat: '铸钢' });
      same(r.status, 'ok');
      same(r.used.hd, 0.8, 'used.hd 应为传入值');
      same(r.used.effPct, 20, 'used.effPct 应为传入的百分数');
      same(r.used.rho, 7.8, 'used.rho 应为显式传入的密度');
      same(r.used.shrink, RISER_MATERIALS.铸钢.shrink, 'shrink 应来自材料表');
      assert(r.search.effV >= r.search.needVol, 'search.effV 应 ≥ needVol');
      assert(r.search.ok === true, 'search.ok 应为真');
      same(r.search.Vr, vOf(r.value, 'cyl', 0.8), 'search.Vr 应等于独立复刻的体积');
      // eff 缺省 ⇒ 用形状对应的表值（《铸造手册》）
      const r2 = calculateRiserDreq({ shape: 'sphere_head', cast_wt: 1 });
      same(r2.used.effPct, RISER_EFF.eff_sph, 'sphere_head 的缺省效率应为 eff_sph');
      const r3 = calculateRiserDreq({ shape: 'square', cast_wt: 1 });
      same(r3.used.effPct, RISER_EFF.eff_open, 'square 的缺省效率应为 eff_open');
      const r4 = calculateRiserDreq({ shape: 'sphere', cast_wt: 1 });
      same(r4.used.effPct, RISER_EFF.eff_blind, 'sphere 的缺省效率应为 eff_blind');
      // hd 缺省 ⇒ 1.0（calcManifest.js:280 的硬编码约定）
      same(calculateRiserDreq({ shape: 'cyl', cast_wt: 1 }).used.hd, 1.0, 'hd 缺省应为 1.0');
    },
  },

  // ══════════════════ B 组 · 体积约束校核 + 最小性（§6.3，核心） ══════════════════
  {
    name: 'B1 每个成功样本：返回的 D 满足约束，且所有更小的整数直径都不满足',
    fn: () => {
      let scanned = 0, worst = 0;
      for (const s of SAMPLES) {
        const r = calculateRiserDreq(s);
        same(r.status, 'ok');
        const hd = r.used.hd, eff = r.used.eff, need = r.search.needVol;
        assert(okAt(r.value, s.shape, hd, eff, need), `${s.shape} hd=${hd} cw=${s.cast_wt}：D=${r.value} 应满足约束`);
        for (let d = 1; d < r.value; d++) {
          assert(!okAt(d, s.shape, hd, eff, need),
            `${s.shape} hd=${hd} cw=${s.cast_wt}：D=${d} < ${r.value} 也满足 ⇒ 最小性被破坏`);
          scanned++; worst = Math.max(worst, d);
        }
        assert(r.height === hOf(r.value, s.shape, hd), 'height 应与独立复刻的 H 一致');
      }
      assert(scanned > 1000, `应完成足量回扫（实际 ${scanned} 个更小直径）`);
    },
  },
  {
    name: 'B2 各形状独立回扫：min 性不依赖模块自身的 satisfies',
    fn: () => {
      // 每种形状各挑一个，用小到大扫到刚好满足，验证与模块输出**同时**命中
      for (const shape of SHAPES) {
        const r = calculateRiserDreq({ shape, cast_wt: 3, hd_ratio: 0.9 });
        same(r.status, 'ok');
        const eff = r.used.eff, need = r.search.needVol;
        let first = 0;
        for (let d = 1; d <= r.value; d++) if (okAt(d, shape, 0.9, eff, need)) { first = d; break; }
        same(first, r.value, `${shape}：独立全扫得到的最小 D 应与模块一致`);
      }
    },
  },
  {
    name: 'B3 成功结果中不出现 NaN / Infinity / 非正尺寸',
    fn: () => {
      for (const s of SAMPLES) {
        const r = calculateRiserDreq(s);
        assertFiniteNumbers(r);
        assert(r.value > 0 && r.height > 0, '尺寸必须为正');
        assert(Number.isFinite(r.search.Vr) && r.search.Vr > 0, 'Vr 应为正有限数');
        assert(!Object.values(r).some(v => typeof v === 'number' && Number.isNaN(v)), '不得有 NaN 字段');
      }
    },
  },
  {
    name: 'B4 大 cw / 小 cw 两端的解单调且仍满足最小性（含完整回扫）',
    fn: () => {
      let prev = 0;
      for (const cw of [0.01, 0.1, 1, 10, 100, 1000]) {
        const r = calculateRiserDreq({ shape: 'cyl', cast_wt: cw, hd_ratio: 1 });
        same(r.status, 'ok', `cw=${cw} 应成功`);
        assert(r.value >= prev, `D_req 应随 cw 单调不减（cw=${cw} 得 ${r.value}，上一档 ${prev}）`);
        assert(okAt(r.value, 'cyl', 1, r.used.eff, r.search.needVol), `cw=${cw}：D=${r.value} 应满足`);
        assert(!okAt(r.value - 1, 'cyl', 1, r.used.eff, r.search.needVol), `cw=${cw}：D=${r.value - 1} 不应满足`);
        prev = r.value;
      }
    },
  },

  // ══════════════════ C 组 · 特殊几何（§6.2） ══════════════════
  {
    name: 'C1 hd = 0.5 精确边界：four 形状均成功且最小性成立',
    fn: () => {
      for (const shape of SHAPES) {
        const r = calculateRiserDreq({ shape, cast_wt: 2, hd_ratio: 0.5 });
        same(r.status, 'ok', `${shape} hd=0.5 应成功`);
        assert(okAt(r.value, shape, 0.5, r.used.eff, r.search.needVol), `${shape}：D=${r.value} 应满足`);
        assert(!okAt(r.value - 1, shape, 0.5, r.used.eff, r.search.needVol), `${shape}：D=${r.value - 1} 不应满足`);
      }
      // sphere_head 在 hd=0.5 时连续式**恰好成立**（探针 P2 实测相对误差 0.0000%）
      const r = calculateRiserDreq({ shape: 'sphere_head', cast_wt: 2, hd_ratio: 0.5 });
      assert(r.continuous !== null, 'sphere_head hd=0.5 应提供连续解');
      assert(Math.abs(r.gap) < 1, `hd=0.5 时整数化差距应 < 1mm（实测 ${r.gap}）`);
    },
  },
  {
    name: 'C2 hd 在 0.5 两侧（0.49 / 0.4999 / 0.5 / 0.5001 / 0.51）行为分明',
    fn: () => {
      const sides = [0.49, 0.4999, 0.5, 0.5001, 0.51];
      for (const hd of sides) {
        for (const shape of ['sphere_head', 'cyl']) {
          const r = calculateRiserDreq({ shape, cast_wt: 2, hd_ratio: hd });
          same(r.status, 'ok', `${shape} hd=${hd} 应成功`);
          assert(okAt(r.value, shape, hd, r.used.eff, r.search.needVol), `${shape} hd=${hd}：D 应满足`);
          assert(!okAt(r.value - 1, shape, hd, r.used.eff, r.search.needVol), `${shape} hd=${hd}：D−1 不应满足`);
        }
      }
      // ★ hd < 0.5 时 sphere_head **不得**提供连续解（§4.2；探针 P2：hd=0.49 时朴素式已偏 3%）
      for (const hd of [0.49, 0.4999]) {
        same(calculateRiserDreq({ shape: 'sphere_head', cast_wt: 2, hd_ratio: hd }).continuous, null,
          `sphere_head hd=${hd}<0.5 的 continuous 必须为 null`);
      }
      // hd ≥ 0.5 时提供
      for (const hd of [0.5, 0.5001, 0.51]) {
        assert(calculateRiserDreq({ shape: 'sphere_head', cast_wt: 2, hd_ratio: hd }).continuous !== null,
          `sphere_head hd=${hd}≥0.5 应提供 continuous`);
      }
      // 其余三形状不受 hd=0.5 分界影响
      for (const shape of ['cyl', 'square', 'sphere']) {
        assert(calculateRiserDreq({ shape, cast_wt: 2, hd_ratio: 0.3 }).continuous !== null,
          `${shape} 在 hd<0.5 时仍应提供连续解`);
      }
    },
  },
  {
    name: 'C3 sphere_head 的奇数直径与偶数直径：H 分别取 round(D/2) 与 D/2',
    fn: () => {
      const odd = [], even = [];
      for (let i = 1; i <= 120 && (odd.length < 3 || even.length < 3); i++) {
        const r = calculateRiserDreq({ shape: 'sphere_head', cast_wt: i * 0.05, hd_ratio: 0.3 });
        if (r.status !== 'ok') continue;
        (r.value % 2 ? odd : even).push(r);
      }
      assert(odd.length >= 3 && even.length >= 3, `应同时取到奇偶两种直径（奇 ${odd.length} / 偶 ${even.length}）`);
      for (const r of odd) {
        same(r.height, Math.round(r.value / 2), `奇数 D=${r.value}：H 应为 round(D/2)`);
        assert(r.height > r.value / 2, `奇数 D=${r.value}：round(D/2) 应大于 D/2（半球体积被撑大）`);
      }
      for (const r of even) same(r.height, r.value / 2, `偶数 D=${r.value}：H 应为 D/2`);
      // 两种情形都必须满足最小性
      for (const r of [...odd, ...even]) {
        assert(!okAt(r.value - 1, 'sphere_head', 0.3, r.used.eff, r.search.needVol), `D=${r.value}：D−1 不应满足`);
      }
    },
  },
  {
    name: 'C4 H 舍入跳变点附近：连续扫 40 档 cw，每档都通过完整最小性校核',
    fn: () => {
      let flips = 0, prevH = null;
      for (let i = 1; i <= 40; i++) {
        const cw = i * 2.5;
        const r = calculateRiserDreq({ shape: 'cyl', cast_wt: cw, hd_ratio: 0.7 });
        same(r.status, 'ok', `cw=${cw} 应成功`);
        assert(r.height === hOf(r.value, 'cyl', 0.7), `cw=${cw}：H 应为 round(D×0.7)`);
        assert(okAt(r.value, 'cyl', 0.7, r.used.eff, r.search.needVol), `cw=${cw}：D 应满足`);
        assert(!okAt(r.value - 1, 'cyl', 0.7, r.used.eff, r.search.needVol), `cw=${cw}：D−1 不应满足`);
        const frac = (r.value * 0.7) % 1;
        if (prevH !== null && r.height !== prevH) flips++;
        prevH = r.height;
      }
      assert(flips > 5, `本段应跨越多个 H 跳变点（实际 ${flips} 次）`);
    },
  },
  {
    name: 'C5 四种形状在同一 cw 下的体积/直径差异符合各自几何',
    fn: () => {
      const cw = 10;
      const rs = SHAPES.map(shape => calculateRiserDreq({ shape, cast_wt: cw, hd_ratio: 1 }));
      for (const r of rs) same(r.status, 'ok');
      // 同一 cw 下各形状所需**体积**应一致（都等于 needVol/eff 的量级），但直径因几何而不同
      const vols = rs.map(r => r.search.Vr);
      for (const v of vols) assert(Number.isFinite(v) && v > 0, 'Vr 应为正');
      // cylinder 与 square 的断面积系数不同（π/4 vs 1）⇒ square 的边长应更小
      const cyl = rs[0], sq = rs[1];
      assert(sq.value < cyl.value, `正方柱边长应答小于等体积圆柱直径（${sq.value} vs ${cyl.value}）`);
      // 球形没有 H 自由度，直径由 4/3πr³ 单独决定
      const sp = rs[2];
      assert(sp.height === sp.value, '球形 H 应恒等于 D');
      assert(okAt(sp.value, 'sphere', 1, sp.used.eff, sp.search.needVol), '球形解应满足');
      assert(!okAt(sp.value - 1, 'sphere', 1, sp.used.eff, sp.search.needVol), '球形 D−1 不应满足');
    },
  },

  // ══════════════════ D 组 · 非法输入（§6.4） ══════════════════
  {
    name: 'D1 非法数值输入一律 invalid_input，且 value === null',
    fn: () => {
      const bad = [
        ['cw=Infinity', { shape: 'cyl', cast_wt: Infinity }],
        ['cw=−Infinity', { shape: 'cyl', cast_wt: -Infinity }],
        ['cw=−5', { shape: 'cyl', cast_wt: -5 }],
        ['cw=NaN', { shape: 'cyl', cast_wt: NaN }],
        ['cw="abc"', { shape: 'cyl', cast_wt: 'abc' }],
        ['cw="5abc"', { shape: 'cyl', cast_wt: '5abc' }],
        ['hd=0', { shape: 'cyl', cast_wt: 5, hd_ratio: 0 }],
        ['hd=−1', { shape: 'cyl', cast_wt: 5, hd_ratio: -1 }],
        ['hd=NaN', { shape: 'cyl', cast_wt: 5, hd_ratio: NaN }],
        ['hd=Infinity', { shape: 'cyl', cast_wt: 5, hd_ratio: Infinity }],
        ['rho=0', { shape: 'cyl', cast_wt: 5, rho: 0 }],
        ['rho=−7', { shape: 'cyl', cast_wt: 5, rho: -7 }],
        ['rho=NaN', { shape: 'cyl', cast_wt: 5, rho: NaN }],
        ['rho=Infinity', { shape: 'cyl', cast_wt: 5, rho: Infinity }],
        ['eff=0', { shape: 'cyl', cast_wt: 5, eff: 0 }],
        ['eff=−14', { shape: 'cyl', cast_wt: 5, eff: -14 }],
        ['eff=Infinity', { shape: 'cyl', cast_wt: 5, eff: Infinity }],
        ['shape=缺失', { cast_wt: 5 }],
        ['shape="圆锥"', { shape: '圆锥', cast_wt: 5 }],
        ['shape=null', { shape: null, cast_wt: 5 }],
      ];
      for (const [label, inp] of bad) {
        const r = calculateRiserDreq(inp);
        same(r.status, 'invalid_input', `${label} 应为 invalid_input（得到 ${r.status}）`);
        same(r.value, null, `${label}：value 必须为 null`);
        same(r.height, null, `${label}：height 必须为 null`);
        same(r.continuous, null, `${label}：continuous 必须为 null`);
        same(r.gap, null, `${label}：gap 必须为 null`);
        assert(typeof r.reason === 'string' && r.reason.length > 0, `${label} 应给出非空 reason`);
        assertFiniteNumbers(r);
      }
    },
  },
  {
    name: 'D2 原型链属性名不抛异常、不被误认为合法形状（§五）',
    fn: () => {
      for (const s of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
        const r = calculateRiserDreq({ shape: s, cast_wt: 5 });
        same(r.status, 'invalid_input', `shape=${s} 应为 invalid_input`);
        same(r.value, null, `shape=${s}：value 应为 null`);
      }
      // mat 走**回退**语义（与 calcs/riser.js:127 一致），不抛异常、且显式标记
      for (const m of ['constructor', '__proto__', 'toString', '不存在的材料']) {
        const r = calculateRiserDreq({ shape: 'cyl', cast_wt: 5, mat: m });
        same(r.status, 'ok', `mat=${m} 应按既有语义回退而不是失败`);
        same(r.used.matFellBack, true, `mat=${m}：matFellBack 必须为 true`);
        same(r.used.mat, '球铁', `mat=${m}：应回退到球铁`);
        assert(r.assumptions.some(a => a.includes(String(m))), `mat=${m}：assumptions 应记录回退的原始键`);
      }
      // 合法材料不得被标记为回退
      for (const m of Object.keys(RISER_MATERIALS)) {
        same(calculateRiserDreq({ shape: 'cyl', cast_wt: 5, mat: m }).used.matFellBack, false, `mat=${m} 不应回退`);
      }
    },
  },
  {
    name: 'D3 失败原因彼此可区分（invalid_input / not_applicable / unsupported）',
    fn: () => {
      const kinds = {
        invalid_input: calculateRiserDreq({ shape: 'cyl', cast_wt: -1 }),
        not_applicable: calculateRiserDreq({ shape: 'cyl', cast_wt: 0 }),
      };
      for (const [k, r] of Object.entries(kinds)) same(r.status, k, `状态应为 ${k}`);
      // 三者不得混为一谈：reason 文本必须各不相同
      const reasons = Object.values(kinds).map(r => r.reason);
      same(new Set(reasons).size, reasons.length, '不同失败原因应有不同 reason');
      // 所有失败路径共同的硬契约
      for (const r of Object.values(kinds)) same(r.value, null, `${r.status}：value 必须为 null`);
      // unsupported：需求体积换算不出有限值
      const u = calculateRiserDreq({ shape: 'cyl', cast_wt: 1e300, rho: 1e-300 });
      same(u.status, 'unsupported', `溢出输入应为 unsupported（得到 ${u.status}）`);
      same(u.value, null, 'unsupported：value 必须为 null');
      assertFiniteNumbers(u);
    },
  },
  {
    name: 'D4 任何 status ≠ ok 的返回都满足 value === null（含极端与随机输入）',
    fn: () => {
      const inputs = [
        {}, { shape: 'cyl' }, { shape: 'sphere' }, { shape: 'sphere_head', cast_wt: 0 },
        { shape: 'square', cast_wt: 0, hd_ratio: 0 }, { shape: 'cyl', cast_wt: '  ' },
        { shape: 'cyl', cast_wt: null }, { shape: 'cyl', cast_wt: undefined, rho: 0 },
        { shape: 'cyl', cast_wt: 5, hd_ratio: '  ' }, { shape: 'cyl', cast_wt: 5, hd_ratio: '' },
        { shape: 'cyl', cast_wt: 5, eff: '' }, { shape: 'cyl', cast_wt: 5, eff: 'abc' },
        { shape: 'cyl', cast_wt: 5, eff: 'Infinity' }, { shape: 'cyl', cast_wt: 5, rho: '0' },
      ];
      for (const inp of inputs) {
        const r = calculateRiserDreq(inp);
        if (r.status === 'ok') continue;
        same(r.value, null, `${JSON.stringify(inp)}：status=${r.status} 时 value 必须为 null`);
        same(r.height, null, `${JSON.stringify(inp)}：height 必须为 null`);
        assertFiniteNumbers(r);
      }
      // 空串 / 空白串属于"未提供"⇒ 走默认值，不报错（与 calcs/riser.js 的 readNum 同语义）
      same(calculateRiserDreq({ shape: 'cyl', cast_wt: 5, hd_ratio: '  ' }).status, 'ok', '空白 hd_ratio 应视为未提供');
      same(calculateRiserDreq({ shape: 'cyl', cast_wt: 5, eff: '' }).status, 'ok', '空 eff 应视为未提供并回退表值');
      same(calculateRiserDreq({ shape: 'cyl', cast_wt: '  ' }).status, 'not_applicable', '空白 cast_wt 应视为未提供 ⇒ not_applicable');
      same(calculateRiserDreq({ shape: 'cyl', cast_wt: 5, rho: '0' }).status, 'invalid_input', 'rho="0" 应被判为非法');
    },
  },

  // ══════════════════ E 组 · not_applicable（§3.1 硬要求） ══════════════════
  {
    name: 'E1 cw = 0 或缺失 ⇒ not_applicable，绝不当成"体积约束已满足"',
    fn: () => {
      for (const inp of [
        { shape: 'cyl', cast_wt: 0 },
        { shape: 'cyl' },
        { shape: 'sphere_head', cast_wt: 0, hd_ratio: 1 },
        { shape: 'square', cast_wt: 0, mat: '铸钢' },
      ]) {
        const r = calculateRiserDreq(inp);
        same(r.status, 'not_applicable', `${JSON.stringify(inp)} 应为 not_applicable（得到 ${r.status}）`);
        same(r.value, null, 'not_applicable 时 value 必须为 null');
        assert(r.reason.includes('未启用'), 'reason 应说明体积约束未启用');
      }
    },
  },
  {
    name: 'E2 cw 恰为极小正数时仍应给解（0 与 >0 的分界在正确的位置）',
    fn: () => {
      const r = calculateRiserDreq({ shape: 'cyl', cast_wt: 1e-9, hd_ratio: 1 });
      same(r.status, 'ok', 'cw=1e-9 属于"约束已启用"⇒ 应给解');
      assert(r.value >= 1, '即使需求极小，最小合法整数直径也不小于 1');
      same(r.value, 1, '需求极小时最小整数直径应为 1');
      assert(okAt(1, 'cyl', 1, r.used.eff, r.search.needVol), 'D=1 应满足');
    },
  },

  // ══════════════════ F 组 · 独立性与回归（§6.5） ══════════════════
  {
    name: 'F1 riserDreq.js 不调用 runRiser，也不引入 DOM / 第三方依赖',
    fn: () => {
      const src = readFileSync(new URL('../calcs/riserDreq.js', import.meta.url), 'utf8');
      // ⚠ 必须**剥离注释**再查：文件头写着"不调用 runRiser"的说明，直接 grep 会把自己的注释当违规。
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
      // ⚠ 也不能只查 `runRiser` 这个词：`assumptions` 的**说明文字**里合法地提到它。
      //   真正要禁的是**导入它**或**调用它**。
      assert(!/runRiser\s*\(/.test(code), 'riserDreq.js 不得调用 runRiser（§三「不调用现有 runRiser 来反向搜索结果」）');
      assert(!/\bdocument\b|\bwindow\b|\bHTMLElement\b/.test(code), '不得依赖 DOM / 浏览器全局变量');
      const named = src.match(/import\s*\{([^}]*)\}\s*from\s*'\.\/riser\.js'/);
      const names = named ? named[1].split(',').map(s => s.trim()).filter(Boolean) : [];
      assert(!names.includes('runRiser'), '不得从 riser.js 导入 runRiser');
      same(names.join(','), 'RISER_SHAPES,RISER_MATERIALS,RISER_EFF', `只应导入三张参数表（实际：${names.join(',')}）`);
      const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map(m => m[1]);
      same(imports.join(','), './riser.js', `只应导入 ./riser.js（实际：${imports.join(', ') || '无'}）`);
      // 不得复制参数表：三张表必须来自 riser.js
      assert(!/RISER_SHAPES\s*=\s*\{/.test(src) && !/RISER_MATERIALS\s*=\s*\{/.test(src),
        '不得在 riserDreq.js 里另行定义形状/材料表（会造成参数漂移）');
    },
  },
  {
    name: 'F2 现有 runRiser 的冻结样本（PHASE V2.0-22 重新基线化）；新模块仍未接入任何生产路径',
    fn: () => {
      // 样本集合取自 tests/phasev2018_test.mjs 的 FROZEN 表（该表的 7 条里取 5 条做哨兵引用）。
      // ⚠ PHASE V2.0-22（138.txt §3.4）：尺寸改由目标模数 Mr_target = Mc×1.2 反求，旧体积约束不再决定
      //   尺寸 ⇒ 本表的 D/H/bind/final_f **按新契约重新基线化**（`bind` 恒为 'modulus'、`f` 恒为 1.2）；
      //   实测与 phasev2018 重新基线化后的 FROZEN 表**逐位相同**（跨文件一致性由此多一道护栏）。
      const probe = [
        { shape: 'cyl', hd: 1.0, cw: 0, mc: 5, D: 36, H: 36, f: 1.2, bind: 'modulus' },
        { shape: 'cyl', hd: 0.8, cw: 5, mc: 5, D: 40, H: 32, bind: 'modulus' },
        { shape: 'sphere', hd: 1.0, cw: 5, mc: 5, D: 36, H: 36, bind: 'modulus' },
        { shape: 'square', hd: 1.2, cw: 20, mc: 8, D: 55, H: 66, bind: 'modulus' },
        { shape: 'sphere_head', hd: 0.8, cw: 0.5, mc: 3, D: 24, H: 19, bind: 'modulus' },
      ];
      for (const p of probe) {
        const r = runRiser({ mat: '球铁', mc_mode: 'direct', mc: p.mc, shape: p.shape, hd_ratio: p.hd, cast_wt: p.cw, eff: undefined });
        assert(r, `${p.shape} 应返回结果`);
        same(r.D, p.D, `${p.shape} hd=${p.hd} cw=${p.cw}：D 应与冻结基线一致`);
        same(r.H, p.H, `${p.shape} hd=${p.hd} cw=${p.cw}：H 应与冻结基线一致`);
        same(r.bind, p.bind, `${p.shape}：bind 应为 modulus（尺寸只由目标模数反求）`);
        if (p.f !== undefined) same(r.final_f, p.f, `${p.shape}：f 应与冻结基线一致`);
      }
      // 新模块没有被接进任何生产路径
      for (const f of ['calcs/riser.js', 'js/views/riserView.js', 'js/views/wizard.js', 'calcs/calcManifest.js']) {
        const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
        // PHASE V2.0-22（138.txt §3.4）：`calcs/riser.js` 的新注释会**按名字**提到"与 `calcs/riserDreq.js`
        //   同一条 H 取整规则"，纯注释不是引用 ⇒ 与 F1 同纪律：**剥离注释**再查（判据强度不变：
        //   文件列表不变、正则不变，只是不再把注释文字当违规；代码里 riserDreq 出现次数必须为 0）。
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
        assert(!/riserDreq/.test(code), `${f} 不得引用 riserDreq（§八：不得接入 UI 或任何生产流程）`);
      }
    },
  },
  {
    name: 'F3 D_req 与热节模数 Mc 无关（体积约束式里没有 Mc）',
    fn: () => {
      const base = { shape: 'cyl', cast_wt: 20, hd_ratio: 1, mat: '球铁' };
      const a = calculateRiserDreq({ ...base });
      for (const mc of [0.1, 3, 20, 500]) {
        // 即使显式传入 mc，也不应改变结果（本模块不读它）
        const b = calculateRiserDreq({ ...base, mc, mc_mode: 'direct' });
        same(b.value, a.value, `mc=${mc} 不应改变 D_req`);
        same(b.height, a.height, `mc=${mc} 不应改变 H`);
      }
      // 对照：Mc 确实在影响 runRiser 的推荐尺寸 ⇒ 两者的分工不同
      const ds = [0.5, 3, 20].map(mc => runRiser({ mat: '球铁', mc_mode: 'direct', mc, shape: 'cyl', hd_ratio: 1, cast_wt: 20, eff: undefined }).D);
      assert(new Set(ds).size > 1, `runRiser 的 D 应随 Mc 变化（实测 ${ds.join(' / ')}）⇒ D_req 与推荐尺寸不是同一个量`);
    },
  },
  {
    name: 'F4 模块导出的几何助手与独立复刻一致（口径不漂移）',
    fn: () => {
      for (const shape of SHAPES) {
        for (const hd of [0.3, 0.5, 0.8, 1.0, 1.7, 2.5]) {
          for (const D of [1, 2, 3, 4, 5, 17, 63, 100, 257]) {
            same(riserDreqSizeAt(D, shape, hd), hOf(D, shape, hd), `${shape} hd=${hd} D=${D}：H 口径漂移`);
            const v1 = riserDreqVolumeAt(D, shape, hd), v2 = vOf(D, shape, hd);
            assert(Math.abs(v1 - v2) <= 1e-9 * Math.max(1, Math.abs(v2)), `${shape} hd=${hd} D=${D}：体积口径漂移`);
          }
        }
      }
      // 未知道具形状返回 NaN 而不是抛异常
      assert(Number.isNaN(riserDreqVolumeAt(10, '圆锥', 1)), '未知道具形状的 V 应为 NaN（不抛异常）');
    },
  },
  {
    name: 'F5 免责声明原文存在，且 basis 未把结果说成补缩保证',
    fn: () => {
      same(DREQ_DISCLAIMER,
        'D_req 是满足当前算法体积约束所需的理论直径，不是保证实际铸件不产生缩孔或缩松的工程保证。',
        '§七 要求的声明必须逐字存在');
      const r = calculateRiserDreq({ shape: 'cyl', cast_wt: 5 });
      for (const banned of ['保证不缩孔', '保证补缩成功', '已验证的推荐']) {
        assert(!r.basis.includes(banned) && !r.reason?.includes(banned), `措辞不得出现「${banned}」`);
      }
      assert(r.basis.includes('体积约束'), 'basis 应说明结果对应的是体积约束');
    },
  },
];
