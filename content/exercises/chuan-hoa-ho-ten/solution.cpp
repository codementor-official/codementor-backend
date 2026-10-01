#include <cctype>
#include <iostream>
#include <sstream>
#include <string>

int main() {
    std::string line;
    std::getline(std::cin, line);
    int n = std::stoi(line);
    for (int i = 0; i < n; ++i) {
        std::getline(std::cin, line);
        std::istringstream words(line);
        std::string word, result;
        while (words >> word) {
            for (std::size_t k = 0; k < word.size(); ++k) {
                unsigned char c = static_cast<unsigned char>(word[k]);
                word[k] = static_cast<char>(k == 0 ? std::toupper(c) : std::tolower(c));
            }
            if (!result.empty()) result += ' ';
            result += word;
        }
        std::cout << result << "\n";
    }
    return 0;
}
