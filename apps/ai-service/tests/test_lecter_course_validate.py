"""Kiểm bản sao luật khóa học ở `validate.py`.

Ca quan trọng nhất là `test_missing_id_blocks`: `PUT /courses/:id/curriculum` thay TOÀN BỘ cây, nên
một payload quên echo id sẽ xóa chương/bài đó cùng tiến độ của mọi học viên đang học. Nó phải là
lỗi CHẶN, không phải cảnh báo.
"""

from app.lecter import tools, validate

CH1 = "11111111-1111-4111-8111-111111111111"
CH2 = "11111111-1111-4111-8111-222222222222"
L1 = "22222222-2222-4222-8222-111111111111"
L2 = "22222222-2222-4222-8222-222222222222"
EX1 = "33333333-3333-4333-8333-111111111111"
EX2 = "33333333-3333-4333-8333-222222222222"

VALID = [
    {
        "id": CH1,
        "title": "Nhập môn",
        "description": "Chương mở đầu",
        "isOptional": False,
        "lessons": [
            {"id": L1, "title": "Biến và kiểu", "type": "article", "durationMinutes": 15,
             "isPreview": True, "isOptional": False, "exerciseId": None},
            {"id": L2, "title": "Luyện tập", "type": "exercise", "durationMinutes": 30,
             "isPreview": False, "isOptional": False, "exerciseId": EX1},
        ],
    },
]

# Cây đang lưu, dạng `GET /courses/:id` trả về.
CURRENT = {
    "description": "Khóa học Python cơ bản",
    "chapters": [
        {
            "id": CH1,
            "title": "Nhập môn",
            "lessons": [
                {"id": L1, "title": "Biến và kiểu", "type": "article", "contentRef": "abc"},
                {"id": L2, "title": "Luyện tập", "type": "exercise", "exerciseId": EX1,
                 "exerciseStatus": "published"},
            ],
        },
    ],
}


def test_valid_shape_passes():
    assert validate.check_curriculum_shape(VALID) == []
    assert validate.check_removals(CURRENT, VALID) == []
    assert validate.check_course_submission(CURRENT, VALID) == []


def test_missing_id_blocks():
    """Model chỉ gửi chương mới, quên chương cũ — phải chặn, và câu lỗi phải chỉ đúng việc."""
    only_new = [{"title": "Chương mới", "lessons": []}]
    errors = validate.check_removals(CURRENT, only_new)
    assert len(errors) == 1
    assert "SẼ XÓA MẤT DỮ LIỆU" in errors[0]
    assert CH1 in errors[0] and L1 in errors[0] and L2 in errors[0]
    assert "read_course" in errors[0]


def test_declared_removal_passes():
    """Xóa vẫn làm được, nhưng phải cố ý: liệt kê đúng id vào `remove_ids`."""
    without_lesson = [{**VALID[0], "lessons": VALID[0]["lessons"][:1]}]
    assert validate.check_removals(CURRENT, without_lesson) != []
    assert validate.check_removals(CURRENT, without_lesson, [L2]) == []


def test_exercise_on_article_blocks():
    bad = [{**VALID[0], "lessons": [{**VALID[0]["lessons"][0], "exerciseId": EX1}]}]
    errors = validate.check_curriculum_shape(bad)
    assert any("exerciseId" in e and "article" in e for e in errors)


def test_extra_field_blocks():
    """`SaveCurriculumDto` là whitelist; thừa một trường là 400 lúc PUT."""
    bad = [{**VALID[0], "position": 1}]
    assert any("position" in e for e in validate.check_curriculum_shape(bad))


def test_same_exercise_twice_in_chapter_blocks():
    """Unique index `lessons_exercise_unique_per_chapter` — 422, không phải cảnh báo."""
    lessons = VALID[0]["lessons"] + [
        {"title": "Luyện tập lại", "type": "exercise", "exerciseId": EX1},
    ]
    errors = validate.check_curriculum_shape([{**VALID[0], "lessons": lessons}])
    assert any(EX1 in e and "hai bài học" in e for e in errors)


