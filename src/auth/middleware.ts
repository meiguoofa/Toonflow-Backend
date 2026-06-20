import { Request, Response, NextFunction } from "express";
import { verifyToken } from "./jwt";

/**
 * 统一鉴权中间件。Stream D 实现。
 *
 * - 从 `Authorization: Bearer xxx` header 或 `?token=xxx` query 提取 token
 * - 验签失败返回 4001（客户端语义：token 无效/过期，需要重新登录）
 * - 验签成功后注入 req.user，下游路由可直接使用
 *
 * 参考来源：Toonflow-app/src/app.ts:152-170（桌面端原 JWT 中间件）
 */

declare module "express-serve-static-core" {
  interface Request {
    user?: { id: number; name: string };
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const rawHeader = req.headers.authorization || (req.query.token as string) || "";
  const token = String(rawHeader).replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return res.status(401).json({ code: 4001, message: "未提供 token", data: null });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ code: 4001, message: "token 无效或已过期", data: null });
  }

  req.user = payload;
  next();
}
