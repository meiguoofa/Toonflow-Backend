// Phase 2 后端 vendor 元数据 API
//
// 客户端 utils/vendor.ts 重写后通过 HTTP 调用这里，取代原本的"本地 vendor.json + vm 沙箱"。
// 同时支持用户在 Settings 里"添加自定义 vendor"——基于模板选 + 填参数，无须上传代码。
//
// 路由：
//   POST /api/vendor/list       — 所有 vendor 实例（合并 DB 行 + builtin metadata）
//   POST /api/vendor/info       — 单个 vendor 详情（含 protocol/template/models 等）
//   POST /api/vendor/models     — 单个 vendor 的完整模型清单（DB + builtin 合并）
//   POST /api/vendor/templates  — 可选模板清单（含 inputs schema 供 UI 渲染）
//   POST /api/vendor/create     — 创建自定义 vendor 实例
//   POST /api/vendor/update     — 更新 vendor 实例（inputValues/models/enable/name）
//   POST /api/vendor/delete     — 删除 vendor 实例（仅自定义，内置 template-id 同名行受保护）
//
// 所有路由复用 requireAuth；body 含 vendorId/template 参数。
// 内置 vendor 受保护：不能 delete；template 不能改。

import { Router } from "express";
import knex from "../db";
import builtinModels from "../ai/builtin-models.json";
import builtinVendorMeta from "../ai/builtin-vendor-meta.json";
import { KNOWN_TEMPLATES, isKnownTemplate } from "../ai";

const router: Router = Router();

// 受保护的内置 vendor id（用户不能删除/改 template）。
// 与 builtin-vendor-meta.json 的 key 一致，由 extract 脚本生成。
const BUILTIN_VENDOR_IDS = new Set<string>(Object.keys(builtinVendorMeta as Record<string, any>));

interface VendorRow {
  id: string;
  inputValues: string | null;
  models: string | null;
  enable: number;
  template: string | null;
  name: string | null;
}

interface VendorMeta {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  icon: string;
  inputs: any[];
  defaultInputValues: Record<string, string>;
  template: string;
  protocol: string | null;
}

// ---- 公共工具 ---------------------------------------------------------------

function badRequest(res: any, message: string) {
  return res.status(400).json({ code: 4003, message, data: null });
}

function getBuiltinMeta(id: string): VendorMeta | null {
  return (builtinVendorMeta as Record<string, VendorMeta>)[id] ?? null;
}

/**
 * 把 DB 行 + builtin metadata 合并成对外返回的完整 vendor 信息。
 * 内置 vendor：DB 行有 inputValues/models/enable（用户填的），名字/描述/inputs/protocol 取 builtin。
 * 用户自定义 vendor：builtin 没有，名字取 DB.name，inputs 取该 vendor 对应模板的 inputs（如 openai-compatible）。
 */
function buildVendorView(row: VendorRow): any {
  const builtin = getBuiltinMeta(row.id);
  const templateName = row.template || row.id;
  const templateMeta = getBuiltinMeta(templateName); // 用户自定义 vendor 的 inputs schema 取自其 template
  const inputValues = row.inputValues ? safeJsonParse(row.inputValues, {}) : {};
  const dbModels = row.models ? safeJsonParse(row.models, []) : [];
  const builtinModelList = (builtinModels as Record<string, any[]>)[row.id] ?? [];
  // 合并 models：DB 自定义在前（覆盖同名），builtin 在后
  const allModels = mergeByModelName([...dbModels, ...builtinModelList]);

  return {
    id: row.id,
    name: row.name ?? builtin?.name ?? row.id,
    description: builtin?.description ?? "",
    author: builtin?.author ?? "",
    version: builtin?.version ?? "1.0",
    icon: builtin?.icon ?? "",
    inputs: builtin?.inputs ?? templateMeta?.inputs ?? [],
    inputValues,
    template: templateName,
    protocol: builtin?.protocol ?? templateMeta?.protocol ?? null,
    enable: row.enable,
    models: allModels,
    isBuiltin: BUILTIN_VENDOR_IDS.has(row.id),
  };
}

function safeJsonParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function mergeByModelName(arr: any[]): any[] {
  const map = new Map<string, any>();
  for (const m of arr) {
    if (m && typeof m.modelName === "string") map.set(m.modelName, m);
  }
  return [...map.values()];
}

// ---- 路由 -------------------------------------------------------------------

router.post("/list", async (_req, res) => {
  const rows = (await knex("o_vendorConfig").select("*")) as VendorRow[];
  const data = rows.map(buildVendorView);
  // 默认排序：toonflow 优先（与客户端原 getVendorList 行为一致）
  data.sort((a, b) => (a.id === "toonflow" ? -1 : b.id === "toonflow" ? 1 : 0));
  return res.json({ code: 0, message: "ok", data });
});

