// ============================================================
// 170.txt · WebGL 初始化失败恢复专项（真实浏览器 + 可控 mock）
//
// 覆盖：
//   A 正常初始化 / 加载 / 销毁（真实 WebGL）
//   B WebGLRenderer 创建失败（getContext('webgl2'/'webgl') 返回 null）
//   C 模型加载失败（BufferGeometry.translate 抛错）
//   D 连续失败后重试；不累积 canvas / rAF 循环 / renderer
//   E 正常替换 STL、返回首页再进入设计中心
//
// 说明：B/C 是**受控 mock 的异常路径**，不是真实显卡故障/无 WebGL 环境实测。
// 用法: node scripts/browser_webgl_recovery_test.mjs
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9283;
const URL = 'http://localhost:8090/';
const PROFILE = path.join(ROOT, '_edge_profile_webgl_recovery');
const CUBE = path.join(ROOT, 'tests/golden/cube50.stl');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try { rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}

let server = null;
try { const r = await fetch(URL); if (!r.ok) throw new Error('x'); }
catch (e) { server = spawn(process.execPath, ['serve.js'], { cwd: ROOT, stdio: 'ignore' }); }
for (let i = 0; i < 40; i++) { try { const r = await fetch(URL); if (r.ok) break; } catch (e) {} await wait(250); }

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--disable-gpu', '--no-first-run',
  '--disable-extensions', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' });
let wsUrl = null;
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
    if (r.ok) { const p = (await r.json()).find(t => t.type === 'page'); if (p) { wsUrl = p.webSocketDebuggerUrl; break; } }
  } catch (e) {}
  await wait(200);
}

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

