// ============================================================
// 3D 模型视图组件（Three.js 只负责显示，不负责计算）
// 提供：加载网格 / 自动居中适应 / 旋转缩放平移 / 热结标记 / 清空
// 依赖 index.html 的 importmap（three → vendor/three.module.js）
// ============================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildMesh } from '../../engine/mesh3d.js';
import { displayRadiusFor } from '../../engine/hotspotDisplay.js';

const HS_COLORS = [0xff5252, 0x34d399, 0x60a5fa, 0xfbbf24, 0xa78bfa]; // 5 色轮换

/**
 * 显示层顶点隔离（PHASE 21 修复 ROOT CAUSE）：
 * buildMesh 的 position BufferAttribute 零拷贝引用 mesh.vertices（与分析引擎共享）。
 * ModelView3D 居中 translate 若原地改写，将污染引擎持有的分析数据——PHASE 20 实锤：
 * UI 路径 inside=0，而 probe 路径 9572（geometry 的 position 被平移、缓存的
 * boundingBox/BVH 状态错配 → 射线 0 命中 → 全 outside）。
 * 此函数把 position 换成独立副本，之后显示层任意 transform 均不影响分析数据。
 * 纯函数，Node 可测；浏览器与 Node 各自持有 three 实例，行为一致。
 * @param {THREE.BufferGeometry} geometry buildMesh 结果
 * @returns {THREE.BufferGeometry} 同一实例（position 已隔离）
 */
/** 按比例压暗一个十六进制颜色（PHASE 93 setHighlight 用；不引入新配色） */
function dimHex(hex, k) {
  const r = Math.round(((hex >> 16) & 255) * k);
  const g = Math.round(((hex >> 8) & 255) * k);
  const b = Math.round((hex & 255) * k);
  return (r << 16) | (g << 8) | b;
}

export function detachPosition(geometry) {
  const pos = geometry.getAttribute('position');
  if (pos) geometry.setAttribute('position', new THREE.BufferAttribute(pos.array.slice(), 3));
  return geometry;
}

