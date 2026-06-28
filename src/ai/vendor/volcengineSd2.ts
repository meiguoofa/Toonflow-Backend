// Phase 1 后端 vendor 适配 - 火山引擎 sd2.0 真人
// 原文件：Toonflow-app/data/vendor/volcengineSd2.ts
// 客户端只实现了 videoRequest（带 TOS 上传 + 资产 polling + 视频任务 polling）。

import { urlToBase64, pollTask, logger, crypto } from "../helpers";

const fetch: any = (globalThis as any).fetch;

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
type VideoModel = { modelName: string; audio: "optional" | true | false };

interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}

const SERVICE = "ark";
const VERSION = "2024-01-01";
const REGION = "cn-beijing";
const HOST = "ark.cn-beijing.volcengineapi.com";
const CONTENT_TYPE = "application/json";
const SIGNED_HEADERS = "content-type;host;x-content-sha256;x-date";
const PATH = "/";

const vendor = {
  inputValues: {
    apiKey: "",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    ak: "",
    sk: "",
    groupId: "",
    tosEndpoint: "",
    tosBucket: "",
  } as Record<string, string>,
};

function deriveSigningKey(shortDate: string) {
  const kDate = crypto.createHmac("sha256", vendor.inputValues.sk).update(shortDate).digest();
  const kRegion = crypto.createHmac("sha256", kDate).update(REGION).digest();
  const kService = crypto.createHmac("sha256", kRegion).update(SERVICE).digest();
  return crypto.createHmac("sha256", kService).update("request").digest();
}
function encodeQueryComponent(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A");
}
function buildQueryString(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((key) => {
      const value = params[key];
      return value === ""
        ? encodeQueryComponent(key)
        : `${encodeQueryComponent(key)}=${encodeQueryComponent(value)}`;
    })
    .join("&");
}

async function request(
  action: string,
  body: Record<string, unknown>,
  method: "GET" | "POST" = "POST",
  header: Record<string, string> = {},
): Promise<any> {
  const bodyStr = JSON.stringify(body);
  const sortedQuery = Object.fromEntries(
    Object.entries({ Action: action, Version: VERSION }).sort(([a], [b]) => a.localeCompare(b)),
  );
  const date = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const shortDate = date.slice(0, 8);
  const xContentSha256 = crypto.createHash("sha256").update(bodyStr).digest("hex");

  const queryString = buildQueryString(sortedQuery as Record<string, string>);
  const canonicalRequest = [
    method,
    PATH,
    queryString,
    `content-type:${CONTENT_TYPE}`,
    `host:${HOST}`,
    `x-content-sha256:${xContentSha256}`,
    `x-date:${date}`,
    "",
    SIGNED_HEADERS,
    xContentSha256,
  ].join("\n");

  const hashedCanonicalRequest = crypto.createHash("sha256").update(canonicalRequest).digest("hex");
  const credentialScope = `${shortDate}/${REGION}/${SERVICE}/request`;
  const stringToSign = `HMAC-SHA256\n${date}\n${credentialScope}\n${hashedCanonicalRequest}`;
  const signingKey = deriveSigningKey(shortDate);
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const authorization = `HMAC-SHA256 Credential=${vendor.inputValues.ak}/${credentialScope}, SignedHeaders=${SIGNED_HEADERS}, Signature=${signature}`;
  const headers: Record<string, string> = {
    Host: HOST,
    "X-Content-Sha256": xContentSha256,
    "X-Date": date,
    "Content-Type": CONTENT_TYPE,
    Authorization: authorization,
    ...header,
  };
  return fetch(`https://${HOST}${PATH}?${queryString}`, { method, headers, body: bodyStr });
}

