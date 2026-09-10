// ============================================================
// 生产场景建议数据（纯数据层 · 只改这里，不碰代码）
//
// 以后加新信息：
//   1. 新增/调整某材质族的建议 → 改 SCENARIOS[材质族] 的字段
//   2. 新增一个维度值（如新造型线）→ 在 LINES/PRODS/METHODS 加键
//   3. 新增材质族 → 先在 js/context.js 的 FAMILIES 加，再在此加同键条目
//
// 字段说明：
//   defDoc    代表牌号文档 id（向导预选 / 参数速查卡取数用，须在 data/materials/）
//   reason    给用户看的"为什么"，一句话讲清该材质工艺要点
//   tips      操作要点（逐条）
//   defects   常见缺陷文档 id（须在 data/defects/；卡片会从这取标题/对策）
//   standards 相关标准（展示文本；后续若有对应文档可换成 {id,text}）
//
//   LINES/PRODS/METHODS 里 tips/defects 为可选"增强"：场景设了该维度时叠加，
//   与材质族去重合并。空数组表示该维度无额外建议。
// ============================================================

export const SCENARIOS = {
  灰铁: {
    defDoc: 'HT200',
    reason: '灰铁近共晶凝固，石墨化膨胀可补偿大部凝固收缩，缩孔缩松倾向低；主要风险在气孔、夹渣、砂眼与白口化。',
    tips: [
      '浇注温度控制 1320~1390℃，偏高易气孔、偏低易冷隔与白口',
      '孕育处理细化石墨防石墨粗大；碳当量 3.8~4.2，过高易缩松',
      '壁厚悬殊件注意均衡凝固与冷铁，复杂薄壁件保证平稳充型',
    ],
    defects: ['air_hole', 'sand_inclusion', 'slag_inclusion', 'white_iron', 'swell'],
    standards: ['GB/T 9439 灰铸铁件', 'GB/T 42124.3-2025 铸件尺寸公差与加工余量（原 GB/T 6414）'],
  },

  球铁: {
    defDoc: 'QT450',
    reason: '球铁糊状凝固 + 石墨化膨胀，缩松风险高于灰铁，需冒口补缩与石墨化膨胀双保障；球化不良/衰退易夹渣、石墨漂浮。',
    tips: [
      '球化处理控制残余镁：过度球化易缩松，球化衰退易夹渣',
      '薄壁复杂件加强孕育；厚大件注意石墨漂浮',
      '冒口补缩 + 石墨化膨胀双保障，配合冷铁引导顺序凝固',
    ],
    defects: ['shrinkage_defect', 'slag_inclusion', 'graphite_flotation', 'nodularity_failure', 'air_hole'],
    standards: ['GB/T 1348 球墨铸铁件', 'GB/T 42124.3-2025 铸件尺寸公差与加工余量（原 GB/T 6414）'],
  },

  铸钢: {
    defDoc: 'ZG270-500',
    reason: '铸钢逐层凝固、收缩集中，集中缩孔与热裂倾向大；浇注温度高，对型砂水分与排气要求严。',
    tips: [
      '充分补缩：冒口 + 冷铁顺序凝固，冒口尺寸按模数校核',
      '浇注温度 1530~1590℃，控制型砂水分、加强排气',
      '易热裂，注意铸造圆角、减少内应力与热节集中',
    ],
    defects: ['shrinkage_defect', 'hot_crack', 'cold_crack', 'sand_inclusion', 'segregation'],
    standards: ['GB/T 11352 一般工程用铸造碳钢件', 'GB/T 42124.3-2025 铸件尺寸公差与加工余量（原 GB/T 6414）'],
  },

  铝合金: {
    defDoc: 'ZL101',
    reason: '铝合金糊状凝固、缩松倾向中等，且易吸氢产生针孔；需除气精炼 + 冒口冷铁配合补缩。',
    tips: [
      '浇注前除气精炼防针孔（氢）；浇温 690~740℃',
      '厚壁处冒口 + 冷铁配合，防缩松',
      '常用 T6 固溶+时效热处理获得最佳力学性能',
    ],
    defects: ['pinhole', 'shrinkage_defect', 'hot_crack', 'cold_shut', 'air_hole'],
    standards: ['GB/T 1173 铸造铝合金', 'GB/T 42124.3-2025 铸件尺寸公差与加工余量（原 GB/T 6414）'],
  },

  铜合金: {
    defDoc: 'ZCuSn10Pb1',
    reason: '铜合金凝固范围宽、糊状凝固，缩松倾向大；易氧化吸气，浇注温度不宜过高。',
    tips: [
      '收缩大，需充分补缩，常加冷铁',
      '浇温 1100~1200℃ 为宜：过高氧化吸气，过低冷隔',
      '耐磨/耐蚀/气密件注意补缩与致密度',
    ],
    defects: ['shrinkage_defect', 'air_hole', 'leakage', 'segregation'],
    standards: ['GB/T 1176 铸造铜合金', 'GB/T 42124.3-2025 铸件尺寸公差与加工余量（原 GB/T 6414）'],
  },
};

/* 造型线维度（可选增强） */
export const LINES = {
  垂直线: {
    tips: ['高速高压造型、充型快，注意砂眼、呛火与封闭式浇注系统'],
    defects: ['sand_inclusion', 'blowback'],
  },
  水平线: {
    tips: ['充型较平缓，注意型砂紧实度均匀与浇注系统比例'],
    defects: ['swell', 'sand_inclusion'],
  },
};

/* 生产方式维度（可选增强） */
export const PRODS = {
  自动线: {
    tips: ['大批量生产，参数取稳定中心值，关注节拍与砂温'],
    defects: [],
  },
  手工线: {
    tips: ['紧实度波动大，注意春砂均匀与透气'],
    defects: ['sand_inclusion'],
  },
};

/* 铸造方法维度（可选增强） */
export const METHODS = {
  砂型: {
    tips: ['注意型砂水分/透气/紧实度与排气'],
    defects: ['sand_inclusion', 'blowback'],
  },
  金属型: {
    tips: ['冷却快、组织致密，注意涂料与排气'],
    defects: ['cold_shut', 'air_hole'],
  },
  '3D打印': {
    tips: ['吃砂量/最小壁厚按砂型打印规范，注意吊运与出气'],
    defects: [],
  },
};
