# DB 代理协议

> 后端 `POST /api/db/query` 的请求/响应契约。
> Stream B 据此实现；桌面端的 `Toonflow-app` 据此构造请求。

## 设计目标

桌面端代码大量使用 Knex 链式 API（`db("o_project").where({ id }).first()`）。SaaS 化后，桌面端不再直连 SQLite，而是把"链式调用"序列化成 JSON，通过 HTTP 发到后端，后端用云端 PostgreSQL Knex 实例**重放**这条链，把结果 JSON 化返回。

桌面端只需替换底层 Knex 实例为一个**代理对象**，使用方代码（agent / repository 等）零改动。

---

## 请求

### Endpoint

```
POST /api/db/query
Content-Type: application/json
Authorization: Bearer <jwt-token>
```

### Body

```jsonc
{
  "table": "o_project",                    // 必填，表名（白名单校验）
  "calls": [                                // 链式调用序列，按顺序 apply
    { "method": "where", "args": [{ "id": 123 }] },
    { "method": "select", "args": ["id", "name", "createTime"] }
  ],
  "terminal": { "method": "first", "args": [] }  // 终结调用（白名单校验）
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `table` | string | 是 | 表名，必须在 [表名白名单](#表名白名单) 中 |
| `calls` | `{ method, args }[]` | 否 | 链式调用序列。`method` 必须在 [中间方法白名单](#中间方法白名单) 中 |
| `terminal` | `{ method, args }` | 是 | 终结方法。必须在 [终结方法白名单](#终结方法白名单) 中 |

### Args 序列化规则

- 所有原始类型（string/number/boolean/null/array/plain object）原样 JSON 序列化
- **不允许**传递 `function`、`Date`、`Buffer`、`undefined` 等非 JSON 类型
- **嵌套子查询暂不支持**（v1）：`whereIn` 第二参数只能是数组字面量，不能是另一个 Knex 链
- `raw()` 调用**不接受**：v1 禁止透传 `knex.raw(sql, bindings)` 以避免 SQL 注入

---

## 响应

### 成功

```jsonc
{
  "code": 0,
  "message": "ok",
  "data": <任意 JSON>     // 终结方法的返回值（数组/对象/数字/null）
}
```

### 失败

```jsonc
{
  "code": <非 0 错误码>,
  "message": "<可读错误说明>",
  "data": null
}
```

| code | 含义 |
| ---- | ---- |
| `4001` | 未携带 token / token 无效（鉴权失败） |
| `4002` | 表名不在白名单 |
| `4003` | 方法不在白名单 |
| `4004` | 请求体格式错误（缺字段、类型错误） |
| `4005` | args 包含非法 JSON 类型 |
| `5000` | pg 内部错误（带 `message` 透传） |

### 多租户透明注入

后端在执行链之前，对 [需注入 userId 的表](../README.md#多租户铺垫) 自动追加：

```ts
queryBuilder = queryBuilder.where({ userId: <token 解析出的 userId> });
```

桌面端**不需要**主动传 userId。INSERT 时后端也自动补 `userId`。

---

## 表名白名单

完整 26 张表，按 [`migrations/0001_init.ts`](../migrations/0001_init.ts) 实际建表为准：

```
o_user, o_project, o_artStyle, o_agentDeploy, o_setting,
o_tasks, o_prompt, o_modelPrompt, o_novel, o_event,
o_eventChapter, o_script, o_image, o_assets, o_storyboard,
o_agentWorkData, o_video, o_videoTrack, o_vendorConfig, o_imageFlow,
o_assets2Storyboard, o_scriptAssets, o_skillList, o_skillAttribution,
memories, o_assetsRole2Audio
```

任何不在此列表内的表名 → `code: 4002`。

---

## 中间方法白名单

```
where, whereNot, whereIn, whereNotIn, whereNull, whereNotNull,
whereBetween, whereLike, whereILike, andWhere, orWhere,
select, distinct, columns,
join, leftJoin, rightJoin, innerJoin,
orderBy, groupBy, having,
limit, offset,
returning,
clone
```

不在此列表的方法 → `code: 4003`。

**禁用方法清单**（即使技术上 Knex 支持也禁止）：

```
raw, schema, transaction, fromRaw, joinRaw, whereRaw, orderByRaw, groupByRaw, havingRaw
```

---

## 终结方法白名单

```
first, find, count, countDistinct, min, max, sum, avg,
insert, update, del, delete, truncate,
pluck, then
```

桌面端目前实际使用的终结方法（来自代码扫描）：`first`、`select`、`insert`、`update`、`del`、`count`、`pluck`。其他保留兼容。

> 注意：`select` 既能作为中间方法（链入 .select(...)）也作为终结方法（不再 await 即触发查询）。Stream B 实现时建议把没有 `terminal` 字段、最后一个 `calls` 是 `select` 的请求**默认按终结处理**。

---

## 调用示例

### 示例 1：查询单条项目

桌面端原代码：

```ts
const project = await db("o_project").where({ id: 123 }).first();
```

代理请求：

```json
{
  "table": "o_project",
  "calls": [
    { "method": "where", "args": [{ "id": 123 }] }
  ],
  "terminal": { "method": "first", "args": [] }
}
```

响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": { "id": 123, "name": "测试项目", "userId": 7, "createTime": 1774447310118 }
}
```

### 示例 2：插入分镜

```ts
await db("o_storyboard").insert({ id: 1, scriptId: 100, prompt: "..." });
```

```json
{
  "table": "o_storyboard",
  "calls": [],
  "terminal": {
    "method": "insert",
    "args": [{ "id": 1, "scriptId": 100, "prompt": "..." }]
  }
}
```

后端自动补 `userId` 后实际执行：

```sql
INSERT INTO o_storyboard (id, scriptId, prompt, userId) VALUES (1, 100, '...', 7)
```

### 示例 3：批量按条件更新

```ts
await db("o_assets")
  .where({ projectId: 5 })
  .whereIn("type", ["role", "scene"])
  .update({ promptState: "done" });
```

```json
{
  "table": "o_assets",
  "calls": [
    { "method": "where", "args": [{ "projectId": 5 }] },
    { "method": "whereIn", "args": ["type", ["role", "scene"]] }
  ],
  "terminal": {
    "method": "update",
    "args": [{ "promptState": "done" }]
  }
}
```

后端自动追加 `where userId = <token-userId>`，更新返回受影响行数。

---

## 安全约束

1. **白名单优先**：表名、中间方法、终结方法**全部走白名单**，不在白名单一律 4xx 拒绝
2. **禁止 raw**：所有 `*Raw` 方法在 v1 全部禁用
3. **强制 userId 注入**：业务表的 SELECT/UPDATE/DELETE 必须带 `userId`；INSERT 自动补 `userId`
4. **token 必传**：除 `/api/auth/login` 外所有路由都要校验 token
5. **请求体大小限制**：建议 1MB，防止 args 中携带超大 payload

---

## 不在 v1 范围内（待 v2）

- 嵌套子查询（`whereIn(col, knex.from(...).select(...))`）
- 事务（`knex.transaction`）—— v1 单请求单 SQL，原桌面端的事务依赖待重构
- 复杂 join（v1 仅支持单表 + 简单 join）
- `knex.raw` 透传 SQL
- 流式查询 `stream()` / `pipe()`
- Postgres 扩展（窗口函数、CTE、jsonb 操作符等）

如桌面端代码触发未实现路径，应回 `code: 4003` + 明确说明，由桌面端方决定改写策略。
