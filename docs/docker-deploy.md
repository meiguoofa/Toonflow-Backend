# Docker 部署指南

用 Docker 跑 **PostgreSQL + Toonflow-Backend**。桌面客户端(Electron)是 GUI 应用,**不进 Docker**,仍在本机(Windows/Mac)运行,连到容器暴露的 `http://localhost:4000`。

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│ Electron 客户端(本机)  │ ─────> │ docker compose               │
│ TOONFLOW_BACKEND_URL    │  :4000 │  ├─ backend  (Express :4000) │
│  = http://localhost:4000│        │  └─ postgres (:5432, 数据卷) │
└─────────────────────────┘        └──────────────────────────────┘
```

需要的脚本(均在 `Toonflow-Backend/` 下):
- `Dockerfile` — 后端镜像
- `.dockerignore` — 构建时排除 node_modules/.env 等
- `docker-compose.yml` — 编排 postgres + backend

---

## 一、前置

- 安装 **Docker Desktop**(Windows/Mac)或 Docker Engine + Compose 插件(Linux)
- 命令用 `docker compose`(v2);旧版是 `docker-compose`

---

## 二、首次启动(三步)

```bash
cd Toonflow-Backend

# 0. 准备 .env(compose 现在从 .env 读取 PG_*/JWT/TOS,缺它无法启动)
cp .env.production.example .env
# 编辑 .env,至少填 PG_PASSWORD 与 JWT_SECRET

# 1. 构建并后台启动 postgres + backend(backend 启动时自动跑 migration 建表)
docker compose up -d --build

# 2. 灌入种子数据(仅首次执行一次;seed 会清空并重写配置表,勿重复跑)
docker compose exec backend npm run seed

# 3. 验证
curl http://localhost:4000/healthz       # 期望 200
```

启动后:
- 后端:`http://localhost:4000`
- PostgreSQL:仅 docker 内部网络可达(不再对外暴露 5432);账号/库名按 `.env` 中的 `PG_USER`/`PG_DATABASE`
- 默认登录账号:**admin / admin123**

> 部署到生产 Linux 云服务器请直接看 `docs/linux-deploy.md`(用 `./deploy.sh` 一键部署)。

---

## 三、连接桌面客户端

容器跑起来后,在本机(非容器)启动 Electron 客户端,指向容器后端:

PowerShell:
```powershell
cd D:\path\to\Toonflow-app
$env:TOONFLOW_BACKEND_URL = "http://localhost:4000"
$env:JWT_SECRET           = "你的强随机密钥"  # 必须与 .env 中的 JWT_SECRET 一致
npm run dev:gui
```

> `JWT_SECRET` 必须与 `.env` 里的值完全一致,否则客户端验签会拒绝 token。

---

## 四、常用命令

```bash
docker compose logs -f backend      # 看后端日志
docker compose logs -f postgres     # 看数据库日志
docker compose ps                   # 查看状态
docker compose restart backend      # 重启后端
docker compose down                 # 停止并删除容器(数据卷保留)
docker compose down -v              # 连数据卷一起删(清库,慎用)

docker compose exec backend npm run migrate           # 手动跑迁移
docker compose exec backend npm run migrate:rollback   # 回滚最近一批迁移
docker compose exec postgres psql -U toonflow -d toonflow   # 进 psql
```

---

## 五、配置真实 TOS / 自定义密钥

所有环境变量(`PG_*` / `JWT_SECRET` / `TOS_*`)都从 `Toonflow-Backend/.env` 读取(compose 自动加载)。从模板复制后编辑:

```bash
cp .env.production.example .env
```

```env
PG_PASSWORD=你的数据库密码
JWT_SECRET=你的强随机密钥
TOS_ACCESS_KEY_ID=你的火山引擎AK
TOS_SECRET_ACCESS_KEY=你的火山引擎SK
TOS_ENDPOINT=tos-cn-shanghai.volces.com
TOS_REGION=cn-shanghai
TOS_BUCKET=toonflow-service
```

> 该 `.env` 已在 `.gitignore` / `.dockerignore` 中,不会进镜像或仓库。改动后 `docker compose up -d` 重新生效。

---

## 六、说明与注意

- **migration 幂等**:backend 容器每次启动都会跑 `migrate`,knex 用迁移记录表去重,已应用的不会重复执行,安全。
- **seed 非幂等**:`seed` 会先 `del()` 配置表再插入,**只在首次执行一次**,不要放进自动启动流程,否则每次重启都会重置配置表。
- **镜像用 ts-node 直接跑 .ts**:因为 `knexfile.ts`/migrations 是 TypeScript,容器安装了 devDeps 并用 `ts-node --transpile-only` 启动,无需预编译。若要更小的生产镜像,可改为 `npm run build` 产出 `dist/` 后用 `node dist/index.js`(需同时把 migrations 编译进去)。
- **客户端为何不进 Docker**:Electron 是桌面 GUI,容器内无显示环境;它的定位就是装在用户机器上的应用。Docker 只承载它依赖的云端服务。
- **生产部署**:对外暴露请加反向代理 + HTTPS(避免 JWT 明文传输),并务必覆盖 `JWT_SECRET` 与数据库密码。
