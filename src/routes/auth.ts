import { Router, Request, Response } from "express";
import knex from "../db";
import { signToken } from "../auth/jwt";

const router = Router();

/**
 * POST /api/auth/login
 *
 * Stream D 实现。移植自 Toonflow-app/src/routes/login/login.ts:26-41。
 *
 * 哈希策略：原桌面端逻辑直接 `data.password == password` 明文对比（未做哈希），
 * 这里**原样移植**，不做改动。如需引入 bcrypt 等，是后续独立任务。
 */
router.post("/login", async (req: Request, res: Response) => {
  const { name, password } = req.body || {};
  if (typeof name !== "string" || typeof password !== "string") {
    return res.status(400).json({ code: 4011, message: "用户名或密码错误", data: null });
  }

  const user = await knex("o_user").where({ name, password }).first();
  if (!user) {
    return res.status(400).json({ code: 4011, message: "用户名或密码错误", data: null });
  }

  const token = signToken({ id: Number(user.id), name: user.name });
  return res.status(200).json({
    code: 0,
    message: "登录成功",
    data: {
      token,
      user: { id: Number(user.id), name: user.name },
    },
  });
});

export default router;
