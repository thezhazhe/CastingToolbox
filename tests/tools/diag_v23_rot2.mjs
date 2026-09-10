import { generate, rotateMesh } from './hotspotGeometryGenerator.mjs';
const { mesh } = generate('bossOnPlate');
console.log('orig v0:', mesh.vertices.slice(0, 6));
const rot = rotateMesh({ vertices: new Float32Array(mesh.vertices), triCount: mesh.triCount }, 'rx', 90);
console.log('rx90 v0:', rot.vertices.slice(0, 6));
// 检查顶点分布范围
const bounds = (v) => {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      if (v[i + a] < b[a]) b[a] = v[i + a];
      if (v[i + a] > b[a + 3]) b[a + 3] = v[i + a];
    }
  }
  return b;
};
console.log('orig bounds:', bounds(mesh.vertices).map(v => v.toFixed(0)).join(','));
console.log('rx90 bounds:', bounds(rot.vertices).map(v => v.toFixed(0)).join(','));
