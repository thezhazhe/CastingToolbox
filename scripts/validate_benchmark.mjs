// ============================================================
// 冒口真实案例基准表 · **只读**可复现性校验（PHASE V2.0-21 / 132.txt）
//
//   用法： node scripts/validate_benchmark.mjs
//   退出码： 0 = 全部硬性检查通过 · 1 = 有失败
//
//   ⚠ **只读**：本脚本不写任何文件 —— 不改 `cases.csv`、不改 README、不改任何代码。
//
//   ★ 方法论（132.txt §四）：
//       「不能仅凭一次 grep 或简单正则就宣布所有参数均已登记」。
//     故本脚本分**两层**，两层都要过：
//       ① **参数登记层** —— 从 `calcs/riser.js` 的**注释剥离后源码**里抽取真实入参键，
//          与 README §3 键表逐项比对。所用正则有**自测**（含大小写混合用例，
//          因为 V2.0-20 的探针正是栽在 `[a-z_]+` 漏掉大写字母上）。
//       ② **语义层** —— 不查文本，**直接调用 `runRiser` / `calcMc` 做行为探针**：
//          「未提供 / 非法 / 合法」三态逐条实测，README 的说法必须与实测一致。
//          ⇒ 将来 `riser.js` 的守卫若漂移，本脚本会变红，而不是让文档悄悄说谎。
//
//   ⚠ 五类检查**分开报告、不得相加**（132.txt §七）：
//       A 参数登记 · B 单位与规则 · C 案例格式 · D 人工扫描实验 · E 真实铸件验证
//       本脚本只做 A/B/C。D（人工扫描）见 `tests/experiments/phasev2020_limit.mjs`；
//       E（真实铸件验证）**目前为 0 条**，不具备条件。
// ============================================================
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { RISER_MATERIALS, RISER_EFF, RISER_SHAPES, calcMc, runRiser } from '../calcs/riser.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = (rel) => join(ROOT, rel);

export const RISER_SRC = 'calcs/riser.js';
export const BENCH_CSV = 'data/riser-benchmark/cases.csv';
export const BENCH_README = 'data/riser-benchmark/README.md';
export const AUDIT_DOC = 'docs/PHASE_V2.0-20_LIMIT_GAP_AUDIT.md';

// ════════════════════════════════════════════════════════════════════════════
// 一、注释剥离 + 入参抽取（第 ① 层）
// ════════════════════════════════════════════════════════════════════════════
//   ⚠ 为什么必须先剥离注释：`calcs/riser.js` 的注释里**大量出现** `input.rho` / `v.cast_a`
//     这类字样（那些注释正是在解释这些参数），直接正则会把注释当代码。
//
//   ★ 剥离器**尊重字符串字面量**：`'http://x'` 里的 `//` 不会被当成行注释。
//     这条有自测（见 `selfTestCommentStripper`），因为"看起来对"的剥离器正是
//     会悄悄吃掉半个文件的那种工具。
export function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c; i++;
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        out += src[i];
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** 从源码抽取 `runRiser` 的入参键（`input.X` / `v.X`，`v` 是 `calcMc` 的形参）。 */
export function extractInputKeys(src) {
  const code = stripComments(src);
  const keys = new Set();
  //   ⚠ 字符类**必须含 `A-Z`** —— V2.0-20 的探针用 `[a-z_]+` 把 `Mc_mm` / `modOk`
  //     这类含大写的名字报成"未登记"，那次是**假阳性**。这条有自测。
  for (const m of code.matchAll(/\binput\.([A-Za-z_][A-Za-z0-9_]*)/g)) keys.add(m[1]);
  for (const m of code.matchAll(/\bv\.([A-Za-z_][A-Za-z0-9_]*)/g)) keys.add(m[1]);
  return [...keys].sort();
}

