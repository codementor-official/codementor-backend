const data = require('fs').readFileSync(0, 'utf8').trim().split(/\s+/).map(Number);
const n = data[0];
const keys = data.slice(1, 1 + n);
const left = new Map();
const right = new Map();
const root = keys[0];
for (const x of keys.slice(1)) {
  let node = root;
  for (;;) {
    const child = x < node ? left : right;
    if (child.has(node)) node = child.get(node);
    else { child.set(node, x); break; }
  }
}
let height = 0;
const order = [];
const stack = [[root, 1]];
while (stack.length) {
  const [node, depth] = stack.pop();
  order.push(node);
  height = Math.max(height, depth);
  if (right.has(node)) stack.push([right.get(node), depth + 1]);
  if (left.has(node)) stack.push([left.get(node), depth + 1]);
}
console.log(`${height}\n${order.join(' ')}`);
