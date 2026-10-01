# Sinh test lớn: python3 gen.py  (seed cố định → tái lập được)
import random, os
random.seed(2026)
os.makedirs("tests", exist_ok=True)
def write(name, n, k, values):
    with open(f"tests/{name}", "w") as f:
        f.write(f"{n} {k}\n{' '.join(map(str, sorted(values)))}\n")
write("big-random.txt", 5000, 0, [random.randint(-100000, 100000) for _ in range(5000)])
write("big-equal.txt", 5000, 14, [7] * 5000)          # m(m-1)/2 = 12.497.500 cặp
write("big-none.txt", 5000, -1, list(range(0, 10000, 2)))
# n = 20.000 với giá trị nhỏ (vừa 64 KB): duyệt mọi cặp là 2·10^8 phép thử.
write("big-dense.txt", 20000, 100, [random.randint(0, 99) for _ in range(20000)])
