// Phase 1 后端 vendor 适配 - 火山引擎(豆包)
// 原文件：Toonflow-app/data/vendor/volcengine.ts
// 端口策略：把客户端的 imageRequest / videoRequest 逻辑原样搬过来，
// 只把 vendor.inputValues 改成从外部函数参数同步进来。textRequest / checkForUpdates 不搬。

import { urlToBase64, pollTask, logger } from "../helpers";

// 本模块 shadow 全局 fetch 类型为 any —— 见 src/ai/globals.d.ts 注释。
const fetch: any = (globalThis as any).fetch;

// ============================================================
// 类型（与客户端等价的局部类型）
// ============================================================

type ReferenceList =
  | { type: "image"; sourceType: "base64"; base64: string }
  | { type: "audio"; sourceType: "base64"; base64: string }
  | { type: "video"; sourceType: "base64"; base64: string };

interface ImageConfig {
  prompt: string;
  referenceList?: Extract<ReferenceList, { type: "image" }>[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}

interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: ReferenceList[];
  audio?: boolean;
  mode: any;
}

// vendor 用到的 model 字段比较散，统一 any
type ImageModel = { modelName: string };
type VideoModel = { modelName: string; audio: "optional" | true | false; name?: string };

interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}

// ============================================================
// vendor.inputValues：模块级单例，每次请求被新的 inputValues 覆盖
// 注意：多个并发请求共享同一份配置（同一 vendorId 在 DB 只有一行），不会出现凭据互踩
// ============================================================
const vendor = {
  inputValues: {
    apiKey: "",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  } as Record<string, string>,
};

// ============================================================
// 辅助工具（搬自客户端）
// ============================================================

