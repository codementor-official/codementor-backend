"""Nhận `cmd.judge.run.v1`, chấm, phát `evt.judge.started.v1` và `evt.judge.completed.v1`.

Judge nhận đủ dữ liệu trong payload và không gọi HTTP sang service nào — nhờ vậy nó chấm được
kể cả khi mọi service khác đang sập (xem chú thích của `JudgeRunV1` trong libs/contracts).
"""

import asyncio
import json
import logging

import asyncpg
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
from motor.motor_asyncio import AsyncIOMotorClient

from app import run_details
from app.config import settings
from app.grading import WORKER, ExecutionError, JudgeSpec, grade
from app.messaging.dedupe import CONSUMER, Dedupe
from app.messaging.envelope import build_envelope
from app.services.judgement import JudgeCase

logger = logging.getLogger(__name__)

TOPIC_RUN = "cmd.judge.run.v1"
TOPIC_STARTED = "evt.judge.started.v1"
TOPIC_COMPLETED = "evt.judge.completed.v1"


class JudgeConsumer:
    """Vòng đời của consumer, gắn vào lifespan của FastAPI."""

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._consumer: AIOKafkaConsumer | None = None
        self._producer: AIOKafkaProducer | None = None
        self._pool: asyncpg.Pool | None = None
        self._mongo: AsyncIOMotorClient | None = None

    async def start(self) -> None:
        self._pool = await asyncpg.create_pool(settings.asyncpg_dsn, min_size=1, max_size=4)
        self._mongo = AsyncIOMotorClient(settings.mongo_uri)

        self._producer = AIOKafkaProducer(bootstrap_servers=settings.kafka_bootstrap)
        await self._producer.start()

        self._consumer = AIOKafkaConsumer(
            TOPIC_RUN,
            bootstrap_servers=settings.kafka_bootstrap,
            group_id=CONSUMER,
            # Bài nộp cũ chấm lại lúc khởi động là vô nghĩa — submission-service đã bỏ chờ từ
            # lâu. Cùng lựa chọn với `fromBeginning: false` bên EventConsumer.
            auto_offset_reset="latest",
            enable_auto_commit=True,
        )
        await self._consumer.start()

        self._task = asyncio.create_task(self._run())
        logger.info("judge consumer đã nghe %s", TOPIC_RUN)

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        for closer in (self._consumer, self._producer):
            if closer:
                await closer.stop()
        if self._mongo:
            self._mongo.close()
        if self._pool:
            await self._pool.close()

    async def _run(self) -> None:
        assert self._consumer and self._pool
        dedupe = Dedupe(self._pool)

        async for message in self._consumer:
            try:
                envelope = json.loads(message.value)
            except json.JSONDecodeError:
                logger.exception("message không phải JSON, bỏ qua")
                continue

            event_id = envelope.get("eventId")
            if not event_id:
                logger.warning("message thiếu eventId, bỏ qua")
                continue

            if not await dedupe.claim(event_id, TOPIC_RUN):
                logger.debug("bỏ qua %s (%s) — đã xử lý", TOPIC_RUN, event_id)
                continue

            try:
                await self._handle(envelope)
            except Exception:
                # Nhả dấu để lần giao lại còn chạy. Không ném tiếp: aiokafka với
                # enable_auto_commit sẽ commit offset bất kể, nên ném chỉ làm chết vòng lặp
                # mà không khiến message được giao lại.
                await dedupe.release(event_id)
                logger.exception(
                    "chấm thất bại (correlationId=%s)", envelope.get("correlationId")
                )

    async def _handle(self, envelope: dict) -> None:
        assert self._producer and self._mongo
        payload = envelope["payload"]
        submission_id = payload["submissionId"]
        correlation_id = envelope.get("correlationId", submission_id)
        actor_user_id = (envelope.get("actor") or {}).get("userId")

        await self._emit(
            TOPIC_STARTED,
            {"submissionId": submission_id, "worker": WORKER},
            key=submission_id,
            correlation_id=correlation_id,
            causation_id=envelope.get("eventId"),
            actor_user_id=actor_user_id,
        )

        cases = [
            JudgeCase(
                order=case["order"],
                input=case.get("input", ""),
                args=case.get("args"),
                expected=case.get("expected", ""),
                weight=case.get("weight", 1) or 1,
            )
            for case in payload.get("testCases", [])
        ]

        # `spec` vắng mặt = bài chấm theo stdin/stdout. Rẽ nhánh ở đây chứ không ở một cột
        # riêng, để bài cũ chạy nguyên vẹn mà không phải migrate.
        raw_spec = payload.get("spec")
        spec = (
            JudgeSpec(
                function_name=raw_spec["functionName"],
                checker=raw_spec.get("judgeMode") or "exact",
                config=raw_spec.get("judgeConfig") or {},
            )
            if raw_spec
            else None
        )

        try:
            result = await grade(
                language=payload["language"],
                source_code=payload["sourceCode"],
                time_limit_ms=payload.get("timeLimitMs", 1000),
                memory_limit_kb=payload.get("memoryLimitKb", 262_144),
                cases=cases,
                spec=spec,
            )
        except ExecutionError:
            # Lỗi hạ tầng, không phải lỗi bài nộp: để dedupe nhả dấu và Kafka giao lại, thay
            # vì phát một verdict bịa ra cho học viên.
            raise

        run_detail_ref = await run_details.save(
            self._mongo[settings.mongo_db],
            submission_id=submission_id,
            result=result,
            worker=WORKER,
            language=payload["language"],
        )

        await self._emit(
            TOPIC_COMPLETED,
            {
                "submissionId": submission_id,
                "verdict": result.verdict,
                "score": result.score,
                "passedTests": result.passed_tests,
                "totalTests": result.total_tests,
                "runtimeMs": result.runtime_ms,
                "memoryKb": result.memory_kb,
                "runDetailRef": run_detail_ref,
            },
            key=submission_id,
            correlation_id=correlation_id,
            causation_id=envelope.get("eventId"),
            actor_user_id=actor_user_id,
        )

    async def _emit(
        self,
        topic: str,
        payload: dict,
        *,
        key: str,
        correlation_id: str,
        causation_id: str | None,
        actor_user_id: str | None,
    ) -> None:
        assert self._producer
        envelope = build_envelope(
            event_name=topic,
            payload=payload,
            correlation_id=correlation_id,
            causation_id=causation_id,
            actor_user_id=actor_user_id,
        )
        # Partition key là submissionId: mọi bước của một bài nộp phải giữ đúng thứ tự, và
        # Kafka chỉ đảm bảo thứ tự trong cùng một partition.
        await self._producer.send_and_wait(
            topic, json.dumps(envelope).encode(), key=key.encode()
        )
