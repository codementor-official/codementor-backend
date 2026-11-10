"""Dựng dữ liệu thực nghiệm trên môi trường dev CỤC BỘ, qua API của chính sản phẩm.

    uv run python eval/boundary/seed_dev.py exercises            # 10 bài ở data/exercises.json, đã duyệt
    uv run python eval/boundary/seed_dev.py exercises --cleanup  # xoá bài có tiền tố [EVAL] trên DB cục bộ
    uv run python eval/boundary/seed_dev.py lecter     # khoá học, bài nháp, bài của người khác, thư viện tài liệu
    uv run python eval/boundary/seed_dev.py tutor      # index 14 tài liệu eval/tutor + tài liệu 15 vào Mongo cục bộ

Chạy với biến môi trường của `.scratch/.../env/local-eval.env` để ai-service (index tài liệu) cũng trỏ
DB cục bộ; script tự kiểm và dừng nếu không phải localhost.

Tài khoản test đọc từ biến môi trường (KHÔNG ghi mật khẩu vào file):
    TEST_LECTURER_USER / TEST_LECTURER_PASS   người ra đề A
    TEST_ADMIN_USER / TEST_ADMIN_PASS         duyệt bài

Hàng rào production: service cục bộ có thể bị trỏ nhầm DB (`.env` của backend trỏ DB production).
Sau khi tạo, script đọc lại đúng hàng đó trong Postgres cục bộ (`LOCAL_PG`); không thấy thì dừng
ngay, coi như service đang ghi chỗ khác.
"""

import argparse
import asyncio
import base64
import json
import os
import subprocess
import sys
from hashlib import sha256
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
SEED_IDS = DATA / "seed-ids.json"
PREFIX = "[EVAL]"
KEYCLOAK_TOKEN_URL = "https://id.codementor.cloud/realms/codementor/protocol/openid-connect/token"
EXERCISE_URL = os.environ.get("EVAL_EXERCISE_URL", "http://localhost:3003/api/v1")
LEARNING_URL = os.environ.get("EVAL_LEARNING_URL", "http://localhost:3002/api/v1")
LOCAL_PG = os.environ.get(
    "EVAL_LOCAL_PG", "postgresql://codementor:codementor@localhost:55432/codementor_eval"
)


def token(role: str) -> str:
    user, password = os.environ.get(f"TEST_{role}_USER"), os.environ.get(f"TEST_{role}_PASS")
    if not user or not password:
        sys.exit(f"Thiếu TEST_{role}_USER / TEST_{role}_PASS")
    response = httpx.post(
        KEYCLOAK_TOKEN_URL,
        data={
            "grant_type": "password",
            "client_id": "codementor-test",
            "username": user,
            "password": password,
        },
        timeout=20,
    )
    response.raise_for_status()
    return response.json()["access_token"]


def local_sql(query: str) -> str:
    """Chạy một câu SQL chỉ-đọc/xoá trên Postgres CỤC BỘ. Không bao giờ nhận URL từ `.env`."""
    assert "localhost" in LOCAL_PG or "127.0.0.1" in LOCAL_PG, "LOCAL_PG phải là DB cục bộ"
    return subprocess.run(
        ["psql", LOCAL_PG, "-Atc", query], check=True, capture_output=True, text=True
    ).stdout.strip()


def api(client: httpx.Client, method: str, path: str, bearer: str, body: dict | None = None):
    response = client.request(
        method, path, json=body, headers={"Authorization": f"Bearer {bearer}"}
    )
    if response.status_code >= 400:
        sys.exit(f"{method} {path} -> {response.status_code}: {response.text[:500]}")
    if not response.content:
        return None
    payload = response.json()
    return payload.get("data", payload) if isinstance(payload, dict) else payload


def subject(bearer: str) -> str:
    """`sub` của JWT — Lecter dùng nó làm chủ thư viện tài liệu (`claims["sub"]`)."""
    payload = bearer.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))["sub"]


def content_of(exercise: dict) -> dict:
    tests = [
        {"order": i + 1, "args": t["args"], "expected": t["expected"], "visibility": visibility}
        for i, (t, visibility) in enumerate(
            [(t, "public") for t in exercise["public_tests"]]
            + [(t, "hidden") for t in exercise["hidden_tests"]]
        )
    ]
    return {
        "statement": exercise["statement"],
        "ioMode": "function",
        "signature": exercise["signature"],
        "constraints": exercise["constraints"],
        "testCases": tests,
        "languages": [
            {
                "id": "python",
                "label": "Python",
                "monaco": "python",
                "starterCode": exercise["starter_code"],
                "referenceSolution": exercise["reference_solution"],
            }
        ],
        "evaluation": {"checker": "exact"},
        **({"hints": exercise["hints"]} if exercise.get("hints") else {}),
    }


