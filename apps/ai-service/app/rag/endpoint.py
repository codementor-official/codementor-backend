"""Bề mặt HTTP của Tài liệu: `/api/v1/ai/documents`.

Đặt ngoài `/lecter` vì đây là hạ tầng dùng chung — Codey sau này gắn thêm một `scope` khác chứ
không dựng một bộ route thứ hai.

Tệp KHÔNG đi qua service này. `main.py` chặn body > 2 MB cho cả `/api/v1/ai/*`, và một tệp 20 MB
chạy qua Kong rồi qua Uvicorn chỉ để rơi vào S3 là ba chặng thừa. Trình duyệt `PUT` thẳng lên kho
bằng URL đã ký, đúng cách video bài học và tài liệu nhóm đang làm.
"""

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from app.auth import require_user
from app.rag.documents import SUPPORTED_TYPES

router = APIRouter(prefix="/api/v1/ai/documents")


class PresignRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=500)
    sizeBytes: int = Field(ge=1)


class RegisterRequest(BaseModel):
    objectKey: str = Field(min_length=1, max_length=2000)
    filename: str = Field(min_length=1, max_length=500)


def library(request: Request):
    return request.app.state.library


@router.get("/status")
async def status(request: Request, claims: dict = Depends(require_user)):
    """Trần và định dạng, để giao diện không phải chép cứng con số."""
    store = library(request)
    return {
        "data": {
            "supportedTypes": SUPPORTED_TYPES,
            "maxFileBytes": store.max_bytes(),
            "maxFilesPerMessage": store.config.ai_document_max_files,
        }
    }


@router.post("/presign")
async def presign(
    payload: PresignRequest, request: Request, claims: dict = Depends(require_user)
):
    return {"data": library(request).presign(claims["sub"], payload.filename, payload.sizeBytes)}


@router.post("")
async def register(
    payload: RegisterRequest, request: Request, claims: dict = Depends(require_user)
):
    return {
        "data": await library(request).register(
            claims["sub"], payload.objectKey, payload.filename
        )
    }


@router.get("")
async def listing(request: Request, claims: dict = Depends(require_user)):
    return {"data": {"items": await library(request).list(claims["sub"])}}


@router.get("/{document_id}")
async def detail(document_id: str, request: Request, claims: dict = Depends(require_user)):
    return {"data": await library(request).get(claims["sub"], document_id)}


@router.get("/{document_id}/download")
async def download(document_id: str, request: Request, claims: dict = Depends(require_user)):
    return {"data": await library(request).download_url(claims["sub"], document_id)}


@router.post("/{document_id}/reindex")
async def reindex(document_id: str, request: Request, claims: dict = Depends(require_user)):
    return {"data": await library(request).reindex(claims["sub"], document_id)}


@router.delete("/{document_id}")
async def remove(document_id: str, request: Request, claims: dict = Depends(require_user)):
    return {"data": await library(request).delete(claims["sub"], document_id)}
