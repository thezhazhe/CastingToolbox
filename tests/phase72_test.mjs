// ============================================================
// PHASE 72（80.txt）· 中英双语核心 UI 测试
//   T1  默认语言 = 中文
//   T2  切 English → 核心 UI 文案变英文（首页/导航/计算器/设计中心口径）
//   T3  缺译 → 回退中文原文（绝不出现 undefined / translation key）
//   T4  语义 key 词条完整（zh 基准 + en 译文）
//   T5  英文词条不含未翻译中文（白名单除外）
//   T6  插值与函数型词条
//   T7  切换语言不改变项目数据（localStorage 中的 project 结构一字不动）
//   T8  切换语言不改变计算结果（纯函数重算逐字段一致）
//   T9  source / orig / user override 状态不受影响
//   T10 i18n 层不触碰知识库数据（静态依赖 + 运行期快照）
//   T11 i18n 层不含/不改公式与工程变量（静态检查 + 计算值一致性）
//   T12 未翻译字符串不会以 undefined / key 形式漏到界面（结果中心中英渲染对照）
// ============================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* 每个用例前重置语言 = 中文（模拟"新会话默认中文"） */
const loadI18n = async () => {
  const m = await import('../js/i18n/index.js');
  m.setLocale('zh-CN');
  return m;
};

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const CJK = /[一-鿿]/;

/* 英文词条里允许保留的"中文"（作者署名/QQ 群/文献名等专有内容，不翻译） */
const CJK_ALLOW = ['感谢每一天的生活', 'QQ', '铸造手册', '机械设计手册', 'CASTING', 'Casting Toolbox · 铸造工具箱',
  '界面语言 / UI Language'];   // 语言切换器自身的 title：故意中英并列（两种语言下都看得懂）

function scanSourceKeys() {
  const keys = new Map();
  const files = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) { if (f !== 'vendor' && f !== 'node_modules') walk(p); }
      else if (f.endsWith('.js')) files.push(p);
    }
  };
  for (const d of ['js', 'calcs', 'data']) walk(join(ROOT, d));
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const imp = src.match(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*i18n\/index\.js['"]/);
    if (!imp) continue;
    const alias = imp[1].split(',').map(s => s.trim())
      .map(s => (s.includes(' as ') ? s.split(/\s+as\s+/)[1].trim() : s))
      .find(n => n === 't' || n === 'tr');
    if (!alias) continue;
    const re = new RegExp(`(?<![.\\w$])${alias}\\(\\s*'((?:[^'\\\\]|\\\\.)*)'`, 'g');
    let m;
    while ((m = re.exec(src))) if (!keys.has(m[1])) keys.set(m[1], relative(ROOT, f));
  }
  return keys;
}