def test_bad_type_and_fake_id_block():
    bad = [{"id": "chapter-1", "title": "X", "lessons": [{"title": "Y", "type": "theory"}]}]
    errors = validate.check_curriculum_shape(bad)
    assert any("không phải id hợp lệ" in e for e in errors)
    # `article` mới là bài lý thuyết; "theory" là tên trường bên ExerciseContent, không phải type.
    assert any("article" in e for e in errors)


def test_submission_warnings():
    """Bài mới chưa có nội dung, chương rỗng, thiếu mô tả — cảnh báo chứ không chặn lưu."""
    chapters = [
        {"id": CH1, "title": "Nhập môn", "lessons": [
            {"title": "Bài mới toanh", "type": "article"},
            {"title": "Bài code chưa gắn", "type": "exercise"},
        ]},
        {"id": CH2, "title": "Chương rỗng", "lessons": []},
    ]
    warnings = validate.check_course_submission({"chapters": CURRENT["chapters"]}, chapters)
    assert any("mô tả khóa học" in w for w in warnings)
    assert any("Chương rỗng" in w for w in warnings)
    assert any("Bài mới toanh" in w for w in warnings)
    assert any("bài code cho bài" in w.lower() for w in warnings)


def test_unpublished_exercise_warns():
    current = {
        "description": "có mô tả",
        "chapters": [{"id": CH1, "title": "C", "lessons": [
            {"id": L2, "title": "Luyện tập", "type": "exercise", "exerciseStatus": "draft"},
        ]}],
    }
    chapters = [{"id": CH1, "title": "C", "lessons": [
        {"id": L2, "title": "Luyện tập", "type": "exercise", "exerciseId": EX1},
    ]}]
    assert any("chưa công khai" in w for w in validate.check_course_submission(current, chapters))


# --- Chuỗi rỗng nghĩa là "mục mới" ----------------------------------------
# Bốn ca dưới dựng lại đúng payload đã bị chặn oan trong hội thoại thật
# `lecter:b0c50097-…`: model echo đủ mọi id cũ, gắn đúng `exerciseId`, và chỉ dùng "" cho mục mới.


def test_empty_id_means_new_item():
    """Payload y hệt message [41] của hội thoại thật: thêm một bài `exercise` vào chương đã có."""
    chapters = [
        {
            **VALID[0],
            "lessons": [
                *VALID[0]["lessons"],
                {"id": "", "title": "Duyệt và đếm", "type": "exercise", "exerciseId": EX2},
            ],
        },
    ]
    # Chương/bài mới không có id nên không đụng tới `check_removals`.
    assert validate.check_curriculum_shape(chapters) == []


def test_two_new_chapters_are_not_duplicate_ids():
    """Message [18]: hai chương mới cùng `id: ""` từng bị báo "id chương  xuất hiện nhiều lần"."""
    chapters = [
        VALID[0],
        {"title": "Vòng lặp nâng cao", "id": "", "lessons": [{"id": "", "title": "A", "type": "article"}]},
        {"title": "Hàm", "id": "", "lessons": [{"id": "", "title": "B", "type": "article"}]},
    ]
    errors = validate.check_curriculum_shape(chapters)
    assert errors == [], errors


def test_bad_id_error_names_the_way_out():
    """Câu lỗi phải nêu HÀNH ĐỘNG. Bản cũ chỉ nói "phải là UUID có thật lấy từ read_course" —
    lời khuyên bất khả thi với một mục chưa tồn tại, và model kẹt luôn ở đó."""
    errors = validate.check_curriculum_shape(
        [{"id": "chapter-1", "title": "X", "lessons": []}]
    )
    assert any("BỎ HẲN trường `id`" in e for e in errors)


def test_empty_exercise_id_is_not_an_attachment():
    chapters = [
        {"title": "C", "lessons": [{"title": "Lý thuyết", "type": "article", "exerciseId": ""}]},
    ]
    assert validate.check_curriculum_shape(chapters) == []


# --- Lưu một cây không đổi -------------------------------------------------


