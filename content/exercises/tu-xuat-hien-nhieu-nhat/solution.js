const [kLine, text = ''] = require('fs').readFileSync(0, 'utf8').split('\n');
const k = Number(kLine);
const counts = new Map();
for (const word of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
  counts.set(word, (counts.get(word) ?? 0) + 1);
}
const ranked = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
console.log(ranked.slice(0, k).map(([w, c]) => `${w} ${c}`).join('\n'));