// TOS V4 签名
const TOS_SIGNING_ALGORITHM = "TOS4-HMAC-SHA256";
function getTosRegion(): string {
  const ep = (vendor.inputValues.tosEndpoint || "").trim();
  const match = ep.match(/tos-([^.]+)\.volces\.com/);
  return match ? match[1] : "cn-beijing";
}
function tosTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}
function tosDateFromTimestamp(ts: string): string {
  return ts.slice(0, 8);
}
function tosBucket(): string {
  return (vendor.inputValues.tosBucket || "").trim();
}
function tosEndpoint(): string {
  return (vendor.inputValues.tosEndpoint || "").trim();
}
function tosAk(): string {
  return (vendor.inputValues.ak || "").trim();
}
function tosSk(): string {
  return (vendor.inputValues.sk || "").trim();
}
function hasCompleteTosConfig(): boolean {
  return Boolean(tosEndpoint() && tosBucket() && tosAk() && tosSk());
}
function tosSecurityToken(): string {
  return (vendor.inputValues.securityToken || vendor.inputValues.sessionToken || "").trim();
}
function getStorageProvider(): "tos" {
  if (hasCompleteTosConfig()) return "tos";
  throw new Error("未检测到可用对象存储配置，请填写完整的 TOS 配置");
}
function tosUriEncode(str: string, encodeSlash: boolean = false): string {
  const encoded = encodeURIComponent(str)
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A");
  return encodeSlash ? encoded : encoded.replace(/%2F/gi, "/");
}
function tosCanonicalQueryString(params: Record<string, string>): string {
  if (!Object.keys(params).length) return "";
  return Object.keys(params)
    .sort()
    .map((k) => `${tosUriEncode(k, true)}=${tosUriEncode(params[k], true)}`)
    .join("&");
}
function tosSigningKey(date: string, region: string, sk: string): Buffer {
  const kDate = crypto.createHmac("sha256", Buffer.from(sk, "utf8")).update(date, "utf8").digest();
  const kRegion = crypto.createHmac("sha256", kDate).update(region, "utf8").digest();
  const kService = crypto.createHmac("sha256", kRegion).update("tos", "utf8").digest();
  return crypto.createHmac("sha256", kService).update("request", "utf8").digest();
}
function tosSign(
  method: string,
  objectKey: string,
  queryParams: Record<string, string>,
  headers: Record<string, string>,
  payloadHash: string,
  timestamp: string,
): { authorization: string; canonicalRequest: string; stringToSign: string } {
  const region = getTosRegion();
  const date = tosDateFromTimestamp(timestamp);
  const scope = `${date}/${region}/tos/request`;
  const normalizedHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) normalizedHeaders[k.toLowerCase()] = v.trim();
  const signedHeaderKeys = Object.keys(normalizedHeaders).sort();
  const canonicalHeaders = signedHeaderKeys.map((k) => `${k}:${normalizedHeaders[k]}\n`).join("");
  const signedHeaders = signedHeaderKeys.join(";");
  const canonicalRequest = [
    method,
    `/${tosUriEncode(objectKey)}`,
    tosCanonicalQueryString(queryParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const hashedCanonicalRequest = crypto.createHash("sha256").update(canonicalRequest).digest("hex");
  const stringToSign = [TOS_SIGNING_ALGORITHM, timestamp, scope, hashedCanonicalRequest].join("\n");
  const signingKey = tosSigningKey(date, region, tosSk());
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  return {
    authorization: `${TOS_SIGNING_ALGORITHM} Credential=${tosAk()}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    canonicalRequest,
    stringToSign,
  };
}
async function tosFileExists(objectKey: string): Promise<boolean> {
  const bucket = tosBucket();
  const endpoint = tosEndpoint();
  if (!bucket || !endpoint || !tosAk() || !tosSk()) return false;
  const host = `${bucket}.${endpoint}`;
  const timestamp = tosTimestamp();
  const payloadHash = "UNSIGNED-PAYLOAD";
  const token = tosSecurityToken();
  const headers: Record<string, string> = {
    host,
    "x-tos-content-sha256": payloadHash,
    "x-tos-date": timestamp,
  };
  if (token) headers["x-tos-security-token"] = token;
  const { authorization } = tosSign("HEAD", objectKey, {}, headers, payloadHash, timestamp);
  const reqHeaders: Record<string, string> = {
    host,
    "x-tos-content-sha256": payloadHash,
    "x-tos-date": timestamp,
    Authorization: authorization,
  };
  if (token) reqHeaders["x-tos-security-token"] = token;
  const res = await fetch(`https://${host}/${tosUriEncode(objectKey)}`, {
    method: "HEAD",
    headers: reqHeaders,
  });
  if (res.status === 404) return false;
  return res.ok;
}
async function tosUpload(objectKey: string, data: Buffer, contentType: string): Promise<void> {
  const bucket = tosBucket();
  const endpoint = tosEndpoint();
  if (!bucket || !endpoint || !tosAk() || !tosSk()) throw new Error("TOS 配置不完整");
  const host = `${bucket}.${endpoint}`;
  const timestamp = tosTimestamp();
  const payloadHash = crypto.createHash("sha256").update(data).digest("hex");
  const token = tosSecurityToken();
  const headers: Record<string, string> = {
    "content-type": contentType,
    host,
    "x-tos-content-sha256": payloadHash,
    "x-tos-date": timestamp,
  };
  if (token) headers["x-tos-security-token"] = token;
  const { authorization } = tosSign("PUT", objectKey, {}, headers, payloadHash, timestamp);
  const reqHeaders: Record<string, string> = {
    "Content-Type": contentType,
    host,
    "x-tos-content-sha256": payloadHash,
    "x-tos-date": timestamp,
    Authorization: authorization,
  };
  if (token) reqHeaders["x-tos-security-token"] = token;
  const res = await fetch(`https://${host}/${tosUriEncode(objectKey)}`, {
    method: "PUT",
    headers: reqHeaders,
    body: data,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => `${res.status} ${res.statusText}`);
    throw new Error(`TOS 上传失败: ${errText}`);
  }
}
function tosGetSignedUrl(objectKey: string, expiresIn: number = 7200): string {
  const bucket = tosBucket();
  const endpoint = tosEndpoint();
  const host = `${bucket}.${endpoint}`;
  const region = getTosRegion();
  const timestamp = tosTimestamp();
  const date = tosDateFromTimestamp(timestamp);
  const scope = `${date}/${region}/tos/request`;
  const token = tosSecurityToken();
  const queryParams: Record<string, string> = {
    "X-Tos-Algorithm": TOS_SIGNING_ALGORITHM,
    "X-Tos-Credential": `${tosAk()}/${scope}`,
    "X-Tos-Date": timestamp,
    "X-Tos-Expires": String(expiresIn),
    "X-Tos-SignedHeaders": "host",
  };
  if (token) queryParams["X-Tos-Security-Token"] = token;
  const canonicalRequest = [
    "GET",
    `/${tosUriEncode(objectKey)}`,
    tosCanonicalQueryString(queryParams),
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const hashedCanonicalRequest = crypto.createHash("sha256").update(canonicalRequest).digest("hex");
  const stringToSign = [TOS_SIGNING_ALGORITHM, timestamp, scope, hashedCanonicalRequest].join("\n");
  const signingKey = tosSigningKey(date, region, tosSk());
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const finalQuery = tosCanonicalQueryString({ ...queryParams, "X-Tos-Signature": signature });
  return `https://${host}/${tosUriEncode(objectKey)}?${finalQuery}`;
}

function parseBase64(base64: string): { mimeType: string; ext: string; data: string } {
  const match = base64.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return { mimeType: "application/octet-stream", ext: "bin", data: base64 };
  const mimeType = match[1];
  const extMap: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/bmp": "bmp",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/ogg": "ogg",
    "audio/aac": "aac",
  };
  return { mimeType, ext: extMap[mimeType] || "bin", data: match[2] };
}