router.post("/info", async (req, res) => {
  const { vendorId } = req.body || {};
  if (typeof vendorId !== "string" || !vendorId) return badRequest(res, "vendorId 必填");
  const row = (await knex("o_vendorConfig").where("id", vendorId).first()) as VendorRow | undefined;
  if (!row) return res.status(404).json({ code: 4011, message: `vendor ${vendorId} 不存在`, data: null });
  return res.json({ code: 0, message: "ok", data: buildVendorView(row) });
});

router.post("/models", async (req, res) => {
  const { vendorId } = req.body || {};
  if (typeof vendorId !== "string" || !vendorId) return badRequest(res, "vendorId 必填");
  const row = (await knex("o_vendorConfig").where("id", vendorId).first()) as VendorRow | undefined;
  if (!row) return res.json({ code: 0, message: "ok", data: [] });
  const dbModels = row.models ? safeJsonParse(row.models, []) as any[] : [];
  const builtinList = (builtinModels as Record<string, any[]>)[vendorId] ?? [];
  const data = mergeByModelName([...dbModels, ...builtinList]);
  return res.json({ code: 0, message: "ok", data });
});

router.post("/templates", async (_req, res) => {
  // 内置 vendor 列表 + 通用模板 openai-compatible 一起暴露。前端"添加供应商"对话框据此渲染选项。
  const data = KNOWN_TEMPLATES.map((t) => {
    const meta = getBuiltinMeta(t);
    return {
      template: t,
      name: meta?.name ?? t,
      description: meta?.description ?? "",
      inputs: meta?.inputs ?? [],
      defaultInputValues: meta?.defaultInputValues ?? {},
      protocol: meta?.protocol ?? null,
    };
  });
  return res.json({ code: 0, message: "ok", data });
});

router.post("/create", async (req, res) => {
  const { template, id, name, inputValues, models } = req.body || {};
  if (typeof template !== "string" || !isKnownTemplate(template)) {
    return badRequest(res, `template "${template}" 不在白名单`);
  }
  if (typeof id !== "string" || !id) return badRequest(res, "id 必填");
  if (id.includes(":")) return badRequest(res, "id 不能包含英文冒号");
  if (BUILTIN_VENDOR_IDS.has(id)) return badRequest(res, `id "${id}" 与内置 vendor 冲突`);

  const existing = await knex("o_vendorConfig").where("id", id).first();
  if (existing) return badRequest(res, `vendor id "${id}" 已存在`);

  await knex("o_vendorConfig").insert({
    id,
    template,
    name: typeof name === "string" ? name : null,
    inputValues: JSON.stringify(inputValues ?? {}),
    models: JSON.stringify(Array.isArray(models) ? models : []),
    enable: 0,
  });

  const row = (await knex("o_vendorConfig").where("id", id).first()) as VendorRow;
  return res.json({ code: 0, message: "ok", data: buildVendorView(row) });
});

router.post("/update", async (req, res) => {
  const { vendorId, inputValues, models, enable, name } = req.body || {};
  if (typeof vendorId !== "string" || !vendorId) return badRequest(res, "vendorId 必填");

  const row = (await knex("o_vendorConfig").where("id", vendorId).first()) as VendorRow | undefined;
  if (!row) return res.status(404).json({ code: 4011, message: `vendor ${vendorId} 不存在`, data: null });

  const patch: Partial<VendorRow> = {};
  if (inputValues !== undefined) patch.inputValues = JSON.stringify(inputValues);
  if (models !== undefined) patch.models = JSON.stringify(Array.isArray(models) ? models : []);
  if (enable !== undefined) patch.enable = enable ? 1 : 0;
  if (name !== undefined && typeof name === "string") patch.name = name;

  if (Object.keys(patch).length === 0) return badRequest(res, "至少需要一个可更新字段");

  await knex("o_vendorConfig").where("id", vendorId).update(patch);
  const updated = (await knex("o_vendorConfig").where("id", vendorId).first()) as VendorRow;
  return res.json({ code: 0, message: "ok", data: buildVendorView(updated) });
});

router.post("/delete", async (req, res) => {
  const { vendorId } = req.body || {};
  if (typeof vendorId !== "string" || !vendorId) return badRequest(res, "vendorId 必填");
  if (BUILTIN_VENDOR_IDS.has(vendorId)) return badRequest(res, `内置 vendor "${vendorId}" 不可删除`);

  const deleted = await knex("o_vendorConfig").where("id", vendorId).delete();
  if (deleted === 0) return res.status(404).json({ code: 4011, message: `vendor ${vendorId} 不存在`, data: null });
  return res.json({ code: 0, message: "ok", data: { id: vendorId } });
});

export default router;
