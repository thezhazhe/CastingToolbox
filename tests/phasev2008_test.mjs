// ============================================================
// PHASE V2.0-08（117.txt）· 冒口结果卡可信度修复：D1 / D2 / D3
//
//   1 D1 勾选热结 ≠ 确认 Mc：未确认的自动 Mc 不得拿到"可直接采用"     ★
//   2 D1 用户明确改过 Mc → 按既有 SRC 语义走"用户确认"分支
//   3 D1 多热结混合（部分改、部分未改）→ 只要还有一个自动值就必须保留未确认提示
//   4 D2 Mc 来源（mcSrc）逐来源核对：自动 / 用户 / 壁厚 / 勾选未改 / 勾选已改
//   5 D2 结果页不得再用"数值差"判断来源（结构守卫）
//   6 D3 尺寸归因（bind / dModOnly）：PHASE V2.0-22 起 bind 恒为 modulus + 数值正确
//   7 D3 结果页必须渲染归因，且归因缺失时不得编造结论（结构守卫）
//   8 数值基线：D/H/f/Mr_act/Vr/d_neck/volOk/modOk 逐位固定（PHASE V2.0-22 新规则基线）★
//
// PHASE V2.0-22（138.txt）：推荐尺寸改由目标模数 Mr_target = Mc × 1.2 反求，旧体积约束
//   不再决定尺寸 ⇒ 08-6 / 08-7 / 08-8 的旧前提（volume/start/limit 归因、体积主导数值基线）
//   合法失效，按新契约重写（详见各用例内注释，不放宽任何断言）。
//
// 断言纪律：**只看行为与数值，不看中文措辞**（措辞会改，语义不该改）。
// 基线来源：修复前实测（PHASE V2.0-07 探针 `tests/experiments/out/phasev2007_ui_probe.txt`
//   与临时探针 `out_level_bypass.txt`，均为修复前代码的输出）。
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as proj from '../js/model/CastingProject.js';
import { SRC, CONF } from '../js/model/CastingProject.js';
import { getCalcManifest } from '../calcs/calcManifest.js';
import { runRiser, meetsTarget } from '../calcs/riser.js';
import EN from '../js/i18n/en-US.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, '..', p), 'utf8');
const assert = (c, m) => { if (!c) throw new Error(m); };
const near = (a, b, tol, m) => assert(Math.abs(a - b) <= tol, `${m}（实际 ${a}，期望 ${b}±${tol}）`);

const VIEW_RESULTS = read('js/views/resultsCenter.js');
const MANIFEST_SRC = read('calcs/calcManifest.js');

