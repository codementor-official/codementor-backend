import asyncio
import hmac
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pymongo import AsyncMongoClient
from pymongo.errors import PyMongoError

from app.config import settings
from app.dashboard import router as dashboard_router
from app.lecter.endpoint import router as lecter_router
from app.models import InternalRequest
from app.provider import OpenAIProvider
from app.rag import DocumentIndex, DocumentLibrary, DocumentStorage, RagService
from app.rag.endpoint import router as documents_router
from app.suggest import router as suggest_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    client = AsyncMongoClient(settings.mongo_uri, serverSelectionTimeoutMS=3000, tz_aware=True)
    provider = OpenAIProvider(settings)
    database = client[settings.mongo_db]
    # MỘT `DocumentIndex` cho cả tiến trình, và đúng MỘT worker. Mỗi bề mặt dựng một bản riêng
    # nghĩa là mỗi bản một vòng lặp poll cùng một collection, tranh nhau lease của cùng một job.
    storage = DocumentStorage(settings)
    app.state.index = DocumentIndex(database, settings, provider, storage)
    app.state.rag = RagService(database, settings, app.state.index)
    app.state.library = DocumentLibrary(database, settings, app.state.index, storage)
    worker = asyncio.create_task(app.state.index.worker())
    try:
        yield
    finally:
        worker.cancel()
        with suppress(asyncio.CancelledError):
            await worker
        await provider.close()
        await client.close()


app = FastAPI(
    title="CodeMentor AI (internal)",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.middleware("http")
async def internal_auth(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/v1/internal/"):
        secret = settings.internal_service_token.get_secret_value()
        provided = request.headers.get("x-internal-service-token", "")
        if len(secret) < 24 or not hmac.compare_digest(secret.encode(), provided.encode()):
            return JSONResponse({"message": "Internal access only."}, status_code=401)
    # Hai đường, hai cơ chế auth: `/api/v1/ai/*` là đường công khai và tự kiểm JWT Keycloak ở
    # `app/auth.py`. Điểm chung duy nhất là trần kích thước body — thứ phải chặn trước khi
    # Pydantic kịp dựng model.
    if path.startswith(("/api/v1/internal/", "/api/v1/ai/")):
        length = request.headers.get("content-length", "0")
        if not length.isdigit() or int(length) > 2_000_000:
            return JSONResponse({"message": "Request too large."}, status_code=413)
    return await call_next(request)


@app.exception_handler(HTTPException)
async def http_error(_request: Request, exc: HTTPException):
    return JSONResponse({"message": exc.detail}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_error(_request: Request, _exc: RequestValidationError):
    # Pydantic's default error includes input values; never echo document descriptors.
    # Câu này giờ ra cả đường công khai nên không nói "nội bộ" nữa.
    return JSONResponse({"message": "Yêu cầu gửi lên AI không hợp lệ."}, status_code=400)


@app.exception_handler(PyMongoError)
async def mongo_error(_request: Request, _exc: PyMongoError):
    return JSONResponse(
        {"message": "AI chưa kết nối được MongoDB. Kiểm tra Docker và ENV."}, status_code=503
    )


app.include_router(suggest_router)
app.include_router(dashboard_router)
app.include_router(lecter_router)
app.include_router(documents_router)


@app.get("/api/v1/health")
async def health():
    return {"data": {"status": "ok", "service": "ai-service", "runtime": "python"}}


@app.post("/api/v1/internal/workspace-ai/{action}")
async def execute(action: str, body: InternalRequest, request: Request):
    rag = request.app.state.rag
    if action == "status":
        result = rag.status()
    elif action == "documents":
        result = await rag.states(body)
    elif action == "index" and len(body.sources) == 1:
        result = await rag.queue_index(body)
    elif action == "create" and 1 <= len(body.sources) <= 8:
        result = await rag.create(body)
    elif action == "list":
        result = await rag.list(body)
    elif action in ("metadata", "delete") and body.id:
        result = await getattr(rag, action)(body)
    elif action == "read" and body.id and 1 <= len(body.sources) <= 8:
        result = await rag.read(body)
    elif (
        action == "ask"
        and body.id
        and body.question
        and body.requestId
        and 1 <= len(body.sources) <= 8
    ):
        result = await rag.ask(body)
    else:
        raise HTTPException(400, "Thao tác AI không hợp lệ.")
    return {"data": result}
