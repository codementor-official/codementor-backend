#include <algorithm>
#include <cstdio>
#include <utility>
#include <vector>

int main() {
    int n;
    if (scanf("%d", &n) != 1) return 0;
    std::vector<long long> key(n);
    std::vector<int> left(n, -1), right(n, -1);
    for (int i = 0; i < n; ++i) scanf("%lld", &key[i]);
    for (int i = 1; i < n; ++i) {
        int node = 0;
        for (;;) {
            int& child = key[i] < key[node] ? left[node] : right[node];
            if (child == -1) { child = i; break; }
            node = child;
        }
    }
    int height = 0;
    std::vector<long long> order;
    std::vector<std::pair<int, int>> stack{{0, 1}};
    while (!stack.empty()) {
        auto [node, depth] = stack.back();
        stack.pop_back();
        order.push_back(key[node]);
        height = std::max(height, depth);
        if (right[node] != -1) stack.push_back({right[node], depth + 1});
        if (left[node] != -1) stack.push_back({left[node], depth + 1});
    }
    printf("%d\n", height);
    for (int i = 0; i < n; ++i) printf("%lld%c", order[i], i + 1 < n ? ' ' : '\n');
    return 0;
}
