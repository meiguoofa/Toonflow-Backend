// Phase 1 后端 vendor 适配 - 可灵AI
// 原文件：Toonflow-app/data/vendor/klingai.ts
// 客户端 textRequest/imageRequest 都直接 throw，仅 videoRequest 实现完整流程。

import { urlToBase64, pollTask, logger, axios, jsonwebtoken } from "../helpers";

type ReferenceList =
  | { type: "image"; sourceType: "base64"; base64: string }
  | { type: "audio"; sourceType: "base64"; base64: string }
  | { type: "video"; sourceType: "base64"; base64: string };

interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: ReferenceList[];
  audio?: boolean;
  mode: any;
}
type VideoModel = { modelName: string };

const vendor = {
  inputValues: {
    accessKey: "",
    secretKey: "",
    baseUrl: "https://api-beijing.klingai.com",
  } as Record<string, string>,
};

const generateAuthToken = (): string => {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: vendor.inputValues.accessKey, exp: now + 1800, nbf: now - 5 };
  return jsonwebtoken.sign(payload, vendor.inputValues.secretKey, {
    algorithm: "HS256",
    header: { alg: "HS256", typ: "JWT" },
  });
};

const getBaseUrl = (): string => vendor.inputValues.baseUrl || "https://api-beijing.klingai.com";

const extractRawBase64 = (ref: ReferenceList): string =>
  ref.base64.replace(/^data:[^;]+;base64,/, "");

const extractImageUrl = (ref: ReferenceList): string =>
  ref.base64.startsWith("data:") ? ref.base64 : `data:image/jpeg;base64,${ref.base64}`;