def test_unchanged_tree_is_detected():
    """Message [3]→[5]: model đọc cây rồi lưu lại y nguyên, tiêu một hộp xác nhận cho việc rỗng."""
    same = [
        {
            "id": CH1,
            "title": "Nhập môn",
            "lessons": [
                {"id": L1, "title": "Biến và kiểu", "type": "article"},
                {"id": L2, "title": "Luyện tập", "type": "exercise", "exerciseId": EX1},
            ],
        },
    ]
    current = {
        "chapters": [
            {
                "id": CH1,
                "title": "Nhập môn",
                "description": None,
                "isOptional": False,
                "lessons": [
                    {"id": L1, "title": "Biến và kiểu", "type": "article", "durationMinutes": None,
                     "isPreview": False, "isOptional": False, "exerciseId": None,
                     "contentRef": "abc", "position": 1},
                    {"id": L2, "title": "Luyện tập", "type": "exercise", "durationMinutes": None,
                     "isPreview": False, "isOptional": False, "exerciseId": EX1,
                     "exerciseStatus": "published", "position": 2},
                ],
            },
        ],
    }
    # Trường chỉ-đọc (`contentRef`, `position`, `exerciseStatus`) không được làm lệch phép so.
    assert validate.is_unchanged(current, same)

    changed = [{**same[0], "lessons": [*same[0]["lessons"], {"title": "Bài mới", "type": "article"}]}]
    assert not validate.is_unchanged(current, changed)


# --- Chế độ stdin: `expected` chưa biết ------------------------------------


def test_none_expected_is_not_a_type_error():
    """F2. `run_solution` dạy "chưa biết `expected` thì cứ để null", rồi chính hàng rào của mình
    chặn lại vì `case.get("expected", "")` trả `None` khi khoá có mặt với giá trị null."""
    cases = [{"order": 1, "input": "3", "expected": None}]
    assert tools._check_run_mode(cases, None) is None


def test_zero_expected_is_still_a_type_error():
    """Không được sửa bằng `or ""`: `0` cũng falsy, mà `0` chính là thứ làm bộ chấm ném
    AttributeError lúc gọi `.strip()`."""
    cases = [{"order": 1, "input": "3", "expected": 0}]
    assert "SAI KIỂU" in (tools._check_run_mode(cases, None) or "")


def test_null_expected_never_reaches_the_judge():
    """`JudgeCase.expected` mặc định `""` khi VẮNG MẶT, nhưng giữ nguyên `None` khi gửi null —
    rồi `expected_output.strip()` nổ. Bỏ hẳn khoá là cách duy nhất bộ chấm hiểu."""
    sent = tools._drop_empty_expected([
        {"order": 1, "input": "3", "expected": None},
        {"order": 2, "input": "4", "expected": "7"},
    ])
    assert "expected" not in sent[0]
    assert sent[1]["expected"] == "7"


def test_payload_tree_coerces_lesson_booleans():
    """F9. Chương đã ép `bool()`, bài thì không — mà zod phía trình duyệt khai
    `z.boolean().optional()`, không nhận null, và khối này là thứ model copy nguyên."""
    tree = tools._payload_tree([
        {"id": CH1, "title": "C", "lessons": [{"id": L1, "title": "B", "type": "article"}]},
    ])
    lesson = tree[0]["lessons"][0]
    assert lesson["isPreview"] is False and lesson["isOptional"] is False


# --- Kiểm nằm trên đường ghi ----------------------------------------------


def test_find_removals_reports_declared_and_undeclared():
    """Một nguồn sự thật cho hai người đọc: câu lỗi gửi model, và banner đỏ trên hộp xác nhận.
    Hộp xác nhận trước đây tra tên từ `removeIds` do MODEL khai, nên một lượt quên echo id thì
    nó không hiện gì — người có thẩm quyền duyệt lại là người không có thông tin."""
    only_first_lesson = [{**VALID[0], "lessons": VALID[0]["lessons"][:1]}]

    gone = validate.find_removals(CURRENT, only_first_lesson)
    assert gone == [{"kind": "lesson", "id": L2, "title": "Luyện tập", "declared": False}]

    # Khai rồi thì vẫn phải hiện lên thẻ — chỉ khác ở chỗ không còn là lỗi chặn.
    declared = validate.find_removals(CURRENT, only_first_lesson, [L2])
    assert declared[0]["declared"] is True
    assert validate.check_removals(CURRENT, only_first_lesson, [L2]) == []