/** 剥离器与抽取正则的**自测** —— 132.txt §四 要求"检查方法本身经过验证"。 */
export function selfTestExtractors() {
  const problems = [];
  // ① 行注释里的 // 在字符串内不得被剥掉
  const s1 = `const u = 'http://x'; // 注释\nconst input = {a:1};`;
  if (stripComments(s1).includes('http://x') === false) problems.push('剥离器吃掉了字符串里的 //');
  // ② 块注释必须剥离，且其中的 input.X 不得被抽取
  const s2 = '/* input.ghost */ const x = input.real;';
  const st2 = stripComments(s2);
  if (st2.includes('ghost')) problems.push('块注释未被剥离');
  if (extractInputKeys(s2).includes('ghost')) problems.push('注释里的 input.ghost 被当成了入参');
  if (!extractInputKeys(s2).includes('real')) problems.push('代码里的 input.real 未被抽取');
  // ③ ★ 大小写混合（V2.0-20 假阳性的根因）
  const got = extractInputKeys('const a = input.Mc_mm; const b = v.hot_d; const c = input.RHO;');
  for (const k of ['Mc_mm', 'hot_d', 'RHO']) if (!got.includes(k)) problems.push(`大小写混合键 ${k} 未被抽取`);
  // ④ 模板字符串里的 // 不得被剥掉
  if (!stripComments('const t = `a//b`;').includes('a//b')) problems.push('剥离器吃掉了模板字符串里的 //');
  return problems;
}

// ════════════════════════════════════════════════════════════════════════════
// 二、README §3 键表解析
// ════════════════════════════════════════════════════════════════════════════
//   表形如：  | `key` | 单位 | 含义 | 何时需要 | 未提供时 | 非法时 |
//   只认**第一格是反引号包裹的键名**的行 ⇒ 表头/分隔行自动跳过。
export const REGISTRY_COLS = ['键', '单位', '含义', '何时需要', '未提供时', '非法时'];

/** 取 README 里 `## <n>.` 这一节的正文（到下一个 `## ` 或文件末为止）。 */
export function section(readme, n) {
  const lines = readme.split(/\r?\n/);
  const start = lines.findIndex(l => new RegExp(`^##\\s+${n}\\.`).test(l));
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^##\s/.test(lines[i])) { end = i; break; }
  return lines.slice(start, end).join('\n');
}

export function parseRegistry(readme) {
  const rows = [];
  const problems = [];
  //   ⚠ **必须限定在 §3 这一节内**：README 里 §2/§4/§5 也有 Markdown 表，
  //     不限定范围会把 37 个 CSV 列名和 L1~L4 一起当成"参数键"（第一版就是这么错的）。
  const body = section(readme, 3);
  if (!body) return { rows, keys: [], problems: ['README 里找不到 `## 3.` 一节'] };
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim());
    const m = /^`([A-Za-z_][A-Za-z0-9_]*)`$/.exec(cells[0]);
    if (!m) continue;
    rows.push({ key: m[1], cells });
  }
  const seen = new Map();
  for (const r of rows) {
    if (seen.has(r.key)) problems.push(`README 键表重复行：\`${r.key}\``);
    seen.set(r.key, r);
    if (r.cells.length !== REGISTRY_COLS.length) {
      problems.push(`\`${r.key}\` 行有 ${r.cells.length} 格，应为 ${REGISTRY_COLS.length} 格（${REGISTRY_COLS.join('/')}）`);
      continue;
    }
    for (let i = 1; i < r.cells.length; i++) {
      if (!r.cells[i]) problems.push(`\`${r.key}\` 的「${REGISTRY_COLS[i]}」列为空`);
    }
  }
  return { rows, keys: rows.map(r => r.key), problems };
}

