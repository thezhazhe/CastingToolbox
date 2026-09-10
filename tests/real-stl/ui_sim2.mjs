import { readFileSync } from 'node:fs';
import { parseSTL, computeBounds } from '../../js/engine/stl.js';
import { buildMesh } from '../../js/engine/mesh3d.js';
import * as THREE from 'three';

const buf = readFileSync('D:/LOCAD/STL文件/ALHR4510V2/ALHR4510塑料模具v2-2.1.stl');
const mesh = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const gA = buildMesh(mesh).geometry;
const { geometry: gB, bounds: bB } = buildMesh(mesh);
const c = bB.center;
gB.translate(-c[0], -c[1], -c[2]);   // modelView3D.js:97 ← 改共享 buffer

const rayTest = () => {
  const ray = new THREE.Raycaster();
  const tmp = new THREE.Mesh(gA, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  ray.set(new THREE.Vector3(-200, 0, 0), new THREE.Vector3(1, 0, 0));
  return ray.intersectObject(tmp, false).length;
};
console.log('translate 后（原状态，boundingBox 为旧值）: 射线命中 =', rayTest());
console.log('  geometry.boundingSphere =', gA.boundingSphere && [gA.boundingSphere.center.toArray().map(v=>+v.toFixed(1)), +gA.boundingSphere.radius.toFixed(1)]);
console.log('  geometry.boundingBox   =', gA.boundingBox && [gA.boundingBox.min.toArray().map(v=>+v.toFixed(1)), gA.boundingBox.max.toArray().map(v=>+v.toFixed(1))]);
console.log('  geometry.boundsTree    =', gA.boundsTree ? (gA.boundsTree.bounds ? '已构建' : '延迟(lazy)') : 'null');
// 场景1：刷新 boundingBox/boundingSphere
gA.computeBoundingBox(); gA.computeBoundingSphere();
console.log('场景1 刷新 bbox/sphere 后: 射线命中 =', rayTest(), '| 新sphere=', gA.boundingSphere && +gA.boundingSphere.radius.toFixed(1));
// 场景2：强制构建 BVH（不含刷新 bbox）
const mesh2 = parseSTL(readFileSync('D:/LOCAD/STL文件/ALHR4510V2/ALHR4510塑料模具v2-2.1.stl').buffer.slice(0));
const gC = buildMesh(mesh2).geometry;
const { geometry: gD } = buildMesh(mesh2);
const c2 = computeBounds(mesh2.vertices, mesh2.triCount).center;
gD.translate(-c2[0], -c2[1], -c2[2]);
gC.computeBoundsTree();
console.log('场景2 强制建 BVH（bbox 仍旧）: 射线命中 =', (() => {
  const ray = new THREE.Raycaster();
  const tmp = new THREE.Mesh(gC, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  ray.set(new THREE.Vector3(-200, 0, 0), new THREE.Vector3(1, 0, 0));
  return ray.intersectObject(tmp, false).length;
})());
