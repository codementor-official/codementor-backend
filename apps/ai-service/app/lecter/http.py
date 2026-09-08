"""Gọi backend Nest và judge bằng token của chính người dùng.

Đi thẳng tới cổng của service, không vòng lại Kong: mỗi service tự verify JWT Keycloak
(`kong/kong.yml` không có plugin jwt) nên forward header `Authorization` là đủ, và gọi thẳng thì
không phải hairpin ra gateway rồi quay lại.

Điều quan trọng nhất ở tệp này KHÔNG phải là gọi được, mà là **cắt ngắn** thứ trả về trước khi
đưa cho model. Một bài 50 testcase fail hết mà đổ nguyên vào context thì lượt sau không còn chỗ.
"""

import json
import logging
from typing import Any

import httpx
from langchain_core.runnables import RunnableConfig

from app.config import settings

logger = logging.getLogger("codementor.ai")

TIMEOUT = httpx.Timeout(30.0, connect=5.0)
# Trần cứng cho mọi chuỗi tự do đi ngược vào context (stderr, output, đề bài).
FIELD_CHARS = 500


class ToolCallError(Exception):
    """Lỗi đã được diễn giải cho model đọc. Nội dung câu này sẽ nằm trong lịch sử hội thoại,
    nên nó nói cái gì hỏng và làm gì tiếp, không phải stack trace."""


def auth_token(config: RunnableConfig) -> str:
    token = (config.get("configurable") or {}).get("auth_token")
    if not token:
        # Chỉ xảy ra khi ai đó gọi graph ngoài endpoint đã xác thực.
        raise ToolCallError("Phiên làm việc không có token; hãy tải lại trang.")
    return token


def clip(value: Any, limit: int = FIELD_CHARS) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return text if len(text) <= limit else text[:limit] + f"… (cắt bớt, còn {len(text) - limit})"


async def call(
    method: str,
    base: str,
    path: str,
    config: RunnableConfig,
    *,
    params: dict | None = None,
    json_body: dict | None = None,
) -> Any:
    """Trả về phần `data` của envelope Nest, hoặc ném `ToolCallError` với câu người đọc được."""
    headers = {"Authorization": f"Bearer {auth_token(config)}"}
    try:
        async with httpx.AsyncClient(base_url=base, timeout=TIMEOUT) as client:
            response = await client.request(method, path, headers=headers, params=params, json=json_body)
    except httpx.HTTPError as exc:
        logger.warning("Lecter tool không gọi được %s%s: %s", base, path, type(exc).__name__)
        raise ToolCallError(f"Không kết nối được dịch vụ để thực hiện bước này ({path}).") from None

    if response.status_code == 401:
        raise ToolCallError("Phiên đăng nhập đã hết hạn. Hãy tải lại trang rồi thử lại.")
    if response.status_code == 403:
        raise ToolCallError("Tài khoản này không có quyền thực hiện thao tác đó.")
    if response.status_code == 404:
        raise ToolCallError("Không tìm thấy đối tượng với định danh đã cho.")
    if response.status_code >= 400:
        # Câu lỗi của backend là thứ model cần để tự sửa (Nest liệt kê trường còn thiếu; judge nói
        # rõ "chế độ hàm chưa hỗ trợ ngôn ngữ 'Python'"). Hai service dùng hai khoá khác nhau —
        # Nest `message`, FastAPI `detail` — và chỉ đọc một khoá thì lỗi thành câu rỗng, model
        # không biết mình sai gì và gửi lại y hệt.
        detail = ""
        try:
            body = response.json() or {}
            # `message` là MẢNG khi lỗi đến từ ValidationPipe của Nest; `str()` thẳng vào đó cho
            # ra "['constraints must be an array']", model đọc được nhưng thừa dấu ngoặc.
            raw = body.get("message") or body.get("detail") or ""
            detail = "; ".join(map(str, raw)) if isinstance(raw, list) else str(raw)
        except ValueError:
            detail = response.text
        raise ToolCallError(
            f"Dịch vụ từ chối yêu cầu ({response.status_code}): {clip(detail) or 'không rõ lý do'}"
        )

    if response.status_code == 204 or not response.content:
        return None
    body = response.json()
    return body.get("data") if isinstance(body, dict) and "data" in body else body


def exercise(method: str, path: str, config: RunnableConfig, **kwargs) -> Any:
    return call(method, settings.exercise_service_url, path, config, **kwargs)


def core(method: str, path: str, config: RunnableConfig, **kwargs) -> Any:
    return call(method, settings.core_service_url, path, config, **kwargs)


def judge(method: str, path: str, config: RunnableConfig, **kwargs) -> Any:
    return call(method, settings.judge_service_url, path, config, **kwargs)


def learning(method: str, path: str, config: RunnableConfig, **kwargs) -> Any:
    return call(method, settings.learning_service_url, path, config, **kwargs)


def workspace(method: str, path: str, config: RunnableConfig, **kwargs) -> Any:
    """Nhóm học tập. Đây là service DUY NHẤT biết ai là thành viên của nhóm nào và tài liệu
    nào đã được duyệt — tool của Lecter không tự tra hai thứ đó, nó hỏi ở đây bằng token của
    chính người dùng rồi nhận đúng câu trả lời mà người dùng đáng được nhận."""
    return call(method, settings.workspace_service_url, path, config, **kwargs)
