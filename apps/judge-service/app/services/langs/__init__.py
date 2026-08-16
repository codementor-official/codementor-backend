"""Sổ đăng ký ngôn ngữ chạy được ở chế độ chữ ký hàm.

Khoá trùng với `LANGUAGE_CONFIG` (execution_config.py) — cùng một ngôn ngữ, hai chế độ chạy,
một tên. Image sandbox lấy từ `LANGUAGE_CONFIG`; ở đây chỉ mô tả cách bọc driver quanh bài của
học viên.
"""

from app.services.langs import c, cpp, golang, java, node, php, python
from app.services.langs.base import (
    MAX_CONSOLE_BYTES,
    STARTUP_BUDGET_SEC,
    DriverSpec,
    LanguageRunner,
    Param,
    UnsupportedType,
)

RUNNERS: dict[str, LanguageRunner] = {
    "python": python.RUNNER,
    "javascript": node.JAVASCRIPT,
    "typescript": node.TYPESCRIPT,
    "java": java.RUNNER,
    "go": golang.RUNNER,
    "php": php.RUNNER,
    "c": c.RUNNER,
    "cpp": cpp.RUNNER,
}


def starter_for(language: str, spec: DriverSpec) -> str:
    """Mã khởi tạo của một ngôn ngữ.

    Ném `UnsupportedType` khi chữ ký dùng kiểu ngôn ngữ đó không diễn tả được (`map` trong C
    chẳng hạn) — người ra đề cần biết điều đó lúc soạn, không phải lúc học viên nộp bài.
    """
    runner = RUNNERS.get(language)
    if runner is None:
        raise UnsupportedType(f"chế độ hàm chưa hỗ trợ ngôn ngữ {language!r}")
    return runner.starter(spec)


__all__ = [
    "MAX_CONSOLE_BYTES",
    "RUNNERS",
    "STARTUP_BUDGET_SEC",
    "DriverSpec",
    "LanguageRunner",
    "Param",
    "UnsupportedType",
    "starter_for",
]
