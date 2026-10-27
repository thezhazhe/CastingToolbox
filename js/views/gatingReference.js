// ============================================================
// 横浇道截面（矩形 / 标准梯形 / 扁梯形 / 高梯形）· 共享计算
//
// 164.txt 五：梯形从“参考卡”升级为正式截面选项；矩形保留。
//   · 现有 runGating 的 A_run 是**全部横浇道的目标总面积**：
//     runGating 内 `L_r = ceil(A_run / (rc × rt) / 5) × 5`，`Fr_act = rt × L_r × rc`
//     ⇒ A_run 除以条数后才是单条目标面积。本模块对梯形做同一件事：
//       A_each = A_run / n；不重复除、不把 A_run 当单条面积。
//   · 梯形几何：上底 a、下底 2a；标准 h=2a / 扁 h=a / 高 h=4a。
//   · 几何/数量/面积校核是正式主结果；阻流位置/面积比按最终实际总截面积重算
//     （P51 同一面积判定）。本模块不建立梯形流动仿真，不把矩形流校核当作等价验证。
// ============================================================
import { t as tr } from '../i18n/index.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const fmt2 = (v) => (typeof v === 'number' && Number.isFinite(v) ? parseFloat(v.toFixed(2)).toString() : '—');

export const TRAPEZOID_TYPES = {
  standard: { key: 'standard', label: '标准梯形', hFactor: 2, areaFactor: 3 },
  flat: { key: 'flat', label: '扁梯形', hFactor: 1, areaFactor: 1.5 },
  tall: { key: 'tall', label: '高梯形', hFactor: 4, areaFactor: 6 },
};

export const RUNNER_SECTIONS = {
  rect: { key: 'rect', label: '矩形', isTrapezoid: false },
  ...TRAPEZOID_TYPES,
};

/** 由浇注系统真实类型给默认梯形（rd.type: 开放/封闭/自定义） */
export function defaultTrapezoidKind(rdType) {
  if (rdType === '开放') return 'flat';
  if (rdType === '封闭') return 'tall';
  return 'standard';
}

/** 当前生效截面：未保存（''）时按真实浇注系统类型自动匹配 */
export function effectiveRunnerSection(gatingResult, savedSection) {
  if (RUNNER_SECTIONS[savedSection]) return savedSection;
  return defaultTrapezoidKind(gatingResult?.rd?.type);
}

export function normalizeRunnerCount(value, fallback = 1) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

/** 由**单条**目标面积反算梯形尺寸；area 参数是“全部横浇道目标总面积”。
 *  a 向上取整到 0.01 mm，面积校核使用同一组显示尺寸，避免“公式对、显示尺寸对不上”。 */
export function calcTrapezoidRunner({ area, kind = 'standard', count = 1 } = {}) {
  const A = num(Number(area));
  const spec = TRAPEZOID_TYPES[kind] || TRAPEZOID_TYPES.standard;
  const rawCount = count === undefined || count === null || count === '' ? 1 : Number(count);
  if (!Number.isInteger(rawCount) || rawCount < 1) {
    return { ok: false, reason: 'bad_count', kind: spec.key, spec, count: null };
  }
  if (A == null || A <= 0) return { ok: false, reason: 'no_area', kind: spec.key, spec, count: rawCount };
  const areaEachTarget = A / rawCount;
  const aRaw = Math.sqrt(areaEachTarget / spec.areaFactor);
  if (!Number.isFinite(aRaw) || aRaw <= 0) {
    return { ok: false, reason: 'bad_geometry', kind: spec.key, spec, count: rawCount };
  }
  const a = Math.ceil(aRaw * 100 - 1e-9) / 100;
  const top = a;
  const bottom = 2 * a;
  const height = spec.hFactor * a;
  const checkArea = ((top + bottom) * height) / 2;
  const actualTotal = checkArea * rawCount;
  return {
    ok: true, kind: spec.key, spec, count: rawCount,
    area: A, targetTotal: A, areaEachTarget,
    a, top, bottom, height,
    actualEach: checkArea, checkArea,
    actualTotal, areaDelta: actualTotal - A,
  };
}

