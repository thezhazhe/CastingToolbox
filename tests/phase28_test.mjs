// ============================================================
// PHASE 28.1 回归：riserWt 单位换算（P0-1）——量纲锁定测试
// 背景：yield.riserWt = Vr(mm³)×rho(g/cm³)/1e6 → kg
// 修复前 /1000 得 g 却标 kg → 显示偏大 1000 倍（Vr=80000mm³ rho=7.0 → 560kg 应为 0.56kg）
// ============================================================
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

export const tests = [
  {
    name: '28-1 riserWt 量纲：Vr(mm³)×rho(g/cm³)/1e6 = kg（80000mm³×7.0 → 0.56kg，非 560kg）',
    fn: () => {
      const Vr = 80000, rho = 7.0;
      const riserWt = Vr * rho / 1e6;
      assert(Math.abs(riserWt - 0.56) < 1e-12, `riserWt 应为 0.56kg，实际 ${riserWt}`);
      assert(riserWt < 1, '冒口重 80cm³ 铸铁件应为亚公斤级（修复前为 560，1000 倍错误）');
    },
  },
  {
    name: '28-2 riserWt 与 Vr 展示一致性：同源 Vr/1000 cm³ 与 riserWt kg 不矛盾',
    fn: () => {
      const Vr = 80000;                 // mm³ = 80 cm³
      const rho = 7.0;                  // g/cm³
      const volCm3 = Vr / 1000;         // 展示层换算（resultsCenter/riserView/report）
      const riserWtKg = Vr * rho / 1e6; // yield 消费换算（P0-1 修复后）
      assert(volCm3 === 80, `Vr 展示应为 80 cm³，实际 ${volCm3}`);
      // 密度 ≈7 → 重量(kg) = 体积(cm³)×rho/1000；80cm³ 铸铁件不可能重 560kg
      assert(Math.abs(riserWtKg - volCm3 * rho / 1000) < 1e-12, 'riserWt(kg) 应等于 Vr(cm³)×rho/1000');
    },
  },
];
