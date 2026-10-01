s = input()
pairs = {")": "(", "]": "[", "}": "{"}
stack = []
error = None
for i, ch in enumerate(s, start=1):
    if ch in "([{":
        stack.append((ch, i))
    elif ch in pairs:
        if not stack or stack[-1][0] != pairs[ch]:
            error = i
            break
        stack.pop()
if error is None and stack:
    error = stack[-1][1]
print("YES" if error is None else f"NO {error}")
