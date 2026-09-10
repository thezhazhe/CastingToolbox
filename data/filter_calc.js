// ============================================================
// 过滤网标准（企业 Excel「过滤网标准」sheet，C 级企业经验数据）
// PHASE 28.3-D：只进产品过流量/适用材料，价格等成本数据不引入（39.txt §八）
// 备注：莫来石灰铁列 = ——（企业无灰铁用莫来石标准）；碳化硅 100×100 为泡沫/直孔双层搭接
// 来源：工艺设计说明书-V3.2.2-2.xlsx 过滤网标准 R18-26
// ============================================================

/** 过滤网规格库：htCapacity/qtCapacity = 灰铁/球铁 过流量标准 kg */
export const FILTER_SPECS = [
  { id: 'sic_100',   type: '碳化硅', model: '100×100×20',    htCapacity: 400,  qtCapacity: 200 },
  { id: 'sic_120',   type: '碳化硅', model: '120×120×22',    htCapacity: 600,  qtCapacity: 300 },
  { id: 'sic_150',   type: '碳化硅', model: '150×150×40',    htCapacity: 1200, qtCapacity: 750 },
  { id: 'foam_150',  type: '双层',   model: '泡沫150×150×22+直孔150×150×22', htCapacity: 1200, qtCapacity: 750 },
  { id: 'zro2_100',  type: '氧化锆', model: '100×100×22',    htCapacity: 800,  qtCapacity: 500 },
  { id: 'zro2_125a', type: '氧化锆', model: '125×125×25',    htCapacity: 1200, qtCapacity: 750 },
  { id: 'zro2_125b', type: '氧化锆', model: '125×125×30',    htCapacity: 1200, qtCapacity: 750 },
  { id: 'mul_125',   type: '莫来石', model: '125×125×30',    htCapacity: null, qtCapacity: 1200 },  // 灰铁不适用（企业无标准）
  { id: 'mul_150',   type: '莫来石', model: '150×150×30',    htCapacity: null, qtCapacity: 2200 },
];

/** 材料大类 → 过滤网适用列（企业标准仅覆盖灰铁/球铁） */
export function filterCapacityOf(family) {
  return { 灰铁: 'htCapacity', 球铁: 'qtCapacity' }[family] || null;
}
