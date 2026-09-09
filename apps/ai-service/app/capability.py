"""Giấy phép của MỘT bề mặt agent: tool nào được bind, prompt nào nạp, model nào chạy, tiêu
hạn mức nào.

Vì sao là một đối tượng chứ không phải vài hằng số rải rác: phạm vi của một bề mặt — "chỉ bài
code, chỉ trong nhóm này", "không có tool nào cả" — là một quyết định BẢO MẬT, và nó phải nằm ở
một chỗ duy nhất mà server tính ra. Không phải ở prompt, và tuyệt đối không đến từ trình duyệt.

Nằm ở gốc `app/` chứ không trong `lecter/`: Codey dùng chung đúng lớp này, và một `Capability`
nhập từ `app.lecter` sang `app.codey` là thứ khiến người đọc tưởng Codey là một nhánh của Lecter.
Vòng lặp thì cũng dùng chung — xem `app/graph.py`.
"""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Capability:
    """Một bề mặt agent. `agent_id` vừa là khoá lịch sử hội thoại, vừa là khoá tra graph."""

    agent_id: str
    tools: tuple[Any, ...]
    instructions: str
    # Model của bề mặt này. KHÔNG đọc thẳng `settings` trong `graph.py`: Lecter cần một model
    # bám được chuỗi gọi tool 5 bước, còn Codey là hội thoại ngắn nơi độ trễ mới là tính năng.
    # Một hằng số dùng chung buộc hai nhu cầu đó phải giống nhau.
    model: str
    # Tên tool GHI mà bề mặt này có. Tool `validate_exercise_content` nhắc đúng tên này khi nội
    # dung hợp lệ — nhắc sai tên là bảo model gọi một thứ không tồn tại trong giấy phép của nó.
    # Rỗng với bề mặt chỉ đọc.
    write_tool: str
    budget_key: str
    daily_limit: int
    # Hàng rào chi phí, không phải hàng rào logic: một agent lặp mãi vì tool trả lỗi là chuyện
    # có thật, và giới hạn bước là cách rẻ nhất chặn nó.
    recursion_limit: int
    # Câu nói khi hết hạn mức ngày. Mỗi bề mặt một câu vì người dùng không biết "hạn mức AI" của
    # họ chia làm mấy ngăn — họ chỉ biết vừa bấm cái gì.
    budget_message: str
