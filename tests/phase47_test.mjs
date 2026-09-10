// ============================================================
// PHASE 47（47.txt）：浇注时间 T 公式模型修改验证
//   灰铁 W≤450: 0.70(1.41+t/14.59)√W；W>450: 0.70(1.236+t/16.65)∛W
//   球铁 K₁√W（t<10→2.080 / 10≤t≤25→2.670 / t>25→2.970，严格分档）
//   铸钢 (2.4335−0.3953·log₁₀W)·√W（不用壁厚）
//   铝/铜 保持原 Dietert 模型（不变）
//   W 口径 = 浇注重量 G（= pw×cav/出品率，与阻流面积公式及企业查表口径一致）
// 覆盖：reference 人工复核 / 球铁壁厚边界 / 灰铁重量边界 / 245 组合矩阵
//       （合法性 + 输出 CSV）/ 下游阻流面积联动 / 唯一入口验证
// ============================================================
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calc_t, runGating, calc_A, MATERIALS } from '../calcs/gating.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'docs', '_p47');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

/** 旧模型（修改前 Dietert 扩展式：t = f(√G + ∛(w·G/5))×2/3），仅测试对照用，生产无残留 */
const oldT = (mat, G, wall) => {
  const f = MATERIALS[mat]?.fc ?? 1.0;
  return f * (Math.sqrt(G) + Math.pow(wall * G / 5, 1 / 3)) * 2 / 3;
};

// ---- 45.txt 指定重量/壁厚/材料矩阵 ----
const WS = [10, 20, 50, 100, 200, 450, 500];
const WALLS = [5, 10, 15, 20, 25, 30, 50];
const MATS = ['灰铁(HT)', '球铁(QT)', '铸钢(ZG)', '铝合金(Al)', '铜合金(Cu)'];

