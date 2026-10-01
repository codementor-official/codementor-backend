const data = require('fs').readFileSync(0, 'utf8').trim().split(/\s+/).map(Number);
const n = data[0];
const q = data[1];
const a = data.slice(2, 2 + n);
const out = [];
for (let i = 0; i < q; i += 1) {
  const x = data[2 + n + i];
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  out.push(lo);
}
console.log(out.join('\n'));
