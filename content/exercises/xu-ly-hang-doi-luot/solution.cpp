#include <algorithm>
#include <deque>
#include <iostream>
#include <string>
#include <utility>

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);
    int n, q;
    std::cin >> n >> q;
    std::deque<std::pair<std::string, int>> queue;
    for (int i = 0; i < n; ++i) {
        std::string name;
        int t;
        std::cin >> name >> t;
        queue.push_back({name, t});
    }
    long long clock = 0;
    while (!queue.empty()) {
        auto [name, remaining] = queue.front();
        queue.pop_front();
        int run = std::min(q, remaining);
        clock += run;
        if (remaining > run) queue.push_back({name, remaining - run});
        else std::cout << name << " " << clock << "\n";
    }
    return 0;
}
