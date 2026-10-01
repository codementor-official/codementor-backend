import random, os
random.seed(2026)
os.makedirs("tests", exist_ok=True)
q = 4000
lines = []
for _ in range(q):
    a = random.randint(1, 1000)
    b = random.randint(900000, 1000000)
    lines.append(f"{a} {b}")
with open("tests/big-wide.txt", "w") as f:
    f.write(f"{q}\n" + "\n".join(lines) + "\n")
