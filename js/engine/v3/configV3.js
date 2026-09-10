// ============================================================
// Hotspot Engine V3 参数配置（单文件集中，13.txt 重构版）
// 所有阈值/工程参数只允许在这里修改——算法代码不写死任何数值。
// 参数依据：docs/V3_REFACTOR.md（13.txt A-O 交付文档）
// ============================================================

export const V3_DEFAULTS = {
  /* ---- ① Adaptive Sampling（13.txt §5/§6） ---- */
  coarseResolution: 40,          // 目标网格分辨率（mdim/vs 的基准值）
  coarseMinRes: 24,              // 分辨率下限（vs 上限 = mdim/24）
  coarseMaxRes: 128,             // 分辨率上限（vs 下限 = mdim/128——MAX_RESOLUTION 保护）
  wallLayers: 2,                 // 最小壁厚目标采样层数（vs ≤ 估计壁厚/wallLayers）
  charFilterMin: 2,              // char 伪尖峰过滤下限（mm）：MC 网格化曲面伪曲率
                                 //   （cylinder/ring 实测 char p10 污染到 1~2mm → vs 爆细）。
                                 //   工程假设 UNKNOWN：网格化最小可信特征 ≈ 2mm，待真实 STL 校准
  estWallFloor: 4,               // estMinWall 保底下限（mm）：真实薄壁常见 10~30mm，
                                 //   4mm 保底防全部伪尖峰时 vs 无限细
  coarseMaxPoints: 20000,        // 粗场采样点数上限（性能保护，stride 自动调整）
  refineMinRes: 16,              // 细化网格分辨率下限
  refineMaxPoints: 8000,         // 细化场采样点数上限
  thinFractionMin: 0.10,         // "局部特征过薄"触发：局部完整厚度 t < 2×vs 的材料占比 ≥ 此值
                                 //   （PHASE 23 实测校准，31.txt：30 真实 STL 的 t 测度——
                                 //   误报家族 HR4012 大板/ALHR45xx 全部 0.000~0.011；
                                 //   真薄壁 ALR2510 0.618 / 滑块x3 0.375；边界 ALHR4520A v3 0.090
                                 //   → 阈值 0.10 留 10× 余量区分误报，真薄壁保持警告）

  /* ---- ①b 多级采样（23.txt PHASE 18——NO_INSIDE_POINTS 修复） ---- */
  // 根因：16³ 探测失败（薄壁 < mdim/16 格距，确定性网格相位无落点）→ estMinWall=mdim/40
  //   兜底 → vs=mdim/80 → 主网格格距 ≥ 壁厚 → 壁内无落点 → 0 内部点 → NO_INSIDE_POINTS。
  // 修复：探测逐级升级（失败→下一级）+ 主网格降 vs/半格偏移（相位解耦），受上限保护。
  probeResolutionSteps: [16, 32, 48, 64, 96, 128],  // 粗探测升级序列（mdim/gs 格距）
  probeMinChars: 8,             // 探测 char 数 ≥ 此值才停止升级（estMinWall 可信）
  sampleVsLevels: 3,            // 主网格降 vs 级数（每级 2 次：原相位 + 半格偏移）
  maxSampleGs: 256,             // 主网格升级分辨率上限（性能/内存保护）
  minInsidePoints: 128,         // 主网格内部体素数下限（< 此值视为落点不足，升级）
  phaseOffsetHalf: 0.5,         // 相位偏移（× vs）：半格偏移与原始相位互补

  /* ---- ② Local Window Policy（13.txt §7，固定规则无动态外扩） ---- */
  windowK: [0.5, 1.0, 2.0],      // 多尺度窗口系数：R = k × char(p)（char = 2×到表面距离）
  windowCapRatio: 0.5,           // 窗口上限：R ≤ 此值 × 模型主维 mdim
                                 //   （窗口不超模型一半：局部性保持 + 块计数成本可控；
                                 //   cube 中心 R=min(char, 0.5×mdim) → 窗口≈全模型 →
                                 //   M≈模型 V/A 自然得到，无需回退补丁）
  charFloor: 1.0,                // char 下限（mm，防 MC 网格表面伪尖峰退化）
  modulusCeilRatio: 1 / 3,       // 物理上界：M ≤ (1/3)×d（d = 到表面距离）
                                 //   半球解析 (2/3)d 对"表面嵌入半球"（散热面=半球面）成立，
                                 //   但真实团块延伸到内部（散热面更大 → M 更低）。
                                 //   实测校准：(2/3)d 使 cube 表面层 26.7 > 中心 16.7（伪峰）；
                                 //   (1/3)d → 表面层 13.3 < 中心 16.7 ✓ 无峰；
                                 //   boss 凸台 (1/3)×30=10 vs 板 6 → prom 0.4 ✓ 仍报。
                                 //   工程假设 UNKNOWN（两个解析候选实验选定），待真实 STL 校准

  /* ---- ③ 峰检测 / Region（13.txt §10/§12） ---- */
  peakProminenceMin: 0.35,       // 最小相对显著性：prominence = (M_peak − 环带背景中位)/M_peak ≥ 此值
                                 //   环带 = 峰 1R~2R 壳（真局部背景）。
                                 //   实测校准：均匀件中心（mildThick 板中面 0.32、cylinder100 中心
                                 //   0.28）→ 拒；真热结（boss 凸台 0.5、flange hub/rim 0.4+）→ 报。
                                 //   阈值余量 ~0.05~0.1，UNKNOWN 待真实 STL 校准
  ringInner: 1.0,                // 环带内径：× R_window（壳内缘，紧贴峰支撑区外）
  ringOuter: 2.0,                // 环带外径：× R_window
  peakSeparationRatio: 1.3,      // NMS 间距：两峰距离 < 此值 × R_medium(较大者) → 合并
                                 //   实测校准：boss 凸台高原 2 峰间距 64.1 vs 1.2×52.5=63
                                 //   （差 1.1mm 未合并 → top2 同水平 → uniform 误判）→ 1.3×52.5=68 ✓
                                 //   twoThick 两厚块 160mm、cylinder 对径 120mm → 不合并 ✓
  peakEqualRatio: 0.1,           // 等高环峰合并（14.txt 测试集）：M 差 < 此比例 × maxM
                                 //   → 可能同一环形/带状热节（法兰环上等距等高峰）。
                                 //   实测：t19 环上峰 M 完全相同；t08 环上峰相位波动 10%
                                 //   （10.43/11.57=0.90）；t14 序列 14.18/15.13=0.94 等高
                                 //   但谷深检查（两块间板区 M 低）兜底不合并
  peakEqualDistRatio: 4.0,       // 等高合并距离：< 此值 × R → 候选（t19 环上相邻峰
                                 //   114.5 vs 4×34.9=140 ✓ 合并——环峰分布不均导致相邻
                                 //   间距偏大；t20 大底板内 2 相位峰 185 vs 4×49.2=197 ✓
                                 //   合并；t04 两同块 320 vs 4×60=240 ✗ 不合并；
                                 //   谷深检查（peakEqualValleyRatio）兜底独立厚区）
  peakEqualValleyRatio: 0.7,     // 等高合并谷深检查：峰间中点粗场 M ≥ 此值 × 峰 M → 无谷
                                 //   → 合并。t12 两近块（间距 160 < 3×80）中点落在板区
                                 //   M 低（0.35）→ 不合并；t19 环上中点 0.74（网格相位
                                 //   波动 26%）→ 合并（14.txt 测试集实测：环上相位谷 0.74）
  uniformTop2Ratio: 0.85,        // 均匀件判据（粗场快路径）：候选 <2 或 top2/top1 ≥ 此值
                                 //   → 全场同水平（均匀件锥形/高原对称峰）→ NO_HOTSPOT。
                                 //   实测校准：cylinder 对称峰 0.87 / tube 端部噪声 158 峰 ≈1.0
                                 //   / ring 环弧 34 峰 ≈1.0 → 均匀 ✓；
                                 //   boss 凸台 vs 板 0.2~0.5 / flange hub vs rim 0.66 → 非均匀
  uniformPromMax: 0.6,           // uniform 快路径附加条件：top1 峰 prominence < 此值。
                                 //   等高 + 低 prom = 网格相位噪声（tube 管壁等值线 0.50、
                                 //   plate 边缘线 0.44、largeThin 0.45）→ 均匀快路径 ✓；
                                 //   等高 + 高 prom = 多个真实局部厚区（管法兰环 0.67、
                                 //   多 boss 0.93、递减厚区 0.87、弱块 0.75、阀体 0.68、
                                 //   longBar 0.86、hollowRing 0.68——后者为等厚结构
                                 //   环带跨空腔伪高，必须细化由 region 占比判据区分）
                                 //   → 不 fast-path，走细化（14.txt 测试集实测校准）
  regionOutsideRatio: 0.7,       // （已弃用 14.txt 实测：boss 凸台 0.741 vs cube 中心 0.733
                                 //   重叠——outsideRatio 无法区分局部厚区与均匀件中心；
                                 //   窗口撞上限判据 global_vertex 取代，保留参数作记录）
  centroidDriftMax: 0.2,         // 壳状伪峰检查：|region 质心 − 峰点| / R_peak ≤ 此值
                                 //   实测校准：boss 凸台高原峰点（网格相位偏 0.157）→ 0.2 过；
                                 //   cube 表面层壳状伪峰（0.25）→ 拒；
                                 //   真热结（凸台/法兰 hub）偏移 ≈0.1~0.16
  regionGrowRatio: 0.8,          // Region BFS 生长阈值：≥ region 峰 M × 此值
  regionMinVolumeMm3: 100,       // region 最小体积（mm³），小于 → 采样噪声
                                 //   实测校准：30mm 级厚块的 0.8×peak 核心半径仅 ~4mm
                                 //   （region 343mm³ 被 500 误杀——adjacentMerge）；
                                 //   噪声 region（1-2 cell ≈ 20-40mm³）< 100 仍拒
  regionVolumeMaxRatio: 0.08,    // 中心区/壳状伪峰判据：region 体积 / 模型体积 > 此值 → 拒
                                 //   热结是"局部"结构（占比 <8%：boss 凸台 0.01%、大厚圆柱 3.5%）；
                                 //   均匀件中心区/壳占模型大部分（cube 壳 58%、cylinder 中心 13%）。
                                 //   工程假设 UNKNOWN 待校准
  peakMinRatioHard: 0.35,        // 弱峰无条件拒：峰 M < 主峰 M × 此值 → 拒（网格相位
                                 //   噪声：t09 箱顶壁 0.19 / 箱角柱 0.32、t08 管壁 0.28、
                                 //   t20 顶法兰环 0.18）。热结 = "显著"结构。
  peakMinRatioSoft: 0.5,         // 弱峰条件拒：峰 M < 主峰 M × 此值 且 距主峰 <
                                 //   peakMinDistRatio×R_主峰 → 拒。区分"主结构内的平滑
                                 //   梯度次峰"（t01 boss 内 0.43、距 157 < 2×109 → 拒）
                                 //   与"独立弱热结"（t18 最小 boss 0.40、距 280 >
                                 //   2×100 → 保留；t14 H40 0.40、距 400 → 保留 =
                                 //   识别边界答案）
  peakMinDistRatio: 2.0,         // 弱峰条件拒的距离：距主峰 < 此值 × R_主峰 → 视为
                                 //   主峰结构的一部分（14.txt 测试集实测校准）
  maxHotspots: 5,

  /* ---- ④ 多尺度（简化：13.txt §13 不要求完美 45°） ---- */
  multiscaleMinScales: 2,        // 至少 N 个尺度的 M ≥ 0.6×maxM（弱信号拒绝）
  multiscaleModulusSpread: 0.8,  // 三尺度 M 变异系数上限（外扩已删，k 保持差异）

  /* ---- ⑤ 置信度 ---- */
  confWeights: { modulus: 0.4, prominence: 0.25, volume: 0.15, stability: 0.2 },
  CONFIDENCE_THRESHOLD: 0.5,
};
