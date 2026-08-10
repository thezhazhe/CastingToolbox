// ============================================================
// 缺陷查找 · 数据层（纯数据 · 只改这里，不碰代码）
//
// 分类沿用 GB/T 5611《铸造术语》八大类（个别按使用习惯微调）；
// 每条缺陷的对策正文在 data/defects/*.json（症状/原因/预防/检验），
// 此处只提供"分类"与"别名"两张检索表：
//   DEFECT_CATEGORIES  → 工具顶部分类（含图标与说明）
//   CATEGORY_OF        → 缺陷 id → 大类（每类可多缺陷）
//   DEFECT_ALIASES     → 缺陷名 / 俗称 / 症状关键词 → 缺陷 id（诊断入口）
//
// 以后加新缺陷：
//   1. data/defects/ 下加 JSON（症状/原因/预防）
//   2. 在 data/index.js 登记 → data/taxonomy.js 挂树 → data/tags.js 补标签
//   3. 在下面 CATEGORY_OF 指定大类 + DEFECT_ALIASES 补检索词
// ============================================================

export const DEFECT_CATEGORIES = [
  { id: 'hole',      name: '孔洞类',       icon: '🕳️', desc: '气孔 · 针孔 · 缩孔缩松 · 渗漏 · 呛火' },
  { id: 'crack',     name: '裂纹冷隔类',   icon: '⚡', desc: '热裂 · 冷裂 · 白点 · 冷隔 · 重皮' },
  { id: 'surface',   name: '表面缺陷',     icon: '🧱', desc: '粘砂 · 夹砂结疤 · 皱皮 · 缩陷' },
  { id: 'inclusion', name: '夹杂类',       icon: '🪨', desc: '夹渣 · 砂眼 · 冷豆 · 硬点' },
  { id: 'shape',     name: '形状重量类',   icon: '📐', desc: '变形 · 错箱 · 偏芯 · 尺寸超差' },
  { id: 'residue',   name: '残缺类',       icon: '🧩', desc: '浇不足 · 跑火 · 未浇满' },
  { id: 'extra',     name: '多肉类',       icon: '🌶️', desc: '飞翅 · 毛刺 · 冲砂 · 胀砂 · 抬箱' },
  { id: 'metal',     name: '金相成分组织', icon: '🔬', desc: '白口 · 石墨漂浮 · 球化不良 · 偏析 · 石墨粗大' },
];

/** 缺陷 id → 大类（对照 GB/T 5611，缩陷等按使用习惯归入孔洞类便于检索） */
export const CATEGORY_OF = {
  // 孔洞类
  air_hole: 'hole', pinhole: 'hole', blowback: 'hole', leakage: 'hole',
  shrinkage_defect: 'hole', surface_sink: 'hole',
  // 裂纹冷隔类
  hot_crack: 'crack', cold_crack: 'crack', cold_shut: 'crack', flakes: 'crack',
  // 表面缺陷
  burning_on: 'surface', wrinkle: 'surface',
  // 夹杂类
  sand_inclusion: 'inclusion', slag_inclusion: 'inclusion', cold_shot: 'inclusion',
  // 形状重量类
  distortion: 'shape', core_shift: 'shape', parting_shift: 'shape',
  // 残缺类
  misrun: 'residue', runout: 'residue',
  // 多肉类
  swell: 'extra', flash: 'extra', sand_wash: 'extra', mould_lift: 'extra',
  // 金相成分组织
  nodularity_failure: 'metal', white_iron: 'metal', graphite_flotation: 'metal',
  segregation: 'metal', graphite_coarse: 'metal', inverse_chill: 'metal',
};

export function categoryOf(id) { return CATEGORY_OF[id] || ''; }

/** 缺陷名 / 俗称 / 症状关键词 → 缺陷 id（工具检索的第一入口，可无限补充俗称） */
export const DEFECT_ALIASES = {
  air_hole: ['气孔', '气泡', '皮下气孔', '表面气孔', '析出气孔', '侵入气孔', '反应气孔', '梨形孔', '光滑内壁孔', '气体'],
  pinhole: ['针孔', '芝麻孔', '密集小孔', '麻点', '吸气', '氢针孔', '析出性气孔'],
  blowback: ['呛火', '喷火', '气爆', '放炮', '浇注喷溅', '气体喷出'],
  leakage: ['渗漏', '漏水', '漏气', '气密不足', '承压渗漏', '水压试验不合格'],
  shrinkage_defect: ['缩孔', '缩松', '疏松', '内缩孔', '收缩', '热节孔洞', '冒口下缩孔', '补缩不足'],
  surface_sink: ['缩陷', '表面凹陷', '凹坑', '缩凹', '局部凹陷'],
  hot_crack: ['热裂', '裂纹', '撕裂', '高温裂纹', '缩裂', '铸件开裂'],
  cold_crack: ['冷裂', '裂缝', '低温裂纹', '内应力裂纹', '脆断', '淬火裂纹'],
  flakes: ['白点', '发裂', '氢脆', '内裂纹', '银白亮点', '发纹', '氢裂纹'],
  cold_shut: ['冷隔', '接缝', '重皮', '搭接缝', '两层皮', '未熔合', '氧化膜夹层'],
  burning_on: ['粘砂', '烧结', '机械粘砂', '化学粘砂', '铸件粘砂', '表面粗糙'],
  wrinkle: ['皱皮', '起皱', '皱褶', '球铁皱皮', '表面皱皮', '桔皮'],
  sand_inclusion: ['砂眼', '夹砂', '掉砂', '砂子', '型砂夹入', '砂粒', '夹砂结疤'],
  slag_inclusion: ['夹渣', '渣孔', '黑渣', '熔渣', '渣眼', '氧化渣', '渣夹入'],
  cold_shot: ['冷豆', '铁豆', '溅豆', '金属豆', '表面小珠', '豆状金属'],
  distortion: ['变形', '翘曲', '扭曲', '弯曲', '歪曲', '尺寸变形', '挠曲'],
  core_shift: ['偏芯', '漂芯', '芯子偏移', '芯移位', '壁厚不均'],
  parting_shift: ['错箱', '错型', '错位', '错边', '合箱错位', '上下箱错位', '分型面错位'],
  swell: ['胀砂', '涨砂', '砂型膨胀', '局部胀大', '砂箱鼓胀'],
  flash: ['飞翅', '飞边', '毛刺', '披缝', '披锋', '分型面飞边', '铸件毛边'],
  sand_wash: ['冲砂', '冲刷', '冲蚀', '浇口冲刷', '砂被冲走', '内浇道冲砂'],
  mould_lift: ['抬箱', '抬型', '上箱抬起', '胀箱', '上浮', '浮箱'],
  misrun: ['浇不足', '缺肉', '欠注', '未浇满', '轮廓不完整', '浇不满', '充型不足'],
  runout: ['跑火', '漏箱', '漏液', '漏铁', '金属液流失', '分型面漏'],
  nodularity_failure: ['球化不良', '球化衰退', '球化失败', '灰口', '球化率低', '片状石墨'],
  white_iron: ['白口', '硬点', '局部白口', '碳化物', '渗碳体', '硬点缺陷'],
  inverse_chill: ['反白口', '中心白口', '内层白口', '白口层'],
  graphite_flotation: ['石墨漂浮', '石墨上浮', '厚大石墨', '漂浮石墨', '上部黑斑'],
  graphite_coarse: ['石墨粗大', '粗大石墨', '石墨片粗', '石墨等级差', '断口粗'],
  segregation: ['偏析', '成分不均', '比重偏析', '宏观偏析', '中心偏析', '锡偏析'],
};
