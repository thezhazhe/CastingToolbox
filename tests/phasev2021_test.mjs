// ============================================================
// PHASE V2.0-21（132.txt）· 冒口基准表**可复现性**回归
//
//   被测对象是 `scripts/validate_benchmark.mjs` —— 本文件**只调用它的纯函数**，
//   不重复实现任何检查（避免"两处各写一份、将来漂移"）。
//
//   ★ 本文件**计入** `tests/runner.mjs`（runner 只读 `tests/*_test.mjs`，非递归）。
//   ⚠ 132.txt §七：五类检查**不得相加**。本文件覆盖 **A 参数登记 / B 单位与规则 / C 案例格式**；
//     **D 人工扫描实验**不在本文件（见 `tests/experiments/phasev2020_limit.mjs`，且**不计入**真实案例数）；
//     **E 真实铸件验证**目前 **0 条**，不具备条件 —— 本文件**不**声称任何真实铸件验证结论。
//
//   ★ 本阶段**只改文档与新增校验**：`calcs/riser.js` / `calcs/riserDreq.js` / `js/engine/**` /
//     `cases.csv` 列结构 / 任何 UI 与算法 —— **一个字节都没动**（有指纹与全量日志为证）。
// ============================================================
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  auditAll, stripComments, extractInputKeys, selfTestExtractors, parseRegistry,
  section, parseCsv, checkCaseFile, probeSemantics, REGISTRY_COLS,
  RISER_SRC, BENCH_CSV, BENCH_README,
} from '../scripts/validate_benchmark.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const READ = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => assert(Object.is(a, b), `${msg} —— 实测 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}`);

// 132.txt §三 点名的五项（V2.0-20 报告指出未登记的键）
const FIVE = ['hot_d', 'wall_t', 'cast_v', 'cast_a', 'rho'];
// 代码里 `runRiser` + `calcMc` 实际读取的**全部**入参（12 个）
const EXPECT_KEYS = ['cast_a', 'cast_v', 'cast_wt', 'eff', 'hd_ratio', 'hot_d',
  'mat', 'mc', 'mc_mode', 'rho', 'shape', 'wall_t'];

