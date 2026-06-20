import { Router, Request, Response } from "express";
import { requireAuth } from "../auth/middleware";
import { signPut, signGet, deleteObject, deletePrefix } from "../tos";

/**
 * TOS 预签名路由。
 *
 * - POST /api/tos/sign   { op: "put"|"get"|"delete", key, contentType?, expires? }
 *   - put / get：返回 { url, key, expires }，客户端直接对该 url 发 PUT/GET
 *   - delete：服务端用 SDK 调 deleteObject，不返回 url
 *
 * 鉴权：复用 Stream D 的 requireAuth（JWT），失败 4001。
 * 参数错误 4004，TOS 调用失败 5001。
 *
 * key 规范见 docs/tos-migration.md。
 * TODO(Stream D): 当前所有用户共享 TOS bucket；后续可按 req.user.id 强制 key 前缀。
 */

const router = Router();

const KEY_MAX_LEN = 1024;

function isValidKey(key: unknown): key is string {
  if (typeof key !== "string") return false;
  if (key.length === 0 || key.length > KEY_MAX_LEN) return false;
  // 防路径穿越
  if (key.includes("..")) return false;
  if (key.startsWith("/")) return false;
  return true;
}

router.post("/sign", requireAuth, async (req: Request, res: Response) => {
  const { op, key, contentType, expires } = req.body || {};

  if (op !== "put" && op !== "get" && op !== "delete" && op !== "deletePrefix") {
    return res.status(400).json({ code: 4004, message: "op 必须是 put/get/delete/deletePrefix", data: null });
  }
  if (!isValidKey(key)) {
    return res.status(400).json({ code: 4004, message: "key 非法", data: null });
  }

  const exp = typeof expires === "number" && expires > 0 && expires <= 7 * 24 * 3600 ? expires : 3600;

  try {
    if (op === "delete") {
      await deleteObject(key);
      return res.status(200).json({ code: 0, message: "ok", data: { key } });
    }
    if (op === "deletePrefix") {
      const n = await deletePrefix(key);
      return res.status(200).json({ code: 0, message: "ok", data: { key, deleted: n } });
    }

    const url =
      op === "put"
        ? signPut(key, typeof contentType === "string" ? contentType : undefined, exp)
        : signGet(key, exp);

    return res.status(200).json({ code: 0, message: "ok", data: { url, key, expires: exp } });
  } catch (e: any) {
    console.error("[tos] sign failed:", e?.message || e);
    return res.status(500).json({
      code: 5001,
      message: "TOS 签名失败",
      data: { detail: String(e?.message || e) },
    });
  }
});

export default router;