// ════════════════════════════════════════════════════════════════════════════
// 三、行为探针（第 ② 层）—— 「未提供 / 非法 / 合法」三态
// ════════════════════════════════════════════════════════════════════════════
const BASE = { mat: '球铁', cast_wt: 10, mc_mode: 'direct', mc: 12, shape: 'cyl', hd_ratio: 1.0 };
const R = (patch) => runRiser({ ...BASE, ...patch });
//   `{...BASE, k: undefined}` 与"根本没有这个键"在 `readNum` / `parseFloat` 下**同义**
//   （两者都得到 `undefined`）⇒ 可以安全地用显式 `undefined` 表示"未提供"。

export function probeSemantics() {
  const checks = [];
  const eq = (name, got, want, note = '') => checks.push({ name, got, want, ok: Object.is(got, want), note });

  // ── A. 未提供（显式 undefined）──────────────────────────────────────────
  eq('未提供 mc（mode=direct）→ null', R({ mc: undefined }), null);
  eq('未提供 hot_d（mode=hot_spot）→ null', R({ mc_mode: 'hot_spot', mc: undefined, hot_d: undefined }), null);
  eq('未提供 wall_t（mode=wall）→ null', R({ mc_mode: 'wall', mc: undefined, wall_t: undefined }), null);
  eq('未提供 cast_v/cast_a（mode=volume）→ null', R({ mc_mode: 'volume', mc: undefined, cast_v: undefined, cast_a: undefined }), null);
  eq('未提供 mc_mode → null', R({ mc_mode: undefined }), null);
  eq('未提供 shape → null', R({ shape: undefined }), null);
  const noHd = R({ hd_ratio: undefined });
  eq('未提供 hd_ratio → 非 null', noHd !== null, true);
  eq('未提供 hd_ratio → 默认 1.0', noHd && noHd.hd, 1.0);
  const noCw = R({ cast_wt: undefined });
  eq('未提供 cast_wt → 非 null', noCw !== null, true);
  eq('未提供 cast_wt → cw=0（体积约束未启用）', noCw && noCw.cw, 0);
  eq('未提供 cast_wt → Vc=0', noCw && noCw.Vc, 0);
  eq('未提供 cast_wt → volOk=true（但**不代表通过**）', noCw && noCw.volOk, true);
  const noRho = R({ rho: undefined });
  eq('未提供 rho → 用材料表值', noRho && noRho.rhoUsed, RISER_MATERIALS.球铁.rho);
  const noMat = R({ mat: undefined });
  eq('未提供 mat → 回退球铁（mdFellBack=true）', noMat && noMat.mdFellBack, true);
  eq('未提供 mat → rhoUsed=7.1', noMat && noMat.rhoUsed, 7.1);

  // ── B. eff 按形状的默认值（4 形状）─────────────────────────────────────
  for (const [sh, sd] of Object.entries(RISER_SHAPES)) {
    const r = R({ shape: sh, eff: undefined });
    eq(`未提供 eff（${sh}）→ RISER_EFF[${sd.effKey}]`, r && r.eff, RISER_EFF[sd.effKey] / 100);
  }

  // ── C. 非法 ───────────────────────────────────────────────────────────
  const BAD_NUMS = [Infinity, -Infinity, 'abc', '12mm'];
  for (const bad of BAD_NUMS) {
    eq(`hd_ratio=${JSON.stringify(bad)} → null`, R({ hd_ratio: bad }), null);
    eq(`eff=${JSON.stringify(bad)} → null`, R({ eff: bad }), null);
    eq(`cast_wt=${JSON.stringify(bad)} → null`, R({ cast_wt: bad }), null);
    eq(`rho=${JSON.stringify(bad)} → null`, R({ rho: bad }), null);
  }
  for (const bad of [0, -1]) {
    eq(`hd_ratio=${bad} → null（须 >0）`, R({ hd_ratio: bad }), null);
    eq(`eff=${bad} → null（须 >0）`, R({ eff: bad }), null);
    eq(`rho=${bad} → null（须 >0）`, R({ rho: bad }), null);
  }
  eq('cast_wt=NaN → null（**不**算未提供）', R({ cast_wt: NaN }), null);
  eq('cast_wt=-1 → null', R({ cast_wt: -1 }), null);
  eq('cast_wt=0 → **合法**（不做体积校核）', R({ cast_wt: 0 }) !== null, true);
  eq('rho=NaN → null', R({ rho: NaN }), null);

  //   ★ 空串 = **未提供**（`readNum` 里 `s === '' ⇒ ABSENT`）—— 唯一例外是 mc 一族
  const emptyHd = R({ hd_ratio: '' });
  eq('hd_ratio="" → 未提供（用默认 1.0）', emptyHd && emptyHd.hd, 1.0);
  eq('eff="" → 未提供（用表值）', (R({ eff: '' }) || {}).eff, RISER_EFF.eff_open / 100);
  eq('rho="" → 未提供（用材料表值）', (R({ rho: '' }) || {}).rhoUsed, RISER_MATERIALS.球铁.rho);
  eq('cast_wt="" → 未提供（cw=0）', (R({ cast_wt: '' }) || {}).cw, 0);

  //   ★★ mc 一族走的是 `calcMc` 的 `parseFloat(...) || 0`（**宽松**），
  //      与 `readNum` 的 `Number(s)`（**严格**）不同：尾部垃圾被静默忽略、空串算非法。
  eq("mc='12mm' → **12**（parseFloat 宽松，尾部垃圾被忽略）", (R({ mc: '12mm' }) || {}).Mc, 12);
  eq("hot_d='24mm' → Mc=12", (R({ mc_mode: 'hot_spot', mc: undefined, hot_d: '24mm' }) || {}).Mc, 12);
  eq('mc="" → **null**（mc 一族空串算非法，不是"未提供"）', R({ mc: '' }), null);
  eq('mc=NaN → null', R({ mc: NaN }), null);
  eq('mc=Infinity → null', R({ mc: Infinity }), null);

  //   ★ 原型链键：`constructor` / `__proto__` 不得抛异常
  const PROTO = ['constructor', '__proto__', 'toString', 'hasOwnProperty', '不存在', ''];
  for (const k of PROTO) {
    let threw = null, r = null;
    try { r = R({ shape: k }); } catch (e) { threw = e; }
    eq(`shape=${JSON.stringify(k)} → null（不抛异常）`, threw ? 'THREW:' + threw.message : r, null);
    let threw2 = null, r2 = null;
    try { r2 = R({ mat: k }); } catch (e) { threw2 = e; }
    eq(`mat=${JSON.stringify(k)} → 回退球铁（不抛异常）`, threw2 ? 'THREW' : (r2 && r2.mdFellBack === true), true);
  }

  // ── D. 合法值与取值 ────────────────────────────────────────────────────
  eq('mc=12（direct）→ Mc=12', R({ mc: 12 }).Mc, 12);
  eq('hot_d=24 → Mc=12（d/2）', R({ mc_mode: 'hot_spot', mc: undefined, hot_d: 24 }).Mc, 12);
  eq('wall_t=24 → Mc=12（t/2）', R({ mc_mode: 'wall', mc: undefined, wall_t: 24 }).Mc, 12);
  eq('cast_v=50000,cast_a=5000 → Mc=10（V/A）', R({ mc_mode: 'volume', mc: undefined, cast_v: 50000, cast_a: 5000 }).Mc, 10);
  eq('hd_ratio=1.5 → r.hd=1.5', R({ hd_ratio: 1.5 }).hd, 1.5);
  eq('eff=35 → r.eff=0.35', R({ eff: 35 }).eff, 0.35);
  eq('rho=7.8 → rhoUsed=7.8', R({ rho: 7.8 }).rhoUsed, 7.8);
  eq('cast_wt=10 → cw=10', R({ cast_wt: 10 }).cw, 10);

  // ── E. `calcMc` 四分支直测 ─────────────────────────────────────────────
  eq("calcMc('direct',{mc:12})", calcMc('direct', { mc: 12 }), 12);
  eq("calcMc('hot_spot',{hot_d:24})", calcMc('hot_spot', { hot_d: 24 }), 12);
  eq("calcMc('wall',{wall_t:24})", calcMc('wall', { wall_t: 24 }), 12);
  eq("calcMc('volume',{cast_v:50000,cast_a:5000})", calcMc('volume', { cast_v: 50000, cast_a: 5000 }), 10);
  eq("calcMc('volume',{cast_v:0,cast_a:5000}) → 0（a>0 守卫生效）", calcMc('volume', { cast_v: 0, cast_a: 5000 }), 0);
  eq("calcMc('未知模式',{}) → 0", calcMc('没这个模式', {}), 0);

  return checks;
}

