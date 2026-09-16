#!/usr/bin/env bash
# Kiểm tra nhanh các luồng nghiệp vụ chính trên hạ tầng THẬT đang chạy.
#
#   bash scripts/smoke.sh
#
# Khác `npm test` (chạy thuần domain, không cần gì): file này gọi HTTP qua gateway đúng như frontend gọi, nên nó bắt được đúng
# loại lỗi mà unit test không thấy — validator MongoDB từ chối, SQLSTATE dịch sai, guard
# lắp thiếu, hoặc đơn giản là đang chạy nhầm bản build cũ.
#
# Cần: các service đang chạy (`npm run services start`), Kong ở :8000, và hai tài khoản
# test trên Keycloak. Xem note.md ở thư mục cha.
set -uo pipefail

KEYCLOAK=${KEYCLOAK_URL:-http://13.214.122.227:8080}
REALM=${KEYCLOAK_REALM:-codementor}
API=${API_BASE_URL:-http://localhost:8000/api/v1}
TEST_CLIENT=${KEYCLOAK_TEST_CLIENT:-codementor-test}
TEST_PASSWORD=${KEYCLOAK_TEST_PASSWORD:-Test1234!}

pass=0; fail=0

token() {
  curl -s -m 20 -X POST "$KEYCLOAK/realms/$REALM/protocol/openid-connect/token" \
    -d "client_id=$TEST_CLIENT" -d grant_type=password \
    -d "username=$1@test.local" -d "password=$TEST_PASSWORD" -d scope=openid |
    python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))'
}

# check "mô tả" "kỳ vọng" "thực tế"
check() {
  if [ "$2" = "$3" ]; then
    printf '  ✓ %s\n' "$1"; pass=$((pass + 1))
  else
    printf '  ✗ %s — chờ %s, nhận %s\n' "$1" "$2" "$3"; fail=$((fail + 1))
  fi
}

code() { curl -s -m 15 -o /dev/null -w '%{http_code}' "$@"; }
field() { python3 -c "import sys,json;print(json.load(sys.stdin)['data']$1)"; }

LECTURER=$(token lecturer1)
LEARNER=$(token learner1)
if [ -z "$LECTURER" ] || [ -z "$LEARNER" ]; then
  echo "Không lấy được token test từ $KEYCLOAK — bỏ qua." >&2
  exit 2
fi
AL=(-H "Authorization: Bearer $LECTURER"); AS=(-H "Authorization: Bearer $LEARNER")
J=(-H 'Content-Type: application/json')

echo "== sức khoẻ =="
for port in 3001 3002 3003 3004 3005 3006 3007 3008 3009; do
  check "health :$port" 200 "$(code "http://localhost:$port/api/v1/health")"
done
check "health qua gateway" 200 "$(code "$API/health")"

echo "== danh tính =="
check "GET /me" 200 "$(code "${AL[@]}" "$API/me")"
check "PATCH /me không tự nâng quyền được" 400 "$(code -X PATCH "${AL[@]}" "${J[@]}" -d '{"role":"admin"}' "$API/me")"
check "/me không token" 401 "$(code "$API/me")"

echo "== bài code =="
check "học viên không tạo được bài" 403 \
  "$(code -X POST "${AS[@]}" "${J[@]}" -d '{"title":"x","kind":"code","difficulty":"easy"}' "$API/exercises")"

EX=$(curl -s -X POST "${AL[@]}" "${J[@]}" \
  -d '{"title":"Smoke test bài code","kind":"code","difficulty":"easy"}' "$API/exercises")
EX_ID=$(echo "$EX" | field "['id']")
check "tạo bài ra draft" draft "$(echo "$EX" | field "['status']")"

check "gửi duyệt khi rỗng bị chặn" 422 "$(code -X POST "${AL[@]}" "$API/exercises/$EX_ID/submit")"

# Ghi thân bài: bắt được cả lỗi validator MongoDB lẫn undefined→null.
curl -s -o /dev/null -X PUT "${AL[@]}" "${J[@]}" -d '{
  "statement":"Đề bài smoke test.",
  "languages":[{"id":"python","label":"Python","monaco":"python","referenceSolution":"x"}],
  "testCases":[
    {"order":1,"input":"a","expected":"b","visibility":"public"},
    {"order":2,"input":"c","expected":"d","visibility":"hidden"},
    {"order":3,"input":"e","expected":"f","visibility":"hidden"}]}' \
  "$API/exercises/$EX_ID/content"
check "thân bài ghi được xuống MongoDB" 3 \
  "$(curl -s "${AL[@]}" "$API/exercises/$EX_ID" | field "['content']['testCases'].__len__()")"

check "gửi duyệt khi đủ" pending_review \
  "$(curl -s -X POST "${AL[@]}" "$API/exercises/$EX_ID/submit" | field "['status']")"
check "đang chờ duyệt thì khoá sửa" 422 \
  "$(code -X PATCH "${AL[@]}" "${J[@]}" -d '{"title":"sửa trộm"}' "$API/exercises/$EX_ID")"
check "hủy gửi duyệt về draft" draft \
  "$(curl -s -X POST "${AL[@]}" "$API/exercises/$EX_ID/withdraw" | field "['status']")"
check "đổi slug khi chưa công khai" smoke-test-bai-code-doi-slug \
  "$(curl -s -X PATCH "${AL[@]}" "${J[@]}" -d '{"slug":"smoke-test-bai-code-doi-slug"}' "$API/exercises/$EX_ID" | field "['slug']")"
check "slug sai định dạng bị chặn" 400 \
  "$(code -X PATCH "${AL[@]}" "${J[@]}" -d '{"slug":"-sai-"}' "$API/exercises/$EX_ID")"
