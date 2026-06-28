// Phase 1 后端 AI 代理通用辅助工具
// 客户端原版工具（urlToBase64 / pollTask / zipImage / 各 SDK 工厂）在 VM 沙箱中通过全局变量注入，
// 后端把它们改成普通 ESM 导出，再在 src/ai/index.ts 启动时同步挂载到 globalThis，
// 让 vendor 文件既能 import 也能享受到老式的全局调用风格（兼容直接搬运过来的代码）。

import * as nodeCrypto from "node:crypto";

// ============================================================
// 日志：所有 vendor 通过 logger(msg) 输出调试信息，统一走 console.log
// （vendor 代码经常 logger(obj)，所以参数类型用 any）
// ============================================================
export const logger = (msg: any): void => {
  try {
    if (typeof msg === "string") console.log(`[ai] ${msg}`);
    else console.log("[ai]", msg);
  } catch {
    // 忽略日志异常
  }
};

// ============================================================
// PollResult / pollTask
// vendor 视频任务普遍提交后轮询，复用客户端 pollTask 签名
// ============================================================
export interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}

export async function pollTask(
  fn: () => Promise<PollResult>,
  interval: number = 5000,
  timeout: number = 600_000,
): Promise<PollResult> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await fn();
    if (result.completed) return result;
    await new Promise((r) => setTimeout(r, interval));
  }
  return { completed: true, error: `pollTask timeout after ${timeout}ms` };
}

// ============================================================
// urlToBase64：把远端 URL 拉到 Buffer，再 toString('base64')
// 客户端原实现见 Toonflow-app/src/utils/ai.ts:164-176
// 返回不带 data: 头的纯 base64（保持与客户端一致）
// ============================================================
export async function urlToBase64(url: string, retries = 3, delay = 1000): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res: any = await fetch(url);
      if (!res || !res.ok) {
        throw new Error(`urlToBase64 fetch failed: ${res ? res.status : "no response"}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.toString("base64");
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise((r) => setTimeout(r, delay * attempt));
    }
  }
  throw new Error("urlToBase64 failed");
}

// ============================================================
// zipImage / zipImageResolution / mergeImages
// 客户端在沙箱里用 canvas 做图片压缩。后端没有 canvas，phase 1 先做 noop 占位，
// 让搬过来的 vendor 调用不会崩。后续需要时再换成 sharp。
// TODO(phase1-port): 后端缺图片压缩能力，部分 vendor（minimax/toonflow）依赖 zipImage 压到 ≤20MB
// ============================================================
export async function zipImage(base64: string, _maxSize: number): Promise<string> {
  return base64;
}

export async function zipImageResolution(base64: string, _w: number, _h: number): Promise<string> {
  return base64;
}

export async function mergeImages(base64Arr: string[], _maxSize?: string): Promise<string> {
  return base64Arr[0] ?? "";
}

// ============================================================
// axios shim：vendor 文件里大量 axios.post(url, body, {headers, params}) /
// axios.get(url, {headers, params}) 调用，这里用 fetch 实现最小兼容层，
// 返回 {data, status, ok}，错误时 throw 一个带 status 的 Error（便于 retry 识别）。
// 不引入真正的 axios 依赖。
// ============================================================

function buildUrl(url: string, params?: Record<string, any>): string {
  if (!params || Object.keys(params).length === 0) return url;
  const qs = Object.entries(params)
    .filter(([_, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  if (!qs) return url;
  return url.includes("?") ? `${url}&${qs}` : `${url}?${qs}`;
}

async function parseAndCheck(res: any): Promise<{ data: any; status: number; ok: boolean }> {
  const status = res.status as number;
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err: any = new Error(
      typeof data === "string" ? data : `HTTP ${status}: ${JSON.stringify(data).slice(0, 500)}`,
    );
    err.status = status;
    err.response = { status, data };
    throw err;
  }
  return { data, status, ok: true };
}

export const axios = {
  async post(url: string, body?: any, opts?: { headers?: Record<string, string>; params?: Record<string, any> }) {
    const finalUrl = buildUrl(url, opts?.params);
    const res: any = await fetch(finalUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
      body: body == null ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    return parseAndCheck(res);
  },
  async get(url: string, opts?: { headers?: Record<string, string>; params?: Record<string, any> }) {
    const finalUrl = buildUrl(url, opts?.params);
    const res: any = await fetch(finalUrl, { method: "GET", headers: opts?.headers || {} });
    return parseAndCheck(res);
  },
};

// ============================================================
// jsonwebtoken / crypto：少数 vendor 用到（klingai 用 jsonwebtoken 签 JWT，
// volcengineSd2 直接用 crypto.createHmac）。这里用 node 内置实现一个最小 shim。
// ============================================================

// 最小 jsonwebtoken.sign 实现（仅 HS256），覆盖 klingai 用法
export const jsonwebtoken = {
  sign(
    payload: Record<string, any>,
    secret: string,
    options?: { algorithm?: "HS256"; header?: Record<string, any> },
  ): string {
    const header = { alg: "HS256", typ: "JWT", ...(options?.header || {}) };
    const base64url = (input: Buffer | string) =>
      (typeof input === "string" ? Buffer.from(input) : input)
        .toString("base64")
        .replace(/=+$/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
    const headerB64 = base64url(JSON.stringify(header));
    const payloadB64 = base64url(JSON.stringify(payload));
    const signingInput = `${headerB64}.${payloadB64}`;
    const sig = nodeCrypto.createHmac("sha256", secret).update(signingInput).digest();
    return `${signingInput}.${base64url(sig)}`;
  },
};

// 暴露 crypto 给 vendor（volcengineSd2 直接 crypto.createHmac / createHash）
export const crypto = nodeCrypto;

// ============================================================
// 把工具同步挂到 globalThis，便于直接搬过来的 vendor 代码在不 import 的情况下也能用
// （契约文档明确要求）
// ============================================================
export function installGlobals(): void {
  const g = globalThis as any;
  if (g.__aiHelpersInstalled) return;
  g.urlToBase64 = urlToBase64;
  g.pollTask = pollTask;
  g.zipImage = zipImage;
  g.zipImageResolution = zipImageResolution;
  g.mergeImages = mergeImages;
  g.logger = logger;
  g.axios = axios;
  g.jsonwebtoken = jsonwebtoken;
  // Node 19+ 把 globalThis.crypto 定为只读 getter（Web Crypto API），普通赋值会抛
  // "Cannot set property crypto ... has only a getter"。但 vendor 代码用的是 Node crypto
  // 的 createHmac / createHash（Web Crypto 没有这些），所以必须用 defineProperty 强制
  // 把它替换成 Node crypto 模块。Web Crypto 的描述符是 configurable: true，可覆盖。
  try {
    Object.defineProperty(g, "crypto", {
      value: nodeCrypto,
      writable: true,
      configurable: true,
    });
  } catch {
    // 极少数环境 globalThis.crypto 不可重定义。用到 createHmac 的 vendor（volcengineSd2 等）
    // 会在运行时报错；其它不用 crypto 的 vendor 不受影响。
  }
  g.__aiHelpersInstalled = true;
}
