#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "dùng: SSH_KEY=/đường/dẫn/key.pem $0 ec2-user@<ip>" >&2
  exit 2
fi

host=$1
env_file=${ENV_FILE:-.env}
ssh_args=()
[[ -n ${SSH_KEY:-} ]] && ssh_args+=(-i "$SSH_KEY")

if [[ ! -s $env_file ]]; then
  echo "không thấy hoặc file rỗng: $env_file" >&2
  exit 1
fi

# Truyền qua stdin: secret không xuất hiện trong command line, log, hay Git.
ssh "${ssh_args[@]}" "$host" '
  set -eu
  cd /opt/codementor-backend
  umask 077
  tmp=$(mktemp .env.XXXXXX)
  trap '\''rm -f "$tmp"'\'' EXIT
  cat >"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" .env
  trap - EXIT
' <"$env_file"

ssh "${ssh_args[@]}" "$host" '
  cd /opt/codementor-backend
  test "$(stat -c %a .env)" = 600
  sudo docker compose config --quiet
'

echo "đã cập nhật /opt/codementor-backend/.env (0600) trên $host"
