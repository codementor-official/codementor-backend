"""Luật thiết kế chứng chỉ v1 (ADR 0005) — bản cho Lecter tự kiểm trước khi đề xuất.

Mirror của `apps/learning-service/src/contexts/certificate/domain/certificate-design.ts` (API là
chốt chặn cuối) và `codementor-frontend/packages/ui/src/certificate/design.ts`. Đổi luật thì đổi
cả ba. Hàm thuần, không I/O.
"""

import re
from typing import Any

LAYOUTS = ("classic", "modern", "minimal")
ACCENTS = ("orange", "ink", "emerald", "blue", "violet")
PLACEHOLDERS = (
    "learnerName",
    "subjectKind",
    "subjectTitle",
    "instructorName",
    "startedAt",
    "completedAt",
    "durationHours",
    "issuedAt",
    "certificateCode",
)
MAX_FIELDS = 6
LIMITS = {
    "heading": (2, 80),
    "body": (10, 400),
    "signerName": (0, 80),
    "signerTitle": (0, 80),
    "label": (1, 40),
    "value": (1, 120),
}
_PLACEHOLDER = re.compile(r"\{\{\s*([^{}]*?)\s*\}\}")


def unknown_placeholders(text: str) -> list[str]:
    unknown = [name for name in _PLACEHOLDER.findall(text) if name not in PLACEHOLDERS]
    stray = _PLACEHOLDER.sub("", text)
    if "{{" in stray or "}}" in stray:
        unknown.append("{{…}} không đóng")
    return unknown


def _text(errors: list[str], label: str, value: Any, limits: tuple[int, int], optional: bool = False) -> None:
    low, high = limits
    if value is None or value == "":
        if not optional and low > 0:
            errors.append(f"{label}: bắt buộc")
        return
    if not isinstance(value, str):
        errors.append(f"{label}: phải là chuỗi")
        return
    trimmed = value.strip()
    if not low <= len(trimmed) <= high:
        errors.append(f"{label}: dài {low}–{high} ký tự")
    unknown = unknown_placeholders(trimmed)
    if unknown:
        errors.append(f"{label}: ô điền không hợp lệ {', '.join(unknown)}")


def check_design(design: Any) -> list[str]:
    """Danh sách lỗi; rỗng = API sẽ nhận. Ảnh logo/chữ ký Lecter không đặt được — để trống."""
    if not isinstance(design, dict):
        return ["Thiết kế phải là một object"]
    errors: list[str] = []
    if design.get("version") != 1:
        errors.append("version: chỉ hỗ trợ 1")
    if design.get("layout") not in LAYOUTS:
        errors.append(f"layout: một trong {', '.join(LAYOUTS)}")
    if design.get("accent") not in ACCENTS:
        errors.append(f"accent: một trong {', '.join(ACCENTS)}")
    _text(errors, "Tiêu đề", design.get("heading"), LIMITS["heading"])
    _text(errors, "Nội dung", design.get("body"), LIMITS["body"])
    _text(errors, "Người ký", design.get("signerName"), LIMITS["signerName"])
    _text(errors, "Chức danh", design.get("signerTitle"), LIMITS["signerTitle"], optional=True)
    for key in ("logoUrl", "signatureUrl"):
        if design.get(key):
            errors.append(f"{key}: Lecter không đặt ảnh — bỏ trường này, giảng viên tự tải ảnh lên")

    fields = design.get("fields", [])
    if not isinstance(fields, list):
        errors.append("fields: phải là danh sách")
        return errors
    if len(fields) > MAX_FIELDS:
        errors.append(f"fields: tối đa {MAX_FIELDS} dòng")
    for index, row in enumerate(fields[:MAX_FIELDS], start=1):
        row = row if isinstance(row, dict) else {}
        _text(errors, f"Dòng {index} — nhãn", row.get("label"), LIMITS["label"])
        _text(errors, f"Dòng {index} — giá trị", row.get("value"), LIMITS["value"])
    return errors
