"""Kiểm bản sao luật khóa học ở `validate.py`.

Ca quan trọng nhất là `test_missing_id_blocks`: `PUT /courses/:id/curriculum` thay TOÀN BỘ cây, nên
một payload quên echo id sẽ xóa chương/bài đó cùng tiến độ của mọi học viên đang học. Nó phải là
lỗi CHẶN, không phải cảnh báo.
"""

from app.lecter import validate

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
