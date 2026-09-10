// ============================================================
// PHASE 71.5（75.txt）· STL 自动工艺设计中心整合验证
//   T1  orig 语义：STL/派生自动值覆盖 → 保留原始值 → 一键恢复（§八）
//   T2  板块 A：来源标签/无伪精确最小壁厚（只给定性薄区信号）（§九/§十四）
//   T3  板块 B：castability 参考复用（材料×轮廓档/批量判定/拔模参考档）
//   T4  三信号启发：厚薄比 ≥3 / 多热结 / 薄区 → 风险行与说明（§九 6）
//   T5  计算器回归锁定：riser/gating/yield 数值不变（整合不碰引擎）
// ============================================================
import * as proj from '../js/model/CastingProject.js';
import { SRC, CONF } from '../js/model/CastingProject.js';
import { buildPage1Data, batchOfQty, THICK_RATIO_WARN, thinnRatioOf, CAST_MAT_KEY } from '../js/views/processPage1.js';
import { runRiser } from '../calcs/riser.js';
import { runGating } from '../calcs/gating.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

/* ---- 纯桩：v/ps（CastingProject 存取接口替身，不污染共享单例） ---- */
function stubPack(over = {}) {
  const store = {
    'material.family': { v: '灰铁', src: 'SCENARIO', conf: 'medium', editable: true },
    'material.solidDensity': { v: 7.0, src: 'SCENARIO', conf: 'medium', editable: true },
    'production.qty': { v: 1000, src: 'USER_INPUT', conf: 'user_confirmed', editable: true },
    'geometry.size': { v: [320, 180, 95], src: 'STL_GEOMETRY_ANALYSIS', conf: 'high', editable: false },
    'geometry.volumeCm3': { v: 2360, src: 'STL_GEOMETRY_ANALYSIS', conf: 'high', editable: true },
    'geometry.areaCm2': { v: 1680, src: 'STL_GEOMETRY_ANALYSIS', conf: 'high', editable: true },
    'geometry.netWeightKg': { v: 16.5, src: 'DERIVED', conf: 'high', editable: true },
    'geometry.blankWeightKg': { v: 16.5, src: 'DERIVED', conf: 'high', editable: true },
    'geometry.wallMax': { v: 18.5, src: 'STL_GEOMETRY_ANALYSIS', conf: 'high', editable: true },
    'geometry.wallHist': { v: [], src: 'STL_GEOMETRY_ANALYSIS', conf: 'medium', editable: false },
    'geometry.geomStatus': { v: 'VALID', src: 'STL_GEOMETRY_ANALYSIS', conf: 'high', editable: false },
    'process.wallUsed': { v: 4.2, src: 'STL_GEOMETRY_ANALYSIS', conf: 'high', editable: true },
    'process.mcHotspot': { v: 18.4, src: 'STL_GEOMETRY_ANALYSIS', conf: 'high', editable: true },
    'process.wallHot': { v: 2.1, src: 'DERIVED', conf: 'medium', editable: true },
    'hotspots.status': { v: 'ok', src: 'STL_GEOMETRY_ANALYSIS', conf: 'high', editable: false },
    'hotspots.reason': { v: '', src: 'STL_GEOMETRY_ANALYSIS', conf: 'medium', editable: false },
    'hotspots.items': { v: [
      { id: 1, x: 10, y: 20, z: 30, mc: 18.4, regionVolumeCm3: 240 },
      { id: 2, x: -5, y: 8, z: -12, mc: 9.2, regionVolumeCm3: 80 },
      { id: 3, x: 40, y: -20, z: 5, mc: 7.5, regionVolumeCm3: 55 },
    ], src: 'STL_GEOMETRY_ANALYSIS', conf: 'medium', editable: false },
    ...(over.store || {}),
  };
  return {
    v: (p) => (store[p] || {}).v,
    ps: (p) => store[p] || null,
    sampling: over.sampling !== undefined ? over.sampling : { warning: false, level: 'ok', detail: null, minWall: 0, minWallReliable: false },
    bodyRef: over.bodyRef ?? 3.6,
    hasStl: over.hasStl ?? true,
    manual: over.manual ?? false,
    geomStatus: over.geomStatus ?? 'VALID',
  };
}

