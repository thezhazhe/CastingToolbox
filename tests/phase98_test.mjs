// ============================================================
// PHASE 98（98.txt）：V1.1 发布前的两项修改
//   一、新增「坎贝勒推荐」浇注比例预设 S直:S横:S内 = 1:1:4
//   二、左下角 Support/Resources：版本号 V1.1 + 微信公众号 + 作者行放大加粗
//
// 本文件只做**定向测试**（98.txt §四 A~G）。完整回归由 runner 全量负责。
// 原则（98.txt §三）：只验证"新增了一条预设"，不验证任何公式变化——
//   下面每条都对照既有 6 档预设，证明它们一个数都没动。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGating, RATIO_PRESETS, recommendGatingRatio, MATERIALS } from '../calcs/gating.js';
import { VERSION, VERSION_LABEL } from '../js/version.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const NEW_KEY = '坎贝勒推荐';
const LEGACY = ['封闭式 保守型(灰铁)', '封闭式 常用型', '封闭式 大件型', '开放式 标准型', '开放式 宽大型', '开放式 铝合金属'];
// PHASE 98 之前的 6 档原始值——逐字写死，任何一档被改动本测试立刻失败
const LEGACY_R = {
  '封闭式 保守型(灰铁)': [1.0, 1.5, 0.8],
  '封闭式 常用型': [1.0, 2.0, 0.85],
  '封闭式 大件型': [1.0, 2.5, 0.9],
  '开放式 标准型': [1.0, 2.0, 2.0],
  '开放式 宽大型': [1.0, 2.5, 2.5],
  '开放式 铝合金属': [1.0, 3.0, 3.0],
};

const inputOf = (mat, pw, wall = 20, pos = '顶注', ratioKey, extra = {}) => ({
  mat, pw, cav: 1, yr: MATERIALS[mat].y_sug, wall, pos, Ho: 150, ph: 100, rh: 50,
  gc: 2, gt: 15, rc: 1, rt: 15, ratioKey, ...extra,
});

/* 递归找 NaN / undefined（98.txt §四 E）——这两种任何情况下都是 bug */
function scanBad(o, pathStr = 'result', out = []) {
  if (o === undefined) { out.push(`${pathStr} = undefined`); return out; }
  if (typeof o === 'number') { if (!Number.isFinite(o)) out.push(`${pathStr} = ${o}`); return out; }
  if (Array.isArray(o)) { o.forEach((v, i) => scanBad(v, `${pathStr}[${i}]`, out)); return out; }
  if (o && typeof o === 'object') { for (const k of Object.keys(o)) scanBad(o[k], `${pathStr}.${k}`, out); return out; }
  return out;
}
/* 递归收集 null 的路径集合——null 在本项目是**合法语义**（"不适用/不判定"），
   所以不能一律判错，而是要求"新预设的 null 集合 ⊆ 既有预设的 null 集合"。 */
function nullPaths(o, pathStr = 'result', out = new Set()) {
  if (o === null) { out.add(pathStr); return out; }
  if (Array.isArray(o)) { o.forEach((v, i) => nullPaths(v, `${pathStr}[${i}]`, out)); return out; }
  if (o && typeof o === 'object') { for (const k of Object.keys(o)) nullPaths(o[k], `${pathStr}.${k}`, out); return out; }
  return out;
}

