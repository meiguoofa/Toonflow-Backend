// /api/ai/{image,video,audio} 路由。
// 契约见 docs/ai-proxy-protocol.md。
// 中央错误码：4002 vendor 不在白名单 / 4003 参数错误 / 4011 vendor 未启用或缺凭据 /
// 5001 厂商最终失败（重试后仍报错） / 5002 后端内部错误。

import { Router } from "express";
import { runImage, runVideo, runAudio } from "../ai";

const router: Router = Router();

function badRequest(res: any, message: string) {
  return res.status(400).json({ code: 4003, message, data: null });
}

function makeHandler(kind: "image" | "video" | "audio") {
  return async (req: any, res: any) => {
    const { vendorId, model, config } = req.body || {};

    if (typeof vendorId !== "string" || !vendorId) {
      return badRequest(res, "vendorId 必填且为字符串");
    }
    if (!model || (typeof model !== "string" && typeof model !== "object")) {
      return badRequest(res, "model 必填，需为字符串或对象");
    }
    if (config == null || typeof config !== "object") {
      return badRequest(res, "config 必填且为对象");
    }

    try {
      const runner = kind === "image" ? runImage : kind === "video" ? runVideo : runAudio;
      const result = await runner(vendorId, model, config);
      return res.json({ code: 0, message: "ok", data: { result } });
    } catch (err: any) {
      const code = Number(err?.code ?? 0);
      // 中央调度抛出的业务错误：4002/4003/4011/5002
      if (code === 4002 || code === 4011) {
        const status = code === 4002 ? 400 : 403;
        return res.status(status).json({ code, message: err.message, data: null });
      }
      if (code === 5002) {
        return res.status(500).json({ code: 5002, message: err.message, data: null });
      }
      // 其它（包含 retry 耗尽后的 vendor 原文错误、HTTP 4xx/5xx）一律视作厂商最终失败
      console.warn(`[ai] vendor failure kind=${kind} vendorId=${vendorId}:`, err?.message);
      return res
        .status(502)
        .json({ code: 5001, message: String(err?.message || err), data: null });
    }
  };
}

router.post("/image", makeHandler("image"));
router.post("/video", makeHandler("video"));
router.post("/audio", makeHandler("audio"));

export default router;