async function uploadAssets(source: string, type: "Image" | "Video" | "Audio"): Promise<string | null> {
  try {
    const { mimeType, ext, data: rawBase64 } = parseBase64(source);
    const buffer = Buffer.from(rawBase64, "base64");
    const hash = crypto.createHash("sha256").update(source).digest("hex");

    const provider = getStorageProvider();
    logger(provider);
    const objectKey = `volcengine/${type.toLowerCase()}/${hash}.${ext}`;

    let assetUrl: string;
    const exists = await tosFileExists(objectKey);
    if (!exists) {
      logger(`[TOS] 上传文件: ${objectKey} (${mimeType})`);
      await tosUpload(objectKey, buffer, mimeType);
    } else {
      logger(`[TOS] 文件已存在，跳过上传: ${objectKey}`);
    }
    assetUrl = tosGetSignedUrl(objectKey, 7200);

    const res = await request("CreateAsset", {
      GroupId: vendor.inputValues.groupId,
      URL: assetUrl,
      Name: hash,
      AssetType: type,
    });
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`创建资产失败: ${errorText}`);
    }
    const resData = await res.json();
    const assetId: string = resData.Result.Id;
    logger(`资产已创建: ${assetId}`);

    const result = await pollTask(
      async (): Promise<PollResult> => {
        const queryRes = await request("GetAsset", { Id: assetId, AssetType: type });
        if (!queryRes.ok) {
          const errorText = await queryRes.text();
          throw new Error(`查询资产状态失败: ${errorText}`);
        }
        const task = await queryRes.json();
        const status: string = task.Result.Status;
        switch (status) {
          case "Active":
            return { completed: true, data: assetId };
          case "Failed":
            return { completed: true, error: task.Result.Error?.Message || "资产创建失败" };
          default:
            return { completed: false };
        }
      },
      10000,
      600000 * 3,
    );

    if (result.error) throw new Error(result.error);
    return `asset://${result.data}`;
  } catch (err: any) {
    const msg = typeof err?.message === "string" ? err.message : String(err);
    logger(`[uploadAssets] 上传失败: ${msg}`);
    return source;
  }
}

