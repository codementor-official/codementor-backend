#include <iostream>
#include <string>

int main() {
    double d;
    std::cin >> d;
    std::string result;
    if (d < 0 || d > 10) result = "Khong hop le";
    else if (d >= 9) result = "Xuat sac";
    else if (d >= 8) result = "Gioi";
    else if (d >= 6.5) result = "Kha";
    else if (d >= 5) result = "Trung binh";
    else result = "Yeu";
    std::cout << result << "\n";
    return 0;
}
