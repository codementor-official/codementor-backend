import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app import auth


def test_small_clock_skew_allowed_but_expired_token_rejected(monkeypatch):
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    monkeypatch.setattr(
        auth,
        "_jwks",
        lambda: SimpleNamespace(
            get_signing_key_from_jwt=lambda _: SimpleNamespace(key=private.public_key())
        ),
    )
    monkeypatch.setattr(
        auth,
        "settings",
        SimpleNamespace(keycloak_issuer="test-issuer", keycloak_audience="test-client"),
    )
    now = int(time.time())
    claims = {
        "sub": "test-user",
        "iss": "test-issuer",
        "aud": "test-client",
        "iat": now + 2,
        "exp": now + 60,
    }
    request = SimpleNamespace(state=SimpleNamespace())

    def credentials(payload):
        return HTTPAuthorizationCredentials(
            scheme="Bearer", credentials=jwt.encode(payload, private, algorithm="RS256")
        )

    assert auth.require_user(request, credentials(claims))["sub"] == "test-user"
    with pytest.raises(HTTPException) as exc:
        auth.require_user(request, credentials({**claims, "exp": now - 30}))
    assert exc.value.status_code == 401
