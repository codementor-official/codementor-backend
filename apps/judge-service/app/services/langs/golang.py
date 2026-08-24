"""Go — bài học viên và driver là hai file cùng `package main`.

Một trong hai ngôn ngữ (cùng Python) cắt được từng test case hết giờ: hàm chạy trong goroutine
riêng và driver `select` giữa nó với `time.After`.

ponytail: goroutine hết giờ KHÔNG bị giết — Go không có cách giết goroutine, và nó tiếp tục
đốt CPU cho tới khi container kết thúc. Với `nano_cpus` 0.5 thì các case sau chạy chậm hơn
thật; đó là lý do `runtime_ms` của chúng vẫn được đối chiếu với giới hạn phía host. Muốn sạch
hẳn thì phải một tiến trình cho mỗi case, đắt hơn nhiều so với giá trị nhận lại.
"""

from app.services.langs.base import (
    MAX_CONSOLE_BYTES,
    DriverSpec,
    LanguageRunner,
    UnsupportedType,
    camel,
    fill,
)

TYPES = {
    "int": "int",
    "long": "int64",
    "float": "float64",
    "bool": "bool",
    "string": "string",
}


def type_of(node: dict | None) -> str:
    if not node:
        raise UnsupportedType("thiếu kiểu")
    kind = node.get("kind", "")
    if kind == "list":
        return f"[]{type_of(node.get('of'))}"
    if kind == "map":
        return f"map[{type_of(node.get('key'))}]{type_of(node.get('value'))}"
    if kind == "optional":
        # Go không có Optional; con trỏ là cách duy nhất diễn tả "có thể là nil".
        return f"*{type_of(node.get('of'))}"
    if kind not in TYPES:
        raise UnsupportedType(f"Go chưa hỗ trợ kiểu {kind!r}")
    return TYPES[kind]


def starter(spec: DriverSpec) -> str:
    args = ", ".join(f"{p.name} {type_of(p.type)}" for p in spec.parameters)
    void = spec.return_type.get("kind") == "void"
    returns = "" if void else f" {type_of(spec.return_type)}"
    body = "\t// Viết code của bạn ở đây\n\tpanic(\"TODO: implement solution\")\n"
    return f"package main\n\nfunc {camel(spec.function_name)}({args}){returns} {{\n{body}}}\n"


_DRIVER = '''\
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"time"
)

const maxConsole = __MAX_CONSOLE__

type testCase struct {
	ID   int               `json:"id"`
	Args []json.RawMessage `json:"args"`
}

func main() {
	raw, err := os.ReadFile("tests.json")
	if err != nil {
		panic(err)
	}
	os.Remove("tests.json")

	var tests []testCase
	if err := json.Unmarshal(raw, &tests); err != nil {
		panic(err)
	}

	out, err := os.Create("results.ndjson")
	if err != nil {
		panic(err)
	}

	emit := func(record map[string]interface{}) {
		line, _ := json.Marshal(record)
		out.Write(line)
		out.Write([]byte("\\n"))
		out.Sync()
	}

	// Nuốt stdout của học viên qua một pipe. fmt.Println đọc os.Stdout ở mỗi lần gọi, nên
	// gán lại biến này là đủ; phải có goroutine hút liên tục, không thì pipe đầy và bài của
	// học viên treo ngay lần in thứ vài nghìn.
	realOut := os.Stdout
	reader, writer, _ := os.Pipe()
	os.Stdout = writer
	var captured bytes.Buffer
	drained := make(chan struct{})
	go func() {
		io.Copy(&captured, reader)
		close(drained)
	}()

	for _, test := range tests {
		record := map[string]interface{}{"id": test.ID}
		if len(test.Args) != __ARITY__ {
			record["status"] = "runtime_error"
			record["message"] = fmt.Sprintf("cần __ARITY__ tham số, nhận %d", len(test.Args))
			emit(record)
			continue
		}
__DECODE__
		started := time.Now()
		done := make(chan map[string]interface{}, 1)
		go func() {
			defer func() {
				if failure := recover(); failure != nil {
					done <- map[string]interface{}{
						"status":  "runtime_error",
						"message": fmt.Sprint(failure),
					}
				}
			}()
__CALL__
		}()
		select {
		case outcome := <-done:
			for key, value := range outcome {
				record[key] = value
			}
		case <-time.After(time.Duration(__LIMIT_MS__) * time.Millisecond):
			record["status"] = "timeout"
		}
		record["runtime_ms"] = float64(time.Since(started).Microseconds()) / 1000
		emit(record)
	}

	os.Stdout = realOut
	writer.Close()
	<-drained
	out.Close()
	text := captured.String()
	if len(text) > maxConsole {
		text = text[:maxConsole]
	}
	realOut.WriteString(text)
}
'''


def _decode(spec: DriverSpec) -> str:
    lines: list[str] = []
    for index, parameter in enumerate(spec.parameters):
        lines.append(f"\t\tvar p{index} {type_of(parameter.type)}")
        lines.append(f"\t\tif err := json.Unmarshal(test.Args[{index}], &p{index}); err != nil {{")
        lines.append('\t\t\trecord["status"] = "runtime_error"')
        lines.append(
            f'\t\t\trecord["message"] = "tham số {parameter.name} sai kiểu: " + err.Error()'
        )
        lines.append("\t\t\temit(record)")
        lines.append("\t\t\tcontinue")
        lines.append("\t\t}")
    return "\n".join(lines)


def _call(spec: DriverSpec) -> str:
    arguments = ", ".join(f"p{index}" for index in range(len(spec.parameters)))
    invocation = f"{camel(spec.function_name)}({arguments})"
    if spec.return_type.get("kind") == "void":
        return (
            f"\t\t\t{invocation}\n"
            '\t\t\tdone <- map[string]interface{}{"status": "ok", "actual": nil}'
        )
    return f'\t\t\tdone <- map[string]interface{{}}{{"status": "ok", "actual": {invocation}}}'


def files(spec: DriverSpec) -> dict[str, str]:
    return {
        "driver.go": fill(
            _DRIVER,
            max_console=str(MAX_CONSOLE_BYTES),
            arity=str(len(spec.parameters)),
            decode=_decode(spec),
            call=_call(spec),
            limit_ms=str(int(spec.time_limit_sec * 1000)),
        )
    }


RUNNER = LanguageRunner(
    solution_file="solution.go",
    # Liệt kê file tường minh: thư mục không có go.mod, và `go build` chỉ chấp nhận điều đó
    # khi được đưa thẳng danh sách file.
    compile_cmd=["go", "build", "-o", "main", "driver.go", "solution.go"],
    run_cmd=["./main"],
    starter=starter,
    files=files,
    per_case_timeout=True,
)
