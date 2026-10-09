"""Định dạng câu trả lời của Tutor: model viết, code tách và đối chiếu.

Trước đây model trả JSON có schema (`sourceQuotes`, `supplementalAnswer`), nên câu trả lời chỉ
hiện ra khi đã viết xong — 10 đến 30 giây nhìn một dòng "đang soạn". Giờ model viết văn bản
thường, chảy ra từng chữ, với hai dấu mốc cố định chia hai khối:

    <<<TRICH_DAN>>>
    > câu chép nguyên văn từ nguồn [S1]

    > câu khác [S2]
    <<<GIAI_THICH>>>
    phần diễn giải, kiến thức mở rộng

Luật nghiệp vụ KHÔNG đổi, chỉ đổi chỗ đọc nó ra: `ground()` là `grounded_turn` cũ — một trích
đoạn chỉ được tính khi nó là chuỗi con THẬT của đúng nguồn nó ghi, phần giải thích không được
mang mã nguồn. Trình duyệt có một bản `splitAnswer` cùng luật tách để vẽ trong lúc chữ đang
chảy, nhưng chỉ bản ở đây quyết định cái gì được gọi là "từ tài liệu của bạn".
"""

import re

QUOTES = "<<<TRICH_DAN>>>"
EXPLAIN = "<<<GIAI_THICH>>>"

NO_DIRECT_ANSWER = (
    "Tài liệu chưa giải thích trực tiếp nội dung này. Phần dưới là kiến thức mở rộng của AI."
)
NO_INFORMATION = (
    "Tài liệu chưa có thông tin phù hợp cho câu hỏi này. Bạn có thể bổ sung nguồn hoặc hỏi về "
    "chủ đề của tài liệu."
)

# Mã nguồn ở CUỐI khối trích dẫn. Chỉ lấy mã cuối: một khối gắn hai mã là hai trích đoạn bị
# gộp, và không có cách nào biết đoạn nào thuộc nguồn nào.
_TRAILING_SOURCE = re.compile(r"\[(S\d+)\]\s*$")
_ANY_SOURCE = re.compile(r"\[S\d+\]")
_BLANK_LINE = re.compile(r"\n[ \t]*\n")
_QUOTE_PREFIX = re.compile(r"^>\s?")
# Model hay bọc trích dẫn trong dấu nháy. Nháy không có trong nguồn, nên để nguyên là làm hỏng
# phép so chuỗi con của một câu chép đúng.
_WRAPPING_QUOTES = "\"'“”‘’«»"


def split_answer(raw: str) -> tuple[list[dict], str]:
    """`(trích đoạn, phần giải thích)` từ văn bản model viết.

    Thiếu cả hai dấu mốc thì coi TOÀN BỘ là phần giải thích: một câu trả lời sai định dạng không
    được phép lọt vào khối "từ tài liệu" chỉ vì nó trông giống trích dẫn.
    """
    text = raw.replace("\r\n", "\n")
    if QUOTES not in text and EXPLAIN not in text:
        return [], text.strip()
    head, _, explanation = text.partition(EXPLAIN)
    section = head.split(QUOTES, 1)[1] if QUOTES in head else ""
    quotes = []
    for block in _BLANK_LINE.split(section):
        lines = [line.strip() for line in block.strip().splitlines() if line.strip()]
        body = " ".join(_QUOTE_PREFIX.sub("", line) for line in lines).strip()
        match = _TRAILING_SOURCE.search(body)
        if not match:
            continue
        quote = body[: match.start()].strip().strip(_WRAPPING_QUOTES).strip()
        if quote:
            quotes.append({"sourceId": match.group(1), "quote": quote})
    return quotes, explanation.strip()


def _squash(text: str) -> str:
    # `\"` → `"`: model hay chép lại dấu nháy đã escape khi nguồn từng đi dạng JSON. Không có
    # tài liệu học nào cố ý chứa `\"`, nên gỡ escape không làm câu bịa thành câu thật.
    return " ".join(text.replace('\\"', '"').split())


def ground(raw: str, sources: list[dict]) -> dict:
    """Một lượt đã đối chiếu, cùng hình dạng một turn của `ai_conversations` cũ.

    `sources`: `[{sourceId, documentId, title, page, excerpt}]` — đúng thứ đã đưa cho model.
    """
    quotes, supplemental = split_answer(raw)
    evidence = {source["sourceId"]: source for source in sources}
    # Một mã nguồn hợp lệ không chứng minh được câu do AI viết. Chỉ hiện ở khối "từ tài liệu"
    # những câu là chuỗi con thật của đúng nguồn đó; phần diễn giải ở riêng một chỗ.
    verified: list[dict] = []
    for item in quotes:
        source = evidence.get(item["sourceId"])
        quote = _squash(item["quote"])
        if source and quote and quote in _squash(source["excerpt"]) and item not in verified:
            verified.append(item)
    insufficient = not verified
    # Trích dẫn tài liệu và kiến thức bổ sung không bao giờ được giả làm nhau.
    if _ANY_SOURCE.search(supplemental):
        supplemental = ""
    if insufficient:
        answer = NO_DIRECT_ANSWER if supplemental else NO_INFORMATION
    else:
        answer = "\n\n".join(
            "> " + item["quote"].replace("\n", "\n> ") + f" [{item['sourceId']}]"
            for item in verified
        )
    ids = list(dict.fromkeys(item["sourceId"] for item in verified))
    return {
        "answer": answer,
        "supplementalAnswer": supplemental,
        "insufficientEvidence": insufficient,
        "citations": []
        if insufficient
        else [
            {
                "sourceId": source_id,
                "documentId": evidence[source_id]["documentId"],
                "title": evidence[source_id]["title"],
                "page": evidence[source_id]["page"],
                "excerpt": evidence[source_id]["excerpt"],
            }
            for source_id in ids
        ],
    }


def as_history(turn: dict) -> str:
    """Lượt cũ, viết lại cho model đọc ở lượt sau — bản ĐÃ đối chiếu, không phải bản thô.

    Đưa lại bản thô thì một trích dẫn bịa đã bị loại vẫn nằm trong ngữ cảnh, và model có thể
    dựa vào nó như thể đó là điều tài liệu nói.

    Bỏ mã `[Sn]`: mã đánh số lại ở MỖI lượt, nên `[S1]` của lượt trước là một nguồn khác, và
    để nó lại là mời model chép mã cũ vào câu trả lời mới.
    """
    text = "\n\n".join(part for part in (turn["answer"], turn["supplementalAnswer"]) if part)
    return _ANY_SOURCE.sub("", text)
