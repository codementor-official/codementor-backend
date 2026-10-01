#include <cstdio>
#include <unordered_set>

int main() {
    int n;
    if (scanf("%d", &n) != 1) return 0;
    std::unordered_set<long long> seen;
    seen.reserve(n * 2);
    for (int i = 1; i <= n; ++i) {
        long long x;
        scanf("%lld", &x);
        if (seen.count(x)) {
            printf("%lld %d\n", x, i);
            return 0;
        }
        seen.insert(x);
    }
    printf("NONE\n");
    return 0;
}
