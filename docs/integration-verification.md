# 集成验证清单（Stream E）

## 概述

本文档汇总 SaaS 化迁移完成后的最终验证步骤，需在具备**真实云端 PostgreSQL 与火山引擎 TOS 凭据**的环境中执行。所有 Stream A–D 已完成代码改动，Stream E 仅做收口与端到端验证。

---

## 1. 环境准备

### 1.1 后端 `.env`

复制 `Toonflow-Backend/.env.example` → `Toonflow-Backend/.env`，填入：

```env
PG_HOST=<云端 pg 地址>
PG_PORT=5432
PG_USER=<用户名>
PG_PASSWORD=<密码>
PG_DATABASE=toonflow
JWT_SECRET=<至少 32 位随机字符串>
PORT=4000

TOS_ACCESS_KEY_ID=<火山引擎 Access Key ID,见项目根 .env.example>
TOS_SECRET_ACCESS_KEY=<火山引擎 Secret Access Key,见项目根 .env.example>
TOS_ENDPOINT=tos-cn-shanghai.volces.com
TOS_REGION=cn-shanghai
TOS_BUCKET=toonflow-service
```

### 1.2 客户端 `.env`（或环境变量）

```env
TOONFLOW_BACKEND_URL=http://localhost:4000   # 或部署后的真实地址
JWT_SECRET=<必须与后端相同>                   # 共享 secret
```

---

## 2. 后端启动 + 类型检查

```bash
cd /root/short-drama-project/Toonflow-Backend
yarn install
npx tsc --noEmit                # 期望 0 错（Stream A/B/C/D 验证已 0 错）
yarn migrate                    # 跑 0001_init.ts 建 26 张表
yarn seed                       # 跑 0001_default.ts 插入 admin 用户、agentDeploy、setting、prompt、vendorConfig、skillList
yarn dev                        # 启动 Express，监听 PORT
```

### 验证点

- [ ] 26 张表在 pg 中存在（`\dt` 列出）
- [ ] 业务表的 `userId` 列存在且默认值为 1：
  ```sql
  \d o_project   -- 应有 userId BIGINT NOT NULL DEFAULT 1
  \d o_novel
  \d o_script
  \d o_assets
  \d o_image
  \d o_storyboard
  \d o_video
  \d o_videoTrack
  \d memories
  ```
- [ ] 配置表（`o_setting`/`o_vendorConfig`/`o_modelPrompt`/`o_skillList`/`o_skillAttribution`/`o_agentDeploy`/`o_prompt`/`o_user`）**没有** `userId` 列
- [ ] `SELECT * FROM o_prompt` 4 条数据，`videoPromptGeneration` 内容长度 > 8000 字符（完整 prompt 已落库）
- [ ] `SELECT * FROM o_user` 1 条，name=admin，password=admin123
- [ ] `/healthz` 返回 200

---

## 3. 后端单元 smoke

```bash
# 运行 Stream B 写的 db 协议 smoke
npx ts-node scripts/smoke-db.ts

# 运行 Stream C 写的 TOS smoke（需联网到 TOS）
npx ts-node scripts/smoke-tos.ts

# 运行 Stream D 写的 auth smoke
npx ts-node scripts/smoke-auth.ts
```

### 验证点

- [ ] smoke-auth：admin/admin123 登录返回 token
- [ ] smoke-db：缺 token → 4001；错 table → 4002；错 method → 4003；正常 SELECT → 数据；业务表 INSERT 自动补 `userId=1`；业务表 SELECT 自动加 `where userId=1`
- [ ] smoke-tos：put 签名 → 上传 → get 签名 → 下载 → sha256 一致 → delete 清理

---

## 4. 客户端启动 + 类型检查

```bash
cd /root/short-drama-project/Toonflow-app
yarn install
npx tsc --noEmit                # 期望 0 错
# 删除本地 SQLite，确认完全下线
rm -f data/db2.sqlite
# 启动桌面端
yarn dev
```

### 验证点

- [ ] 启动日志中**不再**出现 "数据库目录:" / "initDB" / "fixDB" 字样（Stream B 已移除这些副作用）
- [ ] 浏览器/Electron UI 打开后能进入登录页
- [ ] admin/admin123 登录成功，进入主界面

---

## 5. 端到端业务回归

按以下顺序执行，每步验证 DB 中相应表写入了 `userId=1` 数据：

