import random, os
random.seed(2026)
os.makedirs("tests", exist_ok=True)
n = 5000
distinct = random.sample(range(-10**9, 10**9), n)
with open("tests/big-none.txt", "w") as f:
    f.write(f"{n}\n{' '.join(map(str, distinct))}\n")
late = distinct[: n - 1] + [distinct[0]]                 # lặp ở vị trí cuối cùng
with open("tests/big-last.txt", "w") as f:
    f.write(f"{n}\n{' '.join(map(str, late))}\n")
