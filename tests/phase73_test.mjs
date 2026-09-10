// ============================================================
// PHASE 73（81.txt §十九）· 版本一致性 + 打包配置守卫
//   T1 版本号唯一来源与应用内显示一致（侧栏 / 关于弹窗 / 报告）
//   T2 package.json / AndroidManifest / build_exe.bat 与 version.js 一致
//   T3 打包配置完整性：APK 必须打包 vendor（3D 视图依赖）、Windows 打包脚本齐备
//   T4 报告正文不含 undefined / NaN（81.txt §十四 P1：数据映射错误）
// ============================================================
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION, VERSION_LABEL } from '../js/version.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

export const tests = [
  {
    name: '73-T1 版本号唯一来源 = 应用内显示（侧栏 / 关于弹窗中英 / 报告）',
    fn: () => {
      assert(/^\d+\.\d+\.\d+$/.test(VERSION), `version.js 语义化版本（实际 ${VERSION}）`);
      assert(VERSION_LABEL === 'v' + VERSION, 'VERSION_LABEL = v + VERSION');
      // 侧栏：index.html 里的静态文本（运行时由 app.js 用 VERSION_LABEL 覆盖，静态值也要对齐）
      const html = read('index.html');
      assert(html.includes(`id="appVersion"`), '侧栏版本节点存在（供运行时写入）');
      assert(html.includes(`<b id="appVersion">${VERSION_LABEL}</b>`), `侧栏静态版本 = ${VERSION_LABEL}`);
      assert(html.includes(`<b>版本：</b>${VERSION_LABEL} `), `关于弹窗静态版本 = ${VERSION_LABEL}`);
      // 关于弹窗正文由词条表提供（applyDom 会整体替换 innerHTML）→ 词条表必须同步
      const zh = read('js/i18n/zh-CN.js');
      const en = read('js/i18n/en-US.js');
      assert(zh.includes(`<b>版本：</b>${VERSION_LABEL} `), `中文词条表版本 = ${VERSION_LABEL}`);
      assert(en.includes(`<b>Version:</b> ${VERSION_LABEL} `), `英文词条表版本 = ${VERSION_LABEL}`);
      // 报告：不得再写死旧版本
      const rg = read('js/views/reportGenerator.js');
      assert(rg.includes('VERSION_LABEL'), '报告生成器引用版本常量');
      assert(!/Casting Toolbox v0\.\d/.test(rg), '报告里没有残留的写死旧版本号');
    },
  },
  {
    name: '73-T2 package.json / AndroidManifest / Windows 打包脚本版本一致',
    fn: () => {
      const pkg = JSON.parse(read('package.json'));
      assert(pkg.version === VERSION, `package.json ${pkg.version} = ${VERSION}`);
      const manifest = read('dist/apk/project/AndroidManifest.xml');
      assert(manifest.includes(`android:versionName="${VERSION}"`), `AndroidManifest versionName = ${VERSION}`);
      assert(!/android:versionName="0\./.test(manifest), 'AndroidManifest 不再是 0.x');
      const bat = read('build_exe.bat');
      assert(bat.includes(`"${VERSION}"`), `build_exe.bat 传入 EXE 版本元数据 ${VERSION}`);
    },
  },
  {
    name: '73-T3 打包配置完整性（APK 必须含 vendor；Windows 脚本齐备）',
    fn: () => {
      // 设计中心 3D 视图 import 'three' / 'three/addons/...' → importmap 指向 ./vendor/
      // 旧 APK 漏打 vendor → Android 上进设计中心模块解析失败（PHASE 73 审计 P1）
      const apk = read('build_apk.ps1');
      const copyLine = apk.split('\n').find(l => l.includes('Copy-Item') && l.includes("'css'")) || '';
      assert(/vendor/.test(copyLine), `APK 打包清单必须包含 vendor（实际：${copyLine.trim()}）`);
      const html = read('index.html');
      assert(html.includes('"./vendor/three.module.js"'), 'importmap 指向 vendor/three.module.js');
      assert(existsSync(join(ROOT, 'vendor', 'three.module.js')), 'vendor/three.module.js 存在');
      assert(existsSync(join(ROOT, 'vendor', 'controls', 'OrbitControls.js')), 'vendor/controls/OrbitControls.js 存在');
      // APK 构建不再写死旧版 SDK
      assert(!apk.includes('build-tools\\34.0.0'), 'APK 构建不再写死 build-tools 34.0.0');
      assert(!apk.includes('platforms\\android-34'), 'APK 构建不再写死 android-34');
      // Windows 打包链
      for (const f of ['build_exe.bat', 'sea-config.json', 'CastingToolboxApp.cjs', 'scripts/set_exe_icon.cjs']) {
        assert(existsSync(join(ROOT, f)), `Windows 打包所需文件存在：${f}`);
      }
      const sea = JSON.parse(read('sea-config.json'));
      assert(sea.main === 'CastingToolboxApp.cjs', 'SEA 入口正确');
    },
  },
  {
    name: '73-T5 orig 基准随 STL 数据一起清理（↺ 不得复活上一个模型的值）',
    fn: async () => {
      const proj = await import('../js/model/CastingProject.js');
      const { SRC, CONF } = proj;
      proj.reset();
      // 模拟导入 STL 写入自动值，然后用户覆盖（产生 orig 基准）
      proj.set('geometry.volumeCm3', 125, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
      proj.set('geometry.volumeCm3', 777);                       // 用户改 → USER_OVERRIDE + orig=125
      proj.set('process.wallUsed', 50, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
      proj.set('process.wallUsed', 22);
      let p = proj.get('geometry.volumeCm3');
      assert(p.src === SRC.USER_OVERRIDE && p.orig && p.orig.v === 125, '覆盖后 orig 基准 = STL 原值 125');
      // 刷新/换模型 → 按既有语义清 STL 绑定数据
      proj.clearStlBoundData();
      p = proj.get('geometry.volumeCm3');
      assert(p.orig === undefined, '清理后 orig 必须失效（否则 ↺ 会把 125 写回没有 STL 的会话）');
      assert(proj.get('process.wallUsed').orig === undefined, 'wallUsed 的 orig 同样失效');
      assert(proj.restoreAutoValue('geometry.volumeCm3') === false, '此时 ↺ 恢复应返回 false（无基准可恢复）');
    },
  },
  {
    name: '73-T6 出品率留空 → 用材料表推荐值，不再硬编码 70%（浇注重量口径）',
    fn: async () => {
      const proj = await import('../js/model/CastingProject.js');
      const { CALC_MANIFEST } = await import('../calcs/calcManifest.js');
      const { SRC, CONF } = proj;
      const { MATERIALS } = await import('../calcs/gating.js');
      const cases = [['灰铁', '灰铁(HT)'], ['球铁', '球铁(QT)'], ['铸钢', '铸钢(ZG)'], ['铝合金', '铝合金(Al)'], ['铜合金', '铜合金(Cu)']];
      for (const [fam, key] of cases) {
        proj.reset();
        proj.set('material.family', fam, SRC.USER_INPUT, CONF.USER_CONFIRMED);
        proj.set('geometry.blankWeightKg', 30, SRC.USER_INPUT, CONF.USER_CONFIRMED);
        proj.set('geometry.volumeCm3', 1400, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
        proj.set('process.wallUsed', 20, SRC.USER_INPUT, CONF.USER_CONFIRMED);
        proj.set('process.Ho', 180, SRC.USER_INPUT, CONF.USER_CONFIRMED);
        proj.set('process.ph', 76, SRC.USER_INPUT, CONF.USER_CONFIRMED);
        proj.set('material.yieldSug', 0, SRC.USER_INPUT, CONF.USER_CONFIRMED);   // 清空出品率
        const g = CALC_MANIFEST.find(c => c.id === 'gating').calculate({});
        const expect = MATERIALS[key].y_sug;
        assert(Math.abs(g.yv - expect) < 0.01, `${fam}：留空时应用材料表推荐 ${expect}%（实际 ${g.yv}%，硬编码 70 会偏）`);
      }
    },
  },
  {
    name: '73-T7 熔炼加料/冷铁 manifest 路径不产生 undefined 文案',
    fn: async () => {
      const proj = await import('../js/model/CastingProject.js');
      const { CALC_MANIFEST } = await import('../calcs/calcManifest.js');
      const { SRC, CONF } = proj;
      proj.reset();
      proj.set('material.family', '球铁', SRC.USER_INPUT, CONF.USER_CONFIRMED);
      proj.set('geometry.blankWeightKg', 30, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      proj.set('process.chillT', 40, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      proj.set('process.wallUsed', 20, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      const chill = CALC_MANIFEST.find(c => c.id === 'chill').calculate({});
      const txt = JSON.stringify(chill);
      assert(!txt.includes('undefined'), `冷铁 manifest 路径不得出现 undefined（实际：${(chill.warnings || []).join(' | ').slice(0, 90)}）`);
      assert(Array.isArray(chill.thickness) && chill.thickness.every(Number.isFinite), '冷铁厚度为有效数值');
    },
  },
  {
    name: '73-T4 报告正文不出现 undefined / NaN（不完整结果也要给占位符）',
    fn: async () => {
      const proj = await import('../js/model/CastingProject.js');
      const { buildWorkflowReport } = await import('../js/views/reportGenerator.js');
      proj.reset();
      proj.set('material.family', '球铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('geometry.blankWeightKg', 10, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      // 构造字段残缺的结果（模拟真实模块输出缺字段）
      const html = buildWorkflowReport({
        gating: { G: 15.2, t: 12.5, A: 480 },   // 缺 D_sp/L_g/L_r/gc/gt/rc/rt/v/vr/r_r/g_r/s_r
        riser: { D: 90 },                        // 缺 H/Mr_act/Mr_need/eff/Vr/d_neck
      });
      assert(!html.includes('undefined'), `报告不得出现 undefined（实际含 ${(html.match(/undefined/g) || []).length} 处）`);
      assert(!html.includes('NaN'), '报告不得出现 NaN');
      assert(!html.includes('[object Object]'), '报告不得出现 [object Object]');
      assert(html.includes('—'), '缺失字段应显示占位符 —');
      // 正常结果仍然完整
      const full = buildWorkflowReport({
        gating: { G: 15.2, t: 12.5, A: 480, D_sp: 20, L_g: 40, L_r: 30, gc: 2, gt: 10, rc: 2, rt: 16, v: 1.2, vr: 2.0, r_r: 2, g_r: 1, s_r: 1 },
      });
      assert(full.includes(VERSION_LABEL), `报告页脚带版本 ${VERSION_LABEL}`);
      assert(!full.includes('undefined') && !full.includes('NaN'), '完整结果报告也干净');
    },
  },
];