// ════════════════════════════════════════════════════════════════════════════
// 四、案例格式检查（第 ③ 层，C 类）
// ════════════════════════════════════════════════════════════════════════════
//   ★ 用**真正的 CSV 解析**（引号内的逗号不算分隔符），不用 README §7 那条
//     `split(',')` 一行命令 —— 后者在单元格含逗号（比如 `geometry_notes` 里写了
//     "壁厚 8, 热节在下部"）时会**把列数算错**。真实案例一进来就会踩到。
export function parseCsv(text) {
  const s = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); cell = ''; rows.push(row); row = []; }
    else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.length > 1 || r[0] !== '');
}

export function checkCaseFile() {
  const problems = [];
  const abs = P(BENCH_CSV);
  if (!existsSync(abs)) return { problems: [`${BENCH_CSV} 不存在`], cols: [], dataRows: -1, rowWidths: [], ids: [] };
  const buf = readFileSync(abs);
  const hasBom = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  if (!hasBom) problems.push(`${BENCH_CSV} 缺 UTF-8 BOM（Excel 双击会乱码）`);
  const rows = parseCsv(buf.toString('utf8'));
  const cols = rows[0] || [];
  const data = rows.slice(1);
  const rowWidths = [...new Set(data.map(r => r.length))];
  for (const w of rowWidths) if (w !== cols.length) problems.push(`有数据行列数=${w}，表头=${cols.length}`);
  const idIdx = cols.indexOf('case_id');
  const ids = idIdx >= 0 ? data.map(r => (r[idIdx] || '').trim()).filter(Boolean) : [];
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  if (dup.length) problems.push(`case_id 重复：${[...new Set(dup)].join(', ')}`);

  //   ★ 每一列都必须在 README 里登记过（V2.0-20 L11 的检查，搬到这里常驻）。
  //     字符类**含 `A-Z`** —— 列名有 `Mc_mm` / `actual_D_mm` / `modOk` 这类大小写混合，
  //     用 `[a-z_]+` 会把 8 个**已登记**的列报成"未登记"（V2.0-20 的假阳性）。
  if (existsSync(P(BENCH_README))) {
    const readme = readFileSync(P(BENCH_README), 'utf8');
    const documented = new Set(
      [...readme.matchAll(new RegExp('`([A-Za-z_][A-Za-z0-9_]*)`', 'g'))].map(m => m[1]));
    const undocumented = cols.filter(c => c && !documented.has(c));
    if (undocumented.length) problems.push(`CSV 有而 README 未登记的列：${undocumented.join(', ')}`);
  }

  //   每一行都必须是"像真实案例"的行（本阶段 0 行 ⇒ 空过）。
  //   ★ 这条**不需要**在录入第一条真实案例后放宽 —— 它禁止的是"填得不像真实案例的行"。
  const REQUIRED_NONEMPTY = ['case_id', 'casting_name', 'material', 'source', 'date', 'riser_shape', 'evidence_level'];
  const idx = Object.fromEntries(REQUIRED_NONEMPTY.map(k => [k, cols.indexOf(k)]));
  data.forEach((r, i) => {
    for (const k of REQUIRED_NONEMPTY) {
      const j = idx[k];
      if (j < 0) { problems.push(`表头缺列 ${k}`); break; }
      if (!String(r[j] || '').trim()) problems.push(`第 ${i + 2} 行 ${k} 为空（必填）`);
    }
    const lv = String(r[idx.evidence_level] || '').trim();
    if (lv && !['L1', 'L2', 'L3', 'L4'].includes(lv)) problems.push(`第 ${i + 2} 行 evidence_level="${lv}" 不在 L1~L4`);
  });
  return { problems, cols, dataRows: data.length, rowWidths, ids, hasBom };
}

