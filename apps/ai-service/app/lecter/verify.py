"""Chạy lời giải mẫu NẰM TRONG content sắp lưu, qua bộ chấm thật.

Vì sao tệp này tồn tại: `validate_exercise_content` chỉ kiểm hình dạng, và `run_solution` là một
tool riêng mà model tự gọi với đoạn code nó tự chọn. Không gì buộc hai thứ đó là một. Chuyện đã
xảy ra (`lecter:085f0cde-…`): model gửi cho bộ chấm

    def main():
        print('placeholder')

nhận `verdict=wrong_answer pass=0/3`, rồi lưu vào `referenceSolution` một chương trình HOÀN TOÀN
KHÁC. Bộ chấm chưa bao giờ nhìn thấy đoạn code được ghi xuống, và không có gì chặn việc đó.

Ở đây thì khác: đầu vào là chính `content` sắp ghi, nên verdict trả về nói về đúng thứ sẽ nằm
trong cơ sở dữ liệu.
"""

from typing import Any

from langchain_core.runnables import RunnableConfig

from app.lecter import http
from app.lecter.http import ToolCallError, clip

# Trần số ngôn ngữ chạy thử một lượt. Gần như mọi bài chỉ khai một; trần này chỉ để một content
# khai mười ngôn ngữ không biến một lần bấm nút thành mười lần chạy sandbox.
MAX_LANGUAGES = 3
MAX_FAILING = 3


def _judge_body(content: dict, language: dict) -> dict:
    body: dict[str, Any] = {
        "language": language.get("id"),
        "sourceCode": language.get("referenceSolution") or "",
        "timeLimitMs": content.get("timeLimitMs") or 1000,
        "memoryLimitKb": content.get("memoryLimitKb") or 262144,
        # `expected: None` nổ ở `expected_output.strip()` phía bộ chấm — bỏ hẳn khoá, giống
        # `_drop_empty_expected` trong tools.py.
        "testCases": [
            {key: value for key, value in case.items() if not (key == "expected" and value is None)}
            for case in (content.get("testCases") or [])
            if isinstance(case, dict)
        ],
    }
    if content.get("signature"):
        body["spec"] = content["signature"]
    return body


async def run_reference_solutions(content: dict, config: RunnableConfig) -> list[dict]:
    """Kết quả chạy từng ngôn ngữ có `referenceSolution`. Rỗng = không có gì để chạy.

    Bộ chấm hỏng KHÔNG được thành lỗi cứng: sandbox stdin từng hỏng cục bộ suốt nhiều ngày, và
    chặn lưu khi không chấm được sẽ làm Lecter tê liệt trong lúc dev. Trả về `unavailable` để
    tầng trên hạ nó xuống mức cảnh báo.
    """
    languages = [
        language
        for language in (content.get("languages") or [])
        if isinstance(language, dict) and (language.get("referenceSolution") or "").strip()
    ]
    if not languages or not (content.get("testCases") or []):
        return []

    results: list[dict] = []
    for language in languages[:MAX_LANGUAGES]:
        entry: dict[str, Any] = {"language": language.get("id")}
        try:
            raw = await http.judge(
                "POST", "/api/v1/judge/run", config, json_body=_judge_body(content, language)
            ) or {}
        except ToolCallError as exc:
            entry["unavailable"] = str(exc)
            results.append(entry)
            continue

        cases = raw.get("cases") or []
        entry.update(
            verdict=raw.get("verdict"),
            passed=raw.get("passedTests"),
            total=raw.get("totalTests"),
            compileOutput=clip(raw.get("compileOutput") or "", 1000) or None,
            failing=[
                {
                    "order": case.get("order"),
                    "verdict": case.get("verdict"),
                    "expected": clip(case.get("expected")),
                    "actual": clip(case.get("actual")),
                }
                for case in cases
                if case.get("verdict") != "accepted"
            ][:MAX_FAILING],
        )
        results.append(entry)
    return results


def summarize(results: list[dict]) -> tuple[list[str], list[str]]:
    """(lỗi chặn, cảnh báo). Không chấm được là cảnh báo; chấm được mà trượt là lỗi chặn."""
    errors: list[str] = []
    warnings: list[str] = []
    for entry in results:
        language = entry.get("language") or "?"
        if entry.get("unavailable"):
            warnings.append(
                f"chưa chạy thử được lời giải {language}: {entry['unavailable']}. "
                "Nội dung vẫn lưu được, nhưng chưa ai xác nhận nó chạy đúng."
            )
        elif entry.get("verdict") != "accepted":
            detail = ", ".join(
                f"case #{case['order']} {case['verdict']}" for case in entry.get("failing") or []
            )
            errors.append(
                f"lời giải mẫu {language} KHÔNG chạy qua chính test case của bài: "
                f"{entry.get('verdict')} {entry.get('passed')}/{entry.get('total')}"
                + (f" — {detail}" if detail else "")
            )
    return errors, warnings
