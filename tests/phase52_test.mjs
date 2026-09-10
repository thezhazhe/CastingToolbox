// ============================================================
// PHASE 52（54.txt）：Final Audit 回归锁定
//   T1-T2   PART 0 修复回归：直浇道圆形直径 ceil（原 round）/ 横浇道长度 ceil（与内浇口同规则）
//   T3      PART 3 口径：t 用 castingMass（Wc），不得混入 G
//   T4      PART 4 密度：液态表（gating）与已批准固态表（riser）现状锁定
//   T5      PART 5 数学关系：A_target / A_rec / v_gate / v_theory 单位链自洽
//   T6      PART 7 choke 判定一致性：实际几何 min() == chokeArea
//   T7      PART 11 边界攻击矩阵：无 NaN/Infinity/负时间/负流速/JS exception
// ============================================================
import { runGating, calc_t, calc_v, MATERIALS, V_TARGET, RATIO_PRESETS, recommendGatingRatio } from '../calcs/gating.js';
import { RISER_MATERIALS } from '../calcs/riser.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const isFin = (x) => typeof x === 'number' && isFinite(x) && !isNaN(x);

const inputOf = (mat, pw, wall = 20, pos = '顶注', ratioKey, extra = {}) => ({
  mat, pw, cav: 1, yr: MATERIALS[mat].y_sug, wall, pos, Ho: 150, ph: 100, rh: 50,
  gc: 2, gt: 15, rc: 1, rt: 15, ratioKey, ...extra,
});

