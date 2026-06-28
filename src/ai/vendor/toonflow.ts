// Phase 1 后端 vendor 适配 - Toonflow 官方中转
// 原文件：Toonflow-app/data/vendor/toonflow.ts
// 客户端 image/video 实现完整，TTS 空实现。

import { urlToBase64, pollTask, logger, zipImage } from "../helpers";

const fetch: any = (globalThis as any).fetch;

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
type ImageModel = { modelName: string };
type VideoModel = { modelName: string };

const vendor = {
  inputValues: {
    apiKey: "",
    baseUrl: "https://api.toonflow.net/v1",
  } as Record<string, string>,
};

function extractFirstImageFromMd(content: string) {
  const regex =
    /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[A-Za-z0-9+/=]+|https?:\/\/[^\s)]+|\/\/[^\s)]+|[^\s)]+)\)/;
  const match = content.match(regex);
  if (!match) return null;
  const raw = match[2].trim();
  const url = raw.startsWith("data:") ? raw : raw.split(/\s+/)[0];
  return { alt: match[1], url, type: url.startsWith("data:image") ? "base64" : "url" };
}

const _imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  const baseUrl = vendor.inputValues.baseUrl;
  const lowerName = model.modelName.toLowerCase();
  const imageBase64List = (config.referenceList ?? []).map((r) => r.base64).filter(Boolean);

  if (lowerName.includes("gemini") || lowerName.includes("nano")) {
    const imageConfigGoogle: Record<string, string> = {
      aspect_ratio: config.aspectRatio,
      image_size: config.size,
    };
    const messages: any[] = [];
    if (imageBase64List.length) {
      messages.push({
        role: "user",
        content: imageBase64List.map((b) => ({ type: "image_url", image_url: { url: b } })),
      });
    }
    messages.push({ role: "user", content: config.prompt + "请直接输出图片" });
    const body = {
      model: model.modelName,
      messages,
      extra_body: { google: { image_config: imageConfigGoogle } },
    };
    logger(`[imageRequest] 使用 gemini 适配器，模型: ${model.modelName}`);
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`请求失败，状态码: ${response.status}, 错误信息: ${errorText}`);
    }
    const data = await response.json();
    const imageResult = extractFirstImageFromMd(data.choices[0].message.content);
    if (!imageResult) throw new Error("未能从响应中提取图片");
    if (imageResult.type === "base64") return imageResult.url;
    return await urlToBase64(imageResult.url);
  }

  if (lowerName.includes("doubao") || lowerName.includes("seedream")) {
    const effectiveSize = config.size === "1K" ? "2K" : config.size;
    const sizeMap: Record<string, Record<string, string>> = {
      "16:9": { "2K": "2848x1600", "4K": "4096x2304" },
      "9:16": { "2K": "1600x2848", "4K": "2304x4096" },
    };
    const resolvedSize = sizeMap[config.aspectRatio]?.[effectiveSize];
    const body: Record<string, any> = {
      model: model.modelName,
      prompt: config.prompt,
      size: resolvedSize,
      metadata: {
        response_format: "url",
        sequential_image_generation: "disabled",
        stream: false,
        watermark: false,
      },
      ...(imageBase64List.length && { images: imageBase64List }),
    };
    logger(`[imageRequest] 使用 doubao 适配器，模型: ${model.modelName}`);
    const response = await fetch(`${baseUrl}/image/generateImage`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`请求失败，状态码: ${response.status}, 错误信息: ${errorText}`);
    }
    const data = await response.json();
    const taskId = data.data;
    logger(`[imageRequest] 任务ID: ${taskId}`);
    const res = await pollTask(async () => {
      const queryResponse = await fetch(`${baseUrl}/image/getImageStatus`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ taskICode: taskId }),
      });
      if (!queryResponse.ok) {
        const errorText = await queryResponse.text();
        throw new Error(`轮询失败，状态码: ${queryResponse.status}, 错误信息: ${errorText}`);
      }
      const queryData = await queryResponse.json();
      logger(queryData);
      const status = queryData?.status ?? queryData?.data?.status;
      switch (status) {
        case "success":
          return { completed: true, data: queryData.data.data };
        case "failed":
          return { completed: true, error: queryData?.data?.failReason ?? "视频生成失败" };
        default:
          return { completed: false };
      }
    });
    return res.data!;
  }
  if (lowerName.includes("gpt") || lowerName.includes("全能图片")) {
    const normalizedSize =
      config.size === "1K"
        ? "1k"
        : config.size === "2K"
          ? "2k"
          : config.size === "4K"
            ? "4k"
            : config.size;
    const body: Record<string, any> = {
      model: model.modelName,
      prompt: config.prompt,
      size: normalizedSize,
      ...(imageBase64List.length && { images: imageBase64List }),
      metadata: { aspectRatio: config.aspectRatio },
    };
    logger(`[imageRequest] 使用 gpt 适配器，模型: ${model.modelName}`);
    const response = await fetch(`${baseUrl}/image/generateImage`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`请求失败，状态码: ${response.status}, 错误信息: ${errorText}`);
    }
    const data = await response.json();
    const taskId = data.data;
    const res = await pollTask(async () => {
      const queryResponse = await fetch(`${baseUrl}/image/getImageStatus`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ taskICode: taskId }),
      });
      if (!queryResponse.ok) {
        const errorText = await queryResponse.text();
        throw new Error(`轮询失败，状态码: ${queryResponse.status}, 错误信息: ${errorText}`);
      }
      const queryData = await queryResponse.json();
      const status = queryData?.status ?? queryData?.data?.status;
      switch (status) {
        case "success":
          return { completed: true, data: queryData.data.data };
        case "failed":
          return { completed: true, error: queryData?.data?.failReason ?? "视频生成失败" };
        default:
          return { completed: false };
      }
    });
    return res.data!;
  }

  throw new Error(`不支持的图像模型: ${model.modelName}`);
};

