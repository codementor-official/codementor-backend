n = abs(int(input()))
count, total = 0, 0
while True:
    count += 1
    total += n % 10
    n //= 10
    if n == 0:
        break
print(count, total)
