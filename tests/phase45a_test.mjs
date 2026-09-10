// ============================================================
// PHASE 45-A/B：Gating 输入可理解性 + 过滤网 UX + 内浇道形状
//   A. 浇注方向示意图（SVG 纯函数）：三方向互不串、只标 Ho/ph/rh、砂箱/倒梯形浇口杯
//   B. 过滤网"使用/不使用"：fv−0.1 企业规则单点生效、A/尺寸变化、无重复扣减
//   C. 过滤网自动推荐：满足过流量 → 接近优先排序；无满足 → 如实提示
//   D. 内浇道圆形分支 + 瓷管建议 + 出品率联动数据
// ============================================================
import { gatingDiagramSvg } from '../js/views/gatingDiagram.js';
import { runGating, MATERIALS } from '../calcs/gating.js';
import { rankFilters } from '../calcs/filter.js';
import { suggestCeramicTube, CERAMIC_TUBES } from '../data/ceramic_tube.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

// ---- A. 浇注方向示意图 ----
const TOP = gatingDiagramSvg('顶注');
const MID = gatingDiagramSvg('中注');
const BOT = gatingDiagramSvg('底注');

export const tests = [
  {
    name: '45-B1 三张图基础结构（砂箱最宽包全部/浇口杯直浇道同中心一体/流路一线：直浇道→横浇道→内浇口更薄/冒口窄于铸件/无文字冗余）',
    fn: () => {
      for (const [pos, svg] of [['顶注', TOP], ['中注', MID], ['底注', BOT]]) {
        // 闭合砂箱矩形最宽（322，右沿 337 到图片边，包住浇道/冒口/铸件/内浇口）
        assert(svg.includes('<rect x="15" y="25" width="322" height="195"'), `${pos}图砂箱应最宽包全部`);
        // 浇口杯底宽=直浇道顶宽（246..264 同中心连续收窄）；浇口杯/直浇道橙色系
        assert(svg.includes('246,24 264,24') && svg.includes('#ffe8cc') && svg.includes('#ffd8a8'), `${pos}图浇口杯应与直浇道同轴一体`);
        // 流路：横浇道扁条（浅蓝 23×8）+ 内浇口同轴更薄（深蓝 20×4，= 横浇道一半高）
        assert(svg.includes('fill="#a5d8ff"') && svg.includes('fill="#1971c2"') && svg.includes('width="23" height="8"') && svg.includes('width="20" height="4"'),
          `${pos}图横浇道/内浇口应为扁条且内浇口更薄`);
        // 冒口窄于铸件（60 < 100）
        assert(svg.includes('width="60"') && svg.includes('width="100"'), `${pos}图冒口应窄于铸件`);
        // 标签：冒口/铸件/内浇口/浇口杯有，直浇道/横浇道无文字标识
        assert(svg.includes('>冒口<') && svg.includes('>铸件<') && svg.includes('>内浇口<') && svg.includes('>浇口杯<'),
          `${pos}图应有对象标签`);
        assert(!svg.includes('>直浇道<') && !svg.includes('>横浇道<'), `${pos}图不应有直浇道/横浇道文字标识`);
        assert(!svg.includes('分型线'), `${pos}图不应有分型线`);
      }
    },
  },
  {
    name: '45-B2 尺寸标注只留用户输入的三项（Ho/ph/rh），无 P/C',
    fn: () => {
      for (const [pos, svg] of [['顶注', TOP], ['中注', MID], ['底注', BOT]]) {
        assert(svg.includes('>Ho<') && svg.includes('>ph<') && svg.includes('>rh<'),
          `${pos}图应标 Ho/ph/rh 三根尺寸线`);
        assert(!svg.includes('P =') && !svg.includes('C = ph + rh'), `${pos}图不得出现 P/C 标注`);
      }
    },
  },
  {
    name: '45-B3 Ho 尺寸线基准随浇注方向变化（内浇口中心层→上箱面）；内浇口在铸件范围内',
    fn: () => {
      assert(TOP.includes('y1="102"') && TOP.includes('y2="25"'), '顶注 Ho 线从内浇口(102)到上箱面(25)');
      assert(MID.includes('y1="150"'), '中注 Ho 线起点在铸件中部(150)');
      assert(BOT.includes('y1="196"'), '底注 Ho 线起点在铸件底部内(196)');
      // 内浇口水平薄条 rect 在铸件范围（y≥95 且 y+4≤200）内
      const gateRect = TOP.match(/<rect x="215" y="(\d+)" width="20" height="4"/);
      assert(gateRect && +gateRect[1] >= 95 && +gateRect[1] + 4 <= 200, `顶注内浇口应在铸件范围内（y=${gateRect?.[1]}）`);
    },
  },
  {
    name: '45-B4 非法浇注方向返回 null',
    fn: () => {
      assert(gatingDiagramSvg('侧注') === null, '非法 pos 应返回 null');
      assert(gatingDiagramSvg(undefined) === null, 'undefined pos 应返回 null');
    },
  },

  // ---- B. 过滤网 fv−0.1 企业规则 ----
  {
    name: '45-B5 使用过滤网 → fv−0.1（顶 0.8→0.7/中 0.6→0.5/底 0.45→0.35），A 随之增大',
    fn: () => {
      const base = { mat: '灰铁(HT)', pw: 50, cav: 1, yr: 75, wall: 20, Ho: 150, ph: 100, rh: 50 };
      const exp = { 顶注: [0.8, 0.7], 中注: [0.6, 0.5], 底注: [0.45, 0.35] };
      for (const [pos, [fv0, fv1]] of Object.entries(exp)) {
        const r0 = runGating({ ...base, pos, filterUsed: false });
        const r1 = runGating({ ...base, pos, filterUsed: true });
        assert(Math.abs(r0.fv - fv0) < 1e-9 && Math.abs(r1.fv - fv1) < 1e-9,
          `${pos} fv 应 ${fv0}→${fv1}（实际 ${r0.fv}→${r1.fv}）`);
        assert(r1.A > r0.A, `${pos} 使用过滤网后 A 应增大（${r0.A.toFixed(1)}→${r1.A.toFixed(1)}）`);
        assert(r1.D_sp >= r0.D_sp && r1.A_gt > r0.A_gt, `${pos} 组元尺寸应随 A 变化`);
        assert(r1.fvBase === fv0, `${pos} fvBase 应保持原值 ${fv0}`);
      }
    },
  },
  {
    name: '45-B6 无重复扣减：幂等、不传参数默认不使用',
    fn: () => {
      const base = { mat: '球铁(QT)', pw: 30, cav: 1, yr: 65, wall: 15, pos: '底注', Ho: 120, ph: 80, rh: 40, filterUsed: true };
      const r1 = runGating(base);
      const r2 = runGating(base);
      assert(Math.abs(r1.fv - 0.35) < 1e-9, `底注球铁使用过滤网 fv=0.35（实际 ${r1.fv}），不得重复扣减`);
      assert(Math.abs(r1.fv - r2.fv) < 1e-9, '幂等：两次相同输入 fv 一致');
      const r3 = runGating({ ...base, filterUsed: undefined });
      assert(Math.abs(r3.fv - 0.45) < 1e-9, '不传 filterUsed → fv 保持 0.45（默认不使用，兼容旧调用）');
    },
  },

  // ---- C. 过滤网自动推荐 ----
  {
    name: '45-C1 满足过流量的型号按接近需求优先排名（非越大越好）',
    fn: () => {
      const r = rankFilters(500, '灰铁');
      assert(r && r.feasible, 'G=500 灰铁应有满足型号');
      assert(r.list[0].spec.id === 'sic_120', `首位应是最接近需求的 600（实际 ${r.list[0].spec.id} ${r.list[0].capacity}）`);
      assert(r.list.every((it, i) => i === 0 || r.list[i - 1].capacity <= it.capacity), '列表应按 capacity 升序');
      const r2 = rankFilters(300, '灰铁');
      assert(r2.list[0].spec.id === 'sic_100', `G=300 灰铁首位应是最接近的 sic_100（400kg）`);
      assert(r2.list.length === 7, `G=300 灰铁满足型号应 7 个（实际 ${r2.list.length}）`);
      const r3 = rankFilters(250, '球铁');
      assert(r3.feasible && r3.list[0].spec.id === 'sic_120', `G=250 球铁首位应 sic_120(300)`);
      const r4 = rankFilters(300, '灰铁');
      assert(Math.abs(r4.list[0].usedPct - 75) < 1e-9, 'usedPct = G/capacity×100 = 75%');
    },
  },
  {
    name: '45-C2 无满足型号 → feasible=false 且如实给出需求与最大可用（不伪造推荐）',
    fn: () => {
      const r = rankFilters(1500, '灰铁');
      assert(r && r.feasible === false, 'G=1500 灰铁应无满足型号');
      assert(r.demand === 1500 && r.maxCapacity === 1200, '应如实报告需求 1500 vs 最大可用 1200');
      assert(r.list.length === 0, '无满足时列表为空');
      const r2 = rankFilters(2500, '球铁');
      assert(r2 && r2.feasible === false && r2.maxCapacity === 2200, '球铁 G=2500 无满足，最大 2200');
    },
  },
  {
    name: '45-C3 无企业标准的材料（铸钢/铝/铜）与非法 G 返回 null',
    fn: () => {
      assert(rankFilters(300, '铸钢') === null, '铸钢无企业标准 → null');
      assert(rankFilters(300, '铝合金') === null, '铝合金无企业标准 → null');
      assert(rankFilters(0, '灰铁') === null, 'G=0 → null');
      assert(rankFilters(-5, '灰铁') === null, 'G<0 → null');
    },
  },

  // ---- E. 排气（PHASE 45-B：二选一 + 区间判定 1.5~4 + 建议生成） ----
  {
    name: '45-E1 排气判定区间 1.5~4（企业标准）：不足/达标/过大 三态',
    fn: () => {
      // 构造：直浇道面积 Fs_act 固定，调节排气面积
      const base = { mat: '灰铁(HT)', pw: 50, cav: 1, yr: 75, wall: 20, pos: '顶注', Ho: 150, ph: 100, rh: 50, gc: 2, gt: 15 };
      // 先取得 Fs_act（直浇道面积）
      const ref = runGating({ ...base });
      const fs = ref.Fs_act;
      // 排气不足：面积 = 1.2×Fs → vr=1.2 <1.5
      const rLow = runGating({ ...base, ventType: '圆孔', vr: Math.sqrt(4 * fs * 1.2 / Math.PI), vrc: 1 });
      assert(rLow.vr_ok === false && rLow.vr < 1.5, `排气不足应判不合格（vr=${rLow.vr.toFixed(2)}）`);
      assert(rLow.sugs.some(s => s.includes('排气')), '排气不足应有建议');
      // 达标：2×Fs
      const rOk = runGating({ ...base, ventType: '圆孔', vr: Math.sqrt(4 * fs * 2 / Math.PI), vrc: 1 });
      assert(rOk.vr_ok === true && rOk.vr > 1.5 && rOk.vr < 4, `排气 2 倍应合格（vr=${rOk.vr.toFixed(2)}）`);
      // 过大：5×Fs
      const rBig = runGating({ ...base, ventType: '圆孔', vr: Math.sqrt(4 * fs * 5 / Math.PI), vrc: 1 });
      assert(rBig.vr_ok === false && rBig.vr > 4, `排气 5 倍应判不合格（vr=${rBig.vr.toFixed(2)}）`);
      assert(rBig.sugs.some(s => s.includes('过大')), '排气过大应有建议');
    },
  },
  {
    name: '45-E2 排气二选一：ventType 只算选中形式；显式传参兼容旧调用',
    fn: () => {
      const base = { mat: '灰铁(HT)', pw: 50, cav: 1, yr: 75, wall: 20, pos: '顶注', Ho: 150, ph: 100, rh: 50, gc: 2, gt: 15 };
      // 显式传参（兼容路径，设计中心旧调用）
      const rR = runGating({ ...base, ventType: '圆孔', vr: 12, vrc: 4, vs: 0, vst: 0, vsc: 0 });
      const rS = runGating({ ...base, ventType: '方片', vr: 0, vrc: 0, vs: 50, vst: 8, vsc: 2 });
      assert(Math.abs(rR.vt - Math.PI * 144 / 4 * 4) < 1e-9, '圆孔只算圆孔面积');
      assert(Math.abs(rS.vt - 50 * 8 * 2) < 1e-9, '方片只算方片面积');
    },
  },
  {
    name: '45-E3 排气自动生成（用户不填）：圆孔 3mm 优先、数量超 40 才升 4/5、方片薄≤3mm、vr≥1.5',
    fn: () => {
      const base = { mat: '灰铁(HT)', pw: 50, cav: 1, yr: 75, pos: '顶注', Ho: 150, ph: 100, rh: 50, gc: 2, gt: 15 };
      // 中件：3mm 数量超 40 → 逐级升 4/5（最多到 5）
      const r20 = runGating({ ...base, wall: 20 });
      assert(r20.sugVent?.round.d >= 3 && r20.sugVent?.round.d <= 5, `圆孔应从 3mm 起逐级升（实际 ${r20.sugVent?.round.d}）`);
      assert(r20.sugVent.round.n <= 40 || r20.sugVent.round.d === 5, '数量应受 40 上限约束（升到 5 为止）');
      assert(r20.sugVent.square.t === 3, `方片厚 = min(3, 壁厚) = 3（薄排气片）`);
      assert(r20.vt === Math.PI * r20.sugVent.round.d ** 2 / 4 * r20.sugVent.round.n, '不传参数 → vt 自动采用圆孔建议');
      assert(r20.vr >= 1.5, `自动生成后 vr 应 ≥1.5（实际 ${r20.vr.toFixed(2)}）`);
      assert(r20.vr_ok === true, '自动生成应在 1.5~4 区间内');
      // 小 Fs（轻件）：3mm 数量不超 40 → 保持 3mm
      const rLight = runGating({ ...base, pw: 0.8 });
      assert(rLight.sugVent?.round.d === 3, `轻件应保持 3mm 细长出气孔（实际 ${rLight.sugVent?.round.d}）`);
      assert(rLight.sugVent.round.n <= 40, '轻件 3mm 数量 ≤40');
      // 方片形式：vt 用方片建议
      const rSq = runGating({ ...base, wall: 20, ventType: '方片' });
      assert(Math.abs(rSq.vt - 50 * 3 * rSq.sugVent.square.n) < 1e-9, '方片形式 vt = 方片建议面积');
      assert(rSq.vr >= 1.5, '方片自动生成 vr ≥1.5');
    },
  },

  // ---- D. 内浇道圆形 + 瓷管 + 出品率联动数据 ----
  {
    name: '45-D1 圆形内浇道：直径自动反推、面积正确；方形行为不变（默认）',
    fn: () => {
      const base = { mat: '灰铁(HT)', pw: 50, cav: 1, yr: 75, wall: 20, pos: '顶注', Ho: 150, ph: 100, rh: 50, optimize: true };  // P50：几何基准=推荐面积入口
      const sq = runGating({ ...base, gateShape: '方形', gc: 2, gt: 15 });
      assert(sq.gateShape === '方形' && sq.D_g === 0, '方形：D_g=0、gateShape=方形');
      assert(sq.L_g > 0 && sq.Fg > 0, '方形：长度与面积正常');
      const sq2 = runGating({ ...base, gc: 2, gt: 15 });   // 不传 gateShape
      assert(sq2.gateShape === '方形' && Math.abs(sq2.Fg - sq.Fg) < 1e-9, '不传 gateShape → 默认方形且面积一致（兼容）');
      const rd = runGating({ ...base, gateShape: '圆形', gc: 2 });
      assert(rd.gateShape === '圆形', 'gateShape=圆形 生效');
      // 直径反推（向上取整，宁大勿小）：D_g = ceil(√(4×A_rec/(gc×π)))，A_rec=推荐面积（PHASE 48-B 几何基准）
      assert(rd.A_rec >= rd.A_gt, 'A_rec 不应小于奥赞参考 A_gt（只放大不缩小）');
      const d = Math.max(3, Math.ceil(Math.sqrt(4 * rd.A_rec / (2 * Math.PI))));
      assert(rd.D_g === d, `圆形直径应=${d}（实际 ${rd.D_g}，A_rec=${rd.A_rec.toFixed(0)}）`);
      assert(Math.abs(rd.Fg - 2 * Math.PI * d * d / 4) < 1e-9, '圆形面积 = gc×πd²/4');
      assert(rd.Fg >= rd.A_rec, `圆形面积应 ≥ 推荐面积 A_rec（取整宁大勿小，实际 ${rd.Fg.toFixed(0)} vs ${rd.A_rec.toFixed(0)}）`);
      assert(rd.L_g === 0, '圆形不产生长度');
      // 圆形直径影响实际比例校核（Fg 参与 rrv/rgv 或流速）
      assert(rd.Fg > 0, '圆形 Fg 参与校核');
    },
  },
  {
    name: '45-D2 瓷管建议：内径≥需求直径的最小规格；超出 F70 如实提示',
    fn: () => {
      assert(CERAMIC_TUBES.length === 6 && CERAMIC_TUBES[0].id === 'F25' && CERAMIC_TUBES[5].id === 'F70',
        '瓷管规格 F25~F70 共 6 个（企业表）');
      const r1 = suggestCeramicTube(16);
      assert(r1.tube?.id === 'F25' && r1.tube.inner === 22, 'd=16 → F25(内径 22)');
      const r2 = suggestCeramicTube(22);
      assert(r2.tube?.id === 'F25', 'd=22 → F25（内径≥需求）');
      const r3 = suggestCeramicTube(50);
      assert(r3.tube?.id === 'F60' && r3.tube.inner === 57, 'd=50 → F60(57)（保守：内径≥需求的最小规格）');
      const r3b = suggestCeramicTube(40);
      assert(r3b.tube?.id === 'F50' && r3b.tube.inner === 47, 'd=40 → F50(47)');
      const r4 = suggestCeramicTube(70);
      assert(r4.outOfRange === true && r4.maxInner === 67, 'd=70 超出 F70(67) → outOfRange');
      assert(suggestCeramicTube(0) === null && suggestCeramicTube(-1) === null, 'd≤0 → null');
      const r5 = suggestCeramicTube(67);
      assert(r5.tube?.id === 'F70', 'd=67 → F70');
    },
  },
  {
    name: '45-D3 出品率联动数据：五材质 y_sug 建议值（材质 change → yr 自动填）',
    fn: () => {
      const exp = { '灰铁(HT)': 75, '球铁(QT)': 65, '铸钢(ZG)': 58, '铝合金(Al)': 80, '铜合金(Cu)': 62 };
      for (const [mat, sug] of Object.entries(exp)) {
        assert(MATERIALS[mat]?.y_sug === sug, `${mat} y_sug 应 ${sug}（实际 ${MATERIALS[mat]?.y_sug}）`);
      }
      // 出品率用于 G=pw×cav/(yr/100)，切换材质（yr 随 y_sug）→ G 正确变化
      const base = { mat: '灰铁(HT)', pw: 50, cav: 1, wall: 20, pos: '顶注', Ho: 150, ph: 100, rh: 50 };
      const g_ht = runGating({ ...base, yr: 75 });
      const g_qt = runGating({ ...base, mat: '球铁(QT)', yr: 65 });
      assert(Math.abs(g_ht.G - 50 / 0.75) < 1e-9 && Math.abs(g_qt.G - 50 / 0.65) < 1e-9, 'G 随出品率联动变化');
    },
  },
];
