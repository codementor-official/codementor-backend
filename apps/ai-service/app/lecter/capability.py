"""Hai bề mặt Lecter. Lớp `Capability` và vòng lặp thì dùng chung — `app/capability.py`,
`app/graph.py` — vì Codey chạy trên đúng hai thứ đó.
"""

from app.capability import Capability
from app.config import settings
from app.lecter.prompt import INSTRUCTIONS, WORKSPACE_INSTRUCTIONS
from app.lecter.tools import LECTURER_TOOLS, WORKSPACE_TOOLS

BUDGET_MESSAGE = "Bạn đã dùng hết lượt soạn nội dung bằng AI hôm nay. Thử lại vào ngày mai (UTC)."


LECTURER = Capability(
    agent_id="lecter",
    tools=LECTURER_TOOLS,
    instructions=INSTRUCTIONS,
    model=settings.smart_model,
    write_tool="save_exercise_content",
    budget_key="lecter",
    daily_limit=settings.ai_lecter_daily_limit,
    # ~8 lượt gọi model có tool. Nhánh khóa học/lộ trình cần nhiều bước hơn hẳn.
    recursion_limit=24,
    budget_message=BUDGET_MESSAGE,
)

WORKSPACE = Capability(
    agent_id="lecter_workspace",
    tools=WORKSPACE_TOOLS,
    instructions=WORKSPACE_INSTRUCTIONS,
    model=settings.smart_model,
    # Tool của trình duyệt, không ghi vào hệ thống: nó đổ nội dung vào biểu mẫu studio.
    write_tool="apply_exercise_draft",
    # Namespace hạn mức riêng: học viên đông hơn giảng viên một bậc, và không nên tiêu chung
    # một quota với người đang soạn cả một khóa học.
    budget_key="lecter_workspace",
    daily_limit=settings.ai_lecter_workspace_daily_limit,
    # Chuỗi việc ngắn hơn: đọc tài liệu → soạn → chạy thử → sửa → validate → đưa vào form.
    recursion_limit=16,
    budget_message=BUDGET_MESSAGE,
)
