// ============================================================
// Hotspot Engine 参数配置（V2.1 单文件集中）
// 所有阈值/工程参数只允许在这里修改——算法代码不写死任何数值。
// 未来用真实铸件数据校准：改这里即可，零算法改动。
// 设计依据：docs/HOTSPOT_ENGINE_V2.md（V2.1 冻结稿）
// ============================================================
import { DISTANCE_DEFAULTS } from './distanceField.js';

export const HOTSPOT_DEFAULTS = {
  ...DISTANCE_DEFAULTS,

  /* ---- ① Coarse Scan（全局粗扫，复用 buildDistanceField） ---- */
  // resolution / maxResolution / minWallLayers 继承 DISTANCE_DEFAULTS

  /* ---- ② Candidate Detection ----
     注意（V2.1 实施修正）：相对显著性由 PVP 谷深比承担（峰 vs 相邻真实谷——
     均匀平坦区的数值噪声峰相邻谷极浅 → 合并），因此候选层不再依赖全局统计基准
     （median/mode 对实心块都不可靠：近表面体积占比大，峰值落在表面层）。
     候选层门槛只做绝对下限，过滤极弱噪声。 */
  CANDIDATE_FLOOR: 0.1,           // 候选绝对下限：peak ≥ maxScore × 此值
  CANDIDATE_FLOOR_LOW: 0.06,      // uniform 判据低门槛（V2.3）：raw localMaxima 过滤下限——
                                  //   只用于"region 外局部极大"计数，不进主候选流程（零性能影响）。
                                  //   目的：厚区+薄区结构（居中大厚圆柱+周边薄壳）的薄区中面是
                                  //   局部极大（距表面半厚），但 < 0.1×maxS 被候选层滤掉 → 质心偏移
                                  //   信号对对称厚区失效（偏移≈0）→ 需要薄区存在性信号。
                                  //   均匀件（cube/plate/cylinder）梯度区无局部极大 → 天然免疫；
                                  //   均匀管中面圈局部极大但比值 top/中面 < 1.05（实测 1.02）不触发。
  PEAK_SEPARATION_RATIO: 1.05,    // 均匀件判据：top2 候选比值 < 此值 → 模型无相对结构
                                  //   （均匀实心/均匀薄壁的候选全是数值噪声，比值≈1.0）
                                  //   → NO_HOTSPOT（"热结=相对厚区"，均匀件无相对）
  candidateNMS: 2,                // 非极大抑制邻域（体素）
  growRatio: 0.4,                 // Region BFS 生长阈值：峰值 × 此比例

  /* ---- ③ Local Refinement ---- */
  TARGET_VOXELS_ACROSS_THICKNESS: 6,  // 壁厚目标体素层数（默认工程参数，可调）
  MIN_VOXEL_SIZE: 0.5,                // vs_refine 下限（mm）
  MAX_REFINEMENT_POINTS: 150000,      // 单区域细化采样点上限（超限 → 该区域降级 LOW_CONFIDENCE）
  MAX_REFINEMENT_REGIONS: 5,          // 细化区域数上限（超限 → 后续候选降级）
  refinePaddingVoxels: 2,             // 区域 bbox 外扩（粗扫体素数）
  UNIFORM_CHECK_LIMIT: 100,           // 均匀件判据：最多检查的远距候选数（噪声峰同平台跳过不计数…上限防慢）
  UNIFORM_VALLEY_RATIO: 0.05,         // 均匀件判据的谷深阈值：两峰谷深 < 此值 → 同平台噪声/无第二结构
                                      //   （0.05~0.15 的弱谷 = 融合结构（如相交球），PVP 合并报 1 个，放行）
  REGION_THICKNESS_RATIO: 2.0,        // 均匀件判据的 Region 厚度比阈值（V2.2 PHASE 4 信号 e）：
                                      //   regionMean / modelMean（与质心偏移 AND 组合触发）。
                                      //   实测：板+凸台 res96 = 3.18；均匀 cube = 2.12 / cylinder = 2.03
                                      //   （均匀实心中心区比值天然 ~2 → 必须与质心偏移组合）；tube = 1.42。
  REGION_CENTROID_OFFSET_RATIO: 0.025, // 均匀件判据的 Region 质心偏移阈值（V2.2 PHASE 4 信号 f）：
                                      //   |region 质心 − 模型质心| / mdim ≥ 此值 → region 是非对称突变结构
                                      //   （凸台/厚端），非均匀实心中心区（对称 → 偏移≈0）。
                                      //   实测：板+凸台 res96 = 0.044 ✓；cube/cylinder/plate/tube = 0。
                                      //   已知局限：矮凸台（<30mm 高）在薄板上偏移 < 0.025 → 高分辨率
                                      //   下可能 uniform 漏检（依赖侧壁候选比值 a) 在 res48 检出）。
  REPRESENTATIVE_MIN_CELLS: 8,        // 峰可信度（V2.3）：0.9×peak 连通域格数 < 此值 → MC 伪厚尖峰
                                      //   （管/环过渡带斜切叠厚，峰虚高：C 法兰峰 19 vs 环段真厚 15）
                                      //   → 用 0.8×peak 域（覆盖真实厚区核心）；真峰（平台/柱顶）
                                      //   保持 0.95×peak 域（V2.2 精度，PVP 弱谷不跨谷）。
                                      //   0.9 域计数与主 BFS 同源（同连通域 6 邻域），零额外成本。
  REGION_COVERAGE_RATIO: 0.85,        // 均匀件判据的 Region 覆盖率（记录用，不参与判据）：top region 覆盖
                                      //   inside 点比例（薄板+凸台 = 0.17；均匀件 0.5-1.0）。

  /* ---- ④ Hotspot Evaluation ----
     注意（V2.1 实施修正）：prominence 分项 = 峰相对全局最大值的显著度（0~1）。
     MIN_PROMINENCE_RATIO 重新定义为最终热结的 prominence 分项门槛——
     低于此值的弱峰（薄区/台阶噪声，如两厚区之间 5mm 槽壁 dist≈4.5 vs 主热结 28）
     置信度再高也不进最终热结（降级 LOW_CONFIDENCE，可解释）。 */
  MIN_PROMINENCE_RATIO: 0.4,
  valleyDepthRatio: 0.15,         // PVP 谷深比：≥ 阈值 → 分裂为两个热结；< → 合并为一个 Region
                                  //   = (min(peakA,peakB) − valley) / min(peakA,peakB)
                                  // 仅作用于同一细化 Region 内多峰；不同 Region 永不合并（V2.1 冻结）
  minPeakGap: 2,                  // 区域内峰间距下限（体素，低于 → 视为同一峰）
  minRegionVolumeMm3: 3000,       // 区域最小绝对体积（mm³，跨分辨率稳定；旧 minRegionVoxels 语义替代）
  confWeights: { resolution: 0.4, prominence: 0.4, validation: 0.2 },  // 三因子权重
  CONFIDENCE_THRESHOLD: 0.5,      // 最终热结置信度门槛

  /* ---- ⑤ 输出 ---- */
  maxHotspots: 5,
};
