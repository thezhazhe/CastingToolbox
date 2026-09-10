// ============================================================
// STL 解析与基础几何量 · 纯 JS 引擎模块（不依赖 three.js）
// 浏览器与 Node 通用；单位：STL 无单位，解析层不换算，由调用方处理
// ============================================================

/**
 * 解析 STL（自动识别 Binary / ASCII）
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {{isBinary:boolean, triCount:number,
 *            vertices:Float32Array, normals:Float32Array|null,
 *            header:string, warnings:string[]}}
 * vertices: 每三角 9 个 float（v0x,v0y,v0z, v1x,...）——非索引，STL 原生结构
 * normals:  每三角 3 个 float（仅 Binary 读取；ASCII 无法保证存在则取 null）
 */
export function parseSTL(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const warnings = [];

  const isBinary = (() => {
    // 判据优先级：先看头部是否 ASCII 特征（'solid'/'facet'/'vertex' 文本）
    // ——ASCII 文件长度恰好为 84+50n 时会与 binary 判据冲突，文本特征优先。
    const head = String.fromCharCode(...bytes.subarray(0, 32)).toLowerCase();
    if (/^solid\s/.test(head) || head.includes('facet') || head.includes('vertex')) return false;
    const len = bytes.byteLength;
    if (len < 84) return false;
    // 标准 binary 判法：长度符合 84 + 50n，或长度明确是二进制（无文本特征且 >100 三角形）
    if ((len - 84) % 50 === 0) return true;
    return (len - 84) / 50 > 100;
  })();

  if (isBinary) return parseBinary(data, warnings);
  return parseAscii(bytes, warnings);
}

function parseBinary(data, warnings) {
  const header = String.fromCharCode(...new Uint8Array(data.buffer, data.byteOffset, 80)).replace(/\0+$/, '');
  let triCount = data.getUint32(80, true);
  // 防御：triCount 字段超过文件实际可容纳数（损坏/恶意文件会申请巨量内存直接崩溃）
  const maxTri = Math.floor((data.byteLength - 84) / 50);
  if (triCount > maxTri) {
    warnings.push(`三角形数声明 ${triCount} 超过文件实际容量 ${maxTri}，已按实际截断`);
    triCount = Math.max(0, maxTri);
  }
  const verts = new Float32Array(triCount * 9);
  const normals = new Float32Array(triCount * 3);
  let v = 0, n = 0;
  for (let i = 0; i < triCount; i++) {
    const base = 84 + i * 50;
    normals[n++] = data.getFloat32(base, true);
    normals[n++] = data.getFloat32(base + 4, true);
    normals[n++] = data.getFloat32(base + 8, true);
    for (let j = 0; j < 3; j++) {
      verts[v++] = data.getFloat32(base + 12 + j * 12, true);
      verts[v++] = data.getFloat32(base + 16 + j * 12, true);
      verts[v++] = data.getFloat32(base + 20 + j * 12, true);
    }
  }
  return { isBinary: true, triCount, vertices: verts, normals, header, warnings };
}

function parseAscii(bytes, warnings) {
  const text = new TextDecoder('utf-8').decode(bytes);
  const verts = [];
  const lines = text.split(/\r?\n/);
  let triCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // 容错：部分导出器在 vertex 前有 tab 或多空格
    if (line.startsWith('vertex')) {
      const parts = line.split(/\s+/);
      if (parts.length >= 4) {
        verts.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
        triCount++;
      } else {
        warnings.push(`第 ${i + 1} 行 vertex 数据不完整：${line}`);
      }
    }
  }
  if (triCount === 0 || triCount % 3 !== 0) {
    warnings.push(`ASCII 解析：三角形顶点数 ${triCount} 非 3 的倍数（可能文件损坏或非 STL）`);
  }
  triCount = Math.floor(triCount / 3);
  return {
    isBinary: false, triCount,
    vertices: new Float32Array(verts),
    normals: null, header: '',
    warnings,
  };
}

/** 有符号体积（mm³）：标量三重积分 Σ v0·(v1×v2)/6，面朝外时为负（按 STL 约定取绝对值） */
export function computeVolume(vertices, triCount) {
  let vol = 0;
  let i = 0;
  for (let t = 0; t < triCount; t++) {
    const x0 = vertices[i], y0 = vertices[i + 1], z0 = vertices[i + 2];
    const x1 = vertices[i + 3], y1 = vertices[i + 4], z1 = vertices[i + 5];
    const x2 = vertices[i + 6], y2 = vertices[i + 7], z2 = vertices[i + 8];
    vol += x0 * (y1 * z2 - y2 * z1) + x1 * (y2 * z0 - y0 * z2) + x2 * (y0 * z1 - y1 * z0);
    i += 9;
  }
  return Math.abs(vol) / 6;
}

/** 表面积（mm²）：Σ |(v1-v0)×(v2-v0)|/2 */
export function computeArea(vertices, triCount) {
  let area = 0;
  let i = 0;
  for (let t = 0; t < triCount; t++) {
    const ax = vertices[i + 3] - vertices[i], ay = vertices[i + 4] - vertices[i + 1], az = vertices[i + 5] - vertices[i + 2];
    const bx = vertices[i + 6] - vertices[i], by = vertices[i + 7] - vertices[i + 1], bz = vertices[i + 8] - vertices[i + 2];
    // 叉积模长
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    area += Math.sqrt(cx * cx + cy * cy + cz * cz);
    i += 9;
  }
  return area / 2;
}

/** 包围盒 / 尺寸 / 中心（毫米，STL 原坐标空间） */
export function computeBounds(vertices, triCount) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let i = 0;
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
      if (x < min[0]) min[0] = x; if (x > max[0]) max[0] = x;
      if (y < min[1]) min[1] = y; if (y > max[1]) max[1] = y;
      if (z < min[2]) min[2] = z; if (z > max[2]) max[2] = z;
      i += 3;
    }
  }
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  return {
    min, max, size,
    center: [min[0] + size[0] / 2, min[1] + size[1] / 2, min[2] + size[2] / 2],
    diagonal: Math.sqrt(size[0] * size[0] + size[1] * size[1] + size[2] * size[2]),
  };
}

/** 顶点到 three 风格 BufferGeometry 的转换（供 3D 显示用，见 engine/bvh.js） */
export function toFloat32(vertices) {
  return new Float32Array(vertices);
}
