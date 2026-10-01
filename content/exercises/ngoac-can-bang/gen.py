import random, os
random.seed(2026)
os.makedirs("tests", exist_ok=True)
def balanced(depth_budget):
    out, stack = [], []
    pairs = {"(": ")", "[": "]", "{": "}"}
    while len(out) < depth_budget:
        if stack and (random.random() < 0.45 or len(stack) > 2000):
            out.append(pairs[stack.pop()])
        else:
            o = random.choice("([{")
            stack.append(o)
            out.append(o)
    out.extend(pairs[o] for o in reversed(stack))
    return "".join(out)
good = balanced(55000)
with open("tests/big-ok.txt", "w") as f:
    f.write(good + "\n")
bad = good[:-1] + ("]" if good[-1] != "]" else ")")      # hỏng đúng ký tự cuối
with open("tests/big-bad-last.txt", "w") as f:
    f.write(bad + "\n")
