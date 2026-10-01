n = int(input())
hours, rest = divmod(n, 3600)
minutes, seconds = divmod(rest, 60)
print(f"{hours:02d}:{minutes:02d}:{seconds:02d}")