let ws = null;
try {
  ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map(); const exceptions = [];
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      exceptions.push((d.exception?.description || d.text || '').split(/\r?\n/)[0]);
    }
  };
  await new Promise(r => (ws.onopen = r));
  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      console.log('  [eval]', r.exceptionDetails.text, r.exceptionDetails.exception?.description || '');
      return undefined;
    }
    return r.result.value;
  };
  const poll = async (expr, timeout = 30000, step = 250) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { const v = await evalJs(expr); if (v) return v; await wait(step); }
    return null;
  };
  const setFile = async () => {
    const doc = await send('DOM.getDocument');
    const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#dc_file' });
    if (!q.nodeId) throw new Error('#dc_file not found');
    await send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [CUBE] });
    // importFile 的 finally 会把 #dc_file.value 复位；等它复位 = 本轮导入真正结束，
    // 避免下一次 setFile 撞上 state.busy 而被静默忽略（本脚本第一次就踩过）。
    const t0 = Date.now();
    while (Date.now() - t0 < 45000) {
      const v = await evalJs(`(() => { const f = document.querySelector('#dc_file'); return f ? f.value : '<gone>'; })()`);
      if (v === '' || v === '<gone>') return;
      await wait(200);
    }
    throw new Error('importFile 未在 45s 内结束（#dc_file.value 未复位）');
  };
  const dcState = () => evalJs(`(() => ({
    viewHidden: !!document.querySelector('#dc_view3d')?.hidden,
    importHidden: !!document.querySelector('#dc_importZone')?.hidden,
    replaceHidden: !!document.querySelector('#dc_replaceStl')?.hidden,
    canvasN: document.querySelectorAll('#dc_view3dBox canvas').length,
    validate: document.querySelector('#dc_validate')?.textContent || '',
    active: window.__rafActive,
    glCreated: window.__glCreated,
    geoDisposed: window.__geoDisposed || 0,
  }))()`);
  const listenerCount = async () => {
    const r = await send('Runtime.evaluate', { expression: `document.querySelector('#dc_view3dBox')` });
    const oid = r.result?.objectId;
    if (!oid) return -1;
    try {
      const l = await send('DOMDebugger.getEventListeners', { objectId: oid });
      return l.listeners.length;
    } finally {
      try { await send('Runtime.releaseObject', { objectId: oid }); } catch (e) {}
    }
  };

  await send('Page.navigate', { url: URL });
  await wait(1400);

  // ---------- 注入受控 mock 与模块 ----------
  const setup = await evalJs(`(async () => {
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    window.__failWebGL = false;
    window.__glRequests = 0; window.__glCreated = 0;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (/webgl/i.test(type)) {
        window.__glRequests++;
        if (window.__failWebGL) return null;
        window.__glCreated++;
      }
      return origGetContext.call(this, type, ...args);
    };

    const origRaf = window.requestAnimationFrame.bind(window);
    const origCancel = window.cancelAnimationFrame.bind(window);
    const active = new Set(); let total = 0;
    window.requestAnimationFrame = function(cb) {
      total++;
      let rafId;
      rafId = origRaf((t) => { active.delete(rafId); return cb(t); });
      active.add(rafId);
      return rafId;
    };
    window.cancelAnimationFrame = function(rafId) { active.delete(rafId); return origCancel(rafId); };
    Object.defineProperty(window, '__rafActive', { get: () => active.size });
    Object.defineProperty(window, '__rafTotal', { get: () => total });

    const THREE = await import('three');
    window.__THREE = THREE;
    const og = THREE.BufferGeometry.prototype.dispose;
    THREE.BufferGeometry.prototype.dispose = function(...a) {
      window.__geoDisposed = (window.__geoDisposed || 0) + 1; return og.apply(this, a);
    };
    const om = THREE.Material.prototype.dispose;
    THREE.Material.prototype.dispose = function(...a) {
      window.__matDisposed = (window.__matDisposed || 0) + 1; return om.apply(this, a);
    };
    const ot = THREE.Texture.prototype.dispose;
    THREE.Texture.prototype.dispose = function(...a) {
      window.__texDisposed = (window.__texDisposed || 0) + 1; return ot.apply(this, a);
    };
    const otr = THREE.BufferGeometry.prototype.translate;
    window.__failTranslate = false;
    THREE.BufferGeometry.prototype.translate = function(...a) {
      if (window.__failTranslate) { window.__failTranslate = false; throw new Error('mock: model load failed'); }
      return otr.apply(this, a);
    };

    window.__MV = await import('/js/views/components/modelView3D.js');
    const stl = await import('/js/engine/stl.js');
    const buf = await (await fetch('/tests/golden/cube50.stl')).arrayBuffer();
    window.__cubeMesh = stl.parseSTL(buf);
    return { tris: window.__cubeMesh.triCount, hasMV: !!window.__MV.ModelView3D };
  })()`);
  check('测试夹具就绪（ModelView3D + cube50.stl）', !!setup?.hasMV && setup.tris > 0, JSON.stringify(setup));

  // ---------- A/B 组件级：构造失败 / 正常创建 / 加载 / 销毁 ----------
  const comp = await evalJs(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const out = {};
    const div = document.createElement('div');
    div.style.cssText = 'width:320px;height:240px;position:absolute;left:-9999px;top:0';
    document.body.appendChild(div);
    const raf0 = window.__rafTotal, gl0 = window.__glCreated;
    window.__failWebGL = true;
    let createErr = null;
    try { new window.__MV.ModelView3D(div); } catch (e) { createErr = String(e && e.message || e); }
    window.__failWebGL = false;
    out.createFail = {
      threw: !!createErr, err: createErr,
      childN: div.children.length, canvasN: div.querySelectorAll('canvas').length,
      rafDelta: window.__rafTotal - raf0, glDelta: window.__glCreated - gl0,
      active: window.__rafActive, glRequests: window.__glRequests,
    };
    div.remove();

    const div2 = document.createElement('div');
    div2.style.cssText = 'width:320px;height:240px;position:absolute;left:-9999px;top:0';
    document.body.appendChild(div2);
    const gl1 = window.__glCreated;
    const inst = new window.__MV.ModelView3D(div2);
    await sleep(100);
    out.created = { canvasN: div2.querySelectorAll('canvas').length, active: window.__rafActive, glDelta: window.__glCreated - gl1 };

    const g0 = window.__geoDisposed || 0, m0 = window.__matDisposed || 0, t0 = window.__texDisposed || 0;
    inst.load(window.__cubeMesh);
    out.loaded = { meshN: inst.meshGroup.children.length, hasBounds: !!inst.bounds };

    // 热结 marker：再次 setHotspots 应释放旧 geometry/material/texture；
    // 但 Sprite 的 geometry 是 three 共享对象，绝不能 dispose。
    const g1 = window.__geoDisposed || 0, m1 = window.__matDisposed || 0, t1 = window.__texDisposed || 0;
    inst.setHotspots([{ x: 0, y: 0, z: 0, mc: 10 }]);
    const spriteObj = inst.markerMeshes[0]?.children?.find(o => o.isSprite);
    let sharedSpriteDisposed = 0;
    if (spriteObj) {
      const sg = spriteObj.geometry;
      const origSgDispose = sg.dispose;
      sg.dispose = function(...a) { sharedSpriteDisposed++; return origSgDispose.apply(this, a); };
    }
    inst.setHotspots([{ x: 0, y: 0, z: 0, mc: 12 }]);
    out.markers = {
      count: inst.markerMeshes.length,
      geo: (window.__geoDisposed || 0) - g1,
      mat: (window.__matDisposed || 0) - m1,
      tex: (window.__texDisposed || 0) - t1,
      sharedSpriteDisposed,
    };
    inst.clearMesh();
    out.cleared = {
      meshN: inst.meshGroup.children.length,
      geo: (window.__geoDisposed || 0) - g0,
      mat: (window.__matDisposed || 0) - m0,
      tex: (window.__texDisposed || 0) - t0,
    };

    const gf = window.__geoDisposed || 0, mf = window.__matDisposed || 0;
    let loadErr = null;
    window.__failTranslate = true;   // 在 geometry.translate 处抛错（加入 meshGroup 之前）
    try { inst.load(window.__cubeMesh); } catch (e) { loadErr = String(e && e.message || e); }
    out.loadFail = {
      threw: !!loadErr, msg: loadErr,
      geo: (window.__geoDisposed || 0) - gf,
      mat: (window.__matDisposed || 0) - mf,
    };

    inst.loadScene([{ mesh: window.__cubeMesh, key: 'P1' }], [0, 0, 0]);
    out.sceneLoaded = { meshN: inst.meshGroup.children.length, pickN: inst.pickTargets.length, hasBounds: !!inst.bounds };
    const gs = window.__geoDisposed || 0, ms = window.__matDisposed || 0;
    let sceneErr = null;
    window.__failTranslate = true;
    try { inst.loadScene([{ mesh: window.__cubeMesh, key: 'P1' }], [0, 0, 0]); } catch (e) { sceneErr = String(e && e.message || e); }
    out.sceneFail = {
      threw: !!sceneErr, msg: sceneErr,
      geo: (window.__geoDisposed || 0) - gs,
      mat: (window.__matDisposed || 0) - ms,
    };

    /* 172：资源所有权专项（直接调用 _disposeGroup，验证共享资源不被误释放） */
    const THREE = window.__THREE;
    const spyDispose = (obj) => {
      let n = 0;
      const orig = obj.dispose.bind(obj);
      obj.dispose = (...a) => { n++; return orig(...a); };
      return () => n;
    };
    const makeArrow = (d) => new THREE.ArrowHelper(
      new THREE.Vector3(...d).normalize(), new THREE.Vector3(), 10, 0xff0000);
    const a1 = makeArrow([1, 0, 0]), a2 = makeArrow([0, 1, 0]), aOutside = makeArrow([0, 0, 1]);
    const a1LineGeo = spyDispose(a1.line.geometry);
    const a1ConeGeo = spyDispose(a1.cone.geometry);
    const a1LineMat = spyDispose(a1.line.material);
    const a1ConeMat = spyDispose(a1.cone.material);
    const a2LineMat = spyDispose(a2.line.material);
    const a2ConeMat = spyDispose(a2.cone.material);
    const outLineGeo = spyDispose(aOutside.line.geometry);
    const outConeGeo = spyDispose(aOutside.cone.geometry);
    const outLineMat = spyDispose(aOutside.line.material);
    const outConeMat = spyDispose(aOutside.cone.material);

    const arrowShared = {
      line: a1.line.geometry === a2.line.geometry && a1.line.geometry === aOutside.line.geometry,
      cone: a1.cone.geometry === a2.cone.geometry && a1.cone.geometry === aOutside.cone.geometry,
    };
    const gArrow = new THREE.Group();
    gArrow.add(a1, a2);
    inst._disposeGroup(gArrow);
    const arrowFirst = {
      lineGeo: a1LineGeo(), coneGeo: a1ConeGeo(),
      lineMat: [a1LineMat(), a1ConeMat(), a2LineMat(), a2ConeMat()],
      outsideGeo: [outLineGeo(), outConeGeo()],
      outsideMat: [outLineMat(), outConeMat()],
      children: gArrow.children.length,
    };
    let arrowRepeatErr = null;
    try { inst._disposeGroup(gArrow); } catch (e) { arrowRepeatErr = String(e && e.message || e); }
    const arrowSecond = {
      lineGeo: a1LineGeo(), coneGeo: a1ConeGeo(),
      lineMat: [a1LineMat(), a1ConeMat(), a2LineMat(), a2ConeMat()],
    };

    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(document.createElement('canvas')),
    }));
    const spriteGeo = spyDispose(sprite.geometry);
    const spriteMat = spyDispose(sprite.material);
    const spriteTex = spyDispose(sprite.material.map);
    const gSprite = new THREE.Group(); gSprite.add(sprite);
    inst._disposeGroup(gSprite);

    const mGeo = new THREE.SphereGeometry(1, 4, 2);
    const mMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const meshGeo = spyDispose(mGeo);
    const meshMat = spyDispose(mMat);
    const gMesh = new THREE.Group();
    gMesh.add(new THREE.Mesh(mGeo, mMat));
    inst._disposeGroup(gMesh);

    const sGeo = new THREE.SphereGeometry(1, 4, 2);
    const sMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const sharedGeo = spyDispose(sGeo);
    const sharedMat = spyDispose(sMat);
    const gShared = new THREE.Group();
    gShared.add(new THREE.Mesh(sGeo, sMat), new THREE.Mesh(sGeo, sMat));
    inst._disposeGroup(gShared);

    out.resources = {
      arrowShared, arrowFirst, arrowSecond, arrowRepeatErr,
      sprite: { geo: spriteGeo(), mat: spriteMat(), tex: spriteTex(), children: gSprite.children.length },
      mesh: { geo: meshGeo(), mat: meshMat(), children: gMesh.children.length },
      setDedupe: { geo: sharedGeo(), mat: sharedMat(), children: gShared.children.length },
    };
    inst.load(window.__cubeMesh);

    const rafBefore = window.__rafTotal;
    inst.dispose();
    const activeImmediately = window.__rafActive;
    await sleep(320);
    out.disposed = {
      activeImmediately, activeAfter: window.__rafActive,
      rafDelta: window.__rafTotal - rafBefore,
      canvasN: div2.querySelectorAll('canvas').length,
      meshGroup: inst.meshGroup === null,
    };
    let doubleErr = null;
    try { inst.dispose(); } catch (e) { doubleErr = String(e && e.message || e); }
    out.disposed.doubleErr = doubleErr;
    div2.remove();
    return out;
  })()`);

  console.log('\n【B 组件级：Renderer 创建失败】');
  check('构造失败被抛出，容器无残留 canvas', comp?.createFail?.threw && comp.createFail.childN === 0 && comp.createFail.canvasN === 0,
    JSON.stringify(comp?.createFail));
  check('构造失败未启动动画循环', comp?.createFail?.rafDelta === 0 && comp.createFail.active === 0,
    JSON.stringify(comp?.createFail));
  check('构造失败未留下 WebGL 上下文', comp?.createFail?.glDelta === 0 && comp.createFail.glRequests > 0,
    JSON.stringify(comp?.createFail));

  console.log('\n【A 组件级：正常初始化 / 加载 / 销毁】');
  check('正常创建：canvas 存在且仅一个动画循环', comp?.created?.canvasN === 1 && comp.created.active === 1,
    JSON.stringify(comp?.created));
  check('正常加载：网格进入场景', comp?.loaded?.meshN === 1 && comp.loaded.hasBounds, JSON.stringify(comp?.loaded));
  check('setHotspots 替换释放旧 marker 资源，且不释放共享 Sprite geometry',
    comp?.markers?.count === 1 && comp.markers.geo >= 2 && comp.markers.mat >= 3
    && comp.markers.tex >= 1 && comp.markers.sharedSpriteDisposed === 0, JSON.stringify(comp?.markers));
  check('clearMesh 真正释放 geometry 与 material',
    comp?.cleared?.meshN === 0 && comp.cleared.geo >= 1 && comp.cleared.mat >= 1, JSON.stringify(comp?.cleared));
  check('load 失败会抛错，并释放本次未入场景的 geometry/material',
    comp?.loadFail?.threw && comp.loadFail.geo >= 1 && comp.loadFail.mat >= 1, JSON.stringify(comp?.loadFail));
  check('loadScene 正常加载多对象场景并可拾取',
    comp?.sceneLoaded?.meshN === 1 && comp.sceneLoaded.pickN === 1 && comp.sceneLoaded.hasBounds,
    JSON.stringify(comp?.sceneLoaded));
  check('loadScene 失败会释放未入场景的 geometry/material',
    comp?.sceneFail?.threw && comp.sceneFail.geo >= 1 && comp.sceneFail.mat >= 1,
    JSON.stringify(comp?.sceneFail));
  check('ArrowHelper 两个实例的 line/cone geometry 是同一份共享对象',
    comp?.resources?.arrowShared?.line === true && comp.resources.arrowShared.cone === true,
    JSON.stringify(comp?.resources?.arrowShared));
  check('_disposeGroup 不释放 ArrowHelper 共享 geometry，仍释放独立 material',
    comp?.resources?.arrowFirst?.lineGeo === 0 && comp.resources.arrowFirst.coneGeo === 0
    && comp.resources.arrowFirst.lineMat.every(n => n === 1) && comp.resources.arrowFirst.children === 0,
    JSON.stringify(comp?.resources?.arrowFirst));
  check('清理 flow Group 不影响另一个 ArrowHelper 的共享 geometry/material',
    comp?.resources?.arrowFirst?.outsideGeo.every(n => n === 0)
    && comp.resources.arrowFirst.outsideMat.every(n => n === 0),
    JSON.stringify(comp?.resources?.arrowFirst));
  check('重复清理同一 Group 安全且不重复释放 ArrowHelper 资源',
    !comp?.resources?.arrowRepeatErr && comp.resources.arrowSecond.lineGeo === 0
    && comp.resources.arrowSecond.coneGeo === 0
    && comp.resources.arrowSecond.lineMat.every(n => n === 1),
    JSON.stringify({ repeatErr: comp?.resources?.arrowRepeatErr, second: comp?.resources?.arrowSecond }));
  check('Sprite 共享 geometry 受保护，SpriteMaterial/CanvasTexture 仍释放',
    comp?.resources?.sprite?.geo === 0 && comp.resources.sprite.mat === 1
    && comp.resources.sprite.tex === 1 && comp.resources.sprite.children === 0,
    JSON.stringify(comp?.resources?.sprite));
  check('普通 Mesh 独立资源释放，且同一 Group 内 Set 去重仍生效',
    comp?.resources?.mesh?.geo === 1 && comp.resources.mesh.mat === 1 && comp.resources.mesh.children === 0
    && comp.resources.setDedupe.geo === 1 && comp.resources.setDedupe.mat === 1
    && comp.resources.setDedupe.children === 0,
    JSON.stringify({ mesh: comp?.resources?.mesh, setDedupe: comp?.resources?.setDedupe }));
  check('dispose 后动画循环停止、canvas 移除、重复 dispose 不抛错',
    comp?.disposed?.activeAfter === 0 && comp.disposed.rafDelta === 0 && comp.disposed.canvasN === 0
    && comp.disposed.meshGroup && !comp.disposed.doubleErr, JSON.stringify(comp?.disposed));

  // ---------- UI：真实 designCenter importFile ----------
  await evalJs(`location.hash = '#/designCenter'`);
  const ready = await poll(`document.querySelector('#dc_importZone') && document.querySelector('#dc_file') ? 1 : 0`, 30000, 300);
  check('设计中心加载（导入区 + 文件输入）', !!ready);

  console.log('\n【B UI：WebGL 创建失败 → 重试入口】');
  await evalJs(`window.__failWebGL = true`);
  const glBeforeFail = await evalJs(`window.__glCreated`);
  await setFile();
  const failShown = await poll(`(document.querySelector('#dc_validate')?.textContent || '').includes('三维视图初始化失败') ? 1 : 0`, 20000, 300);
  const failState = await dcState();
  check('首次导入失败：显示三维视图初始化失败', !!failShown, failState.validate.slice(0, 160));
  check('失败后无 canvas、动画循环为 0、未创建 WebGL 上下文',
    failState.canvasN === 0 && failState.active === 0 && failState.glCreated === glBeforeFail, JSON.stringify(failState));
  check('失败后导入区与顶部「导入 STL」都可见',
    !failState.importHidden && !failState.replaceHidden && failState.viewHidden, JSON.stringify(failState));
  check('错误提示给出明确的重新选择文件入口', /重新选择文件/.test(failState.validate), failState.validate.slice(0, 200));

  await evalJs(`window.__failWebGL = false`);
  await setFile();
  const retryOk = await poll(`document.querySelector('#dc_replaceStl') && !document.querySelector('#dc_replaceStl').hidden
    && document.querySelectorAll('#dc_view3dBox canvas').length === 1 ? 1 : 0`, 30000, 300);
  const retryState = await dcState();
  check('解除故障后重试成功：三维视图恢复、导入区收起、一个动画循环',
    !!retryOk && !retryState.viewHidden && retryState.importHidden && retryState.canvasN === 1 && retryState.active === 1,
    JSON.stringify(retryState));
  const listenersAfterFirstSuccess = await listenerCount();

  console.log('\n【C UI：实例创建成功但模型加载失败】');
  await evalJs(`window.__failTranslate = true`);
  await setFile();
  const loadFailShown = await poll(`(document.querySelector('#dc_validate')?.textContent || '').includes('三维模型加载失败') ? 1 : 0`, 20000, 300);
  const loadFailState = await dcState();
  check('模型加载失败：显示三维模型加载失败', !!loadFailShown, loadFailState.validate.slice(0, 160));
  check('失败实例不残留：无 canvas、动画循环 0、旧视图已释放',
    loadFailState.canvasN === 0 && loadFailState.active === 0, JSON.stringify(loadFailState));
  check('模型加载失败后仍有重新选择文件入口',
    !loadFailState.importHidden && !loadFailState.replaceHidden && loadFailState.viewHidden, JSON.stringify(loadFailState));

  await setFile();
  const recover2 = await poll(`document.querySelectorAll('#dc_view3dBox canvas').length === 1
    && document.querySelector('#dc_replaceStl') && !document.querySelector('#dc_replaceStl').hidden ? 1 : 0`, 30000, 300);
  const recover2State = await dcState();
  check('模型加载失败后再次导入成功恢复', !!recover2 && !recover2State.viewHidden && recover2State.canvasN === 1 && recover2State.active === 1,
    JSON.stringify(recover2State));

  console.log('\n【D 连续失败 / 重试不累积】');
  for (let i = 0; i < 2; i++) {
    const gl0 = await evalJs(`window.__glCreated`);
    await evalJs(`window.__failWebGL = true`);
    await setFile();
    await poll(`(document.querySelector('#dc_validate')?.textContent || '').includes('三维视图初始化失败') ? 1 : 0`, 20000, 300);
    const s = await dcState();
    check(`第 ${i + 1} 次连续失败：无 canvas / 无动画循环 / 未新增 WebGL 上下文`,
      s.canvasN === 0 && s.active === 0 && s.glCreated === gl0, JSON.stringify(s));
    await evalJs(`window.__failWebGL = false`);
  }
  await setFile();
  const finalOk = await poll(`document.querySelectorAll('#dc_view3dBox canvas').length === 1
    && document.querySelector('#dc_replaceStl') && !document.querySelector('#dc_replaceStl').hidden ? 1 : 0`, 30000, 300);
  const finalState = await dcState();
  check('连续失败后最终成功：仅一个 canvas、一个动画循环',
    !!finalOk && finalState.canvasN === 1 && finalState.active === 1 && !finalState.viewHidden,
    JSON.stringify(finalState));
  const listenersAfterRepeated = await listenerCount();
  check('多次失败/成功后同一容器的 DOM 事件监听器不累积',
    listenersAfterFirstSuccess > 0 && listenersAfterRepeated === listenersAfterFirstSuccess,
    JSON.stringify({ listenersAfterFirstSuccess, listenersAfterRepeated }));

  console.log('\n【E 页面切换恢复】');
  await evalJs(`location.hash = '#/home'`); await wait(700);
  await evalJs(`location.hash = '#/designCenter'`);
  const backOk = await poll(`document.querySelectorAll('#dc_view3dBox canvas').length === 1
    && document.querySelector('#dc_importZone')?.hidden ? 1 : 0`, 20000, 300);
  const backState = await dcState();
  check('返回首页再进入设计中心：三维视图正常恢复，仍只有一个动画循环',
    !!backOk && backState.canvasN === 1 && backState.active === 1 && !backState.viewHidden,
    JSON.stringify(backState));

  console.log('\n【F restore() 初始化失败路径】');
  await evalJs(`location.hash = '#/home'`); await wait(700);
  const glBeforeRestoreFail = await evalJs(`window.__glCreated`);
  await evalJs(`window.__failWebGL = true`);
  await evalJs(`location.hash = '#/designCenter'`);
  const restoreFailShown = await poll(`(document.querySelector('#dc_validate')?.textContent || '').includes('三维视图初始化失败') ? 1 : 0`, 20000, 300);
  const restoreFailState = await dcState();
  check('restore 初始化失败：错误可见、无 canvas、无动画循环、未新增 WebGL 上下文',
    !!restoreFailShown && restoreFailState.canvasN === 0 && restoreFailState.active === 0
    && restoreFailState.glCreated === glBeforeRestoreFail, JSON.stringify(restoreFailState));
  check('restore 失败后导入区与顶部「导入 STL」仍可见',
    !restoreFailState.importHidden && !restoreFailState.replaceHidden && restoreFailState.viewHidden,
    JSON.stringify(restoreFailState));

  await evalJs(`window.__failWebGL = false`);
  await setFile();
  const restoreRecovered = await poll(`document.querySelectorAll('#dc_view3dBox canvas').length === 1
    && document.querySelector('#dc_replaceStl') && !document.querySelector('#dc_replaceStl').hidden ? 1 : 0`, 30000, 300);
  const restoreRecoveredState = await dcState();
  check('restore 失败后重新导入可恢复三维视图',
    !!restoreRecovered && restoreRecoveredState.canvasN === 1 && restoreRecoveredState.active === 1
    && !restoreRecoveredState.viewHidden, JSON.stringify(restoreRecoveredState));

  console.log('\n【G 390px 手机失败入口】');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await wait(500);
  await evalJs(`window.__failWebGL = true`);
  await setFile();
  const mobileFailShown = await poll(`(document.querySelector('#dc_validate')?.textContent || '').includes('三维视图初始化失败') ? 1 : 0`, 20000, 300);
  const mobileFail = await evalJs(`(() => {
    const z = document.querySelector('#dc_importZone'), p = document.querySelector('#dc_pick');
    return {
      importHidden: !!z?.hidden, pickVisible: !!p && p.offsetWidth > 0,
      replaceHidden: !!document.querySelector('#dc_replaceStl')?.hidden,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      canvasN: document.querySelectorAll('#dc_view3dBox canvas').length,
      validate: document.querySelector('#dc_validate')?.textContent || '',
    };
  })()`);
  check('390px 导入失败后仍有可见的「选择 STL 文件」入口，页面无横向溢出',
    !!mobileFailShown && !mobileFail.importHidden && mobileFail.pickVisible && !mobileFail.overflow
    && mobileFail.canvasN === 0, JSON.stringify(mobileFail));

  await evalJs(`window.__failWebGL = false`);
  await setFile();
  const mobileRecovered = await poll(`document.querySelectorAll('#dc_view3dBox canvas').length === 1
    && document.querySelector('#dc_replaceStl') && !document.querySelector('#dc_replaceStl').hidden ? 1 : 0`, 30000, 300);
  const mobileOk = await evalJs(`(() => ({
    canvasN: document.querySelectorAll('#dc_view3dBox canvas').length,
    active: window.__rafActive,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }))()`);
  check('390px 重试成功后三维视图恢复且无横向溢出',
    !!mobileRecovered && mobileOk.canvasN === 1 && mobileOk.active === 1 && !mobileOk.overflow,
    JSON.stringify(mobileOk));

  check('全过程无未捕获异常', exceptions.length === 0, exceptions.slice(0, 3).join(' | '));

  console.log('\nWebGL 初始化恢复验收：' + (failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌'));
} catch (e) {
  failures++;
  console.error('脚本异常：', e.stack || e.message);
} finally {
  try { ws?.close(); } catch (e) {}
  edge.kill(); server?.kill();
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  process.exit(failures ? 1 : 0);
}
