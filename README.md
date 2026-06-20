# Toonflow Backend

Toonflow SaaS 化迁移的后端骨架。**仅做三件事**：

1. **DB 查询代理** — `POST /api/db/query` 接收桌面端 Knex 链式调用 JSON，转发到云端 PostgreSQL
2. **JWT 鉴权** — `POST /api/auth/login` 返回 token，后续请求带 `Authorization: Bearer <token>`
3. **TOS 预签名** — `POST /api/tos/sign` 给桌面端发回火山引擎 TOS 直传 URL

业务逻辑（agent / socket / AI 调用）全部保留在桌面端 `Toonflow-app`。

---

## 启动

```bash
cp .env.example .env       # 填入 PG_*、TOS_* 等
yarn install               # 或 npm install
yarn migrate               # 建 26 张表
yarn seed                  # 写默认 vendor/agentDeploy/setting/skillList 等
yarn dev                   # 起本地开发服务（默认 :4000）
```

生产构建：

```bash
yarn build
node dist/src/index.js
```

---

## 路由

| Method | Path                | 说明                          | 实现归属  |
| ------ | ------------------- | ----------------------------- | --------- |
| GET    | `/healthz`          | 健康检查                      | Stream A  |
| POST   | `/api/auth/login`   | 用户登录，返回 JWT            | Stream D  |
| POST   | `/api/db/query`     | Knex 链式调用代理 → PostgreSQL | Stream B  |
| POST   | `/api/tos/sign`     | 火山 TOS 预签名 URL            | Stream C  |

DB 代理协议详见 [`docs/db-proxy-protocol.md`](./docs/db-proxy-protocol.md)。

---

## 环境变量

| 变量 | 用途 |
| ---- | ---- |
| `PG_HOST` / `PG_PORT` / `PG_USER` / `PG_PASSWORD` / `PG_DATABASE` | 云端 PostgreSQL 连接 |
| `PORT` | HTTP 监听端口（默认 4000） |
| `JWT_SECRET` | JWT 签发密钥；为空时回退到 `o_setting.tokenKey` |
| `TOS_ACCESS_KEY_ID` / `TOS_SECRET_ACCESS_KEY` | 火山 TOS 凭证 |
| `TOS_ENDPOINT` | 默认 `tos-cn-shanghai.volces.com` |
| `TOS_REGION` | 默认 `cn-shanghai` |
| `TOS_BUCKET` | 默认 `toonflow-service` |

---

## Schema 迁移要点

来源：`Toonflow-app/src/lib/initDB.ts`（SQLite + Knex 26 张表）。

### 类型适配决策

| 原 SQLite | 新 PostgreSQL | 原因 |
| --------- | ------------- | ---- |
| `integer id`（无 autoIncrement）| `BIGINT PRIMARY KEY` | 桌面端代码自行分配 id（避免改动桌面端逻辑） |
| `text`（含 JSON 字符串） | `TEXT` | 桌面端通过 `JSON.stringify/parse` 操作；改 `jsonb` 会破坏字符串语义 |
| `boolean` | `BOOLEAN` | pg 原生支持 |
| `integer createTime/updateTime` | `BIGINT` | 保持毫秒时间戳，与桌面端代码一致 |
| `text id`（如 `o_skillList.id`、`memories.id`、`o_vendorConfig.id`） | `TEXT PRIMARY KEY` | 保持 hash/uuid 类标识 |

### 多租户铺垫

以下 17 张**业务表**已加 `userId BIGINT NOT NULL DEFAULT 1` + 单列索引 `idx_<table>_userId`：

```
o_novel, o_event, o_eventChapter, o_script, o_scriptAssets,
o_assets, o_image, o_storyboard, o_assets2Storyboard,
o_video, o_videoTrack, o_imageFlow, o_tasks, o_agentWorkData,
o_assetsRole2Audio, memories, o_artStyle
```

`o_project` 已有 `userId`，保留并新增索引。

以下**配置/全局表**不加 `userId`：

```
o_user, o_setting, o_vendorConfig, o_modelPrompt,
o_skillList, o_skillAttribution, o_agentDeploy, o_prompt
```

---

## 已知留待事项

- `o_skillList.embedding` seed 留空字符串：桌面端用本地 ONNX 模型对 description 做向量化，后端无此能力。生产环境由桌面端首次启动时回填，或独立 embedding 服务批量补齐。
- `o_prompt` 中 `videoPromptGeneration` prompt 内容极长（约 8000 字），seed 中保留简版占位；桌面端首次同步会以完整版覆盖。
- `o_assets.imageId` 外键引用 `o_image.id`，原 SQLite 中是 `unsigned references`。pg 中保留 references 但去掉 unsigned。

---

## 目录结构

```
Toonflow-Backend/
├── src/
│   ├── index.ts          # express bootstrap
│   ├── db.ts             # knex(pg) 单例
│   └── routes/
│       ├── auth.ts       # Stream D 接管
│       ├── db.ts         # Stream B 接管
│       └── tos.ts        # Stream C 接管
├── migrations/0001_init.ts
├── seeds/0001_default.ts
├── docs/db-proxy-protocol.md
├── knexfile.ts
├── tsconfig.json
├── package.json
└── .env.example
```
