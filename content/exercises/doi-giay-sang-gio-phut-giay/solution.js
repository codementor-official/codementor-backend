const n = Number(require('fs').readFileSync(0, 'utf8').trim());
const hours = Math.floor(n / 3600);
const minutes = Math.floor((n % 3600) / 60);
const seconds = n % 60;
const pad = (x) => String(x).padStart(2, '0');
console.log(`${pad(hours)}:${pad(minutes)}:${pad(seconds)}`);
