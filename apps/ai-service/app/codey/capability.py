"""Giấy phép của Codey: không có tool server nào.

`tools=()` là quyết định BẢO MẬT, không phải sự lười. Một tool server đọc bài code chỉ có hai
lối, cả hai đều xấu: đi đường nội bộ thì lời giải mẫu và test case ẩn vào thẳng context của
Codey và thứ duy nhất ngăn nó đọc ra là một câu trong prompt; đi đường học viên bằng token của
chính họ thì nhận về ĐÚNG cái trình duyệt đã có. Nên toàn bộ ngữ cảnh đến từ trình duyệt, qua
tool trình duyệt, và tất cả đều chỉ đọc.
"""

from app.capability import Capability
from app.codey.prompt import INSTRUCTIONS
from app.config import settings

CODEY = Capability(
    agent_id="codey",
    tools=(),
    instructions=INSTRUCTIONS,
    # Hội thoại ngắn, không có chuỗi gọi tool nhiều bước để mà bám. Ở đây độ trễ là TÍNH NĂNG:
    # một trợ giảng trả lời sau 8 giây thì học viên đã tự mở tab khác rồi.
    model=settings.openai_chat_model,
    # Không có tool ghi. Codey không tạo, không sửa, không lưu gì cả.
    write_tool="",
    budget_key="codey",
    daily_limit=settings.ai_codey_daily_limit,
    # Codey không có tool server nào để lặp, nên vòng lặp duy nhất có thể xảy ra là model bịa
    # tên một tool không tồn tại. 6 bước đủ để nó tự sửa, và đủ thấp để không tốn tiền vô ích.
    recursion_limit=6,
    budget_message="Bạn đã dùng hết lượt hỏi Codey hôm nay. Thử lại vào ngày mai (UTC) nhé.",
)
