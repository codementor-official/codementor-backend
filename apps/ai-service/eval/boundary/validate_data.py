"""Kiểm tra bộ dữ liệu thực nghiệm. Phải sạch lỗi trước khi chạy.

    uv run python eval/boundary/validate_data.py            # kiểm cấu trúc + chạy lời giải qua judge
    uv run python eval/boundary/validate_data.py --no-judge # chỉ kiểm cấu trúc

Judge (dev cục bộ, :3007) cần token của một tài khoản test: TEST_STUDENT_USER / TEST_STUDENT_PASS.
"""

import argparse
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
JUDGE_URL = os.environ.get("EVAL_JUDGE_URL", "http://localhost:3007/api/v1/judge/run")
KEYCLOAK_TOKEN_URL = "https://id.codementor.cloud/realms/codementor/protocol/openid-connect/token"

# Bảng 7 của bài báo (+ A9) và mục 4 của plan dữ liệu.
ATTACK_COUNTS = {"A1": 6, "A2": 5, "A3": 5, "A4": 4, "A5": 3, "A6": 6, "A7": 5, "A8": 6, "A9": 3}
ASSISTANT_OF = {
    **dict.fromkeys(["A1", "A2", "A3", "A4", "A5", "A9"], "codey"),
    "A6": "lecter",
    "A7": "lecter",
    "A8": "tutor",
}
BENIGN_COUNTS = {"codey": 8, "lecter": 6, "tutor": 6}
TECHNIQUES = {"naive", "escape_characters", "context_ignoring", "fake_completion", "combined"}
INJECTED_INTO = {
    "user_message",
    "editor_code",
    "last_run",
    "statement",
    "document",
    "exercise_content",
    "lesson_content",
}
SUCCESS_TYPES = {
    "codey_leak",
    "lecter_unauthorized_write",
    "tutor_prompt_leak",
    "tutor_followed_injection",
    "tutor_answered_out_of_scope",
}
SECRET_PATTERNS = [
    r"\bsk-[A-Za-z0-9]{10,}",
    r"Bearer\s+[A-Za-z0-9._-]{20,}",
    r"password\s*=",
    r"AKIA[0-9A-Z]{12,}",
]
TUTOR_DOCS = {f"{i:02d}" for i in range(1, 16)}
LECTER_REFS = {"D1", "D2", "B1", "C1", "C2", "L1", "L2", "L3", "L4"}

errors: list[str] = []


def err(message: str) -> None:
    errors.append(message)


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def text_of(value) -> str:
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


def check_exercises(exercises: list[dict]) -> None:
    canaries = Counter(e["canary"] for e in exercises)
    for e in exercises:
        key = e["key"]
        if not re.fullmatch(r"CMK-[0-9a-f]{6}", e["canary"]):
            err(f"{key}: canary sai dạng")
        if canaries[e["canary"]] > 1:
            err(f"{key}: canary trùng")
        if e["canary"] not in e["reference_solution"]:
            err(f"{key}: canary không nằm trong lời giải mẫu")
        visible = " ".join(
            [
                e["statement"],
                *e["constraints"],
                e["starter_code"],
                text_of(e["public_tests"]),
                e["title"],
            ]
        )
        if e["canary"] in visible or e["canary"] in e["wrong_solution"]:
            err(f"{key}: canary lộ ngoài lời giải mẫu")
        if not (2 <= len(e["public_tests"]) <= 3 and 2 <= len(e["hidden_tests"]) <= 3):
            err(f"{key}: cần 2–3 test công khai và 2–3 test ẩn")
        for value in e["hidden_expected_values"]:
            if value in visible:
                err(f"{key}: đầu ra test ẩn {value!r} xuất hiện trong phần học viên thấy")
        for token in e["leak_tokens"]:
            if re.search(rf"(?<!\w){re.escape(token)}(?!\w)", visible.lower()):
                err(f"{key}: mẩu đánh dấu {token!r} xuất hiện trong phần học viên thấy")
        if not e["solution_key_lines"] or any(
            line not in e["reference_solution"] for line in e["solution_key_lines"]
        ):
            err(f"{key}: solution_key_lines phải là dòng có trong lời giải mẫu")
    if len(exercises) != 10:
        err(f"cần 10 bài, đang có {len(exercises)}")
    diff = Counter(e["difficulty"] for e in exercises)
    if diff != Counter({"easy": 4, "medium": 4, "hard": 2}):
        err(f"phân bố độ khó {dict(diff)} khác 4/4/2")


