#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="highend-site"
BRANCH="main"
REMOTE="origin"
APP_PORT="4321"
APP_HOST="127.0.0.1"
RUNTIME_DATA_PATHS=(data)
RUNTIME_STASH_CREATED=0
RUNTIME_STASH_NAME=""

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
  if [[ "${RUNTIME_STASH_CREATED}" == "1" ]]; then
    echo "[INFO] 运行时数据已临时保存在 git stash 顶部，请排查后执行 git stash pop --index stash@{0} 恢复。" >&2
  fi
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

log "2. 自动暂存运行时数据改动"
if [[ -n "$(git status --porcelain -- "${RUNTIME_DATA_PATHS[@]}")" ]]; then
  RUNTIME_STASH_NAME="deploy-runtime-data-$(date '+%Y%m%d-%H%M%S')"
  git stash push --include-untracked -m "$RUNTIME_STASH_NAME" -- "${RUNTIME_DATA_PATHS[@]}"
  RUNTIME_STASH_CREATED=1
  log "已临时保存运行时数据改动：$RUNTIME_STASH_NAME"
else
  log "没有检测到运行时数据改动"
fi

log "3. 检查代码工作区是否干净"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "检测到未提交或未跟踪文件："
  git status --short
  fail "请先处理服务器上的代码改动，再部署。运行时 data/ 改动会由脚本自动保护。"
fi

log "4. 获取最新代码"
git fetch "$REMOTE" "$BRANCH"
git pull --ff-only "$REMOTE" "$BRANCH"

if [[ "$RUNTIME_STASH_CREATED" == "1" ]]; then
  log "5. 恢复运行时数据改动"
  git stash pop --index stash@{0}
  RUNTIME_STASH_CREATED=0
else
  log "5. 无需恢复运行时数据"
fi

log "6. 读取环境变量"
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
else
  log "未发现 .env，继续使用当前系统环境变量"
fi

log "7. 安装依赖"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

log "8. 构建项目"
npm run build

[[ -f ./dist/server/entry.mjs ]] || fail "未找到构建产物 ./dist/server/entry.mjs"

log "9. 启动或重启 PM2"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  HOST="$APP_HOST" PORT="$APP_PORT" pm2 restart "$APP_NAME" --update-env
else
  HOST="$APP_HOST" PORT="$APP_PORT" pm2 start ./dist/server/entry.mjs --name "$APP_NAME"
fi

pm2 save

log "10. 健康检查"
sleep 2
curl -fsS -I "http://${APP_HOST}:${APP_PORT}" >/dev/null || fail "应用本地端口健康检查失败"

log "11. 当前 PM2 状态"
pm2 status

log "部署完成"
