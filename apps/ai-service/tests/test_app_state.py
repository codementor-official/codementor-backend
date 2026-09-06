"""Mọi thứ router đọc từ `app.state` phải thật sự tồn tại sau khi lifespan chạy.

Vì sao có tệp này: một lần tách `RagService` đã bỏ thuộc tính `provider` khỏi nó, và BA router
không liên quan gì tới nhau — dashboard, gợi ý testcase, Lecter — đều đang lấy provider qua
`app.state.rag.provider`. Cả ba cùng trả 500 ngay dòng đầu, và không một test nào thấy: chúng
kiểm hàm thuần, còn phần nối dây thì không ai đụng tới.

Test này không gọi mạng và không cần Mongo chạy: `AsyncMongoClient` nối lười, còn `OpenAIProvider`
chỉ dựng client.
"""

import ast
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

APP_DIR = Path(__file__).resolve().parents[1] / "app"


def state_attributes() -> set[str]:
    """Mọi `…app.state.X` đọc trong mã router, tìm bằng AST chứ không phải regex."""
    found: set[str] = set()
    for path in APP_DIR.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            # Bắt đúng hình dạng `<gì đó>.state.<tên>`; `.app` có thể vắng (`request.state`
            # là thứ khác, nên đòi node cha là một Attribute tên `state` có cha tên `app`).
            if (
                isinstance(node, ast.Attribute)
                and isinstance(node.value, ast.Attribute)
                and node.value.attr == "state"
                and isinstance(node.value.value, ast.Attribute)
                and node.value.value.attr == "app"
            ):
                found.add(node.attr)
    return found


def test_router_code_reads_at_least_the_known_state():
    """Hàng rào cho chính bộ dò ở trên: nó hỏng thì test dưới sẽ xanh một cách vô nghĩa."""
    assert {"rag", "index", "library"} <= state_attributes()


def test_every_state_attribute_the_routers_read_exists():
    with TestClient(app):
        missing = sorted(name for name in state_attributes() if not hasattr(app.state, name))
    assert not missing, f"router đọc app.state.{missing} nhưng lifespan không đặt"


def nested_state_reads() -> list[str]:
    """Mọi chỗ đọc xuyên qua một service trên state: `app.state.<gì đó>.<gì đó>`.

    Đây là ĐÚNG hình dạng của lỗi gốc — `app.state.rag.provider` ở ba router. Bộ dò ở trên
    không thấy nó (nó chỉ nhìn một tầng), nên nếu chỉ có test kia thì cùng một lỗi sẽ quay lại
    dưới một cái tên khác.
    """
    offenders: list[str] = []
    for path in APP_DIR.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            outer = node.value if isinstance(node, ast.Attribute) else None
            if (
                isinstance(outer, ast.Attribute)
                and isinstance(outer.value, ast.Attribute)
                and outer.value.attr == "state"
                and isinstance(outer.value.value, ast.Attribute)
                and outer.value.value.attr == "app"
            ):
                offenders.append(
                    f"{path.relative_to(APP_DIR)}: app.state.{outer.attr}.{node.attr}"
                )
    return sorted(offenders)


def test_no_router_reaches_through_a_service_on_app_state():
    """Hạ tầng dùng chung phải nằm THẲNG trên `app.state`, không nấp trong một service nghiệp vụ.

    Ba router — dashboard, gợi ý testcase, Lecter — từng lấy OpenAI provider qua
    `app.state.rag.provider`. `RagService` vì thế thành sổ tra cứu dịch vụ, và một lần tái cấu
    trúc phần tài liệu (bỏ `provider` khỏi nó) làm cả ba trả 500 ngay dòng đầu. Không router nào
    trong ba cái đó liên quan gì tới hỏi đáp tài liệu.

    Cần thêm một thứ dùng chung? Đặt nó lên `app.state` trong lifespan, đừng treo nhờ.
    """
    offenders = nested_state_reads()
    assert not offenders, "đọc xuyên qua service trên app.state:\n  " + "\n  ".join(offenders)