/** P51 面积判定：只比较最终实际截面积，不引入新的流动模型。 */
function classifyChoke(Fs, Fr, Fg) {
  const parts = [];
  if (Fs > 0) parts.push(['sprue', Fs]);
  if (Fr > 0) parts.push(['runner', Fr]);
  if (Fg > 0) parts.push(['ingate', Fg]);
  if (parts.length !== 3) {
    return { chokeArea: Fs > 0 ? Fs : 0, chokePosition: 'unset', systemType: null, ingateChoke: false, boundaryChoke: false };
  }
  const area = Math.min(parts[0][1], parts[1][1], parts[2][1]);
  const mins = parts.filter((p) => Math.abs(p[1] - area) / area <= 0.01).map((p) => p[0]);
  const pos = mins.length > 1 ? 'boundary' : mins[0];
  const systemType = pos === 'ingate' ? '封闭式/加压式特征：内浇口为阻流截面'
    : pos === 'sprue' ? '开放式/非加压式特征：直浇道为阻流截面'
      : pos === 'runner' ? '横浇道阻流：上游截面控制流量' : '阻流位置临界：建议人工复核';
  return {
    chokeArea: area, chokePosition: pos, systemType,
    ingateChoke: pos === 'ingate', boundaryChoke: pos === 'boundary',
  };
}

/** 把 runGating 结果转换为当前选择截面的主结果。
 *  矩形：完全保留核心结果；梯形：只替换横浇道几何及由实际截面积可确定的字段。
 *  核心的浇注时间、浇注重量、内浇口/直浇道尺寸、内浇口流速、排气判定均不变。 */
export function applyRunnerSection(gatingResult, { section, count } = {}) {
  const g = gatingResult;
  if (!g || g.blocked) return g;
  const kind = RUNNER_SECTIONS[section] ? section : effectiveRunnerSection(g, section);
  if (kind === 'rect') {
    return {
      ...g,
      runnerSection: {
        ok: true, kind: 'rect', label: RUNNER_SECTIONS.rect.label, isTrapezoid: false,
        count: g.rc > 0 ? g.rc : null, thickness: g.rt > 0 ? g.rt : null,
        length: g.L_r > 0 ? g.L_r : null,
        targetTotal: g.A_run, actualTotal: g.Fr_act,
        targetEach: g.rc > 0 ? g.A_run / g.rc : null,
      },
    };
  }
  const n = normalizeRunnerCount(count, 1);
  const res = calcTrapezoidRunner({ area: g.A_run, kind, count: n });
  if (!res.ok) {
    return {
      ...g,
      runnerSection: { ok: false, reason: res.reason, kind, label: RUNNER_SECTIONS[kind]?.label || kind, isTrapezoid: true, count: n },
    };
  }
  const choke = classifyChoke(g.Fs_act, res.actualTotal, g.Fg);
  const rrv = g.Fs_act > 0 ? res.actualTotal / g.Fs_act : 0;
  const rgv = g.Fs_act > 0 ? g.Fg / g.Fs_act : 0;
  const sugs = (g.sugs || []).filter((s) => !String(s).includes('横浇道不足'));
  if (!sugs.length) sugs.push('✅ 参数合理，无需优化');
  return {
    ...g,
    rc: n, rt: null, L_r: null, Fr_act: res.actualTotal,
    rrv, rgv,
    ...choke,
    optChokeMigrated: g.optimized ? (g.Fg > 0 && g.Fg <= g.Fs_act && g.Fg <= res.actualTotal) : null,
    sugs,
    runnerSection: {
      ok: true, kind, label: RUNNER_SECTIONS[kind].label, isTrapezoid: true,
      count: n, targetTotal: res.targetTotal, targetEach: res.areaEachTarget,
      a: res.a, top: res.top, bottom: res.bottom, height: res.height,
      actualEach: res.actualEach, actualTotal: res.actualTotal,
      areaDelta: res.areaDelta, areaCheck: true,
    },
  };
}

export const runnerSectionNote = () => tr('梯形横浇道：目标总面积 A_run 按条数均分得到单条目标面积；尺寸按梯形面积公式反算并回算校核。阻流位置/实际面积比按最终实际总截面积重算（与现有 P51 面积判定同一规则）；本工具未建立梯形流动仿真，不能把矩形流动校核直接视为梯形的等价验证。');
export const runnerSectionFormula = (kind) => {
  const spec = TRAPEZOID_TYPES[kind] || TRAPEZOID_TYPES.standard;
  return `${tr(spec.label)}：A = ${spec.areaFactor}a²，h = ${spec.hFactor}a（上底 ${fmt2(1)}a，下底 2a）`;
};
