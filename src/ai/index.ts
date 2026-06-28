// Phase 1 AI 代理中心调度（phase 2 改造：vendor 实例 / template 解耦）
//
// 三个公开入口（runImage / runVideo / runAudio），流程一致：
//   1. 从 o_vendorConfig 取 vendor 实例行；enable=0 / inputValues 缺失 → code:4011
//   2. 读取该实例的 template（phase 2 新字段）；template 必须在白名单内（防 require 路径注入）
//   3. 动态 require 对应 template 适配器，拿到 image/video/tts request
//   4. enqueue + withRetry 包裹后执行
//
// vendorId 不再固定白名单——用户可在 Settings 里创建任意 id 的 vendor 实例（只要 template 合法）。
// installGlobals 在首次调用时执行一次，确保 vendor 内通过 globalThis.* 拿到工具。

import knex from "../db";
import { enqueue } from "./queue";
import { withRetry } from "./retry";
import { installGlobals, urlToBase64 } from "./helpers";
import builtinModels from "./builtin-models.json";

// 合法 template 白名单——决定 require('./vendor/<template>') 的路径，必须严格白名单防注入。
// phase 2 新增 openai-compatible 通用模板；其余 11 个为既有内置 vendor 同名模板。
export const KNOWN_TEMPLATES = [
  "atlascloud",
  "deepseek",
  "grsai",
  "klingai",
  "minimax",
  "null",
  "openai",
  "openai-compatible",
  "toonflow",
  "vidu",
  "volcengine",
  "volcengineSd2",
] as const;
export type KnownTemplate = (typeof KNOWN_TEMPLATES)[number];

export function isKnownTemplate(t: string): t is KnownTemplate {
  return (KNOWN_TEMPLATES as readonly string[]).includes(t);
}

interface VendorRow {
  id: string;
  inputValues: string | null;
  models: string | null;
  enable: number;
  template: string | null;
}

interface VendorAdapter {
  vendorId: string;
  imageRequest?: (config: any, model: any, inputValues: Record<string, string>) => Promise<string>;
  videoRequest?: (config: any, model: any, inputValues: Record<string, string>) => Promise<string>;
  ttsRequest?: (config: any, model: any, inputValues: Record<string, string>) => Promise<string>;
}

// 模板适配器加载缓存（per-template，多个 vendor 实例可共享同一模板）
const adapterCache = new Map<string, Promise<VendorAdapter>>();

async function loadAdapter(template: KnownTemplate): Promise<VendorAdapter> {
  let p = adapterCache.get(template);
  if (!p) {
    p = (async () => {
      // template 已通过白名单校验，不会有路径注入
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(`./vendor/${template}`);
      return mod as VendorAdapter;
    })();
    adapterCache.set(template, p);
  }
  return p;
}

async function loadConfig(
  vendorId: string,
): Promise<{ inputValues: Record<string, string>; models: any[]; template: string }> {
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
  let models: any[] = [];
  if (row.models) {
    try {
      const parsed = JSON.parse(row.models);
      if (Array.isArray(parsed)) models = parsed;
    } catch {
      // models 字段格式异常时回退到空数组，由 builtin 兜底
    }
  }
  // template 优先用 DB 字段；老数据未迁移时回退到 vendorId（migration 0004 已对内置行回填，此分支兜底）
  const template = row.template || vendorId;
  return { inputValues, models, template };
}

/**
 * 按 modelName 找完整 model 对象。优先级：DB 用户自定义 > 内置 builtin-models.json。
 * 都查不到时返回 `{ modelName }` 兜底——vendor 内若只读 modelName.includes() 不会崩，
 * 但若用到 mode/audio 等业务字段会得到 undefined（行为退化，由 vendor 自行报错）。
 *
 * 内置 models 数据由 Toonflow-app 仓库的 `scripts/extract-vendor-meta.ts` 生成（手工同步）。
 */
function lookupModel(vendorId: string, modelName: string, dbModels: any[]): any {
  for (const m of dbModels) {
    if (m && m.modelName === modelName) return m;
  }
  const builtin = (builtinModels as Record<string, any[]>)[vendorId] ?? [];
  for (const m of builtin) {
    if (m && m.modelName === modelName) return m;
  }
  return { modelName };
}

async function run(
  kind: "image" | "video" | "audio",
  vendorId: string,
  model: any,
  config: any,
): Promise<string> {
  installGlobals();

  const { inputValues, models, template } = await loadConfig(vendorId);
  if (!isKnownTemplate(template)) {
    const err: any = new Error(`vendor ${vendorId} 的 template "${template}" 不在白名单`);
    err.code = 4002;
    throw err;
  }
  const adapter = await loadAdapter(template);

  // 客户端可只传 modelName 字符串（推荐）或完整 model 对象（旧客户端兼容）。
  // 字符串时由后端 lookupModel 合并 DB + builtin metadata 还原成完整对象。
  const fullModel =
    typeof model === "string"
      ? lookupModel(vendorId, model, models)
      : model;

  const fn =
    kind === "image"
      ? adapter.imageRequest
      : kind === "video"
        ? adapter.videoRequest
        : adapter.ttsRequest;
  if (!fn) {
    const err: any = new Error(`vendor ${vendorId} (template=${template}) 不支持 ${kind}`);
    err.code = 4011;
    throw err;
  }
  const result = await enqueue(vendorId, () =>
    withRetry(() => fn(config, fullModel, inputValues), { vendorId }),
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
