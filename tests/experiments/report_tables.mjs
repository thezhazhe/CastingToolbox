// PHASE V2.0-04 · 从 out/hotspot_local_volume.json 生成报告用表格（Markdown）
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(join(HERE, 'out', 'hotspot_local_volume.json'), 'utf8'));
const KS = d.params.Ks;
const n = (v, k = 1) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(k) : '—');

/* 【1】§十二 主对比表 —— 只看原始姿态 */
console.log('## 【1】§十二 主对比表（原始姿态）\n');
console.log('| Case | Hotspot | Mc | K | L=K·Mc | Whole Vc | V3 Region(修) | V3 Region(旧) | **Local STL Vc** | Local/Whole | Local/Region(修) | Local/Region(旧) | Φ=V/L³ | 分量 |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of d.rows.filter(x => x.rotation === 'orig' && x.source === 'v3-hotspot')) {
  for (const h of r.hots) {
    console.log(`| ${r.case.replace('REAL:', '')} | H${r.hotspotId} | ${n(r.mc, 2)} | ${h.K} | ${n(h.cubeSide, 1)} | ${n(r.vWholeCasting, 0)} | ${n(r.vRegionFixed, 0)} | ${n(r.vRegionOld, 0)} | **${n(h.vLocalSTL, 0)}** | ${n(h.ratioLocalToWhole, 4)} | ${n(h.ratioLocalToRegionFixed, 3)} | ${n(h.ratioLocalToRegionOld, 3)} | ${n(h.fillRatio, 3)} | ${h.componentCount} |`);
  }
}

/* 【2】§十三 增长指数与填充率 */
console.log('\n\n## 【2】§十三 K 敏感性：增长指数 p 与填充率 Φ\n');
console.log('| Case/姿态 | Hs | Mc | **p = dlnV/dlnK** | Φ(K=2) | Φ(K=3) | Φ(K=4) | Φ(K=5) | Φ(K=6) | Φ(K=8) | Φ(K=10) |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
const allP = [];
for (const r of d.rows) {
  {
    const hs = r.hots.filter(x => x.K >= 2);
    const pts = hs.map(x => [Math.log(x.K), Math.log(x.vLocalSTL)]);
    const m = pts.length, sx = pts.reduce((a, b) => a + b[0], 0), sy = pts.reduce((a, b) => a + b[1], 0);
    const sxx = pts.reduce((a, b) => a + b[0] * b[0], 0), sxy = pts.reduce((a, b) => a + b[0] * b[1], 0);
    const p = (m * sxy - sx * sy) / (m * sxx - sx * sx);
    allP.push(p);
    const g = (K) => { const x = r.hots.find(y => y.K === K); return x ? n(x.fillRatio, 3) : '—'; };
    console.log(`| ${r.case.replace('REAL:', '')}/${r.rotation} | H${r.hotspotId} | ${n(r.mc, 2)} | **${p.toFixed(2)}** | ${g(2)} | ${g(3)} | ${g(4)} | ${g(5)} | ${g(6)} | ${g(8)} | ${g(10)} |`);
  }
}
allP.sort((a, b) => a - b);
const mean = allP.reduce((a, b) => a + b, 0) / allP.length;
console.log(`\n**p 统计（${allP.length} 个热点）**：min ${allP[0].toFixed(2)} / p25 ${allP[Math.floor(allP.length * .25)].toFixed(2)} / **中位 ${allP[Math.floor(allP.length / 2)].toFixed(2)}** / p75 ${allP[Math.floor(allP.length * .75)].toFixed(2)} / max ${allP[allP.length - 1].toFixed(2)} / 均值 ${mean.toFixed(2)}`);
console.log(`**p 的极差 = ${(allP[allP.length - 1] - allP[0]).toFixed(2)}**（2.0 = 纯"面受限"，3.0 = 纯"体受限"）`);

/* 【3】§十四 薄壁 vs 厚块 */
console.log('\n\n## 【3】§十四 薄壁 vs 厚块（Φ = Vc_local / CubeVolume 的 K 趋势）\n');
console.log('| 类型 | Case | Mc | Φ(K=2) | Φ(K=4) | Φ(K=6) | Φ(K=10) | 解析预期 |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of d.rows.filter(x => x.source === 'analytic')) {
  const g = (K) => { const x = r.hots.find(y => y.K === K); return n(x.fillRatio, 3); };
  console.log(`| 均匀板 | ${r.case} | ${r.mc} | ${g(2)} | ${g(4)} | ${g(6)} | ${g(10)} | Φ = t/L（精确） |`);
}
for (const r of d.rows.filter(x => x.rotation === 'orig' && x.source === 'v3-hotspot')) {
  const g = (K) => { const x = r.hots.find(y => y.K === K); return x ? n(x.fillRatio, 3) : '—'; };
  const f2 = r.hots.find(y => y.K === 2).fillRatio;
  console.log(`| ${f2 < 0.6 ? '薄特征' : (f2 > 0.98 ? '厚块' : '过渡')} | ${r.case.replace('REAL:', '')} H${r.hotspotId} | ${n(r.mc, 2)} | ${g(2)} | ${g(4)} | ${g(6)} | ${g(10)} | — |`);
}

/* 【4】§九 标准几何 K 扫描 */
console.log('\n\n## 【4】§九 标准几何 K 扫描（Vc_local, mm³）\n');
console.log('| Case | Hotspot | Mc | ' + KS.map(k => `K=${k}`).join(' | ') + ' |');
console.log('|---|---|---|' + KS.map(() => '---').join('|') + '|');
for (const r of d.rows.filter(x => x.rotation === 'orig')) {
  const g = (K) => { const x = r.hots.find(y => y.K === K); return x ? n(x.vLocalSTL, 0) : '—'; };
  console.log(`| ${r.case.replace('REAL:', '')} | H${r.hotspotId} | ${n(r.mc, 2)} | ${KS.map(g).join(' | ')} |`);
}
