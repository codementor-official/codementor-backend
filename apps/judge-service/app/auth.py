"""Xác thực JWT của Keycloak.

Kong ở dự án này KHÔNG có plugin JWT — mỗi service tự kiểm token (xem
`libs/platform/src/auth/keycloak.strategy.ts`, dùng jwks-rsa với
`${KEYCLOAK_ISSUER}/protocol/openid-connect/certs`). Judge làm y hệt bằng PyJWT.

Đây không phải chi tiết tuỳ chọn: `POST /run` chạy mã tuỳ ý, và tiến trình này giữ socket
Docker của host. Một endpoint không kiểm token ở đây nghĩa là bất kỳ ai gọi được cổng
gateway đều chạy được lệnh trên máy chủ.
"""

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from app.config import settings

_bearer = HTTPBearer(auto_error=True)

# Tải khoá công khai một lần rồi cache; PyJWKClient tự lấy lại khi gặp `kid` lạ (Keycloak
# xoay khoá). Dựng lười vì lúc import chưa chắc đã có mạng tới Keycloak.
_jwks_client: PyJWKClient | None = None


def _jwks() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        if not settings.keycloak_issuer:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="KEYCLOAK_ISSUER chưa được cấu hình — không thể xác thực token",
            )
        _jwks_client = PyJWKClient(
            f"{settings.keycloak_issuer}/protocol/openid-connect/certs",
            cache_keys=True,
        )
    return _jwks_client


def require_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    """Trả về claim của token, hoặc 401. Không có đường tắt bỏ qua."""
    try:
        signing_key = _jwks().get_signing_key_from_jwt(credentials.credentials)
        claims = jwt.decode(
            credentials.credentials,
            signing_key.key,
            algorithms=["RS256"],
            issuer=settings.keycloak_issuer,
            # Keycloak chỉ đặt `aud` khi client được cấu hình audience mapper; bỏ kiểm khi
            # không khai báo, thay vì từ chối mọi token.
            audience=settings.keycloak_audience or None,
            options={"verify_aud": bool(settings.keycloak_audience)},
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token không hợp lệ",
        ) from exc

    request.state.user_id = claims.get("sub")
    return claims