export class ModelView3D {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0f1a);

    // 相机：透视 + 轨道控制（旋转/缩放/平移）
    this.camera = new THREE.PerspectiveCamera(40, container.clientWidth / Math.max(1, container.clientHeight), 1, 100000);
    this.camera.position.set(120, 100, 180);
    this.controls = new OrbitControls(this.camera, container);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    // 按需渲染：仅当相机/模型/marker 变化时才 render()。
    // 无头/后台环境 rAF 无 vsync 节流，若每帧渲染大网格（软件渲染 ~20ms/帧），
    // 会挤占 MessageChannel 宏任务——分析分片让出（yieldFn）被拖慢到每片一帧
    // （17.8 万面模型 + 882 片 ≈ 19s）。画面静止时重复渲染本无意义。
    this._needsRender = true;
    this.controls.addEventListener('change', () => { this._needsRender = true; });

    // 灯光
    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x1a2030, 0.65);
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(120, 200, 100);
    this.scene.add(ambient, hemi, dir);

    // 坐标轴（弱化，不抢模型；无地面网格——网格线会穿过模型形成"平面"感，干扰观察）
    const axes = new THREE.AxesHelper(200);
    axes.material.transparent = true;
    axes.material.opacity = 0.25;
    this.scene.add(axes);

    this.meshGroup = new THREE.Group();
    this.hsGroup = new THREE.Group();
    this.scene.add(this.meshGroup, this.hsGroup);

    this.hotspots = [];        // 热结数据（居中坐标）
    this.markerMeshes = [];    // marker group 列表（拾取用）
    this.selectedHs = -1;
    this.onSelectHotspot = null;   // 选中回调(idx)；-1 = 取消选中

    /* 网格拾取（PHASE 89 工艺检验中心 · 浇注系统入口面点选）。
       与热结 marker 拾取是**两套独立机制**：marker 走 pointerdown（即时响应），
       网格拾取走 pointerup 且要求位移 < 4px —— 因为用户按下拖动是在转视角，
       pointerdown 就拾取的话，每转一次视角都会误加一个入口点。 */
    this.pickTargets = [];        // 可拾取的网格对象（带 userData.pickKey）
    this.pickMode = null;         // { cb } —— 开启后点击网格回调 {key, tri, point, normal}
    /* 流道叠加层（PHASE 90 §十五：产品连接 / flow path / 分叉点 / 最小截面积位置 / 面积突变位置）。
       单独立一个 Group，**不能**塞进 meshGroup（setDisplayMode 会遍历它把叠加层也切成线框/透明），
       也**不能**进 pickTargets（折线会抢网格拾取）。 */
    this.flowGroup = new THREE.Group();
    this.scene.add(this.flowGroup);
    this._downPos = null;
    this.container.addEventListener('pointerdown', this._onDown = (e) => { this._downPos = [e.clientX, e.clientY]; });
    this.container.addEventListener('pointerup', this._onUp = (e) => {
      const d = this._downPos; this._downPos = null;
      if (!this.pickMode || !d) return;
      if (Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 4) return;   // 是拖拽，不是点击
      this.pickMesh(e);
    });

    this._animate();
    window.addEventListener('resize', this._onResize = () => this.resize());
    // 3D 内点击拾取热结（marker 点击 → 选中+聚焦+回调）
    this.container.addEventListener('pointerdown', this._onPick = (e) => this.pick(e));
    // 调试口：?hsDebug=1 时挂到 window，供自动化验证相机/坐标（生产环境不挂载）
    if (new URLSearchParams(location.search).has('hsDebug')) window.__view3d = this;
  }

  _animate() {
    this.controls.update();
    if (this._needsRender) {
      this.renderer.render(this.scene, this.camera);
      this._needsRender = false;
    }
    requestAnimationFrame(() => this._animate());
  }

  resize() {
    const w = this.container.clientWidth, h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this._needsRender = true;
  }

  /** 加载网格（stl.js 解析结果）并自动居中 */
  load(mesh, fit = true) {
    this.clearMesh();
    const { geometry, bounds } = buildMesh(mesh);
    // 显示层必须持有独立顶点副本（PHASE 21）：buildMesh 零拷贝引用 mesh.vertices，
    // 若直接 translate 会原地改写分析引擎持有的共享数据 → UI inside=0 的 ROOT CAUSE。
    // 这里先隔离 position，下面的居中 translate 只作用于副本。
    detachPosition(geometry);
    this.meshGroup.clear();
    const material = new THREE.MeshPhysicalMaterial({
      color: 0x9fb4d4, metalness: 0.15, roughness: 0.65,
      side: THREE.DoubleSide, flatShading: false,
    });
    const meshObj = new THREE.Mesh(geometry, material);
    // 居中：几何体平移到 bbox 中心为原点（CastEyes 同款方案，计算坐标系一致）
    const c = bounds.center;
    this._offset = c;
    meshObj.geometry.translate(-c[0], -c[1], -c[2]);
    this.meshGroup.add(meshObj);
    this.bounds = bounds;
    this.minSize = Math.min(...bounds.size);   // 模型最小包围盒尺寸（热结球封顶用）
    this._needsRender = true;
    if (fit) this.fit();
  }

  /**
   * 多对象场景（PHASE 88 工艺检验中心）。
   * 与 load() 的**唯一区别**：load() 把每个网格按**自身** bbox 中心平移（单件语义）；
   * 多对象若各按自身居中，对象之间的相对位置会被抹掉 —— 3D 里就看不出
   * "热结在哪里、冒口在哪里、两者空间关系怎样"（88.txt §二十三 的核心诉求）。
   * 本方法按调用方给定的**统一 center** 平移，保留对象间的真实空间关系。
   * @param {Array<{mesh:object, color?:number, opacity?:number, name?:string}>} items
   * @param {number[]} center 统一居中基准（通常取产品 bbox 中心）
   * @param {boolean} [fit] 是否自适应相机
   */
  loadScene(items, center, fit = true) {
    this.clearMesh();
    this.meshGroup.clear();
    this.pickTargets = [];
    this._offset = center;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const it of (items || [])) {
      if (!it?.mesh) continue;
      const { geometry, bounds } = buildMesh(it.mesh);
      detachPosition(geometry);   // PHASE 21 铁律：显示层不得改写分析引擎共享的顶点
      geometry.translate(-center[0], -center[1], -center[2]);
      const material = new THREE.MeshPhysicalMaterial({
        color: it.color ?? 0x9fb4d4, metalness: 0.15, roughness: 0.65,
        side: THREE.DoubleSide, flatShading: false,
        transparent: it.opacity != null && it.opacity < 1,
        opacity: it.opacity ?? 1,
        depthWrite: it.opacity == null || it.opacity >= 1,
      });
      const meshObj = new THREE.Mesh(geometry, material);
      meshObj.userData = { pickKey: it.key ?? null };
      if (it.key) this.pickTargets.push(meshObj);
      this.meshGroup.add(meshObj);
      for (let k = 0; k < 3; k++) {
        if (bounds.min[k] < lo[k]) lo[k] = bounds.min[k];
        if (bounds.max[k] > hi[k]) hi[k] = bounds.max[k];
      }
    }
    if (lo[0] === Infinity) { this.bounds = null; return; }
    const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    this.bounds = {
      min: lo, max: hi, size,
      center: [lo[0] + size[0] / 2, lo[1] + size[1] / 2, lo[2] + size[2] / 2],
      diagonal: Math.hypot(size[0], size[1], size[2]),
    };
    this.minSize = Math.min(...size);
    this._needsRender = true;
    if (fit) this.fit();
  }

  /** 相机适应模型 */
  fit() {
    if (!this.bounds) return;
    const r = this.bounds.diagonal * 0.7 || 100;
    const dir = new THREE.Vector3(1, 0.85, 1.2).normalize().multiplyScalar(r * 1.7);
    this.camera.position.copy(dir);
    this.camera.lookAt(0, 0, 0);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this._needsRender = true;
  }

  /** 显示热结标记（设计中心结果展示用；坐标为居中空间）
   *  像素级诊断结论（2026-08-19）：旧版 45% 透明度球叠深色背景 = 暗红不可见。
   *  新版：不透明核心球（depthTest:false 保证可见——热结在实体内部，正常深度测试会被模型挡住）
   *       + 半透明光晕 + 区域包围盒线框 + ID 标签。
   *  PHASE 22（30.txt 三/四）：显示半径与显示中心均为显示层修正——
   *   半径 = clamp(k × 区域等效半径, minR, maxR)（displayRadiusFor，只读计算数据）；
   *   位置优先使用 hs.displayPosition（引擎位置 + 有界中面修正），未提供则回落 hs.x/y/z。 */
  setHotspots(hsList) {
    this.hsGroup.clear();
    this.hotspots = hsList || [];
    this.markerMeshes = [];
    this.selectedHs = -1;
    const minSize = this.minSize || 1;
    this.hotspots.forEach((hs, i) => {
      const color = HS_COLORS[i % HS_COLORS.length];
      // 显示半径：区域等效半径驱动 + 模型尺寸约束（PHASE 22 规则，见 hotspotDisplay.js）
      const { radius: r } = displayRadiusFor(hs, minSize);
      // 显示中心：displayPosition（ENGINE 位置 + 中面修正，调用方已平移居中）优先
      const dp = hs.displayPosition || [hs.x, hs.y, hs.z];
      const g = new THREE.Group();
      g.position.set(dp[0], dp[1], dp[2]);
      g.userData = { index: i };
      // 不透明核心（醒目；depthTest:false 始终在最前）——核心即显示半径本体
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(r, 20, 14),
        new THREE.MeshBasicMaterial({ color, depthTest: false }),
      );
      g.add(core);
      // 半透明光晕
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(r * 1.6, 24, 16),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthTest: false, side: THREE.DoubleSide }),
      );
      g.add(halo);
      // 区域包围盒线框（热结区域几何范围）
      const bb = hs.regionBBox || hs.region || null;
      if (bb && bb.min && bb.max) {
        const box = new THREE.Box3(
          new THREE.Vector3(bb.min[0] - hs.x, bb.min[1] - hs.y, bb.min[2] - hs.z),
          new THREE.Vector3(bb.max[0] - hs.x, bb.max[1] - hs.y, bb.max[2] - hs.z),
        );
        const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 }));
        line.scale.set(box.max.x - box.min.x || 1, box.max.y - box.min.y || 1, box.max.z - box.min.z || 1);
        line.position.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2);
        line.userData = { index: i };
        g.add(line);
      }
      // ID 标签（H1/H2…，Sprite 文字）
      const sprite = this._makeLabel(`H${i + 1}`, color);
      sprite.position.y = r * 1.5;
      sprite.scale.set(r * 2.2, r * 1.1, 1);
      sprite.userData = { index: i };
      g.add(sprite);
      this.hsGroup.add(g);
      this.markerMeshes.push(g);
    });
    this._needsRender = true;
  }

  /** 生成文字标签 Sprite（H1/H2） */
  _makeLabel(text, color) {
    const c = document.createElement('canvas');
    c.width = 96; c.height = 48;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(10,14,26,0.85)';
    ctx.beginPath(); ctx.roundRect(4, 4, 88, 40, 10); ctx.fill();
    ctx.strokeStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(4, 4, 88, 40, 10); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 26px Bahnschrift, Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 48, 26);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  }

  /** 选中热结：高亮 + 相机聚焦（点击数据列表/3D marker 均可调用） */
  selectHotspot(i, focus = true) {
    if (i < 0 || i >= this.hotspots.length) { this.selectedHs = -1; this._updateMarkerStyle(); return; }
    this.selectedHs = i;
    this._updateMarkerStyle();
    if (!focus) return;
    const hs = this.hotspots[i];
    const dp = hs.displayPosition || [hs.x, hs.y, hs.z];
    const v = new THREE.Vector3(dp[0], dp[1], dp[2]);
    this.controls.target.copy(v);
    // 相机移到热点上方，距离按模型尺寸缩放
    const dir = this.camera.position.clone().sub(v).normalize();
    const d = Math.max(20, (this.bounds?.diagonal || 200) * 0.35);
    this.camera.position.copy(v).addScaledVector(dir, d);
    this.camera.lookAt(v);
    this.controls.update();
    this._needsRender = true;
  }

  _updateMarkerStyle() {
    this.markerMeshes.forEach((g, i) => {
      const on = i === this.selectedHs;
      const core = g.children[0];
      if (!core) return;
      core.scale.setScalar(on ? 1.5 : 1);
      core.material.color.set(on ? 0xffd54f : HS_COLORS[i % HS_COLORS.length]);
      const halo = g.children[1];
      if (halo) halo.scale.setScalar(on ? 1.25 : 1);
    });
  }

  /** 3D 内点击拾取热结 marker（Raycaster） */
  pick(e) {
    const rect = this.container.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects(this.markerMeshes, true);
    let idx = -1;
    if (hits.length) {
      let obj = hits[0].object;
      while (obj && obj.userData?.index === undefined) obj = obj.parent;
      if (obj) idx = obj.userData.index;
    }
    this.selectHotspot(idx);
    this.onSelectHotspot?.(idx);
  }

  /* ============================================================
     网格拾取（PHASE 89 · 浇注系统入口面点选）
     ============================================================ */

  /**
   * 开关网格拾取模式
   * @param {Function|null} cb 收到 {key, tri, point, normal} —— **point 已换算回 STL 原始坐标**
   */
  setPickMode(cb) {
    this.pickMode = cb ? { cb } : null;
    this.container.style.cursor = cb ? 'crosshair' : '';
  }

  /**
   * 射线拾取三角形。
   *
   * ⚠ 关键坑（实测证伪过，别改回去）：**不要用 intersection.faceIndex**。
   *   three-mesh-bvh 的源码里写着 `intersection.faceIndex = tri`，看起来就是三角形号，
   *   但它内部先按 BVH 重排过，实测 60 次射线只有 1/3 能对上原始三角形。
   *   能索引 `parseSTL` 那个非索引 vertices 数组的是 **face.a**（= 三角形号 × 3，逐次命中 3/3）。
   *   语义 A(faceIndex) 命中 1/3；语义 B(face.a/3) 命中 3/3。
   */
  pickMesh(e) {
    if (!this.pickTargets.length) return null;
    const rect = this.container.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects(this.pickTargets, false);
    if (!hits.length) return null;
    const h = hits[0];
    // 显示空间的点 → 还原到 STL 原始坐标（场景按 _offset 平移过；模型层只认原始坐标）
    const o = this._offset || [0, 0, 0];
    const res = {
      key: h.object.userData.pickKey,
      tri: h.face ? ((h.face.a / 3) | 0) : -1,
      point: [h.point.x + o[0], h.point.y + o[1], h.point.z + o[2]],
      normal: h.face ? [h.face.normal.x, h.face.normal.y, h.face.normal.z] : null,
    };
    this.pickMode.cb(res);
    return res;
  }

  /**
   * 流道叠加层（PHASE 90 §十五）。
   *
   * 一次画五样东西：产品连接口、flow path 折线、分叉点、最小截面积位置、面积突变位置。
   * 入参**一律是 STL 原始坐标**，居中在此处统一减 `_offset`（调用方不用管场景平移）。
   *
   * @param {object} overlay
   * @param {Array<{point:number[], color?:number, label?:string, dir?:number[], scale?:number}>} [overlay.markers]
   * @param {Array<{points:number[][], color?:number}>} [overlay.polylines]
   */
  /**
   * PHASE 93 §十二：高亮 `loadScene` 里的某一个对象（按 key），其余压暗。
   *
   * 刻意做成**追加式**的最小方法，与 setFlowOverlay 同样的定位：
   *   · 只改材质的颜色/自发光，不重建几何、不动相机、不碰任何分析数据；
   *   · 不动 opacity —— setDisplayMode 也在改 opacity（透明/实体），两处一起改会互相打架；
   *   · 基准色在第一次调用时存进 userData.baseColor，切回 null 能精确还原。
   * @param {string|null} key 目标对象的 pickKey；null / 不存在的 key = 全部还原
   * @param {boolean} [focus] PHASE 94 §十一：把相机移到该对象上（"定位到对应组件"）。
   *   默认 false —— 高亮是每次重画都要补一次的，顺手动相机会让视角被反复拽走。
   */
  setHighlight(key, focus = false) {
    // ⚠ key == null 是"没有任何选中" —— **所有对象都回原色**，不是"全部压暗"。
    //   写反过一次：页面一进来没选中，模型就整片灰掉（被 browser_inspection_test 抓到）。
    const hasSel = key != null;
    let hit = false;
    let target = null;
    for (const m of this.meshGroup.children) {
      const mat = m.material;
      if (!mat || !mat.color) continue;
      if (m.userData.baseColor === undefined) m.userData.baseColor = mat.color.getHex();
      const on = hasSel && m.userData.pickKey === key;
      if (on) { hit = true; target = m; }
      // 选中 = 原色 + 自发光；有选中时的其余对象 = 压暗到 28%（"聚光灯"效果，不需要新配色）
      mat.color.setHex(on || !hasSel ? m.userData.baseColor : dimHex(m.userData.baseColor, 0.28));
      if (mat.emissive) mat.emissive.setHex(on ? 0x2a2a2a : 0x000000);
      mat.needsUpdate = true;
    }
    // 选中的 key 在场景里不存在（比如冒口被删了）→ 退回"全部原色"，不留一片灰
    if (hasSel && !hit) return this.setHighlight(null);
    this._needsRender = true;
    if (hasSel && focus && target) this.focusOn(target);
  }

  /**
   * PHASE 94 §十一：把相机移到某个网格对象上（"点 S1/G1/I1 → 定位到对应组件"）。
   * 只动相机与 controls.target，不碰几何、不碰任何分析数据。
   * 几何在 loadScene 里已经按统一 center 平移过，所以包围球中心就是场景坐标，可直接用。
   */
  focusOn(meshObj) {
    const g = meshObj.geometry;
    if (!g) return;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const c = g.boundingSphere?.center;
    if (!c) return;
    const r = Math.max(g.boundingSphere.radius || 0, (this.bounds?.diagonal || 200) * 0.08);
    const dir = this.camera.position.clone().sub(c);
    if (dir.lengthSq() < 1e-9) dir.set(1, 0.85, 1.2);
    dir.normalize();
    this.controls.target.copy(c);
    this.camera.position.copy(c).addScaledVector(dir, r * 4.2);
    this.camera.lookAt(c);
    this.controls.update();
    this._needsRender = true;
  }

  setFlowOverlay(overlay) {
    this.flowGroup.clear();
    const o = this._offset || [0, 0, 0];
    const base = Math.max((this.bounds?.diagonal || 200) * 0.012, 0.5);
    const toLocal = (p) => new THREE.Vector3(p[0] - o[0], p[1] - o[1], p[2] - o[2]);

    // 折线：项目里此前没有任何画线的先例。
    // ⚠ 用 Line 的话 **linewidth 在绝大多数平台被忽略**（永远 1px），
    //   而 flow path 恰恰是这张图的主角 —— 实测 1px 的线在整机截图里几乎看不见。
    //   所以点数够时走 TubeGeometry 给真实粗细，点数太少（画不出样条）才退回 Line。
    const tubeR = Math.max(base * 0.4, 0.35);
    for (const pl of (overlay?.polylines || [])) {
      if (!pl?.points || pl.points.length < 2) continue;
      const pts = pl.points.map(toLocal);
      const color = pl.color ?? 0x60a5fa;
      const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
      let obj = null;
      if (pts.length >= 3) {
        try {
          const curve = new THREE.CatmullRomCurve3(pts);
          obj = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.min(pts.length * 3, 200), tubeR, 6, false), mat);
        } catch (e) { obj = null; }
      }
      if (!obj) {
        obj = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }));
      }
      this.flowGroup.add(obj);
    }

    for (const mk of (overlay?.markers || [])) {
      if (!mk?.point) continue;
      const color = mk.color ?? 0xff5252;
      const r = base * (mk.scale || 1);
      const g = new THREE.Group();
      g.position.copy(toLocal(mk.point));
      g.add(new THREE.Mesh(
        new THREE.SphereGeometry(r, 16, 12),
        new THREE.MeshBasicMaterial({ color, depthTest: false }),
      ));
      if (mk.dir) {
        const dir = new THREE.Vector3(mk.dir[0], mk.dir[1], mk.dir[2]).normalize();
        const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(), r * 4.5, color, r * 1.8, r * 0.9);
        arrow.line.material.depthTest = false;
        arrow.cone.material.depthTest = false;
        g.add(arrow);
      }
      if (mk.label) {
        const sprite = this._makeLabel(mk.label, color);
        sprite.position.y = r * 2.2;
        sprite.scale.set(r * 3.2, r * 1.6, 1);
        g.add(sprite);
      }
      this.flowGroup.add(g);
    }
    this._needsRender = true;
  }

  /** 视角预设：front/back/left/right/top/bottom/isometric */
  setView(name) {
    const D = (this.bounds?.diagonal || 200) * 0.8;
    const pos = {
      front: [0, 0, D], back: [0, 0, -D], left: [-D, 0, 0], right: [D, 0, 0],
      top: [0, D, 0], bottom: [0, -D, 0], isometric: [D * 0.72, D * 0.72, D * 0.72],
    }[name];
    if (!pos) return;
    this.camera.position.set(...pos);
    this.camera.lookAt(0, 0, 0);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this._needsRender = true;
  }

  /** 显示模式：solid / wireframe / transparent */
  setDisplayMode(mode) {
    this.meshGroup.children.forEach((m) => {
      if (mode === 'wireframe') { m.material.wireframe = true; m.material.transparent = false; m.material.opacity = 1; }
      else if (mode === 'transparent') { m.material.wireframe = false; m.material.transparent = true; m.material.opacity = 0.45; }
      else { m.material.wireframe = false; m.material.transparent = false; m.material.opacity = 1; }
    });
    this._needsRender = true;
  }

  /** 清空网格（保留场景/相机） */
  clearMesh() {
    this.meshGroup.clear();
    this.hsGroup.clear();
    // 叠加层也要清（否则 load() 之后旧的流道折线还挂在场景里，指着空气）
    this.flowGroup.clear();
    this.pickTargets = [];
    this.bounds = null;
    this._offset = null;
  }

  /** 释放资源 */
  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.container.removeEventListener('pointerdown', this._onPick);
    this.container.removeEventListener('pointerdown', this._onDown);
    this.container.removeEventListener('pointerup', this._onUp);
    this.hotspots = [];
    this.markerMeshes = [];
    this.pickTargets = [];
    this.pickMode = null;
    this.renderer.dispose();
    this.container.innerHTML = '';
  }
}
