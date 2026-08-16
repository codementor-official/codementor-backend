"""C++ — driver `#include` thẳng file bài của học viên.

Include văn bản chứ không biên dịch hai đơn vị rồi link: khỏi phải sinh file header khai báo
trước, và học viên vẫn viết một hàm tự do như bình thường.

JSON dùng nlohmann (một header duy nhất, nằm sẵn trong image — xem `docker/cpp.Dockerfile`).

Không có timeout theo từng case. `siglongjmp` ra khỏi một hàm C++ đang chạy sẽ bỏ qua toàn bộ
destructor — rò rỉ, và với vài case liên tiếp thì heap hỏng thật. C làm được chuyện đó vì C
không có destructor. Case treo ở đây chạm trần cứng của container; xem README.
"""

from app.services.langs.base import (
    MAX_CONSOLE_BYTES,
    DriverSpec,
    LanguageRunner,
    UnsupportedType,
    fill,
)

TYPES = {
    "int": "int",
    "long": "long long",
    "float": "double",
    "bool": "bool",
    "string": "std::string",
    "void": "void",
}


def type_of(node: dict | None) -> str:
    if not node:
        raise UnsupportedType("thiếu kiểu")
    kind = node.get("kind", "")
    if kind == "list":
        return f"std::vector<{type_of(node.get('of'))}>"
    if kind == "map":
        return f"std::map<{type_of(node.get('key'))}, {type_of(node.get('value'))}>"
    if kind == "optional":
        # nlohmann chưa serialize std::optional mặc định; nhận nó vào đây sẽ thành lỗi biên
        # dịch khó hiểu trong driver, nên chặn ngay từ lúc ra đề.
        raise UnsupportedType("C++ chưa hỗ trợ kiểu optional")
    if kind not in TYPES:
        raise UnsupportedType(f"C++ chưa hỗ trợ kiểu {kind!r}")
    return TYPES[kind]


def starter(spec: DriverSpec) -> str:
    args = ", ".join(f"{type_of(p.type)} {p.name}" for p in spec.parameters)
    returns = type_of(spec.return_type)
    body = (
        "    // Viết code của bạn ở đây\n"
        if returns == "void"
        else '    // Viết code của bạn ở đây\n    throw std::runtime_error("Chưa cài đặt");\n'
    )
    return (
        "#include <map>\n#include <stdexcept>\n#include <string>\n#include <vector>\n\n"
        f"{returns} {spec.function_name}({args}) {{\n{body}}}\n"
    )


_DRIVER = '''\
#include <chrono>
#include <cstdio>
#include <exception>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "solution.cpp"

using json = nlohmann::json;

static const size_t MAX_CONSOLE = __MAX_CONSOLE__;

int main() {
    json tests;
    {
        std::ifstream in("tests.json");
        in >> tests;
    }
    std::remove("tests.json");

    std::ofstream out("results.ndjson");

    // Nuốt stdout của học viên: kết quả chấm đi qua file, std::cout chỉ là console gỡ lỗi.
    std::ostringstream captured;
    std::streambuf* realOut = std::cout.rdbuf(captured.rdbuf());

    for (auto& test : tests) {
        json record;
        record["id"] = test["id"];
        auto started = std::chrono::steady_clock::now();
        try {
            auto& args = test["args"];
            (void)args;
__BODY__
        } catch (const std::exception& error) {
            record["status"] = "runtime_error";
            record["message"] = error.what();
        } catch (...) {
            record["status"] = "runtime_error";
            record["message"] = "ngoại lệ không rõ kiểu";
        }
        record["runtime_ms"] =
            std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started)
                .count();
        out << record.dump() << "\\n";
        out.flush();
    }

    std::cout.rdbuf(realOut);
    out.close();
    std::string text = captured.str();
    if (text.size() > MAX_CONSOLE) text = text.substr(0, MAX_CONSOLE);
    std::cout << text;
    return 0;
}
'''


def _body(spec: DriverSpec) -> str:
    indent = " " * 12
    lines = []
    for index, parameter in enumerate(spec.parameters):
        declared = type_of(parameter.type)
        lines.append(f"{indent}{declared} p{index} = args[{index}].get<{declared}>();")
    arguments = ", ".join(f"p{index}" for index in range(len(spec.parameters)))
    invocation = f"{spec.function_name}({arguments})"
    if spec.return_type.get("kind") == "void":
        lines.append(f"{indent}{invocation};")
        lines.append(f'{indent}record["status"] = "ok";')
        lines.append(f'{indent}record["actual"] = nullptr;')
    else:
        lines.append(f"{indent}{type_of(spec.return_type)} value = {invocation};")
        lines.append(f'{indent}record["status"] = "ok";')
        lines.append(f'{indent}record["actual"] = value;')
    return "\n".join(lines)


def files(spec: DriverSpec) -> dict[str, str]:
    return {"driver.cpp": fill(_DRIVER, max_console=str(MAX_CONSOLE_BYTES), body=_body(spec))}


RUNNER = LanguageRunner(
    solution_file="solution.cpp",
    compile_cmd=["g++", "-O2", "-std=c++17", "driver.cpp", "-o", "main"],
    run_cmd=["./main"],
    starter=starter,
    files=files,
)
