#include <cstdio>

int main() {
    long long n;
    if (scanf("%lld", &n) != 1) return 0;
    long long hours = n / 3600, minutes = n % 3600 / 60, seconds = n % 60;
    printf("%02lld:%02lld:%02lld\n", hours, minutes, seconds);
    return 0;
}
