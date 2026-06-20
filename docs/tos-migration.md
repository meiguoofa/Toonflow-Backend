# TOS 存储迁移说明

桌面端原本把图片/视频/音频写在 `data/oss/` 本地目录，由 Express 静态目录 `/oss` 暴露。
SaaS 化迁移后改为火山引擎 TOS（对象存储），客户端通过后端 `/api/tos/sign` 拿
预签名 URL 完成上传/下载，凭据只留在后端。

## 1. Key 命名规范

DB 中 `o_image.filePath` / `o_storyboard.filePath` / `o_video.filePath` 等字段都
存对象 **key**（不带前导 `/`、不带 `/oss/` 前缀）。

| 来源 | 旧本地路径 | 新 TOS key |
| --- | --- | --- |
| 上传素材 | `/123/assets/abc.png` | `123/assets/abc.png` |
| 图片流 | `/123/imageFlow/45/xxx.png` | `123/imageFlow/45/xxx.png` |
| 美术风格 | `/artStyle/{uuid}.png` | `artStyle/{uuid}.png` |

> 旧字段中的前导 `/` 在客户端 `oss.toKey()` 里会自动去掉，
> 因此**存量字段无需立刻迁移**，可在升级窗口期内先跑数据迁移再批量改库。
>
> 推荐 key 规范：`{userId}/{projectId}/{type}/{uuid}.{ext}`。
> 本期（Stream C）保持现有 `{projectId}/...` 结构以避免改动 80+ 处调用点；
> 后续 Stream 引入多租户隔离时再统一加 `{userId}/` 前缀。

## 2. 存量本地文件迁移

提供脚本骨架：`Toonflow-Backend/scripts/migrate-oss-to-tos.ts`。

```bash
# 在持有 TOS 凭据 + 旧 data 目录的运维机上跑
TOS_ACCESS_KEY_ID=xxx TOS_SECRET_ACCESS_KEY=xxx \
TOS_BUCKET=toonflow-service TOS_REGION=cn-shanghai \
TOS_ENDPOINT=tos-cn-shanghai.volces.com \
ts-node scripts/migrate-oss-to-tos.ts /path/to/data/oss
```

行为：
- 递归遍历本地 oss 目录，跳过 `smallImage/`（旧本地缩略图缓存，不上传）。
- 对每个文件 PUT 到 TOS，key = 相对路径（posix 分隔符）。
- 已存在则 HEAD 跳过；输出 `migration-report.csv`。
- **不会**修改 DB——`o_*.filePath` 字段去掉前导 `/oss/` 的迁移由独立 SQL 完成。

DB 字段一次性更新示例（建议在桌面端不再写新数据后执行）：

```sql
-- 把所有 filePath 字段去掉 `/oss/` 或 `/` 前缀（幂等：无前缀直接跳过）
UPDATE o_image
   SET "filePath" = regexp_replace("filePath", '^/+(oss/)?', '')
 WHERE "filePath" LIKE '/%';
-- 同样适用于 o_storyboard、o_video、o_assets 等
```

> 客户端 `utils/oss.ts` 的 `toKey()` 已对前导 `/` 容错，所以上述 SQL 是
> 锦上添花，不强制。

## 3. `/oss/*` 兼容路由

桌面端 `Toonflow-app/src/app.ts` 保留 `app.get("/oss/*")`，行为：
- 把 path 后缀作为 TOS key
- 调 `oss.getFileUrl()` 拿到签名 GET URL
- `res.redirect(302, url)`

存量 DB 字段（含 `/oss/...`）与外部已落地的链接仍能访问。
**不要直接删除该路由**——观测周期内（建议 ≥ 一个月）确认没有访问后再下线。

## 4. 鉴权

`POST /api/tos/sign` 走 Stream D 的 `requireAuth` 中间件：
- header `Authorization: Bearer <jwt>` 或 query `?token=xx`
- 失败返回 `{ code: 4001 }`

请求体：

```json
{ "op": "put" | "get" | "delete" | "deletePrefix",
  "key": "123/assets/abc.png",
  "contentType": "image/png",   // 可选，仅 put 用
  "expires": 3600 }              // 可选，秒，默认 3600，最大 7d
```

错误码：
- `4001` 鉴权失败
- `4004` 参数非法（op/key 校验失败）
- `5001` TOS 调用失败

## 5. 多租户隔离（待办）

当前 `op=put` 的 key 没有强制按 `req.user.id` 加前缀。下一阶段 Stream D
统一鉴权时，建议在路由内强制 `key.startsWith(\`\${req.user.id}/\`)`，
或自动注入 `userId/` 前缀，防止越权读写。
