const data = require('fs').readFileSync(0, 'utf8').trim().split(/\s+/).map(Number);
const n = data[0];
const k = data[1];
const a = data.slice(2, 2 + n);
let left = 0;
let right = n - 1;
let count = 0;
while (left < right) {
  const s = a[left] + a[right];
  if (s < k) left += 1;
  else if (s > k) right -= 1;
  else if (a[left] === a[right]) {
    const m = right - left + 1;
    count += (m * (m - 1)) / 2;
    break;
  } else {
    const x = a[left];
    const y = a[right];
    let cx = 0;
    let cy = 0;
    while (a[left] === x) { cx += 1; left += 1; }
    while (a[right] === y) { cy += 1; right -= 1; }
    count += cx * cy;
  }
}
console.log(String(count));