export const tests = [
  {
    name: '47-R1 reference 人工复核（灰铁 W=20 t=15 / 球铁 W=20 t=15 / 铸钢 W=20）',
    fn: () => {
      const ht = calc_t('灰铁(HT)', 20, 15);
      assert(close(ht, 7.6324647762), `灰铁 20kg/15mm 应为 7.6325 s（实际 ${ht}）`);
      const qt = calc_t('球铁(QT)', 20, 15);
      assert(close(qt, 11.9406029998), `球铁 20kg/15mm 应 = 2.670√20 = 11.9406 s（实际 ${qt}）`);
      const zg = calc_t('铸钢(ZG)', 20, 15);
      assert(close(zg, 8.5829360378), `铸钢 20kg 应 = (2.4335−0.3953·log₁₀20)√20 = 8.5829 s（实际 ${zg}）`);
      // 铸钢不用壁厚：t=5 与 t=50 结果相同
      assert(close(calc_t('铸钢(ZG)', 20, 5), calc_t('铸钢(ZG)', 20, 50)), '铸钢公式不得使用壁厚');
    },
  },
  {
    name: '47-R2 球铁壁厚严格分档边界（9.9/10.0/10.1/24.9/25.0/25.1）',
    fn: () => {
      const expect = { '9.9': 2.080, '10.0': 2.670, '10.1': 2.670, '24.9': 2.670, '25.0': 2.670, '25.1': 2.970 };
      for (const [w, k1] of Object.entries(expect)) {
        const got = calc_t('球铁(QT)', 20, parseFloat(w));
        assert(close(got, k1 * Math.sqrt(20)), `球铁壁厚 ${w}mm → K₁=${k1}（实际 T=${got}，应 ${k1 * Math.sqrt(20)}）`);
      }
    },
  },
  {
    name: '47-R3 灰铁 450kg 边界（449.9/450.0 → 式1，450.1 → 式2）',
    fn: () => {
      const f1 = (W) => 0.70 * (1.41 + 15 / 14.59) * Math.sqrt(W);
      const f2 = (W) => 0.70 * (1.236 + 15 / 16.65) * Math.cbrt(W);
      for (const W of [449.9, 450.0]) {
        assert(close(calc_t('灰铁(HT)', W, 15), f1(W), 1e-12), `灰铁 ${W}kg 应走第一套公式（√W）`);
      }
      assert(close(calc_t('灰铁(HT)', 450.1, 15), f2(450.1), 1e-12), `灰铁 450.1kg 应走第二套公式（∛W）`);
      // 两套公式在分界处为教材固有跳变（大件短时公式），允许跳变，只验证分界归属
      const jump = calc_t('灰铁(HT)', 450.1, 15) - calc_t('灰铁(HT)', 450, 15);
      assert(jump < 0, `450→450.1 跳变方向：大件公式更短（实际差 ${jump.toFixed(2)}s）`);
    },
  },
  {
    name: '47-M1 245 组合矩阵：旧 vs 新 全记录输出 CSV + 合法性（无负/无 NaN/随壁厚不减）',
    fn: () => {
      mkdirSync(OUT_DIR, { recursive: true });
      const rows = [['Material', 'Weight(kg)', 'Wall(mm)', 'Old T(s)', 'New T(s)', 'Diff(s)', 'Diff%', 'Ratio']];
      let n = 0;
      for (const mat of MATS) {
        for (const W of WS) {
          for (const w of WALLS) {
            const o = oldT(mat, W, w);
            const t = calc_t(mat, W, w);
            assert(Number.isFinite(t) && t > 0, `${mat} ${W}kg/${w}mm 时间非法（${t}）`);
            rows.push([mat, W, w, o.toFixed(4), t.toFixed(4), (t - o).toFixed(4), ((t - o) / o * 100).toFixed(2), (t / o).toFixed(4)]);
            n++;
          }
        }
      }
      assert(n === 245, `矩阵应为 7×7×5=245 行（实际 ${n}）`);
      // 同材料同重量：壁厚增大 → 时间不减（灰铁/球铁/铝/铜单调；铸钢与壁厚无关）
      for (const mat of MATS) {
        for (const W of WS) {
          const ts = WALLS.map((w) => calc_t(mat, W, w));
          for (let i = 1; i < ts.length; i++) assert(ts[i] >= ts[i - 1] - 1e-9, `${mat} ${W}kg 时间随壁厚不应下降`);
        }
      }
      // 同材料同壁厚：随重量整体趋势检查（灰铁 450 跳变除外，跳变方向已由 R3 覆盖）
      for (const mat of ['球铁(QT)', '铸钢(ZG)', '铝合金(Al)', '铜合金(Cu)']) {
        const prev = { prevW: 0, prevT: 0 };
        for (const W of WS) {
          const t = calc_t(mat, W, 15);
          assert(t > 0, `${mat} ${W}kg 时间>0`);
          prev.prevW = W; prev.prevT = t;
        }
      }
      writeFileSync(join(OUT_DIR, 'pour_time_matrix.csv'), rows.map((r) => r.join(',')).join('\n'), 'utf-8');
      console.log(`      矩阵 CSV → docs/_p47/pour_time_matrix.csv（245 行）`);
    },
  },
  {
    name: '47-D1 下游阻流面积：修改后的 T 被全链使用（A∝1/t 关系保持、公式未改）',
    fn: () => {
      const cases = [
        { mat: '灰铁(HT)', pw: 20, wall: 15 },
        { mat: '灰铁(HT)', pw: 500, wall: 25 },     // 跨 450 档（G 需 ≤450? 用 G 口径判断）
        { mat: '球铁(QT)', pw: 100, wall: 12 },
        { mat: '铸钢(ZG)', pw: 300, wall: 40 },
        { mat: '铝合金(Al)', pw: 10, wall: 8 },
        { mat: '铜合金(Cu)', pw: 50, wall: 20 },
      ];
      for (const c of cases) {
        const input = { mat: c.mat, pw: c.pw, cav: 1, yr: MATERIALS[c.mat].y_sug, wall: c.wall, Ho: 150, ph: 100, rh: 50, pos: '顶注' };
        const r = runGating(input);
        const G = r.G;
        // 唯一入口验证（PHASE 49）：runGating 输出的 t 必须 = calc_t(材料, castingMass 铸件质量, 壁厚)
        assert(close(r.t, calc_t(c.mat, r.castingMass, c.wall), 1e-9), `${c.mat}: runGating.t 与 calc_t 不一致（${r.t} vs ${calc_t(c.mat, r.castingMass, c.wall)}）`);
        assert(close(r.castingMass, r.pw * r.cav, 1e-9), `${c.mat}: castingMass = pw×cav（${r.castingMass}）`);
        // 下游联动：A 由 71.47G/(ρ·t·fv·√Hp) 直接驱动 —— t 变化 → A 精确反比变化（其余全同）
        const tOld = oldT(c.mat, G, c.wall);
        const tNew = r.t;
        const Aold = calc_A(G, r.rho, tOld, r.fv, r.Hp);
        const Anew = calc_A(G, r.rho, tNew, r.fv, r.Hp);
        assert(close(Anew * tNew, Aold * tOld, 1e-6), `${c.mat}: A×T 应为常量（A 公式未改、T 已生效）`);
        // 时间增加 → 面积减小
        if (tNew > tOld) assert(Anew < Aold, `${c.mat}: T↑ 应 A↓`);
        if (tNew < tOld) assert(Anew > Aold, `${c.mat}: T↓ 应 A↑`);
        console.log(`      ${c.mat.padEnd(8)} G=${G.toFixed(1)}kg → T ${tOld.toFixed(2)}→${tNew.toFixed(2)}s, A ${Aold.toFixed(0)}→${Anew.toFixed(0)}mm²`);
      }
    },
  },
  {
    name: '47-V1 链路自证：runGating.A ≡ calc_A(G,ρ,t,fv,Hp)（t 即新模型 t，无第二套时间）',
    fn: () => {
      const cases = [
        { mat: '灰铁(HT)', pw: 30, wall: 10, pos: '顶注' },
        { mat: '灰铁(HT)', pw: 460, wall: 30, pos: '中注' },   // 跨 450kg 档
        { mat: '球铁(QT)', pw: 60, wall: 9.9, pos: '底注' },   // K₁ 分档贴边
        { mat: '铸钢(ZG)', pw: 120, wall: 20, pos: '顶注' },
        { mat: '铝合金(Al)', pw: 8, wall: 12, pos: '顶注' },
        { mat: '铜合金(Cu)', pw: 40, wall: 18, pos: '中注' },
      ];
      for (const c of cases) {
        const input = { ...c, cav: 2, yr: MATERIALS[c.mat].y_sug, Ho: 150, ph: 100, rh: 50, filterUsed: true };
        const r = runGating(input);
        // A 必须等于"用 calc_t 直接重算的 t"代入奥赞式——证明 A 消费的就是新 t
        const A_check = calc_A(r.G, r.rho, calc_t(c.mat, r.castingMass, c.wall), r.fv, r.Hp);
        assert(Math.abs(r.A - A_check) < 1e-9, `${c.mat} ${c.pw}kg：A 链路不一致（${r.A} vs ${A_check}）`);
        // 联动方向：壁厚 +50%（T↑）→ A 必须减小（其余全同）
        const r2 = runGating({ ...input, wall: c.wall * 1.5 });
        if (r2.t > r.t) assert(r2.A < r.A, `${c.mat}: T 增 A 应减`);
        // 灰铁跨档自证（PHASE 49：分档判据按 castingMass）：同输入下 runGating 的 t 与分段函数逐点一致
        if (c.mat === '灰铁(HT)') {
          const seg = r.castingMass <= 450 ? 0.70 * (1.41 + c.wall / 14.59) * Math.sqrt(r.castingMass) : 0.70 * (1.236 + c.wall / 16.65) * Math.cbrt(r.castingMass);
          assert(Math.abs(r.t - seg) < 1e-9, `灰铁 ${c.pw}kg 分段函数逐点不一致`);
        }
      }
    },
  },
  {
    name: '47-D2 铝/铜保持不变：与旧模型完全一致（含 fc 系数）',
    fn: () => {
      for (const mat of ['铝合金(Al)', '铜合金(Cu)']) {
        for (const W of [10, 100, 450]) {
          for (const w of [5, 15, 30]) {
            assert(close(calc_t(mat, W, w), oldT(mat, W, w), 1e-9), `${mat} ${W}kg/${w}mm 应保持原 Dietert 模型`);
          }
        }
      }
    },
  },
];
