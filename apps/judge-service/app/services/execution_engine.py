"""Cửa duy nhất dẫn tới engine đang được chọn.

Chỉ module của engine được chọn mới được import: chọn "docker" thì không bao giờ dựng HTTP
client của Judge0, chọn "judge0" thì không bao giờ gọi docker.from_env(). Nhờ vậy thiếu Docker
daemon không làm sập tiến trình khi đang chạy Judge0, và ngược lại.

Judge0 hiện KHÔNG dùng được trên máy dev: nó dựa vào `isolate`, mà `isolate` cần cgroup v1
trong khi host này chạy cgroup v2. Code và cấu hình giữ nguyên để bật lại khi có máy hợp lệ —
đổi EXECUTION_ENGINE là đủ, không phải sửa chỗ gọi.
"""

from app.config import settings

if settings.execution_engine == "docker":
    from app.services.docker_executor import ExecutionError as ExecutionError
    from app.services.docker_executor import run_against_testcases as run_against_testcases
else:  # "judge0" — Settings.execution_engine là Literal nên pydantic đã chặn giá trị lạ
    # ngay lúc khởi động, trước khi module này chạy.
    from app.services.judge0_client import Judge0Error as ExecutionError  # noqa: F401
    from app.services.judge0_client import run_against_testcases as run_against_testcases
