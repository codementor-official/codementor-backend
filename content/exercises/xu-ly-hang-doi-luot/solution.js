const data = require('fs').readFileSync(0, 'utf8').trim().split(/\s+/);
const n = Number(data[0]);
const q = Number(data[1]);
// Hàng đợi bằng mảng + con trỏ đầu: shift() của mảng là O(n), nên không dùng.
const names = [];
const remain = [];
for (let i = 0; i < n; i += 1) {
  names.push(data[2 + 2 * i]);
  remain.push(Number(data[3 + 2 * i]));
}
let head = 0;
let clock = 0;
const out = [];
while (head < names.length) {
  const name = names[head];
  const left = remain[head];
  head += 1;
  const run = Math.min(q, left);
  clock += run;
  if (left > run) {
    names.push(name);
    remain.push(left - run);
  } else {
    out.push(`${name} ${clock}`);
  }
}
console.log(out.join('\n'));
