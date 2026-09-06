"""Giấy phép của một bề mặt Lecter: tool nào được bind, prompt nào được nạp, tiêu hạn mức nào.

Vì sao là một đối tượng chứ không phải hai hằng số rải rác: phạm vi của Lecter phía học viên
("chỉ bài code, chỉ trong nhóm này") là một quyết định BẢO MẬT, và nó phải nằm ở một chỗ duy
nhất mà server tính ra — không phải ở prompt, và tuyệt đối không đến từ trình duyệt. Thêm một
bề mặt sau này (Codey chẳng hạn) là thêm một `Capability`, không phải fork `graph.py`.

Vòng lặp thì dùng chung: `graph.py` là lớp vá lỗi đã trả giá thật (lời gọi tool treo, tool server
bị bỏ giữa lượt HITL, model gọi lặp). Chép nó ra bản thứ hai là hẹn ngày hai bản lệch nhau.
"""

from dataclasses import dataclass
from typing import Any

from app.config import settings
from app.lecter.prompt import INSTRUCTIONS, WORKSPACE_INSTRUCTIONS
from app.lecter.tools import LECTURER_TOOLS, WORKSPACE_TOOLS


@dataclass(frozen=True)
class Capability:
    """Một bề mặt Lecter. `agent_id` vừa là khoá lịch sử hội thoại, vừa là khoá tra graph."""

    agent_id: str
    tools: tuple[Any, ...]
    instructions: str
    budget_key: str
    daily_limit: int
    # Hàng rào chi phí, không phải hàng rào logic: một agent lặp mãi vì tool trả lỗi là chuyện
    # có thật, và giới hạn bước là cách rẻ nhất chặn nó.
    recursion_limit: int


LECTURER = Capability(
    agent_id="lecter",
    tools=LECTURER_TOOLS,
    instructions=INSTRUCTIONS,
    budget_key="lecter",
    daily_limit=settings.ai_lecter_daily_limit,
    # ~8 lượt gọi model có tool. Nhánh khóa học/lộ trình cần nhiều bước hơn hẳn.
    recursion_limit=24,
)

WORKSPACE = Capability(
    agent_id="lecter_workspace",
    tools=WORKSPACE_TOOLS,
    instructions=WORKSPACE_INSTRUCTIONS,
    # Namespace hạn mức riêng: học viên đông hơn giảng viên một bậc, và không nên tiêu chung
    # một quota với người đang soạn cả một khóa học.
    budget_key="lecter_workspace",
    daily_limit=settings.ai_lecter_workspace_daily_limit,
    # Chuỗi việc ngắn hơn: đọc tài liệu → soạn → chạy thử → sửa → validate → đưa vào form.
    recursion_limit=16,
)

CAPABILITIES: dict[str, Capability] = {cap.agent_id: cap for cap in (LECTURER, WORKSPACE)}