const getHeaders = () => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "")}`,
  };
};

const getBaseUrl = () => vendor.inputValues.baseUrl.replace(/\/+$/, "");

// ============================================================
// 适配器（imageRequest / videoRequest）
// 内部 _imageRequest / _videoRequest 直接搬运客户端代码，仅保留 image/video 两个
// ============================================================

const _imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  const baseUrl = getBaseUrl();
  const headers = getHeaders();

  const body: any = {
    model: model.modelName,
    prompt: config.prompt || "",
    response_format: "url",
    watermark: false,
  };

  const isOldModel = model.modelName.includes("seedream-3-0");
  const is5Lite = model.modelName.includes("seedream-5-0-lite");

  if (!isOldModel) {
    body.sequential_image_generation = "disabled";
  }

  if (!isOldModel && config.referenceList && config.referenceList.length > 0) {
    const images = config.referenceList.map((ref) => ref.base64);
    body.image = images.length === 1 ? images[0] : images;
  }

  const [w, h] = config.aspectRatio.split(":").map(Number);
  const sizeTable: Record<string, Record<string, string>> = {
    "1K": {
      "1:1": "1024x1024",
      "4:3": "1152x864",
      "3:4": "864x1152",
      "16:9": "1280x720",
      "9:16": "720x1280",
      "3:2": "1248x832",
      "2:3": "832x1248",
      "21:9": "1512x648",
    },
    "2K": {
      "1:1": "2048x2048",
      "4:3": "2304x1728",
      "3:4": "1728x2304",
      "16:9": "2848x1600",
      "9:16": "1600x2848",
      "3:2": "2496x1664",
      "2:3": "1664x2496",
      "21:9": "3136x1344",
    },
    "4K": {
      "1:1": "4096x4096",
      "4:3": "4704x3520",
      "3:4": "3520x4704",
      "16:9": "5504x3040",
      "9:16": "3040x5504",
      "3:2": "4992x3328",
      "2:3": "3328x4992",
      "21:9": "6240x2656",
    },
  };

  const sizeKey = config.size || "2K";
  const ratioKey = config.aspectRatio;
  const table = sizeTable[sizeKey];

  if (table && table[ratioKey]) {
    const [pw, ph] = table[ratioKey].split("x").map(Number);
    const totalPixels = pw * ph;
    if (isOldModel) {
      body.size = table[ratioKey];
    } else if (totalPixels < 3686400) {
      body.size = "2K";
    } else if (is5Lite && totalPixels > 10404496) {
      body.size = "2K";
    } else {
      body.size = table[ratioKey];
    }
  } else if (isOldModel) {
    const base = sizeKey === "1K" ? 1024 : 2048;
    const calcW = Math.min(2048, Math.round(base * Math.sqrt(w / h)));
    const calcH = Math.min(2048, Math.round(base * Math.sqrt(h / w)));
    body.size = `${Math.max(512, calcW)}x${Math.max(512, calcH)}`;
  } else {
    if (is5Lite) {
      body.size = sizeKey === "4K" ? "3K" : sizeKey === "1K" ? "2K" : sizeKey;
    } else {
      body.size = sizeKey === "1K" ? "2K" : sizeKey;
    }
  }

  logger(`[图片生成] 请求模型: ${model.modelName}, 尺寸: ${body.size}`);
  const res = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`图片生成请求失败: ${errorText}`);
  }
  const response = await res.json();
  logger(response);

  if (response?.error) {
    throw new Error(`图片生成失败：${response.error.message || response.error.code}`);
  }

  if (response?.data && response.data.length > 0) {
    for (const item of response.data) {
      if (item.url) {
        return await urlToBase64(item.url);
      }
      if (item.b64_json) {
        return item.b64_json;
      }
      if (item.error) {
        throw new Error(`图片生成失败：${item.error.message || item.error.code}`);
      }
    }
  }

  throw new Error("图片生成失败：未返回有效结果");
};

const _videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  const baseUrl = getBaseUrl();
  const headers = getHeaders();

  const content: any[] = [];
  if (config.prompt) {
    content.push({ type: "text", text: config.prompt });
  }

  if (typeof config.mode === "string") {
    switch (config.mode) {
      case "singleImage": {
        const firstImage = config.referenceList?.find((r) => r.type === "image");
        if (firstImage) {
          content.push({ type: "image_url", image_url: { url: firstImage.base64 }, role: "first_frame" });
        }
        break;
      }
      case "startFrameOptional": {
        const images = config.referenceList?.filter((r) => r.type === "image") ?? [];
        if (images.length > 0) {
          content.push({ type: "image_url", image_url: { url: images[0].base64 }, role: "first_frame" });
          if (images.length > 1) {
            content.push({ type: "image_url", image_url: { url: images[1].base64 }, role: "last_frame" });
          }
        }
        break;
      }
      case "startEndRequired": {
        const images = config.referenceList?.filter((r) => r.type === "image") ?? [];
        if (images.length >= 2) {
          content.push({ type: "image_url", image_url: { url: images[0].base64 }, role: "first_frame" });
          content.push({ type: "image_url", image_url: { url: images[1].base64 }, role: "last_frame" });
        }
        break;
      }
      case "endFrameOptional": {
        const images = config.referenceList?.filter((r) => r.type === "image") ?? [];
        if (images.length > 0) {
          content.push({ type: "image_url", image_url: { url: images[0].base64 }, role: "first_frame" });
          if (images.length > 1) {
            content.push({ type: "image_url", image_url: { url: images[1].base64 }, role: "last_frame" });
          }
        }
        break;
      }
      case "text":
      default:
        break;
    }
  } else if (Array.isArray(config.mode)) {
    const imageRefs = config.referenceList?.filter((r) => r.type === "image") ?? [];
    const videoRefs = config.referenceList?.filter((r) => r.type === "video") ?? [];
    const audioRefs = config.referenceList?.filter((r) => r.type === "audio") ?? [];
    for (const refDef of config.mode) {
      if (typeof refDef === "string") {
        if (refDef.startsWith("imageReference:")) {
          const maxCount = parseInt(refDef.split(":")[1], 10);
          for (const ref of imageRefs.slice(0, maxCount)) {
            content.push({ type: "image_url", image_url: { url: ref.base64 }, role: "reference_image" });
          }
        } else if (refDef.startsWith("videoReference:")) {
          const maxCount = parseInt(refDef.split(":")[1], 10);
          for (const ref of videoRefs.slice(0, maxCount)) {
            content.push({ type: "video_url", video_url: { url: ref.base64 }, role: "reference_video" });
          }
        } else if (refDef.startsWith("audioReference:")) {
          const maxCount = parseInt(refDef.split(":")[1], 10);
          for (const ref of audioRefs.slice(0, maxCount)) {
            content.push({ type: "audio_url", audio_url: { url: ref.base64 }, role: "reference_audio" });
          }
        }
      }
    }
  }

  const body: any = {
    model: model.modelName,
    content,
    ratio: config.aspectRatio,
    duration: config.duration,
    resolution: config.resolution || "720p",
    watermark: false,
  };

  if (model.audio === "optional") body.generate_audio = config.audio !== false;
  else if (model.audio === true) body.generate_audio = true;
  else body.generate_audio = false;

  logger(`[视频生成] 提交任务, 模型: ${model.modelName}, 时长: ${config.duration}s, 分辨率: ${config.resolution}`);
  const res = await fetch(`${baseUrl}/contents/generations/tasks`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`视频生成任务创建失败: ${errorText}`);
  }
  const createResponse = await res.json();
  logger(createResponse);
  const taskId = createResponse?.id;
  if (!taskId) throw new Error("视频生成任务创建失败：未返回任务ID");

  logger(`[视频生成] 任务已创建, ID: ${taskId}`);

  const result = await pollTask(
    async (): Promise<PollResult> => {
      const queryRes = await fetch(`${baseUrl}/contents/generations/tasks/${taskId}`, {
        method: "GET",
        headers,
      });
      if (!queryRes.ok) {
        const errorText = await queryRes.text();
        throw new Error(`查询视频生成任务状态失败: ${errorText}`);
      }
      const task = await queryRes.json();
      logger(`[视频生成] 任务状态: ${JSON.stringify(task)}`);
      switch (task.status) {
        case "succeeded":
          if (task.content?.video_url) return { completed: true, data: task.content.video_url };
          return { completed: true, error: "任务成功但未返回视频URL" };
        case "failed":
          return { completed: true, error: task.error?.message || "视频生成失败" };
        case "expired":
          return { completed: true, error: "视频生成任务超时" };
        case "cancelled":
          return { completed: true, error: "视频生成任务已取消" };
        default:
          return { completed: false };
      }
    },
    10000,
    600000 * 3,
  );

  if (result.error) throw new Error(result.error);
  return result.data!;
};

// ============================================================
// 公开 wrapper：每次调用先把 inputValues 同步到模块级 vendor.inputValues
// ============================================================

export const vendorId = "volcengine";

export async function imageRequest(
  config: any,
  model: any,
  inputValues: Record<string, string>,
): Promise<string> {
  Object.assign(vendor.inputValues, inputValues);
  return _imageRequest(config, model);
}

export async function videoRequest(
  config: any,
  model: any,
  inputValues: Record<string, string>,
): Promise<string> {
  Object.assign(vendor.inputValues, inputValues);
  return _videoRequest(config, model);
}

export async function ttsRequest(
  _config: any,
  _model: any,
  _inputValues: Record<string, string>,
): Promise<string> {
  // 客户端 volcengine.ts 中 ttsRequest 返回空串，本端口直接抛 unsupported
  throw new Error("vendor=volcengine 暂不支持 TTS");
}
