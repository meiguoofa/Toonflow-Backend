import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import authRouter from "./routes/auth";
import dbRouter from "./routes/db";
import tosRouter from "./routes/tos";
import aiRouter from "./routes/ai";
import { requireAuth } from "./auth/middleware";

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/healthz", (_req, res) => {
  res.json({ code: 0, message: "ok", data: { ts: Date.now() } });
});

// /api/auth/login 不挂 requireAuth（登录本身要拿 token）
app.use("/api/auth", authRouter);

// /api/db 与 /api/tos 统一挂 requireAuth。
// TODO(Stream B/C): 这两个 router 内若仍有临时 tempAuth 中间件，可在它们的代码里删除——
// 这里全局已经做了校验，重复验签虽然不出错但属于死代码。
app.use("/api/db", requireAuth, dbRouter);
app.use("/api/tos", requireAuth, tosRouter);
// /api/ai/* 调外部图片/视频/音频生成，全部要求 token；body 可能含大 base64，已在上面 express.json
// limit 设置为 10mb。
app.use("/api/ai", requireAuth, aiRouter);

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`[toonflow-backend] listening on :${port}`);
});

export default app;
