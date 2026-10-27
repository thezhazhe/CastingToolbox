// PHASE V2.0-11 一次性工具：把工作区的 calcManifest.js **逆向**还原成 V2.0-10 结束时的样子，
//   再 diff 出本次（V2.0-11）修复的真实增删行数。逆向 = 精确字符串替换，任一处不命中就抛错。
//   只写临时文件，不碰仓库。⚠ 仓库文件是 CRLF —— 搜索串按实际行尾构造。
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'calcs/calcManifest.js';
let M = readFileSync(SRC, 'utf8');
const NL = M.includes('\r\n') ? '\r\n' : '\n';
const L = (...ls) => ls.join(NL) + NL;

const cut = (oldS, newS, tag) => {
  const n = M.split(oldS).length - 1;
  if (n !== 1) throw new Error(`${tag}：命中 ${n} 次（应为 1）`);
  M = M.split(oldS).join(newS);
};

// ---- 逆 1：删掉 GEOM_INVALID_NOTE + withBlockReason 常量块 ----
{
  const i0 = M.indexOf('/** PHASE V2.0-11');   // 该块首行即 /** PHASE …（不是 /** 独占一行）
  if (i0 < 0) throw new Error('找不到 GEOM_INVALID_NOTE 块');
  const i1 = M.indexOf('/** 判断 Mc 是否来自用户', i0);
  if (i1 < 0) throw new Error('找不到锚点');
  M = M.slice(0, i0) + M.slice(i1);
}

// ---- 逆 2：冒口单热结（展开的 if 块 → 单行）----
cut(
  L('      if (isHardBlocked({ geomStatus, hsStatus, humanInput: userMc })) {',
    "        out.level = 'BLOCK_AUTO_RECOMMEND';",
    '        // PHASE V2.0-11（121.txt §二 R1/R2）：阻断必须**说明原因**，且**不取代**既有的 Mc 说明',
    '        //   （自动 Mc 的"未经确认"仍然属实、仍然有用，只是它不再是读者看到的第一句）。',
    "        if (geomStatus === 'INVALID') out.note = withBlockReason(out.note);",
    '      }'),
  L("      if (isHardBlocked({ geomStatus, hsStatus, humanInput: userMc })) out.level = 'BLOCK_AUTO_RECOMMEND';"),
  '单热结');

// ---- 逆 3：多热结（blocked / noteText 两行 + 两处引用还原）----
cut(
  L('        // PHASE V2.0-10（120.txt §三）：硬门禁判定（与单热结路径同源同口径）。',
    '        const blocked = isHardBlocked({ geomStatus, hsStatus, humanInput: mcAllUser });',
    '        // PHASE V2.0-11（121.txt §二 R3）：几何无效的阻断原因针对**整份几何数据**（网格校验），',
    '        //   与"某个热结分析失败"无关 —— 因此用同一句、不逐热结改写；同样前置、不取代多热结说明。',
    "        const noteText = (blocked && geomStatus === 'INVALID') ? withBlockReason(multiNote) : multiNote;"),
  '', '多热结-前置行');
cut(
  L("          level: blocked ? 'BLOCK_AUTO_RECOMMEND' : 'WARNING_REVIEW',",
    '          ...(noteText ? { note: noteText } : {}),'),
  L("          level: isHardBlocked({ geomStatus, hsStatus, humanInput: mcAllUser }) ? 'BLOCK_AUTO_RECOMMEND' : 'WARNING_REVIEW',",
    '          ...(multiNote ? { note: multiNote } : {}),'),
  '多热结-引用');

// ---- 逆 4：冷铁 ----
cut(
  L('        // PHASE V2.0-11（121.txt §二 R4）：同口径给出阻断原因 —— 复用既有 note 字段，返回结构不变。',
    '        //   ⚠ 冷铁当前**不在** FIXED_CALC_TASKS 里（设计中心不执行冷铁），故本次改动在产品里',
    '        //   暂时**无可观测效果**；记录在案，等冷铁接入主流程时自然生效。',
    "        const bn = geomStatus === 'INVALID' ? withBlockReason(chillNote) : chillNote;",
    "        return bn ? { ...r, note: bn, level: 'BLOCK_AUTO_RECOMMEND' } : { ...r, level: 'BLOCK_AUTO_RECOMMEND' };"),
  L("        return chillNote ? { ...r, note: chillNote, level: 'BLOCK_AUTO_RECOMMEND' } : { ...r, level: 'BLOCK_AUTO_RECOMMEND' };"),
  '冷铁');

const leftovers = (M.match(/V2\.0-11|withBlockReason|GEOM_INVALID_NOTE/g) || []).length;
if (leftovers) throw new Error(`还原不干净，残留 ${leftovers} 处标记`);
writeFileSync(process.env.TEMP + '/cm_v2010final.js', M, 'utf8');
console.log('✅ 还原干净，已写出 ' + process.env.TEMP + '/cm_v2010final.js');
