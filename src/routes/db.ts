import { Router, Request, Response } from "express";
import express from "express";
import knex from "../db";
import { requireAuth } from "../auth/middleware";

// ===========================================================================
// 协议详见 docs/db-proxy-protocol.md
// 实现 POST /api/db/query：把客户端记录的 Knex 链式调用回放到云端 pg。
// 三层白名单：表名 / 中间方法 / 终结方法。
// 业务表自动注入 userId（多租户）。
// ===========================================================================

const router = Router();

// 路由级请求体大小限制（保险，index.ts 已经设了 10mb；这里收紧到 1mb）。
router.use(express.json({ limit: "1mb" }));

// ---- 表白名单（26 张） --------------------------------------------------
const TABLE_WHITELIST = new Set<string>([
  "o_user", "o_project", "o_artStyle", "o_agentDeploy", "o_setting",
  "o_tasks", "o_prompt", "o_modelPrompt", "o_novel", "o_event",
  "o_eventChapter", "o_script", "o_image", "o_assets", "o_storyboard",
  "o_agentWorkData", "o_video", "o_videoTrack", "o_vendorConfig", "o_imageFlow",
  "o_assets2Storyboard", "o_scriptAssets", "o_skillList", "o_skillAttribution",
  "memories", "o_assetsRole2Audio",
]);

// ---- 业务表（需要 userId 注入）-----------------------------------------
// 来源：migrations/0001_init.ts BUSINESS_TABLES_WITH_USER_ID + o_project（自带 userId）
const BUSINESS_TABLES = new Set<string>([
  "o_project",
  "o_novel",
  "o_event",
  "o_eventChapter",
  "o_script",
  "o_scriptAssets",
  "o_assets",
  "o_image",
  "o_storyboard",
  "o_assets2Storyboard",
  "o_video",
  "o_videoTrack",
  "o_imageFlow",
  "o_tasks",
  "o_agentWorkData",
  "o_assetsRole2Audio",
  "memories",
  "o_artStyle",
]);

// ---- 中间方法白名单 ------------------------------------------------------
const INTERMEDIATE_METHODS = new Set<string>([
  "where", "whereNot", "whereIn", "whereNotIn", "whereNull", "whereNotNull",
  "whereBetween", "whereLike", "whereILike", "andWhere", "orWhere",
  "select", "distinct", "columns",
  "join", "leftJoin", "rightJoin", "innerJoin",
  "orderBy", "groupBy", "having",
  "limit", "offset",
  "returning",
  "clone",
]);

// ---- 终结方法白名单 ------------------------------------------------------
const TERMINAL_METHODS = new Set<string>([
  "first", "find", "count", "countDistinct", "min", "max", "sum", "avg",
  "insert", "update", "del", "delete", "truncate",
  "pluck", "then",
  "select", // select 既可中间也可终结
]);

// ---- 错误响应工具 --------------------------------------------------------
function fail(res: Response, code: number, message: string) {
  return res.status(200).json({ code, message, data: null });
}

// ---- args 合法性校验：禁止 function/Date/Buffer/undefined ----------------
function isLegalArg(v: any, depth = 0): boolean {
  if (depth > 8) return false; // 防递归爆栈
  if (v === null) return true;
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") return true;
  if (t === "undefined") return false;
  if (t === "function") return false;
  if (Array.isArray(v)) return v.every((x) => isLegalArg(x, depth + 1));
  if (t === "object") {
    if (v instanceof Date) return false;
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(v)) return false;
    // 仅允许 plain object
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(v).every((x) => isLegalArg(x, depth + 1));
  }
  return false;
}

// ---- 鉴权 ---------------------------------------------------------------
// 使用 Stream D 提供的 requireAuth；req.user.id/name 由它注入。
// （req.user 类型在 src/auth/middleware.ts 中通过 declare module 增强。）

// ---- POST /api/db/query --------------------------------------------------
router.post("/query", requireAuth, async (req: Request, res: Response) => {
  const body = req.body;

  // 1. 请求体格式
  if (!body || typeof body !== "object") {
    return fail(res, 4004, "body must be a JSON object");
  }
  const { table, calls, terminal } = body as {
    table?: unknown;
    calls?: unknown;
    terminal?: unknown;
  };
  if (typeof table !== "string" || !table) {
    return fail(res, 4004, "field 'table' must be a non-empty string");
  }
  if (calls !== undefined && !Array.isArray(calls)) {
    return fail(res, 4004, "field 'calls' must be an array if provided");
  }
  if (
    !terminal ||
    typeof terminal !== "object" ||
    typeof (terminal as any).method !== "string" ||
    !Array.isArray((terminal as any).args)
  ) {
    return fail(res, 4004, "field 'terminal' must be { method: string, args: any[] }");
  }

  // 2. 表名
  if (!TABLE_WHITELIST.has(table)) {
    return fail(res, 4002, `table '${table}' not allowed`);
  }

  // 3. 校验 calls
  const callList: { method: string; args: any[] }[] = [];
  if (Array.isArray(calls)) {
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i] as any;
      if (!c || typeof c.method !== "string" || !Array.isArray(c.args)) {
        return fail(res, 4004, `calls[${i}] must be { method, args }`);
      }
      if (!INTERMEDIATE_METHODS.has(c.method)) {
        return fail(res, 4003, `intermediate method '${c.method}' not allowed`);
      }
      if (!isLegalArg(c.args)) {
        return fail(res, 4005, `calls[${i}].args contains illegal JSON type`);
      }
      callList.push({ method: c.method, args: c.args });
    }
  }

  // 4. 校验 terminal
  const term = terminal as { method: string; args: any[] };
  if (!TERMINAL_METHODS.has(term.method)) {
    return fail(res, 4003, `terminal method '${term.method}' not allowed`);
  }
  if (!isLegalArg(term.args)) {
    return fail(res, 4005, "terminal.args contains illegal JSON type");
  }

  // 5. 执行
  const userId = req.user!.id;
  const isBusiness = BUSINESS_TABLES.has(table);

  try {
    let qb: any = knex(table);

    // 5.1 业务表多租户注入
    //   - INSERT：把 args[0]（对象/数组）中无 userId 的对象自动补 userId
    //   - 其它（SELECT/UPDATE/DELETE）：链前先 .where('userId', req.user.id)
    let terminalArgs = term.args;
    if (isBusiness) {
      if (term.method === "insert") {
        const raw = term.args[0];
        const fillUserId = (row: any) => {
          if (row && typeof row === "object" && !Array.isArray(row)) {
            if (row.userId == null) return { ...row, userId };
          }
          return row;
        };
        let patched: any;
        if (Array.isArray(raw)) {
          patched = raw.map(fillUserId);
        } else {
          patched = fillUserId(raw);
        }
        terminalArgs = [patched, ...term.args.slice(1)];
      } else if (term.method !== "truncate") {
        qb = qb.where("userId", userId);
      }
    }

    // 5.2 回放中间方法
    for (const c of callList) {
      const fn = qb[c.method];
      if (typeof fn !== "function") {
        return fail(res, 4003, `intermediate method '${c.method}' not callable on knex builder`);
      }
      qb = fn.apply(qb, c.args);
    }

    // 5.3 终结调用
    const termFn = qb[term.method];
    if (typeof termFn !== "function") {
      return fail(res, 4003, `terminal method '${term.method}' not callable on knex builder`);
    }
    const result = await termFn.apply(qb, terminalArgs);

    return res.status(200).json({ code: 0, message: "ok", data: result ?? null });
  } catch (e: any) {
    return fail(res, 5000, e?.message || "internal pg error");
  }
});

export default router;
