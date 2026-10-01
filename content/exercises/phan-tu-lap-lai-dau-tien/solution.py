import sys

data = sys.stdin.read().split()
n = int(data[0])
seen = set()
answer = "NONE"
for i in range(n):
    x = data[1 + i]
    if x in seen:
        answer = f"{x} {i + 1}"
        break
    seen.add(x)
print(answer)
