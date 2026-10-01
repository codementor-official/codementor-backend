import sys

LIMIT = 10**6


def build_prefix(limit):
    is_prime = bytearray([1]) * (limit + 1)
    is_prime[0] = is_prime[1] = 0
    for i in range(2, int(limit ** 0.5) + 1):
        if is_prime[i]:
            is_prime[i * i :: i] = bytearray(len(range(i * i, limit + 1, i)))
    prefix = [0] * (limit + 1)
    running = 0
    for i in range(limit + 1):
        running += is_prime[i]
        prefix[i] = running
    return prefix


def main():
    data = sys.stdin.buffer.read().split()
    q = int(data[0])
    prefix = build_prefix(LIMIT)
    out = []
    for i in range(q):
        a, b = int(data[1 + 2 * i]), int(data[2 + 2 * i])
        out.append(prefix[b] - prefix[a - 1])
    print("\n".join(map(str, out)))


main()
