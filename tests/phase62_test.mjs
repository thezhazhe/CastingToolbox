// ============================================================
// PHASE 62（第二批标准终核 FINAL）：CT_TABLE 对照 ISO 8062-3:2023 Table 7 全表
//   逐格核验（256 格中 252 格一致；3 处 4 格为 GB 6414-1999 → ISO 2007 换代修订，
//   按现行版执行：160~250/CT5=0.70、630~1000/CT4 与 1000~1600/CT4·CT5 无值）；
//   JB/T 5105 起模斜度 48 格数值确认（3 表×2 模样材质×8 档；初稿"64"为计数笔误，63-JB1 核实）；表结构不变量固化。
//   T1  ISO 基准表与 CT_TABLE 逐格一致性（252 格同值 + 4 格现行值）
//   T2  换代差异格：现行值行为（0.70 / 三处 null）
//   T3  换代差异格：1999 旧值已彻底清除（0.72/0.80 全表扫描）
//   T4  表结构不变量：16 行连续区间 / 同行等级单调 / 同列档位单调 / null 无中空
//   T5  (lo,hi] 边界语义（630/631/1000/1001/10000）
//   T6  castability 起模斜度 48 格与 JB/T 5105-1991 公开表逐档一致（62 核验基线）
// ============================================================
import { ctTolerance } from '../calcs/ct.js';
import { CT_TABLE, CT_GRADES } from '../data/ct_calc.js';
import { DRAFT_OUTER, DRAFT_INNER, DRAFT_SELF_OUTER, DRAFT_HEIGHTS, draftAngles } from '../calcs/castability.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

// ISO 8062-3:2023 Table 7（2023-02 第二版；GB/T 42124.3-2025 修改采用母本）
// 单位 mm、总公差；列 = CT1~CT16（工具代号，DCTG15wt 与 CT16 同值）；null = 该档不采用
// 数值来源：iTeh ISO/CEN/SIST 条目快照×3 + foundbased(ISO 2007 全表) + GB 6414-1999
//   官方复本多谱系 + 行业教材；ANSI 官方预览前言确认 2023 仅 DCTG16→DCTG15wt 更名
const ISO_T7 = [
  [0, 10,      0.09, 0.13, 0.18, 0.26, 0.36, 0.52, 0.74, 1.0, 1.5, 2.0, 2.8, 4.2, null, null, null, null],
  [10, 16,     0.10, 0.14, 0.20, 0.28, 0.38, 0.54, 0.78, 1.1, 1.6, 2.2, 3.0, 4.4, null, null, null, null],
  [16, 25,     0.11, 0.15, 0.22, 0.30, 0.42, 0.58, 0.82, 1.2, 1.7, 2.4, 3.2, 4.6, 6,    8,    10,   12],
  [25, 40,     0.12, 0.17, 0.24, 0.32, 0.46, 0.64, 0.90, 1.3, 1.8, 2.6, 3.6, 5,    7,    9,    11,   14],
  [40, 63,     0.13, 0.18, 0.26, 0.36, 0.50, 0.70, 1.0, 1.4, 2.0, 2.8, 4.0, 5.6, 8,    10,   12,   16],
  [63, 100,    0.14, 0.20, 0.28, 0.40, 0.56, 0.78, 1.1, 1.6, 2.2, 3.2, 4.4, 6,    9,    11,   14,   18],
  [100, 160,   0.15, 0.22, 0.30, 0.44, 0.62, 0.88, 1.2, 1.8, 2.5, 3.6, 5,    7,    10,   12,   16,   20],
  [160, 250,   null, 0.24, 0.34, 0.50, 0.70, 1.0, 1.4, 2.0, 2.8, 4.0, 5.6, 8,    11,   14,   18,   22],
  [250, 400,   null, null, 0.40, 0.56, 0.78, 1.1, 1.6, 2.2, 3.2, 4.4, 6.2, 9,    12,   16,   20,   25],
  [400, 630,   null, null, null, 0.64, 0.90, 1.2, 1.8, 2.6, 3.6, 5.0, 7,    10,   14,   18,   22,   28],
  [630, 1000,  null, null, null, null, 1.0, 1.4, 2.0, 2.8, 4.0, 6.0, 8,    11,   16,   20,   25,   32],
  [1000, 1600, null, null, null, null, null, 1.6, 2.2, 3.2, 4.6, 7.0, 9,    13,   18,   23,   29,   37],
  [1600, 2500, null, null, null, null, null, null, 2.6, 3.8, 5.4, 8.0, 10,   15,   21,   26,   33,   42],
  [2500, 4000, null, null, null, null, null, null, null, 4.4, 6.2, 9.0, 12,   17,   24,   30,   38,   49],
  [4000, 6300, null, null, null, null, null, null, null, null, 7.0, 10,   14,   20,   28,   35,   44,   56],
  [6300, 10000, null, null, null, null, null, null, null, null, null, 11,   16,   23,   32,   40,   50,   64],
];

