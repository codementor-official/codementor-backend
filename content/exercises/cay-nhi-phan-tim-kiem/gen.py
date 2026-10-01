import os
os.makedirs("tests", exist_ok=True)
n = 2000
# Khóa tăng dần → cây suy biến cao 2000: bắt lời giải đệ quy không tăng giới hạn độ sâu.
with open("tests/big-sorted.txt", "w") as f:
    f.write(f"{n}\n{' '.join(str(i * 3) for i in range(n))}\n")
with open("tests/big-zigzag.txt", "w") as f:
    keys = []
    lo, hi = 0, n - 1
    while lo <= hi:
        keys.append(lo); lo += 1
        if lo <= hi:
            keys.append(hi); hi -= 1
    f.write(f"{n}\n{' '.join(map(str, keys))}\n")
