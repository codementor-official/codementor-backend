"""Java — bài học viên là `class Solution`, driver là `Main` gọi thẳng phương thức.

Gọi thẳng chứ không qua reflection: nếu chữ ký học viên viết lệch với chữ ký đề ra, ta muốn
`javac` từ chối ngay và verdict là `compile_error`. Reflection sẽ đẩy cùng lỗi đó xuống thành
`NoSuchMethodException` lúc chạy, tức là một thông báo tệ hơn cho đúng một sai lầm.

Java **không có JSON trong thư viện chuẩn**, nên image runner mang theo Gson (xem
`docker/java.Dockerfile`). Tự viết bộ parse JSON ở đây thì đó là 150 dòng làm lại đúng thứ đã
tồn tại.

Không có timeout theo từng case: giết một luồng Java đang quay vòng lặp là chuyện không làm
an toàn được (`Thread.stop` đã bị gỡ). Một case treo sẽ chạm trần cứng của container; các case
sau nhận `skipped`. Case chỉ *chậm* vẫn bị bắt, nhờ đối chiếu `runtime_ms` phía host.
"""

from app.services.langs.base import (
    MAX_CONSOLE_BYTES,
    DriverSpec,
    LanguageRunner,
    UnsupportedType,
    camel,
    fill,
)

PRIMITIVES = {
    "int": "int",
    "long": "long",
    "float": "double",
    "bool": "boolean",
    "string": "String",
    "void": "void",
}

# Kiểu bọc, cho chỗ generic không nhận kiểu nguyên thuỷ (`Map<String, Integer>`).
BOXED = {
    "int": "Integer",
    "long": "Long",
    "float": "Double",
    "bool": "Boolean",
    "string": "String",
}


def type_of(node: dict | None, boxed: bool = False) -> str:
    if not node:
        raise UnsupportedType("thiếu kiểu")
    kind = node.get("kind", "")
    if kind == "list":
        return f"{type_of(node.get('of'))}[]"
    if kind == "map":
        key = type_of(node.get("key"), boxed=True)
        value = type_of(node.get("value"), boxed=True)
        return f"Map<{key}, {value}>"
    if kind == "optional":
        # Java diễn tả "có thể vắng" bằng kiểu bọc: `Integer` nhận null, `int` thì không.
        return type_of(node.get("of"), boxed=True)
    table = BOXED if boxed else PRIMITIVES
    if kind not in table:
        raise UnsupportedType(f"Java chưa hỗ trợ kiểu {kind!r}")
    return table[kind]


def _is_generic(node: dict | None) -> bool:
    return bool(node) and node.get("kind") == "map"


def _gson_target(node: dict) -> str:
    """Đối số thứ hai của `gson.fromJson`.

    Kiểu generic bị xoá lúc chạy nên `Map<String,Integer>.class` không tồn tại — Gson giải bài
    này bằng `TypeToken`. Kiểu không generic thì literal `.class` gọn hơn và đọc dễ hơn.
    """
    if _is_generic(node):
        return f"new TypeToken<{type_of(node)}>(){{}}.getType()"
    return f"{type_of(node)}.class"


def starter(spec: DriverSpec) -> str:
    args = ", ".join(f"{type_of(p.type)} {p.name}" for p in spec.parameters)
    returns = type_of(spec.return_type)
    body = (
        "        // Viết code của bạn ở đây\n"
        if returns == "void"
        # `javac` từ chối một phương thức có kiểu trả về mà không return. Mã khởi tạo phải
        # dịch được, nếu không lần bấm "Chạy" đầu tiên báo lỗi của chúng ta chứ không phải
        # của học viên.
        else (
            "        // Viết code của bạn ở đây\n"
            '        throw new UnsupportedOperationException("Chưa cài đặt");\n'
        )
    )
    return (
        "import java.util.*;\n\n"
        "class Solution {\n"
        f"    public {returns} {camel(spec.function_name)}({args}) {{\n"
        f"{body}"
        "    }\n"
        "}\n"
    )


