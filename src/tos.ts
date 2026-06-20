import { TosClient } from "@volcengine/tos-sdk";

/**
 * TOS 客户端单例 + 预签名 helper。
 *
 * 凭据/区域/Bucket 仅来自后端 process.env，绝不下发客户端。
 * 客户端通过 POST /api/tos/sign 拿临时 URL 完成上传/下载。
 *
 * SDK v2 (2.9.x)：
 *   - getPreSignedUrl 为同步方法，直接返回签名好的 URL 字符串。
 *   - deleteObject / deleteMultiObjects / listObjectsType2 为 async。
 */

const TOS_ACCESS_KEY_ID = process.env.TOS_ACCESS_KEY_ID || "";
const TOS_SECRET_ACCESS_KEY = process.env.TOS_SECRET_ACCESS_KEY || "";
const TOS_ENDPOINT = process.env.TOS_ENDPOINT || "tos-cn-shanghai.volces.com";
const TOS_REGION = process.env.TOS_REGION || "cn-shanghai";
export const TOS_BUCKET = process.env.TOS_BUCKET || "";

if (!TOS_ACCESS_KEY_ID || !TOS_SECRET_ACCESS_KEY || !TOS_BUCKET) {
  // 不抛 —— 单元测试 / 本地非 TOS 场景仍能 import；签名时再判断。
  console.warn("[tos] TOS_ACCESS_KEY_ID / TOS_SECRET_ACCESS_KEY / TOS_BUCKET 未完整配置");
}

export const tosClient = new TosClient({
  accessKeyId: TOS_ACCESS_KEY_ID,
  accessKeySecret: TOS_SECRET_ACCESS_KEY,
  region: TOS_REGION,
  endpoint: TOS_ENDPOINT,
});

const DEFAULT_EXPIRES = 3600;

/** 预签名 PUT URL，客户端可直传。返回 url 字符串。 */
export function signPut(
  key: string,
  _contentType?: string,
  expires: number = DEFAULT_EXPIRES,
): string {
  // SDK 2.9 的 GetPreSignedUrlInput 顶层无 contentType；contentType 通过
  // 客户端 PUT 请求 header 携带（不参与签名）。保留参数仅为路由侧统一。
  return tosClient.getPreSignedUrl({
    method: "PUT",
    bucket: TOS_BUCKET,
    key,
    expires,
  });
}

/** 预签名 GET URL，客户端可直读。 */
export function signGet(key: string, expires: number = DEFAULT_EXPIRES): string {
  return tosClient.getPreSignedUrl({
    method: "GET",
    bucket: TOS_BUCKET,
    key,
    expires,
  });
}

/** 直接调 TOS 删除对象。后端鉴权后内部调用，不下发签名。 */
export async function deleteObject(key: string): Promise<void> {
  await tosClient.deleteObject({ bucket: TOS_BUCKET, key });
}

/**
 * 删除指定 prefix 下的所有对象。用于桌面端 deleteDirectory 兼容。
 * 实现：listObjectsType2 + deleteMultiObjects 翻页循环。
 *
 * 安全约束：prefix 不可为空 / 不可只是 "/"，防止误清空 bucket。
 */
export async function deletePrefix(prefix: string): Promise<number> {
  if (!prefix || prefix === "/") throw new Error("deletePrefix: empty prefix is not allowed");

  let count = 0;
  let continuationToken: string | undefined;

  // 防御：连续 100 页就停（>10w 对象时人肉介入）
  for (let page = 0; page < 100; page += 1) {
    const list = await tosClient.listObjectsType2({
      bucket: TOS_BUCKET,
      prefix,
      maxKeys: 1000,
      continuationToken,
    });
    const data = list.data;
    const contents = data?.Contents || [];
    if (contents.length > 0) {
      const objects = contents.map((c) => ({ key: c.Key }));
      await tosClient.deleteMultiObjects({ bucket: TOS_BUCKET, objects });
      count += objects.length;
    }
    if (!data?.IsTruncated) break;
    continuationToken = data?.NextContinuationToken;
    if (!continuationToken) break;
  }
  return count;
}