export const tests = [
  {
    name: '52-T1 PART0 直浇道直径取整=ceil：扫描剖面 Fs_act≥A_sp 恒成立，D_sp=ceil(理论直径)',
    fn: () => {
      // 多材料 × 重量剖面扫描：任何输入下最终制造直径 = ceil(理论)，面积不得小于目标
      const mats = ['灰铁(HT)', '球铁(QT)', '铸钢(ZG)', '铝合金(Al)', '铜合金(Cu)'];
      let checked = 0, diffHit = 0;
      for (const mat of mats) {
        for (let pw = 1; pw <= 600; pw += 3) {
          const r = runGating(inputOf(mat, pw, 15 + (pw % 25), '顶注', '封闭式 常用型'));
          const D_theory = Math.sqrt(4 * r.A_sp / Math.PI);
          if (r.A_sp > 0) {
            assert(r.D_sp === Math.max(5, Math.ceil(D_theory)),
              `${mat} pw=${pw}: D_sp=${r.D_sp} 应为 ceil(${D_theory.toFixed(3)})=${Math.max(5, Math.ceil(D_theory))}`);
            assert(r.Fs_act >= r.A_sp,
              `${mat} pw=${pw}: Fs_act=${r.Fs_act.toFixed(2)} 不得小于 A_sp=${r.A_sp.toFixed(2)}`);
            if (Math.round(D_theory) !== Math.ceil(D_theory)) diffHit++;
            checked++;
          }
        }
      }
      assert(diffHit > 0, `扫描应命中 round≠ceil 差异剖面（实际 ${diffHit}）——验证修复非空转`);
      console.log(`      ${checked} 剖面全过，round≠ceil 差异命中 ${diffHit} 例`);
      // 回归锁定：P51 报告"round 24mm"案例语境——原 round 已修，报告声明更新见 P52 报告
    },
  },
  {
    name: '52-T2 PART0 横浇道长度取整=ceil（与 L_g 同规则）：Fr_act≥A_run',
    fn: () => {
      for (const mat of ['灰铁(HT)', '球铁(QT)', '铝合金(Al)']) {
        for (let pw = 8; pw <= 400; pw += 7) {
          const r = runGating(inputOf(mat, pw, 18, '顶注', '开放式 标准型'));
          if (r.rc > 0 && r.rt > 0 && r.A_run > 0) {
            const L_theory = r.A_run / (r.rc * r.rt);
            assert(r.L_r >= L_theory, `${mat} pw=${pw}: L_r=${r.L_r} 应 ≥ 理论 ${L_theory.toFixed(2)}`);
            assert(r.Fr_act >= r.A_run, `${mat} pw=${pw}: Fr_act=${r.Fr_act.toFixed(1)} 应 ≥ A_run=${r.A_run.toFixed(1)}`);
            assert(r.L_r % 5 === 0, `${mat} pw=${pw}: L_r 应为 5 的倍数（实际 ${r.L_r}）`);
          }
        }
      }
    },
  },
  {
    name: '52-T3 PART3 口径：t 由 castingMass（pw×cav）驱动，与 G 无关',
    fn: () => {
      // yr=50 → G = 2×Wc：若代码误用 G 当 W，t 会显著变大 → 断言 t ≡ calc_t(mat, Wc)
      const r = runGating(inputOf('灰铁(HT)', 60, 20, '顶注', '封闭式 常用型', { cav: 2, yr: 50 }));
      const Wc = 60 * 2, G = Wc / 0.5;
      assert(r.castingMass === Wc && Math.abs(r.G - G) < 1e-9, `castingMass=${r.castingMass} G=${r.G} 前置`);
      assert(Math.abs(r.t - calc_t('灰铁(HT)', Wc, 20)) < 1e-12,
        `t=${r.t} 必须 = calc_t(Wc=${Wc})=${calc_t('灰铁(HT)', Wc, 20)}（用铸件质量）`);
      assert(Math.abs(r.t - calc_t('灰铁(HT)', G, 20)) > 1e-9,
        '口径自证：若 t 用了 G（浇注重量）则值不同——防止回归到旧口径');
      // 球铁同证（避免材料分支差异）
      const rq = runGating(inputOf('球铁(QT)', 80, 18, '顶注', '开放式 标准型', { cav: 3, yr: 60 }));
      assert(Math.abs(rq.t - calc_t('球铁(QT)', 80 * 3, 18)) < 1e-12, '球铁：t 用 castingMass');
      assert(Math.abs(rq.t - calc_t('球铁(QT)', rq.G, 18)) > 1e-9, '球铁：t ≠ calc_t(G) 自证');
    },
  },
  {
    name: '52-T4 PART4 密度表现状锁定：液态（gating）与固态（riser）分源值',
    fn: () => {
      // 液态（浇注系统流量口径）：54.txt PART 4 liquid 列表 —— 企业批准值
      const liquid = { '灰铁(HT)': 7.0, '球铁(QT)': 6.9, '铸钢(ZG)': 7.5, '铝合金(Al)': 2.6, '铜合金(Cu)': 8.4 };
      for (const [k, v] of Object.entries(liquid)) {
        assert(MATERIALS[k].rho === v, `液态 ${k} ρ=${MATERIALS[k].rho} 应=${v}`);
      }
      // 固态（冒口补缩口径）：28.7-A 已人工批准定稿值（44.txt）——与 54.txt PART 4 期望差异列为审计 ISSUE（不覆盖）
      const solid = { '灰铁': 7.0, '球铁': 7.1, '铸钢': 7.8, '铝合金': 2.7, '铜合金': 8.4 };
      for (const [k, v] of Object.entries(solid)) {
        assert(RISER_MATERIALS[k].rho === v, `固态 ${k} ρ=${RISER_MATERIALS[k].rho} 应=${v}（28.7-A 定稿）`);
      }
    },
  },
  {
    name: '52-T5 PART5 数学关系链自洽：A_target / A_rec / v_gate / v_theory',
    fn: () => {
      for (const mat of ['灰铁(HT)', '球铁(QT)', '铝合金(Al)']) {   // 有目标材料
        const r = runGating(inputOf(mat, 60, 20, '顶注', '开放式 标准型'));
        const vt = V_TARGET[mat];
        assert(Math.abs(r.A_target - 1000 * r.G / (r.rho * r.t * vt.t)) < 1e-6,
          `${mat}: A_target=${r.A_target} ≠ 1000G/(ρt·v_target)`);
        assert(Math.abs(r.A_rec - Math.max(r.A_gt, r.A_target)) < 1e-9, `${mat}: A_rec=max(A_gt,A_target)`);
        assert(Math.abs(r.vFinal - calc_v(r.G, r.rho, r.t, r.Fg)) < 1e-12,
          `${mat}: vFinal=${r.vFinal} ≠ 1000G/(ρt·Fg)=${calc_v(r.G, r.rho, r.t, r.Fg)}`);
        const vth = Math.sqrt(2 * 9.81 * r.Hp / 1000) * r.fv;   // Hp mm→m
        assert(Math.abs(r.vTheory - vth) < 1e-12, `${mat}: v_theory=fv√(2gHp)`);
        assert(isFin(r.A) && r.A > 0, `${mat}: 奥赞 A 正常`);
      }
      // 无目标材料（铸钢/铜）：A_target=0（不缩小不放大）、A_rec=A_gt
      for (const mat of ['铸钢(ZG)', '铜合金(Cu)']) {
        const r = runGating(inputOf(mat, 60, 20, '顶注', '开放式 标准型'));
        assert(r.A_target === 0 && r.A_rec === r.A_gt, `${mat}: 无目标 → A_rec=A_gt`);
      }
    },
  },
  {
    name: '52-T6 PART7 choke 判定一致性：chokeArea=min(Fs_act,Fr_act,Fg)，位置与 1% 并列规则匹配',
    fn: () => {
      const r = runGating(inputOf('灰铁(HT)', 60, 20, '顶注', '封闭式 常用型', { gc: 1, gt: 5 }));
      const parts = [['sprue', r.Fs_act], ['runner', r.Fr_act], ['ingate', r.Fg]];
      const mn = Math.min(...parts.map(p => p[1]));
      assert(Math.abs(r.chokeArea - mn) < 1e-9, `chokeArea=${r.chokeArea} 应=min=${mn}`);
      const within = parts.filter(p => Math.abs(p[1] - mn) / mn <= 0.01).length;
      if (within === 1) {
        const pos = parts.find(p => Math.abs(p[1] - mn) / mn <= 0.01)[0];
        assert(r.chokePosition === pos, `单点阻流 ${pos} → chokePosition=${r.chokePosition}`);
      } else {
        assert(r.chokePosition === 'boundary', `并列 ${within} 项 → boundary`);
      }
      // 判定永不 NaN；systemType 与位置 4 态映射存在
      assert(['sprue', 'runner', 'ingate', 'boundary', 'unset'].includes(r.chokePosition), 'chokePosition 合法值域');
      assert(typeof r.systemType === 'string' && r.systemType.length > 0, 'systemType 存在');
    },
  },
  {
    name: '52-T7 PART11 边界攻击矩阵：重量/壁厚/型腔/数量/Ho/比例 极值与非法值',
    fn: () => {
      const base = { mat: '灰铁(HT)', cav: 1, yr: 75, wall: 20, pos: '顶注', Ho: 180, ph: 100, rh: 50, gc: 2, gt: 15, rc: 1, rt: 15, ratioKey: '封闭式 常用型' };
      const variants = [
        // 重量：0/负/极小/450 上下/极大
        { pw: 0 }, { pw: -5 }, { pw: 0.01 }, { pw: 449.9 }, { pw: 450 }, { pw: 450.1 }, { pw: 1e6 },
        // 壁厚：0/负/分档点/极大
        { mat: '球铁(QT)', pw: 60, wall: 0 }, { mat: '球铁(QT)', pw: 60, wall: -1 }, { mat: '球铁(QT)', pw: 60, wall: 9.9 },
        { mat: '球铁(QT)', pw: 60, wall: 10 }, { mat: '球铁(QT)', pw: 60, wall: 25 }, { mat: '球铁(QT)', pw: 60, wall: 25.1 }, { mat: '球铁(QT)', pw: 60, wall: 1e4 },
        // 型腔数：0/负/1/大
        { pw: 30, cav: 0 }, { pw: 30, cav: -2 }, { pw: 30, cav: 1 }, { pw: 5, cav: 200 },
        // 浇口数量：0/大/负
        { pw: 60, gc: 0 }, { pw: 60, gc: 99 }, { pw: 60, gc: -3, gt: 15 },
        { pw: 60, rc: 0 }, { pw: 60, rc: -1 }, { pw: 60, rt: 0 },
        // Ho：极小/极大
        { pw: 60, Ho: 0 }, { pw: 60, Ho: 1 }, { pw: 60, Ho: 50000 },
        // 出品率：0/负/超 100
        { pw: 60, yr: 0 }, { pw: 60, yr: -10 }, { pw: 60, yr: 150 },
        // custom 比例：0 分量/负分量/极端分量/全 NaN
        { pw: 60, ratioKey: undefined, custom: true, cs: 0, cr: 1, cg: 1 },
        { pw: 60, ratioKey: undefined, custom: true, cs: -2, cr: 1, cg: 1 },
        { pw: 60, ratioKey: undefined, custom: true, cs: 1, cr: 0.01, cg: 100 },
        { pw: 60, ratioKey: undefined, custom: true, cs: NaN, cr: NaN, cg: NaN },
        // 完全空输入
        {},
      ];
      for (const v of variants) {
        let r;
        try { r = runGating({ ...base, ...v }); }
        catch (e) { throw new Error(`输入 ${JSON.stringify(v)} 抛异常: ${e.message}`); }
        assert(r && typeof r === 'object', `返回对象：${JSON.stringify(v)}`);
        for (const f of ['t', 'A', 'G', 'castingMass', 'Hp', 'A_sp', 'A_run', 'A_gt', 'A_target', 'vFinal', 'vTheory', 'Fs_act', 'Fr_act', 'Fg', 'vr', 'D_sp', 'chokeArea']) {
          assert(isFin(r[f]), `${JSON.stringify(v).slice(0, 60)}: ${f}=${r[f]} 必须为有限数`);
        }
        assert(r.t >= 0 && r.A >= 0, `无负时间/负面积：t=${r.t} A=${r.A}`);
        assert(Array.isArray(r.sugs) && r.sugs.every(s => typeof s === 'string'), '建议列表为字符串数组');
      }
      console.log(`      ${variants.length} 组极值/非法输入全部通过（有限数/无负值/无异常）`);
    },
  },
];
