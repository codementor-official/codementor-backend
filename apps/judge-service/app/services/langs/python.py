"""Python: chú thích kiểu của `typing`, driver nạp bài như một module.

Ngôn ngữ duy nhất ở đây cắt được từng test case hết giờ (`signal.setitimer`) — case sau vẫn
chạy sau khi một case treo. Xem `base.LanguageRunner.per_case_timeout`.
"""

from app.services.langs.base import (
    MAX_CONSOLE_BYTES,
    DriverSpec,
    LanguageRunner,
    fill,
)

TYPES = {
    "int": "int",
    "long": "int",
    "float": "float",
    "bool": "bool",
    "string": "str",
    "void": "None",
}


def type_of(node: dict | None) -> str:
    if not node:
        return "Any"
    kind = node.get("kind")
    if kind == "list":
        return f"List[{type_of(node.get('of'))}]"
    if kind == "map":
        return f"Dict[{type_of(node.get('key'))}, {type_of(node.get('value'))}]"
    if kind == "optional":
        return f"Optional[{type_of(node.get('of'))}]"
    return TYPES.get(kind or "", "Any")


def starter(spec: DriverSpec) -> str:
    annotations = [type_of(p.type) for p in spec.parameters] + [type_of(spec.return_type)]
    # Chỉ import cái thực sự dùng: một dòng `from typing import List` thừa trong mã khởi tạo
    # là một câu hỏi thừa học viên phải tự trả lời.
    needed = [n for n in ("Any", "Dict", "List", "Optional") if any(n in a for a in annotations)]
    header = f"from typing import {', '.join(needed)}\n\n\n" if needed else ""
    args = ", ".join(f"{p.name}: {type_of(p.type)}" for p in spec.parameters)
    return (
        f"{header}def {spec.function_name}({args}) -> {type_of(spec.return_type)}:\n"
        f"    # Viết code của bạn ở đây\n"
        f"    pass\n"
    )


_DRIVER = '''\
import io, json, os, signal, sys, time, traceback

FUNC_NAME = "__FUNC__"
TIME_LIMIT = __LIMIT__
MAX_CONSOLE = __MAX_CONSOLE__

HERE = os.path.dirname(os.path.abspath(__file__))
TESTS = os.path.join(HERE, "tests.json")

with open(TESTS) as handle:
    tests = json.load(handle)
try:
    os.unlink(TESTS)
except OSError:
    pass

out = open(os.path.join(HERE, "results.ndjson"), "w")


def emit(record):
    # default=repr: giá trị không serialize được (set, object) thành chuỗi thay vì làm chết
    # driver — host sẽ chấm nó là sai kết quả, đúng như một bài trả sai kiểu đáng nhận.
    out.write(json.dumps(record, default=repr) + "\\n")
    out.flush()


class Expired(Exception):
    pass


def expire(signum, frame):
    raise Expired()


signal.signal(signal.SIGALRM, expire)

captured = io.StringIO()
real_stdout = sys.stdout
sys.stdout = captured

try:
    # Vòng lặp vô hạn ở cấp module cũng phải bị cắt, không chỉ vòng lặp trong hàm.
    signal.setitimer(signal.ITIMER_REAL, TIME_LIMIT)
    import solution
    fn = getattr(solution, FUNC_NAME)
    if not callable(fn):
        raise TypeError(FUNC_NAME + " không phải là hàm")
except BaseException:
    sys.stdout = real_stdout
    emit({"fatal": "load_error", "message": traceback.format_exc(limit=3)})
    out.close()
    sys.stdout.write(captured.getvalue()[:MAX_CONSOLE])
    sys.exit(0)
finally:
    signal.setitimer(signal.ITIMER_REAL, 0)

for test in tests:
    signal.setitimer(signal.ITIMER_REAL, TIME_LIMIT)
    started = time.perf_counter()
    try:
        record = {"id": test["id"], "status": "ok", "actual": fn(*test["args"])}
    except Expired:
        record = {"id": test["id"], "status": "timeout"}
    except BaseException:
        # BaseException chứ không phải Exception: `sys.exit()` trong bài của học viên phải
        # thành lỗi khi chạy, không được lặng lẽ kết thúc cả lượt chấm.
        record = {"id": test["id"], "status": "runtime_error",
                  "message": traceback.format_exc(limit=3)}
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
    record["runtime_ms"] = round((time.perf_counter() - started) * 1000, 2)
    emit(record)

sys.stdout = real_stdout
out.close()
sys.stdout.write(captured.getvalue()[:MAX_CONSOLE])
'''


def files(spec: DriverSpec) -> dict[str, str]:
    return {
        "driver.py": fill(
            _DRIVER,
            func=spec.function_name,
            limit=repr(spec.time_limit_sec),
            max_console=str(MAX_CONSOLE_BYTES),
        )
    }


RUNNER = LanguageRunner(
    solution_file="solution.py",
    compile_cmd=None,
    run_cmd=["python3", "driver.py"],
    starter=starter,
    files=files,
    per_case_timeout=True,
)
