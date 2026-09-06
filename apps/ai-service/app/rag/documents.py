import asyncio
import io
import json
import logging
import math
import subprocess
import sys
import zipfile
from functools import lru_cache
from urllib.parse import quote

import boto3
import tiktoken
from botocore.config import Config
from fastapi import HTTPException

from app.config import Settings

logger = logging.getLogger("codementor.ai")

SUPPORTED_TYPES = ["pdf", "docx", "pptx", "txt", "md"]
MAX_FILE_BYTES = 20 * 1024 * 1024
# Cùng con số `AWS_S3_PRESIGNED_EXPIRES` mặc định bên Nest (`ObjectStorageService`).
PRESIGN_SECONDS = 900


class DocumentStorage:
    """Đọc đối tượng S3 đã có; không có luồng tải lên thứ hai ở đây."""

    def __init__(self, config: Settings):
        self.config = config

    def client(self):
        """Một client S3 mới cho mỗi thao tác.

        Dựng theo lượt chứ không giữ sẵn: `boto3` client không phải thứ an toàn để dùng chung
        giữa nhiều thread, và mọi lối gọi ở đây đều chạy trong `asyncio.to_thread`. Không khai
        khoá tường minh thì rơi về chuỗi credential mặc định, tức là IAM role trên EC2/ECS chạy
        được mà không cần biến môi trường nào.
        """
        if not self.config.aws_s3_bucket:
            raise HTTPException(503, "Chưa cấu hình kho lưu trữ tài liệu.")
        credentials = {}
        if self.config.aws_access_key_id.get_secret_value():
            credentials = {
                "aws_access_key_id": self.config.aws_access_key_id.get_secret_value(),
                "aws_secret_access_key": self.config.aws_secret_access_key.get_secret_value(),
            }
            if self.config.aws_session_token.get_secret_value():
                credentials["aws_session_token"] = self.config.aws_session_token.get_secret_value()
        return boto3.session.Session().client(
            "s3",
            region_name=self.config.aws_region,
            endpoint_url=self.config.aws_s3_endpoint or None,
            config=Config(
                connect_timeout=10,
                read_timeout=20,
                retries={"max_attempts": 1},
                s3={"addressing_style": "path" if self.config.aws_s3_force_path_style else "auto"},
            ),
            **credentials,
        )

    def read(self, allowed_prefix: str, source: dict) -> bytes:
        """Đọc tệp gốc, chỉ khi khoá của nó nằm dưới `allowed_prefix`.

        Prefix do NƠI GỌI đưa vào chứ không tự dựng ở đây: mỗi chủ thể có một nhánh riêng
        trong bucket (`…/workspaces/{id}/` cho nhóm học, `…/lecturer/{sub}/` cho tài liệu của
        giảng viên), và tầng này không biết — cũng không nên biết — chủ thể nào đang gọi.

        Hàng rào vẫn nguyên vẹn: nó là thứ duy nhất chặn một `storageKey` trỏ sang thư mục của
        người khác. Ai gọi cũng phải dựng prefix từ danh tính ĐÃ XÁC THỰC, đừng lấy từ payload.
        """
        key = source.get("storageKey")
        if not key:
            if source["docType"] in ("txt", "md") and source.get("previewText"):
                return source["previewText"].encode("utf-8")
            raise HTTPException(422, "Tài liệu chưa có tệp gốc trên storage. Hãy tải lại tệp.")
        expected = allowed_prefix if allowed_prefix.endswith("/") else allowed_prefix + "/"
        if not key.startswith(expected) or ".." in key:
            raise HTTPException(403, "Tài liệu không thuộc phạm vi này.")
        client = self.client()
        try:
            result = client.get_object(Bucket=self.config.aws_s3_bucket, Key=key)
            body = result["Body"]
            limit = min(MAX_FILE_BYTES, self.config.document_max_upload_mb * 1024 * 1024)
            try:
                if result.get("ContentLength", 0) > limit:
                    raise HTTPException(422, "Tài liệu vượt giới hạn 20 MB.")
                data = body.read(limit + 1)
                if len(data) > limit:
                    raise HTTPException(422, "Tài liệu vượt giới hạn 20 MB.")
                return data
            finally:
                body.close()
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(
                502, "Không đọc được tài liệu từ storage. Kiểm tra tệp và ENV."
            ) from None
        finally:
            client.close()


    # Cùng danh sách `SUPPORTED_TYPES`, tra ngược từ đuôi tệp. Không tin `contentType` trình
    # duyệt gửi lên: Windows gửi `application/octet-stream` cho .md, còn kẻ tấn công thì gửi gì
    # cũng được — đuôi tệp mới là thứ quyết định trình trích văn bản nào chạy.
    CONTENT_TYPES = {
        "pdf": "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "txt": "text/plain",
        "md": "text/markdown",
    }

    def presign_put(self, key: str, doc_type: str, size_bytes: int) -> dict:
        """URL để trình duyệt `PUT` thẳng lên S3.

        `ContentLength` nằm TRONG chữ ký, không phải chỉ kiểm ở tầng trên: thiếu nó thì một URL
        xin ký cho 1 MB đẩy được 1 GB, và mọi giới hạn phía trên chỉ còn là lời đề nghị.
        `ContentType` cũng vậy — ký cố định theo đuôi tệp nên trình duyệt không tự chọn được.
        """
        content_type = self.CONTENT_TYPES[doc_type]
        client = self.client()
        try:
            url = client.generate_presigned_url(
                "put_object",
                Params={
                    "Bucket": self.config.aws_s3_bucket,
                    "Key": key,
                    "ContentType": content_type,
                    "ContentLength": size_bytes,
                },
                ExpiresIn=PRESIGN_SECONDS,
            )
        finally:
            client.close()
        return {
            "uploadUrl": url,
            "headers": {"Content-Type": content_type, "Content-Length": str(size_bytes)},
            "objectKey": key,
            "expiresInSeconds": PRESIGN_SECONDS,
        }

    def presign_get(self, key: str, filename: str, doc_type: str) -> str:
        """URL đọc lại tệp gốc. Nhánh của tài liệu cá nhân KHÔNG công khai nên đây là đường duy nhất."""
        client = self.client()
        try:
            return client.generate_presigned_url(
                "get_object",
                Params={
                    "Bucket": self.config.aws_s3_bucket,
                    "Key": key,
                    "ResponseContentType": self.CONTENT_TYPES[doc_type],
                    "ResponseContentDisposition": (
                        "attachment; filename*=UTF-8''" + quote(filename, safe="")
                    ),
                },
                ExpiresIn=PRESIGN_SECONDS,
            )
        finally:
            client.close()

    def head(self, key: str) -> int | None:
        """Kích thước thật của đối tượng, hoặc `None` nếu chưa có.

        Đây là chỗ xác nhận trình duyệt đã `PUT` xong thật. Tin lời nó nói thì một lời gọi đăng
        ký có thể tạo ra một tài liệu trỏ tới khoá rỗng, và người dùng chỉ phát hiện khi worker
        báo lỗi mấy giây sau.
        """
        client = self.client()
        try:
            return client.head_object(Bucket=self.config.aws_s3_bucket, Key=key)["ContentLength"]
        except Exception:
            return None
        finally:
            client.close()

    def delete(self, key: str) -> None:
        client = self.client()
        try:
            client.delete_object(Bucket=self.config.aws_s3_bucket, Key=key)
        except Exception:
            # Xoá hàng trong Mongo mới là thứ người dùng thấy; một đối tượng mồ côi trên S3 sẽ
            # hết hạn theo lifecycle rule của bucket, và làm hỏng lệnh xoá vì nó thì tệ hơn.
            logger.warning("Không xoá được đối tượng S3; bỏ lại cho lifecycle rule.")
        finally:
            client.close()


