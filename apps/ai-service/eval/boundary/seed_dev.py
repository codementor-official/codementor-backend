"""Dựng dữ liệu thực nghiệm trên môi trường dev CỤC BỘ, qua API của chính sản phẩm.

    uv run python eval/boundary/seed_dev.py exercises            # 10 bài ở data/exercises.json, đã duyệt
    uv run python eval/boundary/seed_dev.py exercises --cleanup  # xoá bài có tiền tố [EVAL] trên DB cục bộ

Tài khoản test đọc từ biến môi trường (KHÔNG ghi mật khẩu vào file):
    TEST_LECTURER_USER / TEST_LECTURER_PASS   người ra đề A
    TEST_ADMIN_USER / TEST_ADMIN_PASS         duyệt bài

Hàng rào production: service cục bộ có thể bị trỏ nhầm DB (`.env` của backend trỏ DB production).
Sau khi tạo, script đọc lại đúng hàng đó trong Postgres cục bộ (`LOCAL_PG`); không thấy thì dừng
ngay, coi như service đang ghi chỗ khác.
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
SEED_IDS = DATA / "seed-ids.json"
PREFIX = "[EVAL]"
KEYCLOAK_TOKEN_URL = "https://id.codementor.cloud/realms/codementor/protocol/openid-connect/token"
EXERCISE_URL = os.environ.get("EVAL_EXERCISE_URL", "http://localhost:3003/api/v1")
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
    }


def assert_local(client: httpx.Client, lecturer: str) -> None:
    """Trước MỌI lần ghi: bài của người ra đề mà API thấy phải trùng khớp với DB cục bộ."""
    listed = api(client, "GET", "/exercises/mine?limit=100", lecturer)
    items = listed.get("items", listed) if isinstance(listed, dict) else listed
    seen_by_api = {item["id"] for item in items}
    seen_locally = set(local_sql("select id from exercises").splitlines())
    if not seen_by_api <= seen_locally:
        sys.exit("DỪNG: exercise-service đang đọc một DB khác DB cục bộ (có thể là production).")


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
    parser.add_argument("what", choices=["exercises"])
    parser.add_argument("--cleanup", action="store_true")
    args = parser.parse_args()
    if args.what == "exercises":
        cleanup_exercises() if args.cleanup else seed_exercises()


if __name__ == "__main__":
    main()
