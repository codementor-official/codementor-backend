import random, os
random.seed(2026)
os.makedirs("tests", exist_ok=True)
n = q = 3500
a = sorted(random.randint(-10**6, 10**6) for _ in range(n))
qs = [random.randint(-10**6 - 5, 10**6 + 5) for _ in range(q)]
with open("tests/big.txt", "w") as f:
    f.write(f"{n} {q}\n{' '.join(map(str, a))}\n" + "\n".join(map(str, qs)) + "\n")
