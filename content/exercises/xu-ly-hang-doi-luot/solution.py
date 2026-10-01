import sys
from collections import deque


def main():
    data = sys.stdin.read().split()
    n, q = int(data[0]), int(data[1])
    queue = deque((data[2 + 2 * i], int(data[3 + 2 * i])) for i in range(n))
    clock = 0
    out = []
    while queue:
        name, remaining = queue.popleft()
        run = min(q, remaining)
        clock += run
        if remaining > run:
            queue.append((name, remaining - run))
        else:
            out.append(f"{name} {clock}")
    print("\n".join(out))


main()
