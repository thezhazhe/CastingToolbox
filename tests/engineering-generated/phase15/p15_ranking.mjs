// ============================================================
// PHASE 15-F：工程热结排序测试（命令 15.txt 七——最重要）
// 对 6 类模型输出 Top1/2/3 并回答：
//   1. 最大热结是不是第一名？
//   2. 第二热结是否合理？
//   3. 差 <10% 的热结是否值得区分？
// 数据源：tests/engineering-generated/result.json（14.txt 结果，已含 expected 对照）
// 用法: node tests/engineering-generated/phase15/p15_ranking.mjs
// ============================================================
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { HERE, DATA_DIR } from './p15_common.mjs';

const MODELS_DIR = join(HERE, '..', 'models');
// 15.txt 七的 6 类 + 各自补充模型
const RANK_GROUPS = [
  { label: '厚块+薄壁', models: ['t09_boxInner80', 't20_combinedBox'] },
  { label: '板+Boss', models: ['t01_boss100', 't02_thin10_boss60'] },
  { label: '法兰', models: ['t08_pipeFlange70'] },
  { label: '多Boss', models: ['t05_threeSizes', 't18_multiSizeBoss'] },
  { label: '厚薄过渡', models: ['t14_taperSeries', 't15_weakRamp'] },
  { label: '阶梯厚度', models: ['t06_taperStairs', 't03_twoDiff_60_100', 't04_twoSame_60_60'] },
];

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const groups = [];
  console.log('PHASE 15-F 工程热结排序\n');
  for (const g of RANK_GROUPS) {
    const models = [];
    for (const name of g.models) {
      const res = JSON.parse(readFileSync(join(MODELS_DIR, name, 'result.json'), 'utf8'));
      const exps = res.v3?.hotspots || [];
      const expRanks = (JSON.parse(readFileSync(join(MODELS_DIR, name, 'expected.json'), 'utf8')).expectedHotspots || [])
        .map(e => ({ id: e.thickZoneId, rank: e.rank, pos: e.positionMm }));
      const top = exps.slice(0, 3).map((h, i) => ({
        rank: i + 1, M: +h.peakModulus.toFixed(2), pos: h.position.map(v => +v.toFixed(0)),
        conf: +h.confidence.toFixed(2), src: h.geometrySource,
      }));
      // 匹配 top1 到哪个 expected 厚区
      const c = res.checks;
      const topMatch = c?.matched?.[0];
      // M 间隙（Top1-Top2, Top2-Top3）
      const gaps = [];
      for (let i = 1; i < exps.length; i++) gaps.push(+((exps[i - 1].peakModulus - exps[i].peakModulus) / exps[i - 1].peakModulus).toFixed(3));
      models.push({
        name, status: res.v3.status,
        top, gaps, expected: expRanks,
        top1IsExpected1: topMatch ? topMatch.expectedId === 'rank1' || expRanks.find(e => e.rank === 1)?.id === topMatch.expectedId : null,
        top1MatchedId: topMatch?.expectedId ?? null,
        rankingOk: c?.rankingOk ?? null,
        missed: c?.missed ?? [], fp: c?.falsePositives?.length ?? 0,
      });
      console.log(`${name.padEnd(18)} Top1=${models[models.length - 1].top[0]?.M}(${models[models.length - 1].top1MatchedId}) Top2=${models[models.length - 1].top[1]?.M} Top3=${models[models.length - 1].top[2]?.M ?? '-'}  gap=${gaps.join('/')}`);
    }
    groups.push({ label: g.label, models });
  }
  writeFileSync(join(DATA_DIR, 'ranking.json'), JSON.stringify(groups, null, 2));
  console.log(`\n→ ${join(DATA_DIR, 'ranking.json')}`);
}
main().catch(e => { console.error(e); process.exit(1); });
