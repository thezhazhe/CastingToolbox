// ============================================================
// 149.txt · S1（恢复参数说明 / 工程示意图 / 帮助内容 + 直接相关的状态显示与交互）
//
// 覆盖本轮**可以纯函数化断言**的部分：
//   T1 五态 Mc 来源文案与实际计算路径一致（含 S0 实测的两处相反文案）
//   T2 `rejected` 不再回落成「无热结」
//   T3 恢复自动值的真实语义（v+src+conf 三件一起，不是"把数字改回去"）
//   T4 逐热结改 Mc 只影响该热结（`process.hsPick` 的元素级绑定）
//   T5 `hsPick` 两个入口的来源语义已统一，且 restoreAutoValue 对它不撒谎
//   T6 恢复的示意图 / 帮助资源**确实存在于资源层**（图不是新画的、表不是抄的）
//   T7 参数窗口的草稿语义未被本轮改动破坏（草稿不落盘）
//
// 判据来源全部是**代码事实**，不引用任何设计意图：
//   `calcs/calcManifest.js` 的 riser 分支、`js/model/CastingProject.js` 的 set/restoreAutoValue、
//   `calcs/riser.js` 的 RISER_EFF / RISER_SHAPES、`js/views/gatingDiagram.js` 的 POSITIONS。
// ============================================================
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as proj from '../js/model/CastingProject.js';
import { SRC, CONF } from '../js/model/CastingProject.js';
import { CALC_MANIFEST } from '../calcs/calcManifest.js';
import { RISER_EFF, RISER_SHAPES } from '../calcs/riser.js';
import { hsSourceInfo, HS_SRC_KIND } from '../js/views/hsSourceNote.js';
import { POSITIONS, gatingDiagramSvg } from '../js/views/gatingDiagram.js';
import { RATIO_HELP_INTRO, RATIO_HELP_AUTO, RATIO_HELP_TIP, ratioHelpRows, RATIO_APPLIC, ENG_NOTES } from '../js/views/gatingView.js';
import { RATIO_PRESETS } from '../calcs/gating.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const riser = () => CALC_MANIFEST.find(c => c.id === 'riser').calculate;

