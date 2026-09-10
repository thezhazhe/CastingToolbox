// ============================================================
// 真实 STL 诊断运行器（升级版：V3 主引擎 + V2 对照，13.txt §16 / 12.txt §27）
// 对指定目录/文件下的每个 *.stl：
//   解析 → 验证 → bbox/体积 → V3 热结（Local Thermal Modulus）→ V2 对照
// 输出：<name>_diag.json（几何统计 + V3 结果 + V2 对照 + 全链追踪）
// 用法:
//   node tests/real-stl/run_real_stl.mjs                 # 处理 real-stl/ 下所有 *.stl
//   node tests/real-stl/run_real_stl.mjs <file.stl>      # 单个文件（任意路径）
//   node tests/real-stl/run_real_stl.mjs <dir>           # 指定目录下所有 *.stl
// ============================================================
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSTL, computeBounds, computeVolume, computeArea } from '../../js/engine/stl.js';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { validateMesh } from '../../js/engine/meshValidation.js';
import { analyzeHotspotsV3 } from '../../js/engine/v3/hotspotV3.js';
import { analyzeHotspots } from '../../js/engine/hotspot.js';   // V2 对照

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = process.argv[2];

// 目标文件列表
let files = [];
if (!arg) {
  files = readdirSync(HERE).filter(f => f.toLowerCase().endsWith('.stl'));
} else if (statSync(arg).isDirectory()) {
  files = readdirSync(arg).filter(f => f.toLowerCase().endsWith('.stl')).map(f => join(arg, f));
} else {
  files = [arg];
}
if (!files.length) {
  console.log('没有 STL 文件。用法见文件头注释。');
  process.exit(0);
}

const summary = [];
console.log(`处理 ${files.length} 个 STL...\n`);
for (const file of files) {
  const name = basename(file, extname(file));
  console.log(`=== ${name} ===`);
  try {
    const buf = readFileSync(file);
    const mesh = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const mv = validateMesh(mesh);
    const geometry = buildMesh(mesh).geometry;
    const bounds = computeBounds(mesh.vertices, mesh.triCount);
    const vol = computeVolume(mesh.vertices, mesh.triCount);
    const area = computeArea(mesh.vertices, mesh.triCount);

    // V3（主引擎，13.txt 方向）
    const t3 = Date.now();
    const v3 = analyzeHotspotsV3(mesh, geometry);
    const v3ms = Date.now() - t3;
    // V2（对照基线）
    const t2 = Date.now();
    const v2 = analyzeHotspots(mesh, geometry);
    const v2ms = Date.now() - t2;

    const fmt = (h) => h.map(x => `H${x.hotspotId ?? x.id}@(${x.position ?? [x.x, x.y, x.z]}) M=${(x.peakModulus ?? x.mc ?? 0).toFixed(1)} n=${(x.normalizedModulus ?? 0).toFixed(2)} c=${(x.confidence ?? 0).toFixed(2)}`).join(' | ');
    const line = [
      `V3[${v3.status}] ${v3.hotspots.length}热结 ${v3ms}ms${v3.hotspots.length ? ' | ' + fmt(v3.hotspots) : ''}`,
      `V2[${v2.status}] ${v2.hotspots.length}热结 ${v2ms}ms`,
    ];

    const diag = {
      stl: { file: basename(file), triCount: mesh.triCount, size: bounds.size, bounds, volumeCm3: +(vol / 1000).toFixed(1), areaMm2: +area.toFixed(0), closed: mv.closed, issues: mv.issues.filter(i => i.level === 'error').map(i => i.code) },
      v3: {
        status: v3.status, reason: v3.reason, elapsedMs: v3ms,
        hotspots: v3.hotspots,
        debug: { coarse: v3.debug?.coarse, refine: v3.debug?.refine?.slice(0, 10), elapsedMs: v3.debug?.elapsedMs },
        audit: v3.audit,
      },
      v2: { status: v2.status, reason: v2.reason, elapsedMs: v2ms, hotspots: v2.hotspots.map(h => ({ id: h.id, position: [h.x, h.y, h.z], mc: h.mc, confidence: h.confidence, regionVolumeCm3: h.regionVolumeCm3 })) },
    };
    const outFile = join(HERE, `${name}_diag.json`);
    writeFileSync(outFile, JSON.stringify(diag, null, 2));
    console.log(`  ${line.join('\n  ')}`);
    console.log(`  → 结果已存 ${basename(outFile)}`);
    summary.push({ name, triCount: mesh.triCount, size: bounds.size.map(v => +v.toFixed(0)), v3: v3.status, v3n: v3.hotspots.length, v3ms, v2: v2.status, v2n: v2.hotspots.length, v2ms, v3reason: v3.reason });
  } catch (e) {
    console.log(`  ❌ 处理失败: ${e.message}`);
    summary.push({ name, error: e.message });
  }
  console.log('');
}

// 汇总表
console.log('════ 汇总 ════');
console.log('名称'.padEnd(24), 'tri'.padStart(8), '尺寸(mm)'.padStart(18), 'V3'.padStart(6), 'V3热结'.padStart(5), 'V3ms'.padStart(6), 'V2'.padStart(6), 'V2热结'.padStart(5), 'V2ms'.padStart(6));
for (const s of summary) {
  if (s.error) { console.log(s.name.padEnd(24), '❌', s.error); continue; }
  console.log(s.name.padEnd(24), String(s.triCount).padStart(8), s.size.join('×').padStart(18), String(s.v3).padStart(6), String(s.v3n).padStart(5), String(s.v3ms).padStart(6), String(s.v2).padStart(6), String(s.v2n).padStart(5), String(s.v2ms).padStart(6));
}
console.log('\ndiag JSON 含 V3/V2 对照（12.txt §27）；人工标注模板见 README.md');