export const tests = [

  // ── A 参数登记检查 ───────────────────────────────────────────────────────
  {
    name: 'V2.0-21-A1 从 calcs/riser.js 抽取的入参键 = 12 个且与预期集合逐项相同',
    fn() {
      const got = extractInputKeys(READ(RISER_SRC));
      eq(got.length, 12, `${RISER_SRC} 的入参个数`);
      eq(got.join(','), EXPECT_KEYS.join(','), '入参键集合');
    },
  },
  {
    name: 'V2.0-21-A2 ★ 抽取器自测：注释剥离 + 大小写混合（V2.0-20 假阳性的根因）',
    fn() {
      const problems = selfTestExtractors();
      assert(problems.length === 0, '抽取器自测失败：' + problems.join('；'));
      // 132.txt §四 的教训独立复现一遍：`[a-z_]+` 会漏掉含大写的键
      const got = extractInputKeys('const a = input.Mc_mm; const b = input.modOk;');
      assert(got.includes('Mc_mm') && got.includes('modOk'),
        '含大写字母的键必须被抽到（V2.0-20 的探针正是在这里出的假阳性）');
    },
  },
  {
    name: `V2.0-21-A3 ★ README §3 键表登记 ${EXPECT_KEYS.length} 个键，与代码集合完全一致（不多不少）`,
    fn() {
      const reg = parseRegistry(READ(BENCH_README));
      const code = extractInputKeys(READ(RISER_SRC));
      const missDoc = code.filter(k => !reg.keys.includes(k));
      const missCode = reg.keys.filter(k => !code.includes(k));
      assert(missDoc.length === 0, `README 未登记：${missDoc.join(', ')}`);
      assert(missCode.length === 0, `README 登记了代码里没有的键：${missCode.join(', ')}`);
      eq(reg.keys.length, 12, 'README 登记键数');
      eq(reg.problems.length, 0, 'README 键表结构问题：' + reg.problems.join('；'));
    },
  },
  {
    name: 'V2.0-21-A4 V2.0-20 指出的 5 个缺口键（hot_d/wall_t/cast_v/cast_a/rho）已全部登记',
    fn() {
      const reg = parseRegistry(READ(BENCH_README));
      const missing = FIVE.filter(k => !reg.keys.includes(k));
      assert(missing.length === 0, `仍缺：${missing.join(', ')}`);
    },
  },
  {
    name: 'V2.0-21-A5 README §3 键表无重复行、每行 6 格、单位列非空',
    fn() {
      const reg = parseRegistry(READ(BENCH_README));
      eq(REGISTRY_COLS.length, 6, '表头列数（键/单位/含义/何时需要/未提供时/非法时）');
      const dup = reg.keys.filter((k, i) => reg.keys.indexOf(k) !== i);
      assert(dup.length === 0, `重复键：${[...new Set(dup)].join(', ')}`);
      for (const r of reg.rows) {
        eq(r.cells.length, 6, `\`${r.key}\` 列数`);
        for (let i = 1; i < 6; i++) assert(r.cells[i], `\`${r.key}\` 的「${REGISTRY_COLS[i]}」为空`);
      }
    },
  },
  {
    name: 'V2.0-21-A6 §3 键表解析被正确限定在 §3 一节内（README 其它节的表格不得被当成参数键）',
    fn() {
      const readme = READ(BENCH_README);
      const s3 = section(readme, 3);
      assert(s3.length > 0, '找不到 §3');
      // §2 的字段名（37 个 CSV 列）与 §4 的等级名不得出现在解析结果里
      const reg = parseRegistry(readme);
      for (const bad of ['case_id', 'actual_D_mm', 'evidence_level', 'L1', 'data_quality']) {
        assert(!reg.keys.includes(bad), `§3 键表解析误收了 \`${bad}\`（说明没有限定在 §3 内）`);
      }
    },
  },

  // ── B 单位与规则检查（行为探针）───────────────────────────────────────────
  {
    name: 'V2.0-21-B1 ★ 80 条行为探针全部通过（未提供 / 非法 / 合法 三态与文档一致）',
    fn() {
      const checks = probeSemantics();
      const bad = checks.filter(c => !c.ok);
      assert(bad.length === 0, bad.map(c => `${c.name}（实测 ${JSON.stringify(c.got)}）`).join('；'));
      assert(checks.length >= 80, `探针数应 ≥80，实际 ${checks.length}`);
    },
  },
  {
    name: 'V2.0-21-B2 ★ `eff` 缺省值按**形状**取（4 形状各自实测）',
    fn() {
      const byName = Object.fromEntries(probeSemantics().map(c => [c.name, c]));
      const want = { cyl: 14, square: 14, sphere: 20, sphere_head: 25 };
      for (const [sh, pct] of Object.entries(want)) {
        const key = `未提供 eff（${sh}）→ RISER_EFF[` +
          { cyl: 'eff_open', square: 'eff_open', sphere: 'eff_blind', sphere_head: 'eff_sph' }[sh] + ']';
        const c = byName[key];
        assert(c, `找不到探针：${key}`);
        eq(c.got, pct / 100, `${sh} 的缺省 eff`);
      }
    },
  },
  {
    name: 'V2.0-21-B3 ★ 原型链键（constructor / __proto__ / toString）不抛异常',
    fn() {
      //   6 个原型链/非法键 × 2 条路径（shape / mat）= 12；其中名字里含这四个词的 8 条，
      //   `不存在` 与 `''` 另有 4 条（不匹配下面的过滤词，但同样在 B1 里被断言）。
      const checks = probeSemantics().filter(c => /constructor|__proto__|toString|hasOwnProperty/.test(c.name));
      assert(checks.length >= 8, `原型链探针数不足：${checks.length}`);
      const bad = checks.filter(c => !c.ok);
      assert(bad.length === 0, bad.map(c => c.name).join('；'));
      for (const c of checks) assert(!String(c.got).startsWith('THREW'), `抛了异常：${c.name}`);
    },
  },
  {
    name: 'V2.0-21-B4 非法输入一律拒算，且**不得**被静默换成默认值',
    fn() {
      const src = READ(RISER_SRC);
      // 与 V2.0-18 同口径：非法 ⇒ null。这里只断言"文档所声称的拒算确实发生"，
      // 由 B1 的探针覆盖；本条额外确认 `parseFloat(...) || 默认值` 式兜底**没有被引入**。
      const stripped = stripComments(src);
      assert(!/parseFloat\([^)]*\|\|\s*(?!0\b)\d/.test(stripped),
        'riser.js 里出现了 `parseFloat(...) || <非零默认值>` 式兜底（会把非法值变成默认值）');
    },
  },

  // ── C 案例格式检查 ───────────────────────────────────────────────────────
  {
    name: 'V2.0-21-C1 `cases.csv` 结构不变：37 列 + UTF-8 BOM + 无列数不符的行',
    fn() {
      const c = checkCaseFile();
      eq(c.cols.length, 37, `${BENCH_CSV} 列数`);
      eq(c.hasBom, true, 'UTF-8 BOM');
      assert(c.problems.length === 0, c.problems.join('；'));
    },
  },
  {
    name: 'V2.0-21-C2 真实铸件验证案例数 = 0（本阶段未录入任何虚构/模拟案例）',
    fn() {
      const c = checkCaseFile();
      eq(c.dataRows, 0, `${BENCH_CSV} 数据行数`);
      eq(c.ids.length, 0, 'case_id 条数');
    },
  },
  {
    name: 'V2.0-21-C3 ★ CSV 解析器能正确处理引号内的逗号（不用 `split(",")`）',
    fn() {
      //   Excel 会给含逗号的单元格自动加引号。`split(',')` 会把它拆成两格 ⇒ 列数算错。
      const rows = parseCsv('a,b,c\n1,"壁厚 8, 热节在下部",3\n');
      eq(rows.length, 2, '行数');
      eq(rows[1].length, 3, '含逗号单元格所在行的列数');
      eq(rows[1][1], '壁厚 8, 热节在下部', '含逗号单元格内容');
      // 转义双引号 `""`
      eq(parseCsv('a\n"他说""好"""\n')[1][0], '他说"好"', 'CSV 双引号转义');
    },
  },
  {
    name: 'V2.0-21-C4 ★ README §7 已改为指向校验脚本，不再提供 `split(",")` 数列数的一行命令',
    fn() {
      const readme = READ(BENCH_README);
      assert(readme.includes('node scripts/validate_benchmark.mjs'), 'README §7 未指向校验脚本');
      assert(!/split\(','\)\.length/.test(readme), 'README 里仍有 `split(\',\').length` 式数列数命令');
    },
  },

  // ── 证据分级说明（任务 C）───────────────────────────────────────────────
  {
    name: 'V2.0-21-D1 README §4 含等级速览与四条硬规则（模拟数据不计入 / 多热结不重复计数 / 缺陷位置是事实 / 低等级不支持高等级结论）',
    fn() {
      const s4 = section(READ(BENCH_README), 4);
      assert(s4.length > 0, '找不到 §4');
      const need = [
        ['等级速览', /等级速览/],
        ['L1 四样齐全', /四样齐全/],
        ['L2 缺检测结果', /缺检测结果/],
        ['L3 参考性历史资料', /参考性历史资料/],
        ['规则1 模拟数据不计入', /不得计入真实铸件验证数量/],
        ['规则2 多热结', /不能未经区分地视为多个独立铸件案例|不得.*一个件算成/],
        ['规则3 缺陷位置是事实', /缺陷位置是事实记录，不是缺陷原因结论/],
        ['规则4 低等级不支持高等级', /才能支持对应级别的工程结论/],
      ];
      const miss = need.filter(([, re]) => !re.test(s4)).map(([n]) => n);
      assert(miss.length === 0, '§4 缺少：' + miss.join('、'));
    },
  },

  // ── 汇总口径（132.txt §七：不得相加）────────────────────────────────────
  {
    name: 'V2.0-21-E1 ★ `auditAll()` 三类检查全绿，且 D/E 两类**未被混入**',
    fn() {
      const { A, B, C } = auditAll();
      assert(A.problems.length === 0, 'A：' + A.problems.join('；'));
      assert(B.problems.length === 0, 'B：' + B.problems.join('；'));
      assert(C.problems.length === 0, 'C：' + C.problems.join('；'));
      eq(A.codeKeys.length, 12, 'A 覆盖的代码入参数');
      eq(C.dataRows, 0, 'C 的真实案例数（不得把人工扫描算进来）');
    },
  },
  {
    name: 'V2.0-21-E2 ★ `riser.js` / `riserDreq.js` 的 sha256 指纹（PHASE V2.0-22 起 `riser.js` 已按设计变更）',
    fn() {
      //   ★ 用**真指纹**（sha256 前 8 位），不用字节数 —— 字节数在中文注释下容易和
      //     `String.length`（UTF-16 码元数）混淆：本项目 `riser.js` 是 19,958 **字节**
      //     但只有 14,094 个**字符**。（第一版就写错了，被这条测试自己抓出来。）
      //   ⚠ PHASE V2.0-22（138.txt §3.4）：`riser.js` 的指纹**预期会变**（目标模数反求取代 f 迭代），
      //     本用例的职责随之从"证明未改"变为"钉住当前值"；`riserDreq.js` 与 `js/engine/**`
      //     冻结区 7 指纹**必须保持不变**（本阶段未涉及它们）。
      const SHA = (rel) => createHash('sha256').update(readFileSync(join(ROOT, rel))).digest('hex').slice(0, 8);
      eq(SHA(RISER_SRC), '5cfcfef3', `${RISER_SRC} 指纹（V2.0-22 目标模数反求起）`);
      eq(SHA('calcs/riserDreq.js'), 'efdc2301', 'calcs/riserDreq.js 指纹（V2.0-19 起未变）');
      //   `js/engine/**` 冻结区 7 指纹
      const ENGINE = {
        'js/engine/v3/hotspotV3.js': 'd774532a',
        'js/engine/v3/peakRegion.js': '8d61d26d',
        'js/engine/v3/sampling.js': '5957831c',
        'js/engine/v3/modulusField.js': '48488b13',
        'js/engine/v3/configV3.js': '80a763ef',
        'js/engine/meshValidation.js': '5af64ae4',
        'js/engine/v3/v3ViewAdapter.js': '1e3d96cc',
      };
      for (const [f, want] of Object.entries(ENGINE)) eq(SHA(f), want, `冻结区 ${f}`);
    },
  },
];
