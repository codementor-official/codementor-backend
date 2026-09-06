from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

_parents = Path(__file__).resolve().parents
BACKEND_DIR = _parents[3] if len(_parents) > 3 else _parents[1]


class Settings(BaseSettings):
    # Reuse the backend ENV. A second AI-specific credential file is not needed.
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )
    port_ai: int = 3008
    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "codementor"
    internal_service_token: SecretStr = SecretStr("")
    openai_api_key: SecretStr = SecretStr("")
    openai_embedding_model: str = "text-embedding-3-small"
    openai_chat_model: str = "gpt-5-nano"
    ai_request_timeout_ms: int = Field(default=90000, ge=5000, le=180000)
    ai_daily_request_limit: int = Field(default=50, ge=1, le=1000)
    ai_suggest_daily_limit: int = Field(default=100, ge=1, le=2000)
    # Một run Lecter tiêu 5-15 lời gọi model (soạn đề -> solution -> chạy thử -> sửa ->
    # chạy lại), nên hạn mức của nó thấp hơn hẳn hai bề mặt kia và đếm bằng namespace
    # riêng trong `ai_usage`.
    ai_lecter_daily_limit: int = Field(default=30, ge=1, le=500)
    # Việc suy luận (soạn đề, viết lời giải) cần model khác việc mẫu (gợi ý testcase).
    # Mặc định KHÔNG để trống nữa: rơi về `gpt-5-nano` nghĩa là Lecter chạy bằng model không
    # bám nổi một quy trình gọi tool 5 bước — nó gửi lại cùng một payload ba lần rồi bỏ cuộc,
    # để lại bài nháp chỉ có tiêu đề. Đặt biến môi trường để đổi; đặt rỗng để rơi về
    # `openai_chat_model`.
    ai_model_smart: str = "gpt-5.4-mini"
    # Lecter gọi thẳng service, không vòng lại Kong: mỗi service tự verify JWT Keycloak
    # (kong.yml không có plugin jwt) nên forward Authorization là đủ, và đi thẳng thì
    # không phải hairpin qua gateway từ bên trong mạng nội bộ.
    core_service_url: str = "http://localhost:3001"
    exercise_service_url: str = "http://localhost:3003"
    learning_service_url: str = "http://localhost:3002"
    judge_service_url: str = "http://localhost:3007"
    # Cùng tên biến mà Nest và judge-service đang dùng. KHÔNG đặt biến riêng cho
    # ai-service: hai issuer lệch nhau thì đăng nhập vẫn được mà mọi lời gọi trả 401.
    keycloak_issuer: str = ""
    keycloak_audience: str = ""
    aws_region: str = "ap-southeast-1"
    aws_s3_bucket: str = ""
    aws_access_key_id: SecretStr = SecretStr("")
    aws_secret_access_key: SecretStr = SecretStr("")
    aws_session_token: SecretStr = SecretStr("")
    aws_s3_endpoint: str = ""
    aws_s3_force_path_style: bool = False
    aws_s3_document_prefix: str = "public/workspace-documents"
    document_max_upload_mb: int = Field(default=20, ge=1)

    @property
    def configured(self) -> bool:
        return bool(self.openai_api_key.get_secret_value().strip())

    @property
    def smart_model(self) -> str:
        return self.ai_model_smart.strip() or self.openai_chat_model


settings = Settings()
