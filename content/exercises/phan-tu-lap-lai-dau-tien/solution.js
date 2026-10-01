const data = require('fs').readFileSync(0, 'utf8').trim().split(/\s+/);
const n = Number(data[0]);
const seen = new Set();
let answer = 'NONE';
for (let i = 0; i < n; i += 1) {
  const x = Number(data[1 + i]);
  if (seen.has(x)) {
    answer = `${x} ${i + 1}`;
    break;
  }
  seen.add(x);
}
console.log(answer);
