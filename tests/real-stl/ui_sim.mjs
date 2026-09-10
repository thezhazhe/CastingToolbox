// PHASE20 现场取证（27.txt）—— 完整模拟 designCenter importFile 顺序
// 验证 ModelView3D.load 的 geometry.translate 是否破坏共享 mesh.vertices
// 用法: node tests/real-stl/ui_sim.mjs [stl路径]
import { readFileSync } from 'node:fs';
import { parseSTL, computeBounds } from '../../js/engine/stl.js';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { buildDistanceField, scanInside } from '../../js/engine/distanceField.js';
import { analyzeGeometrySliced } from '../../js/engine/geometryAnalysis.js';
import * as THREE from 'three';

const FILE = process.argv[2] || 'D:/LOCAD/STL文件/ALHR4510V2/ALHR4510塑料模具v2-2.1.stl';
const buf = readFileSync(FILE);
const mesh = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
console.log('原始 tri=', mesh.triCount, '前3顶点=', [mesh.vertices[0], mesh.vertices[1], mesh.vertices[2]]);

// ===== designCenter importFile 顺序模拟 =====
const gA = buildMesh(mesh).geometry;                       // :414
const { geometry: gB, bounds: bB } = buildMesh(mesh);      // modelView3D.load :87
const c = bB.center;
console.log('translate 前 bounds=', [bB.min.map(v => +v.toFixed(1)), bB.max.map(v => +v.toFixed(1))], 'center=', c.map(v => +v.toFixed(1)));
gB.translate(-c[0], -c[1], -c[2]);                         // modelView3D.js:97 ← 共享 buffer 原地改
console.log('translate 后 mesh.vertices[0..2] =', [mesh.vertices[0], mesh.vertices[1], mesh.vertices[2]], ' ← 若变化=共享buffer被改!');
const b2 = computeBounds(mesh.vertices, mesh.triCount);
console.log('translate 后 computeBounds =', [b2.min.map(v => +v.toFixed(1)), b2.max.map(v => +v.toFixed(1))]);

// ===== :449 analyzeGeometrySliced + :481 同路径 =====
const ui = await analyzeGeometrySliced(mesh, gA, {}, async () => {});
console.log('分析后 res.gs=', ui.res.gs, 'vs=', +ui.res.vs.toFixed(2), 'insidePoints=', ui.res.insidePoints);
const df = buildDistanceField(mesh, gA, {});
console.log('buildDistanceField: gs=', df.gs, 'vs=', +df.vs.toFixed(2), 'insideIdx.length=', df.insideIdx.length);
console.log('df.bounds=', [df.bounds.min.map(v => +v.toFixed(1)), df.bounds.max.map(v => +v.toFixed(1))]);

// ===== 深挖：平移后 scanInside 为什么全 0 =====
const b3 = computeBounds(mesh.vertices, mesh.triCount);
const mdim3 = Math.max(...b3.size);
const gs3 = 48, vs3 = mdim3 / gs3;
console.log('\n[深挖] 平移后 gs=', gs3, 'vs=', +vs3.toFixed(2), 'bounds=', [b3.min.map(v => +v.toFixed(1)), b3.max.map(v => +v.toFixed(1))]);
// 1) geometry A 的 BVH 状态（414 时创建，428 时 buffer 被改）
console.log('geometry A boundsTree 已构建?', gA.boundsTree?.bounds ? '是' : '否(延迟构建)');
console.log('geometry A boundingBox=', JSON.stringify(gA.boundingBox && [gA.boundingBox.min.toArray().map(v => +v.toFixed(1)), gA.boundingBox.max.toArray().map(v => +v.toFixed(1))]));
console.log('geometry A position[0..2]=', Array.from(gA.getAttribute('position').array.slice(0, 3)));
// 2) 独立射线测试中心点 [0,0,0]
const ray = new THREE.Raycaster();
const tmp = new THREE.Mesh(gA, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
ray.set(new THREE.Vector3(-200, 0, 0), new THREE.Vector3(1, 0, 0));
const hits = ray.intersectObject(tmp, false);
console.log('中心点[0,0,0]沿+x射线 hits=', hits.length, '前3命中距离=', hits.slice(0, 3).map(h => +h.distance.toFixed(2)));
ray.set(new THREE.Vector3(0, 0, -200), new THREE.Vector3(0, 0, 1));
const hits2 = ray.intersectObject(tmp, false);
console.log('中心点[0,0,0]沿+z射线 hits=', hits2.length, '前3命中距离=', hits2.slice(0, 3).map(h => +h.distance.toFixed(2)));
// 3) 直接 scanInside（与引擎同调用）
const inside3 = scanInside(gA, { min: b3.min, max: b3.max, size: b3.size }, gs3, vs3, b3.min);
let n3 = 0;
for (let i = 0; i < inside3.length; i++) if (inside3[i]) n3++;
console.log('scanInside 平移后 inside 体素=', n3, '/', inside3.length);
// 4) 对照：未平移时（重新解析，不执行 load translate）应该 9572
