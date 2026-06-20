/**
 * Stream D smoke：登录 → 拿 token → 用 token 调 /api/db/query 查 o_user first
 *
 * 不实际跑（运行需要：后端启动 + Stream B 的 /api/db/query 已落地）。
 * 用 ts-node scripts/smoke-auth.ts 触发。
 */

const BASE_URL = process.env.SMOKE_BASE_URL || "http://localhost:4000";
const SEED_NAME = process.env.SMOKE_USER || "admin";
const SEED_PASSWORD = process.env.SMOKE_PASSWORD || "admin123";

async function main() {
  // 1. 登录
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: SEED_NAME, password: SEED_PASSWORD }),
  });
  const loginJson: any = await loginRes.json();
  if (loginJson.code !== 0 || !loginJson.data?.token) {
    throw new Error(`login failed: ${JSON.stringify(loginJson)}`);
  }
  const token: string = loginJson.data.token;
  const loggedInUser = loginJson.data.user;
  console.log("[smoke] login ok:", loggedInUser);

  // 2. 用 token 调 /api/db/query 查 o_user first
  const queryRes = await fetch(`${BASE_URL}/api/db/query`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    // 协议详见 docs/db-proxy-protocol.md（Stream B 落地）
    body: JSON.stringify({ table: "o_user", op: "first", where: {} }),
  });
  const queryJson: any = await queryRes.json();
  if (queryJson.code !== 0) {
    throw new Error(`db query failed: ${JSON.stringify(queryJson)}`);
  }
  const row = queryJson.data;
  if (!row || Number(row.id) !== Number(loggedInUser.id)) {
    throw new Error(`id mismatch: login=${loggedInUser.id} db=${row?.id}`);
  }
  console.log("[smoke] db query ok, id matches:", row.id);
}

main().catch((e) => {
  console.error("[smoke] FAILED:", e);
  process.exit(1);
});
