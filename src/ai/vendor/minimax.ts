// Phase 1 后端 vendor 适配 - MiniMax(海螺AI)
// 原文件：Toonflow-app/data/vendor/minimax.ts
// 客户端 image/video 已实现（用 axios），TTS 空实现。
//
// 注意：vendor 内部依赖 zipImage 把图片压到 ≤20MB。后端 helpers.zipImage 当前是 noop，
// 如客户端上来的 referenceList 已经是预压缩过的就没问题；超大图会原样上传给 MiniMax，
// 触发 MiniMax 端的 size limit。
// TODO(phase1-port): 实现真正的图片压缩（sharp）以匹配客户端行为。

import { urlToBase64, pollTask, logger, axios, zipImage } from "../helpers";

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
  inputValues: { apiKey: "", baseUrl: "https://api.minimaxi.com" } as Record<string, string>,
};

const getHeaders = (): Record<string, string> => {
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
};

const getBaseUrl = (): string => vendor.inputValues.baseUrl.replace(/\/$/, "");

const extractBase64WithHead = (ref: ReferenceList): string =>
  ref.base64.startsWith("data:") ? ref.base64 : `data:image/png;base64,${ref.base64}`;

const _imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const baseUrl = getBaseUrl();
  const headers = getHeaders();

  const reqBody: any = {
    model: model.modelName,
    prompt: config.prompt,
    aspect_ratio: config.aspectRatio,
    response_format: "base64",
    n: 1,
    prompt_optimizer: true,
    aigc_watermark: false,
  };

  const imageRefs = config.referenceList || [];
  if (imageRefs.length > 0) {
    const refBase64 = extractBase64WithHead(imageRefs[0]);
    reqBody.subject_reference = [{ type: "character", image_file: refBase64 }];
  }

  logger("开始提交MiniMax图像生成任务");
  const resp = await axios.post(`${baseUrl}/v1/image_generation`, reqBody, { headers });
  if (resp.data.base_resp.status_code !== 0) {
    throw new Error(`图像生成失败：${resp.data.base_resp.status_msg}`);
  }
  if (resp.data.metadata.success_count === 0) {
    throw new Error("图像生成被安全策略拦截，请调整prompt或参考图");
  }

  const imgBase64 = resp.data.data.image_base64[0];
  return imgBase64.startsWith("data:") ? imgBase64 : `data:image/png;base64,${imgBase64}`;
};

const _videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const baseUrl = getBaseUrl();
  const headers = getHeaders();

  const reqBody: any = {
    model: model.modelName,
    prompt: config.prompt,
    duration: config.duration,
    resolution: config.resolution,
    aigc_watermark: false,
    prompt_optimizer: true,
  };

  const imageRefs = (config.referenceList || []).filter((r) => r.type === "image");

  if (imageRefs.length > 0) {
    const compressedImages: string[] = [];
    for (const ref of imageRefs) {
      const base64 = extractBase64WithHead(ref);
      const compressed = await zipImage(base64, 20 * 1024);
      compressedImages.push(compressed);
    }
    const modeArr = Array.isArray(config.mode) ? (config.mode as any[]) : [config.mode];
    if (modeArr.includes("startEndRequired")) {
      if (compressedImages.length < 2) throw new Error("首尾帧模式需要上传两张图片");
      reqBody.first_frame_image = compressedImages[0];
      reqBody.last_frame_image = compressedImages[1];
    } else if (modeArr.includes("singleImage")) {
      reqBody.first_frame_image = compressedImages[0];
    }
  }

  logger("开始提交MiniMax视频生成任务");
  const submitResp = await axios.post(`${baseUrl}/v1/video_generation`, reqBody, { headers });
  if (submitResp.data.base_resp.status_code !== 0) {
    throw new Error(`任务提交失败：${submitResp.data.base_resp.status_msg}`);
  }
  const taskId = submitResp.data.task_id;
  logger(`视频任务提交成功，任务ID: ${taskId}`);

  const pollResult = await pollTask(
    async () => {
      const queryResp = await axios.get(`${baseUrl}/v1/query/video_generation`, {
        headers: getHeaders(),
        params: { task_id: taskId },
      });
      if (queryResp.data.base_resp.status_code !== 0) {
        return { completed: true, error: queryResp.data.base_resp.status_msg };
      }
      const status = queryResp.data.status;
      if (status === "Success") return { completed: true, data: queryResp.data.file_id };
      if (status === "Fail") return { completed: true, error: "视频生成失败" };
      logger(`视频任务生成中，当前状态：${status}`);
      return { completed: false };
    },
    5000,
    600000,
  );

  if (pollResult.error) throw new Error(pollResult.error);
  const fileId = pollResult.data!;
  logger(`视频任务生成成功，文件ID: ${fileId}`);

  const fileResp = await axios.get(`${baseUrl}/v1/files/retrieve`, {
    headers: getHeaders(),
    params: { file_id: fileId },
  });
  if (fileResp.data.base_resp.status_code !== 0) {
    throw new Error(`获取文件地址失败：${fileResp.data.base_resp.status_msg}`);
  }
  const downloadUrl = fileResp.data.file.download_url;
  logger(`视频下载地址获取成功，开始转Base64`);

  return await urlToBase64(downloadUrl);
};

export const vendorId = "minimax";

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
  throw new Error("vendor=minimax 暂不支持 TTS");
}
