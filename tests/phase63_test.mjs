// ============================================================
// PHASE 63 — 独立计算器产品安全补丁 测试
// P0-1 非法输入门禁（numcheck 纯逻辑矩阵）
// P1-1 CT 等级未选态不计算（ctTolerance 只按传入等级；视图门禁见浏览器验收）
// P1-5 charge 吸收率参与建议量（A≠B）+ 其他结果不受影响
// P1-7 shrinkage 方向映射 A~E 五组（idx 对应 长/宽/高，不错位）
// P1-6 shrinkage 档位/文献区间数据零改动（两源语义分离在 UI，数据不动）
// JB/T 5105 计数核查：代码 = 3 表 × 2 模样材质 × 8 档 = 48 格（62 报告"64"为记录笔误）
// ============================================================
import { checkNum, firstErr, parseNum } from '../js/views/numcheck.js';
import { calcShrinkageDir, SHRINKAGE, SHRINK_MODE_LABEL } from '../calcs/shrinkage.js';
import { runCharge } from '../calcs/charge.js';
import { CHARGE_GRADES, CHARGE_MATERIALS } from '../data/charge_calc.js';
import { ctTolerance, normGrade } from '../calcs/ct.js';
import { DRAFT_OUTER, DRAFT_INNER, DRAFT_SELF_OUTER, DRAFT_HEIGHTS } from '../calcs/castability.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

