// ============================================================
// PHASE 73（81.txt §十九）：版本号**唯一来源**。
//   以前散落在 5 处（侧栏 / 关于弹窗 / 报告 / package.json / AndroidManifest），
//   出现过「应用显示 v0.17、报告写 v0.3.0」的不一致——现在统一从这里取。
// 约定：应用内显示一律带 v 前缀（v1.0.0）；package.json / AndroidManifest 用纯数字（1.0.0）。
// 修改版本号时，只需要改这里 + package.json + dist/apk/project/AndroidManifest.xml，
//   tests/phase73_test.mjs 会断言它们一致（防漂移）。
// ============================================================
export const VERSION = '1.0.0';
export const VERSION_LABEL = 'v' + VERSION;

export default { VERSION, VERSION_LABEL };
