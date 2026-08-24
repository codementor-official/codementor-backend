"""JavaScript và TypeScript — cùng một driver, khác bước biên dịch.

Driver KHÔNG `require('./solution.js')`: khai báo `function f(){}` ở cấp cao nhất của một
module CommonJS không được xuất ra, nên `require` sẽ trả về object rỗng và mọi bài đều
"không tìm thấy hàm". Thay vào đó driver đọc mã nguồn rồi dựng nó bằng `new Function`, chỗ mà
khai báo hàm được hoisting bình thường — học viên không phải viết `module.exports` gì cả.

TypeScript đi qua `tsc` trước để `solution.ts` thành `solution.js`; từ đó trở đi hai ngôn ngữ
giống hệt nhau.
"""

from app.services.langs.base import (
    MAX_CONSOLE_BYTES,
    DriverSpec,
    LanguageRunner,
    camel,
    fill,
)

TS_TYPES = {
    "int": "number",
    "long": "number",
    "float": "number",
    "bool": "boolean",
    "string": "string",
    "void": "void",
}


def ts_type(node: dict | None) -> str:
    if not node:
        return "unknown"
    kind = node.get("kind")
    if kind == "list":
        inner = ts_type(node.get("of"))
        # `(number | null)[]` chứ không phải `number | null[]` — dấu ngoặc là bắt buộc khi
        # phần tử là union.
        return f"({inner})[]" if "|" in inner else f"{inner}[]"
    if kind == "map":
        return f"Record<{ts_type(node.get('key'))}, {ts_type(node.get('value'))}>"
    if kind == "optional":
        return f"{ts_type(node.get('of'))} | null"
    return TS_TYPES.get(kind or "", "unknown")


def js_starter(spec: DriverSpec) -> str:
    doc = "".join(f" * @param {{{ts_type(p.type)}}} {p.name}\n" for p in spec.parameters)
    returns = ts_type(spec.return_type)
    args = ", ".join(p.name for p in spec.parameters)
    return (
        f"/**\n{doc} * @return {{{returns}}}\n */\n"
        f"function {camel(spec.function_name)}({args}) {{\n"
        f"    // Viết code của bạn ở đây\n"
        f"}}\n"
    )


def ts_starter(spec: DriverSpec) -> str:
    args = ", ".join(f"{p.name}: {ts_type(p.type)}" for p in spec.parameters)
    returns = ts_type(spec.return_type)
    body = (
        "    // Viết code của bạn ở đây\n"
        '    throw new Error("TODO: implement solution");\n'
    )
    return f"function {camel(spec.function_name)}({args}): {returns} {{\n{body}}}\n"


_DRIVER = '''\
const fs = require("fs");
const path = require("path");

const FUNC_NAME = "__FUNC__";
const MAX_CONSOLE = __MAX_CONSOLE__;

const HERE = __dirname;
const TESTS = path.join(HERE, "tests.json");
const tests = JSON.parse(fs.readFileSync(TESTS, "utf8"));
try {
  fs.unlinkSync(TESTS);
} catch (ignored) {
  /* file test biến mất sớm cũng không sao */
}

const out = fs.openSync(path.join(HERE, "results.ndjson"), "w");
const emit = (record) => fs.writeSync(out, JSON.stringify(record) + "\\n");

// Nuốt stdout của học viên: kết quả chấm đi qua file, `console.log` chỉ là console gỡ lỗi.
let captured = "";
const realWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk) => {
  captured += chunk;
  return true;
};

const describe = (error) => String((error && error.stack) || error);

let fn;
try {
  const source = fs.readFileSync(path.join(HERE, "solution.js"), "utf8");
  const load = new Function(
    "require",
    "module",
    "exports",
    source +
      "\\n; return typeof " + FUNC_NAME +
      " === \\"function\\" ? " + FUNC_NAME + " : undefined;"
  );
  fn = load(require, module, exports);
  if (typeof fn !== "function") throw new Error(FUNC_NAME + " không phải là hàm");
} catch (error) {
  process.stdout.write = realWrite;
  emit({ fatal: "load_error", message: describe(error) });
  fs.closeSync(out);
  realWrite(captured.slice(0, MAX_CONSOLE));
  process.exit(0);
}

for (const test of tests) {
  const started = process.hrtime.bigint();
  let record;
  try {
    record = { id: test.id, status: "ok", actual: fn(...test.args) };
  } catch (error) {
    record = { id: test.id, status: "runtime_error", message: describe(error) };
  }
  record.runtime_ms = Number(process.hrtime.bigint() - started) / 1e6;
  emit(record);
}

process.stdout.write = realWrite;
fs.closeSync(out);
realWrite(captured.slice(0, MAX_CONSOLE));
'''


def files(spec: DriverSpec) -> dict[str, str]:
    return {
        "driver.js": fill(
            _DRIVER,
            func=camel(spec.function_name),
            max_console=str(MAX_CONSOLE_BYTES),
        )
    }


JAVASCRIPT = LanguageRunner(
    solution_file="solution.js",
    compile_cmd=None,
    run_cmd=["node", "driver.js"],
    starter=js_starter,
    files=files,
)

TYPESCRIPT = LanguageRunner(
    solution_file="solution.ts",
    # Cùng cờ với chế độ stdin (xem execution_config.py): thiếu `--types node` thì bất kỳ bài
    # nào chạm tới global của Node đều không dịch được.
    compile_cmd=[
        "tsc",
        "--typeRoots",
        "/opt/ts-types/node_modules/@types",
        "--types",
        "node",
        "solution.ts",
    ],
    run_cmd=["node", "driver.js"],
    starter=ts_starter,
    files=files,
)
