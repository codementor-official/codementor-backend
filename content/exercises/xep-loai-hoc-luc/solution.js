const d = Number(require('fs').readFileSync(0, 'utf8').trim());
let result;
if (d < 0 || d > 10) result = 'Khong hop le';
else if (d >= 9) result = 'Xuat sac';
else if (d >= 8) result = 'Gioi';
else if (d >= 6.5) result = 'Kha';
else if (d >= 5) result = 'Trung binh';
else result = 'Yeu';
console.log(result);
