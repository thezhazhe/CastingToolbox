// ============================================================
// PHASE 70 — 垂直造型线小件浇注系统计算器 测试
// 方法来源：DISA 砂造型系统应用手册（2003）第 6.8~6.12 节
// 结构：单元 / 手册算例复现（逐项）/ 四方式独立性 / 多层 / 边界(A-F) / 量纲反向推导 / 隔离性
// ============================================================
import { readFileSync } from 'node:fs';
import { verticalDiagramSvg } from '../js/views/verticalDiagram.js';
import {
  runVerticalGating, recommendedPourTime, secArea, gateVelocityMs, flowVelocityMs, expIngateM,
  runnerAFromArea, trapezoidArea, runnerStd, gateDims, pourB,
  G_MM_S2, VG_MATERIALS, M_INGATE, M_RUNNER, S_DEFAULT_MM, normTime,
  recommendIngateS, gateLossMFromRatio, headFromPosition,
} from '../calcs/verticalGating.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const near = (a, b, eps = 1e-6, msg = '') => assert(Math.abs(a - b) <= eps, `${msg} |${a} - ${b}| > ${eps}`);
const finite = (v, msg) => assert(Number.isFinite(v) && v > 0, `${msg}: ${v}`);

/** 手册 6.11 基准输入（连接盘：灰铁 0.7kg、壁厚 20、480 型/h、3 层） */
const BASE = { mat: '灰铸铁', Gc: 0.7, wallMm: 20, moldSpeed: 480, H: [135, 260, 385], n: [2, 2, 2], t: 4, sIngate: 3, mIngate: 0.5, mRunner: 0.7, yieldRate: 0.7 };

