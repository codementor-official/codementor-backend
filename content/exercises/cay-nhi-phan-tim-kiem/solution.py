import sys


def main():
    data = sys.stdin.read().split()
    n = int(data[0])
    keys = list(map(int, data[1 : 1 + n]))
    left, right = {}, {}
    root = keys[0]
    for x in keys[1:]:
        node = root
        while True:
            child = left if x < node else right
            if node in child:
                node = child[node]
            else:
                child[node] = x
                break
    # Duyệt bằng ngăn xếp thay cho đệ quy: cây suy biến sâu tới n tầng.
    height = 0
    order = []
    stack = [(root, 1)]
    while stack:
        node, depth = stack.pop()
        order.append(node)
        height = max(height, depth)
        if node in right:
            stack.append((right[node], depth + 1))
        if node in left:
            stack.append((left[node], depth + 1))
    print(height)
    print(" ".join(map(str, order)))


main()