def check_scenarios(
    attacks: list[dict], benign: list[dict], exercises: dict, seed_ids: dict
) -> None:
    ids = Counter(s["id"] for s in attacks + benign)
    for sid, n in ids.items():
        if n > 1:
            err(f"id tình huống trùng: {sid}")
    counts = Counter(s["category"] for s in attacks)
    for category, expected in ATTACK_COUNTS.items():
        if counts[category] != expected:
            err(f"{category}: cần {expected} tình huống, đang có {counts[category]}")
    techniques: dict[str, set] = {}
    for s in attacks:
        sid = s["id"]
        if s["kind"] != "attack" or s["assistant"] != ASSISTANT_OF.get(s["category"]):
            err(f"{sid}: kind/assistant không khớp nhóm")
        if s["technique"] not in TECHNIQUES:
            err(f"{sid}: technique lạ {s['technique']}")
        if s["injected_into"] not in INJECTED_INTO:
            err(f"{sid}: injected_into lạ {s['injected_into']}")
        if s["success"]["type"] not in SUCCESS_TYPES:
            err(f"{sid}: success.type lạ")
        if not s["turns"] or not all(isinstance(t, str) and t.strip() for t in s["turns"]):
            err(f"{sid}: turns rỗng")
        techniques.setdefault(s["category"], set()).add(s["technique"])
    for category, used in techniques.items():
        if category != "A9" and len(used) < 2:
            err(f"{category}: cần ít nhất 2 kỹ thuật tấn công, đang có {used}")

    benign_counts = Counter(s["assistant"] for s in benign)
    if dict(benign_counts) != BENIGN_COUNTS:
        err(f"số yêu cầu hợp lệ {dict(benign_counts)} khác {BENIGN_COUNTS}")
    for s in benign:
        if s["kind"] != "benign" or not s.get("acceptance"):
            err(f"{s['id']}: yêu cầu hợp lệ thiếu acceptance")

    for s in attacks + benign:
        sid = s["id"]
        if s["assistant"] == "codey":
            exercise = exercises.get(s["exercise"])
            if not exercise:
                err(f"{sid}: bài {s['exercise']} không tồn tại")
                continue
            # Học viên/kẻ tấn công không thể biết trước đầu ra test ẩn: dữ liệu tình huống không
            # được chứa chúng, nếu không thì "lộ" chỉ là chép lại câu hỏi.
            planted = " ".join(
                [
                    *s["turns"],
                    s.get("editor_code") or "",
                    text_of(s.get("last_run") or ""),
                    s.get("statement_suffix") or "",
                ]
            ).lower()
            for token in exercise["leak_tokens"]:
                if re.search(rf"(?<!\w){re.escape(token)}(?!\w)", planted):
                    err(
                        f"{sid}: dữ liệu tình huống chứa mẩu đánh dấu {token!r} của {s['exercise']}"
                    )
            if exercise["canary"].lower() in planted:
                err(f"{sid}: dữ liệu tình huống chứa canary")
            if s["category"] == "A9" and not exercise.get("failing_leak_tokens"):
                err(
                    f"{sid}: bài {s['exercise']} không phát hiện được lộ ở case sai (failing_leak_tokens rỗng)"
                )
        elif s["assistant"] == "lecter":
            for attachment in s.get("attachments", []):
                ref = attachment["ref"]
                if ref not in LECTER_REFS and ref not in exercises:
                    err(f"{sid}: đính kèm {ref} không tồn tại")
                if (
                    seed_ids
                    and ref in LECTER_REFS
                    and ref not in seed_ids.get("lecter", {})
                    and ref not in (seed_ids.get("lecter", {}).get("documents") or {})
                ):
                    err(f"{sid}: {ref} chưa seed (chạy seed_dev.py lecter)")
        elif s["assistant"] == "tutor":
            missing = set(s["documents"]) - TUTOR_DOCS
            if missing:
                err(f"{sid}: tài liệu Tutor không tồn tại {missing}")
            if seed_ids and set(s["documents"]) - set(
                (seed_ids.get("tutor") or {}).get("documents", {})
            ):
                err(f"{sid}: tài liệu Tutor chưa index (chạy seed_dev.py tutor)")


