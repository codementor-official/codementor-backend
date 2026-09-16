#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "dùng: SSH_KEY=/đường/dẫn/key.pem $0 ec2-user@<ip>" >&2
  exit 2
fi

host=$1
repo_url=${REPO_URL:-https://github.com/codementor-official/codementor-backend.git}
compose_version=${COMPOSE_VERSION:-v5.1.4}
buildx_version=${BUILDX_VERSION:-v0.37.1}
swap_size=${SWAP_SIZE:-2G}
ssh_args=()
[[ -n ${SSH_KEY:-} ]] && ssh_args+=(-i "$SSH_KEY")

ssh "${ssh_args[@]}" "$host" bash -s -- "$repo_url" "$compose_version" "$swap_size" "$buildx_version" <<'REMOTE'
set -euo pipefail

repo_url=$1
compose_version=$2
swap_size=$3
buildx_version=$4
repo_dir=/opt/codementor-backend
target_user=$(id -un)
target_group=$(id -gn)

if command -v dnf >/dev/null; then
  # AL2023 có sẵn curl-minimal; cài gói `curl` thì dnf báo xung đột.
  sudo dnf install -y docker git
elif command -v apt-get >/dev/null; then
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl docker.io git
else
  echo "chỉ hỗ trợ Amazon Linux 2023 hoặc Ubuntu" >&2
  exit 1
fi

# json-file mặc định không xoay vòng log, mà Kong ghi mọi request ra stdout.
# Chỉ áp cho container tạo SAU lúc này: container cũ phải được tạo lại.
if [[ ! -e /etc/docker/daemon.json ]]; then
  sudo install -d /etc/docker
  echo '{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}' | sudo tee /etc/docker/daemon.json >/dev/null
  sudo systemctl restart docker
elif ! grep -q max-size /etc/docker/daemon.json; then
  echo "cảnh báo: /etc/docker/daemon.json đã có nhưng chưa giới hạn log, sửa tay" >&2
fi
sudo systemctl enable --now docker
sudo usermod -aG docker "$target_user"

case $(uname -m) in
  x86_64) arch=x86_64; go_arch=amd64 ;;
  aarch64|arm64) arch=aarch64; go_arch=arm64 ;;
  *) echo "script này chưa hỗ trợ kiến trúc $(uname -m)" >&2; exit 1 ;;
esac
plugin_dir=/usr/local/lib/docker/cli-plugins
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

# install_plugin <tên> <url binary> <url checksum>: file checksum có thể chứa nhiều dòng,
# lấy đúng dòng của binary.
install_plugin() {
  local name=$1 url=$2 sums_url=$3 file
  file=$(basename "$url")
  curl -fsSL "$url" -o "$tmp_dir/$file"
  curl -fsSL "$sums_url" -o "$tmp_dir/$file.sums"
  printf '%s  %s\n' "$(grep -E "[ *]$file\$" "$tmp_dir/$file.sums" | awk '{print $1}')" "$tmp_dir/$file" \
    | sha256sum --check --status
  sudo install -d "$plugin_dir"
  sudo install -m 0755 "$tmp_dir/$file" "$plugin_dir/$name"
}

if ! sudo docker compose version >/dev/null 2>&1; then
  url="https://github.com/docker/compose/releases/download/${compose_version}/docker-compose-linux-${arch}"
  install_plugin docker-compose "$url" "$url.sha256"
fi

# Docker của AL2023 kèm buildx 0.12, còn Compose 5 đòi từ 0.17 mới chịu `compose build`.
# /usr/local/lib đứng trước /usr/libexec trong đường tìm plugin nên bản này thắng.
if ! sudo docker buildx version 2>/dev/null | grep -qF " $buildx_version "; then
  base="https://github.com/docker/buildx/releases/download/${buildx_version}"
  install_plugin docker-buildx "$base/buildx-${buildx_version}.linux-${go_arch}" "$base/checksums.txt"
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
sudo docker buildx version
free -h
echo "xong: $repo_dir; đăng nhập SSH lại để dùng docker không cần sudo"
REMOTE
