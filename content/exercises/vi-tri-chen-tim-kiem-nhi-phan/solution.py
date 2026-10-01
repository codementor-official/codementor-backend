import sys


def lower_bound(a, x):
    lo, hi = 0, len(a)
    while lo < hi:
        mid = (lo + hi) // 2
        if a[mid] < x:
            lo = mid + 1
        else:
            hi = mid
    return lo


def main():
    data = sys.stdin.buffer.read().split()
    n, q = int(data[0]), int(data[1])
    a = list(map(int, data[2 : 2 + n]))
    queries = data[2 + n : 2 + n + q]
    print("\n".join(str(lower_bound(a, int(x))) for x in queries))


main()
