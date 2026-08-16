"""C — ngôn ngữ duy nhất mà ánh xạ kiểu KHÔNG một-đối-một.

C không có kiểu mảng mang theo độ dài, nên một tham số `list<int>` của đề trở thành **hai**
tham số C (`int* nums, int numsSize`), và một kiểu trả về `list<int>` phải trả độ dài qua
tham số ra (`int* returnSize`). Đây đúng là quy ước LeetCode dùng cho C, và cũng là thứ lập
trình viên C mong đợi — nhưng nó là lý do bảng ánh xạ kiểu không thể là một bảng chung cho
mọi ngôn ngữ (xem `base.py`).

Không hỗ trợ `map` và `optional`: C không có kiểu tự nhiên cho chúng, và bịa ra một struct
riêng thì học viên phải học API của chúng ta thay vì học C.

Bù lại C có thứ Java/C++ không có ở đây: driver bắt được **cả** hết giờ lẫn sập (SIGSEGV,
chia cho 0) theo TỪNG case, nhờ `sigsetjmp`. Nhảy ra khỏi một hàm C giữa chừng chỉ rò rỉ bộ
nhớ; C++ thì bỏ qua destructor nên không làm được như vậy.
"""

from app.services.langs.base import (
    MAX_CONSOLE_BYTES,
    DriverSpec,
    LanguageRunner,
    UnsupportedType,
    fill,
)

SCALARS = {
    "int": "int",
    "long": "long long",
    "float": "double",
    "bool": "bool",
    "string": "char*",
    "void": "void",
}


def _scalar(node: dict | None) -> str:
    kind = (node or {}).get("kind", "")
    if kind not in SCALARS:
        raise UnsupportedType(f"C chưa hỗ trợ kiểu {kind!r}")
    return SCALARS[kind]


def _element_expression(node: dict, source: str) -> str:
    """Biểu thức C lấy một giá trị vô hướng ra khỏi một cJSON item."""
    kind = node.get("kind")
    if kind == "bool":
        return f"cJSON_IsTrue({source})"
    if kind == "string":
        return f"cJSON_GetStringValue({source})"
    return f"({_scalar(node)})cJSON_GetNumberValue({source})"


def params_for(name: str, node: dict) -> list[str]:
    """Một tham số của đề → danh sách tham số C tương ứng."""
    kind = node.get("kind", "")
    if kind == "list":
        inner = node.get("of") or {}
        if inner.get("kind") == "list":
            cell = _scalar(inner.get("of"))
            return [f"{cell}** {name}", f"int {name}Size", f"int* {name}ColSizes"]
        return [f"{_scalar(inner)}* {name}", f"int {name}Size"]
    return [f"{_scalar(node)} {name}"]


def signature_of(spec: DriverSpec) -> str:
    """Chữ ký C đầy đủ, dùng chung cho starter code và cho lời gọi trong driver."""
    declarations: list[str] = []
    for parameter in spec.parameters:
        declarations.extend(params_for(parameter.name, parameter.type))

    kind = spec.return_type.get("kind", "")
    if kind == "list":
        inner = spec.return_type.get("of") or {}
        if inner.get("kind") == "list":
            raise UnsupportedType("C chưa hỗ trợ trả về mảng hai chiều")
        returns = f"{_scalar(inner)}*"
        # Người gọi không có cách nào biết mảng dài bao nhiêu ngoài việc được bảo.
        declarations.append("int* returnSize")
    else:
        returns = _scalar(spec.return_type)

    return f"{returns} {spec.function_name}({', '.join(declarations) or 'void'})"


def starter(spec: DriverSpec) -> str:
    kind = spec.return_type.get("kind", "")
    notes = []
    for parameter in spec.parameters:
        if parameter.type.get("kind") == "list":
            notes.append(
                f" * {parameter.name}Size là số phần tử của {parameter.name}."
            )
    if kind == "list":
        notes.append(" * Trả về mảng cấp phát bằng malloc và đặt *returnSize là số phần tử.")

    header = f"/**\n{chr(10).join(notes)}\n */\n" if notes else ""
    # C bắt buộc phải return một giá trị; để trống thì mã khởi tạo không dịch được.
    placeholder = {
        "list": "    *returnSize = 0;\n    return NULL;\n",
        "string": "    return NULL;\n",
        "bool": "    return false;\n",
        "void": "",
    }.get(kind, "    return 0;\n")
    body = "    // Viết code của bạn ở đây\n" + placeholder

    return (
        "#include <stdbool.h>\n#include <stdlib.h>\n#include <string.h>\n\n"
        f"{header}{signature_of(spec)} {{\n{body}}}\n"
    )