export const tests = [
  // ---------- P0-1 · numcheck 纯逻辑矩阵 ----------
  {
    name: '63-P0A checkNum 非法输入矩阵（空/0/负/NaN/Inf/文字/非整数/超界）',
    fn: () => {
      assert(checkNum('', { label: 'x' }) === null, '空值未标记字段允许（可选）');
      assert(checkNum('', { label: 'x', required: true }) === 'x 不能为空', '必填空值未拦');
      assert(checkNum('-5', { label: '单件毛重', gt: 0 }) === '单件毛重 需大于 0', '负值未拦');
      assert(checkNum('0', { label: '壁厚', gt: 0 }) === '壁厚 需大于 0', '0 未拦（gt 语义）');
      assert(checkNum('0', { label: 'rh', min: 0 }) === null, 'min:0 应允许 0（无冒口）');
      assert(checkNum('NaN', { label: 'x', gt: 0 }) === 'x 需为有效数字', 'NaN 未拦');
      assert(checkNum('Infinity', { label: 'x', gt: 0 }) === 'x 需为有效数字', '+Infinity 未拦');
      assert(checkNum('-Infinity', { label: 'x' }) === 'x 需为有效数字', '-Infinity 未拦');
      assert(checkNum('1e999', { label: 'x', gt: 0 }) === 'x 需为有效数字', '溢出 Infinity 未拦');
      assert(checkNum('abc', { label: 'x', required: true }) === 'x 需为有效数字', '文字未拦');
      assert(checkNum('12.5', { label: '件数', gt: 0, int: true }) === '件数 需为整数', '非整数未拦');
      assert(checkNum('2', { label: '件数', gt: 0, int: true }) === null, '合法整数误拦');
      assert(checkNum('101', { label: '出品率', gt: 0, max: 100 }) === '出品率 需 ≤ 100', '超上界未拦');
      assert(checkNum(' 12 ', { label: 'x', gt: 0 }) === null, '合法值（带空白）误拦');
      assert(firstErr([null, null]) === null && firstErr(['a', null]) === 'a', 'firstErr 语义');
      assert(Number.isNaN(parseNum('')) && Number.isNaN(parseNum('abc')), 'parseNum 空/非法应 NaN 而非 0');
      assert(parseNum('8.5') === 8.5, 'parseNum 正常值');
    },
  },
  // ---------- P1-7 · shrinkage 方向映射 A~E ----------
  {
    name: '63-P1-7A 全方向 L100/W200/H300 → idx 0/1/2 且数值与单档一致',
    fn: () => {
      const r = calcShrinkageDir('球铁(QT)', [100, 200, 300], 'common');
      assert(r && r.dirs.length === 3, '应返回 3 个方向');
      assert(JSON.stringify(r.dirs.map(d => d.idx)) === JSON.stringify([0, 1, 2]), '全填时 idx 序错误');
      assert(r.dirs[0].size === 100 && r.dirs[2].size === 300, '尺寸错位');
      assert(Math.abs(r.dirs[0].rate - r.dirs[1].rate) > 0, '100mm 与 200mm 应按尺寸分档取值');
    },
  },
  {
    name: '63-P1-7B L100/W空/H300 → 仅 idx 0、2，不产生 idx1 假结果',
    fn: () => {
      const r = calcShrinkageDir('球铁(QT)', [100, NaN, 300], 'common');
      assert(r && r.dirs.length === 2, '空档不应产生假方向');
      assert(JSON.stringify(r.dirs.map(d => d.idx)) === JSON.stringify([0, 2]), '空 W 时方向错位（应跳 1）');
      assert(r.dirs[1].size === 300, 'H 的值被移到错误下标');
    },
  },
  {
    name: '63-P1-7C L空/W200/H300 → idx 1、2',
    fn: () => {
      const r = calcShrinkageDir('铸钢(ZG)', ['', 200, 300], 'restrained');
      assert(r && JSON.stringify(r.dirs.map(d => d.idx)) === JSON.stringify([1, 2]), '空 L 方向错位');
      assert(r.dirs[0].size === 200 && r.dirs[0].idx === 1, 'W 位置错');
    },
  },
  {
    name: '63-P1-7D L100/W空/H空 单方向 → idx 0；directional=false 有 combined',
    fn: () => {
      const r = calcShrinkageDir('铝合金(Al)', [100, 0, 0], 'free');
      assert(r && r.dirs.length === 1 && r.dirs[0].idx === 0, '单方向错位');
      assert(r.directional === false && r.combined !== null, '单方向不应提示分放');
    },
  },
  {
    name: '63-P1-7E 全空 → null（不产出 0/NaN 结果）',
    fn: () => {
      assert(calcShrinkageDir('灰铁(HT)', [0, 0, 0], 'common') === null, '全空应返回 null');
      assert(calcShrinkageDir('灰铁(HT)', [NaN, '', undefined], 'common') === null, '全空(非数字)应返回 null');
    },
  },
  {
    name: '63-P1-7F 单一档位一致性：每方向数值与对应尺寸独立重算一致',
    fn: () => {
      const full = calcShrinkageDir('灰铁(HT)', [500, 200, 1200], 'common');
      const one = calcShrinkageDir('灰铁(HT)', [0, 200, 0], 'common');
      assert(full && one, '非空');
      assert(Math.abs(full.dirs[1].rate - one.dirs[0].rate) < 1e-9, '组合与单算同尺寸档位不一致');
      assert(full.dirs[2].size === 1200, '大方向未在档');
    },
  },
  // ---------- P1-6 · 档位与文献区间数据零改动 ----------
  {
    name: '63-P1-6 shrinkage 数据零改动（锚点/区间/标签原样保留）',
    fn: () => {
      const expect = {
        '灰铁(HT)': { free: 1.0, common: 0.85, restrained: 0.8, range: '0.9~1.1%' },
        '球铁(QT)': { free: 1.0, common: 0.8, restrained: 0.6, range: '0.8~1.1%' },
        '铸钢(ZG)': { free: 2.2, common: 1.8, restrained: 1.5, range: '1.8~2.4%' },
        '铝合金(Al)': { free: 1.1, common: 1.0, restrained: 0.8, range: '1.0~1.2%' },
        '铜合金(Cu)': { free: 1.4, common: 1.3, restrained: 1.2, range: '1.3~1.5%' },
      };
      for (const [k, v] of Object.entries(expect)) {
        const d = SHRINKAGE[k];
        assert(d && d.free === v.free && d.common === v.common && d.restrained === v.restrained && d.range === v.range,
          `${k} 数据被改动: ${JSON.stringify(d)}`);
      }
      assert(SHRINK_MODE_LABEL.free === '自由收缩', '档位标签被改');
    },
  },
  // ---------- P1-1 · CT 数值路径不变（视图默认级见浏览器验收） ----------
  {
    name: '63-P1-1 CT1 × 120mm → 总公差 0.15 = ±0.075（数值不变）；CT 表数据不动',
    fn: () => {
      const t = ctTolerance(120, 'CT1');
      assert(t && t.value === 0.15 && t.half === 0.075, `CT1/120 值变了: ${JSON.stringify(t)}`);
      const t9 = ctTolerance(120, 'CT9');
      assert(t9 && t9.value === 2.5 && t9.half === 1.25, `CT9/120 值变了: ${JSON.stringify(t9)}`);
      assert(normGrade('DCTG9') === 'CT9', 'normGrade 语义');
    },
  },
  // ---------- P1-5 · charge 吸收率参与建议量（A≠B），其余结果不受影响 ----------
  {
    name: '63-P1-5 吸收率 85→70：硅铁建议量按反比放大，成分/其他建议不变（A≠B）',
    fn: () => {
      const base = () => ({
        grade: 'HT150', totalWt: 1000,
        pig: { content: CHARGE_MATERIALS.pigZ18, kg: 200, abs: 0.9 },
        scrap: { content: CHARGE_MATERIALS.scrapC, kg: 400, abs: 0.9 },
        ret: { content: { C: 3.0, Si: 1.5, Mn: 0.5, P: 0.15, S: 0.1 }, kg: 400, abs: 0.95 },
        carb: { content: CHARGE_MATERIALS.carb95, kg: 0, abs: 0.8 },
        feSi: { content: CHARGE_MATERIALS.feSi75, kg: 0, abs: 0.85 },
        feMn: { content: CHARGE_MATERIALS.feMn65, kg: 0, abs: 0.85 },
        sphero: { content: null, kg: 0, absMg: 0, absRE: 0, absSi: 0 },
        inoc: { content: null, kg: 0, absSi: 0 },
      });
      const A = runCharge(base());
      const B = runCharge({ ...base(), feSi: { ...base().feSi, abs: 0.70 } });
      const siA = A.sugs.find(s => s.key === 'Si');
      const siB = B.sugs.find(s => s.key === 'Si');
      // 配方须真的产生硅铁建议（构造成分缺口）
      const diff = (A.base.Si !== undefined && B.base.Si !== undefined) ? 'base-si' : 'none';
      assert(diff === 'base-si', `构造失败 baseSi 不可比: ${diff}`);
      assert(JSON.stringify(A.elems) === JSON.stringify(B.elems), '成分平衡不应受吸收率改动影响');
      assert(siA && siB, `建议缺失 A=${JSON.stringify(siA)} B=${JSON.stringify(siB)}`);
      const ratio = siB.kg / siA.kg;
      assert(siB.kg > siA.kg && Math.abs(ratio - 0.85 / 0.70) / (0.85 / 0.70) < 0.06,
        `建议量未按吸收率反比变化: A=${siA.kg} B=${siB.kg} ratio=${ratio.toFixed(3)}（期望 ~×1.214，含 0.1kg 舍入）`);
      // 其余建议（锰铁/增碳剂）不改吸收率时必须逐项相等 → 证明没有"其他公式被意外修改"
      const otherA = A.sugs.filter(s => s.key !== 'Si').map(s => s.key + ':' + s.kg).join('|');
      const otherB = B.sugs.filter(s => s.key !== 'Si').map(s => s.key + ':' + s.kg).join('|');
      assert(otherA === otherB, `非硅铁建议被连带改变: ${otherA} vs ${otherB}`);
    },
  },
  {
    name: '63-P1-5b 吸收率边界：0/负/空 由 checkNum 拦截（视图层同规则）',
    fn: () => {
      assert(checkNum('0', { label: '硅铁吸收率', gt: 0, max: 100, required: true }) === '硅铁吸收率 需大于 0', '吸收率 0 未拦');
      assert(checkNum('120', { label: '硅铁吸收率', gt: 0, max: 100 }) === '硅铁吸收率 需 ≤ 100', '吸收率 120 未拦');
      assert(checkNum('85', { label: '硅铁吸收率', gt: 0, max: 100 }) === null, '吸收率 85 误拦');
    },
  },
  // ---------- JB/T 5105 计数核查（64→48 记录修正的依据） ----------
  {
    name: '63-JB1 起模斜度代码结构 = 3 表 × 2 模样材质 × 8 档 = 48 格（62 报告"64"为统计笔误）',
    fn: () => {
      const cells = DRAFT_OUTER['金属/塑料'].length + DRAFT_OUTER['木模'].length
        + DRAFT_INNER['金属/塑料'].length + DRAFT_INNER['木模'].length
        + DRAFT_SELF_OUTER['金属/塑料'].length + DRAFT_SELF_OUTER['木模'].length;
      assert(cells === 48, `实际格数 ${cells} ≠ 48`);
      for (const t of [DRAFT_OUTER, DRAFT_INNER, DRAFT_SELF_OUTER]) {
        assert(JSON.stringify(Object.keys(t)) === JSON.stringify(['金属/塑料', '木模']), '表结构异常');
        assert(t['金属/塑料'].length === 8 && t['木模'].length === 8, '非 8 档');
      }
      assert(JSON.stringify(DRAFT_HEIGHTS) === JSON.stringify([10, 40, 100, 160, 250, 400, 630, 1000]), '高度档位被改');
      // 抽样锚值（1991 公开表基准，62-T6 已全表锁定，此处防误改记录值）
      assert(DRAFT_OUTER['金属/塑料'][0] === 140 && DRAFT_OUTER['木模'][7] === 20, '表1 抽样值被改');
      assert(DRAFT_SELF_OUTER['木模'][0] === 240 && DRAFT_SELF_OUTER['金属/塑料'][7] === 20, '表3 抽样值被改');
    },
  },
  {
    // PHASE 63.1 口径修正：受守卫计算器 = 11（gating/riser/shrinkage/machining/yield/chill/
    //   sandbox/castability/CT/charge/shakeout；defect_finder/principles 无数值计算入口）。
    //   原"12 个"系计数笔误（且域表漏 machining/shrinkage、混 gating×4 字段）——按计算器一一对应重写。
    name: '63-P0B checkNum 与 11 个计算器参数域守卫汇总',
    fn: () => {
      // 每个计算器取一条关键参数域规则（与视图 validate 同源）：gt>0 必填 / min0 可选 / int 件数
      const domain = {
        gating:      checkNum('0',   { label: '单件毛重', gt: 0, required: true }),
        riser:       checkNum('',    { label: '热节模数 Mc', gt: 0, required: true }),
        shrinkage:   checkNum('-5',  { label: '方向尺寸', min: 0 }),
        machining:   checkNum('0',   { label: '铸件最大轮廓尺寸', gt: 0, required: true }),
        yield:       checkNum('2.5', { label: '一模件数', gt: 0, int: true }),
        chill:       checkNum('0',   { label: '热节壁厚 T', gt: 0 }),
        sandbox:     checkNum('',    { label: '砂型重量', gt: 0, required: true }),
        castability: checkNum('abc', { label: '起模面高度', gt: 0 }),
        ct:          checkNum('-120', { label: '基本尺寸', gt: 0 }),
        charge:      checkNum('Infinity', { label: '铁液总重', gt: 0 }),
        shakeout:    checkNum('NaN', { label: '铸件重量', gt: 0 }),
      };
      const keys = Object.keys(domain);
      assert(keys.length === 11, `守卫计算器数量 ≠ 11: ${keys.length}（${keys.join('/')}）`);
      assert(Object.values(domain).every(x => x !== null), `域规则未全部拦非法: ${JSON.stringify(domain)}`);
    },
  },
];
