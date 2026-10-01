const data = require('fs').readFileSync(0, 'utf8').trim().split(/\s+/).map(Number);
const LIMIT = 1_000_000;
const composite = new Uint8Array(LIMIT + 1);
composite[0] = composite[1] = 1;
for (let i = 2; i * i <= LIMIT; i += 1) {
  if (!composite[i]) for (let j = i * i; j <= LIMIT; j += i) composite[j] = 1;
}
const prefix = new Int32Array(LIMIT + 1);
for (let i = 1; i <= LIMIT; i += 1) prefix[i] = prefix[i - 1] + (composite[i] ? 0 : 1);

const q = data[0];
const out = [];
for (let i = 0; i < q; i += 1) {
  const a = data[1 + 2 * i];
  const b = data[2 + 2 * i];
  out.push(prefix[b] - prefix[a - 1]);
}
console.log(out.join('\n'));
