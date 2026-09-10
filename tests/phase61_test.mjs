// ============================================================
// PHASE 61（批次2 双AI审计执行轮）：shakeout 风险语义拆分（冷裂/变形敏感 vs
//   热裂敏感·红热打箱，800~900℃ 仅限铜合金）；charge 口径说明层；sandbox 表5 上限
//   落地 + 表3 空洞/超表告警区分；castability 经验值标注 + 超表标记；defect 卡 0.5m/s
//   材质范围修正与可信度图例。CT 新版标准相关用例见文件末（T11+，视资料核实情况）。
//   T1~T5  shakeout 风险拆分行为
//   T6      shakeout 既有路径回归（一般/复杂/重要/大件）
//   T7      sandbox 表5/表3 与告警分类
//   T8      charge 质量基准（分母=铁液总重锁定）+ 数据常量
//   T9      castability 分档标签/超表/圆角下限
//   T10     defect JSON 0.5m/s 材质限定 + 全库来源字段
// ============================================================
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runShakeout } from '../calcs/shakeout.js';
import { SHAKE_TEMP, SHAKE_RISKS, SHAKE_ADJUST } from '../data/shakeout_calc.js';
import { runSandbox } from '../calcs/sandbox.js';
import { runCharge } from '../calcs/charge.js';
import { CHARGE_TARGETS } from '../data/charge_calc.js';
import { ctTolerance, lookupCTRow, ctRange, methodCTRec } from '../calcs/ct.js';
import { CT_NOTE, CT_METHOD_GRADES } from '../data/ct_calc.js';
import { SIZE_BUCKET, draftAngles, filletRadii, criticalWallOf, minWallOf } from '../calcs/castability.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const pick = (args) => ({ mat: '灰铸铁', weight: 50, wall: 20, mode: '地面', heatTreat: '否', risk: '一般', importance: '一般', ...args });

