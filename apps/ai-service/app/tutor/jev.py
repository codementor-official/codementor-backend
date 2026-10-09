"""Client Jev (TypeSafe System One) cho Tutor — chịu lỗi từ đầu đến cuối.

Jev chỉ là lớp QUYẾT ĐỊNH đặt trước/sau lời gọi LLM, không phải thứ Tutor cần để trả lời. Nên mọi
đường hỏng — thiếu key, 429, 529, mạng, timeout, phản hồi sai dạng — đều kết thúc giống nhau:
một dòng warning, một sự kiện telemetry, và `ask()` trả `None` để node gọi nó rơi về luồng
không có Jev. Không có đường nào để lỗi Jev thành RUN_ERROR trước mặt người dùng.

Gọi thẳng REST bằng `httpx` có sẵn thay vì `typesafe-sdk`: SDK kéo thêm `httpx2` và `tenacity`
cho một lời gọi POST và một lần thử lại.
"""

import asyncio
import logging
import time
from typing import Any

import httpx

from app import telemetry

logger = logging.getLogger("codementor.ai")

URL = "https://api.typesafe.ai/v1/systemone"
# Ghim phiên bản: `jev-latest` đổi model khi có bản mới, và mọi ngưỡng ở `jev_policy` được chỉnh
# trên đúng bản này.
MODEL = "jev-1.13.0"
# Trung vị ~0.5 s. Quá 3 s thì bỏ — người dùng đang chờ chữ đầu tiên, và luồng không Jev vẫn đúng.
TIMEOUT = httpx.Timeout(3.0, connect=2.0)
RETRY_STATUSES = {429, 500, 502, 503, 504, 529}
RETRY_DELAY = 0.4


class JevClient:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.client = httpx.AsyncClient(timeout=TIMEOUT)

    async def close(self) -> None:
        await self.client.aclose()

    async def ask(self, node: str, state: Any, questions: dict[str, dict]) -> dict | None:
        """`answers` của Jev, hoặc `None` nếu vì bất cứ lý do gì không có câu trả lời.

        Thử lại đúng một lần cho lỗi tạm thời (429/5xx/529, mạng, timeout). Lỗi do request sai
        (401, 422) không thử lại: lần hai cũng sai y vậy.
        """
        body = {"model": MODEL, "state": state, "questions": questions}
        error: Exception | None = None
        for attempt in range(2):
            started = time.perf_counter()
            try:
                response = await self.client.post(
                    URL, json=body, headers={"Authorization": f"Bearer {self.api_key}"}
                )
                if response.status_code in RETRY_STATUSES and attempt == 0:
                    await asyncio.sleep(RETRY_DELAY)
                    continue
                response.raise_for_status()
                payload = response.json()
                answers = payload["answers"]
                if not isinstance(answers, dict) or set(answers) != set(questions):
                    raise ValueError("Jev trả thiếu câu trả lời")
                telemetry.record_call(MODEL, started, usage=payload.get("usage"))
                return answers
            except (httpx.TransportError, httpx.TimeoutException) as exc:
                error = exc
                if attempt == 0:
                    await asyncio.sleep(RETRY_DELAY)
                    continue
            except Exception as exc:  # noqa: BLE001 - xem docstring module
                error = exc
            break
        # Không log thân phản hồi hay `state`: cả hai có thể chứa nội dung tài liệu của nhóm.
        status = getattr(getattr(error, "response", None), "status_code", None)
        logger.warning(
            "Jev %s lỗi (%s%s) — dùng luồng không có Jev",
            node,
            type(error).__name__,
            f", HTTP {status}" if status else "",
        )
        telemetry.record(
            ok=False,
            model=MODEL,
            errorType=f"jev_{type(error).__name__}",
            errorMessage=f"{node}: HTTP {status}" if status else node,
        )
        return None


def from_settings(api_key: str) -> JevClient | None:
    """Client khi có key, `None` (kèm một warning) khi không — không bao giờ ném."""
    if not api_key.strip():
        logger.warning("TYPESAFE_API_KEY chưa cấu hình: Tutor chạy không có Jev.")
        return None
    return JevClient(api_key.strip())
