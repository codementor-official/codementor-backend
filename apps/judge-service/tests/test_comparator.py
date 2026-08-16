"""So sánh kết quả ở chế độ chữ ký hàm.

Đây là chỗ quyết định "đạt hay không đạt" của mọi bài function mode, và nó chạy được không
cần Docker. Mỗi test dưới đây là một dòng trong checklist của `codementor-judge-model.md` §9.
"""

from app.services.comparator import compare
from app.services.judgement import (
    ACCEPTED,
    RUNTIME_ERROR,
    SKIPPED,
    TIMEOUT,
    WRONG_ANSWER,
    verdict_for_function_case,
)


def test_int_and_float_same_value_are_equal():
    # Học viên Python trả [2, 1] cho bài khai kiểu list<float> — thuật toán đúng, đừng đánh sai.
    assert compare([2, 1], [2.0, 1.0])
    assert compare(2, 2.0)


def test_float_tolerance_accepts_small_drift():
    assert compare(2.0000001, 2.0, "float")
    assert not compare(2.001, 2.0, "float")


def test_float_tolerance_is_relative_for_large_numbers():
    assert compare(1_000_000.0000005, 1_000_000.0, "float")


def test_exact_mode_rejects_drift_that_float_mode_accepts():
    assert not compare(2.0000001, 2.0)


def test_float_tolerance_recurses_into_containers():
    assert compare([[1.0000001]], [[1.0]], "float")
    assert compare({"x": 1.0000001}, {"x": 1.0}, "float")


def test_empty_list_is_not_null():
    # Bài "vô nghiệm" trả [] còn bài lỗi trả null — lẫn hai cái là lỗi kinh điển.
    assert not compare([], None)
    assert not compare(None, [])
    assert compare([], [])
    assert compare(None, None)


def test_bool_is_not_a_number():
    # Python coi True == 1. Trả True cho bài cần 1 là sai kiểu, không phải đúng.
    assert not compare(True, 1)
    assert not compare(1, True)
    assert compare(True, True)


def test_wrong_return_type_is_just_unequal():
    # Trả chuỗi khi bài cần danh sách → sai kết quả, không phải lỗi hạ tầng.
    assert not compare("[2.0, 1.0]", [2.0, 1.0])


def test_lists_of_different_length_differ():
    assert not compare([1, 2], [1, 2, 3])


def test_dict_compares_by_key():
    assert compare({"a": 1, "b": 2}, {"b": 2, "a": 1})
    assert not compare({"a": 1}, {"a": 1, "b": 2})


def test_unordered_ignores_position():
    assert compare([3, 1, 2], [1, 2, 3], "unordered")
    assert not compare([1, 1, 2], [1, 2, 2], "unordered")


def test_unordered_still_counts_duplicates():
    assert not compare([1, 1], [1])


def test_unordered_normalises_int_and_float():
    assert compare([2, 1], [1.0, 2.0], "unordered")


def test_unknown_checker_falls_back_to_exact():
    # `trimmed`/`custom` là di sản của chế độ stdin. Ở đây chúng vô nghĩa, nhưng ném lỗi hạ
    # tầng vào mặt học viên còn tệ hơn là chấm chặt.
    assert compare([1], [1], "trimmed")
    assert not compare([1], [2], "custom")


def test_verdict_maps_driver_status():
    assert verdict_for_function_case({"status": "ok", "actual": 5}, 5) == ACCEPTED
    assert verdict_for_function_case({"status": "ok", "actual": 4}, 5) == WRONG_ANSWER
    assert verdict_for_function_case({"status": "timeout"}, 5) == TIMEOUT
    assert verdict_for_function_case({"status": "runtime_error"}, 5) == RUNTIME_ERROR


def test_verdict_without_record_is_skipped():
    # Driver flush sau mỗi case; thiếu bản ghi nghĩa là container chết trước khi case này xong.
    assert verdict_for_function_case(None, 5) == SKIPPED


def test_verdict_honours_checker_mode():
    record = {"status": "ok", "actual": 2.0000001}
    assert verdict_for_function_case(record, 2.0) == WRONG_ANSWER
    assert verdict_for_function_case(record, 2.0, "float") == ACCEPTED
