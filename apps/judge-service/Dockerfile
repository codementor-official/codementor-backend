FROM python:3.11-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app
COPY pyproject.toml ./
RUN uv sync --no-install-project

COPY . .
RUN uv sync

# Runs code by talking to the host's Docker daemon (Docker-out-of-Docker), so the socket must
# be mounted in. That is root-equivalent access to the host — see README §Bảo mật.
EXPOSE 3007
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3007"]