_DRIVER = '''\
/* _GNU_SOURCE chứ không phải _POSIX_C_SOURCE: `sigaltstack` nằm ngoài POSIX thuần, và thiếu
   nó thì gcc chỉ cảnh báo "implicit declaration" rồi hỏng lúc link. */
#define _GNU_SOURCE

#include <setjmp.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

#include <cjson/cJSON.h>

#include "solution.c"

#define MAX_CONSOLE __MAX_CONSOLE__

static sigjmp_buf failurePoint;
static volatile sig_atomic_t failureSignal = 0;
/* Ngăn xếp riêng cho signal handler: tràn ngăn xếp (đệ quy vô hạn) cũng bắn SIGSEGV, mà lúc
   đó ngăn xếp chính đã hết chỗ để chạy handler. SIGSTKSZ ở glibc mới không còn là hằng biên
   dịch nên dùng một con số cố định. */
static char alternateStack[64 * 1024];

static void onFailure(int signum) {
    failureSignal = signum;
    siglongjmp(failurePoint, 1);
}

static void setAlarm(long seconds, long microseconds) {
    struct itimerval limit;
    memset(&limit, 0, sizeof(limit));
    limit.it_value.tv_sec = seconds;
    limit.it_value.tv_usec = microseconds;
    setitimer(ITIMER_REAL, &limit, NULL);
}

static char* readAll(const char* path) {
    FILE* handle = fopen(path, "rb");
    if (!handle) return NULL;
    fseek(handle, 0, SEEK_END);
    long size = ftell(handle);
    fseek(handle, 0, SEEK_SET);
    char* buffer = (char*)malloc(size + 1);
    if (buffer) {
        size_t read = fread(buffer, 1, size, handle);
        buffer[read] = 0;
    }
    fclose(handle);
    return buffer;
}

int main(void) {
    char* raw = readAll("tests.json");
    if (!raw) return 1;
    cJSON* tests = cJSON_Parse(raw);
    remove("tests.json");
    if (!tests) return 1;

    FILE* out = fopen("results.ndjson", "w");
    if (!out) return 1;

    /* Nuốt stdout của học viên: kết quả chấm đi qua results.ndjson, printf chỉ là console gỡ
       lỗi. `out` được mở TRƯỚC khi đổi hướng nên nó không bị kéo theo. */
    fflush(stdout);
    int savedStdout = dup(STDOUT_FILENO);
    FILE* consoleFile = fopen("console.txt", "w+");
    dup2(fileno(consoleFile), STDOUT_FILENO);

    stack_t alternate;
    alternate.ss_sp = alternateStack;
    alternate.ss_size = sizeof(alternateStack);
    alternate.ss_flags = 0;
    sigaltstack(&alternate, NULL);

    struct sigaction action;
    memset(&action, 0, sizeof(action));
    action.sa_handler = onFailure;
    action.sa_flags = SA_ONSTACK;
    sigemptyset(&action.sa_mask);
    sigaction(SIGSEGV, &action, NULL);
    sigaction(SIGBUS, &action, NULL);
    sigaction(SIGFPE, &action, NULL);
    sigaction(SIGABRT, &action, NULL);
    sigaction(SIGALRM, &action, NULL);

    int total = cJSON_GetArraySize(tests);
    for (int index = 0; index < total; index++) {
        cJSON* test = cJSON_GetArrayItem(tests, index);
        cJSON* args = cJSON_GetObjectItem(test, "args");
        (void)args;
        cJSON* record = cJSON_CreateObject();
        cJSON_AddNumberToObject(record, "id",
                                cJSON_GetNumberValue(cJSON_GetObjectItem(test, "id")));

        struct timespec begin, finish;
        clock_gettime(CLOCK_MONOTONIC, &begin);
        failureSignal = 0;

        if (sigsetjmp(failurePoint, 1) == 0) {
            setAlarm(__LIMIT_SEC__, __LIMIT_USEC__);
__BODY__
        } else if (failureSignal == SIGALRM) {
            cJSON_AddStringToObject(record, "status", "timeout");
        } else {
            cJSON_AddStringToObject(record, "status", "runtime_error");
            cJSON_AddStringToObject(record, "message", strsignal(failureSignal));
        }
        setAlarm(0, 0);

        clock_gettime(CLOCK_MONOTONIC, &finish);
        cJSON_AddNumberToObject(record, "runtime_ms",
                                (finish.tv_sec - begin.tv_sec) * 1000.0 +
                                    (finish.tv_nsec - begin.tv_nsec) / 1e6);

        char* line = cJSON_PrintUnformatted(record);
        fprintf(out, "%s\\n", line);
        fflush(out);
        free(line);
        cJSON_Delete(record);
    }

    fflush(stdout);
    dup2(savedStdout, STDOUT_FILENO);
    fclose(out);

    fclose(consoleFile);
    char* console = readAll("console.txt");
    if (console) {
        if (strlen(console) > MAX_CONSOLE) console[MAX_CONSOLE] = 0;
        fputs(console, stdout);
    }
    return 0;
}
'''


