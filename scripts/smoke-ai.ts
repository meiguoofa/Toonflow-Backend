// Phase 1 AI 代理 smoke 测试（非自动执行，手工 ts-node 跑）
//
// 验证目标：
//   1) 队列并发被限制到 2（concurrency=2）
//   2) 抛出 "ServerOverloaded" 的 mock task 会被 withRetry 触发指数退避，
//      在第 N 次成功时返回；触发次数足够多时最终 throw 出最后一个错误
//
// 跑法：
//   npx ts-node scripts/smoke-ai.ts
// （不会触发任何外部 HTTP；不依赖 DB）

import { enqueue, _resetQueuesForTest } from "../src/ai/queue";
import { withRetry } from "../src/ai/retry";

async function testConcurrency() {
  console.log("\n=== test1: 队列 concurrency=2 ===");
  _resetQueuesForTest();
  const VENDOR = "smokeVendor";
  let active = 0;
  let maxActive = 0;
  const tasks = Array.from({ length: 6 }, (_, i) => i);
  const runs = tasks.map((i) =>
    enqueue(VENDOR, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 200));
      active--;
      return i;
    }),
  );
  const out = await Promise.all(runs);
  console.log(`完成顺序: ${out.join(",")}, 最大并发: ${maxActive} (期望 ≤ 2)`);
  if (maxActive > 2) {
    throw new Error(`concurrency 限制失败: maxActive=${maxActive}`);
  }
}

async function testRetrySucceedsAfterOverload() {
  console.log("\n=== test2: withRetry - ServerOverloaded 重试后成功 ===");
  let attempts = 0;
  const result = await withRetry(
    async () => {
      attempts++;
      if (attempts < 3) {
        const e: any = new Error(`ServerOverloaded retry #${attempts}`);
        e.code = "ServerOverloaded";
        throw e;
      }
      return "OK";
    },
    { vendorId: "smoke" },
  );
  console.log(`重试 ${attempts} 次后得到 result=${result} (期望 attempts=3, result=OK)`);
}

async function testRetryExhausted() {
  console.log("\n=== test3: withRetry - 持续报 429 直到耗尽 ===");
  let attempts = 0;
  try {
    await withRetry(
      async () => {
        attempts++;
        const e: any = new Error("rate limited");
        e.status = 429;
        throw e;
      },
      { vendorId: "smoke" },
    );
    console.log("意外成功了, 这是 bug");
  } catch (e: any) {
    console.log(`最终抛出 (attempts=${attempts}, attached=${e.attempts}): ${e.message}`);
    if (attempts !== 4) console.warn(`期望尝试 4 次，实际 ${attempts}`);
  }
}

async function testNonRetryable() {
  console.log("\n=== test4: withRetry - 非重试型错误立刻抛出 ===");
  let attempts = 0;
  try {
    await withRetry(
      async () => {
        attempts++;
        throw new Error("bad request");
      },
      { vendorId: "smoke" },
    );
  } catch (e: any) {
    console.log(`立刻抛出, attempts=${attempts} (期望 1): ${e.message}`);
  }
}

async function main() {
  await testConcurrency();
  await testRetrySucceedsAfterOverload();
  await testRetryExhausted();
  await testNonRetryable();
  console.log("\nsmoke done.");
}

main().catch((e) => {
  console.error("smoke FAIL:", e);
  process.exit(1);
});
