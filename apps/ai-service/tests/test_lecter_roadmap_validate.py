"""Kiểm bản sao luật lộ trình ở `validate.py`.

Ca quan trọng nhất là `test_missing_course_id_blocks`: `PUT /roadmaps/:id/courses` thay TOÀN BỘ
danh sách, nên một payload quên echo id sẽ gỡ khóa đó khỏi lộ trình cùng mọi cạnh điều kiện mở khóa
trỏ vào nó. Nó phải là lỗi CHẶN, không phải cảnh báo.
"""

from app.lecter import validate

C1 = "44444444-4444-4444-8444-111111111111"
C2 = "44444444-4444-4444-8444-222222222222"
C3 = "44444444-4444-4444-8444-333333333333"

VALID = [
    {"courseId": C1, "isOptional": False},
    {"courseId": C2, "isOptional": True},
]

CURRENT = {
    "description": "Lộ trình backend cho người mới",
    "courses": [
        {"courseId": C1, "position": 1, "isOptional": False, "title": "Java cơ bản",
         "slug": "java-co-ban", "status": "published", "durationHours": 20},
        {"courseId": C2, "position": 2, "isOptional": True, "title": "Spring Boot",
         "slug": "spring-boot", "status": "published", "durationHours": 30},
    ],
}


# --- hình dạng --------------------------------------------------------------

def test_valid_shape_passes():
    assert validate.check_roadmap_courses_shape(VALID) == []


def test_not_a_list_blocks():
    errors = validate.check_roadmap_courses_shape({"courseId": C1})
    assert len(errors) == 1 and "MẢNG" in errors[0]


def test_missing_course_id_blocks_shape():
    errors = validate.check_roadmap_courses_shape([{"isOptional": True}])
    assert any("thiếu 'courseId'" in line for line in errors)


def test_fake_uuid_blocks():
    errors = validate.check_roadmap_courses_shape([{"courseId": "course-1"}])
    assert any("không phải id khóa học hợp lệ" in line for line in errors)
    # Câu lỗi phải chỉ đúng đường ra: ở lộ trình KHÔNG có "mục mới id null".
    assert all("id: null" not in line for line in errors)


def test_null_course_id_blocks():
    errors = validate.check_roadmap_courses_shape([{"courseId": None}])
    assert any("không phải id khóa học hợp lệ" in line for line in errors)


def test_extra_field_blocks():
    # `position` là trường model hay gửi thừa nhất — DTO không khai nó, Nest trả 400.
    errors = validate.check_roadmap_courses_shape([{"courseId": C1, "position": 1}])
    assert any("'position'" in line for line in errors)


def test_non_bool_is_optional_blocks():
    errors = validate.check_roadmap_courses_shape([{"courseId": C1, "isOptional": "false"}])
    assert any("isOptional" in line for line in errors)


def test_duplicate_course_blocks():
    errors = validate.check_roadmap_courses_shape([{"courseId": C1}, {"courseId": C1}])
    assert any("hai lần" in line for line in errors)


def test_too_many_courses_blocks():
    errors = validate.check_roadmap_courses_shape([{"courseId": C1}] * 201)
    assert len(errors) == 1 and "tối đa 200" in errors[0]


# --- gỡ khóa ----------------------------------------------------------------

def test_missing_course_id_blocks():
    """Quên echo lại một khóa = gỡ nó khỏi lộ trình. Phải chặn."""
    errors = validate.check_course_removals(CURRENT, [{"courseId": C1}])
    assert len(errors) == 1
    assert "SẼ GỠ MẤT KHÓA HỌC" in errors[0]
    assert "Spring Boot" in errors[0]


def test_declared_removal_passes():
    assert validate.check_course_removals(CURRENT, [{"courseId": C1}], [C2]) == []


def test_adding_course_is_not_a_removal():
    payload = [*VALID, {"courseId": C3}]
    assert validate.check_course_removals(CURRENT, payload) == []


def test_find_removals_marks_declared():
    found = validate.find_course_removals(CURRENT, [{"courseId": C1}], [C2])
    assert found == [
        {"kind": "course", "id": C2, "title": "Spring Boot", "declared": True}
    ]


# --- gửi duyệt --------------------------------------------------------------

def test_full_roadmap_has_no_warnings():
    assert validate.check_roadmap_submission(CURRENT, VALID) == []


def test_missing_description_warns():
    warnings = validate.check_roadmap_submission({**CURRENT, "description": "  "}, VALID)
    assert any("mô tả" in line for line in warnings)


def test_single_course_warns():
    warnings = validate.check_roadmap_submission(CURRENT, [{"courseId": C1}])
    assert any("tối thiểu 2 khóa học" in line for line in warnings)


def test_unpublished_course_warns():
    current = {
        **CURRENT,
        "courses": [
            CURRENT["courses"][0],
            {**CURRENT["courses"][1], "status": "draft"},
        ],
    }
    warnings = validate.check_roadmap_submission(current, VALID)
    assert any("chưa công khai" in line and "Spring Boot" in line for line in warnings)


def test_unknown_course_status_is_silent():
    """Khóa vừa thêm chưa có trong danh sách lưu — im lặng chứ không cảnh báo bừa."""
    warnings = validate.check_roadmap_submission(CURRENT, [*VALID, {"courseId": C3}])
    assert all("chưa công khai" not in line for line in warnings)


# --- không đổi gì -----------------------------------------------------------

def test_unchanged_detected():
    assert validate.roadmap_is_unchanged(CURRENT, VALID) is True


def test_reorder_is_a_change():
    assert validate.roadmap_is_unchanged(CURRENT, list(reversed(VALID))) is False


def test_is_optional_flip_is_a_change():
    flipped = [{"courseId": C1, "isOptional": True}, {"courseId": C2, "isOptional": True}]
    assert validate.roadmap_is_unchanged(CURRENT, flipped) is False


def test_missing_is_optional_means_false():
    assert validate.roadmap_is_unchanged(CURRENT, [{"courseId": C1}, VALID[1]]) is True