@lru_cache(maxsize=1)
def tokenizer():
    return tiktoken.get_encoding("cl100k_base")


def chunk_pages(pages: list[dict]) -> list[dict]:
    chunks = []
    for page in pages:
        tokens = tokenizer().encode(page["text"].replace("\x00", "").strip(), disallowed_special=())
        for start in range(0, len(tokens), 520):
            text = tokenizer().decode(tokens[start : start + 600]).strip()
            if text:
                chunks.append({"text": text, "page": page["page"], "embedding": []})
            if len(chunks) > 160:
                raise ValueError(
                    "Tài liệu quá dài (tối đa 160 đoạn). Hãy chia thành tài liệu nhỏ hơn."
                )
            if start + 600 >= len(tokens):
                break
    if not chunks:
        raise ValueError("Không trích xuất được văn bản. PDF scan/ảnh cần OCR trước khi tải lên.")
    return chunks


def extract_pages(kind: str, data: bytes) -> list[dict]:
    if kind not in SUPPORTED_TYPES or len(data) > MAX_FILE_BYTES:
        raise ValueError("Dùng PDF có text, DOCX, PPTX, TXT hoặc Markdown, tối đa 20 MB.")
    if kind in ("txt", "md"):
        try:
            return [{"text": data.decode("utf-8-sig"), "page": None}]
        except UnicodeDecodeError:
            raise ValueError("Vui lòng lưu văn bản ở mã hóa UTF-8.") from None
    if kind == "pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise ValueError("PDF có mật khẩu. Hãy tải lên bản đã bỏ mật khẩu.")
        if len(reader.pages) > 100:
            raise ValueError("Tối đa 100 trang PDF; hãy chia nhỏ tài liệu.")
        return [
            {"text": page.extract_text() or "", "page": i + 1}
            for i, page in enumerate(reader.pages)
        ]
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if (
            len(archive.infolist()) > 3000
            or sum(item.file_size for item in archive.infolist()) > 40 * 1024 * 1024
        ):
            raise ValueError("Tệp Office vượt giới hạn kích thước giải nén.")
    if kind == "pptx":
        from pptx import Presentation

        presentation = Presentation(io.BytesIO(data))
        if len(presentation.slides) > 100:
            raise ValueError("Tối đa 100 slide; hãy chia nhỏ tài liệu.")

        def shape_text(shapes):
            for shape in shapes:
                if shape.has_text_frame:
                    yield shape.text_frame.text
                if shape.has_table:
                    for row in shape.table.rows:
                        yield " | ".join(cell.text for cell in row.cells)
                if hasattr(shape, "shapes"):
                    yield from shape_text(shape.shapes)

        return [
            {"text": "\n".join(shape_text(slide.shapes)), "page": i + 1}
            for i, slide in enumerate(presentation.slides)
        ]
    from docx import Document

    document = Document(io.BytesIO(data))
    # Preserve table content; many course documents keep definitions/examples in tables.
    text = "\n".join(
        [paragraph.text for paragraph in document.paragraphs]
        + [
            " | ".join(cell.text for cell in row.cells)
            for table in document.tables
            for row in table.rows
        ]
    )
    return [{"text": text, "page": None}]


