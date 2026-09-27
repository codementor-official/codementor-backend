import pytest
from fastapi import HTTPException

from app.auth import require_admin


@pytest.mark.parametrize("role", ["ADMIN", "admin"])
def test_admin_role_passes_in_any_case(role):
    claims = {"sub": "u1", "realm_access": {"roles": ["LECTURER", role]}}
    assert require_admin(claims) is claims


@pytest.mark.parametrize(
    "claims",
    [
        {"sub": "u1"},
        {"sub": "u1", "realm_access": None},
        {"sub": "u1", "realm_access": {"roles": ["LECTURER", "STUDENT"]}},
    ],
)
def test_without_admin_role_is_forbidden(claims):
    with pytest.raises(HTTPException) as error:
        require_admin(claims)
    assert error.value.status_code == 403
