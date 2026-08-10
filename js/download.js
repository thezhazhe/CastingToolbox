// ============================================================
// 通用文件保存：EXE/桌面走浏览器 blob 下载；安卓 APK（WebView）走
// 原生 AndroidBridge（HttpServer + JS 桥），保存到系统"下载"目录。
// 用法：import { saveFile } from '../download.js';
//       saveFile('浇注系统计算记录_xxx.html', '<html>...</html>');
// ============================================================

export function saveFile(filename, content, mime = 'text/html') {
  // 安卓 APK：优先走原生桥（blob URL 在 WebView 里无法触发系统下载）
  const bridge = window.AndroidBridge;
  if (bridge && typeof bridge.saveFile === 'function') {
    try {
      bridge.saveFile(filename, content);
      return;
    } catch (e) { /* 桥异常 → 退回浏览器下载 */ }
  }
  // 桌面 / EXE / 普通浏览器
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
