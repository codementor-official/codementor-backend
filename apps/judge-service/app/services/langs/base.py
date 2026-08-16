"""Phần dùng chung của mọi bộ sinh driver.

Mỗi ngôn ngữ là một module trong gói này và tự giữ **bảng ánh xạ kiểu của riêng nó**, ngay
cạnh driver và starter code của chính nó. Đặc tả đòi một module `type_mapping` duy nhất; ở
đây không làm vậy, có lý do:

- Ánh xạ không cùng hình dạng. C phải tách `list<int>` thành hai tham số (`int* a, int aSize`)
  và trả mảng qua `int* returnSize`; các ngôn ngữ khác thì một-đối-một. Một bảng chung phải
  gánh cả hai hình dạng, tức là nó không còn là bảng.
- Ràng buộc thật sự cần giữ là **starter code và driver phải khớp nhau tuyệt đối** — nếu lệch,
  học viên nhận một bài không thể nào giải đúng. Đặt hai thứ đó cạnh nhau trong cùng một file
  giữ được ràng buộc ấy; đặt chúng ở hai module thì không.
"""

from collections.abc import Callable
from dataclasses import dataclass

# Ngân sách khởi động cộng vào trần cứng của container khi CHẠY (biên dịch là bước riêng, có
# timeout riêng). JVM tốn nhiều nhất, ~0.3s; 10s là dư cho mọi runtime ở đây.
STARTUP_BUDGET_SEC = 10

MAX_CONSOLE_BYTES = 10_240


class UnsupportedType(Exception):
    """Kiểu không diễn tả được ở ngôn ngữ này (ví dụ `map` trong C)."""


@dataclass(frozen=True)
class Param:
    name: str
    type: dict


@dataclass(frozen=True)
class DriverSpec:
    """Chữ ký + giới hạn, đủ để sinh cả starter code lẫn driver."""

    function_name: str
    parameters: tuple[Param, ...]
    return_type: dict
    time_limit_sec: float = 1.0


@dataclass(frozen=True)
class LanguageRunner:
    """Cách chạy một ngôn ngữ ở chế độ hàm.

    `files` trả về mọi file driver cần ghi vào workspace (thường một, TypeScript hai). Bài của
    học viên được ghi riêng vào `solution_file`.
    """

    solution_file: str
    compile_cmd: list[str] | None
    run_cmd: list[str]
    starter: Callable[[DriverSpec], str]
    files: Callable[[DriverSpec], dict[str, str]]
    #: `True` khi driver tự cắt được từng test case hết giờ. Ngôn ngữ không có cột này chỉ
    #: dựa vào trần cứng của container + đối chiếu thời gian sau khi chạy — xem README.
    per_case_timeout: bool = False


def fill(template: str, **values: str) -> str:
    """Thay `__TÊN__` trong template.

    Không dùng `str.format`: template ở đây là Java, C, Go, JavaScript — toàn dấu ngoặc nhọn,
    mà `format` bắt phải nhân đôi từng cái. Một template C sau khi escape thì không ai đọc nổi
    nữa, và không copy ra file .c để thử được.
    """
    for key, value in values.items():
        template = template.replace(f"__{key.upper()}__", value)
    return template


def camel(snake: str) -> str:
    """`solve_quadratic` → `solveQuadratic`. Tên lưu ở dạng snake_case, đây là bản dịch."""
    head, *rest = snake.split("_")
    return head + "".join(word[:1].upper() + word[1:] for word in rest)