// ════════════════════════════════════════════════════════════════════════════
// 五、汇总
// ════════════════════════════════════════════════════════════════════════════
export function auditAll() {
  const src = readFileSync(P(RISER_SRC), 'utf8');
  const readme = readFileSync(P(BENCH_README), 'utf8');

  const A = { name: 'A 参数登记检查', problems: [], codeKeys: extractInputKeys(src), readmeKeys: [] };
  A.problems.push(...selfTestExtractors());
  const reg = parseRegistry(readme);
  A.readmeKeys = reg.keys;
  A.problems.push(...reg.problems);
  for (const k of A.codeKeys) if (!reg.keys.includes(k)) A.problems.push(`代码里有 \`${k}\`，README §3 键表**未登记**`);
  for (const k of reg.keys) if (!A.codeKeys.includes(k)) A.problems.push(`README §3 登记了 \`${k}\`，但**代码里没有这个入参**`);

  const checks = probeSemantics();
  const B = { name: 'B 单位与规则检查', problems: [], checks, n: checks.length, bad: checks.filter(c => !c.ok) };
  for (const c of B.bad) B.problems.push(`${c.name} —— 实测 ${JSON.stringify(c.got)}，期望 ${JSON.stringify(c.want)}`);

  const C = { name: 'C 案例格式检查', problems: [], ...checkCaseFile() };

  return { A, B, C };
}

