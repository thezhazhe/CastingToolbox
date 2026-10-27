// ============================================================
// PHASE V2.0-06A1（113.txt）· 自动 Mc 风险控制与工程输入确认
//
// 覆盖 113.txt §六 的 7 项（第 2、5 项不得省略）：
//   1 自动 Mc 在相关页面有明确的估计值提示
//   2 未确认自动 Mc 时，冒口设计不会被误认为已完成工程确认        ★
//   3 用户确认工程输入后，现有设计流程可以正常执行
//   4 冷铁默认值具有明确的初始建议定位，且用户原有修改能力不受影响
//   5 未确认的自动 Mc 不会使冒口 1.2 判据显示无条件的最终 PASS    ★
//   6 已确认输入时，判据仍按既有公式正常计算
//   7 热点定位、排序、区域体积、置信度等无关功能不发生非预期变化
//
// 断言纪律（沿用项目既有约定）：
//   · 判据层断言**语义码 + 数值**，不针对中文措辞；
//   · 显示层（页面文案）用**结构契约**断言（源码里必须存在的口径），
//     因为 Node 里没有 DOM，真实排版在浏览器测试里量；
//   · js/engine/** 一行未改 —— 第 7 项用引擎实测指纹对照证。
// ============================================================
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSTL } from '../js/engine/stl.js';
import { buildMesh } from '../js/engine/mesh3d.js';
import { analyzeHotspotsV3 } from '../js/engine/v3/hotspotV3.js';
import {
  KIND, MODULUS_RATIO_MIN, LEVEL,
  makeObject, buildRiserRows, summarizeRisers, RISER_CODE,
} from '../js/model/processInspection.js';
import { runRiser } from '../calcs/riser.js';
import EN from '../js/i18n/en-US.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, '..', p), 'utf8');
const assert = (c, m) => { if (!c) throw new Error(m); };
const near = (a, b, tol, m) => assert(Math.abs(a - b) <= tol, `${m}（实际 ${a}，期望 ${b}±${tol}）`);

const hs = (id, x, y, z, mc) => ({ id, x, y, z, mc, regionVolumeCm3: 10, confidence: 0.8 });
const mkRiser = (mod) => makeObject(KIND.RISER, 0, 'r.stl', {
  modulusMm: mod, volumeMm3: mod * 1000, areaMm2: 1000, center: [0, 0, 0], size: [1, 1, 1],
});

/* 页面源码（结构契约用） */
const VIEW_INSPECTION = read('js/views/inspectionCenter.js');
const VIEW_RESULTS = read('js/views/resultsCenter.js');
const VIEW_PAGE1 = read('js/views/processPage1.js');
const MANIFEST = read('calcs/calcManifest.js');