const submitAndPoll = async (
  submitUrl: string,
  queryUrlBase: string,
  requestBody: any,
): Promise<string> => {
  const token = generateAuthToken();
  logger(`开始提交可灵AI视频生成任务: ${submitUrl}`);

  const submitResp = await axios.post(submitUrl, requestBody, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  if (submitResp.data.code !== 0) {
    throw new Error(`提交任务失败: ${submitResp.data.message || JSON.stringify(submitResp.data)}`);
  }
  const taskId = submitResp.data.data.task_id;
  logger(`任务已提交，任务ID: ${taskId}`);

  const result = await pollTask(
    async () => {
      const freshToken = generateAuthToken();
      const queryResp = await axios.get(`${queryUrlBase}/${taskId}`, {
        headers: { Authorization: `Bearer ${freshToken}` },
      });
      if (queryResp.data.code !== 0) {
        return { completed: true, error: `查询任务失败: ${queryResp.data.message}` };
      }
      const taskData = queryResp.data.data;
      const status = taskData.task_status;
      logger(`轮询中... 任务状态: ${status}`);
      if (status === "succeed") {
        const videoUrl = taskData.task_result?.videos?.[0]?.url;
        if (!videoUrl) return { completed: true, error: "任务完成但未获取到视频URL" };
        return { completed: true, data: videoUrl };
      }
      if (status === "failed") {
        return { completed: true, error: `视频生成失败: ${taskData.task_status_msg || "未知错误"}` };
      }
      return { completed: false };
    },
    5000,
    600000,
  );

  if (result.error) throw new Error(result.error);
  logger(`视频生成完成，正在转换为Base64...`);
  return await urlToBase64(result.data!);
};

const _videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  if (!vendor.inputValues.accessKey) throw new Error("缺少Access Key");
  if (!vendor.inputValues.secretKey) throw new Error("缺少Secret Key");

  const baseUrl = getBaseUrl();
  const colonIdx = model.modelName.indexOf(":");
  const modelName = colonIdx > -1 ? model.modelName.substring(0, colonIdx) : model.modelName;
  const mode = colonIdx > -1 ? model.modelName.substring(colonIdx + 1) : "pro";

  const isOmniModel = modelName === "kling-video-o1" || modelName === "kling-v3-omni";

  const currentMode = config.mode as any[];
  const isText = currentMode.includes("text");
  const isSingleImage = currentMode.includes("singleImage");
  const isStartEndRequired = currentMode.includes("startEndRequired");
  const isEndFrameOptional = currentMode.includes("endFrameOptional");
  const isStartFrameOptional = currentMode.includes("startFrameOptional");
  const hasMultiRef = Array.isArray(currentMode) && currentMode.some((m) => Array.isArray(m));

  const imageRefs = (config.referenceList || []).filter((r) => r.type === "image");
  const videoRefs = (config.referenceList || []).filter((r) => r.type === "video");

  if (isOmniModel) {
    const requestBody: any = {
      model_name: modelName,
      mode: mode,
      duration: String(config.duration),
      sound: config.audio === true ? "on" : "off",
    };
    if (config.prompt) requestBody.prompt = config.prompt;

    if (isSingleImage && imageRefs.length > 0) {
      const imageUrl = extractImageUrl(imageRefs[0]);
      requestBody.image_list = [{ image_url: imageUrl, type: "first_frame" }];
      if (!requestBody.prompt) requestBody.prompt = "根据图片生成视频";
    } else if (isStartEndRequired && imageRefs.length >= 2) {
      const firstUrl = extractImageUrl(imageRefs[0]);
      const endUrl = extractImageUrl(imageRefs[1]);
      requestBody.image_list = [
        { image_url: firstUrl, type: "first_frame" },
        { image_url: endUrl, type: "end_frame" },
      ];
      if (!requestBody.prompt) requestBody.prompt = "根据首尾帧图片生成过渡视频";
    } else if (isEndFrameOptional && imageRefs.length >= 1) {
      const firstUrl = extractImageUrl(imageRefs[0]);
      requestBody.image_list = [{ image_url: firstUrl, type: "first_frame" }];
      if (imageRefs.length >= 2) {
        const endUrl = extractImageUrl(imageRefs[1]);
        requestBody.image_list.push({ image_url: endUrl, type: "end_frame" });
      }
      if (!requestBody.prompt) requestBody.prompt = "根据图片生成视频";
    } else if (isStartFrameOptional && imageRefs.length >= 1) {
      if (imageRefs.length >= 2) {
        const firstUrl = extractImageUrl(imageRefs[0]);
        const endUrl = extractImageUrl(imageRefs[1]);
        requestBody.image_list = [
          { image_url: firstUrl, type: "first_frame" },
          { image_url: endUrl, type: "end_frame" },
        ];
      } else {
        const endUrl = extractImageUrl(imageRefs[0]);
        requestBody.image_list = [{ image_url: endUrl, type: "end_frame" }];
      }
      if (!requestBody.prompt) requestBody.prompt = "根据图片生成视频";
    } else if (hasMultiRef && (imageRefs.length > 0 || videoRefs.length > 0)) {
      requestBody.image_list = [];
      for (let i = 0; i < imageRefs.length; i++) {
        const imageUrl = extractImageUrl(imageRefs[i]);
        requestBody.image_list.push({ image_url: imageUrl });
      }
      if (!requestBody.prompt) {
        const refs = imageRefs.map((_, idx) => `<<<image_${idx + 1}>>>`).join("、");
        requestBody.prompt = `参考${refs}生成视频`;
      }
    }

    const hasImageInput = requestBody.image_list && requestBody.image_list.length > 0;
    if (!hasImageInput) {
      requestBody.aspect_ratio = config.aspectRatio || "16:9";
      if (!requestBody.prompt) throw new Error("文生视频模式需要提供提示词");
    }

    const apiPath = "/v1/videos/omni-video";
    return await submitAndPoll(`${baseUrl}${apiPath}`, `${baseUrl}${apiPath}`, requestBody);
  }

  if (hasMultiRef && imageRefs.length > 0) {
    const imageList = [];
    for (let i = 0; i < imageRefs.length; i++) {
      const rawBase64 = extractRawBase64(imageRefs[i]);
      imageList.push({ image: rawBase64 });
    }
    const requestBody: any = {
      model_name: modelName,
      image_list: imageList,
      prompt: config.prompt || "根据参考图片生成视频",
      mode: mode,
      duration: String(config.duration),
      aspect_ratio: config.aspectRatio || "16:9",
    };
    const apiPath = "/v1/videos/multi-image2video";
    return await submitAndPoll(`${baseUrl}${apiPath}`, `${baseUrl}${apiPath}`, requestBody);
  }

  if (isText) {
    if (!config.prompt) throw new Error("文生视频模式需要提供提示词");
    const requestBody: any = {
      model_name: modelName,
      prompt: config.prompt,
      mode: mode,
      duration: String(config.duration),
      aspect_ratio: config.aspectRatio || "16:9",
      sound: config.audio === true ? "on" : "off",
    };
    const apiPath = "/v1/videos/text2video";
    return await submitAndPoll(`${baseUrl}${apiPath}`, `${baseUrl}${apiPath}`, requestBody);
  }

  if (
    (isSingleImage || isStartEndRequired || isEndFrameOptional || isStartFrameOptional) &&
    imageRefs.length > 0
  ) {
    const requestBody: any = {
      model_name: modelName,
      prompt: config.prompt || "根据图片生成视频",
      mode: mode,
      duration: String(config.duration),
      sound: config.audio === true ? "on" : "off",
    };
    if (isSingleImage) {
      requestBody.image = extractRawBase64(imageRefs[0]);
    } else if (isStartEndRequired && imageRefs.length >= 2) {
      requestBody.image = extractRawBase64(imageRefs[0]);
      requestBody.image_tail = extractRawBase64(imageRefs[1]);
    } else if (isEndFrameOptional) {
      requestBody.image = extractRawBase64(imageRefs[0]);
      if (imageRefs.length >= 2) requestBody.image_tail = extractRawBase64(imageRefs[1]);
    } else if (isStartFrameOptional) {
      if (imageRefs.length >= 2) {
        requestBody.image = extractRawBase64(imageRefs[0]);
        requestBody.image_tail = extractRawBase64(imageRefs[1]);
      } else {
        requestBody.image = extractRawBase64(imageRefs[0]);
      }
    }
    const apiPath = "/v1/videos/image2video";
    return await submitAndPoll(`${baseUrl}${apiPath}`, `${baseUrl}${apiPath}`, requestBody);
  }

  throw new Error("不支持的视频生成模式或缺少必要的输入参数");
};

export const vendorId = "klingai";

export async function imageRequest(
  _config: any,
  _model: any,
  _inputValues: Record<string, string>,
): Promise<string> {
  // 客户端 klingai.imageRequest 直接抛错，保持一致
  throw new Error("可灵AI不支持图片模型");
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
  throw new Error("vendor=klingai 暂不支持 TTS");
}
