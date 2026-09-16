#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "dùng: SSH_KEY=/đường/dẫn/key.pem $0 ec2-user@<ip>" >&2
  exit 2
fi

host=$1
repo_url=${REPO_URL:-https://github.com/codementor-official/codementor-backend.git}
compose_version=${COMPOSE_VERSION:-v5.1.4}
swap_size=${SWAP_SIZE:-2G}
ssh_args=()
[[ -n ${SSH_KEY:-} ]] && ssh_args+=(-i "$SSH_KEY")

ssh "${ssh_args[@]}" "$host" bash -s -- "$repo_url" "$compose_version" "$swap_size" <<'REMOTE'
set -euo pipefail

repo_url=$1
compose_version=$2
swap_size=$3
repo_dir=/opt/codementor-backend
target_user=$(id -un)
target_group=$(id -gn)

if command -v dnf >/dev/null; then
  sudo dnf install -y docker git curl
elif command -v apt-get >/dev/null; then
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl docker.io git
else
  echo "chỉ hỗ trợ Amazon Linux 2023 hoặc Ubuntu" >&2
  exit 1
fi

sudo systemctl enable --now docker
sudo usermod -aG docker "$target_user"

if ! sudo docker compose version >/dev/null 2>&1; then
  case $(uname -m) in
    x86_64) compose_arch=x86_64 ;;
    aarch64|arm64) compose_arch=aarch64 ;;
    *) echo "Docker Compose chưa hỗ trợ kiến trúc $(uname -m) trong script này" >&2; exit 1 ;;
  esac

  plugin_dir=/usr/local/lib/docker/cli-plugins
  download_url="https://github.com/docker/compose/releases/download/${compose_version}/docker-compose-linux-${compose_arch}"
  binary=$(mktemp)
  checksum=$(mktemp)
  trap 'rm -f "$binary" "$checksum"' EXIT
  curl -fsSL "$download_url" -o "$binary"
  curl -fsSL "${download_url}.sha256" -o "$checksum"
  printf '%s  %s\n' "$(awk '{print $1}' "$checksum")" "$binary" | sha256sum --check --status
  sudo install -d "$plugin_dir"
  sudo install -m 0755 "$binary" "$plugin_dir/docker-compose"
fi

if ! swapon --show=NAME --noheadings | grep -q .; then
  sudo fallocate -l "$swap_size" /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null

sudo install -d -m 0755 -o "$target_user" -g "$target_group" "$repo_dir"
if [[ -d $repo_dir/.git ]]; then
  git -C "$repo_dir" pull --ff-only origin main
elif [[ -n $(find "$repo_dir" -mindepth 1 -maxdepth 1 -print -quit) ]]; then
  echo "$repo_dir đã có dữ liệu nhưng không phải Git repository" >&2
  exit 1
else
  git clone --branch main --single-branch "$repo_url" "$repo_dir"
fi

sudo docker --version
sudo docker compose version
free -h
echo "xong: $repo_dir; đăng nhập SSH lại để dùng docker không cần sudo"
REMOTE