def _decode(index: int, node: dict) -> list[str]:
    indent = " " * 12
    kind = node.get("kind", "")
    item = f"cJSON_GetArrayItem(args, {index})"

    if kind != "list":
        return [f"{indent}{_scalar(node)} p{index} = {_element_expression(node, item)};"]

    inner = node.get("of") or {}
    lines = [
        f"{indent}cJSON* j{index} = {item};",
        f"{indent}int p{index}Size = cJSON_GetArraySize(j{index});",
    ]

    if inner.get("kind") == "list":
        cell = _scalar(inner.get("of"))
        lines += [
            # malloc(0) được phép trả NULL, mà một bài đúng vẫn có thể nhận mảng rỗng — cấp
            # tối thiểu một ô để con trỏ luôn khác NULL.
            f"{indent}{cell}** p{index} = ({cell}**)malloc(sizeof({cell}*) * "
            f"(p{index}Size > 0 ? p{index}Size : 1));",
            f"{indent}int* p{index}ColSizes = (int*)malloc(sizeof(int) * "
            f"(p{index}Size > 0 ? p{index}Size : 1));",
            f"{indent}for (int r = 0; r < p{index}Size; r++) {{",
            f"{indent}    cJSON* row = cJSON_GetArrayItem(j{index}, r);",
            f"{indent}    p{index}ColSizes[r] = cJSON_GetArraySize(row);",
            f"{indent}    p{index}[r] = ({cell}*)malloc(sizeof({cell}) * "
            f"(p{index}ColSizes[r] > 0 ? p{index}ColSizes[r] : 1));",
            f"{indent}    for (int c = 0; c < p{index}ColSizes[r]; c++)",
            f"{indent}        p{index}[r][c] = "
            f"{_element_expression(inner.get('of') or {}, 'cJSON_GetArrayItem(row, c)')};",
            f"{indent}}}",
        ]
        return lines

    cell = _scalar(inner)
    lines += [
        f"{indent}{cell}* p{index} = ({cell}*)malloc(sizeof({cell}) * "
        f"(p{index}Size > 0 ? p{index}Size : 1));",
        f"{indent}for (int k = 0; k < p{index}Size; k++)",
        f"{indent}    p{index}[k] = "
        f"{_element_expression(inner, f'cJSON_GetArrayItem(j{index}, k)')};",
    ]
    return lines


def _arguments(spec: DriverSpec) -> str:
    parts: list[str] = []
    for index, parameter in enumerate(spec.parameters):
        kind = parameter.type.get("kind")
        parts.append(f"p{index}")
        if kind == "list":
            parts.append(f"p{index}Size")
            if (parameter.type.get("of") or {}).get("kind") == "list":
                parts.append(f"p{index}ColSizes")
    return ", ".join(parts)


def _body(spec: DriverSpec) -> str:
    indent = " " * 12
    lines: list[str] = []
    for index, parameter in enumerate(spec.parameters):
        lines.extend(_decode(index, parameter.type))

    arguments = _arguments(spec)
    kind = spec.return_type.get("kind", "")

    if kind == "void":
        lines.append(f"{indent}{spec.function_name}({arguments});")
        lines.append(f'{indent}cJSON_AddStringToObject(record, "status", "ok");')
        lines.append(f'{indent}cJSON_AddNullToObject(record, "actual");')
        return "\n".join(lines)

    if kind == "list":
        inner = spec.return_type.get("of") or {}
        cell = _scalar(inner)
        call = f"{spec.function_name}({arguments}{', ' if arguments else ''}&returnSize)"
        lines += [
            f"{indent}int returnSize = 0;",
            f"{indent}{cell}* value = {call};",
            f"{indent}cJSON* actual = cJSON_CreateArray();",
            f"{indent}for (int k = 0; k < returnSize; k++)",
            f"{indent}    cJSON_AddItemToArray(actual, "
            + (
                'cJSON_CreateString(value[k] ? value[k] : "")'
                if inner.get("kind") == "string"
                else (
                    "cJSON_CreateBool(value[k])"
                    if inner.get("kind") == "bool"
                    else "cJSON_CreateNumber((double)value[k])"
                )
            )
            + ");",
            f'{indent}cJSON_AddStringToObject(record, "status", "ok");',
            f'{indent}cJSON_AddItemToObject(record, "actual", actual);',
        ]
        return "\n".join(lines)

    call = f"{spec.function_name}({arguments})"
    lines.append(f"{indent}{_scalar(spec.return_type)} value = {call};")
    if kind == "string":
        lines.append(
            f"{indent}cJSON* actual = value ? cJSON_CreateString(value) : cJSON_CreateNull();"
        )
    elif kind == "bool":
        lines.append(f"{indent}cJSON* actual = cJSON_CreateBool(value);")
    else:
        lines.append(f"{indent}cJSON* actual = cJSON_CreateNumber((double)value);")
    lines.append(f'{indent}cJSON_AddStringToObject(record, "status", "ok");')
    lines.append(f'{indent}cJSON_AddItemToObject(record, "actual", actual);')
    return "\n".join(lines)


def files(spec: DriverSpec) -> dict[str, str]:
    whole = int(spec.time_limit_sec)
    return {
        "driver.c": fill(
            _DRIVER,
            max_console=str(MAX_CONSOLE_BYTES),
            body=_body(spec),
            limit_sec=str(whole),
            limit_usec=str(int((spec.time_limit_sec - whole) * 1_000_000)),
        )
    }


RUNNER = LanguageRunner(
    solution_file="solution.c",
    compile_cmd=["gcc", "-O2", "driver.c", "-o", "main", "-lcjson"],
    run_cmd=["./main"],
    starter=starter,
    files=files,
    per_case_timeout=True,
)