_DRIVER = '''\
import com.google.gson.*;
import com.google.gson.reflect.TypeToken;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

public class Main {
    static final int MAX_CONSOLE = __MAX_CONSOLE__;

    static String describe(Throwable error) {
        StringWriter buffer = new StringWriter();
        error.printStackTrace(new PrintWriter(buffer));
        String text = buffer.toString();
        return text.length() > 2000 ? text.substring(0, 2000) : text;
    }

    static String console(ByteArrayOutputStream captured) {
        String text = new String(captured.toByteArray(), StandardCharsets.UTF_8);
        return text.length() > MAX_CONSOLE ? text.substring(0, MAX_CONSOLE) : text;
    }

    public static void main(String[] unused) throws Exception {
        Path here = Paths.get("").toAbsolutePath();
        Path testsPath = here.resolve("tests.json");
        String raw = new String(Files.readAllBytes(testsPath), StandardCharsets.UTF_8);
        try {
            Files.deleteIfExists(testsPath);
        } catch (IOException ignored) {
            // File test biến mất sớm cũng không sao.
        }

        Gson gson = new Gson();
        JsonArray tests = JsonParser.parseString(raw).getAsJsonArray();
        BufferedWriter out = Files.newBufferedWriter(here.resolve("results.ndjson"));

        // Nuốt stdout của học viên: kết quả chấm đi qua file, System.out chỉ là console gỡ lỗi.
        PrintStream realOut = System.out;
        ByteArrayOutputStream captured = new ByteArrayOutputStream();
        System.setOut(new PrintStream(captured, true, "UTF-8"));

        Solution solution;
        try {
            solution = new Solution();
        } catch (Throwable error) {
            System.setOut(realOut);
            JsonObject record = new JsonObject();
            record.addProperty("fatal", "load_error");
            record.addProperty("message", describe(error));
            out.write(record.toString());
            out.newLine();
            out.flush();
            out.close();
            realOut.print(console(captured));
            return;
        }

        for (JsonElement element : tests) {
            JsonObject test = element.getAsJsonObject();
            JsonArray args = test.getAsJsonArray("args");
            JsonObject record = new JsonObject();
            record.add("id", test.get("id"));
            long started = System.nanoTime();
            try {
__CALL__
            } catch (Throwable error) {
                // Throwable chứ không phải Exception: StackOverflowError và OutOfMemoryError
                // là Error, mà đệ quy vô hạn là lỗi học viên hay mắc nhất.
                record.addProperty("status", "runtime_error");
                record.addProperty("message", describe(error));
            }
            record.addProperty("runtime_ms", (System.nanoTime() - started) / 1e6);
            out.write(record.toString());
            out.newLine();
            out.flush();
        }

        System.setOut(realOut);
        out.close();
        realOut.print(console(captured));
    }
}
'''


def _call(spec: DriverSpec) -> str:
    arguments = ", ".join(
        f"gson.fromJson(args.get({index}), {_gson_target(parameter.type)})"
        for index, parameter in enumerate(spec.parameters)
    )
    invocation = f"solution.{camel(spec.function_name)}({arguments})"
    indent = " " * 16
    if spec.return_type.get("kind") == "void":
        return (
            f"{indent}{invocation};\n"
            f'{indent}record.addProperty("status", "ok");\n'
            f'{indent}record.add("actual", JsonNull.INSTANCE);'
        )
    return (
        f"{indent}Object value = {invocation};\n"
        f'{indent}record.addProperty("status", "ok");\n'
        f'{indent}record.add("actual", gson.toJsonTree(value));'
    )


def files(spec: DriverSpec) -> dict[str, str]:
    return {"Main.java": fill(_DRIVER, max_console=str(MAX_CONSOLE_BYTES), call=_call(spec))}


GSON = "/opt/gson.jar"

RUNNER = LanguageRunner(
    solution_file="Solution.java",
    compile_cmd=["javac", "-cp", GSON, "Solution.java", "Main.java"],
    run_cmd=["java", "-cp", f".:{GSON}", "Main"],
    starter=starter,
    files=files,
)
