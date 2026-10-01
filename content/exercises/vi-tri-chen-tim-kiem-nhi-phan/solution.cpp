#include <cstdio>
#include <vector>

int main() {
    int n, q;
    if (scanf("%d %d", &n, &q) != 2) return 0;
    std::vector<long long> a(n);
    for (auto& v : a) scanf("%lld", &v);
    while (q--) {
        long long x;
        scanf("%lld", &x);
        int lo = 0, hi = n;
        while (lo < hi) {
            int mid = lo + (hi - lo) / 2;
            if (a[mid] < x) lo = mid + 1;
            else hi = mid;
        }
        printf("%d\n", lo);
    }
    return 0;
}
