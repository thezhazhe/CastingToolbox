// PHASE V2.0-10 一次性工具：把工作区的 calcManifest.js **逆向**还原成"本次修复前"的样子，
//   再 diff 出本次修复的真实增删行数（避免用估计值写进报告）。
//   逆向 = 精确字符串替换，任一处不命中就抛错。只写临时文件，不碰仓库。
//   ⚠ 仓库文件是 CRLF —— 搜索串必须按文件实际行尾构造（踩过一次）。
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'calcs/calcManifest.js';
let M = readFileSync(SRC, 'utf8');
const NL = M.includes('\r\n') ? '\r\n' : '\n';
const L = (...ls) => ls.join(NL) + NL;   // 多行片段 → 带行尾的字符串

const cut = (oldS, newS, tag) => {
  const n = M.split(oldS).length - 1;
  if (n !== 1) throw new Error(`${tag}：命中 ${n} 次（应为 1）`);
  M = M.split(oldS).join(newS);
};

// ---- 逆 1：删掉 isHardBlocked 整块（docblock 起 → 函数收尾 }）----
{
  const i0 = M.indexOf('/**' + NL + ' * PHASE V2.0-10');   // 注意：不补尾行尾（这是半行）
  if (i0 < 0) throw new Error('找不到 isHardBlocked docblock');
  const i1 = M.indexOf('function isHardBlocked', i0);
  if (i1 < 0) throw new Error('找不到 isHardBlocked 定义');
  const i2 = M.indexOf(NL + '}' + NL, i1) + (NL + '}' + NL).length;
  M = M.slice(0, i0) + M.slice(i2);
}

// ---- 逆 2：多热结 level 行 ----
cut(
  L("          // PHASE V2.0-10（120.txt §三）：本路径原先**恒 WARNING_REVIEW**、根本不调用 reliabilityLevel，",
    "          //   于是几何 INVALID 在多热结路径上同样被降级 ⇒ 改用与单热结路径**同源同口径**的硬门禁判定。",
    '          //   humanInput = 全部冒口的 Mc 都是用户改过的（只要还有一个检出值，就算"未经确认"）。',
    "          level: isHardBlocked({ geomStatus, hsStatus, humanInput: mcAllUser }) ? 'BLOCK_AUTO_RECOMMEND' : 'WARNING_REVIEW',"),
  L("          level: 'WARNING_REVIEW',"), '多热结');

// ---- 逆 3：单热结（out 赋值式，3 行注释 + 1 行 if）----
cut(
  L('      // PHASE V2.0-10（120.txt §三）：**阻断优先级** —— 硬门禁压过上面的"软降级"（修 N-E；规则见 isHardBlocked）。',
    '      //   只可能把等级【抬升】到 BLOCK，绝不把 BLOCK 降级；数值照常给出（阻断的是"建议"，不是"计算"）。',
    '      //   放在 out 之后只做一次赋值：既不改上面两行被 06A1-2 锁定的口径，也自动带上 mcSrc 等后续新增字段。',
    "      if (isHardBlocked({ geomStatus, hsStatus, humanInput: userMc })) out.level = 'BLOCK_AUTO_RECOMMEND';"),
  '', '单热结');

// ---- 逆 4：冷铁（把 chillNote 声明移回 level 之后）----
const NOTE = L("        ? 'T_hot 由 STL 自动热结估计值 ×2 推出 —— 这是未经确认的初始建议值，不是本铸件热节的验证结果；自动估计值尚未验证适用于所有几何，请核对热节壁厚后在「冷铁」处确认 T_hot 再复算'");
cut(
  L('      const chillNote = autoT') + NOTE + L('        : null;',
    "      // PHASE V2.0-10（120.txt §三）：**阻断优先级**（与冒口同源，修 N-E 的同一类短路）。",
    "      //   本分支原先写 `(userMc || userT || autoT) ? 'WARNING_REVIEW' : reliabilityLevel(…)`，",
    '      //   autoT 为真即短路 ⇒ 几何 INVALID 被降级。humanInput = 用户显式给了 T_hot 或 Mc（即 !autoT）。',
    '      //   注：本分支只能写成"提前 return"，因为下面那行 return 被 06A1-4 的结构守卫锁定字面；',
    '      //   若将来要在本返回点加顶层字段，这条早返回必须同步（冒口分支已改用 out 赋值以避免该坑）。',
    '      if (isHardBlocked({ geomStatus, hsStatus, humanInput: !autoT })) {',
    "        return chillNote ? { ...r, note: chillNote, level: 'BLOCK_AUTO_RECOMMEND' } : { ...r, level: 'BLOCK_AUTO_RECOMMEND' };",
    '      }',
    "      const level = (userMc || userT || autoT) ? 'WARNING_REVIEW' : reliabilityLevel({ geomStatus, hsStatus });"),
  L("      const level = (userMc || userT || autoT) ? 'WARNING_REVIEW' : reliabilityLevel({ geomStatus, hsStatus });",
    '      const chillNote = autoT') + NOTE + L('        : null;'),
  '冷铁');

const leftovers = (M.match(/V2\.0-10|isHardBlocked/g) || []).length;
if (leftovers) throw new Error(`还原不干净，残留 ${leftovers} 处标记`);
writeFileSync(process.env.TEMP + '/cm_prefix.js', M, 'utf8');
console.log('✅ 还原干净，已写出 ' + process.env.TEMP + '/cm_prefix.js');
