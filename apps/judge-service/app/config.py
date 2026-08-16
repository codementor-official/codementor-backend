from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

# The eight Node services read codementor-backend/.env; judge reads the same file so a
# connection string is never defined twice. Absolute, because `.env` alone resolves against
# the process working directory — which differs between `npm run judge:dev` and Docker.
BACKEND_DIR = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    port: int = 3007

    # Same names the Node services use. Judge only writes `processed_events` in postgres.
    database_url: str = "postgresql://codementor:codementor@localhost:5432/codementor"
    mongo_uri: str = "mongodb://codementor:codementor@localhost:27017/codementor?authSource=admin"
    mongo_db: str = "codementor"
    kafka_brokers: str = "localhost:9092"

    keycloak_issuer: str = ""
    keycloak_audience: str = ""

    # Which engine actually runs code. Only the selected module gets imported, so picking
    # "docker" never constructs a Judge0 client and vice versa. Judge0 stays configured but
    # unused: this host's cgroup v1/v2 split breaks isolate, which Judge0 depends on.
    execution_engine: Literal["docker", "judge0"] = "docker"
    judge0_url: str = "http://localhost:2358"

    # Ceiling on concurrent containers across all requests on this host. 4 is safe for a
    # shared dev box; the reference engine benchmarked 30-50 on a 12-core machine. Tune to
    # the host, this is not a universal number.
    docker_execution_concurrency: int = 4

    # Input ceilings. Without them one request is a way to exhaust the host, and this
    # process holds the Docker socket. See README §Bảo mật.
    max_source_bytes: int = 256_000
    max_test_cases: int = 100
    max_test_case_bytes: int = 64_000

    @property
    def kafka_bootstrap(self) -> list[str]:
        return [broker.strip() for broker in self.kafka_brokers.split(",") if broker.strip()]

    @property
    def asyncpg_dsn(self) -> str:
        # Prisma writes `?schema=public`, which asyncpg rejects as an unknown parameter.
        return self.database_url.split("?")[0]


settings = Settings()
