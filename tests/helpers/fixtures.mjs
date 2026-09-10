// ============================================================
// PHASE 73 · 测试夹具清单与缺失检测
//
// 为什么不把夹具放进仓库：
//   · tests/golden/*.stl 里的大件是**程序生成物**（tests/helpers/stlGen.js +
//     scripts/gen_v2_golden.mjs），最大单件 168MB —— 超过 GitHub 单文件 100MB 硬上限，
//     且会把仓库撑到 1.4GB，克隆体验极差；
//   · tests/real-stl/*.stl 是作者真实产品的模具模型，不适合公开。
// 因此这两类**不入库**：缺夹具时相关测试**跳过（不是失败）**，并打印再生方法。
// 本地有夹具时一切照旧（跳过逻辑只在文件确实不存在时生效）。
//
// 再生：
//   node scripts/gen_v2_golden.mjs        # 重新生成 tests/golden 下全部大件
//   tests/real-stl/*.stl                  # 真实件请自行放入（形状/尺寸不同不影响其余测试）
// ============================================================
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** 不入库的夹具（相对 tests/ 的路径）。git 里没有 → 缺失就跳过相关测试文件。 */
export const MANAGED_FIXTURES = [
  'golden/largeThin.stl',
  'golden/largeThinThick.stl',
  'golden/thinShell.stl',
  'golden/adjacentSplit.stl',
  'golden/adjacentMerge.stl',
  'golden/hollowThickRing.stl',
  'golden/mildThick.stl',
  'golden/twoThick.stl',
  'golden/thickOnThin.stl',
  'golden/longBar.stl',
  'golden/lShape.stl',
  'real-stl/ALR2510塑料模具v1.stl',
  'real-stl/ALR2510塑料模具v1_1.stl',
  'real-stl/ALHR4510塑料模具v2-2.1.stl',
  'real-stl/HR4012塑料模具v4最早大板.stl',
];

/** 目录级夹具：源码引用了该路径片段、而目录不存在/为空 → 视为缺夹具 */
export const MANAGED_DIRS = [
  { token: 'engineering-generated/models', dir: 'engineering-generated/models', regen: 'node tests/engineering-generated/gen_engineering.mjs' },
  { token: 'engineering-generated/phase15', dir: 'engineering-generated/phase15', regen: 'node tests/engineering-generated/gen_engineering.mjs' },
];

/**
 * 某个测试文件源码里引用了哪些"缺失的"不入库夹具。
 * @param {string} src 测试文件源码
 * @param {string} testsDir tests 目录绝对路径
 * @returns {string[]} 缺失夹具的相对路径（空数组 = 可正常运行）
 */
export function missingFixturesFor(src, testsDir) {
  const miss = [];
  for (const rel of MANAGED_FIXTURES) {
    const base = path.basename(rel);
    // 源码里出现文件名，或（hotspot 系列）出现去扩展名的模型名
    const stem = base.replace(/\.stl$/i, '');
    if (!src.includes(base) && !new RegExp(`['"\`]${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`).test(src)) continue;
    if (!existsSync(path.join(testsDir, rel))) miss.push(rel);
  }
  for (const d of MANAGED_DIRS) {
    if (!src.includes(d.token)) continue;
    const abs = path.join(testsDir, d.dir);
    let has = false;
    try { has = existsSync(abs) && readdirSync(abs).length > 0; } catch (e) { has = false; }
    if (!has) miss.push(d.dir + '/（目录）');
  }
  return miss;
}

export const REGEN_HINT = '缺测试夹具（未入库）。生成：node scripts/gen_v2_golden.mjs（golden 大件）/ node tests/engineering-generated/gen_engineering.mjs（工程级模型）；真实件模型自备放入 tests/real-stl/ 。详见 tests/FIXTURES.md';
