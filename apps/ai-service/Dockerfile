FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.11.16 /uv /bin/
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY app ./app
ENV TIKTOKEN_CACHE_DIR=/app/.tiktoken
RUN uv run --no-sync python -c "import tiktoken; tiktoken.get_encoding('cl100k_base')"
RUN useradd --create-home ai && chown -R ai:ai /app
USER ai
EXPOSE 3008
CMD ["uv", "run", "--no-sync", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3008"]
