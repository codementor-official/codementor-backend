#!/usr/bin/env bash
set -euo pipefail

# Deploy một branch (không phải main) lên EC2 ứng dụng và bổ sung biến email vào .env.
#   SSH_KEY=key.pem ENV_SOURCE=.env.backend.prod scripts/deploy-branch-ec2.sh ec2-user@<ip> <branch>
# Chỉ thay các dòng EMAIL_*/SMTP_* trong .env của server; mọi biến khác giữ nguyên, và một bản
# sao .env được lưu cạnh nó trước khi sửa. Sau khi branch được merge vào main, bootstrap-ec2.sh
# (pull --ff-only origin main) chạy lại bình thường.

if [[ $# -ne 2 ]]; then
  echo "dùng: SSH_KEY=key.pem ENV_SOURCE=<file env> $0 ec2-user@<ip> <branch>" >&2
  exit 2
fi
host=$1
branch=$2
ssh_args=(-o BatchMode=yes)
[[ -n ${SSH_KEY:-} ]] && ssh_args+=(-i "$SSH_KEY")

echo "== 1/3 checkout $branch"
ssh "${ssh_args[@]}" "$host" bash -s -- "$branch" <<'REMOTE'
set -euo pipefail
cd /opt/codementor-backend
git fetch -q origin "$1"
git checkout -q -B "$1" "origin/$1"
git log -1 --format='   %h %s'
REMOTE

if [[ -n ${ENV_SOURCE:-} ]]; then
  echo "== 2/3 cập nhật EMAIL_*/SMTP_* trong .env"
  grep -E '^(EMAIL_|SMTP_)' "$ENV_SOURCE" | ssh "${ssh_args[@]}" "$host" '
    set -euo pipefail
    cd /opt/codementor-backend
    cp -p .env ".env.bak-$(date +%Y%m%dT%H%M%S)"
    sed -i -E "/^(EMAIL_|SMTP_)/d" .env
    cat >> .env
    chmod 600 .env
    grep -E "^(EMAIL_|SMTP_)" .env | sed -E "s/^(SMTP_PASSWORD=).*/\1***/; s/^/   /"'
else
  echo "== 2/3 bỏ qua .env (không có ENV_SOURCE)"
fi

echo "== 3/3 build và khởi động lại stack"
"$(dirname "$0")/deploy-ec2.sh" "$host"
