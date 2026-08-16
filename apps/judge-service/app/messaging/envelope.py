"""Vỏ message dùng chung với 8 service Nest.

Hình dạng do `libs/contracts/src/events/envelope.ts` quy định. Lệch một trường là consumer
bên kia đọc không ra, nên chỗ này bám sát tên trường camelCase của TypeScript chứ không đổi
sang snake_case cho hợp Python.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

PRODUCER = "judge-service"


def build_envelope(
    *,
    event_name: str,
    payload: dict[str, Any],
    correlation_id: str,
    causation_id: str | None = None,
    actor_user_id: str | None = None,
) -> dict[str, Any]:
    """Dựng envelope cho một event phát đi.

    `correlationId` phải đi xuyên suốt luồng nộp bài → chấm → cộng XP, nên nó luôn được truyền
    vào từ message gốc chứ không sinh mới. `causationId` là eventId của message đã gây ra
    message này — nhờ nó dựng lại được cây nhân quả khi debug.
    """
    return {
        "eventId": str(uuid.uuid4()),
        "eventName": event_name,
        "occurredAt": datetime.now(UTC).isoformat(),
        "correlationId": correlation_id,
        "causationId": causation_id,
        "actor": {"userId": actor_user_id},
        "producer": PRODUCER,
        "payload": payload,
    }
