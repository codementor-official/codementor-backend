#include <cstdio>
#include <vector>

int main() {
    int n;
    long long k;
    if (scanf("%d %lld", &n, &k) != 2) return 0;
    std::vector<long long> a(n);
    for (auto& x : a) scanf("%lld", &x);
    int left = 0, right = n - 1;
    long long count = 0;
    while (left < right) {
        long long s = a[left] + a[right];
        if (s < k) ++left;
        else if (s > k) --right;
        else if (a[left] == a[right]) {
            long long m = right - left + 1;
            count += m * (m - 1) / 2;
            break;
        } else {
            long long x = a[left], y = a[right], cx = 0, cy = 0;
            while (a[left] == x) { ++cx; ++left; }
            while (a[right] == y) { ++cy; --right; }
            count += cx * cy;
        }
    }
    printf("%lld\n", count);
    return 0;
}
