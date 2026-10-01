#include <algorithm>
#include <cctype>
#include <iostream>
#include <map>
#include <string>
#include <vector>

int main() {
    std::string line, text;
    std::getline(std::cin, line);
    int k = std::stoi(line);
    std::getline(std::cin, text);

    std::map<std::string, int> counts;
    std::string word;
    for (char raw : text + " ") {
        unsigned char c = static_cast<unsigned char>(raw);
        if (std::isalnum(c)) {
            word += static_cast<char>(std::tolower(c));
        } else if (!word.empty()) {
            ++counts[word];
            word.clear();
        }
    }

    std::vector<std::pair<std::string, int>> ranked(counts.begin(), counts.end());
    std::sort(ranked.begin(), ranked.end(), [](const auto& a, const auto& b) {
        return a.second != b.second ? a.second > b.second : a.first < b.first;
    });
    for (int i = 0; i < k && i < static_cast<int>(ranked.size()); ++i) {
        std::cout << ranked[i].first << " " << ranked[i].second << "\n";
    }
    return 0;
}
