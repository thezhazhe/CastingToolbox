// ============================================================
// 计算器注册表
// 新增计算器三步：calcs/ 下建模块 → 在此登记 → 完成
// status: 'pending' = 待接入 · 'ready' = 已可用
// ============================================================

export const CALCULATORS = [
  {
    id: 'gating',
    cat: 'pouring',   // PHASE 78 分类
    name: '浇注系统设计',
    icon: '🌊',
    desc: '浇注时间（Dietert）· 阻流截面（奥赞）· 直/横/内浇道 · 排气面积 · 浇注方向判断',
    tags: ['浇注', '浇道', '排气'],
    keywords: ['浇注时间', '阻流面积', '直浇道', '横浇道', '内浇道', '排气', '奥赞', 'Dietert', '充型'],
    next: [
      { icon: '🏗️', label: '冒口设计', kind: 'calc', target: 'riser' },
      { icon: '📊', label: '查看出品率', kind: 'calc', target: 'yield' },
      { icon: '🩹', label: '查缩孔缩松', kind: 'search', target: '缩孔缩松' },
      { icon: '🧭', label: '工艺向导完整方案', kind: 'wizard' },
    ],
    status: 'ready',
  },
  {
    id: 'campbell_gating',
    cat: 'pouring',   // PHASE 78 分类
    name: 'Campbell 浇注系统速算',
    icon: '🌿',
    desc: '极简输入（材料/重量/壁厚/内浇口数）→ Campbell 1:1:n 基础方案：浇注时间 · 质量流 · 内浇口面积 · 直浇道/横浇道 1:1 · 速度证据分级标注',
    tags: ['浇注', 'Campbell', '方法实验室', 'ENGINEERING_REFERENCE'],
    keywords: ['Campbell', '浇注系统', '自然加压', '1:1:n', '内浇口', '质量流率', '0.5 m/s', '1000', '500', 'mm²/(kg/s)', '速算', '连续节流'],
    next: [
      { icon: '📖', label: '查 Campbell 知识', kind: 'search', target: 'Campbell' },
      { icon: '🩹', label: '查卷吸/气孔缺陷', kind: 'search', target: '卷吸' },
    ],
    status: 'ready',
    method: 'Campbell Gating · 独立方法（与现行浇注系统计算器互不混用）',
  },
  {
    id: 'vertical_gating',
    cat: 'pouring',   // PHASE 78 分类
    name: '垂直造型线小件浇注系统',
    icon: '🏭',
    desc: 'DISA 手册方法 · 加压/减压/不加压/混合四种系统 · 多层铸型各层按自身有效静压头分别计算内浇口 · 逐段流道 · 分层输出',
    tags: ['浇注', '垂直造型', 'DISA', '多层', 'ENGINEERING_REFERENCE'],
    keywords: ['垂直造型', 'DISA', '加压式', '减压式', '不加压式', '混合式', '静压头', '内浇口', '浇注系统', '竖型串', '多层铸型', '浇口杯', '有效静压头', '分层'],
    next: [
      { icon: '🌊', label: '通用浇注系统计算器（对照）', kind: 'calc', target: 'gating' },
      { icon: '📊', label: '查看出品率', kind: 'calc', target: 'yield' },
      { icon: '🩹', label: '查冷隔/浇不足', kind: 'search', target: '冷隔' },
      { icon: '🩹', label: '查砂眼/夹渣', kind: 'search', target: '夹渣' },
    ],
    status: 'ready',
    method: 'DISA 230 Application Manual（补缩和浇注 6.8~6.12）· 独立方法（与现行浇注系统计算器互不混用）',
  },
  {
    id: 'riser',
    cat: 'feed',   // PHASE 78 分类
    name: '冒口设计',
    icon: '🏗️',
    desc: '热节模数 Mc · 冒口形状/补缩效率 · 冒口尺寸 · 冒口颈 · 模数校验',
    tags: ['冒口', '补缩', '模数'],
    keywords: ['冒口', '热节', '模数', '补缩', '冒口颈', '缩孔', '缩松'],
    next: [
      { icon: '🌊', label: '计算浇道', kind: 'calc', target: 'gating' },
      { icon: '📊', label: '查看出品率', kind: 'calc', target: 'yield' },
      { icon: '🩹', label: '查缩松', kind: 'search', target: '缩松' },
      { icon: '🧭', label: '工艺向导完整方案', kind: 'wizard' },
    ],
    status: 'ready',
  },
  {
    id: 'shrinkage',
    cat: 'dim',   // PHASE 78 分类
    name: '线收缩率',
    icon: '📏',
    desc: '按方向推荐收缩率 · 最大方向取上限 · 方向悬殊自动提示分开放缩水',
    tags: ['收缩', '模具', '放尺'],
    keywords: ['收缩率', '放尺', '缩尺', '模具尺寸', '线收缩', '受阻'],
    next: [
      { icon: '🛠️', label: '加工余量', kind: 'calc', target: 'machining' },
      { icon: '🏗️', label: '冒口设计', kind: 'calc', target: 'riser' },
      { icon: '🏰', label: '结构工艺性', kind: 'calc', target: 'castability' },
    ],
    status: 'ready',
  },
  {
    id: 'machining',
    cat: 'dim',   // PHASE 78 分类
    name: '加工余量',
    icon: '🛠️',
    desc: '方法×材质 → 余量范围（等级自动，不选等级）· 顶面/底面分级 · GB/T 6414',
    tags: ['加工', 'GB/T 6414', 'RMA'],
    keywords: ['加工余量', 'GB/T 6414', '公差等级', 'RMA', '机械加工', '顶面'],
    next: [
      { icon: '📏', label: '线收缩率', kind: 'calc', target: 'shrinkage' },
      { icon: '🏰', label: '结构工艺性', kind: 'calc', target: 'castability' },
    ],
    status: 'ready',
  },
  {
    id: 'yield',
    cat: 'melt',   // PHASE 78 分类
    name: '出品率与铁水重量',
    icon: '📊',
    desc: '①预估出品率区间 → ②现场实测出品率 → 单件/一模铁液 · 浇冒口重（铁液按实绩算）',
    tags: ['出品率', '铁水', '重量', '经济性', '工艺'],
    keywords: ['出品率', '利用率', '铁液', '铁水', '重量', '浇注重量', '一模', '浇冒口', '经济', '刹车盘', '垂直线', '配料'],
    next: [
      { icon: '🌊', label: '浇注系统', kind: 'calc', target: 'gating' },
      { icon: '🏗️', label: '冒口设计', kind: 'calc', target: 'riser' },
      { icon: '🧱', label: '查看配料案例', kind: 'search', target: '熔炼配料' },
    ],
    status: 'ready',
  },
  {
    id: 'chill',
    cat: 'feed',   // PHASE 78 分类
    name: '冷铁计算',
    icon: '❄️',
    desc: '外冷铁/内冷铁厚度（系数×热节壁厚）· 失效提醒（>100mm/挂砂层/二分之一原则）· 布置规则',
    tags: ['冷铁', '激冷', '外冷铁', '内冷铁'],
    keywords: ['冷铁', '激冷', '外冷铁', '内冷铁', '隔砂冷铁', '热节', '补缩'],
    next: [
      { icon: '🏗️', label: '冒口设计', kind: 'calc', target: 'riser' },
      { icon: '🩹', label: '查缩松', kind: 'search', target: '缩松' },
    ],
    status: 'ready',
  },
  {
    id: 'sandbox',
    cat: 'structure',   // PHASE 78 分类
    name: '3D砂型吃砂量',
    icon: '📦',
    desc: '埋箱查表 / 裸浇原则 → 吃砂量 · 砂型最小壁厚（3D打印砂型专用，勿套用传统造型）',
    tags: ['3D打印', '砂型', '吃砂量'],
    keywords: ['3D打印', '砂型', '吃砂量', '埋箱', '裸浇', '最小壁厚', '随型', '砂铝比'],
    next: [
      { icon: '🖨️', label: '查3D打印参数', kind: 'search', target: '3D打印' },
    ],
    status: 'ready',
  },
  {
    id: 'castability',
    cat: 'structure',   // PHASE 78 分类
    name: '铸件结构工艺性',
    icon: '🏰',
    desc: '最小壁厚 · 临界壁厚 · 铸造圆角 · 拔模斜度 · 最小铸孔（按材质/尺寸/批量）',
    tags: ['壁厚', '圆角', '斜度', '铸孔'],
    keywords: ['最小壁厚', '壁厚', '临界壁厚', '铸造圆角', '圆角', '拔模斜度', '起模斜度', '最小铸孔', '铸孔', '结构工艺性'],
    next: [
      { icon: '🛠️', label: '加工余量', kind: 'calc', target: 'machining' },
      { icon: '📏', label: '线收缩率', kind: 'calc', target: 'shrinkage' },
      { icon: '📐', label: '尺寸公差 CT', kind: 'calc', target: 'ct' },
    ],
    status: 'ready',
  },
  {
    id: 'principles',
    cat: 'method',   // PHASE 78 分类
    name: '铸造原则 · Campbell 十规则',
    icon: '🧭',
    desc: '金属液质量 → 充型 → 凝固 → 冷却四阶段十规则全景 · 机理/参数/违反后果/检查要点（展示型）',
    tags: ['原则', 'Campbell', '双膜', '充型'],
    keywords: ['铸造原则', '十规则', 'Campbell', '双膜', 'bifilm', '临界速度', '充型', '补缩', '偏析', '残余应力', '定位点', '金属液质量'],
    next: [
      { icon: '🌊', label: '浇注系统设计', kind: 'calc', target: 'gating' },
      { icon: '🏗️', label: '冒口设计', kind: 'calc', target: 'riser' },
      { icon: '⏱️', label: '开箱时间', kind: 'calc', target: 'shakeout' },
      { icon: '🏭', label: '熔炼加料', kind: 'calc', target: 'charge' },
    ],
    status: 'ready',
  },
  {
    id: 'ct',
    cat: 'dim',   // PHASE 78 分类
    name: '尺寸公差 CT 查询',
    icon: '📐',
    desc: 'GB/T 42124.3-2025 尺寸公差 CT/DCTG1~16 · 方法×材质推荐等级 · 基本尺寸查公差（±）· 壁厚粗一级 · 表值经 ISO 8062-3:2023 Table 7 交叉核验',
    tags: ['公差', '尺寸', 'GB/T 42124.3', 'CT'],
    keywords: ['公差', '尺寸公差', 'CT', 'DCTG', 'GB/T 6414', 'GB/T 42124.3', 'CT等级', '铸件公差', '偏差', '壁厚公差'],
    next: [
      { icon: '🛠️', label: '加工余量', kind: 'calc', target: 'machining' },
      { icon: '📏', label: '线收缩率', kind: 'calc', target: 'shrinkage' },
      { icon: '📜', label: '查尺寸公差标准', kind: 'search', target: '尺寸公差' },
    ],
    status: 'ready',
  },
  {
    id: 'defect_finder',
    cat: 'method',   // PHASE 78 分类
    name: '缺陷查找',
    icon: '🩹',
    desc: '按缺陷名/俗称/症状找问题：GB/T 5611 八大类 · 特征 · 原因 · 对策 · 相关标准',
    tags: ['缺陷', '查找', '诊断'],
    keywords: ['缺陷', '查找', '诊断', '气孔', '缩松', '夹渣', '裂纹', '粘砂', '球化不良', '石墨漂浮', '对策', '原因', '症状'],
    next: [
      { icon: '🌊', label: '浇注系统设计', kind: 'calc', target: 'gating' },
      { icon: '🏗️', label: '冒口设计', kind: 'calc', target: 'riser' },
      { icon: '📊', label: '查看出品率', kind: 'calc', target: 'yield' },
    ],
    status: 'ready',
  },
  {
    id: 'charge',
    cat: 'melt',   // PHASE 78 分类
    name: '熔炼加料计算',
    icon: '🏭',
    desc: '选牌号→自动配比（生铁/废钢/回炉料）→改量实时成分平衡→补料建议（吸收率可调）',
    tags: ['配料', '熔炼', '吸收率'],
    keywords: ['配料', '加料', '吸收率', '回收率', '硅铁', '增碳剂', '锰铁', '碳当量', '原铁液', '生铁', '废钢', '回炉料', '球化剂'],
    next: [
      { icon: '📊', label: '出品率与铁水重量', kind: 'calc', target: 'yield' },
      { icon: '🩹', label: '查球化不良/白口', kind: 'search', target: '球化不良' },
      { icon: '🧱', label: '查看配料案例', kind: 'search', target: '熔炼配料' },
    ],
    status: 'ready',
  },
  {
    id: 'shakeout',
    cat: 'feed',   // PHASE 78 分类
    name: '开箱时间',
    icon: '⏱️',
    desc: '材质×重量×壁厚 → 型内冷却时间范围 · 开箱温度目标 · 风险提示（流水线/热时效可调）',
    tags: ['开箱', '打箱', '冷却', '凝固'],
    keywords: ['开箱', '打箱', '冷却时间', '落砂', '打箱温度', '开箱温度', '凝固', '壁厚', '型内冷却'],
    next: [
      { icon: '🩹', label: '查热裂/冷裂', kind: 'search', target: '热裂' },
      { icon: '♨️', label: '查看热处理规范', kind: 'search', target: '热处理' },
      { icon: '⏳', label: '查型砂控制要点', kind: 'search', target: '型砂' },
    ],
    status: 'ready',
  },
];