const b = (d, title) => d.B.find(x => x.title === title);
const rowA = (d, key) => d.A.find(x => x.key === key);

export const tests = [
  {
    name: '71.5-T1a orig 语义：STL 自动值覆盖后保留原值、可一键恢复（§八）',
    fn: () => {
      proj.reset();
      proj.set('geometry.volumeCm3', 100, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
      assert(proj.get('geometry.volumeCm3').orig && proj.get('geometry.volumeCm3').orig.v === 100, '自动写入即基准');
      proj.set('geometry.volumeCm3', 120);   // 缺省 src → 自动 USER_OVERRIDE
      let p = proj.get('geometry.volumeCm3');
      assert(p.src === SRC.USER_OVERRIDE && p.v === 120 && p.orig.v === 100, `覆盖后保留原始值（v=${p.v} orig=${p.orig.v} src=${p.src}）`);
      assert(proj.restoreAutoValue('geometry.volumeCm3'), '可恢复');
      p = proj.get('geometry.volumeCm3');
      assert(p.v === 100 && p.src === SRC.STL_GEOMETRY_ANALYSIS, '恢复后值/来源还原');
      // 恢复后再改 → 以当前自动值为新基准（orig 随自动写入重建为 100，不残留旧覆盖语义）
      proj.set('geometry.volumeCm3', 130);
      p = proj.get('geometry.volumeCm3');
      assert(p.src === SRC.USER_OVERRIDE && p.orig.v === 100, `再覆盖基准 = 当前自动值（${p.orig.v}）`);
    },
  },
  {
    name: '71.5-T1b 派生值（DERIVED 毛坯重）同语义：orig 保留来源可整体还原',
    fn: () => {
      proj.reset();
      proj.set('geometry.blankWeightKg', 16.5, SRC.DERIVED, CONF.HIGH);
      proj.set('geometry.blankWeightKg', 20);
      const p = proj.get('geometry.blankWeightKg');
      assert(p.src === SRC.USER_OVERRIDE && p.orig.src === SRC.DERIVED && p.orig.v === 16.5, `orig 连来源一起保留（${p.orig.src}）`);
      assert(proj.restoreAutoValue('geometry.blankWeightKg'), '恢复成功');
      assert(proj.get('geometry.blankWeightKg').src === SRC.DERIVED, '恢复为派生来源');
      assert(proj.restoreAutoValue('geometry.blankWeightKg') === false, '非覆盖态恢复 = false');
    },
  },
  {
    name: '71.5-T1c STL 替换清理后旧 orig 不残留冒充',
    fn: () => {
      proj.reset();
      proj.set('geometry.volumeCm3', 200, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
      proj.set('geometry.volumeCm3', 300);   // 覆盖 orig=200
      proj.clearStlBoundData();              // 替换 STL 路径
      const p = proj.get('geometry.volumeCm3');
      assert(p.src === SRC.DEFAULT && p.v === 0, '替换后回默认空值');
      proj.set('geometry.volumeCm3', 500, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);   // 新 STL 写入
      assert(proj.get('geometry.volumeCm3').orig.v === 500, '新 STL 写入刷新基准（旧 orig 不残留）');
    },
  },
  {
    name: '71.5-T2a 板块 A 基础信息：尺寸/体积/重量/Mc 行与来源齐全',
    fn: () => {
      const d = buildPage1Data(stubPack());
      const expect = [['size', '320 × 180 × 95'], ['vol', '2360'], ['area', '1680'], ['netWt', '16.5'], ['blankWt', '16.5'], ['body', '3.6'], ['wallMax', '18.5']];
      for (const [k, vv] of expect) {
        const r = rowA(d, k);
        assert(r && String(r.value).includes(vv), `A.${k} 值含 ${vv}（实际 ${r && r.value}）`);
        assert(r.src === 'STL_GEOMETRY_ANALYSIS' || r.src === 'DERIVED', `A.${k} 带来源（${r.src}）`);
      }
      assert(rowA(d, 'hsN').value === '3 个', '热节数量');
      assert(rowA(d, 'mc').value === '18.4', '最大热结 Mc');
      assert(rowA(d, 'minwall').value.includes('采样正常'), '薄区检测行：无薄区时不报伪值');
    },
  },
  {
    name: '71.5-T2b 无伪精确最小壁厚：薄区只给"约 X mm 量级（定性）"，失败态不给数值',
    fn: () => {
      // 局部薄特征 → 量级行 + 检测配对
      const d1 = buildPage1Data(stubPack({ sampling: { warning: true, level: 'local_thin', detail: '局部薄特征', minWall: 1.4, minWallReliable: true } }));
      assert(rowA(d1, 'minwall').ok === false && String(rowA(d1, 'minwall').value).includes('约 1.4 mm 量级'), `薄区量级行（${rowA(d1, 'minwall').value}）`);
      const b1 = b(d1, '最小壁厚');
      assert(b1 && b1.lines[0].cls === 'warn' && b1.lines[0].text.includes('量级'), 'B1 配对检测行在最前');
      // 采样不足 → 不给数值
      const d2 = buildPage1Data(stubPack({ sampling: { warning: true, level: 'resolution', detail: '采样分辨率不足', minWall: 0, minWallReliable: false } }));
      assert(String(rowA(d2, 'minwall').value).includes('无法可靠测量'), '失败态不编造数值');
      // 手动模式无 STL → 明确"无检测"
      const d3 = buildPage1Data(stubPack({ hasStl: false, manual: true }));
      assert(String(rowA(d3, 'minwall').value).includes('无 STL 检测'), '手动模式不显示检测值');
    },
  },
  {
    name: '71.5-T3 板块 B 参考复用 castability：材料×轮廓档 / 批量 / 拔模参考档',
    fn: () => {
      const d = buildPage1Data(stubPack());
      const mw = b(d, '最小壁厚');
      assert(mw && mw.lines.some(l => l.text.includes('5~7') && l.text.includes('灰铸铁(HT)')), `灰铁 320mm → 中档 5~7（${mw.lines.map(l => l.text).join(' | ')}）`);
      const hole = b(d, '最小铸出孔径');
      assert(hole.lines.some(l => l.text.includes('成批生产') && l.text.includes('15~30')), 'qty=1000 → 成批 → 灰铁 15~30');
      assert(hole.lines.some(l => l.text.includes('未做孔特征识别')), '孔：声明未检测，不做 ✓/⚠ 判定');
      const draft = b(d, '拔模斜度');
      assert(draft.lines[0].text.includes('JB/T 5105-2022') && draft.lines.some(l => l.text.includes('实际值需根据分型面')), '拔模参考档文案（不伪造当前角度）');
      assert(batchOfQty(20000) === '大量生产' && batchOfQty(500) === '成批生产' && batchOfQty(10) === '单件小批', '批量判定阈值');
    },
  },
  {
    name: '71.5-T4 三信号启发：厚薄比 / 多热结 / 薄区 → 风险条与行',
    fn: () => {
      const pack = stubPack({
        sampling: { warning: true, level: 'local_thin', detail: '', minWall: 1.0, minWallReliable: true },
        bodyRef: 4.2,
        store: { 'geometry.wallMax': { v: 21, src: 'STL_GEOMETRY_ANALYSIS', conf: 'high', editable: true } },   // 21/4.2 = 5× ≥3
      });
      const d = buildPage1Data(pack);
      assert(thinnRatioOf(21, 4.2) >= THICK_RATIO_WARN, '厚薄比超阈值');
      // PHASE 78（78.txt 六）做减法：厚薄壁过渡/结构风险不再单独成卡，压缩进 notes 提示行
      assert(!b(d, '厚薄壁过渡') && !b(d, '结构风险（尖角/厚大/薄区）'), '两张卡已移除（做减法）');
      assert(d.B.length === 4, `只保留 4 张关键卡片（实际 ${d.B.length}）`);
      const noteTxt = d.notes.map(n => n.text).join(' ');
      assert(noteTxt.includes('多热结') && noteTxt.includes('未勾选的不计算'), `多热结说明折进提示行（${noteTxt.slice(0, 40)}）`);
      assert(noteTxt.includes('厚薄突变信号') && noteTxt.includes('= 5×'), '厚薄突变折进提示行');
      const riskTxt = d.risks.map(r => r.text).join(' ');
      assert(riskTxt.includes('厚薄突变 5×') && riskTxt.includes('3 处厚大热结') && riskTxt.includes('检出薄区'), `风险条三信号（${riskTxt}）`);
      // 低风险场景 → ✅ 行
      const d2 = buildPage1Data(stubPack({
        store: { 'geometry.wallMax': { v: 6, src: 'STL_GEOMETRY_ANALYSIS', conf: 'high', editable: true },
                 'hotspots.items': { v: [], src: 'STL_GEOMETRY_ANALYSIS', conf: 'medium', editable: false },
                 'hotspots.status': { v: 'NO_HOTSPOT', src: 'STL_GEOMETRY_ANALYSIS', conf: 'high', editable: false },
                 'hotspots.reason': { v: 'uniform', src: 'STL_GEOMETRY_ANALYSIS', conf: 'medium', editable: false } },
      }));
      const s2 = d2.A.find(x => x.label === 'Hotspot 状态 / 置信度');
      assert(s2.value.includes('均匀'), 'uniform 原因 → 状态行如实表述均匀件');
      assert(d2.notes.length === 0, '均匀件：无风险提示（notes 为空，不谎报风险）');
      // no_candidate（非均匀件未达阈值）→ 禁止"均匀属正常"表述（74 防伪纪律）
      const d3 = buildPage1Data(stubPack({
        store: { 'hotspots.items': { v: [], src: 'STL_GEOMETRY_ANALYSIS', conf: 'medium', editable: false },
                 'hotspots.status': { v: 'NO_HOTSPOT', src: 'STL_GEOMETRY_ANALYSIS', conf: 'high', editable: false },
                 'hotspots.reason': { v: 'no_candidate', src: 'STL_GEOMETRY_ANALYSIS', conf: 'medium', editable: false } },
      }));
      const s3 = d3.A.find(x => x.label === 'Hotspot 状态 / 置信度');
      assert(!s3.value.includes('均匀') && s3.value.includes('未检出热结候选'), 'no_candidate → 不冒充均匀件');
      // 做减法后该提示改由 notes 承载（内容与口径不变）
      assert(d3.notes.some(n => n.text.includes('超出采样分辨率')), 'no_candidate → 保守估算提示（notes）');
    },
  },
  {
    name: '71.5-T5 引擎锁定：riser/gating 数值与整合前一致（直接调 runRiser/runGating）',
    fn: () => {
      const r = runRiser({ mat: '球铁', cast_wt: 50, mc_mode: 'direct', mc: 15, shape: 'sphere_head', hd_ratio: 1.0 });
      assert(r && r.D === 113 && r.H === 113 && r.d_neck === 60, `球铁 Mc15 锁定（D=${r && r.D} d_neck=${r && r.d_neck}）`);
      // 基线 = 整合前既有引擎输出（71.5 快照；引擎零改动，此值由既有公式链确定性产生）
      const g = runGating({ mat: '灰铁(HT)', pw: 100, cav: 1, wall: 12, pos: '中注', Ho: 250, ph: 200, rh: 0, ratioKey: '封闭式 常用型', gc: 2, gt: 15, rc: 2, rt: 25 });
      assert(g && g.D_sp === 35 && Math.abs(g.t - 15.63) < 0.02, `灰铁 100kg 中注锁定（D_sp=${g && g.D_sp} t=${g && g.t}）`);
    },
  },
];