const getHeaders = () => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "")}`,
  };
};
const getBaseUrl = () => vendor.inputValues.baseUrl.replace(/\/+$/, "");

const _videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  const baseUrl = getBaseUrl();
  const headers = getHeaders();
  const content: any[] = [];
  if (config.prompt) content.push({ type: "text", text: config.prompt });

  if (typeof config.mode === "string") {
    switch (config.mode) {
      case "singleImage": {
        const firstImage = config.referenceList?.find((r) => r.type === "image");
        if (firstImage)
          content.push({
            type: "image_url",
            image_url: { url: firstImage.base64 },
            role: "first_frame",
          });
        break;
      }
      case "startFrameOptional":
      case "endFrameOptional": {
        const images = config.referenceList?.filter((r) => r.type === "image") ?? [];
        if (images.length > 0) {
          content.push({
            type: "image_url",
            image_url: { url: images[0].base64 },
            role: "first_frame",
          });
          if (images.length > 1)
            content.push({
              type: "image_url",
              image_url: { url: images[1].base64 },
              role: "last_frame",
            });
        }
        break;
      }
      case "startEndRequired": {
        const images = config.referenceList?.filter((r) => r.type === "image") ?? [];
        if (images.length >= 2) {
          content.push({
            type: "image_url",
            image_url: { url: images[0].base64 },
            role: "first_frame",
          });
          content.push({
            type: "image_url",
            image_url: { url: images[1].base64 },
            role: "last_frame",
          });
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
            content.push({
              type: "image_url",
              image_url: { url: await uploadAssets(ref.base64, "Image") },
              role: "reference_image",
            });
          }
        } else if (refDef.startsWith("videoReference:")) {
          const maxCount = parseInt(refDef.split(":")[1], 10);
          for (const ref of videoRefs.slice(0, maxCount)) {
            content.push({
              type: "video_url",
              video_url: { url: await uploadAssets(ref.base64, "Video") },
              role: "reference_video",
            });
          }
        } else if (refDef.startsWith("audioReference:")) {
          const maxCount = parseInt(refDef.split(":")[1], 10);
          for (const ref of audioRefs.slice(0, maxCount)) {
            content.push({
              type: "audio_url",
              audio_url: { url: await uploadAssets(ref.base64, "Audio") },
              role: "reference_audio",
            });
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

  logger(`[视频生成] 提交任务, 模型: ${model.modelName}, 时长: ${config.duration}s`);
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
  // 客户端原样返回 result.data!（URL 字符串）；这里转 base64 与 AiVideo.run 后续处理一致
  return await urlToBase64(result.data!);
};

export const vendorId = "volcengineSd2";

export async function imageRequest(
  _config: any,
  _model: any,
  _inputValues: Record<string, string>,
): Promise<string> {
  throw new Error("vendor=volcengineSd2 不支持图片生成（客户端原版亦未实现）");
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
  throw new Error("vendor=volcengineSd2 暂不支持 TTS");
}
