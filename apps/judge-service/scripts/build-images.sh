#!/usr/bin/env bash
# Build the six sandbox images the executor runs student code in.
#
# One image per language family, deliberately thin: a base runtime plus a uid-1000 user, so
# containers never run as root. Tags are pinned in app/services/execution_config.py — change
# one, change the other.
set -euo pipefail

cd "$(dirname "$0")/.."

for lang in python cpp java node go php; do
  echo "==> codementor-runner-${lang}:1.0"
  docker build -q -t "codementor-runner-${lang}:1.0" -f "docker/${lang}.Dockerfile" docker/
done

echo "Xong. Kiểm tra: docker images | grep codementor-runner"