export const tests = [
  {
    name: '62-T1 CT_TABLE 与 ISO 8062-3:2023 Table 7 基准逐格一致（16 档 × 16 级）',
    fn: () => {
      assert(CT_TABLE.length === 16, `行数 ${CT_TABLE.length}`);
      const diffs = [];
      CT_TABLE.forEach((r, i) => {
        const iso = ISO_T7[i];
        assert(r.lo === iso[0] && r.hi === iso[1], `行 ${i} 区间 ${r.lo}~${r.hi} vs ISO ${iso[0]}~${iso[1]}`);
        CT_GRADES.forEach((g, j) => {
          if (r[g] !== iso[2 + j]) diffs.push(`${r.lo}~${r.hi}/${g}: 表 ${r[g]} vs ISO ${iso[2 + j]}`);
        });
      });
      assert(diffs.length === 0, `差异格: ${diffs.join('; ')}`);
    },
  },
  {
    name: '62-T2 换代修订格现行行为（0.70 与三处无档）',
    fn: () => {
      const t = ctTolerance(200, 'CT5');
      assert(t && t.value === 0.70 && t.half === 0.35, `160~250/CT5 = 0.70 ±0.35（实际 ${t?.value}/${t?.half}）`);
      assert(ctTolerance(631, 'CT4') === null, '630~1000/CT4 现行无档');
      assert(ctTolerance(631, 'CT5') && ctTolerance(631, 'CT5').value === 1.0, '630~1000/CT5 = 1.0 保留');
      assert(ctTolerance(1200, 'CT4') === null, '1000~1600/CT4 现行无档');
      assert(ctTolerance(1200, 'CT5') === null, '1000~1600/CT5 现行无档');
      assert(ctTolerance(1200, 'CT6') && ctTolerance(1200, 'CT6').value === 1.6, '1000~1600/CT6 = 1.6 保留');
      assert(ctTolerance(500, 'CT4') && ctTolerance(500, 'CT4').value === 0.64, '400~630/CT4 = 0.64 不受影响');
      assert(ctTolerance(2000, 'CT7') && ctTolerance(2000, 'CT7').value === 2.6, '1600~2500/CT7 = 2.6 不受影响');
    },
  },
  {
    name: '62-T3 1999 旧值已彻底清除（全表无 0.72/0.80 残留）',
    fn: () => {
      const flat = CT_TABLE.flatMap(r => CT_GRADES.map(g => r[g]));
      assert(!flat.includes(0.72), '全表不应再有 0.72（1999 旧值）');
      assert(!flat.includes(0.80), '全表不应再有 0.80（1999 旧值）');
      // 1.1 在合法档位存在（63~100/CT7、250~400/CT6），只检查 1000~1600 行
      const row = CT_TABLE.find(r => r.lo === 1000);
      assert(row.CT5 == null, '1000~1600/CT5 无 1.1');
    },
  },
  {
    name: '62-T4 表结构不变量（区间连续 / 同行与同列单调 / null 无中空）',
    fn: () => {
      for (let i = 0; i < 16; i++) {
        const r = CT_TABLE[i];
        assert(i === 0 ? r.lo === 0 : r.lo === CT_TABLE[i - 1].hi, `行 ${i} 区间连续`);
        const vals = CT_GRADES.map(g => r[g]);
        const nonNull = vals.map((v, j) => v != null ? j : -1).filter(j => j >= 0);
        assert(nonNull.length === 0 || nonNull[nonNull.length - 1] - nonNull[0] + 1 === nonNull.length,
          `行 ${r.lo}~${r.hi} null 无中空（等级段连续）`);
        for (let k = 1; k < nonNull.length; k++) {
          assert(vals[nonNull[k]] >= vals[nonNull[k - 1]], `行 ${r.lo}~${r.hi} 同行值随等级单调不减`);
        }
      }
      // 同列跨档单调不减（对每列的首个非 null 行起）
      CT_GRADES.forEach((g, j) => {
        let prev = -1;
        for (const r of CT_TABLE) {
          if (r[g] != null) { if (prev >= 0) assert(r[g] >= prev, `列 ${g} 随尺寸档单调不减 @${r.lo}`); prev = r[g]; }
        }
      });
      assert(CT_TABLE[15].hi === 10000, '末行上界 10000');
    },
  },
  {
    name: '62-T5 (lo,hi] 边界归属（630/631/1000/1001/10000）',
    fn: () => {
      assert(ctTolerance(630, 'CT4').value === 0.64, '630 属 400~630 档（闭端归属上一行）');
      assert(ctTolerance(631, 'CT4') === null, '631 起属 630~1000 档');
      assert(ctTolerance(1000, 'CT5').value === 1.0, '1000 属 630~1000 档（闭端）');
      assert(ctTolerance(1001, 'CT6').value === 1.6, '1001 起属 1000~1600 档');
      assert(ctTolerance(10000, 'CT10').value === 11, '10000 属末行');
      assert(ctTolerance(10001, 'CT10') === null, '>10000 无表');
    },
  },
  {
    name: '62-T6 castability 起模斜度 48 格数组与 JB/T 5105-1991 公开表逐档一致（62 基线；3表×2材质×8档）',
    fn: () => {
      // 1991 公开表（两个独立转述来源 + 手册一致）：档位 ≤10/40/100/160/250/400/630/1000，单位 分′
      const J = {
        OUTER_metal:  [140, 70, 30, 25, 20, 20, 20, 15],   // 表1 黏土砂外表面 金属/塑料
        OUTER_wood:   [175, 85, 40, 30, 25, 25, 20, 20],   // 表1 木模
        INNER_metal:  [275, 140, 65, 45, 40, 40, 35, 30],  // 表2 黏土砂凹处内表面 金属/塑料
        INNER_wood:   [345, 170, 75, 55, 45, 45, 40, 35],  // 表2 木模
        SELF_metal:   [210, 110, 50, 35, 30, 30, 25, 20],  // 表3 自硬砂外表面 金属/塑料
        SELF_wood:    [240, 125, 55, 40, 35, 35, 30, 25],  // 表3 木模
      };
      const cmp = (name, code, j91) => {
        assert(code.length === 8 && code.length === j91.length, `${name} 长度`);
        code.forEach((v, i) => assert(v === j91[i], `${name}[${i}] = ${v} 应 ${j91[i]}`));
      };
      cmp('DRAFT_OUTER 金属/塑料', DRAFT_OUTER['金属/塑料'], J.OUTER_metal);
      cmp('DRAFT_OUTER 木模', DRAFT_OUTER['木模'], J.OUTER_wood);
      cmp('DRAFT_INNER 金属/塑料', DRAFT_INNER['金属/塑料'], J.INNER_metal);
      cmp('DRAFT_INNER 木模', DRAFT_INNER['木模'], J.INNER_wood);
      cmp('DRAFT_SELF_OUTER 金属/塑料', DRAFT_SELF_OUTER['金属/塑料'], J.SELF_metal);
      cmp('DRAFT_SELF_OUTER 木模', DRAFT_SELF_OUTER['木模'], J.SELF_wood);
      // 自硬砂内表面 = 表3 外表面 ×1.5（允许上限，工具按上限取值）
      const d = draftAngles(50, '金属/塑料', '树脂砂（自硬）');
      assert(d.innerRaw === Math.round(50 * 1.5), `自硬砂内表面 ×1.5（实际 ${d.innerRaw} vs ${Math.round(50 * 1.5)}）`);
      // 黏土砂内表面走独立表2（275@H≤10 金属 ≈2× 而非 1.5×）
      const d2 = draftAngles(10, '金属/塑料', '潮模砂（湿型）');
      assert(d2.innerRaw === 275 && d2.outerRaw === 140, `黏土砂表2 独立值（实际 内${d2.innerRaw}/外${d2.outerRaw}）`);
      // 档位结构
      assert(JSON.stringify(DRAFT_HEIGHTS) === JSON.stringify([10, 40, 100, 160, 250, 400, 630, 1000]), '高度档位');
    },
  },
];
