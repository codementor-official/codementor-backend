n = int(input())
for _ in range(n):
    words = input().split()
    print(" ".join(w[0].upper() + w[1:].lower() for w in words))
