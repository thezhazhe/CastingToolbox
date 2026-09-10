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
    this.bounds = null;
    this._offset = null;
  }

  /** 释放资源 */
  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.container.removeEventListener('pointerdown', this._onPick);
    this.hotspots = [];
    this.markerMeshes = [];
    this.renderer.dispose();
    this.container.innerHTML = '';
  }
}