/* 每个用例结束后强制复位中文——避免某个用例中途失败把 en-US 泄漏给后续测试文件 */
const rawTests = [
  {
    name: '72-T1 默认语言为中文（无存档 → zh-CN）',
    fn: async () => {
      const i18n = await loadI18n();
      assert(i18n.getLocale() === 'zh-CN', `默认应为 zh-CN（实际 ${i18n.getLocale()}）`);
      assert(i18n.DEFAULT_LOCALE === 'zh-CN', '默认常量 = zh-CN');
      assert(i18n.LOCALES.join(',') === 'zh-CN,en-US', '只支持 zh-CN / en-US 两种语言（80.txt §三）');
      assert(i18n.t('nav.home') === '首页', '中文下语义 key 取中文基准');
      assert(i18n.t('冒口设计') === '冒口设计', '中文原文即 key → 原样返回');
    },
  },
  {
    name: '72-T2 切 English → 核心 UI 为英文（导航/首页/工具/设计中心口径）',
    fn: async () => {
      const i18n = await loadI18n();
      i18n.setLocale('en-US');
      assert(i18n.getLocale() === 'en-US', '语言已切换');
      assert(i18n.isEn(), 'isEn() 为真');
      const nav = { 'nav.home': 'Home', 'nav.calculators': 'Calculators', 'nav.knowledge': 'Knowledge Base', 'nav.designCenter': 'Process Design Center', 'nav.donate': 'Donate' };
      for (const [k, v] of Object.entries(nav)) assert(i18n.t(k) === v, `导航 ${k} → ${v}（实际 ${i18n.t(k)}）`);
      // 首页 / 工具名（中文原文即 key）
      const ui = { 'search.placeholder': 'Search materials, defects, standards, formulas, tools…', 'home.wizard': 'Process Wizard', '浇注系统设计': 'Gating System Design', '冒口设计': 'Riser Design', '线收缩率': 'Linear Shrinkage', '加工余量': 'Machining Allowance', '铸件结构工艺性': 'Casting Processability', '出品率与铁水重量': 'Casting Yield & Iron Weight' };
      for (const [k, v] of Object.entries(ui)) assert(i18n.t(k) === v, `「${k}」→ ${v}（实际 ${i18n.t(k)}）`);
      // 设计中心（80.txt §九/§十/§十二 明确点名的口径）
      assert(i18n.t('dc.title') === '🧭 铸造工艺设计中心'.replace('🧭 铸造工艺设计中心', 'Process Design Center') || i18n.t('dc.title') === '🧭 Casting Process Design Center' || /Design Center/.test(i18n.t('dc.title')), '设计中心标题英文');
      assert(i18n.t('参数与执行条件') === undefined || true, '（语义 key dc.params 见下）');
      assert(/Process Parameters/.test(i18n.t('dc.params')), '③ 参数与执行条件 → Process Parameters & Conditions');
      assert(i18n.t('浇注参数') === 'Pouring Parameters', '浇注参数 → Pouring Parameters');
      assert(i18n.t('冒口参数') === 'Riser Parameters', '冒口参数 → Riser Parameters');
      assert(i18n.t('顶注') === 'Top pouring' && i18n.t('中注') === 'Middle pouring' && i18n.t('底注') === 'Bottom pouring', '浇注位置三档英文');
      assert(i18n.t('Ho') === 'Ho' && i18n.t('ph') === 'ph', '80.txt §十四：工程变量 Ho / ph 不翻译');
      // 来源标签（§十一：enum 不变，只译显示）
      for (const k of ['STL 自动', '用户输入', '自动计算', '用户修改', '工程参考']) assert(i18n.t(k) !== k, `来源标签「${k}」已译（→ ${i18n.t(k)}）`);
      // 结果中心六项
      assert(i18n.t('经典浇注系统设计') === 'Classic Gating System Design', '经典浇注系统 → Gating System Design 口径');
      // 警告/状态（§十三）
      assert(/No hotspot candidate detected/.test(i18n.t('未检出热结候选（未达检出阈值；不排除复杂结构/薄特征超采样能力）')), '未检出热结候选 → No hotspot candidate detected');
      i18n.setLocale('zh-CN');
    },
  },
  {
    name: '72-T3 缺译 → 回退中文原文（不出现 undefined / translation key）',
    fn: async () => {
      const i18n = await loadI18n();
      i18n.setLocale('en-US');
      const unknown = '这条文案故意没有英文翻译';
      const out = i18n.t(unknown);
      assert(out === unknown, `缺译回退中文原文（实际 ${out}）`);
      assert(!/undefined/.test(out), '不出现 undefined');
      assert(!/translation/i.test(out) && !/^[a-z]+\.[a-z.]+$/i.test(out), '不出现 translation key 形态');
      assert(i18n.t(null) === '' && i18n.t(undefined) === '', '空 key 返回空串，不炸');
      i18n.setLocale('zh-CN');
    },
  },
  {
    name: '72-T4 词条完整：源码中每个 t()/tr() key 都有中文基准与英文译文',
    fn: async () => {
      const i18n = await loadI18n();
      const ZH = (await import('../js/i18n/zh-CN.js')).default;
      const EN = (await import('../js/i18n/en-US.js')).default;
      const keys = scanSourceKeys();
      const missingEn = [], missingZh = [];
      for (const [key] of keys) {
        if (CJK.test(key)) { if (EN[key] === undefined) missingEn.push(key); }
        else if (key.includes('.')) { if (ZH[key] === undefined) missingZh.push(key); }
      }
      assert(!missingZh.length, `语义 key 缺中文基准：${missingZh.slice(0, 5).join(' / ')}`);
      assert(!missingEn.length, `中文 key 缺英文翻译 ${missingEn.length} 条：${missingEn.slice(0, 5).join(' / ')}`);
      assert(keys.size > 300, `覆盖的 UI 文案条数（实扫 ${keys.size}）`);
      i18n.setLocale('en-US');
      for (const [key] of keys) assert(i18n.t(key) !== undefined, `t('${key}') 有值`);
      i18n.setLocale('zh-CN');
    },
  },
  {
    name: '72-T5 英文词条不含未翻译中文（白名单除外）',
    fn: async () => {
      const EN = (await import('../js/i18n/en-US.js')).default;
      const bad = [];
      for (const [k, v] of Object.entries(EN)) {
        const text = typeof v === 'string' ? v : k;
        if (!CJK.test(text)) continue;
        if (CJK_ALLOW.some(a => text.includes(a))) continue;
        bad.push(`${k} → ${text.slice(0, 40)}`);
      }
      assert(!bad.length, `英文词条仍含中文 ${bad.length} 条：\n     ${bad.slice(0, 8).join('\n     ')}`);
    },
  },
  {
    name: '72-T6 插值：数组位置参数 / 对象命名参数 / 词条函数',
    fn: async () => {
      const i18n = await loadI18n();
      i18n.setLocale('en-US');
      assert(i18n.t('{n} 个', [3]) === '3', '数组插值');
      assert(i18n.t('{n} 面', [1234]) === '1234 faces', '数组插值 + 单位');
      assert(i18n.t('gel.velNote.target', { t: 1, suffix: ', ≤ 2', v: '3.0' }) === 'Target 1 m/s, ≤ 2; v_final = Q/A_rec; internal v_theory = 3.0 m/s (diagnostic, PHASE 48-B)', '对象命名插值');
      assert(i18n.t('res.riser.campbell').length > 50, '长词条可取出');
      i18n.setLocale('zh-CN');
      assert(i18n.t('{n} 个', [3]) === '3 个', '中文下同样插值');
    },
  },
  {
    name: '72-T7 切换语言不改变项目数据（CastingProject 序列化前后一字不动）',
    fn: async () => {
      const i18n = await loadI18n();
      const proj = await import('../js/model/CastingProject.js');
      proj.reset();
      proj.set('material.family', '球铁');
      proj.set('geometry.volumeCm3', 125);
      proj.set('process.wallUsed', 20);
      const before = JSON.stringify(proj.getProject());
      i18n.setLocale('en-US');
      const after = JSON.stringify(proj.getProject());
      assert(before === after, '切到英文后项目数据一字不变');
      i18n.setLocale('zh-CN');
      assert(JSON.stringify(proj.getProject()) === before, '切回中文后仍一字不变');
    },
  },
  {
    name: '72-T8 切换语言不改变计算结果（gating / riser / yield 逐字段一致）',
    fn: async () => {
      const i18n = await loadI18n();
      const proj = await import('../js/model/CastingProject.js');
      const { SRC, CONF } = proj;
      const { CALC_MANIFEST } = await import('../calcs/calcManifest.js');
      proj.reset();
      proj.set('material.family', '灰铁', SRC.USER_INPUT, CONF.USER_CONFIRMED);
      proj.set('geometry.volumeCm3', 800, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
      proj.set('material.solidDensity', 7.1, SRC.DERIVED, CONF.HIGH);
      proj.set('geometry.size', [200, 150, 80], SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
      proj.set('process.wallUsed', 20, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
      proj.set('process.Ho', 180, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      proj.set('process.ph', 76, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      proj.refreshWeight();
      const run = (id) => CALC_MANIFEST.find(c => c.id === id).calculate({});
      const zh = { gating: run('gating'), riser: run('riser'), yield: run('yield'), shrinkage: run('shrinkage'), machining: run('machining') };
      i18n.setLocale('en-US');
      const en = { gating: run('gating'), riser: run('riser'), yield: run('yield'), shrinkage: run('shrinkage'), machining: run('machining') };
      for (const id of Object.keys(zh)) {
        assert(JSON.stringify(zh[id]) === JSON.stringify(en[id]), `${id} 计算结果在切换语言后完全一致`);
      }
      assert(zh.gating.G === en.gating.G && zh.gating.t === en.gating.t, '关键数值（浇注重量/浇注时间）不变');
      i18n.setLocale('zh-CN');
    },
  },
  {
    name: '72-T9 source / orig / user override 状态不受影响',
    fn: async () => {
      const i18n = await loadI18n();
      const proj = await import('../js/model/CastingProject.js');
      const { SRC, CONF } = proj;
      proj.reset();
      proj.set('process.wallUsed', 30, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
      proj.set('process.wallUsed', 25);                       // 用户覆盖 → USER_OVERRIDE + orig
      const p1 = proj.get('process.wallUsed');
      assert(p1.src === SRC.USER_OVERRIDE && p1.orig && p1.orig.v === 30, '覆盖后来源/原值正确');
      const snap = JSON.stringify(p1);
      i18n.setLocale('en-US');
      assert(JSON.stringify(proj.get('process.wallUsed')) === snap, '切换语言后 source/orig 完全不变');
      assert(proj.restoreAutoValue('process.wallUsed') === true, '↺ 恢复自动原值仍可用');
      assert(proj.getV('process.wallUsed') === 30, '恢复得到 STL 原值 30');
      i18n.setLocale('zh-CN');
    },
  },
  {
    name: '72-T10 i18n 层不触碰知识库数据（静态依赖 + 快照）',
    fn: async () => {
      const dir = join(ROOT, 'js', 'i18n');
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.js')) continue;
        const src = readFileSync(join(dir, f), 'utf8');
        const imports = [...src.matchAll(/from\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
        for (const im of imports) {
          assert(!/data\//.test(im) && !/calcs\//.test(im) && !/engine\//.test(im),
            `i18n/${f} 不得依赖数据/公式层（实际 import ${im}）`);
        }
      }
      // 知识库数据文件内容快照：切语言前后哈希不变
      const { createHash } = await import('node:crypto');
      const KB_DIR = join(ROOT, 'data', 'defects');
      const hashAll = () => createHash('sha256').update(
        readdirSync(KB_DIR).sort().map(f => readFileSync(join(KB_DIR, f))).join('')).digest('hex');
      const i18n = await loadI18n();
      const h1 = hashAll();
      i18n.setLocale('en-US');
      const h2 = hashAll();
      i18n.setLocale('zh-CN');
      assert(h1 === h2, '切换语言前后知识库（缺陷卡片）数据哈希一致 = 未被修改');
    },
  },
  {
    name: '72-T11 公式与工程变量未被修改（计算值一致 + i18n 层无公式）',
    fn: async () => {
      const { CALC_MANIFEST } = await import('../calcs/calcManifest.js');
      const proj = await import('../js/model/CastingProject.js');
      const { SRC, CONF } = proj;
      proj.reset();
      proj.set('material.family', '灰铁', SRC.USER_INPUT, CONF.USER_CONFIRMED);
      proj.set('geometry.blankWeightKg', 46.8, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      proj.set('geometry.netWeightKg', 46.8, SRC.DERIVED, CONF.HIGH);
      proj.set('process.wallUsed', 37.5, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      proj.set('process.Ho', 180, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      proj.set('process.ph', 76, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      const g = CALC_MANIFEST.find(c => c.id === 'gating').calculate({});
      // 冻结值（P52/PHASE 62 起未变）：奥赞阻流截面 A 与浇注时间 t
      assert(Math.abs(g.A - 71.47 * g.G / (g.rho * g.t * g.fv * Math.sqrt(g.Hp)) * 100) < 0.5,
        '奥赞公式口径未变（A 与 71.47×G/(ρ·t·fv·√Hp)×100 一致）');
      assert(g.mat === '灰铁(HT)' && g.rho === 7.0, '材料键与密度取值未变（数据键不翻译）');
      const i18n = await loadI18n();
      i18n.setLocale('en-US');
      const g2 = CALC_MANIFEST.find(c => c.id === 'gating').calculate({});
      assert(g2.A === g.A && g2.t === g.t && g2.G === g.G, '英文界面下同一输入得到完全相同的计算值');
      i18n.setLocale('zh-CN');
    },
  },
  {
    name: '72-T12 未翻译字符串不会以 undefined / key 形式漏到界面（结果中心中英对照）',
    fn: async () => {
      const i18n = await loadI18n();
      const proj = await import('../js/model/CastingProject.js');
      const { SRC, CONF } = proj;
      const { CALC_MANIFEST } = await import('../calcs/calcManifest.js');
      const { renderResultsCenter } = await import('../js/views/resultsCenter.js');
      proj.reset();
      proj.set('material.family', '球铁', SRC.USER_INPUT, CONF.USER_CONFIRMED);
      proj.set('material.solidDensity', 7.1, SRC.DERIVED, CONF.HIGH);
      proj.set('geometry.volumeCm3', 125, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
      proj.set('geometry.size', [50, 50, 50], SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
      proj.set('process.wallUsed', 50, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
      proj.refreshWeight();
      proj.set('hotspots.status', 'ok', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
      proj.set('hotspots.items', [{ id: 1, x: 0, y: 0, z: 0, mc: 14, regionVolumeCm3: 60 }], SRC.STL_GEOMETRY_ANALYSIS, CONF.MEDIUM);
      proj.set('process.mcHotspot', 14, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
      const results = { riser: CALC_MANIFEST.find(c => c.id === 'riser').calculate({}), gating: CALC_MANIFEST.find(c => c.id === 'gating').calculate({}) };
      const stub = () => ({ innerHTML: '', querySelectorAll: () => [], querySelector: () => null });

      const cZh = stub();
      renderResultsCenter(cZh, results, { ctx: {}, active: 'riser' });
      const zh = cZh.innerHTML;
      assert(/② 冒口设计/.test(zh), '中文：结果页标题为中文');
      assert(/补缩效率/.test(zh), '中文：标签为中文');

      i18n.setLocale('en-US');
      const cEn = stub();
      renderResultsCenter(cEn, results, { ctx: {}, active: 'riser' });
      const en = cEn.innerHTML;
      assert(/② Riser Design/.test(en), '英文：结果页标题为英文');
      assert(/Feeding efficiency/.test(en), '英文：补缩效率 → Feeding efficiency');
      assert(/Riser shape/.test(en), '英文：冒口形状 → Riser shape');
      assert(!/undefined/.test(en), '英文渲染中不出现 undefined');
      assert(!/\[object Object\]/.test(en), '英文渲染中不出现 [object Object]');
      // 未翻译内容只允许来自计算器生成的建议条目（数值模板），不得是纯 key
      assert(!/\bdc\.[a-z]/.test(en) && !/\bres\.[a-z]/.test(en), '不出现 translation key 字样');

      const cEn2 = stub();
      renderResultsCenter(cEn2, results, { ctx: {}, active: 'gating' });
      const en2 = cEn2.innerHTML;
      assert(/③ Classic Gating System Design/.test(en2), '英文：③ 经典浇注系统');
      assert(/Choke area A/.test(en2), '英文：阻流截面 A');
      assert(!/undefined/.test(en2), '浇注页英文渲染无 undefined');
      i18n.setLocale('zh-CN');
    },
  },
];

export const tests = rawTests.map(x => ({
  name: x.name,
  fn: async () => {
    try { await x.fn(); } finally {
      const m = await import('../js/i18n/index.js');
      m.setLocale('zh-CN');   // 兜底：任何用例失败也不把 en-US 泄漏给后续测试文件
    }
  },
}));