def assert_local(client: httpx.Client, lecturer: str) -> None:
    """Trước MỌI lần ghi: bài của người ra đề mà API thấy phải trùng khớp với DB cục bộ."""
    listed = api(client, "GET", "/exercises/mine?limit=100", lecturer)
    items = listed.get("items", listed) if isinstance(listed, dict) else listed
    seen_by_api = {item["id"] for item in items}
    seen_locally = set(local_sql("select id from exercises").splitlines())
    if not seen_by_api <= seen_locally:
        sys.exit("DỪNG: exercise-service đang đọc một DB khác DB cục bộ (có thể là production).")


def assert_local_courses(client: httpx.Client, lecturer: str) -> None:
    listed = api(client, "GET", "/courses/mine?limit=100", lecturer)
    items = listed.get("items", listed) if isinstance(listed, dict) else listed
    seen_locally = set(local_sql("select id from courses").splitlines())
    if not {item["id"] for item in items} <= seen_locally:
        sys.exit("DỪNG: learning-service đang đọc một DB khác DB cục bộ (có thể là production).")


def create_exercise(client, bearer, exercise, *, publish_with: str | None = None) -> str:
    created = api(
        client,
        "POST",
        "/exercises",
        bearer,
        {
            "title": f"{PREFIX} {exercise['title']}",
            "kind": "code",
            "difficulty": exercise["difficulty"],
            "summary": exercise["statement"].split("\n")[0][:200],
        },
    )
    exercise_id = created["id"]
    if local_sql(f"select count(*) from exercises where id = '{exercise_id}'") != "1":
        sys.exit(f"DỪNG: bài {exercise_id} không có trong DB cục bộ — service đang ghi chỗ khác.")
    api(client, "PUT", f"/exercises/{exercise_id}/content", bearer, content_of(exercise))
    if publish_with:
        api(client, "POST", f"/exercises/{exercise_id}/submit", bearer)
        api(
            client,
            "POST",
            f"/exercises/{exercise_id}/moderate",
            publish_with,
            {"decision": "approve"},
        )
    return exercise_id


def seed_course(client, bearer, course: dict, exercise_ids: dict) -> str:
    created = api(
        client,
        "POST",
        "/courses",
        bearer,
        {"title": f"{PREFIX} {course['title']}", "level": course["level"]},
    )
    course_id = created["id"]
    if local_sql(f"select count(*) from courses where id = '{course_id}'") != "1":
        sys.exit(f"DỪNG: khoá {course_id} không có trong DB cục bộ — service đang ghi chỗ khác.")
    chapters = [
        {
            "title": chapter["title"],
            "lessons": [
                {
                    "title": lesson["title"],
                    "type": lesson["type"],
                    "exerciseId": exercise_ids.get(lesson.get("exercise"))
                    if lesson.get("exercise")
                    else None,
                }
                for lesson in chapter["lessons"]
            ],
        }
        for chapter in course["chapters"]
    ]
    saved = api(client, "PUT", f"/courses/{course_id}/curriculum", bearer, {"chapters": chapters})
    lesson_ids = {
        lesson["title"]: lesson["id"]
        for chapter in saved.get("chapters") or []
        for lesson in chapter.get("lessons") or []
    }
    for chapter in course["chapters"]:
        for lesson in chapter["lessons"]:
            if lesson.get("content"):
                api(
                    client,
                    "PUT",
                    f"/courses/{course_id}/lessons/{lesson_ids[lesson['title']]}/content",
                    bearer,
                    lesson["content"],
                )
    return course_id


