k = int(input())
text = input().lower()
cleaned = "".join(ch if ch.isalnum() else " " for ch in text)
counts = {}
for word in cleaned.split():
    counts[word] = counts.get(word, 0) + 1
ranked = sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))
for word, count in ranked[:k]:
    print(word, count)