export const tests = [

  /* ================= 1. 自动 Mc 的估计值提示 ================= */
  {
    name: '06A1/S5-02 自动 Mc 的估计值提示：结果页降级为底部说明；参数页/检测页保留就地提示',
    fn: () => {
      const CAVEAT = '自动估计值，尚未验证适用于所有几何';
      // S5-02：结果页不再在来源行加粗警告；完整说明放在冒口结果区域最下方。
      assert(!VIEW_RESULTS.includes(`—— <b>${CAVEAT}</b>`), '结果页来源行不应再加粗“自动估计值”警告');
      assert(VIEW_RESULTS.includes('来源：STL 热结检测 Mc = {m} mm{tail}'), '结果页应保留紧凑的来源说明');
      assert(VIEW_RESULTS.includes('data-mc-estimate-note'), '结果页缺少 Mc 估计值底部说明钩子');
      assert(VIEW_RESULTS.includes('Mc 为基于 STL 几何计算的估计值'), '结果页缺少 Mc 估计值底部说明');
      // 参数页「最大热节 Mc」行仍保留就地估计值提示
      assert(VIEW_PAGE1.includes(CAVEAT), '参数页 Mc 行缺"自动估计值"提示');
      // 检测页热点明细：说明 + 确认控件
      assert(VIEW_INSPECTION.includes('以上热点模数为 STL 自动估计值'), '检测页热点明细缺估计值说明');
      assert(VIEW_INSPECTION.includes('pi_mc_confirm'), '检测页缺热点模数确认控件');
      assert(VIEW_PAGE1.includes('尚未验证适用于所有几何') && VIEW_INSPECTION.includes('尚未验证适用于所有几何'),
        '参数页/检测页的限制语与统一口径不一致');
      // 英文条目齐（缺译会回退中文，但本项目要求新词条同步登记）
      for (const k of [
        '来源：STL 热结检测 Mc = {m} mm{tail}',
        'Mc 为基于 STL 几何计算的估计值，实际热节情况仍需结合铸件结构和工艺经验复核。',
        '自动估计值，尚未验证适用于所有几何（板状/长条状热节可能偏低）—— 请核对热节壁厚后确认',
        '以上热点模数为 STL 自动估计值，尚未验证适用于所有几何（板状/长条状热节可能偏低）。未勾选时，模数比判定只显示"计算通过"，不给出最终合格结论。',
        '模数比计算通过（≥ {r}）；热点模数 Mc 尚未确认，本结论待确认',
        '计算已完成，但热点模数为自动估计值 —— 结论待确认',
        '我已核对以上热点模数，可作为本次模数比判定的工程输入',
      ]) assert(typeof EN[k] === 'string' && EN[k].length > 0, `新词条缺英文：${k}`);
    },
  },

  /* ================= 2. 未确认的自动 Mc 不得被当成已确认 ★ ================= */
  {
    name: '06A1-2 ★ 未确认的自动 Mc：冒口设计不得被当成已完成工程确认',
    fn: () => {
      // (a) 自动分支必须产出一条 note（→ 结果页渲染为 ℹ️ 提示行），且等级不得是 SAFE_TO_RECOMMEND
      assert(MANIFEST.includes('本次冒口 Mc 采用 STL 自动热结估计值（未经确认）'),
        'manifest 冒口自动分支未标注"未经确认"');
      assert(/const level = \(userMc \|\| note\) \? 'WARNING_REVIEW'/.test(MANIFEST),
        '自动 Mc 分支未降级为 WARNING_REVIEW（仍会给"可直接采用"）');
      assert(!/note \? \{ \.\.\.r, note, level \} : \{ \.\.\.r, level \}/.test(MANIFEST) === false,
        'note 必须随结果一起返回（否则结果页拿不到提示）');
      // (b) 结果页必须真的渲染 r.note
      assert(VIEW_RESULTS.includes('${r.note ?'), '结果页未渲染冒口 note');
      // (c) 明确区分三种来源（壁厚 / 自动估计 Mc / 用户确认 Mc）—— 三句来源文案互不相同
      const lines = VIEW_RESULTS.match(/来源：[^']*/g) || [];
      assert(lines.some(l => l.includes('用户输入')), '缺"用户确认的工程 Mc"来源');
      assert(lines.some(l => l.includes('STL 热结检测')), '缺"自动 Mc"来源');
      assert(lines.some(l => l.includes('壁厚/结构参考值')), '缺"壁厚参考"来源');
      // (d) 参数页必须能区分自动/用户（用 src，不看数值）
      assert(VIEW_PAGE1.includes("mcPSrc.src !== 'USER_OVERRIDE'"), '参数页未按 src 区分用户输入');
      assert(VIEW_PAGE1.includes("mcPSrc.src !== 'USER_INPUT'"), '参数页未按 src 区分用户输入');
    },
  },

  /* ================= 3. 用户确认后流程照常 ================= */
  {
    name: '06A1-3 用户确认工程输入后，冒口计算流程照常执行（公式零改动）',
    fn: () => {
      const base = { mat: '球铁', cast_wt: 100, mc_mode: 'direct', shape: 'cyl', hd_ratio: 1.0 };
      const r = runRiser({ ...base, mc: 10 });
      assert(r && r.Mc === 10, 'Mc 应原样进入计算');
      // 既有公式逐项复算（不改公式的证明：手算 == 函数输出）
      near(r.Mr_need, 10 * r.final_f, 1e-9, 'Mr_need 应 = Mc × f');
      near(r.d_neck, Math.round(10 * r.md.neck_k * 4), 1e-9, 'd_neck 应 = round(4 × Mc × neck_k)');
      assert(r.D > 0 && r.H > 0, '应给出冒口尺寸');
      assert(typeof r.modOk === 'boolean' && typeof r.volOk === 'boolean', '双校核标志应在');
      // Mc 变大 → 尺寸单调不小（确认用户的工程输入真的起作用）
      const r2 = runRiser({ ...base, mc: 20 });
      assert(r2.D >= r.D && r2.d_neck >= r.d_neck, 'Mc 增大时 D / d_neck 不得反而变小');
    },
  },

  /* ================= 4. 冷铁默认值 = 初始建议值 ================= */
  {
    name: '06A1-4 冷铁默认值定位为初始建议值，且用户修改能力不受影响',
    fn: () => {
      // 数值/公式一行未改：仍是 2×Mc
      assert(MANIFEST.includes('|| mc * 2;   // 独立 T_hot；默认 2×热节模数（保持原数值行为）'),
        '冷铁默认值公式被改动（应为 2×Mc 原样）');
      // 自动推出的 T 必须带 note + 降级
      assert(MANIFEST.includes('未经确认的初始建议值'), '冷铁自动 T 未标注为初始建议值');
      assert(MANIFEST.includes('const level = (userMc || userT || autoT)'),
        '冷铁自动 T 未降级（仍会给 SAFE_TO_RECOMMEND）');
      // 结果页必须渲染冷铁 note
      assert(VIEW_RESULTS.includes('${c.note ?'), '结果页未渲染冷铁 note');
      // 用户仍可改：T 优先取用户值，且用户值时不带"初始建议"note
      const idxUserT = MANIFEST.indexOf("const userT = chillTSrc");
      assert(idxUserT > 0, '缺少用户 T 判定');
      assert(/const autoT = !userT && !userMc;/.test(MANIFEST), 'autoT 必须是"用户没给 T 也没给 Mc"才成立');
      assert(/const T = proj\.getV\('process\.chillT'\) \|\| mc \* 2;/.test(MANIFEST),
        '用户输入必须仍优先于自动值');
      assert(/return chillNote \? \{ \.\.\.r, note: chillNote, level \} : \{ \.\.\.r, level \};/.test(MANIFEST),
        '用户给出 T_hot 时不得再挂"初始建议值"提示');
    },
  },

  /* ================= 5. 未确认 ⇒ 不得无条件最终 PASS ★ ================= */
  {
    name: '06A1-5 ★ 未确认的自动 Mc：1.2 判据不得给出无条件的最终 PASS',
    fn: () => {
      const hotspots = [hs(1, 0, 0, 0, 10)], risers = [mkRiser(25)];   // 比值 2.5 ≥ 1.2
      // 默认（未确认）
      const r = buildRiserRows(hotspots, risers);
      assert(r.mcConfirmed === false, '安全默认：未显式确认即为未确认');
      assert(r.rows[0].ok === true, '比值本身照样算出来是"够"（数值不改）');
      assert(r.rows[0].nearest.ratio === 2.5, '比值本身不受确认位影响');
      const s = summarizeRisers({ product: {}, hotspots, risers, rows: r });
      assert(s.mcUnconfirmed === true, '总览必须标记"结论未确认"');
      assert(!s.items.some(i => i.code === RISER_CODE.MODULUS_OK && i.level === LEVEL.PASS),
        '未确认时不得出现 PASS 级的 MODULUS_OK');
      const it = s.items.find(i => i.code === RISER_CODE.MODULUS_OK_UNCONFIRMED);
      assert(it && it.level === LEVEL.INFO, '未确认时必须走 RISER_CODE.MODULUS_OK_UNCONFIRMED 且为 INFO');
      assert(it.params[0] === 1 && it.params[1] === MODULUS_RATIO_MIN, '参数仍应是 (满足数, 1.2)，数值不变');
      // 阈值没有被"改一下让它过"：仍只有 1.2
      assert(MODULUS_RATIO_MIN === 1.2, `阈值必须仍是 1.2，实际 ${MODULUS_RATIO_MIN}`);
      // 视图层：卡片与首行都不得显示最终合格
      assert(VIEW_INSPECTION.includes('本结论待确认'), '卡片判定缺"待确认"');
      assert(VIEW_INSPECTION.includes('计算已完成，但热点模数为自动估计值 —— 结论待确认'),
        '总览首行在未确认时仍会显示"未发现明显问题"');
      assert(/summary\.mcUnconfirmed/.test(VIEW_INSPECTION), '首行未消费 mcUnconfirmed');
    },
  },

  /* ================= 6. 已确认 ⇒ 按既有公式正常计算 ================= */
  {
    name: '06A1-6 已确认输入时，判据仍按既有公式正常计算（PASS / WARNING 边界不变）',
    fn: () => {
      const hotspots = [hs(1, 0, 0, 0, 10)];
      // 恰好 1.2 → PASS
      const r1 = buildRiserRows(hotspots, [mkRiser(12)], { mcConfirmed: true });
      near(r1.rows[0].nearest.ratio, 1.2, 1e-12, '比值应为 1.2');
      const s1 = summarizeRisers({ product: {}, hotspots, risers: [mkRiser(12)], rows: r1 });
      assert(s1.mcUnconfirmed === false, '已确认时不得标记未确认');
      assert(s1.items.some(i => i.code === RISER_CODE.MODULUS_OK && i.level === LEVEL.PASS),
        '已确认且 ≥1.2 必须给 PASS 级 MODULUS_OK');
      assert(s1.warns === 0, '满足时不得有 WARNING');
      // 1.19 < 1.2 → WARNING（确认与否都不影响"不足"的方向）
      const r2 = buildRiserRows(hotspots, [mkRiser(11.9)], { mcConfirmed: true });
      assert(r2.rows[0].ok === false, '1.19 应判不足');
      const s2 = summarizeRisers({ product: {}, hotspots, risers: [mkRiser(11.9)], rows: r2 });
      assert(s2.items.some(i => i.code === RISER_CODE.MODULUS_LOW && i.level === LEVEL.WARNING),
        '不足必须是 WARNING');
      // 未确认 + 不足：仍是 WARNING（输入不确定不得把"不足"美化成"待确认"）
      const s3 = summarizeRisers({ product: {}, hotspots, risers: [mkRiser(11.9)], rows: buildRiserRows(hotspots, [mkRiser(11.9)]) });
      assert(s3.items.some(i => i.code === RISER_CODE.MODULUS_LOW && i.level === LEVEL.WARNING),
        '未确认时"不足"仍必须是 WARNING（方向安全）');
      // 三分类互斥完备未被破坏
      const c = r1.counts;
      assert(c.modulusOk + c.modulusLow + c.modulusUnknown === c.riserTotal,
        '三分类必须互斥且完备');
    },
  },

  /* ================= 7. 无关功能无变化 ================= */
  {
    name: '06A1-7 热点定位 / 排序 / 区域体积 / 置信度未受影响（引擎实测对照）',
    fn: () => {
      // (a) 结构契约：本阶段改动的文件**不得伸进引擎内部量**
      //     （页面照常 import 引擎公开 API 是既有设计，禁的是"伸手进内部"；
      //      注释里提到某个名字不算伸手，故先剥注释再查）
      const stripComments = (s) => s
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      const MODEL = read('js/model/processInspection.js');
      const INTERNALS = ['peakModulus', 'modulusField', 'modulusCeilRatio', 'regionGrow',
        'globalNMS', 'refineSample', 'coarseSample', 'windowVoxels', 'findPeaks'];
      for (const [nm, raw] of [['inspectionCenter', VIEW_INSPECTION], ['resultsCenter', VIEW_RESULTS],
        ['processPage1', VIEW_PAGE1], ['calcManifest', MANIFEST], ['processInspection', MODEL]]) {
        const s = stripComments(raw);
        for (const k of INTERNALS) {
          assert(!s.includes(k), `${nm} 出现了引擎内部量 ${k} —— 本阶段不得触碰热点算法`);
        }
      }
      // (b) 实测对照：引擎对 thickEnd 的输出必须与 05H 冻结指纹逐位一致（引擎一行未改）
      const fpPath = join(here, 'experiments', 'out', 'phasev2005h_fingerprint_after.json');
      const stlPath = join(here, 'engineering-generated', 'models', 't01_boss100', 'model.stl');
      if (!existsSync(fpPath) || !existsSync(stlPath)) return;   // 缺夹具 → skip（项目约定）
      const fp = JSON.parse(readFileSync(fpPath, 'utf8'));
      const buf = readFileSync(stlPath);
      const mesh = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      const geometry = buildMesh(mesh).geometry;
      const r = analyzeHotspotsV3(mesh, geometry, {});
      const want = fp.models.t01_boss100.prod;
      assert(r.status === want.status, `状态变化：${r.status} != ${want.status}`);
      assert(r.hotspots.length === want.hotspotCount, `热点数变化：${r.hotspots.length} != ${want.hotspotCount}`);
      for (let i = 0; i < r.hotspots.length; i++) {
        const got = r.hotspots[i], exp = want.hotspots[i];
        near(got.peakModulus, exp.mc, 1e-6, `H${i + 1} Mc 变化`);
        near(got.normalizedModulus, exp.normM, 1e-6, `H${i + 1} 归一化模数变化`);
        near(got.confidence, exp.conf, 1e-4, `H${i + 1} 置信度变化`);
        near(Math.round(got.regionVolume), exp.vol, 1, `H${i + 1} 区域体积变化`);
        for (let k = 0; k < 3; k++) near(got.position[k], exp.pos[k], 1e-3, `H${i + 1} 位置分量 ${k} 变化`);
      }
    },
  },

  /* ================= 8. 确认位必须用事件委托（V2.0-06A1-R1 回归守卫） ================= */
  {
    name: '06A1-R1 确认位的绑定方式：必须委托在 #pi_detail 上，不得直接绑元素',
    fn: () => {
      // 真实浏览器实测过的 P0：`#pi_mc_confirm` 是 renderDetail() 在 paint() 里**现画**的，
      //   而 render() 里绑定那一行执行时 #pi_detail 还是空的 ⇒ 直接绑元素会静默落到 null
      //   （`?.`），监听器永远挂不上；paint() 又不重跑绑定，事后也补不回来
      //   ⇒ 复选框能勾但判定纹丝不动。浏览器行为验证在 scripts/browser_inspection_test.mjs
      //   （场景 A/B/C/D）；这里加一条结构守卫，因为浏览器测试不在 tests/runner.mjs 里，
      //   回退时没人会看到它变红。
      const src = VIEW_INSPECTION;
      const direct = src.match(/querySelector\(\s*['"]#pi_mc_confirm['"]\s*\)\s*\??\.\s*addEventListener/g) || [];
      assert(direct.length === 0,
        `不得把监听器直接绑在 #pi_mc_confirm 上（它由 paint() 现画，绑定时元素还不存在）—— 命中 ${direct.length} 处`);
      const deleg = src.match(/querySelector\(\s*['"]#pi_detail['"]\s*\)\s*\??\.\s*addEventListener\(\s*['"]change['"]/g) || [];
      assert(deleg.length === 1,
        `确认位必须（且只）在长期存在的 #pi_detail 上注册一次 change 委托 —— 命中 ${deleg.length} 处`);
      // 委托回调必须只处理确认框自己的事件（别把 #pi_detail 里其它控件的 change 也吞了）
      assert(/e\.target\?\.id !== 'pi_mc_confirm'/.test(src), 'change 委托未按 event.target.id 过滤');
      // 且必须仍走 paint() 刷新（不得改成只改 state 不重画）
      assert(/#pi_detail['"]\)[\s\S]{0,400}?state\.mcConfirmed = e\.target\.checked === true;[\s\S]{0,120}?paint\(container\);/.test(src),
        'change 委托必须更新 state.mcConfirmed 并调用 paint(container)');
    },
  },
];
