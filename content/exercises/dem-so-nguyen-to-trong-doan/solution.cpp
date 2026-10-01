#include <cstdio>
#include <vector>

int main() {
    const int LIMIT = 1000000;
    std::vector<char> composite(LIMIT + 1, 0);
    composite[0] = composite[1] = 1;
    for (int i = 2; 1LL * i * i <= LIMIT; ++i)
        if (!composite[i])
            for (int j = i * i; j <= LIMIT; j += i) composite[j] = 1;
    std::vector<int> prefix(LIMIT + 1, 0);
    for (int i = 1; i <= LIMIT; ++i) prefix[i] = prefix[i - 1] + (composite[i] ? 0 : 1);

    int q;
    if (scanf("%d", &q) != 1) return 0;
    while (q--) {
        int a, b;
        scanf("%d %d", &a, &b);
        printf("%d\n", prefix[b] - prefix[a - 1]);
    }
    return 0;
}
