import json
import sys

from app.rag.documents import MAX_FILE_BYTES, chunk_pages, extract_pages


def main():
    if sys.platform != "win32":
        import resource

        resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))
    try:
        pages = extract_pages(sys.argv[1], sys.stdin.buffer.read(MAX_FILE_BYTES + 1))
        if sum(len(page["text"]) for page in pages) > 1_000_000:
            raise ValueError("Văn bản trích xuất quá lớn; hãy chia nhỏ tài liệu.")
        result = chunk_pages(pages)
    except ValueError as exc:
        result = {"error": str(exc)[:300]}
    except Exception:
        result = {"error": "Không đọc được tài liệu. Kiểm tra định dạng hoặc mật khẩu."}
    sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))


if __name__ == "__main__":
    main()
