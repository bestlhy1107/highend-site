#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="highend-site"
BRANCH="main"
REMOTE="origin"
APP_PORT="4321"
APP_HOST="127.0.0.1"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

log() {
  echo
  echo "[$(date '+%F %T')] $*"
}

fail() {
  echo
  echo "[ERROR] $*" >&2
  exit 1
}

on_error() {
  local exit_code=$?
  echo
  echo "[ERROR] 命令执行失败，行号: $1，退出码: ${exit_code}" >&2
  exit "$exit_code"
}
trap 'on_error $LINENO' ERR

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "缺少命令: $1"
}

log "1. 检查依赖命令"
require_cmd git
require_cmd npm
require_cmd pm2
require_cmd curl

log "2. 检查 Git 工作区是否干净"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "检测到未提交或未跟踪文件："
  git status --short
  fail "请先处理服务器上的本地改动，再部署。"
fi

log "3. 获取最新代码"
git fetch "$REMOTE" "$BRANCH"
git pull --ff-only "$REMOTE" "$BRANCH"

log "4. 读取环境变量"
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
else
  log "未发现 .env，继续使用当前系统环境变量"
fi

log "5. 安装依赖"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

log "6. 构建项目"
npm run build

[[ -f ./dist/server/entry.mjs ]] || fail "未找到构建产物 ./dist/server/entry.mjs"

log "7. 启动或重启 PM2"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  HOST="$APP_HOST" PORT="$APP_PORT" pm2 restart "$APP_NAME" --update-env
else
  HOST="$APP_HOST" PORT="$APP_PORT" pm2 start ./dist/server/entry.mjs --name "$APP_NAME"
fi

pm2 save

log "8. 健康检查"
sleep 2
curl -fsS -I "http://${APP_HOST}:${APP_PORT}" >/dev/null || fail "应用本地端口健康检查失败"

log "9. 当前 PM2 状态"
pm2 status

log "部署完成"
