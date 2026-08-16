"""Khử trùng lặp message, dùng chung bảng `processed_events` với các service Nest.

Kafka giao at-least-once: cùng một message quay lại khi consumer restart, khi rebalance, hoặc
khi commit offset hỏng. Chấm lại một bài hai lần thì tốn CPU và ghi đè kết quả — không thảm
hoạ như cộng XP hai lần, nhưng vẫn sai.

Khoá chính `(consumer, event_id)` làm luôn việc chống trùng: chèn trùng thì `ON CONFLICT DO
NOTHING` không trả về dòng nào. Cùng cơ chế `EventConsumer` bên Nest dùng, cùng bảng — hai
runtime nhưng một nguồn sự thật.
"""

import asyncpg

CONSUMER = "judge-service"


class Dedupe:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def claim(self, event_id: str, topic: str) -> bool:
        """True nếu event này chưa từng được xử lý (và vừa được đánh dấu)."""
        row = await self._pool.fetchrow(
            """
            INSERT INTO processed_events (consumer, event_id, topic)
            VALUES ($1, $2::uuid, $3)
            ON CONFLICT DO NOTHING
            RETURNING event_id
            """,
            CONSUMER,
            event_id,
            topic,
        )
        return row is not None

    async def release(self, event_id: str) -> None:
        """Nhả dấu đã-xử-lý sau khi handler ném lỗi, để lần giao lại còn chạy được.

        Thiếu bước này thì một lỗi tạm thời (daemon Docker bận) biến thành mất hẳn bài chấm:
        message được đánh dấu đã xử lý nhưng chưa hề chạy.
        """
        await self._pool.execute(
            "DELETE FROM processed_events WHERE consumer = $1 AND event_id = $2::uuid",
            CONSUMER,
            event_id,
        )
