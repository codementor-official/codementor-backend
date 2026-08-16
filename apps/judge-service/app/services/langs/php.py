"""PHP — driver `require` bài của học viên rồi gọi hàm theo tên.

Lỗi cú pháp trong PHP là lỗi biên dịch fatal: `try/catch` quanh `require` KHÔNG bắt được, tiến
trình chết trước khi driver kịp ghi gì. Vì thế PHP có bước "biên dịch" riêng là `php -l` —
nhờ nó một bài sai cú pháp ra verdict `compile_error` kèm dòng lỗi, thay vì `timeout` không
giải thích được gì.

Không có timeout theo từng case; xem README §Giới hạn thời gian.
"""

from app.services.langs.base import (
    MAX_CONSOLE_BYTES,
    DriverSpec,
    LanguageRunner,
    camel,
    fill,
)

# PHP chỉ khai được kiểu vô hướng và `array`; kiểu phần tử sống trong docblock. Bảng này vì
# thế có hai cột: một cho khai báo, một cho chú thích.
DECLARED = {
    "int": "int",
    "long": "int",
    "float": "float",
    "bool": "bool",
    "string": "string",
    "void": "void",
}


def declared_type(node: dict | None) -> str:
    kind = (node or {}).get("kind", "")
    if kind in ("list", "map"):
        return "array"
    if kind == "optional":
        return "?" + declared_type(node.get("of"))
    return DECLARED.get(kind, "mixed")


def doc_type(node: dict | None) -> str:
    kind = (node or {}).get("kind", "")
    if kind == "list":
        return f"{doc_type(node.get('of'))}[]"
    if kind == "map":
        return f"array<{doc_type(node.get('key'))}, {doc_type(node.get('value'))}>"
    if kind == "optional":
        return f"{doc_type(node.get('of'))}|null"
    return DECLARED.get(kind, "mixed")


def starter(spec: DriverSpec) -> str:
    doc = "".join(f" * @param {doc_type(p.type)} ${p.name}\n" for p in spec.parameters)
    args = ", ".join(f"{declared_type(p.type)} ${p.name}" for p in spec.parameters)
    returns = declared_type(spec.return_type)
    return (
        "<?php\n\n"
        f"/**\n{doc} * @return {doc_type(spec.return_type)}\n */\n"
        f"function {camel(spec.function_name)}({args}): {returns}\n{{\n"
        "    // Viết code của bạn ở đây\n"
        "}\n"
    )


_DRIVER = '''\
<?php

$here = __DIR__;
$funcName = "__FUNC__";
$maxConsole = __MAX_CONSOLE__;

$tests = json_decode(file_get_contents("$here/tests.json"), true);
@unlink("$here/tests.json");

$out = fopen("$here/results.ndjson", "w");
$emit = function (array $record) use ($out) {
    $flags = JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION;
    fwrite($out, json_encode($record, $flags) . "\\n");
    fflush($out);
};

$describe = function (Throwable $error): string {
    return get_class($error) . ": " . $error->getMessage()
        . " (" . $error->getFile() . ":" . $error->getLine() . ")";
};

// Nuốt stdout của học viên: kết quả chấm đi qua file, echo chỉ là console gỡ lỗi.
ob_start();

try {
    require "$here/solution.php";
    if (!function_exists($funcName)) {
        throw new Error("$funcName không phải là hàm");
    }
} catch (Throwable $error) {
    $console = ob_get_clean();
    $emit(["fatal" => "load_error", "message" => $describe($error)]);
    fclose($out);
    echo substr($console, 0, $maxConsole);
    exit(0);
}

foreach ($tests as $test) {
    $started = hrtime(true);
    try {
        $actual = $funcName(...$test["args"]);
        $record = ["id" => $test["id"], "status" => "ok", "actual" => $actual];
    } catch (Throwable $error) {
        $record = [
            "id" => $test["id"],
            "status" => "runtime_error",
            "message" => $describe($error),
        ];
    }
    $record["runtime_ms"] = (hrtime(true) - $started) / 1e6;
    $emit($record);
}

$console = ob_get_clean();
fclose($out);
echo substr($console, 0, $maxConsole);
'''


def files(spec: DriverSpec) -> dict[str, str]:
    return {
        "driver.php": fill(
            _DRIVER,
            func=camel(spec.function_name),
            max_console=str(MAX_CONSOLE_BYTES),
        )
    }


RUNNER = LanguageRunner(
    solution_file="solution.php",
    compile_cmd=["php", "-l", "solution.php"],
    run_cmd=["php", "driver.php"],
    starter=starter,
    files=files,
)
