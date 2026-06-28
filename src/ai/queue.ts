// Phase 1 AI 代理 - per-vendor 并发/RPS 限流队列
//
// 设计要点：
// - 按 vendorId 维度建独立 PQueue 实例，缓存在 Map 里
// - 默认 concurrency=2，interval=1000ms，intervalCap=1（约等于 1 req/s）
// - 通过 env 覆盖：AI_QUEUE_<VENDOR>_CONCURRENCY / AI_QUEUE_<VENDOR>_RPS
// - 队列里同时排队 >100 时拒绝新任务（避免内存爆），用 code:5002 抛错
//
// p-queue v8 是 ESM-only，CommonJS 项目里只能用 dynamic import。
// 为了避免每次 enqueue 都 await import，我们用一个 lazy promise 缓存模块。

type PQueueCtor = any;

let pQueueModulePromise: Promise<PQueueCtor> | null = null;
function getPQueueCtor(): Promise<PQueueCtor> {
  if (!pQueueModulePromise) {
    pQueueModulePromise = (async () => {
      const mod: any = await (Function("return import('p-queue')")() as Promise<any>);
      return mod.default ?? mod;
    })();
  }
  return pQueueModulePromise;
}

const queues = new Map<string, Promise<any>>();

const MAX_QUEUE_BACKLOG = 100;

function readEnvNumber(envKey: string, fallback: number): number {
  const v = process.env[envKey];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function buildQueueOptions(vendorId: string) {
  const upper = vendorId.toUpperCase();
  const concurrency = readEnvNumber(`AI_QUEUE_${upper}_CONCURRENCY`, 2);
  const rps = readEnvNumber(`AI_QUEUE_${upper}_RPS`, 1);
  // p-queue 用 interval + intervalCap 控速；rps=1 → 每 1000ms 放出 1 次
  return {
    concurrency,
    interval: 1000,
    intervalCap: Math.max(1, Math.floor(rps)),
  };
}

async function getQueue(vendorId: string): Promise<any> {
  let p = queues.get(vendorId);
  if (!p) {
    p = (async () => {
      const Ctor = await getPQueueCtor();
      return new Ctor(buildQueueOptions(vendorId));
    })();
    queues.set(vendorId, p);
  }
  return p;
}

/**
 * 把 task 投入到 vendor 对应的队列里执行。
 * 如果待执行 + 正在执行的总数 ≥ 100，直接抛 code:5002 错误，防止内存被无限堆积。
 */
export async function enqueue<T>(vendorId: string, task: () => Promise<T>): Promise<T> {
  const q = await getQueue(vendorId);
  if (q.size + q.pending >= MAX_QUEUE_BACKLOG) {
    const err: any = new Error(`AI queue for vendor ${vendorId} is full (>=${MAX_QUEUE_BACKLOG})`);
    err.code = 5002;
    throw err;
  }
  // p-queue 的 add 类型有点烦，断言一下
  return (await q.add(task)) as T;
}

// 测试用：清空内部 Map（smoke 脚本里用）
export function _resetQueuesForTest(): void {
  queues.clear();
}
