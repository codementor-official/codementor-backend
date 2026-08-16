# judge-service

Chạy và chấm code trong sandbox Docker. **Python/FastAPI**, không phải NestJS như 8 service
còn lại.

Engine chấm được port từ `code-runner` — kể cả các comment ghi lại kết quả đo thật (vì sao
`max_pool_size=128`, vì sao tmpfs là 256m, vì sao `peak_memory_mb` thường rỗng). Đừng gỡ
chúng khi dọn code: mỗi con số ở đó là một lần đã thử và đã sai.

## Chạy

Judge **không** nằm trong `nest build`, `eslint` hay `jest` của monorepo — nó bị loại khỏi
`nest-cli.json`, `build:all` và mảng `APPS` trong `eslint.config.mjs`. Mọi thứ đi qua script
`judge:*` ở `codementor-backend/package.json`:

```bash
npm run judge:install   # uv sync
npm run judge:images    # build 6 image sandbox — chạy MỘT LẦN trước khi dev
npm run judge:dev       # uvicorn --reload, cổng 3007
npm run judge:test      # pytest (bỏ qua test cần Docker)
npm run judge:lint      # ruff
```

Test cần container thật đánh dấu `docker`:

```bash
cd apps/judge-service
uv run pytest -m docker        # chấm thật, cần daemon + 6 image
uv run pytest -m "not docker"  # chỉ chính sách chấm, chạy được ở CI không có daemon
```

## Hai cửa vào, một engine

```
POST /api/v1/judge/run                 cmd.judge.run.v1  (Kafka)
        │                                        │
        │                                evt.judge.started.v1
        │                                        │
        └──────────► app.grading.grade() ◄───────┘
                              │
                    ┌─────────┴──────────┐
              trả JSON ngay      ghi Mongo → evt.judge.completed.v1
```

`POST /run` là đường "chạy thử": trả kết quả đồng bộ, không ghi Mongo, không phát event. Nó
tồn tại vì `submission-service` hiện còn rỗng — chưa ai phát `cmd.judge.run.v1`, nên nếu chỉ
nghe Kafka thì judge không nhận được việc nào.

Kafka là đường bài nộp thật: nhận `cmd.judge.run.v1`, phát `started`, chấm, ghi
`submission_run_details` trong Mongo, phát `completed` kèm `runDetailRef`.

## Hai chế độ chấm

Rẽ nhánh theo sự hiện diện của `spec` trong payload — **không** theo một cột `io_mode`. Bài
soạn trước khi có chế độ hàm không mang `spec`, nên chúng chạy đúng đường cũ mà không phải
migrate gì.

| | `stdin_stdout` (không có `spec`) | `function` (có `spec`) |
|---|---|---|
| Học viên viết | cả chương trình, kể cả phần đọc input | chỉ thân hàm |
| Đầu vào | `input` dạng chuỗi, qua stdin | `args`, mảng theo vị trí |
| Đáp án | so chuỗi stdout, bỏ khoảng trắng hai đầu | so **giá trị** theo `comparator.py` |
| Container | một cho MỖI test case | một cho CẢ bài nộp |
| stdout của học viên | *chính là* bài nộp | console gỡ lỗi, trả về ở `consoleOutput` |
| Verdict riêng | — | `skipped` (container chết trước khi case chạy) |

### Đáp án không vào sandbox

Khác đặc tả gốc: `tests.json` mount vào container chỉ chứa `{id, args}`. Driver trả `actual`
thô, so sánh chạy phía host. Hệ quả: trong container không có đáp án để lộ, và mỗi ngôn ngữ
mới chỉ phải viết driver chứ không viết lại phần so sánh.

Driver vẫn xoá `tests.json` trước khi `import solution` — lớp phụ, không phải lớp chống đỡ
chính.

**Ceiling đã biết:** driver và code học viên chạy cùng tiến trình, nên học viên đủ quyết tâm
vẫn ghi đè được `results.ndjson`. Chế độ stdin cũ không khá hơn (stdout của họ *là* đáp án
nộp lên). Chặn thật cần tách tiến trình mỗi case hoặc lọc AST — làm khi judge phục vụ ngoài
phạm vi lớp học.

### Tám ngôn ngữ, tám driver

Mỗi ngôn ngữ là một module trong `app/services/langs/`, và module đó giữ **cả** bảng ánh xạ
kiểu, **cả** starter code, **cả** driver. Đặt chung một chỗ vì chữ ký trong starter phải khớp
tuyệt đối với chữ ký driver gọi — lệch một chút là học viên nhận bài không thể giải đúng.

| | Biên dịch | JSON | Timeout mỗi case | Ghi chú |
|---|---|---|---|---|
| Python | — | stdlib | `signal.setitimer` | |
| JavaScript | — | stdlib | không | driver `new Function`, không `require` |
| TypeScript | `tsc` | stdlib | không | dịch ra `solution.js` rồi dùng chung driver JS |
| Java | `javac` | **Gson** (trong image) | không | bài là `class Solution`, driver là `Main` |
| Go | `go build` | stdlib | goroutine + `select` | goroutine hết giờ không giết được |
| PHP | `php -l` | stdlib | không | `-l` để lỗi cú pháp ra `compile_error` |
| C | `gcc` | **cJSON** (apt) | `setitimer` + `sigsetjmp` | ánh xạ kiểu KHÔNG một-đối-một |
| C++ | `g++` | **nlohmann** (header) | không | `siglongjmp` bỏ qua destructor nên không dùng |

