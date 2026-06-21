# Linux 云服务器部署指南（内部使用）

面向：把 **Toonflow-Backend** 部署到一台 Linux 云服务器，供公司内部员工的桌面客户端连接。采用 **裸 Docker + HTTP**，数据库用 compose 内置 PostgreSQL，通过服务器 IP 直连，无域名。

```
┌──────────────────────────┐         ┌──────────────────────────────┐
│ 员工电脑的 Electron 客户端│ ──────> │ Linux 云服务器 (docker compose)│
│ TOONFLOW_BACKEND_URL      │ :4000   │  ├─ backend  (Express :4000)  │
│  = http://<服务器IP>:4000 │  HTTP   │  └─ postgres (内部网络, 数据卷)│
└──────────────────────────┘         └──────────────────────────────┘
```

> **为什么用 HTTP 不用 HTTPS**：内部使用且只有服务器 IP、无域名，无法签发受信任证书；自签证书会让客户端出现信任问题。可信内网/VPN 下 HTTP 直连是务实选择。代价是 JWT 走明文——内网可接受。若日后需要加密，可申请域名后加反向代理 + Let's Encrypt。

---

## 一、前置

服务器需安装 Docker 与 Compose 插件：

```bash
# 验证
docker version
docker compose version   # 或旧版 docker-compose
```

---

## 二、配置环境变量

```bash
cd Toonflow-Backend
cp .env.production.example .env
```

编辑 `.env`，**两个必改项**：

```bash
# 数据库密码
PG_PASSWORD=$(openssl rand -hex 16)
# JWT 签名密钥（务必记下，客户端构建要用同一个值）
JWT_SECRET=$(openssl rand -hex 32)
```

把上面生成的值填进 `.env`。如需媒体上传，再补 `TOS_*` 火山引擎凭据；只验证登录可留空。

> ⚠️ **JWT_SECRET 要同步给客户端**：客户端打包时注入的 `JWT_SECRET` 必须与这里完全一致，否则登录态无法互通。记下这个值，交给客户端构建（见 `Toonflow-app/docs/build-release.md`）。

`.env` 已在 `.gitignore` / `.dockerignore` 中，不会进仓库或镜像。

---

## 三、一键部署

```bash
./deploy.sh
```

脚本会：构建并启动容器 → 等待健康检查 → 首次自动 seed（已有数据则跳过）→ 打印登录信息和客户端应配置的地址。

完成后用脚本输出的 `TOONFLOW_BACKEND_URL`（即 `http://<服务器IP>:4000`）配置客户端构建。

手动等价步骤（不想用脚本时）：

```bash
docker compose up -d --build                  # backend 启动时自动跑 migration 建表
curl http://127.0.0.1:4000/healthz            # 期望返回 {"code":0,...}
docker compose exec backend npm run seed      # 仅首次！seed 非幂等，会清空配置表
```

默认登录账号：**admin / admin123**（请尽快修改）。

---

## 四、防火墙 / 安全组

- **只对内部网段放行 4000**（公司内网 IP 段 / VPN），不要对公网开放。
- **不要开放 5432**：compose 已不暴露数据库端口，PostgreSQL 仅在 docker 内部网络可达。
- 示例（ufw，按实际内网段调整）：
  ```bash
  ufw allow from 10.0.0.0/8 to any port 4000 proto tcp
  ```

---

## 五、运维

```bash
docker compose ps                    # 状态（确认 postgres 无对外端口）
docker compose logs -f backend       # 后端日志（可看到客户端登录请求）
docker compose restart backend       # 重启后端
docker compose down                  # 停服（数据卷保留）

# 升级：拉取最新代码后重新部署（migration 幂等，会自动补齐）
git pull && ./deploy.sh

# 备份数据库（pgdata 卷）
docker compose exec -T postgres pg_dump -U "$PG_USER" "$PG_DATABASE" > backup_$(date +%F).sql
# 恢复
cat backup_YYYY-MM-DD.sql | docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DATABASE"
```

> 上面 `$PG_USER`/`$PG_DATABASE` 需先 `set -a; source .env; set +a` 或直接替换为实际值。

---

## 六、注意事项

- **migration 幂等**：每次容器启动自动跑，已应用的不会重复，安全。
- **seed 非幂等**：会清空并重写配置表，`deploy.sh` 仅在 `o_user` 为空时执行一次；切勿手动重复跑。
- **镜像用 ts-node 直接跑 .ts**：因 `knexfile.ts`/migrations 是 TypeScript，容器装了 devDeps 并用 `ts-node --transpile-only` 启动，无需预编译。
- **客户端不进 Docker**：Electron 是桌面 GUI，装在员工电脑上，Docker 只承载它依赖的云端服务。
- 与本地/通用 Docker 说明见 `docs/docker-deploy.md`；本文件是面向生产服务器的权威流程。
