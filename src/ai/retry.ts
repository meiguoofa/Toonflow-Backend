// Phase 1 AI 代理 - 指数退避重试
//
// 触发重试条件（满足任一即可）：
//   1. err.code 字符串里包含 "ServerOverloaded" 或 "rate_limit"（大小写不敏感）
//   2. err.status ∈ {429} ∪ [500, 599]
//   3. err.message 文本里能匹配到上述关键字 / 429 / 5xx 状态码
//
// 策略：
//   base 1000ms，factor 2，maxAttempts 4，jitter ±25%
//   重试前 console.warn 一行；最终失败抛出最后一个错误，并把累计尝试次数挂在 err.attempts 上

const BASE_MS = 1000;
const FACTOR = 2;
const MAX_ATTEMPTS = 4;
const JITTER = 0.25;

const RETRY_KEYWORDS = /(server\s*overloaded|rate[_\s-]*limit)/i;
const RETRY_STATUS_IN_MSG = /\b(429|5\d\d)\b/;

function isRetryable(err: any): boolean {
  if (!err) return false;
  const codeStr = String(err.code ?? "");
  if (RETRY_KEYWORDS.test(codeStr)) return true;

  const status = Number(err.status ?? err?.response?.status ?? 0);
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;

  const msg = String(err.message ?? "");
  if (RETRY_KEYWORDS.test(msg)) return true;
  if (RETRY_STATUS_IN_MSG.test(msg)) return true;

  return false;
}

function computeDelay(attempt: number): number {
  const exp = BASE_MS * Math.pow(FACTOR, attempt - 1);
  const j = exp * JITTER * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(exp + j));
}

export async function withRetry<T>(
  task: () => Promise<T>,
  ctx?: { vendorId?: string },
): Promise<T> {
  const vendorId = ctx?.vendorId ?? "unknown";
  let lastErr: any;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await task();
    } catch (err: any) {
      lastErr = err;
      if (!isRetryable(err) || attempt === MAX_ATTEMPTS) {
        // 不可重试或已是最后一次：补上 attempts 信息后抛出
        try {
          err.attempts = attempt;
        } catch {
          // 部分错误对象不可写 attempts，忽略
        }
        throw err;
      }
      const delay = computeDelay(attempt);
      console.warn(
        `[ai-retry] vendor=${vendorId} attempt=${attempt}/${MAX_ATTEMPTS} delay=${delay}ms reason="${String(err?.message || err?.code || "").slice(0, 200)}"`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  // 理论不可达
  throw lastErr;
}