export const tests = [
  /* ================= A / B：预设存在且比例为 1:1:4 ================= */
  {
    name: '98-A 预设存在且可读：「坎贝勒推荐」已在 RATIO_PRESETS（预设总数 6→7）',
    fn: () => {
      const names = Object.keys(RATIO_PRESETS);
      assert(names.includes(NEW_KEY), `RATIO_PRESETS 应含「${NEW_KEY}」（实际 ${names.join(' / ')}）`);
      assert(names.length === 7, `预设总数应为 7（实际 ${names.length}）`);
      // 其他 6 档一个不少、顺序不变（新预设追加在末尾，不动既有排列）
      assert(JSON.stringify(names.slice(0, 6)) === JSON.stringify(LEGACY),
        `既有 6 档顺序/名称不得变化（实际 ${names.slice(0, 6).join(' / ')}）`);
      console.log(`      预设：${names.join(' / ')}`);
    },
  },
  {
    name: '98-B 比例正确：坎贝勒推荐 = 1 : 1 : 4（直:横:内），且字段结构与既有预设同构',
    fn: () => {
      const p = RATIO_PRESETS[NEW_KEY];
      assert(Array.isArray(p.r) && p.r.length === 3, `r 应为 3 元数组（实际 ${JSON.stringify(p?.r)}）`);
      assert(JSON.stringify(p.r) === JSON.stringify([1.0, 1.0, 4.0]), `比例应为 1:1:4（实际 ${p.r.join(':')}）`);
      assert(p.r.join(':') === '1:1:4', `UI 显示文本应为 "1:1:4"（实际 "${p.r.join(':')}"）`);
      // 同构性：字段集合与既有预设一致（不新增第二套结构）
      const legacyKeys = Object.keys(RATIO_PRESETS[LEGACY[1]]).sort().join(',');
      const newKeys = Object.keys(p).sort().join(',');
      assert(legacyKeys === newKeys, `字段集合应与既有预设一致：既有 [${legacyKeys}] 新 [${newKeys}]`);
      assert(p.type === '开放', `type 应为「开放」——内浇口(4)最大即阻流不在内浇口（实际 ${p.type}）`);
      console.log(`      ${NEW_KEY} → ${p.r.join(' : ')} · type=${p.type} · note=${p.note}`);
    },
  },

  /* ================= C / D / E：能正常参与既有计算 ================= */
  {
    name: '98-C 能进入既有计算：runGating 接受该预设，面积按 1:1:4 分配',
    fn: () => {
      const r = runGating(inputOf('灰铁(HT)', 60, 20, '顶注', NEW_KEY));
      assert(r.ratioKey === NEW_KEY, `ratioKey 应原样回传（实际 ${r.ratioKey}）`);
      assert(JSON.stringify([r.s_r, r.r_r, r.g_r]) === JSON.stringify([1, 1, 4]),
        `回传比例应为 1/1/4（实际 ${r.s_r}/${r.r_r}/${r.g_r}）`);
      // min_r=1 → A_sp=A、A_run=A、A_gt=4A（既有分配逻辑，未改动）
      const near = (a, b) => Math.abs(a - b) < 0.05;
      assert(near(r.A_sp, r.A), `直浇道参考面积应 = 阻流面积 A（${r.A_sp} vs ${r.A}）`);
      assert(near(r.A_run, r.A), `横浇道参考面积应 = A（${r.A_run} vs ${r.A}）`);
      assert(near(r.A_gt, 4 * r.A), `内浇口参考面积应 = 4A（${r.A_gt} vs ${4 * r.A}）`);
      // 阻流口判定：内浇口最大 → 阻流在直浇道（既有 cp 逻辑，未改动）
      assert(r.cp === '直浇道', `阻流口应判定为「直浇道」（实际 ${r.cp}）`);
      assert(r.min_r === 1, `min_r 应为 1（实际 ${r.min_r}）`);
      console.log(`      A=${r.A.toFixed(1)} A_sp=${r.A_sp.toFixed(1)} A_run=${r.A_run.toFixed(1)} A_gt=${r.A_gt.toFixed(1)} cp=${r.cp}`);
    },
  },
  {
    name: '98-D 端到端数值健全：5 种材质 × 3 方向 × 优化开关，无 NaN / undefined',
    fn: () => {
      const mats = Object.keys(MATERIALS);
      const poss = ['顶注', '中注', '底注'];
      let n = 0;
      for (const mat of mats) {
        for (const pos of poss) {
          for (const opt of [false, true]) {
            const r = runGating(inputOf(mat, 60, 20, pos, NEW_KEY, { optimize: opt }));
            const bad = scanBad(r);
            assert(bad.length === 0, `${mat}/${pos}/optimize=${opt} 出现 NaN/undefined：\n        ${bad.slice(0, 8).join('\n        ')}`);
            assert(r.t > 0 && r.A > 0, `${mat}/${pos} 浇注时间/阻流面积应为正（t=${r.t} A=${r.A}）`);
            assert(r.v >= 0 && Number.isFinite(r.v), `${mat}/${pos} 内浇口速度应为有限非负（v=${r.v}）`);
            assert(r.Fg > 0 && r.L_g > 0, `${mat}/${pos} 内浇口几何应为正（Fg=${r.Fg} L_g=${r.L_g}）`);
            n++;
          }
        }
      }
      // 速度单位口径（96-R）：v[m/s] = Q[cm³/s] / A[mm²]，不得有 ×10 系数
      const r = runGating(inputOf('灰铁(HT)', 60, 20, '顶注', NEW_KEY));
      assert(Math.abs(r.v - (r.t > 0 ? 10 * r.G / (r.t * r.rho * r.Fg / 100) : 0)) < 1e-9,
        'v 仍走 calc_v 既有口径（无新增系数）');
      console.log(`      ${n} 组组合无 NaN/undefined · 灰铁 60kg 顶注 v=${r.v.toFixed(3)} m/s · Fg=${r.Fg} L_g=${r.L_g}`);
    },
  },
  {
    name: '98-E 空值不新增：新预设的 null 路径 ⊆ 既有预设的 null 路径（null 是"不适用"语义，非异常）',
    fn: () => {
      const mats = Object.keys(MATERIALS);
      const poss = ['顶注', '中注', '底注'];
      const extra = new Set();
      for (const mat of mats) {
        for (const pos of poss) {
          for (const opt of [false, true]) {
            const base = nullPaths(runGating(inputOf(mat, 60, 20, pos, '封闭式 常用型', { optimize: opt })));
            const neu = nullPaths(runGating(inputOf(mat, 60, 20, pos, NEW_KEY, { optimize: opt })));
            for (const p of neu) if (!base.has(p)) extra.add(`${mat}/${pos}/opt=${opt} → ${p}`);
          }
        }
      }
      assert(extra.size === 0, `新预设引入了既有预设没有的空值：\n        ${[...extra].slice(0, 8).join('\n        ')}`);
      // 既有预设里合法的 null 举例如下（说明本测试不是"永不失败"）
      const sample = [...nullPaths(runGating(inputOf('灰铁(HT)', 60, 20, '顶注', NEW_KEY)))].sort();
      assert(sample.length > 0, '本项目的确存在语义空值（boundaryNote / vTargetLo / optChokeMigrated）');
      console.log(`      新预设 null 路径 ${sample.length} 条，全部为既有语义空值：${sample.join(', ')}`);
    },
  },

  /* ================= F：既有 6 档预设与自动推荐一个数都没动 ================= */
  {
    name: '98-F 既有 6 档预设逐字未变 + 自动推荐结果未变',
    fn: () => {
      for (const k of LEGACY) {
        assert(RATIO_PRESETS[k], `既有预设「${k}」不得被删除`);
        assert(JSON.stringify(RATIO_PRESETS[k].r) === JSON.stringify(LEGACY_R[k]),
          `既有预设「${k}」比例被改动：${RATIO_PRESETS[k].r.join(':')} 应为 ${LEGACY_R[k].join(':')}`);
      }
      // 自动推荐一律不指向新预设（98.txt §一.9：不改变默认预设）
      const mats = Object.keys(MATERIALS);
      const recs = new Set();
      for (const m of mats) for (const w of [10, 50, 199, 201, 500]) recs.add(recommendGatingRatio(m, w));
      assert(!recs.has(NEW_KEY), `自动推荐不得选中「${NEW_KEY}」（实际推荐集合 ${[...recs].join(' / ')}）`);
      assert(recs.size >= 5, `自动推荐应仍覆盖 ≥5 档既有预设（实际 ${[...recs].join(' / ')}）`);
      console.log(`      既有 6 档逐字吻合 · 自动推荐集合 = ${[...recs].join(' / ')}`);
    },
  },
  {
    name: '98-G 同输入下新旧预设结果互不影响（新预设不改动既有预设的计算输出）',
    fn: () => {
      const a = runGating(inputOf('灰铁(HT)', 60, 20, '顶注', '封闭式 常用型'));
      const b = runGating(inputOf('灰铁(HT)', 60, 20, '顶注', NEW_KEY));
      // 阻流面积 A / 浇注时间 t / 浇注重量 G 只与材质·重量·壁厚·方向有关 → 必须逐位相等
      assert(a.A === b.A, `A 不应因预设而变（${a.A} vs ${b.A}）`);
      assert(a.t === b.t, `t 不应因预设而变（${a.t} vs ${b.t}）`);
      assert(a.G === b.G, `G 不应因预设而变（${a.G} vs ${b.G}）`);
      assert(a.Hp === b.Hp && a.fv === b.fv, 'Hp / fv 不应因预设而变');
      // 只有分配出去的三个参考面积与阻流口判定不同
      assert(a.A_gt !== b.A_gt && a.cp !== b.cp, '两档预设的分配结果本就应不同（用于确认测试真的在测不同东西）');
      console.log(`      共用量 A=${a.A.toFixed(1)} t=${a.t.toFixed(2)} G=${a.G.toFixed(2)} · 阻流口 ${a.cp}→${b.cp}`);
    },
  },

  /* ================= 二、左下角 Support / Resources ================= */
  {
    name: '98-H 版本号 V1.1：唯一来源 + 侧栏静态 + 关于弹窗中英 + package/manifest/bat 七处一致',
    fn: () => {
      assert(/^\d+\.\d+\.\d+$/.test(VERSION), `version.js 仍为语义化版本（实际 ${VERSION}）`);
      assert(VERSION === '1.1.0', `本次发布版本应为 1.1.0（实际 ${VERSION}）`);
      assert(VERSION_LABEL === 'v' + VERSION, 'VERSION_LABEL = v + VERSION');
      const html = read('index.html');
      assert(html.includes(`<b id="appVersion">${VERSION_LABEL}</b>`), `侧栏静态版本 = ${VERSION_LABEL}`);
      assert(html.includes(`<b>版本：</b>${VERSION_LABEL} `), `关于弹窗静态版本 = ${VERSION_LABEL}`);
      assert(read('js/i18n/zh-CN.js').includes(`<b>版本：</b>${VERSION_LABEL} `), '中文词条表版本');
      assert(read('js/i18n/en-US.js').includes(`<b>Version:</b> ${VERSION_LABEL} `), '英文词条表版本');
      assert(JSON.parse(read('package.json')).version === VERSION, 'package.json 版本');
      assert(read('dist/apk/project/AndroidManifest.xml').includes(`android:versionName="${VERSION}"`), 'AndroidManifest 版本');
      assert(read('build_exe.bat').includes(`"${VERSION}"`), 'build_exe.bat 传入版本');
      // 不得再有 V1.0.0 残留（version.js 的注释示例除外）
      for (const f of ['index.html', 'js/i18n/zh-CN.js', 'js/i18n/en-US.js', 'package.json', 'build_exe.bat']) {
        assert(!read(f).includes('1.0.0'), `${f} 仍有 1.0.0 残留`);
      }
      console.log(`      VERSION=${VERSION} · 七处一致 · 无 1.0.0 残留`);
    },
  },
  {
    name: '98-I 微信公众号：侧栏新增一行，中英词条齐备（公众号名称保留中文原名）',
    fn: () => {
      const html = read('index.html');
      assert(html.includes('data-i18n="app.wechat"'), 'index.html 应新增 data-i18n="app.wechat" 行');
      assert(/data-i18n="app\.wechat">📱 微信公众号：铸造工具箱</.test(html), '静态文案应为「📱 微信公众号：铸造工具箱」');
      // 位置：紧跟在 QQ 交流群之后、开源声明之前（98.txt §二.2「与 QQ 群并列」）
      const iQq = html.indexOf('data-i18n="app.qq"');
      const iWx = html.indexOf('data-i18n="app.wechat"');
      const iMit = html.indexOf('data-i18n="app.mit"');
      assert(iQq > 0 && iWx > iQq && iMit > iWx, `公众号行应位于 QQ 群与开源声明之间（${iQq} < ${iWx} < ${iMit}）`);
      const zh = read('js/i18n/zh-CN.js'), en = read('js/i18n/en-US.js');
      assert(zh.includes("'app.wechat': '📱 微信公众号：铸造工具箱'"), '中文词条 app.wechat');
      assert(/'app\.wechat':/.test(en), '英文词条 app.wechat 存在');
      assert(en.includes('铸造工具箱'), '英文界面保留公众号中文原名（专有名词不翻译）');
      console.log('      app.wechat 中英齐备 · 位置在 QQ 群之后');
    },
  },
  {
    name: '98-J 作者行放大加粗：只加一个 class，不动其他行、不上大标题',
    fn: () => {
      const html = read('index.html');
      assert(/class="sf-line sf-author" data-i18n="app\.author"/.test(html), '作者行应挂 sf-author 类');
      // 只此一处挂 sf-author（不波及邮箱/QQ/公众号/开源行）
      assert((html.match(/sf-author/g) || []).length === 1, 'sf-author 只应出现一次');
      const css = read('css/app.css');
      const m = css.match(/\.sf-author\s*\{([^}]*)\}/);
      assert(m, 'app.css 应有 .sf-author 规则');
      const body = m[1];
      const fs = body.match(/font-size:\s*([\d.]+)rem/);
      const fw = body.match(/font-weight:\s*(\d+)/);
      assert(fs, '.sf-author 应设置 font-size');
      assert(fw, '.sf-author 应设置 font-weight');
      const legacy = Number((css.match(/\.sf-about\s*\{[^}]*font-size:\s*([\d.]+)rem/) || [])[1]);
      assert(Number(fs[1]) > legacy, `字号应比 .sf-about 大（${fs[1]}rem vs ${legacy}rem）`);
      assert(Number(fs[1]) <= 0.9, `字号不得夸张成标题（实际 ${fs[1]}rem ≤ 0.9）`);
      assert(Number(fw[1]) >= 600, `字重应达加粗（实际 ${fw[1]}）`);
      // 未改动其他行：邮箱行 / QQ 行 / 开源行都没有被加样式
      assert(!/sf-line\s*\{/.test(css), '不应给 .sf-line 加整体样式（那会波及其他行）');
      assert(/\.sf-lite\s*\{\s*opacity:\s*\.8;?\s*\}/.test(css), '.sf-lite 应保持原样');
      console.log(`      sf-author: ${fs[1]}rem / ${fw[1]}（.sf-about 基准 ${legacy}rem）`);
    },
  },
  {
    name: '98-K 预设的 i18n 与 UI 接线：英文词条 + 适用说明 + 下拉/设计中心同源',
    fn: () => {
      const en = read('js/i18n/en-US.js');
      assert(en.includes(`'${NEW_KEY}':`), `en-US 应有「${NEW_KEY}」词条`);
      // 适用说明（RATIO_APPLIC 是动态 key，i18n_audit 扫不到 → 本测试守住）
      const gv = read('js/views/gatingView.js');
      const applic = gv.match(/RATIO_APPLIC\s*=\s*\{([\s\S]*?)\n\};/);
      assert(applic, 'gatingView 应有 RATIO_APPLIC 表');
      const applicKeys = [...applic[1].matchAll(/'([^']+)':/g)].map((m) => m[1]);
      for (const k of LEGACY.concat([NEW_KEY])) {
        assert(applicKeys.includes(k), `RATIO_APPLIC 应覆盖「${k}」（实际 ${applicKeys.join(' / ')}）`);
      }
      // 下拉与设计中心都从 Object.keys(RATIO_PRESETS) 生成 → 新预设自动同源，不存在第二处硬编码清单
      assert(/Object\.keys\(RATIO_PRESETS\)/.test(gv), 'gatingView 下拉应由 RATIO_PRESETS 生成');
      const dc = read('js/views/designCenter.js');
      assert(/Object\.keys\(RATIO_PRESETS\)/.test(dc), '设计中心下拉应由 RATIO_PRESETS 生成');
      // 未新造第二套计算逻辑：campbellGating 与本预设无耦合（方法隔离，PHASE 65.1 定）
      assert(!/RATIO_PRESETS/.test(read('calcs/campbellGating.js')), 'campbellGating 不得引用 RATIO_PRESETS');
      console.log(`      RATIO_APPLIC 覆盖 ${applicKeys.length} 档 · 下拉均取自 RATIO_PRESETS 单一来源`);
    },
  },
];
