#!/usr/bin/env bash
# 跑 Rust 伺服器的測試（cargo test）：開一台用完就丟的 postgres:18（跟 CI、正式機同版），自己找空的埠，跑完收掉。
# 要有 docker。多個 worktree 同時跑也不會撞（每次一台新的、埠是隨機的）。
# 用法：npm run test:server [-- cargo test 的參數，例 --test music]
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

# build.rs 要 node 打包流程核心；新的 worktree 沒有 node_modules 就裝（不要 symlink 別的 worktree 的，會壞）。
[ -d node_modules ] || npm ci

name="cheer-test-pg-$$"
docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=postgres -p 127.0.0.1::5432 postgres:18 >/dev/null
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT

for _ in $(seq 1 60); do
	docker exec "$name" pg_isready -U postgres >/dev/null 2>&1 && break
	sleep 0.5
done
docker exec "$name" pg_isready -U postgres >/dev/null

port="$(docker port "$name" 5432/tcp | head -1 | sed 's/.*://')"
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:$port/postgres"
echo "postgres:18 在 127.0.0.1:${port}（${name}），跑完自動收掉"

cd server
cargo test --locked "$@"
