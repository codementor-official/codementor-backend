"""Giấy phép của Tutor: hỏi đáp tài liệu của nhóm học, có trích dẫn đối chiếu.

Không có tool nào — server hay trình duyệt. Tìm và đối chiếu là các node CỐ ĐỊNH trong graph của
nó (`app/tutor/graph.py`), không phải lựa chọn của model. Phạm vi đọc là những tài liệu
workspace-service đã xác nhận ở cổng của endpoint, mỗi lượt một lần.
"""

from app.capability import Capability
from app.config import settings
from app.tutor.graph import build
from app.tutor.prompt import INSTRUCTIONS

TUTOR = Capability(
    agent_id="tutor",
    tools=(),
    instructions=INSTRUCTIONS,
    # Cùng model và mức suy luận với lời gọi JSON cũ: câu trả lời chép nguyên văn từ đoạn đã
    # tìm sẵn, không có chuỗi gọi tool nào để mà cần model lớn.
    model=settings.openai_chat_model,
    reasoning_effort="low",
    write_tool="",
    # Giữ khoá hạn mức cũ: người dùng không mất hay được thêm lượt nào vì đổi kiến trúc, và
    # lượt index tài liệu mới (cũng khoá `rag`) vẫn tính chung một ngăn như trước.
    budget_key="rag",
    daily_limit=settings.ai_daily_request_limit,
    # Vòng đợi index tối đa 72 bước (3 phút) cộng ba node còn lại.
    recursion_limit=100,
    budget_message="Bạn đã dùng hết lượt hỏi trợ lý AI hôm nay. Thử lại vào ngày mai (UTC) nhé.",
    build_graph=build,
)