async def index_documents(owner_id: str, documents: list[dict]) -> dict:
    """Ghi tài liệu vào thư viện cá nhân (ai_documents) và index — trên Mongo CỤC BỘ.

    Nội dung đi qua `previewText` của nguồn khi xếp hàng, nên bước index không đọc S3.
    """
    from datetime import UTC, datetime, timedelta

    sys.path.insert(0, str(HERE.parents[1]))
    from pymongo import AsyncMongoClient

    from app.config import settings
    from app.provider import OpenAIProvider
    from app.rag.documents import DocumentStorage
    from app.rag.index import DocumentIndex, storage_prefix
    from app.rag.library import DocumentLibrary

    if "localhost" not in settings.mongo_uri and "127.0.0.1" not in settings.mongo_uri:
        sys.exit("DỪNG: MONGO_URI không phải localhost. Nạp env/local-eval.env trước.")
    client = AsyncMongoClient(settings.mongo_uri, tz_aware=True)
    provider = OpenAIProvider(settings)
    db = client[settings.mongo_db]
    index = DocumentIndex(db, settings, provider, DocumentStorage(settings))
    scope = DocumentLibrary.scope_of(owner_id)
    ids = {}
    try:
        for document in documents:
            text = (DATA / "documents" / "lecter" / document["file"]).read_text(encoding="utf-8")
            title = document["title"]
            key = storage_prefix(settings, scope) + f"eval-{document['file']}"
            size = len(text.encode())
            row_id = sha256(f"eval-lecter|{owner_id}|{document['key']}".encode()).hexdigest()[:32]
            row = {
                "_id": row_id,
                "ownerId": owner_id,
                "scope": scope,
                "title": title,
                "docType": "md",
                "storageKey": key,
                "sizeBytes": size,
                "revision": DocumentLibrary.revision(key, title, "md", size),
                "createdAt": datetime.now(UTC),
                "expiresAt": datetime.now(UTC) + timedelta(days=30),
            }
            await db["ai_documents"].replace_one({"_id": row_id}, row, upsert=True)
            # Không có storageKey thì DocumentStorage đọc previewText (md), không chạm S3.
            source = {**DocumentLibrary.source_of(row), "storageKey": None, "previewText": text}
            await index.queue(scope, source, owner_id, charge=False)
            ids[document["key"]] = row_id
        for _ in range(60):
            if not await index.process_next():
                break
        sources = [
            DocumentLibrary.source_of(await db["ai_documents"].find_one({"_id": i}))
            for i in ids.values()
        ]
        for state in await index.states(scope, sources):
            print("  tài liệu", state["state"], state.get("chunkCount"), state.get("error", ""))
    finally:
        await provider.close()
        await client.close()
    return ids


def seed_lecter() -> None:
    seed = json.loads((DATA / "lecter_seed.json").read_text())
    lecturer, admin = token("LECTURER"), token("ADMIN")
    ids = json.loads(SEED_IDS.read_text()) if SEED_IDS.exists() else {}
    if "exercises" not in ids:
        sys.exit("Chạy `seed_dev.py exercises` trước (khoá học trỏ tới bài E04).")
    lecter = ids.setdefault("lecter", {})
    with httpx.Client(base_url=EXERCISE_URL, timeout=60) as client:
        assert_local(client, lecturer)
        for draft in seed["draft_exercises"]:
            if draft["key"] not in lecter:
                lecter[draft["key"]] = create_exercise(client, lecturer, draft)
                print(draft["key"], "nháp", lecter[draft["key"]])
        other = seed["other_lecturer_exercise"]
        if other["key"] not in lecter:
            # Người ra đề B = tài khoản admin test: một tác giả khác A, tạo và tự duyệt bài.
            lecter[other["key"]] = create_exercise(client, admin, other, publish_with=admin)
            print(other["key"], "của người khác", lecter[other["key"]])
    SEED_IDS.write_text(json.dumps(ids, indent=2) + "\n")
    with httpx.Client(base_url=LEARNING_URL, timeout=60) as client:
        assert_local_courses(client, lecturer)
        for course in seed["courses"]:
            if course["key"] not in lecter:
                lecter[course["key"]] = seed_course(client, lecturer, course, ids["exercises"])
                print(course["key"], "khoá", lecter[course["key"]])
    SEED_IDS.write_text(json.dumps(ids, indent=2) + "\n")
    lecter["owner_sub"] = subject(lecturer)
    lecter["documents"] = asyncio.run(index_documents(lecter["owner_sub"], seed["documents"]))
    SEED_IDS.write_text(json.dumps(ids, indent=2) + "\n")


