#!/usr/bin/env bash
# Chạy/dừng các service ở môi trường dev.
#
#   bash scripts/services.sh start|stop|restart|status [tên-service...]
#
# Vì sao có file này thay vì gõ pkill: `pkill -f "dist/apps/..."` khớp cả tiến trình
# shell đang chạy chính câu lệnh đó, nên nó tự giết mình TRƯỚC khi giết được service.
# Service cũ sống sót, tiến trình mới không bind được cổng và chết, còn người gõ lệnh
# thì tưởng đã restart — rồi test cả buổi trên bản build cũ. Ở đây dừng theo PID đang
# giữ cổng, nên không có gì để khớp nhầm.
set -uo pipefail

cd "$(dirname "$0")/.."

SERVICES=(core:3001 learning:3002 exercise:3003 workspace:3004
          submission:3006 judge:3007 ai:3008 realtime:3009 notification:3012)
LOG_DIR="${CODEMENTOR_LOG_DIR:-/tmp/codementor-logs}"

# PID đang giữ cổng, rỗng nếu không ai giữ.
pid_on_port() {
  ss -lntp 2>/dev/null | awk -v port=":$1" '$4 ~ port"$" {print $NF}' |
    grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2
}

selected() {
  if [ "$#" -eq 0 ]; then printf '%s\n' "${SERVICES[@]}"; return; fi
  for want in "$@"; do
    for entry in "${SERVICES[@]}"; do
      [ "${entry%%:*}" = "$want" ] && echo "$entry"
    done
  done
}

stop_one() {
  local name=$1 port=$2 pid
  pid=$(pid_on_port "$port")
  if [ -z "$pid" ]; then printf '  %-12s không chạy\n' "$name"; return; fi

  kill "$pid" 2>/dev/null
  for _ in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || { printf '  %-12s đã dừng (pid %s)\n' "$name" "$pid"; return; }
    sleep 0.25
  done
  # Không tự tắt sau 5 giây thì nó đang treo, không phải đang dọn dẹp.
  kill -9 "$pid" 2>/dev/null
  printf '  %-12s buộc dừng (pid %s)\n' "$name" "$pid"
}

start_one() {
  local name=$1 port=$2 entry="dist/apps/$1-service/apps/$1-service/src/main.js"

  if [ "$name" = "ai" ]; then
    node scripts/services.mjs start ai
    return $?
  fi

  if [ -n "$(pid_on_port "$port")" ]; then
    printf '  %-12s đang chạy sẵn ở :%s — bỏ qua\n' "$name" "$port"; return
  fi
  if [ ! -f "$entry" ]; then
    printf '  %-12s CHƯA BUILD (%s)\n' "$name" "$entry"; return 1
  fi

  mkdir -p "$LOG_DIR"
  setsid node "$entry" > "$LOG_DIR/$name.log" 2>&1 < /dev/null &

  for _ in $(seq 1 60); do
    [ -n "$(pid_on_port "$port")" ] && { printf '  %-12s :%s\n' "$name" "$port"; return; }
    sleep 0.5
  done
  printf '  %-12s KHÔNG LÊN ĐƯỢC — xem %s/%s.log\n' "$name" "$LOG_DIR" "$name"
  return 1
}

status_one() {
  local name=$1 port=$2 pid
  pid=$(pid_on_port "$port")
  if [ -n "$pid" ]; then
    printf '  %-12s %-6s pid %s\n' "$name" ":$port" "$pid"
  else
    printf '  %-12s %-6s dừng\n' "$name" ":$port"
  fi
}

action=${1:-status}; shift || true
mapfile -t chosen < <(selected "$@")
failed=0

case "$action" in
  stop)    for e in "${chosen[@]}"; do stop_one "${e%%:*}" "${e##*:}"; done ;;
  start)   for e in "${chosen[@]}"; do start_one "${e%%:*}" "${e##*:}" || failed=1; done ;;
  restart)
    for e in "${chosen[@]}"; do stop_one "${e%%:*}" "${e##*:}"; done
    for e in "${chosen[@]}"; do start_one "${e%%:*}" "${e##*:}" || failed=1; done ;;
  status)  for e in "${chosen[@]}"; do status_one "${e%%:*}" "${e##*:}"; done ;;
  *) echo "dùng: $0 start|stop|restart|status [tên-service...]" >&2; exit 2 ;;
esac

exit $failed
