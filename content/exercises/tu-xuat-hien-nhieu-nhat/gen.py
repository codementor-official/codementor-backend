import random, os
random.seed(2026)
os.makedirs("tests", exist_ok=True)
vocab = ["hoc", "lap", "trinh", "python", "du", "lieu", "ham", "vong", "lap2", "chuoi", "list", "dict",
         "set", "tuple", "code", "bai", "tap", "giai", "thuat", "cay", "do", "thi"]
words = [random.choice(vocab) + ("" if random.random() < 0.8 else str(random.randint(0, 99))) for _ in range(9000)]
text = " ".join(w if random.random() < 0.9 else w.upper() + "," for w in words)
with open("tests/big-text.txt", "w") as f:
    f.write(f"20\n{text[:59000]}\n")