/** 按 id 取计算器 */
export function getCalculator(id) {
  return CALCULATORS.find(c => c.id === id) || null;
}

/* ============================================================
   PHASE 78（78.txt 十一）：工具分类——按"工艺设计流程中解决的问题"分组，
   不按技术实现分。顺序即铸造工艺设计的自然推进顺序：
   浇注（怎么浇进去）→ 补缩与凝固（怎么不缩）→ 尺寸与加工（留多少量）
   → 结构与成型（能不能做出来）→ 熔炼与经济性（要多少料、出品多少）
   → 方法与诊断（原则与缺陷排查）。
   ============================================================ */
export const CALC_CATEGORIES = [
  { key: 'pouring',   icon: '🌊', name: '浇注系统设计', desc: '浇注时间 · 阻流截面 · 浇道尺寸 · 排气' },
  { key: 'feed',      icon: '🏗️', name: '补缩与凝固控制', desc: '冒口 · 冷铁 · 开箱时间' },
  { key: 'dim',       icon: '📏', name: '尺寸与加工', desc: '线收缩率 · 加工余量 · 尺寸公差' },
  { key: 'structure', icon: '🏰', name: '结构与成型工艺', desc: '结构工艺性 · 3D 砂型吃砂量' },
  { key: 'melt',      icon: '🏭', name: '熔炼与经济性', desc: '熔炼加料 · 出品率与铁水重量' },
  { key: 'method',    icon: '🧭', name: '方法与缺陷诊断', desc: '铸造原则 · 缺陷查找' },
];

/** 分类 → 该类别下的计算器（保持 CALCULATORS 内的声明顺序；空类别自动省略） */
export function calculatorsByCategory(list = CALCULATORS) {
  return CALC_CATEGORIES
    .map(c => ({ ...c, items: list.filter(x => x.cat === c.key) }))
    .filter(c => c.items.length);
}
