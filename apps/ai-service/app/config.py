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


settings = Settings()