async def extract_isolated(kind: str, data: bytes) -> list[dict]:
    """Parser isolation also works on Windows' Uvicorn reload SelectorEventLoop."""
    process = subprocess.Popen(
        [sys.executable, "-m", "app.extract_worker", kind],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )
    communication = asyncio.create_task(asyncio.to_thread(process.communicate, data, timeout=40))
    try:
        output, _ = await asyncio.shield(communication)
    except (subprocess.TimeoutExpired, asyncio.CancelledError) as exc:
        if process.poll() is None:
            process.kill()
        # The communicate thread owns the pipes until it has finished. Do not close them early.
        try:
            await asyncio.shield(communication)
        except subprocess.TimeoutExpired:
            await asyncio.to_thread(process.communicate)
        if isinstance(exc, subprocess.TimeoutExpired):
            raise TimeoutError("Document extraction timed out") from None
        raise
    finally:
        for stream in (process.stdin, process.stdout):
            if stream:
                stream.close()
    if process.returncode or len(output) > 2_000_000:
        raise HTTPException(422, "Không thể xử lý tài liệu này. Hãy kiểm tra hoặc chia nhỏ tệp.")
    result = json.loads(output)
    if isinstance(result, dict):
        raise HTTPException(422, result["error"])
    return result


def cosine(left: list[float], right: list[float]) -> float:
    if not left or len(left) != len(right):
        return 0
    denominator = math.sqrt(sum(x * x for x in left) * sum(x * x for x in right))
    return sum(a * b for a, b in zip(left, right, strict=True)) / denominator if denominator else 0
