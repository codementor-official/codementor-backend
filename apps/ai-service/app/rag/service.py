from app.config import Settings
from app.models import InternalRequest
from app.rag.index import DocumentIndex


class RagService:
    """Tài liệu của nhóm học, nhìn từ workspace-service: trạng thái index và xếp hàng.

    Dựng TRÊN `DocumentIndex` chứ không sở hữu nó — phần xếp hàng, worker và tìm kiếm là hạ
    tầng dùng chung. Phần hỏi đáp (hội thoại, trích dẫn) đã chuyển sang `app/tutor`, chạy trên
    cùng đường AG-UI với Codey/Lecter; `ai_conversations` chỉ còn là nguồn của script migrate.

    Phạm vi ở đây luôn là `workspace:{id}`.
    """

    def __init__(self, db, config: Settings, index: DocumentIndex):
        self.db = db
        self.config = config
        self.index = index

    @staticmethod
    def index_scope(request: InternalRequest) -> str:
        return f"workspace:{request.workspaceId}"

    def status(self):
        return self.index.status()

    async def states(self, request: InternalRequest):
        return await self.index.states(self.index_scope(request), request.source_dicts)

    async def queue_index(self, request: InternalRequest):
        # Không trừ hạn mức: mỗi câu hỏi Tutor đã trừ một lượt "rag" (`agent_stream`), nên trừ
        # thêm ở đây là một câu hỏi kèm ba tài liệu mới tốn bốn lượt — và tick chọn rồi bỏ tick
        # (index bắt đầu ngay lúc chọn) tốn lượt cho câu chưa hỏi. Không có đường lạm dụng: chỉ
        # index được tài liệu đã duyệt của nhóm mình đọc được, mỗi bản một lần theo `revision`.
        # Tài liệu giảng viên tự tải lên (`library.py`) vẫn trừ — số tệp đó không có trần.
        return await self.index.queue(
            self.index_scope(request), request.source_dicts[0], str(request.userId), charge=False
        )
