"""Luật thiết kế chứng chỉ phải khớp backend `certificate-design.ts` (ADR 0005)."""

from app.lecter.certificate import check_design, unknown_placeholders

VALID = {
    "version": 1,
    "layout": "classic",
    "accent": "orange",
    "heading": "Chứng nhận hoàn thành",
    "body": "Đã hoàn thành {{subjectKind}} “{{subjectTitle}}”.",
    "signerName": "{{instructorName}}",
    "fields": [{"label": "Mã", "value": "{{certificateCode}}"}],
}


def test_valid_design_passes():
    assert check_design(VALID) == []


def test_rejects_unknown_and_unclosed_placeholders():
    errors = " ".join(check_design({**VALID, "body": "Học {{courseName}} xong {{oops"}))
    assert "courseName" in errors
    assert "không đóng" in errors


def test_rejects_bad_enums_too_many_fields_and_images():
    errors = check_design(
        {
            **VALID,
            "layout": "fancy",
            "accent": "pink",
            "fields": [{"label": "a", "value": "b"}] * 7,
            "logoUrl": "https://x/logo.png",
        }
    )
    assert len(errors) >= 4


def test_placeholder_spacing_is_tolerated():
    assert unknown_placeholders("{{ learnerName }} {{foo}}") == ["foo"]


def test_non_object_design():
    assert check_design("x") == ["Thiết kế phải là một object"]
