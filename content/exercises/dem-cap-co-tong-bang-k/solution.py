import sys

data = sys.stdin.read().split()
n, k = int(data[0]), int(data[1])
a = list(map(int, data[2 : 2 + n]))
left, right, count = 0, n - 1, 0
while left < right:
    s = a[left] + a[right]
    if s < k:
        left += 1
    elif s > k:
        right -= 1
    elif a[left] == a[right]:
        m = right - left + 1
        count += m * (m - 1) // 2
        break
    else:
        x, y = a[left], a[right]
        cx = cy = 0
        while a[left] == x:
            cx += 1
            left += 1
        while a[right] == y:
            cy += 1
            right -= 1
        count += cx * cy
print(count)
