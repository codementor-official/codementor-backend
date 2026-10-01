// Số tới 10^18 vượt Number.MAX_SAFE_INTEGER, nên dùng BigInt.
let n = BigInt(require('fs').readFileSync(0, 'utf8').trim());
if (n < 0n) n = -n;
let count = 0;
let total = 0n;
do {
  count += 1;
  total += n % 10n;
  n /= 10n;
} while (n > 0n);
console.log(`${count} ${total}`);
