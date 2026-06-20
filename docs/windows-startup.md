# Windows 本地启动指南

在 Windows 上同时启动服务端(Toonflow-Backend)与客户端(Toonflow-app)的完整步骤。

> 注意:并行开发遗留了一个环境变量命名不一致问题——`db.ts`/`oss.ts` 读取 `BACKEND_URL`,而 `login.ts` 读取 `TOONFLOW_BACKEND_URL`。下面的脚本同时设置两个变量以规避该问题,详见文末「关于环境变量名不一致」。

---

## 前置条件

- **Node.js 18+**(含 npm、npx)
- **PostgreSQL**(本机安装、Docker 或云端均可),拿到 host/port/user/password
- 已分别 clone 两个仓库:`Toonflow-Backend` 和 `Toonflow-app`

---

## 一、启动服务端(Toonflow-Backend)

### 1. 创建 `.env`(PowerShell)

```powershell
cd D:\path\to\Toonflow-Backend
@"
PG_HOST=localhost
PG_PORT=5432
PG_USER=postgres
PG_PASSWORD=你的密码
PG_DATABASE=toonflow
PORT=4000
JWT_SECRET=dev-shared-secret-please-change-32chars
TOS_ACCESS_KEY_ID=你的火山引擎AK
TOS_SECRET_ACCESS_KEY=你的火山引擎SK
TOS_ENDPOINT=tos-cn-shanghai.volces.com
TOS_REGION=cn-shanghai
TOS_BUCKET=toonflow-service
"@ | Out-File -FilePath .env -Encoding utf8
```

> 先在 PostgreSQL 里建好空库:`createdb toonflow` 或 `CREATE DATABASE toonflow;`

### 2. 安装 + 建表 + 种子 + 启动

```powershell
npm install --no-audit --no-fund
npm run migrate      # 建 26 张表
npm run seed         # 写入 admin 用户、prompt、vendor 等
npm run dev          # 启动,监听 http://localhost:4000
```

验证:浏览器或新窗口访问 `http://localhost:4000/healthz` 应返回 200。

---

## 二、启动客户端(Toonflow-app)

**新开一个终端窗口**(服务端那个保持运行)。

### 桌面 GUI 模式(完整 Electron 应用,推荐)

```powershell
cd D:\path\to\Toonflow-app
npm install --no-audit --no-fund --legacy-peer-deps

# 关键:两个后端地址变量都设,且 JWT_SECRET 必须与服务端一致
$env:BACKEND_URL          = "http://localhost:4000"
$env:TOONFLOW_BACKEND_URL = "http://localhost:4000"
$env:JWT_SECRET           = "dev-shared-secret-please-change-32chars"

npm run dev:gui      # 启动 Electron 桌面窗口
```

### 纯 API/无界面模式(只跑内嵌 Express,调试用)

```powershell
$env:BACKEND_URL          = "http://localhost:4000"
$env:TOONFLOW_BACKEND_URL = "http://localhost:4000"
$env:JWT_SECRET           = "dev-shared-secret-please-change-32chars"
npm run dev          # 内嵌 Express 跑在 http://localhost:10588
```

登录用种子默认账号:**admin / admin123**。

---

## CMD 版(若不用 PowerShell)

服务端 `.env` 用记事本手动创建即可,启动同上。客户端设环境变量:

```bat
cd /d D:\path\to\Toonflow-app
npm install --no-audit --no-fund --legacy-peer-deps
set BACKEND_URL=http://localhost:4000
set TOONFLOW_BACKEND_URL=http://localhost:4000
set JWT_SECRET=dev-shared-secret-please-change-32chars
npm run dev:gui
```

---

## 启动顺序与依赖关系

```
PostgreSQL 运行中
   └─> 服务端 npm run migrate + seed + dev (:4000)
          └─> 客户端 npm run dev:gui  (Electron → 内嵌 Express :10588 → 调用 :4000)
```

- 必须**先起服务端**再起客户端,否则客户端登录/取数会连接失败。
- `JWT_SECRET` 两端必须完全一致,否则客户端内嵌 Express 验签会拒绝云端签发的 token。
- 媒体上传(TOS)需要真实火山引擎 AK/SK;若暂时只想验证登录和数据流程,可先不填 TOS,但涉及图片/视频上传的功能会报错。

---

## 关于环境变量名不一致

`BACKEND_URL`(db/oss)与 `TOONFLOW_BACKEND_URL`(login)是并行开发遗留的命名不统一。上面脚本同时设两个可正常运行。后续建议把代码统一成单一变量名(例如都用 `TOONFLOW_BACKEND_URL`),统一后只需设一个变量。
