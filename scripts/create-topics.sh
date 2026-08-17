#!/usr/bin/env bash
# Tạo mọi topic khai báo trong libs/contracts/src/events/topics.ts.
#
# Kafka tự tạo topic khi có producer ghi vào, nhưng đó không cứu được consumer: service nào
# khởi động và `subscribe` một topic chưa tồn tại sẽ nhận
# `This server does not host this topic-partition` rồi bỏ luôn việc đăng ký, và nó chỉ nghe
# lại sau khi restart. Với learning-service và realtime-service — cả hai chỉ nghe, không phát
# — đó là "chạy nhưng im lặng không làm gì", loại hỏng khó thấy nhất.
#
# Danh sách đọc từ chính registry để không bao giờ lệch: thêm topic vào topics.ts là script
# này biết, không phải nhớ sửa hai chỗ.
set -uo pipefail

cd "$(dirname "$0")/.."

CONTAINER="${KAFKA_CONTAINER:-codementor-kafka}"
BOOTSTRAP="${KAFKA_BOOTSTRAP:-localhost:9092}"
PARTITIONS="${KAFKA_PARTITIONS:-3}"
REPLICATION="${KAFKA_REPLICATION:-1}"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Không thấy container Kafka '$CONTAINER'. Đặt KAFKA_CONTAINER nếu tên khác." >&2
  exit 1
fi

mapfile -t TOPICS < <(
  grep -oE "'(evt|cmd)\.[a-z.]+v[0-9]+'" libs/contracts/src/events/topics.ts |
    tr -d "'" | sort -u
)

if [ "${#TOPICS[@]}" -eq 0 ]; then
  echo "Không đọc được topic nào từ libs/contracts/src/events/topics.ts" >&2
  exit 1
fi

created=0
existed=0
for topic in "${TOPICS[@]}"; do
  # `--if-not-exists` để chạy lại được nhiều lần: đây là script provisioning, không phải
  # migration một chiều.
  output=$(docker exec "$CONTAINER" kafka-topics \
    --bootstrap-server "$BOOTSTRAP" \
    --create --if-not-exists \
    --topic "$topic" \
    --partitions "$PARTITIONS" \
    --replication-factor "$REPLICATION" 2>&1)

  # Kafka in một WARNING về dấu chấm trong tên topic cho MỌI topic đã tồn tại. Nó vô hại và
  # tên topic là do registry quy định, nên lọc bỏ trước khi phân loại — nếu không thì mọi
  # lần chạy lại đều báo lỗi giả.
  noise=$(echo "$output" | grep -v "^WARNING: Due to limitations in metric names")

  if echo "$noise" | grep -q "Created topic"; then
    printf '  + %s\n' "$topic"
    created=$((created + 1))
  elif [ -z "${noise//[[:space:]]/}" ] || echo "$noise" | grep -q "already exists"; then
    existed=$((existed + 1))
  else
    printf '  ! %s — %s\n' "$topic" "$noise" >&2
  fi
done

printf 'Xong: %d topic mới, %d đã có (tổng %d).\n' "$created" "$existed" "${#TOPICS[@]}"
