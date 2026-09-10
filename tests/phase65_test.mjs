// ============================================================
// PHASE 65.2 — Campbell 浇注系统速算器 V1+补丁 测试
// 65.2 语义：500/1000 经验规则 = 主方法；速度法 = 内部校验 + 自动放大；
// 用户单一结果；铜 0.5 定稿（工程参考）；1:1:n 简化口径；t 仍复用 gating.calc_t
// ============================================================
import {
  runCampbellGating, CAMPBELL_GATE_SPEED, CAMPBELL_RULE_MM2_PER_KGS, RULE_GROUP,
  velocityCheckSizing, ceil5, RHO_LIQUID, sprueCircular, runnerRect,
} from '../calcs/campbellGating.js';
import { calc_t, MATERIALS, V_TARGET } from '../calcs/gating.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const MATS = ['灰铁(HT)', '球铁(QT)', '铸钢(ZG)', '铝合金(Al)', '铜合金(Cu)'];

export const tests = [
  {
    name: '65.2-T1 材料→规则系数映射：灰铁/球铁/钢/铜=500，铝=1000；未知材料 fallback 500',
    fn: () => {
      const expect = { '灰铁(HT)': 500, '球铁(QT)': 500, '铸钢(ZG)': 500, '铜合金(Cu)': 500, '铝合金(Al)': 1000 };
      for (const [mat, v] of Object.entries(expect)) assert(CAMPBELL_RULE_MM2_PER_KGS[mat] === v, `${mat} 系数 ${CAMPBELL_RULE_MM2_PER_KGS[mat]}`);
      assert(RULE_GROUP['铝合金(Al)'] === '轻合金' && RULE_GROUP['灰铁(HT)'] === '重合金', '分组');
      const r = runCampbellGating({ mat: '未知合金(XX)', weightKg: 5, wallMm: 15 });
      assert(r && r.ruleMM2 === 500 && r.ruleGroup === '重合金', `未知材料 fallback: ${r && r.ruleMM2}`);
    },
  },
  {
    name: '65.2-T2 t 仍来自 gating.calc_t（精确相等，五材料）且路径正常',
    fn: () => {
      for (const mat of MATS) {
        const W = 8.5, wall = 15;
        const r = runCampbellGating({ mat, weightKg: W, wallMm: wall, gateCount: 4 });
        assert(r && Math.abs(r.t - calc_t(mat, W, wall)) < 1e-9, `${mat} t 未复用 calc_t`);
      }
      // 球铁壁厚分档 / 铝铜 Dietert 路径
      const thin = runCampbellGating({ mat: '球铁(QT)', weightKg: 5, wallMm: 5 }).t;
      const thick = runCampbellGating({ mat: '球铁(QT)', weightKg: 5, wallMm: 40 }).t;
      assert(thick > thin && Math.abs(thin - calc_t('球铁(QT)', 5, 5)) < 1e-9, 'K1 分档');
      assert(runCampbellGating({ mat: '铜合金(Cu)', weightKg: 3, wallMm: 10 }).t > 0, 'Dietert 铜路径');
    },
  },
  {
    name: '65.2-T3 主方法=经验规则：A = ṁ × 规则值（未超速时原样输出）',
    fn: () => {
      for (const mat of MATS) {
        const r = runCampbellGating({ mat, weightKg: 8.5, wallMm: 15, gateCount: 4 });
        const A0 = r.mdot * r.ruleMM2;
        assert(!r.adjusted && r.A_mm2 === A0, `${mat} 应未经放大且面积=ṁ×rule（实际 ${r.A_mm2} vs ${A0}）`);
        assert(r.velocityOk && r.A0_mm2 === A0, `${mat} velocityOk`);
      }
    },
  },
  {
    name: '65.2-T4 自动校验：v=Q/A ≤ 目标；超目标合成用例 → 放大且终速达标（velocityCheckSizing）',
    fn: () => {
      // 常规工况：规则取整天然留余量 → 全部通过
      for (const mat of MATS) {
        const r = runCampbellGating({ mat, weightKg: 8.5, wallMm: 15, gateCount: 4 });
        assert(r.vActual <= r.v + 1e-9, `${mat} vActual ${r.vActual} 超目标 ${r.v}`);
      }
      // 合成超速用例：ṁ=10 kg/s、ρ=7、目标 0.5、初始 A 仅 500 → v≈2.86 超
      const bad = velocityCheckSizing(500, 10, 7, 0.5);
      assert(bad.adjusted === true && bad.A_mm2 === ceil5(10000 / (7 * 0.5)), `应放大至 ${bad.A_mm2}`);
      assert(bad.vActual <= 0.5 + 1e-9, `放大后仍超速: ${bad.vActual}`);
      // 未超速原样
      const good = velocityCheckSizing(5000, 10, 7, 0.5);
      assert(!good.adjusted && good.A_mm2 === 5000 && good.ok, '未超速不应动面积');
    },
  },
  {
    name: '65.2-T5 n=1/4/64：单口=A/n、1:1:n、方形参考取整不缩水',
    fn: () => {
      for (const n of [1, 4, 64]) {
        const r = runCampbellGating({ mat: '灰铁(HT)', weightKg: 8.5, wallMm: 15, gateCount: n });
        assert(r.ratio === `1:1:${n}`, `n=${n} ratio`);
        assert(Math.abs(r.Ai - r.A_mm2 / n) < 1e-9 && r.sprueOutArea === r.Ai && r.runner.area > r.sprue.area, `n=${n} 单口/1:1 单位`);
        assert(r.squareEdge * r.squareEdge >= r.Ai, `n=${n} 方形取整不足`);
      }
    },
  },
  {
    name: '65.2-T6 非法输入全 null（空/0/负/NaN/±∞/小数/65 件数）',
    fn: () => {
      const bad = [
        { mat: '灰铁(HT)', weightKg: 0, wallMm: 15 }, { weightKg: -5, wallMm: 15 },
        { weightKg: 'abc', wallMm: 15 }, { weightKg: NaN, wallMm: 15 }, { weightKg: Infinity, wallMm: 15 },
        { weightKg: 5, wallMm: 0 }, { weightKg: 5, wallMm: -1 }, { weightKg: 5, wallMm: Infinity },
        { weightKg: 5, wallMm: 15, gateCount: 0 }, { weightKg: 5, wallMm: 15, gateCount: -2 },
        { weightKg: 5, wallMm: 15, gateCount: 2.5 }, { weightKg: 5, wallMm: 15, gateCount: 65 },
        { weightKg: 5, wallMm: 15, gateCount: Infinity }, { wallMm: 15 },
      ];
      for (const b of bad) assert(runCampbellGating(b) === null, `应 null: ${JSON.stringify(b)}`);
    },
  },
  {
    name: '65.2-T7 方法隔离与单一结果：无 Ozan/fv/Hp/比例域；无第二套面积并列',
    fn: () => {
      const r = runCampbellGating({ mat: '球铁(QT)', weightKg: 8.5, wallMm: 15, gateCount: 4 });
      for (const k of ['fv', 'Hp', 'A_choke', 'chokePosition', 'ratioKey', 'systemType', 'sugs', 'A_rec', 'quickA_mm2', 'vSprue', 'impliedHeadMm']) {
        assert(!(k in r), `输出混入 ${k}`);
      }
      // 校验数据只进 process/debug 层
      assert(r.A0_mm2 !== undefined && r.vActual !== undefined && Array.isArray(r.process) && r.process.length >= 5, '校验层应保留供测试');
      assert(!('vActual' in {}), 'guard');
      assert(r.v === 0.5 && V_TARGET['球铁(QT)'].t !== 0.5, '速算 v 与 V_TARGET 不串源');
    },
  },
  {
    name: '65.2-T8 证据矩阵（65.2 定稿）：铜=工程参考且无"未明确"措辞',
    fn: () => {
      const provs = {};
      for (const mat of MATS) {
        const sp = CAMPBELL_GATE_SPEED[mat];
        assert(sp && sp.v === (mat === '灰铁(HT)' ? 1.0 : 0.5) && sp.provLabel && sp.provNote, `${mat} 证据字段`);
        provs[mat] = sp.prov;
      }
      assert(provs['灰铁(HT)'] === 'user' && provs['球铁(QT)'] === 'user', '灰铁/球铁=用户确认');
      assert(provs['铝合金(Al)'] === 'campbell', '铝=Campbell 明确');
      assert(provs['铸钢(ZG)'] === 'campbell-example', '钢=算例目标');
      assert(provs['铜合金(Cu)'] === 'reference', '铜=工程参考（文献）');
      const cu = CAMPBELL_GATE_SPEED['铜合金(Cu)'].provNote;
      assert(!cu.includes('未明确'), `铜不应再写"未明确": ${cu}`);
      assert(cu.includes('0.5 m/s 作为临界/控制速度') && cu.includes('工程参考') && !cu.includes('STANDARD'), '铜 note 口径');
      const fe = CAMPBELL_GATE_SPEED['灰铁(HT)'].provNote;
      assert(fe.includes('非 Campbell 原值'), '灰铁防伪装');
      // 结果里只有唯一最终推荐面积
      const r = runCampbellGating({ mat: '铜合金(Cu)', weightKg: 8.5, wallMm: 15, gateCount: 4 });
      assert(r.A_mm2 === r.A0_mm2, '铜常规应无需放大（单一结果）');
    },
  },
  {
    name: '65.2-T9 process 链完整性 & ρ 同源 gating',
    fn: () => {
      const r = runCampbellGating({ mat: '铝合金(Al)', weightKg: 8.5, wallMm: 15, gateCount: 4 });
      assert(r.process.some(p => p.step.includes('1000')) && r.process.some(p => p.pass === true), '经验法→校验链');
      assert(RHO_LIQUID === MATERIALS, 'ρ 同源 gating');
      assert(r.process.some(p => p.step.includes('1:1:')), '1:1:n 链尾');
      const r2 = runCampbellGating({ mat: '铝合金(Al)', weightKg: 2, wallMm: 10 });
      assert(r2 && r2.t === calc_t('铝合金(Al)', 2, 10), '路径闭合');
    },
  },

  // ================= 65.3 =================
  {
    name: '65.3-T10 一模多件：W_total 进 t、n_total=件×口、Ai=A/n_total、1:1:n_total',
    fn: () => {
      const cav = 2, per = 4, W1 = 8.5, wall = 15;
      const r = runCampbellGating({ mat: '灰铁(HT)', weightKg: W1, wallMm: wall, cavity: cav, gateCount: per });
      assert(r, 'null');
      assert(r.cavity === 2 && r.gateCount === 4 && r.nTotal === 8, '件/口/总口');
      assert(Math.abs(r.Wtotal - W1 * cav) < 1e-9, '一模总重');
      assert(Math.abs(r.t - calc_t('灰铁(HT)', W1 * cav, wall)) < 1e-9, 't 用一模总重');
      assert(Math.abs(r.A_mm2 - r.mdot * 500) < 1e-6, 'A 仍按 500 规则');
      assert(Math.abs(r.Ai - r.A_mm2 / 8) < 1e-9, '单口=总面积/总口数');
      assert(r.ratio === '1:1:8' && r.sprueOutArea === r.Ai && r.runnerRefArea >= r.Ai * 1.2 && r.runner.area > r.sprue.area, '1:1:n_total / runner 略大');
      assert(r.sprue.d >= 5 && r.sprue.area >= r.Ai && r.sprue.d % 5 === 0, `sprue 圆 ${r.sprue.d}`);
      assert(r.runner.l > r.runner.h && r.runner.area >= r.Ai && r.runner.l / r.runner.h < 2.2, `runner 长×高 ${r.runner.l}x${r.runner.h}`);
      assert(r.slot.t === Math.floor(wall / 2) && r.slot.l >= r.slot.t && r.slot.area >= r.Ai, '缝隙式生成');
    },
  },
  {
    name: '65.3-T11 回溯兼容：cavity=1 与旧输入结果一致（件数扩展不改变单件语义）',
    fn: () => {
      const a = runCampbellGating({ mat: '铝合金(Al)', weightKg: 8.5, wallMm: 15 });
      const b = runCampbellGating({ mat: '铝合金(Al)', weightKg: 8.5, wallMm: 15, cavity: 1, gateCount: 4 });
      assert(a && b, 'null');
      assert(a.t === b.t && a.A_mm2 === b.A_mm2 && a.Ai === b.Ai && a.ratio === '1:1:4' && a.nTotal === 4, '语义漂移');
      assert(a.sprueOutArea === a.Ai, '单位口径');
    },
  },
  {
    name: '65.3-T12 缝隙式厚度恒 ≤ 壁厚/2（奇/偶壁厚）且薄件触发 thinNote',
    fn: () => {
      for (const wall of [5, 12, 15, 40]) {
        const r = runCampbellGating({ mat: '球铁(QT)', weightKg: 8.5, wallMm: wall, gateCount: 8 });
        assert(r.slot.t <= wall / 2 && r.slot.t === Math.floor(wall / 2), `wall=${wall} slot.t=${r.slot.t}`);
      }
      // 大单口薄壁 → squareEdge > wall/2 → thinNote
      const t1 = runCampbellGating({ mat: '灰铁(HT)', weightKg: 2, wallMm: 3, gateCount: 1 });
      assert(t1 && t1.thinNote && t1.thinNote.includes('缝隙式'), 'thinNote 缺失');
    },
  },
  {
    name: '65.3-T13 n_total 上限：件×口 >256 → null；=256 边界可算',
    fn: () => {
      assert(runCampbellGating({ mat: '灰铁(HT)', weightKg: 1, wallMm: 10, cavity: 5, gateCount: 64 }) === null, '320 口应拒');
      assert(runCampbellGating({ mat: '灰铁(HT)', weightKg: 1, wallMm: 10, cavity: 64, gateCount: 4 }) !== null, '256 口应可算');
    },
  },
  {
    name: '65.3-T14 几何辅助函数：sprue 圆 ≥ 需求 & 5mm 格；runner 近方非正方面积足',
    fn: () => {
      for (const A of [100, 625, 900, 2500]) {
        const sp = sprueCircular(A);
        assert(sp.area >= A && sp.d % 5 === 0, `sprue ${A} -> d=${sp.d} area=${sp.area.toFixed(0)}`);
        const ru = runnerRect(A);
        assert(ru.area >= A && ru.l >= ru.h && ru.h >= 5, `runner ${A} -> ${ru.l}x${ru.h}`);
        if (A >= 200) assert(ru.l > ru.h && ru.l / ru.h <= 2.2, `runner 应近方错开 ${A}`);
      }
    },
  },
  {
    name: '65.3-T15 65.2 语义回归：主方法/校验/证据矩阵不因 65.3 变化',
    fn: () => {
      const r = runCampbellGating({ mat: '铝合金(Al)', weightKg: 8.5, wallMm: 15 });
      assert(!r.adjusted && Math.abs(r.A_mm2 - r.mdot * 1000) < 1e-6 && r.velocityOk, '主方法漂移');
      assert(CAMPBELL_GATE_SPEED['铜合金(Cu)'].prov === 'reference' && !CAMPBELL_GATE_SPEED['铜合金(Cu)'].provNote.includes('未明确'), '铜口径漂移');
      for (const k of ['fv', 'Hp', 'A_choke', 'vSprue', 'impliedHeadMm', 'quickA_mm2']) assert(!(k in r), `隔离域漂移 ${k}`);
    },
  },

  {
    name: '70-T16 缝隙厚度可编辑：t 自定义 → 长度=⌈Ai/t⌉；超壁厚半 overThin 警告',
    fn: () => {
      const base = { mat: '灰铁(HT)', weightKg: 10, wallMm: 20, gateCount: 4 };
      const def = runCampbellGating(base);
      assert(def.slot.t === 10 && def.slot.minT === 10 && def.slot.overThin === false, '默认厚=⌊壁厚/2⌋');
      const thin = runCampbellGating({ ...base, slotT: 5 });
      assert(thin.slot.t === 5 && Math.abs(thin.slot.l - Math.max(5, Math.ceil(thin.Ai / 5 / 5) * 5)) < 1e-9 && thin.slot.overThin === false, `t=5 长=${thin.slot.l}`);
      assert(thin.slot.area >= thin.Ai, '面积足');
      const thick = runCampbellGating({ ...base, slotT: 15 });
      assert(thick.slot.t === 15 && thick.slot.overThin === true, 't=15>10 应警告');
      assert(runCampbellGating({ ...base, slotT: 0 }) !== null && runCampbellGating({ ...base, slotT: 0 }).slot === null, 't≤0 → 无缝隙方案但主链可算');
    },
  },
  {
    name: '70-T17 Runner 面积略大于直浇道：实际几何面积 严格 > sprue 实际面积',
    fn: () => {
      for (const mat of ['灰铁(HT)', '球铁(QT)', '铝合金(Al)', '铸钢(ZG)', '铜合金(Cu)']) {
        for (const n of [2, 4, 8]) {
          const r = runCampbellGating({ mat, weightKg: 8.5, wallMm: 15, gateCount: n });
          assert(r.runner.area > r.sprue.area, `${mat} n=${n}: runner ${r.runner.area} vs sprue ${r.sprue.area}`);
          assert(r.runnerRefArea >= r.Ai * 1.2 - 1e-9, 'runner 参考 ≥ sprue 单位×1.2');
        }
      }
    },
  },

  {
    name: '70-T18 横浇道厚度可自定义：h 输入 → 长度联动；过大高度 under 标记',
    fn: () => {
      const base = { mat: '灰铁(HT)', weightKg: 10, wallMm: 20, gateCount: 4 };
      const auto = runCampbellGating(base);
      assert(auto.runnerCustom === false && auto.runnerAutoH === auto.runner.h, '默认自动高');
      const h25 = runCampbellGating({ ...base, runnerH: 25 });
      assert(h25.runnerCustom && h25.runner.h === 25, '自定义高生效');
      const expL = Math.max(5, Math.ceil(h25.runnerRefArea / 25 / 5) * 5);
      assert(h25.runner.l === expL && h25.runner.area === 25 * expL && h25.runner.under === false, `h25 长度联动 ${h25.runner.l}`);
      // 性质断言：任意合理高度下实际面积 ≥ 参考（5mm 网格+最小长度保证）
      for (const h of [5, 8, 12, 30, 50, 100]) {
        const rr = runCampbellGating({ ...base, runnerH: h });
        assert(rr.runner.area >= rr.runnerRefArea - 1e-9, `h=${h} 面积不足 ${rr.runner.area} vs ${rr.runnerRefArea}`);
        assert(rr.runner.l >= 5 && rr.runner.l % 5 === 0, `h=${h} 长度网格`);
      }
      assert(runCampbellGating({ ...base, runnerH: 0 }).runnerCustom === false, '非法高 → 自动回退');
    },
  },
];