**C là ngoại lệ về kiểu:** `list<int>` thành hai tham số (`int* nums, int numsSize`), trả mảng
thì thêm `int* returnSize`. Đây là quy ước LeetCode dùng cho C. `map` và `optional` không hỗ
trợ — `POST /judge/starter` trả chúng trong `unsupported` để người ra đề biết ngay lúc soạn.

### Giới hạn thời gian, hai tầng

Chỉ Python, Go và C cắt được một case đang chạy quá giờ → case đó `timeout`, các case sau
**vẫn chạy**. Java, C++, JavaScript, TypeScript, PHP không có cơ chế đó; ở chúng một case
*chậm* vẫn bị bắt nhờ đối chiếu `runtime_ms` phía host sau khi chạy xong.

Case treo hẳn thì container bị giết cứng (`time_limit × n + startup`) → case đầu tiên thiếu
bản ghi nhận `timeout`/`memory_exceeded`, phần còn lại `skipped`. Driver flush sau mỗi case
chính là để phần đã chạy xong không mất.

### Mã khởi tạo cũng sinh ở đây

`POST /api/v1/judge/starter` nhận chữ ký, trả mã khởi tạo cho từng ngôn ngữ. Frontend gọi nó
thay vì tự sinh: một bảng ánh xạ kiểu thứ hai viết bằng TypeScript chắc chắn sẽ lệch với
driver, và lúc lệch thì không ai phát hiện cho tới khi có học viên nộp bài.

## Bảo mật

**Tiến trình này giữ `/var/run/docker.sock`, và đó là quyền tương đương root trên host.**

Code học viên không chạm được socket đó — nó chạy trong container ephemeral riêng, không có
mạng, không phải root, rootfs chỉ đọc, bỏ hết capability, giới hạn pid/RAM/CPU. Nhưng bất kỳ
lỗ hổng thực thi mã nào trong **chính judge** đều đổi được thành chiếm máy chủ. Ba ràng buộc,
không cái nào là tuỳ chọn:

1. **`/run` bắt buộc xác thực.** Kong ở dự án này không có plugin JWT, nên judge tự kiểm token
   Keycloak (`app/auth.py`, cùng JWKS endpoint mà `libs/platform/.../keycloak.strategy.ts`
   dùng). Bỏ dependency `require_user` nghĩa là ai gọi được `:8000` cũng chạy được lệnh trên
   máy chủ.
2. **Giới hạn đầu vào** — `MAX_SOURCE_BYTES`, `MAX_TEST_CASES`, `MAX_TEST_CASE_BYTES` trong
   `app/config.py`. Không có chúng thì một request là một cách làm cạn host.
3. **Trên EC2, judge chạy máy riêng.** Cùng host với các service khác nghĩa là socket Docker
   nằm cạnh dữ liệu người dùng.

Sandbox mỗi lần chạy: `network=none`, `user=1000:1000`, `cap_drop=ALL`,
`no-new-privileges`, `read_only`, `tmpfs /tmp 256m`, `pids_limit=64`, `mem_limit` theo bài,
`nano_cpus=0.5e9`.

## Giới hạn đo lường

`memoryKb` **thường là 0**, và đó không phải lỗi. Docker chỉ trả số liệu tài nguyên qua
`container.stats()`, mà lệnh đó mất 1–2 giây trong dockerd mới có số thật — trong khi
container của một bài AC/WA/RE điển hình sống 200–700ms và đã biến mất trước đó. Bài chạy lâu
(TLE) thì có số. Judge0 không vướng chuyện này vì `isolate` đọc cgroup đồng bộ ngay sau khi
tiến trình thoát.

`memory_exceeded` thì vẫn phát hiện được: nó đọc cờ `OOMKilled` của daemon, không phụ thuộc
vào việc lấy mẫu kịp hay không.

## Judge0

`app/services/judge0_client.py` được giữ nguyên và cấu hình sẵn (`JUDGE0_URL`), nhưng
**không ai gọi**: `EXECUTION_ENGINE` mặc định là `docker`. Judge0 dựa vào `isolate`, mà
`isolate` cần cgroup v1 trong khi máy dev hiện tại chạy cgroup v2. Đổi `EXECUTION_ENGINE=judge0`
là đủ để bật lại khi có host hợp lệ — `app/services/execution_engine.py` chỉ import engine
được chọn, nên chọn cái này không bao giờ khởi tạo cái kia.

## Ngôn ngữ hỗ trợ

`python`, `c`, `cpp`, `java`, `javascript`, `typescript`, `go`, `php` — bảng ở
`app/services/execution_config.py`. Tag image ở đó phải khớp với `scripts/build-images.sh`.
