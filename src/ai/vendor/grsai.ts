// Phase 1 后端 vendor 适配 - GRsai
// 原文件：Toonflow-app/data/vendor/grsai.ts
// 客户端 image/video 都已实现（fetch），TTS 空实现。

import { urlToBase64, pollTask, logger } from "../helpers";

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
  inputValues: { apiKey: "", baseUrl: "https://grsai.dakka.com.cn" } as Record<string, string>,
};

const getHeaders = () => {
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  return { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
};

const _imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const baseUrl = vendor.inputValues.baseUrl;
  const headers = getHeaders();

  const requestBody: any = {
    model: model.modelName,
    prompt: config.prompt,
    aspectRatio: config.aspectRatio,
    webHook: "-1",
    shutProgress: true,
  };

  if (model.modelName.startsWith("nano-banana")) {
    requestBody.imageSize = config.size;
  } else {
    requestBody.size = config.aspectRatio;
    requestBody.variants = 1;
  }

  if (config.referenceList && config.referenceList.length > 0) {
    requestBody.urls = config.referenceList.map((img) => img.base64);
  }

  const apiPath = model.modelName.startsWith("nano-banana")
    ? "/v1/draw/nano-banana"
    : "/v1/draw/completions";

  logger(`开始提交图片生成任务，模型：${model.modelName}`);
  const submitResp = await fetch(`${baseUrl}${apiPath}`, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });
  if (!submitResp.ok) {
    const errorReason = await submitResp.text();
    throw new Error(`任务提交失败：${errorReason}`);
  }
  const submitData = await submitResp.json();
  if (submitData.code !== 0) throw new Error(`任务提交失败：${submitData.msg}`);

  const taskId = submitData.data.id;
  logger(`图片任务提交成功，任务ID：${taskId}`);

  const pollResult = await pollTask(
    async () => {
      const resp = await fetch(`${baseUrl}/v1/draw/result`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: taskId }),
      });
      if (!resp.ok) {
        const errorReason = await resp.text();
        throw new Error(`查询任务失败：${errorReason}`);
      }
      const respData = await resp.json();
      if (respData.code !== 0) return { completed: true, error: respData.msg };

      const taskData = respData.data;
      if (taskData.status === "failed")
        return { completed: true, error: taskData.failure_reason || taskData.error };
      if (taskData.status === "succeeded") {
        const imgUrl = taskData.results?.[0]?.url || taskData.url;
        return { completed: true, data: imgUrl };
      }
      logger(`图片任务生成中，进度：${taskData.progress}%`);
      return { completed: false };
    },
    3000,
    600000,
  );

  if (pollResult.error) throw new Error(pollResult.error);
  logger(`图片生成完成，开始转换Base64`);
  return await urlToBase64(pollResult.data!);
};

const _videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const baseUrl = vendor.inputValues.baseUrl;
  const headers = getHeaders();

  const requestBody: any = {
    model: model.modelName,
    prompt: config.prompt,
    aspectRatio: config.aspectRatio,
    webHook: "-1",
    shutProgress: true,
  };

  if (config.referenceList && config.referenceList.length > 0) {
    const imageRefs = config.referenceList.filter((item) => item.type === "image") as Extract<
      ReferenceList,
      { type: "image" }
    >[];
    const modeArr = Array.isArray(config.mode) ? (config.mode as any[]) : [config.mode];
    if (modeArr.includes("endFrameOptional") && imageRefs.length >= 1) {
      requestBody.firstFrameUrl = imageRefs[0].base64;
      if (imageRefs.length >= 2) requestBody.lastFrameUrl = imageRefs[1].base64;
    } else if (modeArr.some((m: any) => Array.isArray(m) && m.includes("imageReference:3"))) {
      requestBody.urls = imageRefs.map((img) => img.base64);
    }
  }

  logger(`开始提交视频生成任务，模型：${model.modelName}`);
  const submitResp = await fetch(`${baseUrl}/v1/video/veo`, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });
  if (!submitResp.ok) {
    const errorReason = await submitResp.text();
    throw new Error(`任务提交失败： ${errorReason}`);
  }
  const submitData = await submitResp.json();
  if (submitData.code !== 0) throw new Error(`任务提交失败：${submitData.msg}`);

  const taskId = submitData.data.id;
  logger(`视频任务提交成功，任务ID：${taskId}`);

  const pollResult = await pollTask(
    async () => {
      const resp = await fetch(`${baseUrl}/v1/draw/result`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: taskId }),
      });
      if (!resp.ok) {
        const errorReason = await resp.text();
        throw new Error(`查询视频任务失败 ${errorReason}`);
      }
      const respData = await resp.json();
      logger(respData);
      if (respData.code !== 0) return { completed: true, error: respData.msg };

      const taskData = respData.data;
      if (taskData.status === "failed")
        return { completed: true, error: taskData.failure_reason || taskData.error };
      if (taskData.status === "succeeded") {
        return { completed: true, data: taskData.url };
      }
      logger(`视频任务生成中，进度：${taskData.progress}%`);
      return { completed: false };
    },
    5000,
    1800000,
  );

  if (pollResult.error) throw new Error(pollResult.error);
  return await urlToBase64(pollResult.data!);
};

export const vendorId = "grsai";

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
  throw new Error("vendor=grsai 暂不支持 TTS");
}
