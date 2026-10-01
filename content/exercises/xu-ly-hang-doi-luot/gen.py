import os
os.makedirs("tests", exist_ok=True)
# 4000 tác vụ × 250 đơn vị, q = 1 → 1.000.000 lượt; list.pop(0) trên hàng 4000 phần tử là quá chậm.
n, q = 4000, 1
with open("tests/big-rounds.txt", "w") as f:
    f.write(f"{n} {q}\n" + "".join(f"T{i} 250\n" for i in range(n)))
