#include <iostream>

int main() {
    long long n;
    std::cin >> n;
    // |n| ≤ 10^18 vừa trong unsigned long long; đổi dấu ở kiểu không dấu để không tràn.
    unsigned long long x = n < 0 ? 0ULL - static_cast<unsigned long long>(n) : n;
    int count = 0;
    unsigned long long total = 0;
    do {
        ++count;
        total += x % 10;
        x /= 10;
    } while (x > 0);
    std::cout << count << " " << total << "\n";
    return 0;
}