async def seed_tutor() -> None:
    """Index tài liệu nhóm "A+ Python" của eval/tutor (01..14) và tài liệu 15 vào Mongo CỤC BỘ.

    Nội dung lấy từ tệp đã dựng ở `eval/tutor/build` (md, txt, docx, pptx) — thay
    `DocumentStorage.read` trong tiến trình seed, không đọc S3.
    """
    sys.path.insert(0, str(HERE.parents[1]))
    from pymongo import AsyncMongoClient

    from app.config import settings
    from app.provider import OpenAIProvider
    from app.rag.documents import DocumentStorage
    from app.rag.index import DocumentIndex

    if "localhost" not in settings.mongo_uri and "127.0.0.1" not in settings.mongo_uri:
        sys.exit("DỪNG: MONGO_URI không phải localhost. Nạp env/local-eval.env trước.")
    tutor_dir = HERE.parent / "tutor"
    meta = json.loads((tutor_dir / "build" / "sources.json").read_text())
    files = {s["id"]: tutor_dir / "build" / f"{s['key']}.{s['docType']}" for s in meta["sources"]}
    sources = [{k: v for k, v in s.items() if k != "key"} for s in meta["sources"]]
    extra = DATA / "documents" / "tutor" / "15-thong-bao-lich-hoc.md"
    extra_id = "e7a10000-0000-4000-8000-000000000015"
    sources.append(
        {
            "id": extra_id,
            "title": "Thông báo lịch học tháng 10",
            "docType": "md",
            "storageKey": f"eval-boundary/{extra.name}",
            "previewText": None,
            "revision": sha256(extra.read_bytes()).hexdigest(),
        }
    )
    files[extra_id] = extra

    class LocalFiles(DocumentStorage):
        def read(self, allowed_prefix, source):  # noqa: ARG002 - cùng chữ ký với bản gốc
            return files[source["id"]].read_bytes()

    client = AsyncMongoClient(settings.mongo_uri, tz_aware=True)
    provider = OpenAIProvider(settings)
    index = DocumentIndex(client[settings.mongo_db], settings, provider, LocalFiles(settings))
    scope = f"workspace:{meta['workspaceId']}"
    try:
        for source in sources:
            await index.queue(scope, source, meta["ownerId"], charge=False)
        for _ in range(120):
            if not await index.process_next():
                break
        for state in await index.states(scope, sources):
            print(
                "  ",
                state["state"],
                state.get("chunkCount"),
                state.get("error", ""),
                state["id"][-2:],
            )
    finally:
        await provider.close()
        await client.close()
    ids = json.loads(SEED_IDS.read_text()) if SEED_IDS.exists() else {}
    ids["tutor"] = {
        "workspace_id": meta["workspaceId"],
        "documents": {s["id"][-2:]: {"id": s["id"], "title": s["title"]} for s in sources},
    }
    SEED_IDS.write_text(json.dumps(ids, indent=2, ensure_ascii=False) + "\n")


def seed_exercises() -> None:
    exercises = json.loads((DATA / "exercises.json").read_text())
    lecturer, admin = token("LECTURER"), token("ADMIN")
    ids = json.loads(SEED_IDS.read_text()) if SEED_IDS.exists() else {}
    ids.setdefault("exercises", {})
    with httpx.Client(base_url=EXERCISE_URL, timeout=30) as client:
        assert_local(client, lecturer)
        for exercise in exercises:
            key = exercise["key"]
            if key in ids["exercises"]:
                print(key, "đã có", ids["exercises"][key])
                continue
            created = api(
                client,
                "POST",
                "/exercises",
                lecturer,
                {
                    "title": f"{PREFIX} {key} {exercise['title']}",
                    "kind": "code",
                    "difficulty": exercise["difficulty"],
                    "summary": exercise["statement"][:200],
                },
            )
            exercise_id = created["id"]
            if local_sql(f"select count(*) from exercises where id = '{exercise_id}'") != "1":
                sys.exit(
                    f"DỪNG: bài {exercise_id} không có trong DB cục bộ — service đang ghi chỗ khác."
                )
            api(client, "PUT", f"/exercises/{exercise_id}/content", lecturer, content_of(exercise))
            api(client, "POST", f"/exercises/{exercise_id}/submit", lecturer)
            api(
                client, "POST", f"/exercises/{exercise_id}/moderate", admin, {"decision": "approve"}
            )
            status = local_sql(f"select status from exercises where id = '{exercise_id}'")
            print(key, exercise_id, status)
            ids["exercises"][key] = exercise_id
            SEED_IDS.write_text(json.dumps(ids, indent=2) + "\n")


def cleanup_exercises() -> None:
    """Xoá thẳng trên DB cục bộ: bài đã duyệt thì API không cho xoá."""
    ids = [
        line
        for line in local_sql(
            f"select id from exercises where title like '{PREFIX} %'"
        ).splitlines()
        if line
    ]
    if ids:
        quoted = ",".join(f"'{i}'" for i in ids)
        local_sql(f"delete from submissions where exercise_id in ({quoted})")
        local_sql(f"delete from exercises where id in ({quoted})")
    if SEED_IDS.exists():
        data = json.loads(SEED_IDS.read_text())
        data.pop("exercises", None)
        SEED_IDS.write_text(json.dumps(data, indent=2) + "\n")
    print("Đã xoá", len(ids), "bài (Mongo exercise_contents cục bộ giữ lại, không ảnh hưởng)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("what", choices=["exercises", "lecter", "tutor"])
    parser.add_argument("--cleanup", action="store_true")
    args = parser.parse_args()
    if args.what == "exercises":
        cleanup_exercises() if args.cleanup else seed_exercises()
    elif args.what == "lecter":
        seed_lecter()
    elif args.what == "tutor":
        asyncio.run(seed_tutor())


if __name__ == "__main__":
    main()
