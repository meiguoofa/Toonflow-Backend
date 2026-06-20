import jwt from "jsonwebtoken";

/**
 * 统一 JWT 签发 / 验签。Stream D 实现。
 *
 * - secret 来自 process.env.JWT_SECRET。
 *   启动时若未设置 throw —— 与 .env.example 中的占位区别开，避免线上误用空 secret。
 * - 过期时间来自 process.env.JWT_EXPIRES_IN（默认 "7d"），为兼容 jsonwebtoken 类型采用 string | number。
 * - 客户端 Toonflow-app 的 jwt 验签共享同一 JWT_SECRET，详见 docs/auth-secret.md。
 */

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("[auth] JWT_SECRET is not set; refusing to start");
}

const JWT_EXPIRES_IN: string = process.env.JWT_EXPIRES_IN || "7d";

export interface JwtPayload {
  id: number;
  name: string;
}

export function signToken(payload: JwtPayload): string {
  return (jwt.sign as any)(payload, JWT_SECRET as string, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET as string) as any;
    if (decoded && typeof decoded.id === "number" && typeof decoded.name === "string") {
      return { id: decoded.id, name: decoded.name };
    }
    return null;
  } catch {
    return null;
  }
}
