#include <iostream>
#include <string>
#include <utility>
#include <vector>

int main() {
    std::string s;
    std::getline(std::cin, s);
    std::vector<std::pair<char, int>> stack;
    int error = 0;
    for (int i = 0; i < static_cast<int>(s.size()); ++i) {
        char ch = s[i];
        if (ch == '(' || ch == '[' || ch == '{') {
            stack.push_back({ch, i + 1});
        } else if (ch == ')' || ch == ']' || ch == '}') {
            char open = ch == ')' ? '(' : ch == ']' ? '[' : '{';
            if (stack.empty() || stack.back().first != open) {
                error = i + 1;
                break;
            }
            stack.pop_back();
        }
    }
    if (error == 0 && !stack.empty()) error = stack.back().second;
    if (error == 0) std::cout << "YES\n";
    else std::cout << "NO " << error << "\n";
    return 0;
}