check "người khác không sửa được" 403 \
  "$(code -X PATCH "${AS[@]}" "${J[@]}" -d '{"title":"cướp"}' "$API/exercises/$EX_ID")"
check "người lạ xem bài nháp ra 404 chứ không 403" 404 "$(code "${AS[@]}" "$API/exercises/$EX_ID")"
check "fork bài chưa công khai bị chặn" 403 "$(code -X POST "${AS[@]}" "$API/exercises/$EX_ID/fork")"
check "xoá bài nháp" 204 "$(code -X DELETE "${AL[@]}" "$API/exercises/$EX_ID")"

echo "== lộ trình =="
check "học viên không tạo được lộ trình" 403 \
  "$(code -X POST "${AS[@]}" "${J[@]}" -d '{"title":"x","field":"backend","level":"basic"}' "$API/roadmaps")"

RM=$(curl -s -X POST "${AL[@]}" "${J[@]}" \
  -d '{"title":"Smoke test lộ trình","field":"backend","level":"basic"}' "$API/roadmaps")
RM_ID=$(echo "$RM" | field "['id']")
check "tạo lộ trình ra draft" draft "$(echo "$RM" | field "['status']")"
check "ảnh bìa javascript: bị chặn" 400 \
  "$(code -X PATCH "${AL[@]}" "${J[@]}" -d '{"coverImageUrl":"javascript:alert(1)"}' "$API/roadmaps/$RM_ID")"
check "gửi duyệt khi chưa đủ khóa học" 422 "$(code -X POST "${AL[@]}" "$API/roadmaps/$RM_ID/submit")"
check "cùng một khóa học hai lần bị chặn" 409 \
  "$(code -X PUT "${AL[@]}" "${J[@]}" -d '{"courses":[{"courseId":"00000000-0000-4000-8000-000000000009"},{"courseId":"00000000-0000-4000-8000-000000000009"}]}' "$API/roadmaps/$RM_ID/courses")"
check "người lạ xem lộ trình nháp ra 404" 404 "$(code "${AS[@]}" "$API/roadmaps/$RM_ID")"
check "xoá lộ trình nháp" 204 "$(code -X DELETE "${AL[@]}" "$API/roadmaps/$RM_ID")"

echo "== kiểm duyệt =="
ADMIN=$(token admin1)
if [ -z "$ADMIN" ]; then
  echo "  (bỏ qua: chưa có tài khoản admin1 trên realm)"
else
  AA=(-H "Authorization: Bearer $ADMIN")
  check "giảng viên không xem được hàng chờ" 403 "$(code "${AL[@]}" "$API/exercises/moderation")"
  check "admin xem được hàng chờ bài code" 200 "$(code "${AA[@]}" "$API/exercises/moderation")"
  check "admin xem được hàng chờ khóa học" 200 "$(code "${AA[@]}" "$API/courses/moderation")"
  check "admin xem được hàng chờ lộ trình" 200 "$(code "${AA[@]}" "$API/roadmaps/moderation")"

  MOD=$(curl -s -X POST "${AL[@]}" "${J[@]}" \
    -d '{"title":"Smoke test kiểm duyệt","kind":"code","difficulty":"easy"}' "$API/exercises")
  MOD_ID=$(echo "$MOD" | field "['id']")
  curl -s -o /dev/null -X PUT "${AL[@]}" "${J[@]}" -d '{
    "statement":"đề",
    "languages":[{"id":"python","label":"Python","referenceSolution":"x"}],
    "testCases":[
      {"order":1,"input":"a","expected":"b","visibility":"public"},
      {"order":2,"input":"c","expected":"d","visibility":"hidden"},
      {"order":3,"input":"e","expected":"f","visibility":"hidden"}]}' \
    "$API/exercises/$MOD_ID/content"
  curl -s -o /dev/null -X POST "${AL[@]}" "$API/exercises/$MOD_ID/submit"

  check "giảng viên không tự duyệt được" 403 \
    "$(code -X POST "${AL[@]}" "${J[@]}" -d '{"decision":"approve"}' "$API/exercises/$MOD_ID/moderate")"
  check "từ chối mà không nêu lý do bị chặn" 400 \
    "$(code -X POST "${AA[@]}" "${J[@]}" -d '{"decision":"reject"}' "$API/exercises/$MOD_ID/moderate")"
  check "yêu cầu sửa ghi lại lý do" changes_requested \
    "$(curl -s -X POST "${AA[@]}" "${J[@]}" -d '{"decision":"request_changes","reason":"Thiếu ví dụ"}' "$API/exercises/$MOD_ID/moderate" | field "['status']")"
  check "quyết định lại khi không còn chờ duyệt bị chặn" 422 \
    "$(code -X POST "${AA[@]}" "${J[@]}" -d '{"decision":"approve"}' "$API/exercises/$MOD_ID/moderate")"
  check "gửi lại thì lý do cũ bị xoá" None \
    "$(curl -s -X POST "${AL[@]}" "$API/exercises/$MOD_ID/submit" | field "['rejectionReason']")"
  check "admin duyệt" published \
    "$(curl -s -X POST "${AA[@]}" "${J[@]}" -d '{"decision":"approve"}' "$API/exercises/$MOD_ID/moderate" | field "['status']")"
  check "admin gỡ" archived \
    "$(curl -s -X POST "${AA[@]}" "${J[@]}" -d '{"decision":"archive"}' "$API/exercises/$MOD_ID/moderate" | field "['status']")"
  check "gỡ thứ không còn công khai bị chặn" 422 \
    "$(code -X POST "${AA[@]}" "${J[@]}" -d '{"decision":"archive"}' "$API/exercises/$MOD_ID/moderate")"

  curl -s -o /dev/null -X DELETE "${AL[@]}" "$API/exercises/$MOD_ID"
fi

echo
printf 'đạt %d, hỏng %d\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
