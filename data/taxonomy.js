// ============================================================
// 知识库分类树（组织层）
// 说明：数据（data/*/ 的 JSON）一字不动，此文件只是"书架标签"。
//  - 节点递归：主题 → 分支/分组 → 条目
//  - items   = 主位置（一个 id 在整棵树中必须恰好出现一次，校验保证）
//  - links   = 双显位置（条目同时挂在别的分组下，方便"哪里都能查到"）
// 新增 JSON 后：在 data/index.js 登记 → 在树上挂节点（校验保证不丢不重）
// ============================================================

export const TAXONOMY = [
  {
    id: 'materials',
    name: '铸造材料',
    icon: '🧪',
    desc: '常用铸造材料牌号 · 成分 · 力学性能 · 浇注参数',
    children: [
      { name: '灰铸铁', items: ['HT150', 'HT200', 'HT250'] },
      { name: '球墨铸铁', items: ['QT400-18', 'QT450', 'QT500-7', 'QT600-3', 'QT700-2'] },
      { name: '蠕墨·可锻铸铁', items: ['RuT380', 'KTH350-10'] },
      { name: '铸钢', items: ['ZG230-450', 'ZG270-500', 'ZG310-570', 'ZG340-640'] },
      { name: '铝合金', items: ['ZL101', 'ZL102', 'ZL104', 'ZL105', 'ZL111', 'ZL201'] },
      { name: '铜合金', items: ['ZCuSn10Pb1', 'ZCuAl10Fe3'] },
      { name: '国内外牌号对照', items: ['cross_ref_cast_iron', 'cross_ref_steel_nonferrous'] },
      { name: '结构工艺性', items: ['castability_min_wall', 'castability_design'] },
    ],
  },
  {
    id: 'rawmaterials',
    name: '熔炼原辅材料',
    icon: '🧱',
    desc: '金属炉料 · 合金 · 孕育球化 · 辅助材料，入厂验收技术要求',
    children: [
      { name: '金属炉料', items: ['pig_iron_ht', 'pig_iron_ductile', 'steel_scrap'] },
      { name: '合金', items: ['ferromanganese', 'ferrosilicon', 'ferrophosphorus', 'ferrochromium', 'ferromolybdenum', 'trace_metals'] },
      { name: '处理剂', items: ['inoculant', 'spheroidizer', 'feed_wire', 'carburizer', 'silicon_carbide', 'ferrous_sulfide'] },
      { name: '辅助材料', items: ['resin_binder', 'coating_material', 'ceramic_filter', 'fluxing_agents', 'shot_blasting_media'] },
    ],
  },
  {
    id: 'sand',
    name: '型砂与造型',
    icon: '⏳',
    desc: '型砂原材料 · 配方 · 湿型砂质量控制（各类造型线通用）',
    children: [
      { name: '原砂', items: ['molding_sand'] },
      { name: '粘结剂与添加剂', items: ['bentonite', 'coal_powder', 'mixed_clay', 'coated_sand'] },
      { name: '配方与控制', items: ['sand_recipe', 'green_sand_control'] },
      { name: '相关 · DISA 垂直造型线', links: ['disa_sand_compactability', 'disa_sand_composition', 'disa_sand_raw', 'disa_sand_reclaim', 'disa_sand_test'] },
    ],
  },
  {
    id: 'process',
    name: '铸造工艺与配料',
    icon: '🌡️',
    desc: '熔炼配料案例 · 浇注系统 · 冒口补缩 · 凝固收缩 · 球化孕育 · 后处理',
    children: [
      { name: '熔炼配料案例', items: ['melting_charge', 'charge_HT200_cylinder', 'charge_HT_structural', 'charge_QT450', 'charge_QT500_brake', 'charge_QT550_cu', 'charge_mosi_FCD50', 'charge_mosi_pipe', 'charge_QT600_caliper'] },
      { name: '浇注系统', items: ['gating_ratio', 'pouring_time', 'vertical_gating_design', 'yield_ranges'] },
      { name: '冒口与补缩', items: ['riser_efficiency', 'riser_neck', 'feeding_distance', 'chill_use'] },
      { name: '凝固与收缩', items: ['solidification_mode', 'shrinkage_table', 'density_table'] },
      { name: '球化孕育处理', items: ['spheroidization', 'inoculation', 'modification'] },
      { name: '后处理与尺寸', items: ['heat_treatment', 'machining_grade', 'pattern_allowance', 'ct_tolerance', 'shakeout_cleaning', 'shot_blasting', 'riser_removal_welding'] },
      { name: '热处理规范', items: ['heat_treatment_cast_iron', 'heat_treatment_cast_steel', 'heat_treatment_aluminum'] },
      { name: '检验与验收', items: ['inspection_dimension', 'inspection_surface', 'inspection_ndt', 'inspection_mechanical', 'inspection_chemical', 'inspection_acceptance'] },
      { name: '其它工艺', items: ['pour_temp', 'coating', 'venting'] },
    ],
  },
  {
    id: 'defects',
    name: '缺陷对策',
    icon: '🩹',
    desc: '常见铸造缺陷 · 现象 / 原因 / 预防（GB/T 5611 八大类，共 30 条）',
    children: [
      { name: '孔洞类', items: ['air_hole', 'pinhole', 'blowback', 'leakage', 'shrinkage_defect', 'surface_sink'] },
      { name: '裂纹冷隔类', items: ['hot_crack', 'cold_crack', 'flakes', 'cold_shut'] },
      { name: '表面缺陷', items: ['burning_on', 'wrinkle'] },
      { name: '夹杂类', items: ['sand_inclusion', 'slag_inclusion', 'cold_shot'] },
      { name: '形状重量类', items: ['distortion', 'core_shift', 'parting_shift'] },
      { name: '残缺类', items: ['misrun', 'runout'] },
      { name: '多肉类', items: ['swell', 'flash', 'sand_wash', 'mould_lift'] },
      { name: '金相成分组织', items: ['nodularity_failure', 'white_iron', 'graphite_flotation', 'graphite_coarse', 'inverse_chill', 'segregation'] },
    ],
  },
  {
    id: 'principles',
    name: '铸造原理',
    icon: '🧭',
    desc: 'Campbell《Complete Casting Handbook》铸造十规则：金属液质量 · 临界速度 · 补缩 · 应力 · 定位（缺陷诊断的底层机理）',
    children: [
      { name: 'Campbell 十规则', items: ['rule_01_melt', 'rule_02_critical_velocity', 'rule_03_laminar', 'rule_04_bubble', 'rule_05_core_blow', 'rule_06_shrinkage', 'rule_07_convection', 'rule_08_segregation', 'rule_09_residual_stress', 'rule_10_location'] },
    ],
  },
  {
    id: 'equipment',
    name: '设备',
    icon: '🖨️',
    desc: '3D 砂型打印 · DISA 垂直造型线，工艺参数 / 质量 / 故障 / 保养',
    children: [
      { name: '3D 砂型打印', children: [
        { name: '工艺参数', items: ['sand_3dp_params', 'sand_3dp_al_spec'] },
        { name: '质量缺陷', items: ['sand_3dp_quality_layer', 'sand_3dp_quality_strength', 'sand_3dp_quality_dimension', 'sand_3dp_quality_surface', 'sand_3dp_quality_gas'] },
        { name: '故障排查', items: ['sand_3dp_spreader', 'sand_3dp_mixer', 'sand_3dp_printhead', 'sand_3dp_drive_fault', 'sand_3dp_lifting', 'sand_3dp_power'] },
        { name: '回收与保养', items: ['sand_3dp_recycling', 'sand_3dp_maintenance'] },
      ]},
      { name: 'DISA 垂直造型线', children: [
        { name: '概述', items: ['disa_overview'] },
        { name: '型砂要求', items: ['disa_sand_compactability', 'disa_sand_composition', 'disa_sand_raw', 'disa_sand_reclaim', 'disa_sand_test'] },
        { name: '造型工艺', items: ['disa_moulding_params'] },
        { name: '模型与砂芯', items: ['disa_pattern', 'disa_cores'] },
        { name: '浇注系统', items: ['disa_gating_systems', 'disa_gating_formula', 'disa_gating_cup'] },
        { name: '补缩浇注', items: ['disa_pouring_feeding'] },
        { name: '缺陷对策', items: ['disa_defects_scabbing'] },
        { name: '相关 · 通用型砂控制', links: ['green_sand_control'] },
      ]},
    ],
  },
];

// 扁平化辅助：收集所有主位置条目（去重检查用）
export function taxonomyPrimaryIds() {
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.items) out.push(...n.items);
      if (n.children) walk(n.children);
    }
  };
  walk(TAXONOMY);
  return out;
}

// 扁平化辅助：收集所有 links 条目
export function taxonomyLinkIds() {
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.links) out.push(...n.links);
      if (n.children) walk(n.children);
    }
  };
  walk(TAXONOMY);
  return out;
}

// 某条目的主题（它主位置所在的主题 id）—— 搜索分组 / 详情徽章用
export function themeOfId(docId) {
  for (const theme of TAXONOMY) {
    let found = false;
    const walk = (nodes) => {
      for (const n of nodes) {
        if (n.items && n.items.includes(docId)) { found = true; return; }
        if (n.children) walk(n.children);
      }
    };
    walk(theme.children);
    if (found) return theme;
  }
  return null;
}