| 步骤 | 操作 | 受影响表 | 关键文件 |
| --- | --- | --- | --- |
| 5.1 | 登录 admin | `o_user`（读） | `routes/login/login.ts` (转发) |
| 5.2 | 创建 project | `o_project` | `routes/project/addProject.ts` |
| 5.3 | 录入小说 | `o_novel` | `routes/novel/*` |
| 5.4 | 提取事件 | `o_event`、`o_eventChapter` | `routes/novel/event/*`，重点 `getEvent.ts`（已重写为 2 段查询，无 `db.raw` / GROUP_CONCAT） |
| 5.5 | 拆剧本 | `o_script`、`o_scriptAssets` | `routes/script/*`，重点 `script/extractAssets.ts` (15 calls) |
| 5.6 | 生成资产 | `o_assets`、`o_image` | `routes/assets/*`，`routes/cornerScape/getAllAssets.ts`（已重写：JS 端按 type 排序代替 orderByRaw） |
| 5.7 | 生成分镜 | `o_storyboard`、`o_assets2Storyboard` | `routes/production/storyboard/*`，重点 `batchGenerateImage.ts` (11 calls)，`getStoryboardData.ts`（已重写，去 modify） |
| 5.8 | 上传图/合成视频 | `o_image`、`o_video`、`o_videoTrack`、`o_imageFlow` | TOS 上传链路；`routes/assets/uploadClip.ts`、`routes/production/editImage/uploadImage.ts` |
| 5.9 | 删除 project | 17 张表级联清空 | `routes/project/delProject.ts` (17 DB calls) |

### 验证点

- [ ] 每张业务表的 `userId` 列实际值=1（通过 `psql -c "SELECT userId, count(*) FROM o_assets GROUP BY userId"`）
- [ ] TOS 控制台中能看到上传的 key（建议格式 `{projectId}/assets/{uuid}.ext`）
- [ ] DB 中 `o_image.filePath` / `o_storyboard.filePath` / `o_video.filePath` 存的是 TOS key（不再是 `/oss/...` 前缀）
- [ ] 浏览器访问旧 `/oss/<key>` 路径能 302 跳转到 TOS 预签名 URL（兼容期）
- [ ] 删 project 后所有关联业务表行被清空

---

## 6. 已知功能下线（预期行为）

以下 6 个 SQLite 时代的"DB 管理"路由在 SaaS 化后由云端 DBA 接管，客户端调用返回 HTTP 410：

| 路由 | 文件 |
| --- | --- |
| `GET /api/setting/dbConfig/dbInfo` | `routes/setting/dbConfig/dbInfo.ts` |
| `POST /api/setting/dbConfig/clearTable` | `routes/setting/dbConfig/clearTable.ts` |
| `GET /api/setting/dbConfig/clearData` | `routes/setting/dbConfig/clearData.ts` |
| `GET /api/setting/dbConfig/exportData` | `routes/setting/dbConfig/exportData.ts` |
| `POST /api/setting/dbConfig/importData` | `routes/setting/dbConfig/importData.ts` |
| `POST /api/other/deleteAllData` | `routes/other/deleteAllData.ts` |

**前端 UI**：建议在「设置 → 数据库管理」页面隐藏这些入口，或显示"本功能已迁移至云端管理后台"提示。

### 验证点

- [ ] 调用上述任一路由返回 410 + `{code:400, message:"该功能已迁移至云端管理后台"}`

---

## 7. 已知遗留事项（不在本期范围）

1. **`src/utils/getConfig.ts:42` 引用不存在的表 `t_config`**：baseline 孤儿代码，Stream B 与 Stream E 复核确认与本次迁移无关。如需清理，建议另起 issue。
2. **多租户运行时强制隔离**：当前后端 `routes/db.ts` 已对业务表实现透明 `userId` 注入，但默认 `userId=1` 单用户。要正式开启多租户，仅需：
   - 启用用户注册路由（新增 `routes/auth/register.ts`）
   - 业务表 `userId` DEFAULT 改为 NULL，强制 INSERT 时由代理注入
   - 配置表（vendor/prompt/skill）做"系统默认 + 用户覆盖"分层
3. **`memories.embedding`**：当前为 TEXT，未来如需向量检索可启用 `pgvector` 扩展并改列类型为 `vector(384)`。
4. **TOS 旧路径迁移**：`/oss/*` 302 转发为兼容期方案，建议观测 1 个月后下线，并执行 `scripts/migrate-oss-to-tos.ts` 把存量本地媒体迁到 TOS。
5. **桌面端 Express 鉴权**：`Toonflow-app/src/app.ts` 的 JWT 中间件仅做透明验签（共享 secret）。后期可下放给云端后端并完全去掉本地中间件。

---

## 8. 部署清单

- [ ] 云端 PostgreSQL（建议 RDS 14+，至少 2 vCPU / 4GB RAM，10GB SSD）
- [ ] 后端运行环境（Node 18+，至少 1 vCPU / 1GB RAM）
- [ ] 反向代理 + HTTPS（避免 JWT 明文暴露）
- [ ] TOS 桶 `toonflow-service` 已创建并配置好 CORS（允许 PUT/GET 来自客户端域）
- [ ] 后端 `.env` 已就位且 `JWT_SECRET` 与客户端共享
- [ ] 客户端打包时把 `TOONFLOW_BACKEND_URL` 注入构建变量