export const tests = [
  {
    name: '61-T1 shakeout 冷裂/变形敏感：低温开箱 + ×1.15，无 800~900℃',
    fn: () => {
      const r = runShakeout(pick({ risk: '冷裂/变形敏感' }));
      assert(JSON.stringify(r.timeRange) === JSON.stringify([57, 115]), `×1.15 生效（实际 ${r.timeRange}）`);
      assert(r.shakeTemp === '≤200℃' && !r.shakeTemp.includes('800~900'), `灰铁低温开箱（实际 ${r.shakeTemp}）`);
      assert(r.shakeTempSource === '不热时效（默认）', '源说明走常规路径');
      assert(r.warnings.some(w => w.includes('冷裂')), '含冷裂防护警告');
    },
  },
  {
    name: '61-T2 shakeout 铝合金冷裂敏感 → ≤80℃（熔点限制下无高温特例）',
    fn: () => {
      const r = runShakeout(pick({ mat: '铝合金', risk: '冷裂/变形敏感' }));
      assert(r.shakeTemp === '≤80℃' && !r.shakeTemp.includes('800~900'), `实际 ${r.shakeTemp}`);
    },
  },
  {
    name: '61-T3 shakeout 铜合金 热裂敏感(红热打箱) → 800~900℃ 特例 + 配套条件警告',
    fn: () => {
      const r = runShakeout(pick({ mat: '铜合金', risk: '热裂敏感(红热打箱)' }));
      assert(r.shakeTemp.includes('800~900℃'), `红热打箱特例（实际 ${r.shakeTemp}）`);
      assert(r.shakeTempSource === '易热裂铜合金工艺特例', '来源标注');
      assert(r.warnings[0].includes('立即') && r.warnings[0].includes('热砂坑'), '配套：立即去浇冒口 + 热砂坑/入炉缓冷');
      assert(r.adjustments.some(a => a.includes('×1.0')), '热裂敏感时间系数 ×1.0（不虚构延长）');
    },
  },
  {
    name: '61-T4 shakeout 灰铁 热裂敏感 → 不自动给高温值（人工确认）+ 机理警告',
    fn: () => {
      const r = runShakeout(pick({ risk: '热裂敏感(红热打箱)' }));
      assert(!r.shakeTemp.includes('800~900') && r.shakeTemp === '≤200℃', `实际 ${r.shakeTemp}`);
      assert(r.warnings.some(w => w.includes('收缩受阻')), '热裂机理提示（开箱温度作用有限）');
    },
  },
  {
    name: '61-T5 shakeout 铝合金 热裂敏感 → 含熔点 660℃ 警告（物理不可能高温开箱）',
    fn: () => {
      const r = runShakeout(pick({ mat: '铝合金', risk: '热裂敏感(红热打箱)' }));
      assert(r.warnings.some(w => w.includes('660')), '铝熔点限制提示');
    },
  },
  {
    name: '61-T6 shakeout 既有路径回归（一般/重要/复杂/热时效/大件时间表）',
    fn: () => {
      // 一般件（旧基线锁定）
      let r = runShakeout(pick({}));
      assert(JSON.stringify(r.timeRange) === JSON.stringify([50, 100]) && r.shakeTemp === '≤200℃', `一般 ${r.timeRange}/${r.shakeTemp}`);
      // 重要件 250 封顶（灰铁 min(250,200)=200）
      r = runShakeout(pick({ importance: '重要' }));
      assert(r.shakeTemp === '≤200℃' && r.shakeTempSource === '重要件上限（默认）', `重要 ${r.shakeTemp}`);
      // 球铁 复杂+热时效+重要 系数相乘 0.85×1.30×1.10
      r = runShakeout(pick({ mat: '球墨铸铁', heatTreat: '是', risk: '复杂(壁厚差大)', importance: '重要' }));
      assert(JSON.stringify(r.timeRange) === JSON.stringify([61, 122]) && r.shakeTemp === '≤250℃', `组合 ${r.timeRange}/${r.shakeTemp}`);
      // 铸钢大件单点时间（h 档）
      r = runShakeout(pick({ mat: '铸钢', weight: 5000, wall: 60 }));
      assert(r.unit === 'h' && r.timeRange[0] === r.timeRange[1] && r.timeRange[0] === 10, `大件 ${r.timeRange}${r.unit}`);
      // 铸钢警告用冷裂/变形语义
      assert(r.warnings.some(w => w.includes('冷裂')), '铸钢 warn 冷裂措辞');
      // 风险选项数据层自洽
      assert(SHAKE_RISKS.includes('冷裂/变形敏感') && SHAKE_RISKS.includes('热裂敏感(红热打箱)') && !SHAKE_RISKS.includes('易裂'), '风险选项集');
      assert(SHAKE_ADJUST.risk['冷裂/变形敏感'] === 1.15 && SHAKE_ADJUST.risk['热裂敏感(红热打箱)'] === 1.0, '风险系数表');
    },
  },
  {
    name: '61-T7 sandbox 表5 上限落地 + 空洞/超表告警区分',
    fn: () => {
      // 命中档
      let r = runSandbox({ mode: '埋箱（树脂砂埋箱）', dim: 800, wt: 300 });
      assert(r.minWall === 30 && r.minWallRange === '100~4000' && !r.minWallOut, `命中档 minWall ${r.minWall}`);
      assert(r.load === 70 && r.warning == null, '命中无警告');
      // 小砂型 <100
      r = runSandbox({ mode: '埋箱（树脂砂埋箱）', dim: 80, wt: 50 });
      assert(r.minWall === 8 && r.minWallRange === '<100', `小砂型 ${r.minWall}`);
      // 组合空洞（600×150 无档，非超表）→ 归因正确
      r = runSandbox({ mode: '埋箱（树脂砂埋箱）', dim: 600, wt: 150 });
      assert(r.warning.includes('未落在表3'), `空洞告警归因（${r.warning.slice(0, 30)}）`);
      assert(r.load === 80, '空洞取同尺寸段承重上限保守参考');
      // 真超表（轮廓>2000）→ 原超表告警 + 无保守值
      r = runSandbox({ mode: '埋箱（树脂砂埋箱）', dim: 3000, wt: 2500 });
      assert(r.load == null && r.warning.includes('超出表3覆盖范围'), '真超表');
      // >4000 表5 上限 → minWall null + 表5 告警（埋箱/裸浇两路）
      r = runSandbox({ mode: '埋箱（树脂砂埋箱）', dim: 4200, wt: 300 });
      assert(r.minWall == null && r.minWallOut && r.warning.includes('表5'), `埋箱超表5 ${r.minWall}`);
      r = runSandbox({ mode: '裸浇', dim: 4200, castH: 200, headH: 300 });
      assert(r.minWall == null && r.warning.includes('表5'), '裸浇超表5 告警');
      // 裸浇压头低于铸件高 → 负中间值说明 + 最低 40
      r = runSandbox({ mode: '裸浇', dim: 800, castH: 300, headH: 200 });
      assert(r.side === 40 && r.warning.includes('为负'), '压头低口径警告');
    },
  },
  {
    name: '61-T8 charge 质量基准锁定：成分分母=铁液总重（含合金 kg 计入分子）',
    fn: () => {
      // 1000kg：生铁200kg(3.5C·90%) + 废钢400kg(0.2C·90%) + 回炉400kg(HT200 成品 3.45C·90%)
      const cont = (o) => ({ content: o, abs: 1 });
      const r = runCharge({
        grade: 'HT200', totalWt: 1000,
        pig: { content: { C: 3.5, Si: 1.8, Mn: 0.4, P: 0.08, S: 0.04 }, kg: 200, abs: 0.9 },
        scrap: { content: { C: 0.2, Si: 0.3, Mn: 0.6, P: 0.03, S: 0.03 }, kg: 400, abs: 0.9 },
        ret: { content: { C: 3.45, Si: 2.15, Mn: 0.7, P: 0.12, S: 0.1 }, kg: 400, abs: 0.9 },
        feSi: null, feMn: null, carb: null, sphero: null, inoc: null,
      });
      const expectC = (200 * 3.5 * 0.9 + 400 * 0.2 * 0.9 + 400 * 3.45 * 0.9) / 1000;
      assert(Math.abs(r.base.C - expectC) < 1e-9, `C 基值（实际 ${r.base.C} vs ${expectC}）`);
      // 加 10kg 硅铁：分子增加 10×75×0.85，分母仍 1000（口径=出炉铁液）
      const r2 = runCharge({
        grade: 'HT200', totalWt: 1000,
        pig: { content: { C: 3.5, Si: 1.8, Mn: 0.4, P: 0.08, S: 0.04 }, kg: 200, abs: 0.9 },
        scrap: { content: { C: 0.2, Si: 0.3, Mn: 0.6, P: 0.03, S: 0.03 }, kg: 400, abs: 0.9 },
        ret: { content: { C: 3.45, Si: 2.15, Mn: 0.7, P: 0.12, S: 0.1 }, kg: 400, abs: 0.9 },
        feSi: { content: { Si: 75 }, kg: 10, abs: 0.85, label: '75硅铁', key: 'feSi' },
        feMn: null, carb: null, sphero: null, inoc: null,
      });
      assert(Math.abs((r2.base.Si - r.base.Si) * 1000 - 10 * 75 * 0.85 / 1000 * 1000) < 1e-6, `合金计入分子分母恒 1000（Si 增 ${(r2.base.Si - r.base.Si).toFixed(4)}%）`);
      // 数据口径注：HT150 目标成分 CE 实算超出声明区间（UI 警示行的依据，数据未改）
      const t = CHARGE_TARGETS.HT150;
      const ce = t.C + 0.33 * (t.Si + t.P);
      assert(ce > 4.3, `HT150 CE 不自洽文档化（实算 ${ce.toFixed(2)} vs 声明 3.9~4.3）`);
    },
  },
  {
    name: '61-T9 castability 标签口径/超表标记/圆角下限',
    fn: () => {
      assert(SIZE_BUCKET.s === '轮廓≤200mm' && SIZE_BUCKET.l === '轮廓＞500mm', `分档标签单值口径 ${JSON.stringify(SIZE_BUCKET)}`);
      const d = draftAngles(1500, '金属/塑料', '树脂砂（自硬）');
      assert(d.outOfRange === true && d.outer === '20′' && d.inner === '30′', `H>1000 末档参考 ${d.outer}/${d.inner} out=${d.outOfRange}`);
      const d2 = draftAngles(50, '木模', '潮模砂（湿型）');
      assert(d2.outOfRange === false && d2.outer === '40′' && d2.inner === '1°15′', `H=50 木模粘土 ${d2.outer}/${d2.inner}`);
      const f = filletRadii(3);
      assert(f.outer === 2 && f.inner === 3, '薄壁工艺最小圆角 2/3mm');
      const f2 = filletRadii(12);
      assert(f2.outer === 3 && Math.abs(f2.inner - 4.8) < 1e-9, `正常壁厚按比例 ${f2.outer}/${f2.inner}`);
      assert(criticalWallOf(6) === 18, '临界壁厚 3×中值');
      const mw = minWallOf('灰铸铁(HT)', 300);
      assert(mw.text === '5~7' && mw.mid === 6 && mw.bucket === 'm', `中档分桶 ${mw.text}`);
    },
  },
  {
    name: '61-T10 defect 知识卡 0.5m/s 材质限定 + 全部 30 条来源字段完整',
    fn: () => {
      const dir = join(__dirname, '../data/defects');
      const files = readdirSync(dir).filter(f => f.endsWith('.json'));
      assert(files.length === 30, `缺陷 json 数（实际 ${files.length}）`);
      for (const f of files) {
        const doc = JSON.parse(readFileSync(join(dir, f), 'utf8'));
        assert(doc.id && doc.title, `${f} 基本字段`);
        assert(doc.reference?.book && doc.reference?.chapter, `${f} reference 书+章`);
        assert(['high', 'medium-high', 'medium'].includes(doc.confidence), `${f} confidence`);
      }
      const air = JSON.parse(readFileSync(join(dir, 'air_hole.json'), 'utf8'));
      const all = JSON.stringify(air.content);
      assert(all.includes('灰铁按浇注系统工具 ≤1.0 m/s') || all.includes('灰铁按工具上限 ≤1.0 m/s'), '气孔卡 0.5m/s 带材质限定');
      const slag = JSON.parse(readFileSync(join(dir, 'slag_inclusion.json'), 'utf8'));
      assert(JSON.stringify(slag.content).includes('灰铁按浇注系统工具 ≤1.0 m/s'), '夹渣卡 0.5m/s 带材质限定');
    },
  },
  {
    name: '61-T11 CT 标准引用层：现行 42124.3-2025 标注 + 数值表锁定（未改数据）',
    fn: () => {
      const note = CT_NOTE.join('');
      assert(note.includes('GB/T 42124.3-2025') && note.includes('DCTG15wt'), '注记含现行标准与壁厚专用级');
      assert(!note.includes('现行标准 GB/T 6414-2017'), '不再宣称 6414-2017 为现行');
      assert(note.includes('等级代号 DCTG，与图纸常用 CT 数值一致'), 'DCTG/CT 同值说明');
      // 数值锁定：与改动前一致（120mm CT10 → 3.6 / ±1.8）
      const t = ctTolerance(120, 'CT10');
      assert(t.value === 3.6 && t.half === 1.8, `CT10@120 锁定（实际 ${t.value}/${t.half}）`);
    },
  },
  {
    name: '61-T12 CT 新版标准边界：超表/≤16mm 高档无值/大尺寸低等级无值 均返回 null',
    fn: () => {
      assert(lookupCTRow(10001) === null, '>10000mm 超表返回 null');
      assert(lookupCTRow(10) !== null && lookupCTRow(10).row.hi === 10, '≤10 首行（含端点）');
      assert(ctTolerance(8, 'CT16') === null, '≤16mm 段 CT16 无表值（须个别标注）');
      assert(ctTolerance(8, 'CT13') === null, '≤16mm 段 CT13 无表值');
      assert(ctTolerance(8, 'CT12') !== null, '≤16mm 段 CT12 有值');
      assert(ctTolerance(300, 'CT1') === null, '大尺寸低等级（CT1@250~400）无表值');
      assert(ctTolerance(300, 'CT3') !== null, 'CT3@250~400 有值');
      // 等级不存在 → null
      assert(ctTolerance(120, 'CT17') === null, '不存在的等级 CT17 → null');
    },
  },
  {
    name: '61-T13 CT 推荐等级与中档解析锁定（方法×材质表 25 格未动）',
    fn: () => {
      assert(methodCTRec('砂型 · 手工造型', '灰铸铁') === '10~13', '手工砂型灰铁 10~13');
      assert(methodCTRec('熔模铸造', '铸钢') === '5~7', '熔模铸钢 5~7');
      assert(methodCTRec('压力铸造', '铝合金') === '4~7', '压铸铝 4~7');
      const flat = Object.values(CT_METHOD_GRADES).flatMap(Object.values).join(',');
      assert(flat.split(',').length === 25, `25 格完整（实际 ${flat.split(',').length}）`);
      const range = ctRange(120, '10~13');
      assert(range && range.min === 3.6 && range.max === 10 && range.mid === 6.8, `区间换算（实际 ${range?.min}/${range?.max}/${range?.mid}）`);
    },
  },
  {
    name: '61-T14 知识卡标准引用更新：ct_tolerance/inspection/machining_grade 不再以旧版为现行',
    fn: () => {
      const read = (f) => JSON.parse(readFileSync(join(__dirname, `../data/process/${f}`), 'utf8'));
      const ct = read('ct_tolerance.json');
      assert(JSON.stringify(ct).includes('GB/T 42124.3-2025'), 'ct_tolerance 引现行标准');
      assert(!JSON.stringify(ct.content).includes('查 GB/T 6414-1999 表'), 'ct_tolerance 不再指示按 1999 表查询');
      assert(JSON.stringify(ct.content).includes('DCTG'), 'ct_tolerance 含 DCTG 说明');
      const ins = read('inspection_dimension.json');
      assert(JSON.stringify(ins).includes('GB/T 42124.3-2025'), 'inspection_dimension 引现行标准');
      const mg = read('machining_grade.json');
      const mgTxt = JSON.stringify(mg);
      assert(mgTxt.includes('GB/T 42124.3-2025'), 'machining_grade 引现行标准');
      assert(mgTxt.includes('K24') && mgTxt.includes('A~K'), 'machining_grade 余量表到 K 级（不再 A~H 旧版）');
      assert(!mgTxt.includes('GB/T 6414-1999")') || mgTxt.includes('原 GB/T 6414-2017/1999'), 'machining_grade 无孤立的 1999 引用');
    },
  },
];
