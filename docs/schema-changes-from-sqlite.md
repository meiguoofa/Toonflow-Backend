# 数据库表结构变更：SQLite → PostgreSQL（SaaS 化）

> 记录 SaaS 化迁移中，桌面端本地 SQLite 表结构（`Toonflow-app/src/lib/initDB.ts`）到云端 PostgreSQL（`migrations/0001_init.ts` 及后续）的结构差异。
> 表的**逻辑结构和数量未变（26 张）**，变化集中在：列类型严格化、主键不再自增、新增多租户 `userId`。

## 背景

| | 旧 | 新 |
|---|---|---|
| 引擎 | 本地 SQLite（better-sqlite3，单文件 `db2.sqlite`） | 云端 PostgreSQL |
| 访问方式 | 桌面端进程内直连 Knex | 桌面端经 HTTP 代理 `/api/db/query` 回放 Knex 调用（详见 `db-proxy-protocol.md`） |
| schema 来源 | `Toonflow-app/src/lib/initDB.ts`（每次启动 `initDB`/`fixDB`） | `Toonflow-Backend/migrations/`（`knex migrate:latest`） |

## 一、整数列类型：`integer` → `bigInteger`（最关键）

SQLite 的 `integer` 是动态类型，可存 64 位；PostgreSQL 的 `integer` 是 int4（上限 ~2.1×10⁹）。所有"会存大值"的列升级为 `bigInteger`(int8)：

| 列类别 | 旧(SQLite) | 新(PG) | 说明 |
|--------|-----------|--------|------|
| 主键 `id` | integer | **bigInteger** | id 多为 `Date.now()` 级（~1.7×10¹²） |
| 外键 id（projectId / scriptId / imageId / assetId / videoTrackId / eventId / novelId …） | integer | **bigInteger** | |
| 时间戳（createTime / updateTime / startTime / time） | integer | **bigInteger** | 毫秒时间戳 |
| userId | （基本没有） | **bigInteger** | 多租户字段 |

保持 `integer`(int4，小值) 的列：`temperature`、`maxOutputTokens`、各 `*State`（eventState/extractState/audioBindState）、`index`、`duration`、`enable`、`shouldGenerateImage`、`chapterIndex`、`summarized`、`o_skillList.state`。

## 二、主键策略：不再自动自增

- **旧**：`primary(["id"])` + `unique(["id"])`。SQLite 的 INTEGER PRIMARY KEY 会**自动 rowid 自增**，insert 不传 id 也能成功并返回新 id。
- **新**：`bigInteger("id").notNullable().primary()`，**不自增**。id 由应用层 / db proxy 生成；后端在 insert 时为缺 id 的 bigint-id 主键表注入生成的 id，并返回 id 数组以兼容前端 `const [id] = await db(t).insert(...)`。冗余的 `unique(["id"])` 已移除（primary 已含唯一约束）。

## 三、新增多租户 `userId`

- **旧**：仅 `o_project` 有 userId（无多租户语义）。
- **新**：**业务表统一新增 `userId BIGINT NOT NULL DEFAULT 1` + 单列索引**；配置/全局表不加。后端 db proxy 自动注入/过滤 userId（insert 补 userId、select/update/delete 加 `where "<table>".userId = ?`，并限定表名以避免 join 时列歧义）。

**不带 userId 的配置/全局表（8 张）**：`o_user`、`o_setting`、`o_vendorConfig`、`o_modelPrompt`、`o_skillList`、`o_skillAttribution`、`o_agentDeploy`、`o_prompt`。

**带 userId 的业务表（18 张）**：`o_project`、`o_artStyle`、`o_tasks`、`o_novel`、`o_event`、`o_eventChapter`、`o_script`、`o_scriptAssets`、`o_assets`、`o_image`、`o_storyboard`、`o_assets2Storyboard`、`o_agentWorkData`、`o_video`、`o_videoTrack`、`o_imageFlow`、`o_assetsRole2Audio`、`memories`。

## 四、其它类型与约束

- **`string` → `text`**：旧的 varchar 类字段（model/key/name/state/promptState 等）统一改为 `text`。
- **大 JSON 保持 `text`**（inputValues/models/embedding/data/flowData/relatedMessageIds 等），**不使用 jsonb**——避免破坏桌面端 `JSON.stringify/parse` 的字符串语义。
- **时间戳保持 BIGINT 毫秒**，不改 timestamptz。
- **boolean**（`o_agentDeploy.disabled`）保持 pg boolean，`DEFAULT false`。
- 主键类型三类：
  - bigInteger id（多数业务/配置表）
  - text id：`o_vendorConfig`、`o_skillList`、`memories`（id 由调用方提供）
  - 复合主键、无 id 列：`o_setting`(key)、`o_assets2Storyboard`、`o_scriptAssets`、`o_skillAttribution`、`o_assetsRole2Audio`

## 五、迁移历史

| migration | 内容 |
|-----------|------|
| `0001_init` | 初始化 26 张表（移植自 initDB.ts），完成上述全部适配 |
| `0002_assets2storyboard_seq` | `o_assets2Storyboard` 新增 `seq` bigserial 自增列，替代 SQLite 隐藏 `rowid`，保留"分镜关联资产的插入顺序" |
| `0003_o_video_time_bigint` | `o_video.time` 由 int4 改为 int8（初版漏改的时间戳列） |

## 六、由结构差异引发的行为差异（迁移注意事项）

| 差异 | 后果 | 应对 |
|------|------|------|
| PG int8 经 node-postgres 默认返回 **string** | id/时间戳变字符串，前端 `z.number()` 校验、数值比较失败 | 后端 `src/db.ts` 注册 `types.setTypeParser(20, parseInt)`，int8 统一返回 number |
| PG **强类型** | integer 列不能与字符串比较；大值超 int4 溢出 | 状态列用对应数值比较；时间戳列用 bigInteger |
| PG **GROUP BY 严格** | select 的非聚合列必须出现在 group by | 改写查询去掉多余列或聚合 |
| 主键不自增 | insert 缺 id 报 not-null；`const [id]` 拿不到值 | db proxy insert 注入 id 并返回 id 数组 |
| 无 `rowid` | `orderBy("rowid")` 报列不存在 | 改 `orderBy("seq")`（见 0002） |
| db proxy JSON 序列化 | 函数参数（`.where((qb)=>…)` 回调）无法传递 | 改为命令式条件累加；`db.raw`/事务/子查询不支持 |

## 七、应用迁移

```bash
cd Toonflow-Backend
npm run migrate          # knex migrate:latest，幂等，仅执行未跑过的迁移
```

每个环境（开发/测试/生产）各自的 PostgreSQL 库都需执行一次；knex 通过 `knex_migrations` 表记录已执行的迁移，重复执行会跳过。
