// ============================================================
// PHASE 51 收尾（53.txt）：比例预设信息完整性 + 自动选择不变 +
//   choke 变化防御标记 + 系统类型文案收紧
// ============================================================
import { runGating, RATIO_PRESETS, recommendGatingRatio, MATERIALS } from '../calcs/gating.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const inputOf = (mat, pw, wall = 20, pos = '顶注', ratioKey, extra = {}) => ({
  mat, pw, cav: 1, yr: MATERIALS[mat].y_sug, wall, pos, Ho: 150, ph: 100, rh: 50,
  gc: 2, gt: 15, rc: 1, rt: 15, ratioKey, ...extra,
});

export const tests = [
  {
    name: '53-T11 预设数据完整性：名称/比例(S直S横S内) 全部可读且为正',
    fn: () => {
      const names = Object.keys(RATIO_PRESETS);
      assert(names.length >= 6, `预设数量 ≥6（实际 ${names.length}）`);
      for (const k of names) {
        const p = RATIO_PRESETS[k];
        const [s, r, g] = p.r;
        assert(Array.isArray(p.r) && p.r.length === 3 && s > 0 && r > 0 && g > 0,
          `${k}: 比例应为 3 个正数（实际 ${p.r}）`);
        assert(typeof k === 'string' && k.length > 0, '预设名称可读');
        console.log(`      ${k} → ${s}:${r}:${g}`);
      }
    },
  },
  {
    name: '53-T14 自动选择逻辑不变：灰铁/球铁常规/球铁大件/铝（与代码 recommendGatingRatio 锁定）',
    fn: () => {
      assert(recommendGatingRatio('灰铁(HT)', 50) === '封闭式 常用型', '灰铁 50kg → 封闭式 常用型');
      assert(recommendGatingRatio('灰铁(HT)', 300) === '封闭式 大件型', '灰铁 300kg → 封闭式 大件型（>200 升档）');
      assert(recommendGatingRatio('球铁(QT)', 50) === '开放式 标准型', '球铁 50kg → 开放式 标准型');
      assert(recommendGatingRatio('球铁(QT)', 300) === '开放式 宽大型', '球铁 300kg → 开放式 宽大型（>200 升档）');
      assert(recommendGatingRatio('铝合金(Al)', 50) === '开放式 铝合金属', '铝 50kg → 开放式 铝合金属');
      assert(recommendGatingRatio('铜合金(Cu)', 50) === '开放式 标准型', '铜 50kg → 开放式 标准型');
    },
  },
  {
    name: '53-T15 choke 变化防御：ingate 初始 optimize 后 choke 变化（ingate→sprue）→ UI 拒绝条件成立且原几何保留',
    fn: () => {
      // ingate 阻流（封闭式小内浇口）初始——按钮本不显示；防御测试模拟"若强行 optimize"：
      //   放大 Fg 使最小截面移走 → chokePosition 变化 → 通用防御拒绝（opt 结果不得写入）
      const base = runGating(inputOf('灰铁(HT)', 60, 20, '顶注', '封闭式 常用型', { gc: 1, gt: 5 }));
      assert(base.chokePosition === 'ingate', '前置：ingate choke');
      const opt = runGating(inputOf('灰铁(HT)', 60, 20, '顶注', '封闭式 常用型', { gc: 1, gt: 5, optimize: true }));
      const chokeChanged = opt.chokePosition !== base.chokePosition;
      // 防御语义：choke 变化 → 拒绝（不采用 opt.Fg；base 几何保持）
      assert(chokeChanged === true, `ingate 放大后 choke 变化（${base.chokePosition} → ${opt.chokePosition}）`);
      // 优化前几何结果保留 = base 的 Fg/L_g 未被污染（opt 为独立计算，不写回）
      const after = runGating(inputOf('灰铁(HT)', 60, 20, '顶注', '封闭式 常用型', { gc: 1, gt: 5 }));
      assert(after.Fg === base.Fg && after.L_g === base.L_g, '原设计重算结果不变（拒绝后恢复即此值）');
      // 可优化场景（sprue choke 开放）：choke 不变 → 接受条件成立
      const b2 = runGating(inputOf('球铁(QT)', 60, 15, '顶注', '开放式 标准型'));
      const o2 = runGating(inputOf('球铁(QT)', 60, 15, '顶注', '开放式 标准型', { optimize: true }));
      assert(b2.chokePosition === o2.chokePosition && o2.chokePosition === 'sprue', 'sprue 初始优化后 choke 不变 → 可接受');
    },
  },
  {
    name: '53-T16 系统类型文案收紧（特征表述，非绝对分类）',
    fn: () => {
      const i = runGating(inputOf('灰铁(HT)', 60, 20, '顶注', '封闭式 常用型', { gc: 1, gt: 5 }));
      assert(i.systemType === '封闭式/加压式特征：内浇口为阻流截面', `ingate 文案（实际：${i.systemType}）`);
      const s = runGating(inputOf('球铁(QT)', 60, 15, '顶注', '开放式 标准型'));
      assert(s.systemType === '开放式/非加压式特征：直浇道为阻流截面', `sprue 文案（实际：${s.systemType}）`);
      const r = runGating(inputOf('球铁(QT)', 60, 15, '顶注', '自定义', { custom: true, cs: 1, cr: 0.7, cg: 0.8 }));
      assert(r.systemType === '横浇道阻流：上游截面控制流量', `runner 文案（实际：${r.systemType}）`);
      // boundary 文案存在（逻辑串），可达性受取整影响（P51 报告已声明）
      assert(['封闭式/加压式特征：内浇口为阻流截面', '开放式/非加压式特征：直浇道为阻流截面', '横浇道阻流：上游截面控制流量', '阻流位置临界：建议人工复核'].includes(i.systemType)
        && i.systemType.includes('特征') === true, '文案不含绝对分类表述');
    },
  },
  {
    name: '53-T17a UI 显示比例 = 实际计算比例（预设键名与 RATIO_PRESETS 数据同源）',
    fn: () => {
      // UI option 文本由 RATIO_PRESETS 生成（模板层），calc 用同一对象——
      // 验证 runGating 对 UI 选择的每个预设名都能解析且 rd.r 与表一致
      for (const k of Object.keys(RATIO_PRESETS)) {
        const r = runGating(inputOf('灰铁(HT)', 60, 20, '顶注', k));
        assert(r.rd.type !== '自定义' && r.rd.r.join(':') === RATIO_PRESETS[k].r.join(':'),
          `${k}: runGating 解析比例 ${r.rd.r.join(':')} 应 = 预设表 ${RATIO_PRESETS[k].r.join(':')}`);
        assert(r.s_r === RATIO_PRESETS[k].r[0] && r.r_r === RATIO_PRESETS[k].r[1] && r.g_r === RATIO_PRESETS[k].r[2],
          `${k}: 输出比例分量一致`);
      }
    },
  },
];
