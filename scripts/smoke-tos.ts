/**
 * Stream C smoke：登录 → /api/tos/sign?op=put → PUT TOS → /api/tos/sign?op=get → GET → 校验内容。
 *
 * 不实际跑（环境无 TOS 凭据 / 后端实例）。
 * 触发：ts-node scripts/smoke-tos.ts
 */

import { randomBytes, createHash } from "node:crypto";

const BASE_URL = process.env.SMOKE_BASE_URL || "http://localhost:4000";
const SEED_NAME = process.env.SMOKE_USER || "admin";
const SEED_PASSWORD = process.env.SMOKE_PASSWORD || "admin123";

async function login(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: SEED_NAME, password: SEED_PASSWORD }),
  });
  const json: any = await res.json();
  if (json.code !== 0 || !json.data?.token) throw new Error(`login: ${JSON.stringify(json)}`);
  return json.data.token;
}

async function sign(token: string, body: any): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/tos/sign`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json: any = await res.json();
  if (json.code !== 0) throw new Error(`/api/tos/sign ${JSON.stringify(body)}: ${JSON.stringify(json)}`);
  return json.data;
}

async function main() {
  const token = await login();
  console.log("[smoke] login ok");

  const buf = randomBytes(1024);
  const hashIn = createHash("sha256").update(buf).digest("hex");
  const key = `smoke/${Date.now()}-${randomBytes(4).toString("hex")}.bin`;
  const contentType = "application/octet-stream";

  // 1. PUT 签名 + 上传
  const putData = await sign(token, { op: "put", key, contentType });
  const putRes = await fetch(putData.url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: buf,
  });
  if (!putRes.ok) throw new Error(`PUT failed: ${putRes.status} ${await putRes.text()}`);
  console.log("[smoke] PUT ok, key=", key);

  // 2. GET 签名 + 下载 + 校验
  const getData = await sign(token, { op: "get", key });
  const getRes = await fetch(getData.url);
  if (!getRes.ok) throw new Error(`GET failed: ${getRes.status}`);
  const got = Buffer.from(await getRes.arrayBuffer());
  const hashOut = createHash("sha256").update(got).digest("hex");
  if (hashIn !== hashOut) throw new Error(`hash mismatch: in=${hashIn} out=${hashOut}`);
  console.log("[smoke] GET ok, hash matches");

  // 3. 清理
  await sign(token, { op: "delete", key });
  console.log("[smoke] delete ok");
}

main().catch((e) => {
  console.error("[smoke] FAILED:", e);
  process.exit(1);
});
