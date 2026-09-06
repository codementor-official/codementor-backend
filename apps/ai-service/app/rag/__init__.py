"""Tầng tài liệu dùng chung cho mọi chatbot.

Hai nửa tách bạch có chủ đích:

- `index` — nhận một tệp trên S3, trích văn bản, cắt đoạn, sinh embedding, rồi cho tìm lại
  theo ngữ nghĩa. KHÔNG biết gì về nghiệp vụ: phạm vi sở hữu chỉ là một chuỗi `scope`, nên
  nhóm học, Lecter và Codey sau này dùng chung đúng một hàng đợi và một worker.
- `service` — sản phẩm hỏi đáp có trích dẫn của nhóm học (`ai_conversations`, `grounded_turn`).
  Nó dựng TRÊN `index`, không phải ngược lại; một agent soạn bài không cần gì ở đây.

Chia theo đường đó vì đúng một thứ ở nửa dưới là tái dùng được, và trước khi tách thì nó bị
`workspaceId` khoá cứng ở ba chỗ: khoá index, bộ lọc Mongo, và hàng rào prefix S3.
"""

from app.rag.documents import SUPPORTED_TYPES, DocumentStorage
from app.rag.index import DocumentIndex
from app.rag.service import RagService

__all__ = ["SUPPORTED_TYPES", "DocumentIndex", "DocumentStorage", "RagService"]
