#!/usr/bin/env bash
# Toonflow-Backend 一键部署脚本（Linux 云服务器，内部使用，HTTP 直连）
# 用法：./deploy.sh
set -euo pipefail

cd "$(dirname "$0")"

# ---------- 1. 校验 .env ----------
if [[ ! -f .env ]]; then
  echo "❌ 未找到 .env"
  echo "   请先执行：cp .env.production.example .env"
  echo "   并填写 PG_PASSWORD、JWT_SECRET（openssl rand -hex 32）等。"
  exit 1
fi

# 读取 .env 供脚本内部使用（仅本进程）
set -a
# shellcheck disable=SC1091
source .env
set +a

: "${PORT:=4000}"
: "${PG_USER:?PG_USER 未在 .env 中设置}"
: "${PG_DATABASE:?PG_DATABASE 未在 .env 中设置}"

if [[ "${JWT_SECRET:-}" == CHANGE_ME* || -z "${JWT_SECRET:-}" ]]; then
  echo "❌ JWT_SECRET 仍是占位值或为空，请在 .env 中改为强随机值（openssl rand -hex 32）。"
  exit 1
fi

# docker compose 命令兼容（插件版 / 独立版）
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "❌ 未找到 docker compose，请先安装 Docker 及 Compose 插件。"
  exit 1
fi

# ---------- 2. 构建并启动（容器启动会自动跑 migration）----------
echo "🚀 构建并启动服务..."
$DC up -d --build

# ---------- 3. 等待健康检查 ----------
echo "⏳ 等待后端就绪 (http://127.0.0.1:${PORT}/healthz) ..."
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
    echo "✅ 后端已就绪。"
    break
  fi
  if [[ $i -eq 60 ]]; then
    echo "❌ 等待超时。查看日志：$DC logs --tail=100 backend"
    exit 1
  fi
  sleep 2
done

# ---------- 4. 首次 seed（非幂等，仅在 o_user 为空时执行）----------
echo "🔎 检查是否需要初始化默认数据 (seed)..."
HAS_ADMIN=$($DC exec -T postgres psql -U "$PG_USER" -d "$PG_DATABASE" -tAc \
  "SELECT 1 FROM o_user LIMIT 1" 2>/dev/null | tr -d '[:space:]' || true)

if [[ "$HAS_ADMIN" == "1" ]]; then
  echo "ℹ️  已存在用户数据，跳过 seed（seed 非幂等，会清空配置表）。"
else
  echo "🌱 首次部署，执行 seed 初始化默认数据..."
  $DC exec -T backend npm run seed
  echo "✅ seed 完成。"
fi

# ---------- 5. 打印部署信息 ----------
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo ""
echo "🎉 部署完成"
echo "----------------------------------------"
echo "健康检查 : http://127.0.0.1:${PORT}/healthz"
echo "默认账号 : admin / admin123（请尽快修改）"
echo ""
echo "客户端构建时需配置："
echo "  TOONFLOW_BACKEND_URL = http://${SERVER_IP:-<本机IP>}:${PORT}"
echo "  JWT_SECRET           = 与本机 .env 中的 JWT_SECRET 完全一致"
echo "----------------------------------------"
