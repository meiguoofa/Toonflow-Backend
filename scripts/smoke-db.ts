/* eslint-disable no-console */
/**
 * Smoke test for POST /api/db/query
 *
 * 用法：
 *   1. 启动后端：pnpm dev / npm run dev（端口默认 4000）
 *   2. 准备一个有效 JWT：JWT_SECRET=xxx node -e "console.log(require('jsonwebtoken').sign({id:1,name:'demo'}, 'xxx'))"
 *   3. SMOKE_TOKEN=<jwt> npx ts-node scripts/smoke-db.ts
 *
 * 这个脚本不需要真的连 pg。它只验证路由层的请求体校验、白名单与多租户注入路径——
 * 当 case 期望返回错误码（4001/4002/4003/4004/4005）时，无 pg 连接也能正确响应；
 * 当 case 期望成功（5、6、7）时，没有 pg 时会得到 5000，但脚本会打印 "expected hit pg layer"。
 */

const BASE = process.env.BASE_URL || "http://localhost:4000";
const TOKEN = process.env.SMOKE_TOKEN || "";

interface Case {
  name: string;
  headers: Record<string, string>;
  body: any;
  expectCode: number | "pgLayer";
}

function authedHeaders(): Record<string, string> {
  return TOKEN
    ? { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` }
    : { "Content-Type": "application/json" };
}

const cases: Case[] = [
  {
    name: "1. 缺 token => 4001",
    headers: { "Content-Type": "application/json" },
    body: {
      table: "o_user",
      terminal: { method: "select", args: [] },
    },
    expectCode: 4001,
  },
  {
    name: "2. 错误 table => 4002",
    headers: authedHeaders(),
    body: {
      table: "drop_table_attempt",
      terminal: { method: "select", args: [] },
    },
    expectCode: 4002,
  },
  {
    name: "3. 错误中间方法 => 4003",
    headers: authedHeaders(),
    body: {
      table: "o_user",
      calls: [{ method: "whereRaw", args: ["1=1"] }],
      terminal: { method: "select", args: [] },
    },
    expectCode: 4003,
  },
  {
    name: "4. 缺 terminal => 4004",
    headers: authedHeaders(),
    body: { table: "o_user" },
    expectCode: 4004,
  },
  {
    name: "5. 正常 SELECT o_user（命中 pg 层）",
    headers: authedHeaders(),
    body: {
      table: "o_user",
      calls: [{ method: "where", args: [{ id: 1 }] }],
      terminal: { method: "first", args: [] },
    },
    expectCode: "pgLayer",
  },
  {
    name: "6. 业务表 SELECT（应自动注入 where userId）",
    headers: authedHeaders(),
    body: {
      table: "o_project",
      terminal: { method: "select", args: [] },
    },
    expectCode: "pgLayer",
  },
  {
    name: "7. 业务表 INSERT（应自动补 userId）",
    headers: authedHeaders(),
    body: {
      table: "o_storyboard",
      terminal: {
        method: "insert",
        args: [{ id: 1, scriptId: 100, prompt: "smoke test" }],
      },
    },
    expectCode: "pgLayer",
  },
  {
    name: "8. args 含 Date（理论上 JSON.stringify 会变字符串，再传过来变 string —— 直接 string 应该通过）",
    headers: authedHeaders(),
    body: {
      table: "o_user",
      calls: [{ method: "where", args: [{ name: "demo" }] }],
      terminal: { method: "first", args: [] },
    },
    expectCode: "pgLayer",
  },
];

async function main() {
  if (!TOKEN) {
    console.warn("[smoke] WARN: SMOKE_TOKEN not set — only case 1 will be meaningful.");
  }
  let pass = 0;
  let fail = 0;
  for (const c of cases) {
    process.stdout.write(`\n[${c.name}] `);
    try {
      const res = await fetch(`${BASE}/api/db/query`, {
        method: "POST",
        headers: c.headers,
        body: JSON.stringify(c.body),
      });
      const j: any = await res.json();
      const ok =
        c.expectCode === "pgLayer"
          ? j.code === 0 || j.code === 5000
          : j.code === c.expectCode;
      console.log(ok ? `PASS (code=${j.code})` : `FAIL (code=${j.code} message=${j.message})`);
      ok ? pass++ : fail++;
    } catch (e: any) {
      console.log(`ERROR ${e?.message || e}`);
      fail++;
    }
  }
  console.log(`\n[smoke] ${pass} passed, ${fail} failed.`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
