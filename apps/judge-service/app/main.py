"""judge-service — chạy và chấm code trong sandbox Docker.

Hai cửa vào, một engine: `POST /api/v1/judge/run` cho kết quả ngay, Kafka `cmd.judge.run.v1`
cho luồng nộp bài đầy đủ. Cả hai gọi cùng `app.grading.grade`.

Service này giữ socket Docker của host — đọc phần Bảo mật trong README trước khi đổi cách nó
được expose.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI

from app.api import router as judge_router
from app.auth import require_admin
from app.config import settings
from app.messaging import publisher
from app.messaging.consumer import JudgeConsumer
from app.services.execution_config import LANGUAGE_CONFIG
from app.services.langs import RUNNERS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("judge")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    consumer = JudgeConsumer()
    try:
        await consumer.start()
    except Exception:
        # Kafka chưa lên không được phép làm chết cả service: đường HTTP vẫn chấm được, và
        # hiện chưa có ai phát cmd.judge.run.v1 (submission-service còn rỗng).
        logger.exception("không khởi động được Kafka consumer — chỉ còn đường HTTP")
    try:
        await publisher.start()
    except Exception:
        # Cùng lý do: chấm bài quan trọng hơn ghi tiến độ. Không có producer thì bài vẫn
        # được chấm, chỉ là tiến độ khóa học không tự cập nhật.
        logger.exception("không khởi động được Kafka producer — tiến độ khóa học sẽ không được ghi")
    try:
        yield
    finally:
        await consumer.stop()
        await publisher.stop()


app = FastAPI(title="CodeMentor Judge", lifespan=lifespan)
app.include_router(judge_router)


@app.get("/api/v1/judge/health")
def health() -> dict[str, str]:
    return {"status": "ok", "engine": settings.execution_engine}


@app.get("/api/v1/judge/admin/config")
def admin_config(_claims: dict = Depends(require_admin)) -> dict:
    """Cấu hình đang chạy, chỉ đọc, cho trang Chấm bài và Cài đặt của admin.

    Đổi bằng biến môi trường rồi restart judge-service — không có đường ghi qua HTTP.
    """
    return {
        "data": {
            "engine": settings.execution_engine,
            "dockerExecutionConcurrency": settings.docker_execution_concurrency,
            "maxSourceBytes": settings.max_source_bytes,
            "maxTestCases": settings.max_test_cases,
            "maxTestCaseBytes": settings.max_test_case_bytes,
            "languages": [
                {"id": name, "image": config["image"], "functionMode": name in RUNNERS}
                for name, config in LANGUAGE_CONFIG.items()
            ],
        }
    }