// ════════════════════════════════════════════════════════════════════════════
// 六、CLI
// ════════════════════════════════════════════════════════════════════════════
function main() {
  const { A, B, C } = auditAll();
  const line = (s) => console.log(s);
  line('\n══ 冒口基准表 · 只读可复现性校验（PHASE V2.0-21）══');

  line(`\n【${A.name}】代码自带 ${A.codeKeys.length} 个入参 · README 登记 ${A.readmeKeys.length} 个`);
  line(`   代码：${A.codeKeys.join(' / ')}`);
  line(`   文档：${A.readmeKeys.join(' / ')}`);
  for (const p of A.problems) line('   ❌ ' + p);
  if (!A.problems.length) line('   ✅ 键名集合逐项吻合 · 正则自测通过（含大小写混合用例）');

  line(`\n【${B.name}】${B.n} 条行为探针`);
  for (const p of B.problems) line('   ❌ ' + p);
  if (!B.problems.length) line(`   ✅ ${B.n} 条全部与文档一致（未提供 / 非法 / 合法 三态）`);

  line(`\n【${C.name}】`);
  line(`   列数 ${C.cols.length} · **数据行 ${C.dataRows}** · BOM ${C.hasBom ? '有' : '无'}`);
  for (const p of C.problems) line('   ❌ ' + p);
  if (!C.problems.length) line('   ✅ 结构完好；**真实铸件验证案例仍为 0 条**（本阶段未录入任何虚构案例）');

  line('\n【D 人工扫描实验】不在本脚本内 —— 见 tests/experiments/phasev2020_limit.mjs（**不计入真实案例数**）');
  line('【E 真实铸件验证】**0 条** —— 不具备验证条件（见 README §0/§8）');
  line('\n⚠ 五类检查**不得相加**。');

  const bad = A.problems.length + B.problems.length + C.problems.length;
  line(`\n结果：${bad ? `❌ ${bad} 项失败` : '✅ 全部通过'}\n`);
  process.exitCode = bad ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
