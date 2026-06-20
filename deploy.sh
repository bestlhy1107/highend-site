#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="highend-site"
BRANCH="main"
REMOTE="origin"
APP_PORT="4321"
APP_HOST="127.0.0.1"
RUNTIME_BACKUP_PATHS=(data public/uploads)
RUNTIME_STASH_PATHS=(data)
RUNTIME_STASH_CREATED=0
RUNTIME_STASH_NAME=""
RUNTIME_BACKUP_CREATED=0
RUNTIME_BACKUP_FILE=""
HEALTH_PATHS=("/" "/admin/login" "/school-finder")
PREWARM_PATHS=("/" "/school-finder" "/admin/login" "/api/news?tag=all&limit=6")

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

find_runtime_stash_ref() {
  if [[ -z "$RUNTIME_STASH_NAME" ]]; then
    return 1
  fi

  git stash list --format='%gd %s' | awk -v name="$RUNTIME_STASH_NAME" 'index($0, name) { print $1; exit }'
}

restore_runtime_stash_if_needed() {
  if [[ "${RUNTIME_STASH_CREATED}" != "1" ]]; then
    return 0
  fi

  local stash_ref
  stash_ref="$(find_runtime_stash_ref || true)"

  if [[ -z "$stash_ref" ]]; then
    echo "[WARN] 未找到运行时数据 stash：${RUNTIME_STASH_NAME}" >&2
    return 1
  fi

  echo "[INFO] 正在恢复运行时数据 stash：${stash_ref}" >&2
  if git stash pop --index "$stash_ref"; then
    RUNTIME_STASH_CREATED=0
    return 0
  fi

  echo "[WARN] 带索引恢复失败，尝试普通恢复：${stash_ref}" >&2
  if git stash pop "$stash_ref"; then
    RUNTIME_STASH_CREATED=0
    return 0
  fi

  echo "[ERROR] 自动恢复运行时数据失败，请手动执行 git stash list 并恢复：${RUNTIME_STASH_NAME}" >&2
  return 1
}

on_error() {
  local exit_code=$?
  echo
  echo "[ERROR] 命令执行失败，行号: $1，退出码: ${exit_code}" >&2
  if [[ "${RUNTIME_STASH_CREATED}" == "1" ]]; then
    restore_runtime_stash_if_needed || true
  fi
  if [[ "${RUNTIME_BACKUP_CREATED}" == "1" && -n "${RUNTIME_BACKUP_FILE}" ]]; then
    echo "[INFO] 本次部署前备份文件：${RUNTIME_BACKUP_FILE}" >&2
    echo "[INFO] 如需恢复，可执行：npm run runtime:restore -- --file=${RUNTIME_BACKUP_FILE} --yes" >&2
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
require_cmd node
require_cmd pm2
require_cmd curl
require_cmd tar

log "Node 版本：$(node --version)"
[[ -f package.json ]] || fail "当前目录不是项目根目录，未找到 package.json"

log "2. 读取环境变量"
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
else
  log "未发现 .env，继续使用当前系统环境变量"
fi

[[ -n "${ADMIN_USERNAME:-}" ]] || fail "缺少 ADMIN_USERNAME，管理员登录将不可用"
[[ -n "${ADMIN_PASSWORD:-}" ]] || fail "缺少 ADMIN_PASSWORD，管理员登录将不可用"

if [[ -z "${ASTRO_DB_REMOTE_URL:-}" || -z "${ASTRO_DB_APP_TOKEN:-}" ]]; then
  log "提醒：未检测到完整 Astro DB 远程配置，咨询线索等数据库功能可能不可用"
fi

UPLOAD_RUNTIME_ROOT="${UPLOAD_ROOT:-${WANHE_UPLOAD_ROOT:-${RAILWAY_VOLUME_MOUNT_PATH:-${SCRIPT_DIR}/public/uploads}}}"
mkdir -p "$UPLOAD_RUNTIME_ROOT"
log "上传图片目录：$UPLOAD_RUNTIME_ROOT"

log "3. 部署前备份运行时数据"
backup_paths="$(IFS=,; echo "${RUNTIME_BACKUP_PATHS[*]}")"
backup_output="$(npm run --silent runtime:backup -- --reason=pre-deploy --paths="$backup_paths" || true)"
echo "$backup_output"
RUNTIME_BACKUP_FILE="$(printf '%s\n' "$backup_output" | sed -n 's/^运行时数据已备份：//p' | tail -1)"
if [[ -n "$RUNTIME_BACKUP_FILE" ]]; then
  RUNTIME_BACKUP_CREATED=1
fi

log "4. 自动暂存会影响拉代码的运行时数据改动"
if [[ -n "$(git status --porcelain -- "${RUNTIME_STASH_PATHS[@]}")" ]]; then
  RUNTIME_STASH_NAME="deploy-runtime-data-$(date '+%Y%m%d-%H%M%S')"
  git stash push --include-untracked -m "$RUNTIME_STASH_NAME" -- "${RUNTIME_STASH_PATHS[@]}"
  RUNTIME_STASH_CREATED=1
  log "已临时保存运行时数据改动：$RUNTIME_STASH_NAME"
else
  log "没有检测到需要 git stash 的运行时数据改动"
fi

log "5. 检查代码工作区是否干净"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "检测到未提交或未跟踪文件："
  git status --short
  fail "请先处理服务器上的代码改动，再部署。运行时 data/ 会由 git stash 保护，public/uploads/ 会由部署前备份保护。"
fi

log "6. 获取最新代码"
git fetch "$REMOTE" "$BRANCH"
git pull --ff-only "$REMOTE" "$BRANCH"

if [[ "$RUNTIME_STASH_CREATED" == "1" ]]; then
  log "7. 恢复运行时数据改动"
  restore_runtime_stash_if_needed
else
  log "7. 无需恢复运行时数据"
fi

log "8. 安装依赖"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

log "9. 预生成选校搜索索引"
npm run study-abroad:build-index

log "10. 构建项目"
npm run build

[[ -f ./dist/server/entry.mjs ]] || fail "未找到构建产物 ./dist/server/entry.mjs"

log "11. 启动或重启 PM2"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  HOST="$APP_HOST" PORT="$APP_PORT" pm2 restart "$APP_NAME" --update-env
else
  HOST="$APP_HOST" PORT="$APP_PORT" pm2 start ./dist/server/entry.mjs --name "$APP_NAME"
fi

pm2 save

log "12. 健康检查"
sleep 2
for path in "${HEALTH_PATHS[@]}"; do
  curl -fsS -I "http://${APP_HOST}:${APP_PORT}${path}" >/dev/null ||
    fail "应用本地端口健康检查失败：${path}"
done

log "13. 预热关键页面"
for path in "${PREWARM_PATHS[@]}"; do
  curl -fsS --max-time 25 "http://${APP_HOST}:${APP_PORT}${path}" >/dev/null ||
    fail "关键页面预热失败：${path}"
done

log "14. 当前 PM2 状态"
pm2 status

log "部署完成"
