// 迁移：给缺失 reliability 的缺陷卡补上（confidence → reliability 映射）
// medium-high → B（多源一致）· medium → C（工程经验）
// 只读不改内容，仅补顶层字段；跑完用 validate_data 校验。
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join('data', 'defects');
let updated = 0;
for (const f of fs.readdirSync(DIR)) {
  if (!f.endsWith('.json')) continue;
  const p = path.join(DIR, f);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (j.reliability) continue;
  const map = { high: 'A', 'medium-high': 'B', medium: 'C' };
  const rel = map[j.confidence];
  if (!rel) { console.log(`skip ${f}: confidence=${j.confidence}`); continue; }
  j.reliability = rel;
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n', 'utf8');
  updated++;
  console.log(`+ ${f}: reliability=${rel} (conf=${j.confidence})`);
}
console.log(`done: ${updated} 卡补全 reliability`);
