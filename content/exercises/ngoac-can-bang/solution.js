const s = require('fs').readFileSync(0, 'utf8').replace(/\r?\n$/, '');
const pairs = { ')': '(', ']': '[', '}': '{' };
const stack = [];
let error = null;
for (let i = 0; i < s.length; i += 1) {
  const ch = s[i];
  if ('([{'.includes(ch)) stack.push([ch, i + 1]);
  else if (ch in pairs) {
    if (!stack.length || stack[stack.length - 1][0] !== pairs[ch]) {
      error = i + 1;
      break;
    }
    stack.pop();
  }
}
if (error === null && stack.length) error = stack[stack.length - 1][1];
console.log(error === null ? 'YES' : `NO ${error}`);