export const tests = [
  // ═══════════ 一、单元测试 ═══════════
  {
    name: 'U1 常数：g=9810；k 与 ρ 推导关系 1/(ρ·√(2g)) ≈ 手册 k（1036/850/3100）',
    fn: () => {
      assert(G_MM_S2 === 9810, 'g');
      for (const [mat, want] of [['灰铸铁', 1036], ['铜合金', 850], ['铝合金', 3100]]) {
        const M = VG_MATERIALS[mat];
        const derive = 1 / (M.rhoKgMm3 * Math.sqrt(2 * G_MM_S2));
        assert(Math.abs(derive - want) / want < 0.01, `${mat}: 推导 ${derive.toFixed(1)} vs 手册 ${want}`);
      }
    },
  },
  {
    name: 'U2 截面公式 F=k·G/(m·t·√H)：与密度式 F=G/(ρ·t·m·√(2gH)) 等价（量纲一致）',
    fn: () => {
      const M = VG_MATERIALS['灰铸铁'];
      const F1 = secArea(M.k, 2.8, 0.7, 4, 385);
      const F2 = 2.8 / (M.rhoKgMm3 * 4 * 0.7 * Math.sqrt(2 * G_MM_S2 * 385));
      assert(Math.abs(F1 - F2) / F2 < 2e-4, `k 式与密度式相对差 ${Math.abs(F1 - F2) / F2 * 100}%（k 手册舍入 1036 vs 精确 1036.2）`);
    },
  },
  {
    name: 'U3 口速 V=m√(2gH)：H=135/m=0.5 → 0.814 m/s；H=385 → 1.374（手册算例值）',
    fn: () => {
      near(gateVelocityMs(0.5, 135), 0.814, 0.002, 'V135');
      near(gateVelocityMs(0.5, 385), 1.374, 0.002, 'V385');
    },
  },
  {
    name: 'U4 受控流量速度 v=G/(ρtF)：减压例（0.7kg/4s/46.5mm²/铁）≈0.55 m/s ≤1 限速',
    fn: () => {
      const v = flowVelocityMs(0.7, VG_MATERIALS['灰铸铁'].rhoKgMm3, 4, 46.5);
      near(v, 0.546, 0.005, 'flow v');
    },
  },
  {
    name: 'U5 标准流道取型 3a²≥req（复现手册全部选型：减压 26.4→a4(受最小48)、64.3→a5、133.8→a7、230.9→a9、322.5→a10.5；加压 F5→a10）',
    fn: () => {
      const sel = (req, min) => { const a = runnerAFromArea(Math.max(req, min)); return { a, area: trapezoidArea(a) }; };
      assert(sel(64.3, 0).a === 5 && sel(64.3, 0).area === 75, '64.3→a5');
      assert(sel(133.8, 0).a === 7 && sel(133.8, 0).area === 147, '133.8→a7');
      assert(sel(26.4, 48).a === 4 && sel(26.4, 48).area === 48, '26.4+min48→a4=48');
      assert(sel(322.5, 0).a === 10.5 && sel(322.5, 0).area === 330.75, '322.5→a10.5');
      assert(sel(230.9, 0).a === 9 && sel(230.9, 0).area === 243, '230.9→a9');
      assert(sel(300, 0).a === 10, '300→a10');
      // 与 runnerStd 一致性（最小截面约束）
      assert(runnerStd(26.4, 48).dims === '4/8×8', 'runnerStd min');
      assert(runnerStd(300).dims === '10/20×20', 'runnerStd 300');
    },
  },
  {
    name: 'U6 浇注时间推荐：480型/h 灰铁 0.7kg/20mm → tmax1=4.5、tmax2=4.2、tRec=4.2（手册 6.11.3.1）',
    fn: () => {
      const rec = recommendedPourTime({ mat: '灰铸铁', Gc: 0.7, wallMm: 20, moldSpeed: 480 });
      near(rec.tmax1, 4.5, 1e-9, 'tmax1');
      near(rec.tmax2, 4.2, 0.05, 'tmax2');
      assert(rec.tRec === 4.2, `tRec=${rec.tRec}`);
      assert(rec.note.length >= 2, 'note');
    },
  },
  {
    name: 'U7 B 表分档：壁厚 3-5 G≤1→3；>20 G≥4→3；5-10 G=2kg 线性插值 ≈3.33（U2 标注）',
    fn: () => {
      assert(pourB(4, 0.5) === 3, '3-5/G0.5→3');
      assert(pourB(30, 5) === 3, '>20/G5→3');
      assert(pourB(25, 0.5) === 6, '>20/G0.5→6');
      near(pourB(8, 2), 3.3333, 1e-3, '插值');
      // 轻金属 ×1.5
      const al = recommendedPourTime({ mat: '铝合金', Gc: 0.7, wallMm: 20, moldSpeed: 480 });
      near(al.tmax2, 5 * 1.5 * Math.sqrt(0.7), 0.01, '铝 B×1.5');
    },
  },
  {
    name: 'U8 输入顺序不敏感：H 升序/降序 结果一致（内部自动识别方向）',
    fn: () => {
      const up = runVerticalGating({ ...BASE, system: 'pressurized', H: [135, 260, 385] });
      const dn = runVerticalGating({ ...BASE, system: 'pressurized', H: [385, 260, 135] });
      const dnRev = runVerticalGating({ ...BASE, system: 'pressurized', H: [385, 260, 135], n: [2, 2, 2] });
      assert(up.ok && dn.ok && dnRev.ok, 'ok');
      // 加压式单段：只随层集合相同而相同（排序后比较）
      const sumA = (r) => r.runnerSegs.map((s) => `${s.H}|${s.Fstd}`).sort().join(',');
      assert(sumA(up) === sumA(dn), `H 方向应不影响减压段结果:\n${sumA(up)}\n${sumA(dn)}`);
      assert(sumA(up) === sumA(dnRev), 'dnRev');
    },
  },
  {
    name: 'U9 取整规则：normTime 0.5~60；ceilHalf；gateDims 面积 ≥ 需求',
    fn: () => {
      assert(normTime(4.18) === 4.2 && normTime(0.05) === 0.5 && normTime(100) === 60, 'normTime');
      const g = gateDims(31.2, 3);
      assert(g.l === 10.5 && g.area >= 31.2 && g.area - 31.2 < 1, `gateDims ${g.l}`);
      const g2 = gateDims(18.5, 3);
      assert(g2.l === 6.5, `第三层建议 6.5（手册例 6，U5）：${g2.l}`);
      assert(gateDims(45.6, 3).l === 15.5, 'F9 15.5');
    },
  },

  // ═══════════ V1.1：s 自动推荐 / 图6.38 m 查表 / 压头几何→H ═══════════
  {
    name: 'V1.1-1 内浇口厚度自动推荐 recommendIngateS：wall20→3（手册例复现）；10→1.5；<7→1 下限；单调不减',
    fn: () => {
      assert(recommendIngateS(20) === 3, `wall20→3（手册例），got ${recommendIngateS(20)}`);
      assert(recommendIngateS(10) === 1.5, `wall10→1.5，got ${recommendIngateS(10)}`);
      assert(recommendIngateS(15) === 2.5, `wall15→2.5，got ${recommendIngateS(15)}`);
      for (const w of [1, 2, 3, 5, 6]) assert(recommendIngateS(w) === 1, `wall${w}→1（手册 s≥1mm 下限）`);
      assert(recommendIngateS(0) === 1 && recommendIngateS(-5) === 1, '非法输入退化到下限');
      let prev = 0;
      for (const w of [3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 18, 20, 25, 30, 40]) {
        const v = recommendIngateS(w);
        assert(v >= prev, `wall ${w} 单调不减: ${v} < ${prev}`);
        prev = v;
      }
      // 落手册范围 [0.25,1.0]×Mc（Mc≈wall/3）
      for (const w of [8, 10, 20, 30, 50]) {
        const mc = w / 3;
        const v = recommendIngateS(w);
        assert(v >= 0.25 * mc - 1e-9 && v <= mc + 1e-9, `wall${w}: s=${v} 落 [25%,100%]Mc=[${(0.25 * mc).toFixed(2)},${mc.toFixed(2)}]`);
      }
    },
  },
  {
    name: 'V1.1-2 图6.38 m 查表 gateLossMFromRatio：≤1.5→0.3、2~3→0.5、>3→0.6（手册档 1-1.5/2-3/3-5）',
    fn: () => {
      assert(gateLossMFromRatio(1) === 0.3 && gateLossMFromRatio(1.5) === 0.3, '档1-1.5→0.3');
      assert(gateLossMFromRatio(2) === 0.5 && gateLossMFromRatio(2.5) === 0.5 && gateLossMFromRatio(3) === 0.5, '档2-3→0.5');
      assert(gateLossMFromRatio(3.5) === 0.6 && gateLossMFromRatio(10) === 0.6, '档3-5→0.6（>5 不外推）');
    },
  },
  {
    name: 'V1.1-3 压头几何→H（headFromPosition）：top H=a；bottom H=a−c/2；side H=a−b/2；非法→NaN',
    fn: () => {
      assert(headFromPosition('top', 135, 0) === 135, 'top H=a');
      assert(Math.abs(headFromPosition('bottom', 385, 100) - 335) < 1e-9, 'bottom H=a−c/2');
      assert(Math.abs(headFromPosition('side', 260, 50) - 235) < 1e-9, 'side H=a−b/2');
      assert(Number.isNaN(headFromPosition('bottom', 385, 800)), 'c 过大 → NaN（负 H 语义禁）');
      assert(Number.isNaN(headFromPosition('side', 0, 50)), 'a=0 → NaN');
      assert(Number.isNaN(headFromPosition('top', 135, NaN)) === false, 'top 忽略 bc');
      assert(headFromPosition('top', 135, NaN) === 135, 'top 不读 bc');
    },
  },
  {
    name: 'V1.1-4 几何→H 与引擎集成：bottom a=385/c=100 → H=335 驱动加压计算 = 直接 H=335 一致',
    fn: () => {
      const H = headFromPosition('bottom', 385, 100);
      const r1 = runVerticalGating({ ...BASE, system: 'pressurized', H: [H, 260, 135] });
      const r2 = runVerticalGating({ ...BASE, system: 'pressurized', H: [335, 260, 135] });
      assert(r1.ok && r2.ok, 'ok');
      r1.gates.forEach((g, i) => near(g.Fsingle, r2.gates[i].Fsingle, 1e-9, `层${i + 1} 一致`));
    },
  },
  {
    name: 'V1.1-5 不加压引擎保留（deprecated）但 commonU 清单不污染加压结果：加压 5 条、不加压 7 条',
    fn: () => {
      const p = runVerticalGating({ ...BASE, system: 'pressurized' });
      const d = runVerticalGating({ ...BASE, system: 'decompressed' });
      const np = runVerticalGating({ ...BASE, system: 'nonpressurized' });
      for (const r of [p, d]) {
        assert(r.basis.unresolved.length === 7, `${r.system} unresolved=${r.basis.unresolved.length}（应 7，不含 U4/U7）`);
        assert(!r.basis.unresolved.some((u) => u.id === 'U4' || u.id === 'U7'), 'U4/U7 为不加压专属');
      }
      assert(np.ok && np.basis.unresolved.length === 9, '不加压引擎路径仍完整（deprecated）');
    },
  },

  {
    name: 'V1.1-6 布置示意图纯函数：加压含 层/流道选型/H 真值；减压含段标注与节流徽章；非法返回空',
    fn: () => {
      const p = runVerticalGating({ ...BASE, system: 'pressurized' });
      const d = runVerticalGating({ ...BASE, system: 'decompressed' });
      const lay = [{ a: 135 }, { a: 260 }, { a: 385 }];
      const svgP = verticalDiagramSvg({ res: p, layers: lay, mode: 'top' });
      assert(svgP.includes('顶入') && svgP.includes('层 1') && svgP.includes('H=135'), '加压图含层/H 标注');
      assert(svgP.includes('梯形 7.5/15×15') && svgP.includes('169mm²'), '加压图含流道选型白话标注');
      assert(svgP.includes('★节流(口)'), '加压节流徽章在口');
      const svgD = verticalDiagramSvg({ res: d, layers: lay, mode: 'top' });
      assert(svgD.includes('段1') && svgD.includes('段3') && svgD.includes('★节流(段入口)'), '减压段/节流标注');
      // 底入全局模式：H=A−C/2 标注与 C 语义
      const svgB = verticalDiagramSvg({ res: p, layers: lay, mode: 'bottom', C: 100 });
      assert(svgB.includes('底入') && svgB.includes('H=85') && svgB.includes('C=100'), '底入/H=A−C/2/C 标注');
      // 中入（V1.3）：H=A−B/2、B 标注、口在块中部
      const svgS = verticalDiagramSvg({ res: p, layers: lay, mode: 'side', B: 100 });
      assert(svgS.includes('中入') && svgS.includes('H=85') && svgS.includes('B=100') && svgS.includes('H = A − B/2'), '中入/B/H 标注');
      // 梯形白话读法说明行（小白向）
      assert(svgB.includes('面积=(X+Y)÷2×H'), '梯形读法说明');
      assert(verticalDiagramSvg({ res: { ok: false, error: 'x' }, layers: lay }) === '', '非法 res 返回空');
      assert(verticalDiagramSvg({ res: p, layers: [] }) === '', '无层返回空');
    },
  },

  // ═══════════ PHASE 70.1：M 工程经验接入（国外现场经验 ENGINEERING_REFERENCE）═══════════
  {
    name: '70.1-1 M 经验区间映射与边界（任务 §十 9 值 + 边界规则）',
    fn: () => {
      const want = [[2, 0.25], [3, 0.25], [4, 0.30], [5, 0.38], [6, 0.38], [7, 0.45], [8, 0.45], [9, 0.52], [10, 0.52], [12, 0.52], [15, 0.52], [30, 0.52]];
      for (const [w, lo] of want) {
        const m = expIngateM(w);
        assert(m && m.lo === lo, `wall ${w} → 下限 ${m && m.lo}（期望 ${lo}）`);
      }
      // 区间端点（lo 保守）
      assert(expIngateM(5).hi === 0.45 && expIngateM(3).hi === 0.30 && expIngateM(9).hi === 0.60, '区间 hi');
      assert(expIngateM(30).over12 === true && expIngateM(5).over12 === false, '>12 标记（U8）');
      assert(expIngateM(0) === null && expIngateM(-1) === null && expIngateM(NaN) === null, '非法壁厚 null');
    },
  },
  {
    name: '70.1-2 安全侧逻辑：同 G/t/H 下 m=下限 → F ≥ m=区间内任意值（含上限）',
    fn: () => {
      const mk = (m) => runVerticalGating({ ...BASE, mIngate: m, system: 'pressurized' });
      const lo = mk(0.38), hi = mk(0.45);
      for (let i = 0; i < 3; i++) assert(lo.gates[i].Fsingle >= hi.gates[i].Fsingle, `层${i + 1} F(0.38)≥F(0.45)`);
      const lo2 = mk(0.52), hi2 = mk(0.60);
      for (let i = 0; i < 3; i++) assert(lo2.gates[i].Fsingle >= hi2.gates[i].Fsingle, `层${i + 1} F(0.52)≥F(0.60)`);
    },
  },
  {
    name: '70.1-3 auto m：壁厚 20 → 0.52（经验 >12 保守档，U8）；mInfo 标记来源与区间；显式 m 标记 user',
    fn: () => {
      const auto = runVerticalGating({ ...BASE, wallMm: 20, mIngate: undefined, system: 'pressurized' });
      assert(auto.ok && Math.abs(auto.mInfo.used - 0.52) < 1e-9, `auto m=${auto.mInfo && auto.mInfo.used}`);
      assert(auto.mInfo.src === 'exp-safe-low' && auto.mInfo.srcLabel.includes('工程经验'), '来源=经验下限');
      assert(auto.mInfo.exp.lo === 0.52 && auto.mInfo.exp.hi === 0.60 && auto.mInfo.exp.over12 === true, '区间/U8 标记');
      const wall8 = runVerticalGating({ ...BASE, wallMm: 8, mIngate: undefined, system: 'pressurized' });
      assert(Math.abs(wall8.mInfo.used - 0.45) < 1e-9, '壁厚 8 → 0.45');
      const usr = runVerticalGating({ ...BASE, mIngate: 0.5, system: 'pressurized' });
      assert(usr.mInfo.src === 'user', '显式 m → user');
    },
  },
  {
    name: '70.1-4 M 依据铸件壁厚而非内浇口厚度：override 层厚不改变 auto m / F（任务 §六 重点检查）',
    fn: () => {
      const a = runVerticalGating({ ...BASE, wallMm: 8, mIngate: undefined, system: 'pressurized', sPerLayer: [4, 5, 3] });
      const b = runVerticalGating({ ...BASE, wallMm: 8, mIngate: undefined, system: 'pressurized' });
      assert(Math.abs(a.mInfo.used - b.mInfo.used) < 1e-9, 'override 不改 M（M 依据壁厚）');
      a.gates.forEach((g, i) => near(g.Fsingle, b.gates[i].Fsingle, 1e-9, `层${i + 1} F 不变`));
      // 手册例显式 m=0.5 复现链不受 auto 影响
      const ex = runVerticalGating({ ...BASE, mIngate: 0.5, system: 'pressurized' });
      near(ex.gates[0].Fsingle, 31.2, 0.05, '手册例复现保持');
    },
  },

  {
    name: 'V1.1-7 球铁(QT)（V1.2 用户裁决并入）：k/ρ 同灰铁 1036；限速 600（手册 6.9.2.11）；加压例三层全超 → 3 条警告',
    fn: () => {
      const M = VG_MATERIALS['球铁(QT)'];
      assert(M && M.k === 1036 && M.rhoKgMm3 === VG_MATERIALS['灰铸铁'].rhoKgMm3, '球铁 k/ρ 同灰铁');
      assert(M.vGateMax === 600, `球铁限速 ${M.vGateMax}（手册表 600）`);
      const r = runVerticalGating({ ...BASE, mat: '球铁(QT)', system: 'pressurized' });
      assert(r.ok, r.error);
      assert(r.vLimitMs === 0.6, `vLimitMs=${r.vLimitMs}`);
      assert(r.basis.warnings.length === 3, `三层口速均 >0.6 → ${r.basis.warnings.length} 条（灰铁为 2 条）`);
      // 面积同灰铁（同 k/H/t/m）
      const fe = runVerticalGating({ ...BASE, mat: '灰铸铁', system: 'pressurized' });
      r.gates.forEach((g, i) => near(g.Fsingle, fe.gates[i].Fsingle, 1e-9, `层${i + 1} 面积同灰铁`));
    },
  },

  {
    name: 'V1.4-1 分层内浇口厚度 sPerLayer（Step4）：层 override 只改该层尺寸/形状比，F 与他层不受影响',
    fn: () => {
      const base = runVerticalGating({ ...BASE, system: 'pressurized' });
      const over = runVerticalGating({ ...BASE, system: 'pressurized', sPerLayer: [3, 4, 5] });
      assert(over.ok, over.error);
      over.gates.forEach((g, i) => {
        assert(g.dims.s === [3, 4, 5][i], `层${i + 1} dims.s=${g.dims.s}`);
        assert(g.dims.area >= g.Fsingle, `层${i + 1} 实际面积 ≥ F`);
      });
      // F 与参考 m 不受厚度影响
      base.gates.forEach((g, i) => near(over.gates[i].Fsingle, g.Fsingle, 1e-9, `层${i + 1} F 不变`));
      assert(Math.abs(over.gates[1].shapeRatio - (over.gates[1].Fsingle / 16)) < 1e-9, '层2 形状比用 s=4');
      // 其他层不受 override 层影响（层2 dims 厚度 4 只出现在层2）
      assert(over.gates[0].dims.s === 3 && over.gates[2].dims.s === 5, '各层独立');
    },
  },
  {
    name: 'V1.4-2 sPerLayer 校验：<1mm/非法/长度不符 → fail；减压（同尺寸）忽略数组',
    fn: () => {
      assert(!runVerticalGating({ ...BASE, system: 'pressurized', sPerLayer: [3, 0.5, 3] }).ok, '0.5mm 非法');
      assert(!runVerticalGating({ ...BASE, system: 'pressurized', sPerLayer: [3, NaN, 3] }).ok, 'NaN 非法');
      assert(!runVerticalGating({ ...BASE, system: 'pressurized', sPerLayer: [3, 3] }).ok, '长度不符非法');
      const dec = runVerticalGating({ ...BASE, system: 'decompressed', sPerLayer: [9, 9, 9] });
      assert(dec.ok && dec.gates.every((g) => g.dims.s === 3), '减压忽略 sPerLayer（手册同尺寸）');
    },
  },

  // ═══════════ 二、手册算例复现（6.11.3~6.11.6）═══════════
  {
    name: 'M1 加压式算例：逐层 F=31.2/22.5/18.5mm²（H=135/260/385）精确复现',
    fn: () => {
      const r = runVerticalGating({ ...BASE, system: 'pressurized' });
      assert(r.ok, r.error);
      const want = [31.2, 22.5, 18.5]; // 手册 6.11.3.1（计算值）
      r.gates.forEach((g, i) => near(g.Fsingle, want[i], 0.05, `层${i + 1} Fsingle`));
      // 层总面积（每层 2 件）用于垂直流道累计
      near(r.gates[0].Flevel, 62.4, 0.1, 'Flev1=2×31.2');
      // 手册 F4 ≥ (31.5+22.5+18)×2×1.15=165.6（手册用取整后面积）；程序用计算面积 166.0
      const F4req = r.summary.F4req;
      assert(F4req >= 165.6 && F4req <= 167, `F4req=${F4req}（手册 165.6，差<1%）`);
      assert(r.summary.F4.area >= F4req, 'F4 选型 ≥ req');
    },
  },
  {
    name: 'M2 加压式算例：尺寸建议 10.5×3 / 7.5×3（第 3 层 6.5×3，手册 6×3 —— U5 记录）',
    fn: () => {
      const r = runVerticalGating({ ...BASE, system: 'pressurized' });
      assert(r.gates[0].dims.l === 10.5 && r.gates[1].dims.l === 7.5, 'dims 1/2 层');
      assert(r.gates[0].dims.s === 3, '厚 3');
      assert(r.gates[2].dims.l === 6.5, '第 3 层 V1 取 6.5（手册 6，18<18.5）');
    },
  },
  {
    name: 'M3 加压式算例：浇口杯校核 —— 每型 12 件、总浇注 12kg、平均 2.18≈2.2 kg/s',
    fn: () => {
      const r = runVerticalGating({ ...BASE, system: 'pressurized' });
      assert(r.cup.nTotalMold === 12, `nTotalMold=${r.cup.nTotalMold}`);
      near(r.cup.GpourTotal, 12, 1e-6, 'Gpour=0.7×12/0.7');
      near(r.cup.wAvg, 2.18, 0.01, 'wAvg（手册 2.2）');
      assert(r.cup.note.includes('3 号'), 'note 例关联');
      near(r.t0, 5.5, 1e-9, 't0=4+1.5');
    },
  },
  {
    name: 'M4 加压式算例：速度校验 —— 底层 1.37 m/s 超灰铁 1.0 限速 → 2 条警告（手册例自身取舍）',
    fn: () => {
      const r = runVerticalGating({ ...BASE, system: 'pressurized' });
      near(r.gates[2].vMs, 1.374, 0.002, '底层口速');
      assert(r.basis.warnings.length === 2, `warnings=${r.basis.warnings.length}`);
      assert(r.basis.warnings[0].includes('6.9.2.11'), '依据引用');
    },
  },
  {
    name: 'M5 减压式算例：垂直流道逐段 26.4/64.3/133.8 → 标准 48/75/147（a=4/5/7）精确复现',
    fn: () => {
      const r = runVerticalGating({ ...BASE, system: 'decompressed' });
      assert(r.ok, r.error);
      const wantReq = [26.4, 64.3, 133.8]; // 手册 6.11.4.1（段自下而上 H=385/260/135）
      const wantStd = [48, 75, 147];
      r.runnerSegs.forEach((s, i) => {
        near(s.req, wantReq[i], 0.15, `段${i + 1} req`);
        assert(s.Fstd === wantStd[i] && s.H === [385, 260, 135][i], `段${i + 1} std=${s.Fstd} H=${s.H}`);
        assert(s.nDown === (i + 1) * 2, `段${i + 1} nDown=${s.nDown}`);
      });
    },
  },
  {
    name: 'M6 减压式算例：V1=1.92 m/s（手册 1.9）→ 分支/口 ≥46.2（手册 45.6）→ 横流道 5/10×10=75',
    fn: () => {
      const r = runVerticalGating({ ...BASE, system: 'decompressed' });
      near(r.summary.V1ms, 1.92, 0.02, 'V1');
      assert(r.horiz.branchReq >= 45.5 && r.horiz.branchReq <= 47, `branchReq=${r.horiz.branchReq}`);
      assert(r.horiz.F8dims === '5/10×10' && r.horiz.F8std === 75, 'F8=75');
      assert(r.horiz.sameForAllLevels, '各层同尺寸（同时浇注）');
    },
  },
  {
    name: 'M7 减压式算例：内浇口全部层同尺寸（手册 16×3=48；V1 15.5×3=46.5 ≥46.2 —— 差异表记录）',
    fn: () => {
      const r = runVerticalGating({ ...BASE, system: 'decompressed' });
      const g0 = r.gates[0];
      assert(g0.sameForAllLevels && r.gates.every((g) => g.Fsingle === g0.Fsingle), '同尺寸');
      assert(g0.dims.s === 3 && g0.Fsingle >= r.horiz.branchReq, '面积≥req');
      // 口速（受控）≤ 1 m/s
      assert(g0.vMs <= 1.0 + 1e-9, `vMs=${g0.vMs}`);
      assert(r.basis.warnings.length === 0, '减压式不应有超速警告');
    },
  },
  {
    name: 'M8 不加压式算例：链 F5→F4(×1.42)→口(×1.2/6)；选型与手册差源于 U4/U7（记录性断言）',
    fn: () => {
      const r = runVerticalGating({ ...BASE, system: 'nonpressurized' });
      assert(r.ok, r.error);
      // 手册：F5=330.75(a10.5)、F4=468.75(a12.5)、口 93.75（31×3）
      // V1：F5 用直接公式(未布置放大, U7) → F4=F5×1.42 → 口=F4×1.2/6，链内自洽
      const f5 = r.runnerSegs[0], f4 = r.runnerSegs[1];
      assert(f5.Fstd >= f5.req, 'F5 ≥ req');
      near(f4.req, 1.42 * f5.Fstd, 0.001, 'F4=1.42×F5std（U4 例比例）');
      const g0 = r.gates[0];
      assert(g0.sameForAllLevels, '口同尺寸');
      near(g0.Fsingle, f4.Fstd * 1.2 / 6, 0.001, '口=F4×1.2/6');
      assert(g0.dims.area >= g0.Fsingle - 1e-9, '口面积');
      // 若按手册最终选型反向应得的口 93.75 —— 记录差异存在（诚实）
      assert(g0.Fsingle < 93.75, `V1 口 ${g0.Fsingle} < 手册 93.75（U7 布置放大未实现，差异表）`);
    },
  },
  {
    name: 'M9 混合式算例：内浇口=加压式逐层（10.5×3/7.5×3），流道=减压式（3 段 48/75/147）',
    fn: () => {
      const r = runVerticalGating({ ...BASE, system: 'mixed' });
      assert(r.ok, r.error);
      near(r.gates[0].Fsingle, 31.2, 0.05, '口层1');
      near(r.gates[2].Fsingle, 18.5, 0.05, '口层3');
      assert(r.gates[0].dims.l === 10.5 && r.gates[2].dims.l === 6.5, '混合口尺寸同加压');
      const st = r.runnerSegs.map((s) => s.Fstd).join('/');
      assert(st === '48/75/147', `减压段 ${st}`);
      assert(r.horiz && r.horiz.F8std === 75, '横流道同减压');
    },
  },
  {
    name: 'M10 手册算例逐项误差表（复现精度）：加压/减压主链全部 |误差|<0.4%',
    fn: () => {
      const p = runVerticalGating({ ...BASE, system: 'pressurized' });
      const d = runVerticalGating({ ...BASE, system: 'decompressed' });
      const rows = [
        ['加压 F3(顶)', p.gates[0].Fsingle, 31.2, 0.4], ['加压 F2', p.gates[1].Fsingle, 22.5, 0.4],
        ['加压 F1(底)', p.gates[2].Fsingle, 18.5, 0.4], ['加压 F4', p.summary.F4req, 165.6, 0.4],
        ['减压段1', d.runnerSegs[0].req, 26.4, 0.4], ['减压段2', d.runnerSegs[1].req, 64.3, 0.4],
        ['减压段3', d.runnerSegs[2].req, 133.8, 0.4], ['减压V1', d.summary.V1ms, 1.9, 1.5],
        ['tRec', recommendedPourTime({ mat: '灰铸铁', Gc: 0.7, wallMm: 20, moldSpeed: 480 }).tRec, 4.2, 0.4],
      ];
      for (const [name, got, want, tol] of rows) {
        const err = Math.abs(got - want) / want * 100;
        assert(err < tol, `${name}: got=${got} want=${want} err=${err.toFixed(2)}%（V1 手册四舍五入为 1.9）`);
      }
    },
  },

  // ═══════════ 三、四种方式独立性 ═══════════
  {
    name: 'S1 四种方式节流点/门尺寸结构互不相同（不错误共享逻辑）',
    fn: () => {
      const p = runVerticalGating({ ...BASE, system: 'pressurized' });
      const d = runVerticalGating({ ...BASE, system: 'decompressed' });
      const np = runVerticalGating({ ...BASE, system: 'nonpressurized' });
      const mx = runVerticalGating({ ...BASE, system: 'mixed' });
      assert(p.summary.choke.includes('内浇口'), '加压节流=内浇口');
      assert(d.summary.choke.includes('减压'), '减压节流=减压段入口');
      assert(np.summary.choke.includes('上部水平流道'), '不加压节流=上横流道');
      assert(mx.summary.choke.includes('平衡'), '混合节流=平衡处');
      // 加压逐层不同 vs 减压/不加压逐层相同
      assert(new Set(p.gates.map((g) => Math.round(g.Fsingle))).size === 3, '加压 3 层 3 尺寸');
      assert(new Set(d.gates.map((g) => Math.round(g.Fsingle))).size === 1, '减压同尺寸');
      assert(new Set(np.gates.map((g) => Math.round(g.Fsingle))).size === 1, '不加压同尺寸');
      // 混合口=加压口（逐层），管道=减压
      assert(Math.abs(mx.gates[0].Fsingle - p.gates[0].Fsingle) < 1e-9, '混合口同加压');
      assert(Math.abs(mx.gates[2].Fsingle - p.gates[2].Fsingle) < 1e-9, '混合口同加压3');
      // 减压口面积 ≠ 加压顶层面（结构差异）
      assert(Math.abs(d.gates[0].Fsingle - p.gates[0].Fsingle) > 5, '减压口≠加压顶层口');
    },
  },
  {
    name: 'S2 加压式每层独立：H 差异 → F∝1/√H（底层 H 大 → 口小）方向正确',
    fn: () => {
      const r = runVerticalGating({ ...BASE, system: 'pressurized' });
      assert(r.gates[0].Fsingle > r.gates[1].Fsingle && r.gates[1].Fsingle > r.gates[2].Fsingle,
        'H 大→面积小（自上而下递减）');
      // 定量：F_i/F_j = √(H_j/H_i)
      near(r.gates[2].Fsingle / r.gates[0].Fsingle, Math.sqrt(135 / 385), 1e-3, '1/√H 关系');
    },
  },

  // ═══════════ 四、多层（Test D）═══════════
  {
    name: 'L1 层数 2/3/4/5 稳定：均 ok、有限、无 NaN、杯校核自洽（2 面×Σn）',
    fn: () => {
      for (const L of [2, 3, 4, 5]) {
        for (const sys of ['pressurized', 'decompressed', 'nonpressurized', 'mixed']) {
          const H = Array.from({ length: L }, (_, i) => 100 + i * 100); // 顶→底 100..400
          const r = runVerticalGating({ ...BASE, H, system: sys, n: Array(L).fill(2) });
          assert(r.ok, `${sys} L=${L}: ${r.error}`);
          for (const g of r.gates) finite(g.Fsingle, `${sys} L${L} F`);
          for (const s of r.runnerSegs) finite(s.Fstd, `${sys} L${L} Fstd`);
          assert(r.cup.nTotalMold === 4 * L, `杯件数 2×2L: ${r.cup.nTotalMold}`);
          assert(Number.isFinite(r.cup.wAvg) && r.cup.wAvg > 0, 'wAvg');
        }
      }
    },
  },
  {
    name: 'L2 减压多段累计方向：自下而上每段 G 递增 → 顶段截面 ≥ 底段（无翻转）',
    fn: () => {
      const r = runVerticalGating({ ...BASE, H: [100, 200, 300, 400], n: [2, 2, 2, 2], system: 'decompressed' });
      assert(r.runnerSegs.length === 4, '4 段');
      for (let i = 1; i < 4; i++) {
        assert(r.runnerSegs[i].nDown === (i + 1) * 2, `nDown ${i}`);
        assert(r.runnerSegs[i].Fstd >= r.runnerSegs[i - 1].Fstd, `段${i} 面积不应小于段${i - 1}`);
      }
    },
  },
  {
    name: 'L3 加压不同 H 层（静压头变化 → 面积变化）逐层独立且互不影响（Test C）',
    fn: () => {
      const r1 = runVerticalGating({ ...BASE, H: [135, 260, 385], system: 'pressurized' });
      const r2 = runVerticalGating({ ...BASE, H: [200, 260, 385], system: 'pressurized' }); // 只改第 1 层
      assert(Math.abs(r1.gates[0].Fsingle - r2.gates[0].Fsingle) > 3, '第 1 层面积应改变');
      assert(Math.abs(r1.gates[1].Fsingle - r2.gates[1].Fsingle) < 1e-9, '第 2 层不应受影响');
      assert(Math.abs(r1.gates[2].Fsingle - r2.gates[2].Fsingle) < 1e-9, '第 3 层不应受影响');
      near(r2.gates[0].Fsingle, secArea(1036, 0.7, 0.5, 4, 200), 1e-6, '=直接公式');
    },
  },

  // ═══════════ 五、独立数学验证（Test A/B/E/F）═══════════
  {
    name: 'A1 重量变化：G 与 0.5G/2G → F 线性（加压；其他条件不变）',
    fn: () => {
      const f = (Gc) => runVerticalGating({ ...BASE, Gc, system: 'pressurized' }).gates[1].Fsingle;
      near(f(1.4) / f(0.7), 2, 1e-9, '2W');
      near(f(0.35) / f(0.7), 0.5, 1e-9, '0.5W');
      near(f(1.4) / f(0.35), 4, 1e-9, '跨度');
    },
  },
  {
    name: 'B1 浇注时间变化：F ∝ 1/t（T、0.5T、2T）',
    fn: () => {
      const f = (t) => runVerticalGating({ ...BASE, t, system: 'pressurized' }).gates[1].Fsingle;
      near(f(2), f(4) * 2, 1e-9, '0.5T：F∝1/t');
      near(f(8), f(4) / 2, 1e-9, '2T：F∝1/t');
    },
  },
  {
    name: 'E1 对称/等高：同 H 层 → 同面积（无高度偏差引入）；两段式 H 全等仍稳定',
    fn: () => {
      const r = runVerticalGating({ ...BASE, H: [250, 250], n: [2, 3], system: 'pressurized' });
      near(r.gates[0].Fsingle, r.gates[1].Fsingle, 1e-9, '同 H 同 Fsingle');
      near(r.gates[0].Flevel * 3, r.gates[1].Flevel * 2, 1e-6, '层总=n×F');
      const d = runVerticalGating({ ...BASE, H: [250, 250], system: 'decompressed' });
      assert(d.ok && d.runnerSegs[1].Fstd >= d.runnerSegs[0].Fstd, '等高减压段仍按累计 G 分层');
    },
  },
  {
    name: 'F1 极限输入：极小/极大重量、极短/长 t、极小/大 H 差 → 无 NaN/Inf/除零/负值',
    fn: () => {
      const cases = [
        { ...BASE, Gc: 0.01, system: 'pressurized' }, { ...BASE, Gc: 200, system: 'pressurized' },
        { ...BASE, t: 0.1, system: 'decompressed' }, { ...BASE, t: 600, system: 'decompressed' },
        { ...BASE, H: [1, 100000], system: 'pressurized' },
        { ...BASE, H: [385, 385.5, 386], system: 'mixed' },
        { ...BASE, H: [1], system: 'nonpressurized' }, { ...BASE, H: [5, 5000], system: 'mixed' },
      ];
      for (const c of cases) {
        const r = runVerticalGating(c);
        assert(r.ok, `${JSON.stringify(c.H)}: ${r.error}`);
        const walk = (o, path) => {
          if (typeof o === 'number') { finite(o, path); }
          else if (o && typeof o === 'object') { for (const k of Object.keys(o)) if (!['note', 'basis', 'desc', 'src', 'text', 'formulas', 'unresolved', 'warnings', 'recommendations', 'dims', 'id'].includes(k)) walk(o[k], `${path}.${k}`); }
        };
        for (const key of ['gates', 'runnerSegs', 'cup']) walk(r[key], key);
      }
    },
  },
  {
    name: 'F2 非法输入阻断（P63 门禁镜像）：空/0/负数/NaN/∞ → ok:false 带原因，绝不静默',
    fn: () => {
      const bad = [
        [{ ...BASE, Gc: 0 }, '单件'], [{ ...BASE, Gc: -1 }, '单件'],
        [{ ...BASE, wallMm: 0 }, '壁厚'], [{ ...BASE, wallMm: NaN }, '壁厚'],
        [{ ...BASE, H: [135, 0, 385] }, '静压头'], [{ ...BASE, H: [135, NaN] }, '静压头'],
        [{ ...BASE, H: [] }, '层'], [{ ...BASE, H: [135, 260, 385, 1, 2, 3, 4, 5, 6] }, '层数'],
        [{ ...BASE, n: [0, 2, 2] }, '件数'], [{ ...BASE, n: [1.5, 2, 2] }, '件数'],
        [{ ...BASE, sIngate: 0.5 }, '口厚'], [{ ...BASE, sIngate: -3 }, '口厚'],
        [{ ...BASE, mIngate: 0 }, 'm'], [{ ...BASE, mIngate: 1.5 }, 'm'],
        [{ ...BASE, mat: '球墨铸铁' }, '材料'], [{ ...BASE, system: 'evil' }, '方式'],
        [{ ...BASE, yieldRate: 0 }, '产出率'], [{ ...BASE, Gc: Infinity }, '单件'],
      ];
      for (const [c, tag] of bad) {
        const r = runVerticalGating(c);
        assert(!r.ok && typeof r.error === 'string' && r.error.length > 0, `${tag} 应被阻断`);
      }
      // 非法输入绝不产出结果对象
      const r = runVerticalGating({ ...BASE, Gc: -5, system: 'pressurized' });
      assert(!r.ok && !r.gates, '无结果泄漏');
    },
  },
  {
    name: 'F3 口厚 <1mm 手册禁用（6.10.12）；层数上限 8；材料白名单（U1）',
    fn: () => {
      const r = runVerticalGating({ ...BASE, sIngate: 0.9, system: 'pressurized' });
      assert(!r.ok && r.error.includes('1mm'), `s=0.9: ${r.error}`);
      assert(VG_MATERIALS['灰铸铁'] && !VG_MATERIALS['球墨铸铁'], '材料白名单');
    },
  },

  // ═══════════ 六、反向推导/自一致性 ═══════════
  {
    name: 'R1 质量守恒反推：ρ·F·V = G/t 在每层成立（F 公式 ↔ 速度公式 ↔ 流量）',
    fn: () => {
      const r = runVerticalGating({ ...BASE, system: 'pressurized' });
      const M = VG_MATERIALS['灰铸铁'];
      for (const g of r.gates) {
        const Vmm_s = g.vMs * 1000;                       // m/s → mm/s
        const Qmass = M.rhoKgMm3 * g.Fsingle * Vmm_s;     // kg/s（单口）
        assert(Math.abs(Qmass - 0.7 / 4) / (0.7 / 4) < 2e-4, `层${g.level} 质量流守恒 ${Qmass}（k 舍入 0.02%）`);
      }
      // 减压：受控口速 → 每腔流量
      const d = runVerticalGating({ ...BASE, system: 'decompressed' });
      const Vd = d.gates[0].vMs * 1000;
      assert(Math.abs(M.rhoKgMm3 * d.gates[0].Fsingle * Vd - 0.7 / 4) / (0.7 / 4) < 2e-4, '减压单腔流量守恒');
    },
  },
  {
    name: 'R2 k 常数内部一致性：k 差 = 密度反比（铁/铜/铝 两两核对）',
    fn: () => {
      const [fe, cu, al] = ['灰铸铁', '铜合金', '铝合金'].map((m) => VG_MATERIALS[m]);
      near(fe.k / cu.k, cu.rhoKgMm3 / fe.rhoKgMm3, 1e-3, '铁/铜');
      near(fe.k / al.k, al.rhoKgMm3 / fe.rhoKgMm3, 1e-3, '铁/铝');
      near(cu.k / al.k, al.rhoKgMm3 / cu.rhoKgMm3, 1e-3, '铜/铝');
    },
  },

  // ═══════════ 七、隔离性 ═══════════
  {
    name: 'I1 本模块与通用浇注系统(gating.js)无任何依赖：不出现 Ozan/Dietert/calc_t 符号',
    fn: () => {
      // 剥离注释后扫描（注释里允许提及其他体系名称作免责声明）
      const src = await_import_src().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      assert(!/calc_t|Ozan|Dietert|fv\b|A_choke|V_TARGET/.test(src), '引用其他体系符号');
      assert(!/^\s*import\s.*from\s*['"].*gating['"]/m.test(src), 'import 依赖');
      assert(/DISA|手册/.test(src), '来源标注存在');
    },
  },
  {
    name: 'I2 结果自带计算依据与 UNRESOLVED 清单（可追溯、诚实）',
    fn: () => {
      const r = runVerticalGating({ ...BASE, system: 'pressurized' });
      const np = runVerticalGating({ ...BASE, system: 'nonpressurized' });
      assert(r.basis.formulas.length >= 4, '依据清单');
      assert(r.basis.unresolved.length === 7 && !r.basis.unresolved.some((u) => u.id === 'U4'), '加压式 commonU 7 条（U4/U7 为不加压专属）');
      assert(np.basis.unresolved.length === 9, '不加压式 9 条（引擎保留）');
      assert(r.basis.formulas.some((f) => f.key === 'F' && f.src.includes('6.9.2')), 'F 公式出处');
      assert(r.process.length >= 2, '过程链');
    },
  },
];

// I1 用的源文件读取（同步，仅测试用）
const await_import_src = () => readFileSync(new URL('../calcs/verticalGating.js', import.meta.url), 'utf8');