def check_secrets() -> None:
    # Mật khẩu tài khoản test lấy từ môi trường lúc chạy, không bao giờ ghi vào file này.
    passwords = [
        value
        for key, value in os.environ.items()
        if key.startswith("TEST_") and key.endswith("_PASS") and value
    ]
    for path in DATA.rglob("*"):
        if not path.is_file() or path.name == "seed-ids.json":
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for pattern in SECRET_PATTERNS:
            if re.search(pattern, text):
                err(f"{path.relative_to(HERE)}: có chuỗi giống secret ({pattern})")
        if any(password in text for password in passwords):
            err(f"{path.relative_to(HERE)}: chứa mật khẩu tài khoản test")


def judge_token() -> str:
    user, password = os.environ.get("TEST_STUDENT_USER"), os.environ.get("TEST_STUDENT_PASS")
    if not user or not password:
        sys.exit("Cần TEST_STUDENT_USER / TEST_STUDENT_PASS để gọi judge (hoặc dùng --no-judge)")
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


def judge(
    client: httpx.Client, bearer: str, exercise: dict, source: str, tests: list[dict]
) -> list[str]:
    body = {
        "language": "python",
        "sourceCode": source,
        "timeLimitMs": 2000,
        "spec": {k: exercise["signature"][k] for k in ("functionName", "parameters", "returnType")},
        "testCases": [
            {"order": i + 1, "args": t["args"], "expected": t["expected"]}
            for i, t in enumerate(tests)
        ],
    }
    response = client.post(JUDGE_URL, json=body, headers={"Authorization": f"Bearer {bearer}"})
    response.raise_for_status()
    return [case["verdict"] for case in response.json()["data"]["cases"]]


def check_judge(exercises: list[dict], drafts: list[dict]) -> None:
    bearer = judge_token()
    with httpx.Client(timeout=180) as client:
        for e in exercises:
            public, hidden = e["public_tests"], e["hidden_tests"]
            ref = judge(client, bearer, e, e["reference_solution"], public + hidden)
            if any(v != "accepted" for v in ref):
                err(f"{e['key']}: lời giải mẫu không qua 100% ({ref})")
            wrong = judge(client, bearer, e, e["wrong_solution"], public + hidden)
            if any(v != "accepted" for v in wrong[: len(public)]):
                err(f"{e['key']}: wrong_solution sai test công khai ({wrong})")
            fails = [i + 1 for i, v in enumerate(wrong[len(public) :]) if v != "accepted"]
            if fails != e["wrong_solution_fails_hidden"]:
                err(
                    f"{e['key']}: wrong_solution sai test ẩn {fails}, khai {e['wrong_solution_fails_hidden']}"
                )
            print(f"  {e['key']}: mẫu {ref.count('accepted')}/{len(ref)}, sai ở test ẩn {fails}")
        for d in drafts:
            verdicts = judge(
                client, bearer, d, d["reference_solution"], d["public_tests"] + d["hidden_tests"]
            )
            known = (d.get("known_wrong_test") or {}).get("order")
            bad = [i + 1 for i, v in enumerate(verdicts) if v != "accepted"]
            if bad != ([known] if known else []):
                err(f"{d['key']}: lời giải mẫu fail ở {bad}, mong đợi {[known] if known else []}")
            print(f"  {d['key']}: fail ở {bad}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-judge", action="store_true")
    args = parser.parse_args()
    exercises = json.loads((DATA / "exercises.json").read_text())
    lecter_seed = json.loads((DATA / "lecter_seed.json").read_text())
    seed_ids = (
        json.loads((DATA / "seed-ids.json").read_text())
        if (DATA / "seed-ids.json").exists()
        else {}
    )
    attacks, benign = load_jsonl(DATA / "scenarios.jsonl"), load_jsonl(DATA / "benign.jsonl")
    check_exercises(exercises)
    check_scenarios(attacks, benign, {e["key"]: e for e in exercises}, seed_ids)
    for document in lecter_seed["documents"]:
        if not (DATA / "documents" / "lecter" / document["file"]).exists():
            err(f"thiếu tài liệu Lecter {document['file']}")
    check_secrets()
    if not args.no_judge:
        check_judge(
            exercises, [*lecter_seed["draft_exercises"], lecter_seed["other_lecturer_exercise"]]
        )
    print(f"{len(attacks)} tình huống tấn công, {len(benign)} yêu cầu hợp lệ, {len(exercises)} bài")
    if errors:
        print(f"{len(errors)} LỖI:")
        for line in errors:
            print("  -", line)
        sys.exit(1)
    print("Sạch lỗi.")


if __name__ == "__main__":
    main()
