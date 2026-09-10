// ============================================================
// Hotspot V2.1 Self Validation · 阈值配置（命令文件 7.txt 第三节 B）
// 所有分级阈值集中在此，不写死在实验脚本
// ============================================================
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..', '..');
export const OUT_DIR = join(ROOT, 'tests', 'golden', 'analytical');
export const RAW_DIR = join(OUT_DIR, 'raw');

/** Localization 误差分级（mm，用户指定） */
export const POSITION_GRADES = {
  EXCELLENT: 1,        // < 1mm
  GOOD: 2,             // 1~2mm
  ACCEPTABLE: 5,       // 2~5mm
  WARNING: 10,         // 5~10mm
  FAIL: Infinity,      // > 10mm
};
export const gradePosition = (errMm) =>
  errMm < POSITION_GRADES.EXCELLENT ? 'EXCELLENT' :
  errMm < POSITION_GRADES.GOOD ? 'GOOD' :
  errMm < POSITION_GRADES.ACCEPTABLE ? 'ACCEPTABLE' :
  errMm < POSITION_GRADES.WARNING ? 'WARNING' : 'FAIL';

/** 厚度/Mc 相对容差（%，与 golden 口径一致：±20%） */
export const THICKNESS_TOL_PCT = 0.20;
export const MC_TOL_PCT = 0.20;

/** classification 枚举（用户第十六节） */
export const CLASS = {
  PASS: 'PASS',
  WARNING: 'WARNING',
  FAIL: 'FAIL',
  EXPECTED: 'EXPECTED',          // 已知/预期偏差（伪影、设计语义）
  SEMANTIC_ISSUE: 'SEMANTIC_ISSUE',  // 算法行为与"热结定义"不符（产品定义问题）
  ALGORITHM_ISSUE: 'ALGORITHM_ISSUE', // 引擎真 bug（证据+复现）
  PARAMETER_ISSUE: 'PARAMETER_ISSUE', // 阈值参数问题
  TEST_ARTIFACT: 'TEST_ARTIFACT',     // 测试模型/生成器伪影
};

/** 分析预算（用户第十五节；不要为通过而修改） */
export const BUDGET = { simpleMs: 3000, complexMs: 8000 };
