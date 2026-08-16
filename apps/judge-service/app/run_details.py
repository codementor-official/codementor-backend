"""Ghi chi tiết từng test case vào MongoDB `submission_run_details`.

Đẩy phần này qua Kafka thì payload phình theo số test case và theo độ dài stdout; hợp đồng
`JudgeCompletedV1` vì thế chỉ mang `runDetailRef` — _id của document ghi ở đây.

Collection có `validationLevel: strict` và `additionalProperties: false`
(`codementor-infra/database/mongo/schemas/03-submission-run-details.js`). Hai hệ quả phải nhớ:
`runtimeMs`/`memoryKb` khai là int nên float bị từ chối, và khoá mang giá trị None cũng bị từ
chối vì driver serialize thành `null`, mà `null` không khớp bsonType nào. Bẫy thứ hai đã sập
một lần với `exercise_contents` — xem comment trong `libs/platform/.../mongo.module.ts`.
"""

from datetime import UTC, datetime

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.grading import GradeResult

COLLECTION = "submission_run_details"


def _prune(document: dict) -> dict:
    """Bỏ mọi khoá None, đệ quy. Validator strict từ chối `null`, không phải bỏ trống."""
    if isinstance(document, dict):
        return {key: _prune(value) for key, value in document.items() if value is not None}
    if isinstance(document, list):
        return [_prune(item) for item in document]
    return document


async def save(
    db: AsyncIOMotorDatabase,
    *,
    submission_id: str,
    result: GradeResult,
    worker: str,
    language: str,
) -> str:
    """Ghi (hoặc ghi đè) chi tiết chấm, trả về _id dạng chuỗi.

    Upsert chứ không insert: collection có index unique trên `submissionId`, nên chấm lại một
    bài — chuyện bình thường khi Kafka giao lại hoặc khi giảng viên bấm chấm lại — sẽ đụng
    khoá nếu chèn mới.
    """
    document = _prune(
        {
            "submissionId": submission_id,
            "compile": (
                {"success": False, "stderr": result.compile_output}
                if result.compile_output is not None
                else {"success": True}
            ),
            "cases": [
                {
                    "order": case.order,
                    "passed": case.verdict == "accepted",
                    "expected": case.expected,
                    "actual": case.actual,
                    "stderr": case.stderr,
                    "runtimeMs": case.runtime_ms,
                    "memoryKb": case.memory_kb,
                    "verdict": case.verdict,
                }
                for case in result.cases
            ],
            # Rỗng ở chế độ stdin (ở đó stdout CHÍNH LÀ đáp án nộp lên, đã nằm trong `actual`).
            # `_prune` bỏ luôn khoá này khi rỗng, nên document không phình vì một chuỗi trắng.
            "consoleOutput": result.console_output or None,
            "judge": {"worker": worker, "languageVersion": language},
            "createdAt": datetime.now(UTC),
        }
    )

    await db[COLLECTION].update_one(
        {"submissionId": submission_id},
        {"$set": document},
        upsert=True,
    )
    saved = await db[COLLECTION].find_one({"submissionId": submission_id}, {"_id": 1})
    return str(saved["_id"])