/* ---------- 受控项目状态（设计中心的真实参数路径） ---------- */
const DEFAULT_HS = [
  { id: 1, mc: 14, regionVolumeCm3: 60, confidence: 0.8 },
  { id: 2, mc: 12, regionVolumeCm3: 25, confidence: 0.8 },
];
function setup(o = {}) {
  proj.reset();
  proj.set('material.family', '球铁');
  proj.set('material.solidDensity', 7.1, SRC.SCENARIO, CONF.MEDIUM);
  proj.set('geometry.valid', true, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.geomStatus', o.geomStatus || 'VALID', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.netWeightKg', 77.56, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
  proj.set('geometry.blankWeightKg', 77.56, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
  proj.set('hotspots.status', o.hsStatus || 'ok', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('hotspots.items', o.hs || DEFAULT_HS, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('process.mcHotspot', o.mcHot ?? 14, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('process.wallHot', 8, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('process.riserShape', 'cyl', SRC.DEFAULT, CONF.LOW);
  if (o.pick) proj.set('process.hsPick', o.pick, SRC.USER_INPUT, CONF.USER_CONFIRMED);
  if (o.mcHotUser != null) proj.set('process.mcHotspot', o.mcHotUser, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
  if (o.wallHotUser != null) proj.set('process.wallHot', o.wallHotUser, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
}
const calc = () => getCalcManifest('riser').calculate();

const RUN = { mat: '球铁', mc_mode: 'direct', shape: 'cyl', hd_ratio: 1.0 };
const riser = (mc, wt = 77.56) => runRiser({ ...RUN, cast_wt: wt, mc });

export const tests = [

  /* ================= 1. D1：勾选 ≠ 确认 ★ ================= */
  {
    name: '08-1 ★ D1 勾选热结但未改 Mc：不得给"可直接采用"，且必须保留未确认提示',
    fn: () => {
      // 勾选 H1，Mc = 检出值 14（designCenter 勾选框 click 的实际行为）
      setup({ pick: [{ id: 1, mc: 14 }] });
      const r = calc();
      assert(r, '勾选路径必须产出结果');
      assert(r.level !== 'SAFE_TO_RECOMMEND',
        `勾选热结不得把未确认的自动 Mc 变成"可直接采用"（实际 ${r.level}）`);
      assert(r.level === 'WARNING_REVIEW', `应为 WARNING_REVIEW，实际 ${r.level}`);
      assert(typeof r.note === 'string' && r.note.includes('未经确认'),
        '勾选但未改值时必须带"未经确认"提示（06A1 的口径不得被勾选吞掉）');
      // 与单热结自动路径逐字同句（同一口径）
      const q = (() => { setup({}); return calc(); })();
      assert(q.note === r.note,
        '勾选路径的未确认提示必须与单热结自动路径**逐字相同**');
    },
  },

  /* ================= 2. D1：用户明确改过 = 确认 ================= */
  {
    name: '08-2 D1 勾选并明确改过 Mc：走"用户确认"分支（不再说未经确认）',
    fn: () => {
      setup({ pick: [{ id: 1, mc: 20 }] });
      const r = calc();
      assert(r.level === 'WARNING_REVIEW', `人工输入同样是需人工复核，实际 ${r.level}`);
      assert(r.note && r.note.includes('用户确认'), '改过值应给"按用户确认的热节模数…计算"');
      assert(!r.note.includes('未经确认'), '用户已明确改值，不得再报"未经确认"');
    },
  },

  /* ================= 3. D1：多热结混合 ================= */
  {
    name: '08-3 ★ D1 多热结混合（H1 改过 / H2 未改）：只要还有一个自动值就不得给最终等级',
    fn: () => {
      setup({ pick: [{ id: 1, mc: 20 }, { id: 2, mc: 12 }] });
      const r = calc();
      assert(r.items && r.items.length === 2, '两个热结各出一个冒口');
      assert(r.level === 'WARNING_REVIEW', `混合路径应为 WARNING_REVIEW，实际 ${r.level}`);
      assert(r.note.includes('未经确认'), '还有一个热结是检出值 → 必须保留未确认提示');
      assert(r.note.includes('feed-zone') || r.note.includes('分区补缩'),
        '多热结原有的"不做 feed-zone 分区补缩"说明不得被覆盖');
      // 两个都改过 → 走用户确认分支
      setup({ pick: [{ id: 1, mc: 20 }, { id: 2, mc: 13 }] });
      const r2 = calc();
      assert(!r2.note.includes('未经确认'), '两个都改过值 → 不应再报未经确认');
      assert(r2.level === 'WARNING_REVIEW', '人工输入仍为需人工复核');
    },
  },

  /* ================= 4. D2：mcSrc 逐来源 ================= */
  {
    name: '08-4 D2 Mc 来源（mcSrc）逐来源核对：自动 / 用户 / 壁厚 / 勾选未改 / 勾选已改',
    fn: () => {
      setup({});                                   // 有热结、未改过 → STL 自动
      assert(calc().mcSrc === SRC.STL_GEOMETRY_ANALYSIS, '自动分支 mcSrc 应为 STL_GEOMETRY_ANALYSIS');
      setup({ mcHotUser: 10 });                    // 用户改 Mc 输入框 → 用户
      assert(calc().mcSrc === SRC.USER_OVERRIDE, '用户改 Mc 输入框 → USER_OVERRIDE');
      setup({ hsStatus: 'NO_HOTSPOT', hs: [] });   // 无热结 → 壁厚兜底
      assert(calc().mcSrc === SRC.DERIVED, '无热结走 wallHot → DERIVED');
      setup({ pick: [{ id: 1, mc: 14 }] });        // 勾选未改值 → 仍是自动
      assert(calc().mcSrc === SRC.STL_GEOMETRY_ANALYSIS,
        '勾选但未改值，Mc 仍是检出值 → 必须仍标为自动（旧实现会显示成"用户输入"）');
      setup({ pick: [{ id: 1, mc: 20 }] });        // 勾选改了值 → 用户
      assert(calc().mcSrc === SRC.USER_OVERRIDE, '勾选并改值 → USER_OVERRIDE');
      // 多热结：每个冒口各自带来源
      setup({ pick: [{ id: 1, mc: 20 }, { id: 2, mc: 12 }] });
      const r = calc();
      assert(r.items[0].mcSrc === SRC.USER_OVERRIDE && r.items[1].mcSrc === SRC.STL_GEOMETRY_ANALYSIS,
        '多热结必须**逐项**标来源，不能整组共用一个');
    },
  },

  /* ================= 5. D2：结构守卫 ================= */
  {
    name: '08-5 D2 结构守卫：结果页不得再用"数值差"判断 Mc 来源',
    fn: () => {
      assert(!/Math\.abs\(it\.hsMc - it\.Mc\)\s*>\s*1e-9/.test(VIEW_RESULTS),
        '结果页仍在用 |hsMc − Mc| 数值差判断来源（用户把值改回检出值时会标错）');
      assert(/const isUserMc = \(it\) =>/.test(VIEW_RESULTS), '结果页缺 isUserMc 判定');
      assert(VIEW_RESULTS.includes('r.mcSrc'), '结果页来源行未消费 r.mcSrc');
      // 来源必须在**选值处**标注（calcManifest），视图不反推
      assert(MANIFEST_SRC.includes('mcSrc = proj.SRC.STL_GEOMETRY_ANALYSIS')
        && MANIFEST_SRC.includes('mcSrc: editedItem ? proj.SRC.USER_OVERRIDE : proj.SRC.STL_GEOMETRY_ANALYSIS'),
        'calcManifest 未在选值处逐项标注 mcSrc');
    },
  },

  /* ================= 6. D3：归因 ================= */
  {
    name: '08-6 D3 尺寸归因：bind 恒为 modulus（体积约束不再决定尺寸），dModOnly 正确',
    fn: () => {
      // PHASE V2.0-22（138.txt §3.5/§四.1）：原前提随"体积约束不再决定尺寸"失效，改为守住新契约。
      //   旧实现按"重件 / f 起点 / 撞上限"分出 volume / start / limit 三种归因；本阶段推荐尺寸
      //   **只**由 `Mr_target = Mc × MODULUS_TARGET_RATIO` 反求（riser.js 已无 f 迭代、无 f 上限）
      //   ⇒ `bind` 恒为 `'modulus'`，`'volume'` / `'limit'` 在新结果里结构性不可达。
      const vol = riser(14);                       // 旧基线：体积约束顶住（bind=volume，D=147）
      assert(vol.bind === 'modulus', `重件也应为 modulus，实际 ${vol.bind}`);
      assert(vol.D === 101 && vol.H === 101, `Mc=14 应为 101/101（按 Mr_target=16.8 反求），实际 ${vol.D}/${vol.H}`);
      assert(vol.dModOnly === 101, `仅按目标模数所需直径应为 101，实际 ${vol.dModOnly}`);
      assert(vol.dModOnly <= vol.D, '连续解取整不得超过最终整数档（升档只补不削）');
      // 新契约的核心（138.txt §3.4）：整件净重不再改变推荐尺寸 —— 同一 Mc 只改 cast_wt，D/H 逐位不变。
      const volThin = riser(14, 0);
      assert(volThin.D === vol.D && volThin.H === vol.H,
        `体积不再决定尺寸：Mc=14 在 0kg 与 77.56kg 下 D/H 必须相同（${volThin.D}/${volThin.H} vs ${vol.D}/${vol.H}）`);
      // 旧体积模型仍**如实计算**（未被静默删除），但它已不是设计判据（§3.5）。
      assert(vol.volOk === false && volThin.volOk === true,
        `旧体积模型诊断应保留（77.56kg 未通过 / 未填重量不校核），实际 ${vol.volOk}/${volThin.volOk}`);

      const start = riser(30);                     // 旧基线：f 起点 1.10 即双通过（bind=start）
      assert(start.bind === 'modulus' && start.final_f === 1.2, `应恒为 modulus / f=1.2，实际 ${start.bind}/${start.final_f}`);
      assert(start.dModOnly === start.D, '起点即通过时，仅模数直径 = 实际直径');

      const limit = riser(5);                      // 旧基线：迭代撞 f 上限（bind=limit，f=3.55）
      assert(limit.bind === 'modulus', `无迭代 ⇒ 不存在"撞上限"，实际 ${limit.bind}`);
      assert(limit.converged === true, '无迭代 ⇒ 恒收敛（converged 不再是"是否撞上限"）');
      assert(limit.volOk === false, '旧体积模型判定仍如实保留（不足 ⇒ false）；但它不再产生"不合格"结论');
      near(limit.final_f, 1.2, 1e-9, 'final_f 恒为设计规则比例 1.2');

      // 无铸件重量 ⇒ 旧体积约束不存在。新规则下尺寸与铸件重量**无关**（体积不再是设计判据）。
      const mod = riser(2, 0);
      assert(mod.bind === 'modulus', `应为 modulus，实际 ${mod.bind}`);
      assert(mod.final_f === 1.2, '目标模数规则恒取 1.2 ⇒ 不再有"起点 f=1.10"这一步');
      assert(mod.D === 15 && mod.H === 15, `riser(2,0) 的 D/H 变了（${mod.D}/${mod.H}；V2.0-22 前基线 14/14）`);
      near(mod.Mr_act, 2.5, 1e-12, 'riser(2,0) 的 Mr_act 变了（升一档后 = 15/6 = 2.5，旧基线 2.3333…）');
      assert(mod.d_neck === 8, `riser(2,0) 的 d_neck 变了（${mod.d_neck}，基线 8）`);
      assert(mod.dModOnly === 14, `riser(2,0) 的 dModOnly 变了（${mod.dModOnly}，连续解取整 14）`);

      // 归因只是对既成事实的描述：不依赖它的字段也必须在，且目标模数三件套关系成立
      for (const r of [vol, start, limit, mod]) {
        assert(r.bind === 'modulus', `bind 恒为 modulus：${r.bind}`);
        assert(r.modOk === true && r.converged === true, 'modOk / converged 由构造保证为 true');
        assert(r.Mr_target === r.Mc * 1.2 && r.Mr_need === r.Mr_target,
          `Mr_target 必须独立成立且 Mr_need 为恒等别名（${r.Mr_target} / ${r.Mr_need} / Mc=${r.Mc}）`);
      }
    },
  },

  /* ================= 7. D3：结构守卫 ================= */
  {
    name: '08-7 D3 结构守卫：结果页渲染归因；归因缺失时不得编造结论',
    fn: () => {
      assert(VIEW_RESULTS.includes('bindHint('), '结果页未渲染尺寸归因');
      // PHASE V2.0-22（138.txt §3.5/§四.1）：原前提随"体积约束不再决定尺寸"失效，改为守住新契约 ——
      //   旧的 `it.bind === 'volume'` 分支（"本尺寸由补缩体积校核主导…"）已随本阶段删除：
      //   新算法下 `bind` 恒为 `'modulus'`，该分支永不可能命中，留着只会继续暗示"体积决定尺寸"。
      assert(!/it\.bind === 'volume'/.test(VIEW_RESULTS),
        '结果页不得再有"体积主导"归因分支（该分支已随 bind 恒为 modulus 删除）');
      //   注意：只认出**渲染处**（`tr('<文案>'` 形式），不能拿裸关键词去撞源码注释
      //   （resultsCenter.js 里正留着一条"该分支已删除"的说明性注释）。
      assert(!/tr\(\s*'[^']*(补缩体积校核|改变 Mc 基本不会改变)/.test(VIEW_RESULTS),
        '旧的体积主导文案不得复活（138.txt §3.4：禁止经任何隐蔽路径恢复体积主导）');
      // S5-01：旧体积模型提示已从结果页移除（不是设计判据，也不再要求用户处理）。
      //   "不得存在"类断言先剥离注释：源码注释会引用被移除的旧文案。
      const Vc = VIEW_RESULTS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
      assert(!Vc.includes('📎 旧体积模型参考') && !Vc.includes('旧体积参考不足'),
        'S5-01：结果页不得再显示旧体积模型提示');
      assert(VIEW_RESULTS.includes('推荐尺寸依据当前目标模数规则计算'),
        '结果页仍须保留目标模数规则 + 尚需生产验证的提示');
      // PHASE V2.0-15（126.txt §三 · **声明式规格变更**）：
      //   原先此处断言 `it.bind === 'limit'` 字面量存在。V2.0-15 把"未收敛"的**判定与文案**
      //   抽到单一来源 `js/views/riserStatus.js`（四个入口共用），结果页改为调用 `riserWarning(it)`
      //   ⇒ 字面量比较已不在本文件内。**守卫的意图（结果页必须渲染未收敛分支 + 无法判定时沉默）
      //   不变，且断言加强**：改为核验"调用共享来源"+"该来源确实处理 limit"+"保守兜底仍在"。
      assert(/riserWarning\(it\)/.test(VIEW_RESULTS),
        '缺"未收敛"渲染（应调用 js/views/riserStatus.js 的 riserWarning —— 单一来源）');
      assert(VIEW_RESULTS.includes("from './riserStatus.js'"), '结果页必须从 riserStatus 取未收敛状态');
      const STATUS_SRC = read('js/views/riserStatus.js');
      assert(/riserConverged\(r\) !== false/.test(STATUS_SRC), 'riserStatus 未按收敛状态分档');
      assert(/'limit'/.test(STATUS_SRC), 'riserStatus 未处理 bind === "limit" 的兼容回退');
      // ★ 单一来源：未收敛文案不得在四个入口里各写一份
      for (const f of ['js/views/resultsCenter.js', 'js/views/reportGenerator.js', 'js/views/riserView.js', 'js/views/wizard.js']) {
        assert(!/迭代已达上限/.test(read(f)), `${f} 自行编写了未收敛文案（应取自 riserStatus）`);
        // PHASE V2.0-22（138.txt §3.4）：旧的"体积主导"文案同样不得经**任何**入口复活
        //   （只认渲染处 `tr('<文案>'`，不撞源码注释）。
        assert(!/tr\(\s*'[^']*(补缩体积校核|改变 Mc 基本不会改变)/.test(read(f)),
          `${f} 复活了"本尺寸由体积校核主导"文案（138.txt §3.4 已取消该归因）`);
      }
      // 无法识别时必须沉默（保守），不得默认说成"体积主导"
      assert(/function bindHint\(it\)[\s\S]*?return '';\s*\}/.test(VIEW_RESULTS),
        'bindHint 缺少"无法归因 → 不出结论"的保守兜底');
      // 归因不得反过来影响计算：riser.js 的 bind 分支必须写在收敛判定之后、且不改 D/H
      assert(!/bind\s*=[^=][\s\S]{0,200}?D\s*=/.test(read('calcs/riser.js').split('const neck_k')[0].split('const bind')[1] || ''),
        'bind 归因不得参与 D/H 赋值');
    },
  },

  /* ================= 8. 数值基线 ★ ================= */
  {
    name: '08-8 ★ 数值基线（PHASE V2.0-22 新设计规则）：D/H/f/Mr_act/Vr/d_neck/volOk/modOk 逐位固定',
    fn: () => {
      // 基线 = **PHASE V2.0-22 新规则**实测（球铁 / cyl / hd=1 / 77.56kg）。
      //   PHASE V2.0-22（138.txt §3.5/§四.1）：原前提随"体积约束不再决定尺寸"失效，改为守住新契约 ——
      //   下表数值由新算法**独立复算**：cyl + hd=1 ⇒ M(D,H) = D/6，Mr_target = 1.2 × Mc，
      //   D = 满足 D/6 ≥ Mr_target 的**最小整数**（整件净重只影响 volOk 这一诊断位，不再影响尺寸）。
      const BASE = [
        { mc: 5, D: 36, H: 36, f: 1.2, Mr: 6, Vr: 36643.536711471344, neck: 20, volOk: false, modOk: true },
        { mc: 8, D: 58, H: 58, f: 1.2, Mr: 9.666666666666666, Vr: 153240.60645680293, neck: 32, volOk: false, modOk: true },
        { mc: 11.43, D: 83, H: 83, f: 1.2, Mr: 13.833333333333334, Vr: 449080.4596545368, neck: 46, volOk: false, modOk: true },
        { mc: 14, D: 101, H: 101, f: 1.2, Mr: 16.833333333333332, Vr: 809196.5131465544, neck: 56, volOk: false, modOk: true },
        { mc: 20, D: 144, H: 144, f: 1.2, Mr: 24, Vr: 2345186.349534166, neck: 80, volOk: true, modOk: true },
        { mc: 30, D: 216, H: 216, f: 1.2, Mr: 36, Vr: 7915003.9296778105, neck: 120, volOk: true, modOk: true },
      ];
      for (const b of BASE) {
        const r = riser(b.mc);
        assert(r.D === b.D && r.H === b.H, `Mc=${b.mc}：D/H 变了（${r.D}/${r.H}，基线 ${b.D}/${b.H}）`);
        near(r.final_f, b.f, 1e-9, `Mc=${b.mc}：final_f 变了`);
        near(r.Mr_act, b.Mr, 1e-9, `Mc=${b.mc}：Mr_act 变了`);
        near(r.Vr, b.Vr, 1e-6, `Mc=${b.mc}：Vr 变了`);
        assert(r.d_neck === b.neck, `Mc=${b.mc}：d_neck 变了（${r.d_neck}）`);
        assert(r.volOk === b.volOk && r.modOk === b.modOk, `Mc=${b.mc}：校核结论变了`);
      }
      // 轻件（旧"模数主导区"）的另一组基线：新规则下与重件**同一组尺寸** —— 这就是 §3.4 要求的解耦
      const LIGHT = [{ mc: 5, D: 36, f: 1.2 }, { mc: 8, D: 58, f: 1.2 }, { mc: 11.43, D: 83, f: 1.2 }, { mc: 20, D: 144, f: 1.2 }];
      for (const b of LIGHT) {
        const r = riser(b.mc, 7.37);
        assert(r.D === b.D, `7.37kg Mc=${b.mc}：D 变了（${r.D}，基线 ${b.D}）`);
        near(r.final_f, b.f, 1e-9, `7.37kg Mc=${b.mc}：final_f 变了`);
      }
      // PHASE V2.0-22（138.txt §3.4 / 138.txt §六.B.1-B.2）：**体积约束解耦** ——
      //   固定 Mc / 形状 / 高径比，只改 cast_wt（0.1kg ~ 5000kg），推荐 D/H 必须逐位不变。
      //   旧算法在"体积主导区"会因此把尺寸放大（Mc=14 实测 D=144 vs 仅按模数 75），本阶段禁止复活。
      for (const mc of [5, 8, 11.43, 14, 20, 30]) {
        const lo = riser(mc, 0.1), hi = riser(mc, 5000);
        assert(lo.D === hi.D && lo.H === hi.H,
          `Mc=${mc}：D/H 随 cast_wt 变了（0.1kg ${lo.D}/${lo.H} · 5000kg ${hi.D}/${hi.H}）`);
        assert(hi.Mr_target === mc * 1.2 && meetsTarget(hi.Mr_act, hi.Mr_target),
          `Mc=${mc}：目标模数规则不成立（Mr_target=${hi.Mr_target}，Mr_act=${hi.Mr_act}）`);
      }
      // 四种形状 × 三种材料的快照（形状与材料不得受本次改动影响）
      const snap = (shape, mat, mc, wt) => {
        const r = runRiser({ ...RUN, shape, mat, cast_wt: wt, mc });
        return [r.D, r.H, r.d_neck, Math.round(r.Vr)].join('/');
      };
      assert(snap('cyl', '球铁', 15, 20) === snap('cyl', '球铁', 15, 20), '同输入必须同输出');
      assert(snap('sphere_head', '球铁', 15, 20) !== snap('cyl', '球铁', 15, 20), '形状仍生效（效率不同）');
      assert(snap('cyl', '灰铁', 15, 20) !== snap('cyl', '球铁', 15, 20), '材料仍生效（shrink/neck_k 不同）');
    },
  },

  /* ================= 9. 文案登记 ================= */
  {
    name: '08-9 新词条（归因说明 / 多热结来源行 / 未收敛警告）已登记英文',
    fn: () => {
      // PHASE V2.0-15（126.txt §三 · **声明式规格变更**）：
      //   原第 4 条 key「⚠️ 迭代已达上限（f = {f}）仍未**同时**满足模数与体积校核…」已**废弃** ——
      //   V2.0-14 实测 limit 点里 **89% 是 modOk=true、只有体积不过**，那句话与事实不符。
      //   现按实际约束通过情况分档为下面 4 条（由 js/views/riserStatus.js 单一供给）。
      //   **断言只增不减**：钉住的 key 由 4 条 4 项变为 7 条，是加强而非放宽。
      for (const k of [
        '来源：STL 热结检测 Mc = <b>{m} mm</b>（热结 H{n}）—— <b>自动估计值，尚未验证适用于所有几何</b>',
        '（热结 H{n}）',
        'ℹ️ 本尺寸由<b>补缩体积校核</b>主导（冒口需承担整件补缩量），改变 Mc 基本不会改变 D/H。仅按模数（Mc × 1.10）所需直径为 ⌀{d} mm。',
        // ↓ PHASE V2.0-15 新增的 4 条未收敛警告（替代上面那条已废弃的旧 key）
        '⚠️ <b>未收敛</b>（迭代已达上限 f = {f}）：<b>模数校核通过，体积校核未通过</b>。当前 D/H 不是收敛解，<b>不能当作已通过全部约束的设计结果</b>——可按需加大冒口、增设冷铁或改用发热/保温冒口后重新评估。',
        '⚠️ <b>未收敛</b>（迭代已达上限 f = {f}）：<b>模数校核与体积校核均未通过</b>。当前 D/H 不是收敛解，<b>不能当作已通过全部约束的设计结果</b>——可按需加大冒口、增设冷铁或改用发热/保温冒口后重新评估。',
        '⚠️ <b>未收敛</b>（迭代已达上限 f = {f}）：<b>模数校核未通过</b>（本次未填写铸件重量，未做体积校核）。当前 D/H 不是收敛解，<b>不能当作已通过全部约束的设计结果</b>。',
        '未收敛',
        '计算所得冒口（未收敛，非最终建议）',
        '当前计算所得（未收敛，非最终建议）：',
      ]) assert(typeof EN[k] === 'string' && EN[k].length > 0, `新词条缺英文：${k}`);
      // 废弃的旧 key 不得再被任何视图渲染（否则读者仍会看到那句与事实不符的话）
      const VIEWS = read('js/views/resultsCenter.js') + read('js/views/riserView.js')
        + read('js/views/wizard.js') + read('js/views/reportGenerator.js');
      assert(!VIEWS.includes('仍未同时满足模数与体积校核'),
        '已废弃的 limit 文案（称"模数与体积均不满足"）不得再出现在任何视图中');
    },
  },
];
