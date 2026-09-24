#!/usr/bin/env bash
set -euo pipefail

# Dựng Kafka + Kong + 10 service trên máy đã chạy bootstrap-ec2.sh và push-env-ec2.sh.
# Deploy đúng mã đang nằm ở /opt/codementor-backend; bootstrap-ec2.sh là bước kéo mã mới.

if [[ $# -ne 1 ]]; then
  echo "dùng: SSH_KEY=/đường/dẫn/key.pem $0 ec2-user@<ip>" >&2
  exit 2
fi

host=$1
ssh_args=()
[[ -n ${SSH_KEY:-} ]] && ssh_args+=(-i "$SSH_KEY")

ssh "${ssh_args[@]}" "$host" bash -s <<'REMOTE'
set -euo pipefail
cd /opt/codementor-backend
test -s .env || { echo "thiếu .env: chạy push-env-ec2.sh trước" >&2; exit 1; }

# kong.yml là bản dev, upstream trỏ host.docker.internal:<cổng>. Trên EC2 service là
# container cùng network, nên đổi sang tên service; route giữ nguyên một nguồn.
sed -E \
  -e 's#host\.docker\.internal:3001#core-service:3001#' \
  -e 's#host\.docker\.internal:3002#learning-service:3002#' \
  -e 's#host\.docker\.internal:3003#exercise-service:3003#' \
  -e 's#host\.docker\.internal:3004#workspace-service:3004#' \
  -e 's#host\.docker\.internal:3006#submission-service:3006#' \
  -e 's#host\.docker\.internal:3007#judge-service:3007#' \
  -e 's#host\.docker\.internal:3008#ai-service:3008#' \
  -e 's#host\.docker\.internal:3012#notification-service:3012#' \
  -e 's#host\.docker\.internal:3013#recommendation-service:3013#' \
  kong/kong.yml >kong/kong.ec2.yml
if grep -q host.docker.internal kong/kong.ec2.yml; then
  echo "kong.yml có upstream chưa được ánh xạ sang tên service:" >&2
  grep -n host.docker.internal kong/kong.ec2.yml >&2
  exit 1
fi

compose=(sudo docker compose -f docker-compose.yml -f docker-compose.ec2.yml)
services=(kafka kong core-service learning-service exercise-service workspace-service
  submission-service realtime-service recommendation-service notification-service
  judge-service ai-service)

# Image sandbox không do compose build; thiếu thì judge trả "image missing" cho mọi bài.
sudo bash apps/judge-service/scripts/build-images.sh
"${compose[@]}" build
"${compose[@]}" up -d --remove-orphans "${services[@]}"
# kong.ec2.yml vừa được ghi lại thành file mới (inode mới), nhưng compose không thấy
# config đổi nên không tạo lại Kong — container vẫn đọc bản cũ qua bind mount.
"${compose[@]}" restart kong
# Build trên máy 30 GB: cache của npm ci + 6 image runner dễ vượt chục GB.
sudo docker builder prune -f >/dev/null

"${compose[@]}" ps --format 'table {{.Name}}\t{{.Status}}'
REMOTE
