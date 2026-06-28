// Phase 1 后端 vendor 适配 - Vidu
// 原文件：Toonflow-app/data/vendor/vidu.ts
// 客户端用 fetch + Token <key> 鉴权。image/video 实现完整，TTS 直接 throw。
//
// TODO(phase1-port): 原客户端代码同位置存在两个潜在 bug：
//   - vidu 的 sizeMap 用 "1k" 索引（小写），但传入的是 size === "1K" → "2K"，分支永远走不到
//   - imageRequest 用 imageConfig.imageBase64（旧字段），但前端类型已经迁移到 referenceList；
//     这里忠实搬运，不修，留待 phase 2 评估
//   - checkTaskResult 状态 fail 时返回 completed:false 而非 true，会导致一直轮询到超时；保持搬运

import { pollTask, logger } from "../helpers";

const fetch: any = (globalThis as any).fetch;

interface ImageConfig {
  prompt: string;
  imageBase64: string[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}

interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  imageBase64?: string[];
  audio?: boolean;
  mode: any;
}

type ImageModel = { modelName: string };
type VideoModel = { modelName: string };

const vendor = {
  inputValues: { apiKey: "", baseUrl: "https://api.vidu.cn/ent/v2" } as Record<string, string>,
};

const buildViduMetadata = (videoConfig: VideoConfig) => ({
  aspect_ratio: videoConfig.aspectRatio,
  audio: videoConfig.audio ?? false,
  off_peak: false,
});

type MetadataBuilder = (config: VideoConfig) => Record<string, any>;
const METADATA_BUILDERS: Array<[string, MetadataBuilder]> = [["vidu", buildViduMetadata]];
const buildModelMetadata = (modelName: string, videoConfig: VideoConfig) => {
  const lowerName = modelName.toLowerCase();
  const match = METADATA_BUILDERS.find(([key]) => lowerName.includes(key));
  return match ? match[1](videoConfig) : {};
};

const checkTaskResult = async (taskId: string) => {
  const queryUrl = vendor.inputValues.baseUrl + "/tasks/{id}/creations";
  const apiKey = vendor.inputValues.apiKey;
  const res = await pollTask(async () => {
    const queryResponse = await fetch(queryUrl.replace("{id}", taskId), {
      method: "GET",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
    });
    if (!queryResponse.ok) {
      const errorText = await queryResponse.text();
      logger(`请求失败，状态码: ${queryResponse.status}, 错误信息: ${errorText}`);
      throw new Error(`请求失败，状态码: ${queryResponse.status}, 错误信息: ${errorText}`);
    }
    const queryData = await queryResponse.json();
    const status = queryData?.state ?? queryData?.data?.state;
    const fail_reason = queryData?.data?.err_code ?? queryData?.data;
    switch (status) {
      case "completed":
      case "SUCCESS":
      case "success":
        return { completed: true, data: queryData.creations };
      case "FAILURE":
      case "failed":
        return { completed: false, error: fail_reason || "生成失败" };
      default:
        return { completed: false };
    }
  });
  if (res.error) throw new Error(res.error);
  return res;
};

const _imageRequest = async (imageConfig: ImageConfig, imageModel: ImageModel) => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const apiKey = vendor.inputValues.apiKey.replace("Token ", "");

  const size = imageConfig.size === "1K" ? "2K" : imageConfig.size;
  const sizeMap: Record<string, Record<string, string>> = {
    "16:9": { "1k": "1920x1080", "2K": "2848x1600", "4K": "4096x2304" },
    "9:16": { "1k": "1920x1080", "2K": "1600x2848", "4K": "2304x4096" },
  };

  const body: Record<string, any> = {
    model: imageModel.modelName,
    prompt: imageConfig.prompt,
    aspect_ratio: sizeMap[imageConfig.aspectRatio][size],
    seed: 0,
    resolution: size,
    ...(imageConfig.imageBase64 && { image: imageConfig.imageBase64 }),
  };

  const createImageUrl = vendor.inputValues.baseUrl + "/reference2image";
  const response = await fetch(createImageUrl, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`请求失败，状态码: ${response.status}, 错误信息: ${errorText}`);
  }
  const data = await response.json();
  const res = await checkTaskResult(data.task_id);
  if (!res.data) throw new Error("图片未能生成");
  const list = JSON.parse(JSON.stringify(res.data));
  return list[0].url as string;
};

const _videoRequest = async (videoConfig: VideoConfig, videoModel: VideoModel) => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const apiKey = vendor.inputValues.apiKey.replace("Token ", "");
  const metadata = buildModelMetadata(videoModel.modelName, videoConfig);

  const publicBody = {
    model: videoModel.modelName,
    ...(videoConfig.imageBase64 && videoConfig.imageBase64.length
      ? { images: videoConfig.imageBase64 }
      : {}),
    prompt: videoConfig.prompt,
    size: videoConfig.resolution,
    duration: videoConfig.duration,
    metadata,
  };

  const requestUrl = vendor.inputValues.baseUrl + "/start-end2video";
  const response = await fetch(requestUrl, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(publicBody),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`请求失败，状态码: ${response.status}, 错误信息: ${errorText}`);
  }
  const data = await response.json();
  const taskId = data.id;
  const result = await checkTaskResult(taskId);
  // 客户端原代码：return result.data（creations 数组）；保持搬运（routes 层会 JSON.stringify）
  return result.data as unknown as string;
};

export const vendorId = "vidu";

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
  const out = await _videoRequest(config, model);
  return out as string;
}
export async function ttsRequest(
  _config: any,
  _model: any,
  _inputValues: Record<string, string>,
): Promise<string> {
  throw new Error("Vidu 暂不支持语音合成（TTS）");
}
