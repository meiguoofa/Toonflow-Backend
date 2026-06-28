# AI 调用代理协议(phase 1)

后端 `/api/ai/*` 把图片/视频/音频生成调用从客户端迁到后端,中间加全局限流队列与退避重试,解决"同账号多端并发→火山引擎 ServerOverloaded"问题。

## 范围

| 类型 | 是否迁后端 | 说明 |
| --- | --- | --- |
| Image | ✅ 迁 | 主要诉求,ServerOverloaded 源头 |
| Video | ✅ 迁 | 同样有厂商 RPS 限制 |
| Audio (TTS) | ✅ 迁 | 同源问题 |
| Text | ❌ 保留客户端 | 走 SSE 流式响应,工程量大且不是 ServerOverloaded 源头,留后期 |
| Embedding | ❌ 保留客户端 | 走本地 ONNX,不打外部 API |

## 请求/响应统一格式

### `POST /api/ai/image`
```jsonc
// 请求
{
  "vendorId": "volcengine",                    // 必填,o_vendorConfig.id
  "model": "doubao-seedream-3-0-t2i-250415",   // 必填,vendor 内部模型名
  "config": {                                  // 透传给 vendor 的参数,字段由 vendor 决定
    "prompt": "...",
    "referenceList": [{ "type": "image", "base64": "..." }],
    "size": "1K",
    "aspectRatio": "16:9"
  }
}

// 成功
{ "code": 0, "data": { "result": "<base64 或 URL>" } }
```

### `POST /api/ai/video`
同 image,`config` 字段由 vendor 决定(prompt、firstFrame、duration 等)。

### `POST /api/ai/audio`
同 image,`config` 含 `text`、`voice` 等 TTS 参数。

## 错误码

| code | 含义 |
| --- | --- |
| 4001 | 未携带 token / token 无效 |
| 4002 | vendorId 不在白名单 |
| 4003 | 参数缺失或类型错误 |
| 4011 | vendor 未启用(`o_vendorConfig.enable=0`)或凭据未配置 |
| 5001 | 厂商最终失败(已退避重试上限),`message` 透传厂商原文 |
| 5002 | 后端代理内部错误 |

## 队列与重试

**队列(per vendorId)**:
- 用 `p-queue` 按 `vendorId` 维度建独立队列
- 默认 `concurrency=2`、`interval=1000ms`、`intervalCap=1`(1 req/秒)
- 通过 env 覆盖:`AI_QUEUE_<VENDOR>_CONCURRENCY` / `AI_QUEUE_<VENDOR>_RPS`

**退避重试**:
- 触发条件:错误 `code` 含 `ServerOverloaded` / `rate_limit`,或 HTTP `429` / `500-599`
- 策略:指数退避,base `1000ms`,factor `2`,最多 `4` 次,jitter `±25%`
- 其它错误立即抛出,不重试

## 鉴权

复用 `requireAuth` 中间件,所有 `/api/ai/*` 要求 Bearer token。`req.user.id` 注入用于审计日志(暂不强制 userId 隔离)。

## 关于流式 Text

Text 暂留客户端,后期通过 SSE 或 WebSocket 迁移。客户端 `utils/ai.ts` 中 `AiText` 不动。
