// ============================================================
// 开发者模式（最简版）
// 普通用户看不到工艺资料库；点击左上角 Logo 5 次 → 输密码解锁。
// 密码 15878391013 写在此处，开发者可自行修改。
// 说明：当前只做"解锁浏览"，JSON 编辑/导入接口后续再加。
// ============================================================

const PASS = '15878391013';
const KEY = 'ct-dev';

let unlocked = false;
try { unlocked = localStorage.getItem(KEY) === '1'; } catch (e) {}

export function isUnlocked() { return unlocked; }

export function checkPassword(pass) { return String(pass).trim() === PASS; }

/** 解锁：持久化 + 同步导航显隐 + 通知 app 刷新 */
export function unlock() {
  unlocked = true;
  try { localStorage.setItem(KEY, '1'); } catch (e) {}
  applyNav();
  document.dispatchEvent(new CustomEvent('ct-dev', { detail: { unlocked: true } }));
}

export function lock() {
  unlocked = false;
  try { localStorage.removeItem(KEY); } catch (e) {}
  applyNav();
  document.dispatchEvent(new CustomEvent('ct-dev', { detail: { unlocked: false } }));
}

/** 同步知识库导航、侧栏解锁徽章、顶栏锁定按钮 */
export function applyNav() {
  const nav = document.getElementById('navKnowledge');
  if (nav) nav.hidden = !unlocked;
  const badge = document.getElementById('devBadge');
  if (badge) badge.hidden = !unlocked;
  const lockBtn = document.getElementById('devLockBtn');
  if (lockBtn) lockBtn.hidden = !unlocked;   // 顶栏锁定按钮（移动端侧栏徽章隐藏时仍可锁定）
}