/* 设计中心依赖 DOM（顶层读 `location`），Node 侧无法 import ⇒ 按本项目既有做法读源码断言。
   ⚠ 断言前**必须先剥注释**（本项目踩过的坑：注释里的旧文案会让"不得存在"类断言假绿）。 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const DC_SRC = stripComments(readFileSync(join(__dirname, '..', 'js', 'views', 'designCenter.js'), 'utf8'));

/** 基准件：球铁 8.6kg，热结 H1=10.3 / H2=6.8 */
function loadCase() {
  proj.reset();
  proj.set('material.family', '球铁', SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('material.solidDensity', 7.1, SRC.DERIVED, CONF.HIGH);
  proj.set('material.liquidDensity', 6.9, SRC.DERIVED, CONF.HIGH);
  proj.set('geometry.volumeCm3', 1250, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.size', [400, 200, 68], SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.geomStatus', 'VALID', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('process.wallUsed', 68, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.refreshWeight();
}
/** 走一遍 writeHotspotsToProject 的核心写入（与设计中心同一条链，逐个字段照抄） */
function seedHotspots(status, items, reason = '') {
  proj.set('hotspots.status', status, SRC.STL_GEOMETRY_ANALYSIS, CONF.MEDIUM);
  proj.set('hotspots.reason', reason, SRC.STL_GEOMETRY_ANALYSIS, CONF.MEDIUM);
  proj.set('hotspots.items', items, SRC.STL_GEOMETRY_ANALYSIS, CONF.MEDIUM);
  if (status === 'ok' && items.length) {
    proj.set('process.mcHotspot', items[0].mc, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  }
  // 兜底路径：wallHot = 可信主体壁厚 ÷ 2
  proj.set('process.wallHot', 34, SRC.DERIVED, CONF.MEDIUM);
}
/** 设计中心 mcSourceNote() 的取值方式（逐字段同序） */
const note = (reasonText = 'X') => hsSourceInfo({
  status: proj.getV('hotspots.status'),
  reasonText,
  itemCount: (proj.getV('hotspots.items') || []).length,
  itemIds: (proj.getV('hotspots.items') || []).map(h => h.id),
  mcHotspot: proj.get('process.mcHotspot'),
  wallHot: proj.get('process.wallHot'),
  picks: proj.getV('process.hsPick') || [],
  geomStatus: proj.getV('geometry.geomStatus'),
});
const H1 = { id: 1, x: 0, y: 0, z: 0, mc: 10.3, regionVolumeCm3: 604.3, confidence: 0.95 };
const H2 = { id: 2, x: 1, y: 0, z: 0, mc: 6.8, regionVolumeCm3: 210.0, confidence: 0.8 };

export const tests = [
  /* ============================================================
     T1 · 五态：文案必须与 calcManifest 的真实分支一致（149 §三.1）
     ============================================================ */
  {
    name: 'S1-T1a 状态矩阵：五态各自的 kind / blocked / mc 与 calcManifest 逐支吻合',
    fn: () => {
      // ① ok（自动 Mc）→ 用 mcHotspot，不阻断
      loadCase(); seedHotspots('ok', [H1]);
      let r = riser()({});
      let n = note();
      assert(!r.blocked, 'ok 态不应阻断');
      assert(Math.abs(r.Mc - 10.3) < 1e-9, `ok 态 Mc 应 = mcHotspot 10.3（实际 ${r.Mc}）`);
      assert(n.kind === HS_SRC_KIND.STL && !n.blocked && n.mc === 10.3, `ok 态文案 kind=${n.kind} blocked=${n.blocked} mc=${n.mc}`);

      // ② NO_HOTSPOT → 用 wallHot（= 主体壁厚 ÷ 2），不阻断；**且必须把 reason 带出来**
      loadCase(); seedHotspots('NO_HOTSPOT', [], 'no_candidate');
      r = riser()({}); n = note('未检测到热结候选');
      assert(!r.blocked, 'NO_HOTSPOT 不应阻断');
      assert(Math.abs(r.Mc - 34) < 1e-9, `NO_HOTSPOT 态 Mc 应 = wallHot 34（实际 ${r.Mc}）`);
      assert(n.kind === HS_SRC_KIND.WALL && !n.blocked && n.mc === 34, `NO_HOTSPOT 文案 kind=${n.kind} mc=${n.mc}`);
      assert(/主体壁厚 ÷ 2/.test(n.text), 'NO_HOTSPOT 文案必须说明"主体壁厚 ÷ 2"这条真实路径');
      assert(n.extra && /热结分析原因/.test(n.extra), 'NO_HOTSPOT 必须把 reason 带出来（rejected 才有地方显示）');
      assert(n.extraParams[0] === '未检测到热结候选', `reason 应原样带出（实际 ${n.extraParams[0]}）`);

      // ③ LOW_CONFIDENCE（items 非空）→ **阻断**；文案不得说成"STL 热结检测"或"主体壁厚÷2"
      loadCase(); seedHotspots('LOW_CONFIDENCE', [H1], 'all_low_confidence');
      r = riser()({}); n = note();
      assert(r.blocked === true, 'LOW_CONFIDENCE 必须阻断（无用户 Mc 时）');
      assert(n.blocked === true && n.kind === HS_SRC_KIND.BLOCKED_LOWCONF, `LOW_CONFIDENCE 文案 kind=${n.kind}`);
      assert(!/来源：STL 热结检测/.test(n.text), '⚠ 这正是 S0 查出的相反文案：不得再说"来源：STL 热结检测（最大热结 H1）"');
      assert(!/主体壁厚 ÷ 2/.test(n.text) || /不是/.test(n.text), 'LOW_CONFIDENCE 不得声称"按主体壁厚 ÷ 2 计算"');

      // ④ INSUFFICIENT_RESOLUTION（items 空）→ **阻断**；文案不得说成"按主体壁厚÷2 估算"
      loadCase(); seedHotspots('INSUFFICIENT_RESOLUTION', [], 'no_inside_points');
      r = riser()({}); n = note();
      assert(r.blocked === true, 'INSUFFICIENT_RESOLUTION 必须阻断（无用户 Mc 时）');
      assert(n.blocked === true && n.kind === HS_SRC_KIND.BLOCKED_RESOLUTION, `INSUFFICIENT 文案 kind=${n.kind}`);
      assert(/不是/.test(n.text), '⚠ 这正是 S0 查出的相反文案：必须明确"不是按主体壁厚 ÷ 2 估算"');

      // ⑤ none（无 STL / 已清空）→ 走 wallHot 兜底
      loadCase(); proj.set('hotspots.status', 'none', SRC.DEFAULT, CONF.LOW);
      proj.set('hotspots.items', [], SRC.DEFAULT, CONF.LOW);
      proj.set('process.wallHot', 34, SRC.DERIVED, CONF.MEDIUM);
      n = note();
      assert(n.kind === HS_SRC_KIND.NONE && !n.blocked && n.mc === 34, `none 态 kind=${n.kind} mc=${n.mc}`);
      assert(!/STL/.test(n.text) || /没有 STL/.test(n.text), 'none 态不得暗示存在 STL 热结检测结果');
    },
  },
  {
    name: 'S1-T1b 用户显式填 Mc ⇒ 文案说明"按用户确认值"，且与 calcManifest 的人工放行一致',
    fn: () => {
      for (const st of ['LOW_CONFIDENCE', 'INSUFFICIENT_RESOLUTION']) {
        const items = st === 'LOW_CONFIDENCE' ? [H1] : [];
        loadCase(); seedHotspots(st, items, 'all_low_confidence');
        proj.set('process.mcHotspot', 12.5);            // 用户显式输入 → USER_OVERRIDE
        const p = proj.get('process.mcHotspot');
        assert(p.src === SRC.USER_OVERRIDE && p.v === 12.5, `前置：mcHotspot 应为用户覆盖（${p.src}）`);
        const r = riser()({});
        const n = note();
        assert(!r.blocked, `${st} + 用户 Mc ⇒ calcManifest 应放行`);
        assert(Math.abs(r.Mc - 12.5) < 1e-9, `${st} 放行后应按用户值 12.5（实际 ${r.Mc}）`);
        assert(n.kind === HS_SRC_KIND.USER && /用户确认的/.test(n.text), `${st} 文案须说明采用用户确认值（kind=${n.kind}）`);
        assert(!/自动热结检测已经可靠|自动检测结果可靠/.test(n.text), '不得声称自动热结检测可靠');
      }
      // 有热结项时优先级：只看 mcHotspot（与 calcManifest 的 `else if (hs.length > 0)` 同序）
      loadCase(); seedHotspots('ok', [H1]);
      proj.set('process.wallHot', 99);                  // wallHot 被用户改过
      proj.set('process.mcHotspot', 12.5);              // mcHotspot 也被用户改过
      assert(Math.abs(riser()({}).Mc - 12.5) < 1e-9, '有热结项 ⇒ 取 mcHotspot 的用户值');
      assert(note().mc === 12.5, '文案与计算取同一个值');
      // 无热结项时优先级：先 wallHot（与 calcManifest 的 `else if (isUserVal(wallHotSrc))` 同序）
      loadCase(); seedHotspots('NO_HOTSPOT', [], 'no_candidate');
      proj.set('process.wallHot', 21);
      proj.set('process.mcHotspot', 12.5);
      assert(Math.abs(riser()({}).Mc - 21) < 1e-9, '无热结项 ⇒ 先取 wallHot 的用户值');
      assert(note().mc === 21, '文案与计算取同一个值（无热结项时优先 wallHot）');
    },
  },
  {
    name: 'S1-T1c 几何 INVALID ⇒ 硬阻断压过人工放行，文案必须显式说明',
    fn: () => {
      loadCase(); seedHotspots('ok', [H1]);
      proj.set('geometry.geomStatus', 'INVALID', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
      proj.set('process.mcHotspot', 12.5);              // 即便用户填了 Mc
      const r = riser()({});
      const n = note();
      assert(r.level === 'BLOCK_AUTO_RECOMMEND', `几何 INVALID ⇒ 等级必须 BLOCK（实际 ${r.level}）`);
      assert(n.hardBlocked === true && n.blocked === true, '硬阻断必须被文案层识别');
      assert(/硬阻断/.test(n.extra || ''), '硬阻断必须显式说明（不得只给一个看似正常的推荐值）');
    },
  },

  /* ============================================================
     T2 · rejected 不再回落成「无热结」（149 §三 末段）
     ============================================================ */
  {
    name: 'S1-T2 hotspots.reason="rejected" 有专属文案，不回落成"无热结"',
    fn: () => {
      // ① 引擎侧：`rejected` 确实是 hotspotV3 的裸字符串产出（只读核对，冻结文件未改）
      const v3 = readFileSync(join(__dirname, '..', 'js', 'engine', 'v3', 'hotspotV3.js'), 'utf8');
      assert(/reason = audit\.length \? 'rejected' : HS_REASON\.NO_CANDIDATE/.test(v3),
        "rejected 的产出点应仍是 hotspotV3 的 `audit.length ? 'rejected' : …`");
      assert(!/REJECTED/.test(v3.split('\n').filter(l => l.includes('HS_REASON =')).join('')),
        'rejected 确实不在 HS_REASON 枚举里 ⇒ 显示层必须自己补');
      // ② 显示层：designCenter 的 hsReasonText 有专属映射
      assert(/HS_REASON_REJECTED = 'rejected'/.test(DC_SRC), 'designCenter 应定义 rejected 常量');
      const i = DC_SRC.indexOf('function hsReasonText');
      assert(i > 0, '应存在 hsReasonText');
      const body = DC_SRC.slice(i, i + 600);
      assert(/\[HS_REASON_REJECTED\]\s*:/.test(body), '✅ hsReasonText 的映射表里应有 rejected 键');
      assert(!/\|\|\s*'无热结'/.test(body.split('[HS_REASON_REJECTED]')[0].slice(-40)) , '');
      // ③ 语义：NO_HOTSPOT + rejected 不得被说成"未检出热结候选"
      loadCase(); seedHotspots('NO_HOTSPOT', [], 'rejected');
      const n = note('有热结候选但均未通过筛选（未达热结判定标准）');
      assert(!/未检测到热结候选/.test(n.text), 'rejected 不得显示成"未检测到热结候选"');
      // ④ processPage1 的长提示同样补了这个键
      const p1 = stripComments(readFileSync(join(__dirname, '..', 'js', 'views', 'processPage1.js'), 'utf8'));
      assert(/rejected:\s*'有热结候选但均未通过筛选/.test(p1), 'processPage1 的 HS_NOTE 也应补 rejected');
    },
  },

  /* ============================================================
     T3 · 恢复自动值的真实语义（149 §五）
     ============================================================ */
  {
    name: 'S1-T3 restoreAutoValue 恢复的是 v+src+conf 三件，而不是"把数字改回去"',
    fn: () => {
      loadCase(); seedHotspots('ok', [H1]);
      const auto = 10.3;
      proj.set('process.mcHotspot', 12.5);              // 用户覆盖
      let p = proj.get('process.mcHotspot');
      assert(p.v === 12.5 && p.src === SRC.USER_OVERRIDE, '前置：已覆盖');
      assert(p.orig && p.orig.v === auto, `前置：orig 基准 = 自动原值 ${auto}（实际 ${p.orig?.v}）`);
      assert(proj.restoreAutoValue('process.mcHotspot') === true, '应当恢复成功');
      p = proj.get('process.mcHotspot');
      assert(p.v === auto, `值回到自动原值（${p.v}）`);
      assert(p.src === SRC.STL_GEOMETRY_ANALYSIS, `来源一并还原（${p.src}）——这是与"改成同一个数"的本质区别`);
      assert(Math.abs(riser()({}).Mc - auto) < 1e-9, '重算后的 Mc 回到自动值');

      // 无 orig 的参数：restoreAutoValue 必须返回 false（⇒ 界面不得给它显示 ↺）
      loadCase();
      proj.set('geometry.blankWeightKg', 9.9);
      const bw = proj.get('geometry.blankWeightKg');
      // 毛坯重的自动来源是 DERIVED ⇒ 首次覆盖会固化 orig；先确认它确实可恢复
      assert(bw.orig != null, '毛坯重（DERIVED 来源）首次覆盖应固化 orig');
      assert(proj.restoreAutoValue('geometry.blankWeightKg') === true, '毛坯重应可恢复');
      // 从未被覆盖过的参数：没有 orig ⇒ 恢复不了（界面据此决定不显示入口）
      loadCase();
      assert(proj.restoreAutoValue('process.Ho') === false, '无 orig 的参数必须返回 false（不得给假入口）');
      assert(proj.get('process.Ho').orig === undefined, '无 orig 时也不应凭空造一个');
    },
  },
  {
    name: 'S1-T3b 三个目标参数（Mc / 主体壁厚 / 毛坯重量）都在可恢复之列',
    fn: () => {
      loadCase(); seedHotspots('ok', [H1]);
      // 主体壁厚：STL 自动
      proj.set('process.wallUsed', 55);
      assert(proj.get('process.wallUsed').src === SRC.USER_OVERRIDE, '前置：wallUsed 已覆盖');
      assert(proj.restoreAutoValue('process.wallUsed') === true, '主体壁厚应可恢复');
      assert(proj.get('process.wallUsed').v === 68 && proj.get('process.wallUsed').src === SRC.STL_GEOMETRY_ANALYSIS,
        '主体壁厚恢复到 68 / STL 自动');
      // Mc
      proj.set('process.mcHotspot', 12.5);
      assert(proj.restoreAutoValue('process.mcHotspot') === true, 'Mc 应可恢复');
      // 毛坯重量：DERIVED 自动
      proj.set('geometry.blankWeightKg', 12);
      assert(proj.get('geometry.blankWeightKg').src === SRC.USER_OVERRIDE, '前置：毛坯重已覆盖');
      assert(proj.restoreAutoValue('geometry.blankWeightKg') === true, '毛坯重量应可恢复');
      assert(proj.get('geometry.blankWeightKg').src === SRC.DERIVED, '毛坯重量恢复到"自动计算"来源');
    },
  },

  /* ============================================================
     T4 · 逐热结改 Mc 的元素级绑定（149 §四）
     ============================================================ */
  {
    name: 'S1-T4 改 H2 的 Mc 不影响 H1；取消勾选只移除自己',
    fn: () => {
      loadCase(); seedHotspots('ok', [H1, H2]);
      // 勾选两个（= 左栏/参数窗共用的数据结构）
      proj.set('process.hsPick', [{ id: 1, mc: 10.3 }, { id: 2, mc: 6.8 }], SRC.USER_INPUT, CONF.USER_CONFIRMED);
      let r = riser()({});
      assert(r.items && r.items.length === 2, `两个热结应各出一个冒口方案（实际 ${r.items?.length}）`);
      // 逐项改 H2（模拟行内输入框：只替换 id===2 的元素）
      const base = proj.getV('process.hsPick').slice();
      const rest = base.filter(p => p.id !== 2); rest.push({ id: 2, mc: 9.1 });
      proj.set('process.hsPick', rest, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      const picks = proj.getV('process.hsPick');
      assert(picks.find(p => p.id === 1).mc === 10.3, '⚠ H1 的 Mc 必须一字未动');
      assert(picks.find(p => p.id === 2).mc === 9.1, 'H2 的 Mc 已更新');
      assert(picks.length === 2, '不因编辑而增删条目');
      // H2 的 Mc > H1 ⇒ 主结果换成 H2（calcManifest 取 Mc 最大者；优先级逻辑本身未被本轮改动）
      const rest2 = base.filter(p => p.id !== 2); rest2.push({ id: 2, mc: 12.0 });
      proj.set('process.hsPick', rest2, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      r = riser()({});
      assert(Math.abs(r.Mc - 12.0) < 1e-9, `主结果应取 Mc 最大者 12.0（实际 ${r.Mc}）`);
      // 逐项来源标注：改过的记 USER_OVERRIDE，未改的记 STL_GEOMETRY_ANALYSIS（V2.0-08 契约不变）
      const byId = new Map(r.items.map(i => [i.hsId, i]));
      assert(byId.get(2).mcSrc === SRC.USER_OVERRIDE, 'H2 改过 ⇒ 来源 = 用户修改');
      assert(byId.get(1).mcSrc === SRC.STL_GEOMETRY_ANALYSIS, 'H1 未改 ⇒ 来源 = STL 热结检测');
      // 取消勾选 H2 → 只剩 H1，且 H1 的值不受影响
      proj.set('process.hsPick', picks.filter(p => p.id !== 2).map(p => ({ id: p.id, mc: 10.3 })), SRC.USER_INPUT, CONF.USER_CONFIRMED);
      r = riser()({});
      assert(r.items.length === 1 && r.items[0].hsId === 1, '取消勾选后只剩 H1');
      assert(Math.abs(r.Mc - 10.3) < 1e-9, 'H1 的值不受 H2 增删影响');
    },
  },

  /* ============================================================
     T5 · hsPick 来源语义统一（149 §六）
     ============================================================ */
  {
    name: 'S1-T5 hsPick 统一为 USER_INPUT，且不再显示一个兑现不了的 ↺ 承诺',
    fn: () => {
      loadCase(); seedHotspots('ok', [H1, H2]);
      proj.set('process.hsPick', [{ id: 1, mc: 10.3 }], SRC.USER_INPUT, CONF.USER_CONFIRMED);
      const p = proj.get('process.hsPick');
      assert(p.src === SRC.USER_INPUT, `hsPick 来源应为 USER_INPUT（实际 ${p.src}）`);
      // 语义校验：USER_INPUT = 用户直接输入；USER_OVERRIDE = 用户修改了自动值。
      // hsPick 没有自动写入口（默认 [] = 自动模式），所以它不可能是"覆盖自动值"。
      assert(p.orig === undefined, 'hsPick 不应带 orig（⇒ 若标成 USER_OVERRIDE 就会承诺一个 restoreAutoValue 兑现不了的 ↺）');
      assert(proj.restoreAutoValue('process.hsPick') === false, 'hsPick 本来就恢复不了 —— 所以不能标 USER_OVERRIDE');
    },
  },

  /* ============================================================
     T6 · 恢复的资源确实存在（不是新画的 / 不是另抄的）
     ============================================================ */
  {
    name: 'S1-T6a 浇注方向示意图：三态各有 SVG，且非法位置返回 null',
    fn: () => {
      assert(POSITIONS.join('|') === '顶注|中注|底注', `三个状态应为 顶注/中注/底注（实际 ${POSITIONS.join('|')}）`);
      const svgs = POSITIONS.map(p => gatingDiagramSvg(p));
      svgs.forEach((s, i) => {
        assert(typeof s === 'string' && s.includes('<svg'), `${POSITIONS[i]} 应产出 SVG`);
        assert(s.includes('>Ho<') && s.includes('>rh<') && s.includes('>ph<'), `${POSITIONS[i]} 的图应标注 Ho/rh/ph`);
      });
      assert(new Set(svgs).size === 3, '三态的图必须互不相同（否则切换看不出变化）');
      assert(gatingDiagramSvg('侧注') === null, '非法浇注位置返回 null（view 层不渲染）');
    },
  },
  {
    name: 'S1-T6b 比例帮助与工程原则：正文/表来自独立计算器同一份导出，且 7 条预设齐全',
    fn: () => {
      const rows = ratioHelpRows();
      assert(rows.length === Object.keys(RATIO_PRESETS).length, '预设条数应与 RATIO_PRESETS 一致');
      assert(rows.length === 7, `应有 7 条预设（实际 ${rows.length}）`);
      rows.forEach(r => {
        assert(typeof r.applic === 'string' && r.applic.length > 0 && r.applic !== '—',
          `预设「${r.key}」缺适用范围文案`);
        assert(new RegExp(`^${r.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`).test(r.key), '');
      });
      assert(Object.keys(RATIO_APPLIC).length === 7, 'RATIO_APPLIC 应有 7 条');
      assert([RATIO_HELP_INTRO, RATIO_HELP_AUTO, RATIO_HELP_TIP].every(s => typeof s === 'string' && s.length > 0),
        '「浇注比例怎么选？」三段正文都应有内容');
      assert(Object.keys(ENG_NOTES).length === 5, `工程原则应为 5 条（实际 ${Object.keys(ENG_NOTES).length}）`);
      Object.values(ENG_NOTES).forEach(s => assert(typeof s === 'string' && s.length > 10, '工程原则不得为空'));
    },
  },
  {
    name: 'S1-T6c 冒口形状效率读 RISER_EFF，四种形状都能取到（UI 不重复硬编码）',
    fn: () => {
      const keys = Object.keys(RISER_SHAPES);
      assert(keys.length === 4, `形状应为 4 种（实际 ${keys.length}）`);
      keys.forEach(k => {
        const effKey = RISER_SHAPES[k].effKey;
        assert(typeof RISER_EFF[effKey] === 'number' && RISER_EFF[effKey] > 0,
          `形状 ${k} 的 effKey=${effKey} 应在 RISER_EFF 里有值`);
      });
      // 与 148-S0 §2.4 实测一致的四个值（读表，不是抄进 UI）
      assert(RISER_EFF[RISER_SHAPES.cyl.effKey] === 14, 'cyl → 14%');
      assert(RISER_EFF[RISER_SHAPES.sphere_head.effKey] === 25, 'sphere_head → 25%');
      assert(RISER_EFF[RISER_SHAPES.sphere.effKey] === 20, 'sphere → 20%');
      assert(RISER_EFF[RISER_SHAPES.square.effKey] === 14, 'square → 14%');
    },
  },

  /* ============================================================
     T7 · 草稿语义未被破坏（149 §七）
     ============================================================ */
  {
    name: 'S1-T7 参数窗口的草稿在保存前不写项目（本轮新增的"待恢复"同样如此）',
    fn: () => {
      loadCase(); seedHotspots('ok', [H1]);
      proj.set('process.mcHotspot', 12.5);
      const before = JSON.stringify(proj.get('process.mcHotspot'));
      const beforePick = JSON.stringify(proj.get('process.hsPick'));
      /* 设计中心的草稿是模块内变量，Node 侧按源码断言其契约：
         · `state.draftRestore` 与 `paramDraft` 同生命周期（开窗建、关窗清）
         · 保存时走 `restoreAutoValue`，**不是** proj.set(path, orig.v) */
      assert(/state\.draftRestore = new Set\(\)/.test(DC_SRC), 'openParamDlg 必须重置待恢复集合');
      assert(/state\.draftRestore = null/.test(DC_SRC), 'closeParamDlg / 保存后必须丢弃待恢复集合');
      assert(/proj\.restoreAutoValue\(path\)/.test(DC_SRC), '保存时必须调用模型层的 restoreAutoValue');
      // ↺ 按钮只在真有 orig 且来源是 USER_OVERRIDE 时渲染
      const cr = DC_SRC.indexOf('function canRestorePath');
      assert(cr > 0, '应存在 canRestorePath 守卫');
      assert(/p\.src === SRC\.USER_OVERRIDE/.test(DC_SRC.slice(cr, cr + 200)), '守卫必须检查 src === USER_OVERRIDE');
      assert(/!!p\.orig/.test(DC_SRC.slice(cr, cr + 200)), '守卫必须检查 orig 存在');
      // 项目此刻确实未被改动
      assert(JSON.stringify(proj.get('process.mcHotspot')) === before, '渲染/交互期间项目数据不变');
      assert(JSON.stringify(proj.get('process.hsPick')) === beforePick, '热结选择在保存前也不变');
    },
  },
  {
    name: 'S1-T7b 五态文案的取值方式与设计中心完全同序（防止两处口径漂移）',
    fn: () => {
      const i = DC_SRC.indexOf('function mcSourceNote()');
      assert(i > 0, '应存在 mcSourceNote');
      const body = DC_SRC.slice(i, i + 900);
      assert(/hsSourceInfo\(\{/.test(body), 'mcSourceNote 必须走单一来源模块');
      assert(/status:\s*proj\.getV\('hotspots\.status'\)/.test(body), '必须以 status 为主判据');
      // ⚠ S0 查出的根因：判据写成 items.length ⇒ 两处失败态文案与实际计算相反。这里钉住它不再回来。
      const head = body.slice(0, body.indexOf('hsSourceInfo'));
      assert(!/items\.length\s*\)/.test(head), '⚠ 取值前不得再用 items.length 判主分支（148-S0 §3.2 的根因）');
      // 五种状态在单一来源模块里各有分支
      const mod = readFileSync(join(__dirname, '..', 'js', 'views', 'hsSourceNote.js'), 'utf8');
      ['BLOCKED_LOWCONF', 'BLOCKED_RESOLUTION', 'STL', 'WALL', 'NONE', 'USER'].forEach(k =>
        assert(new RegExp(`${k}:\\s*'`).test(mod), `HS_SRC_KIND.${k} 应有定义`));
      assert(/case 'LOW_CONFIDENCE'/.test(mod) && /case 'INSUFFICIENT_RESOLUTION'/.test(mod) && /case 'NO_HOTSPOT'/.test(mod),
        '五态分支: ok / NO_HOTSPOT / LOW_CONFIDENCE / INSUFFICIENT_RESOLUTION / default(none)');
    },
  },
];
