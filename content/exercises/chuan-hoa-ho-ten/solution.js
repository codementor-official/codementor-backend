const lines = require('fs').readFileSync(0, 'utf8').split('\n');
const n = Number(lines[0]);
const out = [];
for (let i = 1; i <= n; i += 1) {
  const words = lines[i].trim().split(/\s+/).filter(Boolean);
  out.push(words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' '));
}
console.log(out.join('\n'));
