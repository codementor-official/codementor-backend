"""Xác thực JWT của Keycloak.

Copy có chủ đích từ `apps/judge-service/app/auth.py`. Kong ở dự án này KHÔNG có plugin JWT —
mỗi service tự kiểm token (xem `libs/platform/src/auth/keycloak.strategy.ts`, dùng jwks-rsa với
`${KEYCLOAK_ISSUER}/protocol/openid-connect/certs`). ai-service làm y hệt bằng PyJWT.

Chỉ áp cho `/api/v1/ai/*` — đường công khai. `/api/v1/internal/*` vẫn dùng shared secret ở
middleware của `main.py`; hai đường, hai cơ chế, không trộn.
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
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "KEYCLOAK_ISSUER chưa được cấu hình — không thể xác thực token.",
            )
        _jwks_client = PyJWKClient(
            f"{settings.keycloak_issuer}/protocol/openid-connect/certs", cache_keys=True
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
    except jwt.PyJWTError:
        # Không log chi tiết: thông điệp của PyJWT có thể kèm payload token.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token không hợp lệ.") from None

    subject = claims.get("sub")
    if not subject:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token không có chủ thể.")
    request.state.user_id = subject
    # Lecter forward chính token này khi đọc exercise-service / judge-service, để Nest áp
    # đúng guard @Roles của nó thay vì ai-service viết lại phân quyền bằng Python. Chỉ sống
    # trong tiến trình, không log, không đưa vào state của graph (state bị phát ngược về
    # trình duyệt bằng STATE_SNAPSHOT).
    request.state.access_token = credentials.credentials
    return claims
