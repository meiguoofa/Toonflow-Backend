// Phase 1 AI 代理中心调度
//
// 三个公开入口（runImage / runVideo / runAudio），流程一致：
//   1. 校验 vendorId ∈ 已知 11 个
//   2. 从 o_vendorConfig 取行；enable=0 或 inputValues 缺失 → code:4011
//   3. 动态 import 对应的 vendor 模块，拿到 image/video/tts request
//   4. enqueue + withRetry 包裹后执行
//
// 注：vendor 模块的 import 用相对 require，避免 ESM 异步问题。
// installGlobals 在首次调用时执行一次，确保 vendor 内通过 globalThis.* 拿到工具。

import knex from "../db";
import { enqueue } from "./queue";
import { withRetry } from "./retry";
import { installGlobals, urlToBase64 } from "./helpers";

export const KNOWN_VENDOR_IDS = [
  "atlascloud",
  "deepseek",
  "grsai",
  "klingai",
  "minimax",
  "null",
  "openai",
  "toonflow",
  "vidu",
  "volcengine",
  "volcengineSd2",
] as const;
export type KnownVendorId = (typeof KNOWN_VENDOR_IDS)[number];

export function isKnownVendor(id: string): id is KnownVendorId {
  return (KNOWN_VENDOR_IDS as readonly string[]).includes(id);
}

interface VendorRow {
  id: string;
  inputValues: string | null;
  models: string | null;
  enable: number;
}

interface VendorAdapter {
  vendorId: string;
  imageRequest?: (config: any, model: any, inputValues: Record<string, string>) => Promise<string>;
  videoRequest?: (config: any, model: any, inputValues: Record<string, string>) => Promise<string>;
  ttsRequest?: (config: any, model: any, inputValues: Record<string, string>) => Promise<string>;
}

// vendor 模块加载缓存
const vendorModules = new Map<string, Promise<VendorAdapter>>();

async function loadVendor(vendorId: KnownVendorId): Promise<VendorAdapter> {
  let p = vendorModules.get(vendorId);
  if (!p) {
    p = (async () => {
      // 使用动态 require，避免 ESM/CJS 混用问题；vendor 文件都是普通 CJS
      // 注意：vendorId 已通过白名单校验，不会有路径注入
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(`./vendor/${vendorId}`);
      return mod as VendorAdapter;
    })();
    vendorModules.set(vendorId, p);
  }
  return p;
}

async function loadConfig(
  vendorId: KnownVendorId,
): Promise<{ inputValues: Record<string, string> }> {
  const row = (await knex("o_vendorConfig").where("id", vendorId).first()) as VendorRow | undefined;
  if (!row) {
    const err: any = new Error(`vendor ${vendorId} 未配置`);
    err.code = 4011;
    throw err;
  }
  if (row.enable === 0) {
    const err: any = new Error(`vendor ${vendorId} 未启用`);
    err.code = 4011;
    throw err;
  }
  if (!row.inputValues) {
    const err: any = new Error(`vendor ${vendorId} 凭据未配置`);
    err.code = 4011;
    throw err;
  }
  let inputValues: Record<string, string>;
  try {
    inputValues = JSON.parse(row.inputValues);
  } catch {
    const err: any = new Error(`vendor ${vendorId} inputValues JSON 解析失败`);
    err.code = 4011;
    throw err;
  }
  return { inputValues };
}

async function run(
  kind: "image" | "video" | "audio",
  vendorId: string,
  model: any,
  config: any,
): Promise<string> {
  if (!isKnownVendor(vendorId)) {
    const err: any = new Error(`未知 vendorId: ${vendorId}`);
    err.code = 4002;
    throw err;
  }
  installGlobals();

  const { inputValues } = await loadConfig(vendorId);
  const adapter = await loadVendor(vendorId);

  const fn =
    kind === "image"
      ? adapter.imageRequest
      : kind === "video"
        ? adapter.videoRequest
        : adapter.ttsRequest;
  if (!fn) {
    const err: any = new Error(`vendor ${vendorId} 不支持 ${kind}`);
    err.code = 4011;
    throw err;
  }
  const result = await enqueue(vendorId, () =>
    withRetry(() => fn(config, model, inputValues), { vendorId }),
  );
  // 客户端旧实现的兜底：vendor 若返回 http(s):// URL，统一在此处转 base64
  // （客户端 shim 改造后透传响应，下游 u.oss.writeFile 期望 base64，必须在此处接管）
  if (typeof result === "string" && /^https?:\/\//i.test(result)) {
    return await urlToBase64(result);
  }
  return result;
}

export function runImage(vendorId: string, model: any, config: any): Promise<string> {
  return run("image", vendorId, model, config);
}

export function runVideo(vendorId: string, model: any, config: any): Promise<string> {
  return run("video", vendorId, model, config);
}

export function runAudio(vendorId: string, model: any, config: any): Promise<string> {
  return run("audio", vendorId, model, config);
}