const _videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  const baseUrl = vendor.inputValues.baseUrl;
  const lowerName = model.modelName.toLowerCase();

  const activeMode = config.mode as string | string[];
  const imageRefs = (config.referenceList ?? []).filter((r) => r.type === "image").map((r) => r.base64);
  const videoRefs = (config.referenceList ?? []).filter((r) => r.type === "video").map((r) => r.base64);
  const audioRefs = (config.referenceList ?? []).filter((r) => r.type === "audio").map((r) => r.base64);
  if (imageRefs && imageRefs.length) {
    for (const item of imageRefs) {
      await zipImage(item, 3 * 1024 * 104);
    }
  }
  let metadata: Record<string, any> = {};

  if (lowerName.includes("wan")) {
    if (
      (activeMode === "startEndRequired" ||
        activeMode === "endFrameOptional" ||
        activeMode === "startFrameOptional") &&
      imageRefs.length >= 2
    ) {
      if (imageRefs[0]) metadata.first_frame_url = imageRefs[0];
      if (imageRefs[1]) metadata.last_frame_url = imageRefs[1];
    } else if (imageRefs.length) {
      metadata.img_url = imageRefs[0];
    }
    if (typeof config.audio === "boolean") metadata.audio = config.audio;

    const body: Record<string, any> = {
      model: model.modelName,
      prompt: config.prompt,
      duration: config.duration,
      resolution: config.resolution,
      images: imageRefs,
      metadata,
    };
    logger(`[videoRequest] 提交万象视频任务，模型: ${model.modelName}`);
    const response = await fetch(`${baseUrl}/video/generateVideo`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`请求失败，状态码: ${response.status}, 错误信息: ${errorText}`);
    }
    const data = await response.json();
    const taskId = data.data;
    const res = await pollTask(async () => {
      const queryResponse = await fetch(`${baseUrl}/video/getVideoStatus`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ taskICode: taskId }),
      });
      if (!queryResponse.ok) {
        const errorText = await queryResponse.text();
        throw new Error(`轮询失败，状态码: ${queryResponse.status}, 错误信息: ${errorText}`);
      }
      const queryData = await queryResponse.json();
      const status = queryData?.status ?? queryData?.data?.status;
      switch (status) {
        case "completed":
        case "SUCCESS":
        case "success":
          return { completed: true, data: queryData.data.data };
        case "FAILURE":
        case "failed":
          return { completed: true, error: queryData?.data?.failReason ?? "视频生成失败" };
        default:
          return { completed: false };
      }
    });
    if (res.error) throw new Error(res.error);
    return res.data!;
  }

  if (lowerName.includes("doubao") || lowerName.includes("seedance")) {
    metadata = {
      ...(typeof config.audio === "boolean" && { generate_audio: config.audio }),
      ratio: config.aspectRatio,
      references: [] as any[],
      resolution: config.resolution,
    };
    if (Array.isArray(activeMode)) {
      imageRefs.forEach((item) => {
        metadata.references.push({
          role: "reference_image",
          type: "image_url",
          image_url: { url: item },
        });
      });
      videoRefs.forEach((item) => {
        metadata.references.push({
          role: "reference_video",
          type: "video_url",
          video_url: { url: item },
        });
      });
      audioRefs.forEach((item) => {
        metadata.references.push({
          role: "reference_audio",
          type: "audio_url",
          audio_url: { url: item },
        });
      });
    } else if (
      activeMode === "startEndRequired" ||
      activeMode === "endFrameOptional" ||
      activeMode === "startFrameOptional"
    ) {
      imageRefs.forEach((item, i) => {
        metadata.references.push({
          type: "image_url",
          image_url: { url: item },
          role: i === 0 ? "first_frame" : "last_frame",
        });
      });
    } else if (activeMode === "singleImage") {
      imageRefs.forEach((item) => {
        metadata.references.push({
          role: "reference_image",
          type: "image_url",
          image_url: { url: item },
        });
      });
    }
  } else if (lowerName.includes("vidu")) {
    metadata = { aspect_ratio: config.aspectRatio, audio: config.audio ?? false, off_peak: false };
  } else if (lowerName.includes("kling")) {
    const klingVideoRefs = (config.referenceList ?? [])
      .filter((r) => r.type === "video")
      .map((r) => ({ video_url: r.base64 }));

    metadata = {
      aspect_ratio: config.aspectRatio,
      sound: typeof config?.audio === "boolean" ? (config?.audio ? "on" : "off") : "off",
      video_list: klingVideoRefs,
      image_list: [] as any[],
    };

    const isValidImage = (imageUrl: any) =>
      imageUrl && typeof imageUrl === "string" && imageUrl.trim().length > 0;

    if (activeMode === "singleImage") {
      if (lowerName.includes("omni") || lowerName.includes("o1")) {
        if (isValidImage(imageRefs[0])) {
          metadata.image_list = [{ image_url: imageRefs[0] }];
        }
      } else {
        if (isValidImage(imageRefs[0])) metadata.image = imageRefs[0];
      }
    } else if (
      activeMode === "startEndRequired" ||
      activeMode === "endFrameOptional" ||
      activeMode === "startFrameOptional"
    ) {
      if (lowerName.includes("omni") || lowerName.includes("o1")) {
        imageRefs.forEach((item, index) => {
          if (isValidImage(item)) {
            if (!metadata.image_list || !Array.isArray(metadata.image_list))
              metadata.image_list = [];
            metadata.image_list.push({
              image_url: item,
              type: index === 0 ? "first_frame" : "end_frame",
            });
          }
        });
      } else {
        if (isValidImage(imageRefs[0])) metadata.image_tail = imageRefs[0];
      }
    } else if (Array.isArray(activeMode)) {
      imageRefs.forEach((item) => {
        if (isValidImage(item)) {
          if (!metadata.image_list || !Array.isArray(metadata.image_list))
            metadata.image_list = [];
          metadata.image_list.push({ image_url: item });
        }
      });
    }
  } else if (lowerName.includes("grok")) {
    metadata = { aspectRatio: config.aspectRatio };
  }

  const publicBody: Record<string, any> = {
    model: model.modelName,
    ...(imageRefs.length && lowerName.includes("vidu") ? { images: imageRefs } : {}),
    prompt: config.prompt,
    duration: config.duration,
    resolution: config.resolution,
    metadata,
  };

  logger(`[videoRequest] 提交视频任务，模型: ${model.modelName}`);
  const response = await fetch(`${baseUrl}/video/generateVideo`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(publicBody),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`请求失败，状态码: ${response.status}, 错误信息: ${errorText}`);
  }
  const data = await response.json();
  const taskId = data.data;
  logger(`[videoRequest] 任务ID: ${taskId}`);

  const res = await pollTask(async () => {
    const queryResponse = await fetch(`${baseUrl}/video/getVideoStatus`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ taskICode: taskId }),
    });
    if (!queryResponse.ok) {
      const errorText = await queryResponse.text();
      throw new Error(`轮询失败，状态码: ${queryResponse.status}, 错误信息: ${errorText}`);
    }
    const queryData = await queryResponse.json();
    const status = queryData?.status ?? queryData?.data?.status;
    switch (status) {
      case "completed":
      case "SUCCESS":
      case "success":
        return { completed: true, data: queryData.data.data };
      case "FAILURE":
      case "failed":
        return { completed: true, error: queryData?.data?.failReason ?? "视频生成失败" };
      default:
        return { completed: false };
    }
  });

  if (res.error) throw new Error(res.error);
  return await urlToBase64(res.data!);
};

export const vendorId = "toonflow";

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
  throw new Error("vendor=toonflow 暂不支持 TTS");
}
