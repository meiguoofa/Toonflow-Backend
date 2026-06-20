# JWT Secret 同步

Toonflow SaaS 化后，云端后端是**唯一签发方**，桌面端 Toonflow-app 仅做透明验签。两边必须使用**完全一致**的 `JWT_SECRET`，否则桌面端内嵌 Express 的中间件会把云端签发的 token 全部当作无效。

## 后端

`Toonflow-Backend/.env` 必须设置：

```
JWT_SECRET=<生产环境随机长字符串>
JWT_EXPIRES_IN=7d   # 可选，默认 7d
```

启动时若未设置 `JWT_SECRET`，进程会立即抛错退出（见 `src/auth/jwt.ts`）。

`seeds/0001_default.ts` 中 `o_setting.tokenKey` 默认会读 `process.env.JWT_SECRET`，与运行时 secret 同源——**不要单独修改 tokenKey**。

## 桌面端 (Toonflow-app)

桌面端通过环境变量获取同一份 secret，注入到客户端 Express 的 JWT 中间件：

```
JWT_SECRET=<必须与后端完全一致>
TOONFLOW_BACKEND_URL=http://your-backend.example.com   # 登录请求转发地址
```

桌面端读取顺序（`src/utils/auth.ts`）：

1. `process.env.JWT_SECRET`（推荐，部署时由配置注入）
2. 兜底：`o_setting.tokenKey`（与后端 seed 同源，迁移期保持兼容）

## 同步流程（一次性 / 升级时）

1. 在生产环境生成一份足够长的随机字符串（建议 ≥ 32 字节 hex）
2. 同时写入：
   - 后端 `.env` 的 `JWT_SECRET`
   - 桌面端打包配置 / 部署脚本里的 `JWT_SECRET`
3. 后端首次 `yarn seed` 会把它写入 `o_setting.tokenKey`
4. 重启后端、重启桌面端

## 后期演进 (TODO)

桌面端内嵌 Express 中间件目前是"透明验签层"，长期应考虑把所有 `/api/*` 路由也下放到云端后端，桌面端只保留静态资源 / Socket / Agents 等真正本地的逻辑。届时桌面端可彻底不感知 `JWT_SECRET`。
