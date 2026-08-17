"""Producer Kafka dùng chung cho đường HTTP.

`JudgeConsumer` có producer riêng vì nó chỉ phát khi đang xử lý một message; đường HTTP thì
không có consumer nào chạy kèm, nên nó cần producer sống theo vòng đời của app.

Kafka sập KHÔNG được làm hỏng việc chấm bài. Chấm là việc chính và nó đã xong trước khi tới
đây; ghi tiến độ là hệ quả. Nên mọi lỗi ở đây đều được nuốt và ghi log, còn người học vẫn
nhận đúng verdict của mình.
"""

import json
import logging

from aiokafka import AIOKafkaProducer

from app.config import settings
from app.messaging.envelope import build_envelope

logger = logging.getLogger(__name__)

TOPIC_EXERCISE_SOLVED = "evt.exercise.solved.v1"

_producer: AIOKafkaProducer | None = None


async def start() -> None:
    global _producer
    producer = AIOKafkaProducer(bootstrap_servers=settings.kafka_bootstrap)
    await producer.start()
    _producer = producer


async def stop() -> None:
    global _producer
    if _producer is not None:
        await _producer.stop()
        _producer = None


async def publish_exercise_solved(
    *,
    external_user_id: str,
    exercise_id: str,
    course_id: str,
    lesson_id: str,
    score: float,
    solved_at: str,
    correlation_id: str,
) -> None:
    if _producer is None:
        logger.warning("không có producer Kafka — bỏ qua evt.exercise.solved.v1")
        return

    envelope = build_envelope(
        event_name=TOPIC_EXERCISE_SOLVED,
        payload={
            "externalUserId": external_user_id,
            "exerciseId": exercise_id,
            "courseId": course_id,
            "lessonId": lesson_id,
            "score": score,
            "solvedAt": solved_at,
        },
        correlation_id=correlation_id,
        actor_user_id=external_user_id,
    )
    try:
        # Partition theo id Keycloak: tiến độ của một người phải được ghi tuần tự, khớp
        # PARTITION_KEY trong libs/contracts.
        await _producer.send_and_wait(
            TOPIC_EXERCISE_SOLVED,
            value=json.dumps(envelope).encode(),
            key=external_user_id.encode(),
        )
    except Exception:
        logger.exception("phát evt.exercise.solved.v1 thất bại — tiến độ sẽ không được ghi")
