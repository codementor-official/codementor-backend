#!/usr/bin/env bash
# Toàn bộ ma trận đánh giá, tuần tự. Mỗi lệnh tự dừng nếu chạm trần $2.
set -eo pipefail
cd "$(dirname "$0")/../.."
for spec in "A 3" "B1 2" "B2 2" "B3 3" "F-key 1" "F-timeout 1"; do
  set -- $spec
  uv run python -u eval/tutor/run.py run --mode "$1" --repeat "$2" 2>&1 | grep --line-buffered -v "Warning\|warn("
done
uv run python eval/tutor/run.py report 2>&1 | grep -v "Warning\|warn("
