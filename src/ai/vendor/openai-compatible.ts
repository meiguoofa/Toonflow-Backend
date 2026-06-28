// Phase 2 后端 vendor 适配器 - openai-compatible 通用模板
//
// 为"用户自定义供应商"提供通用 OpenAI Chat 协议入口。覆盖 DeepSeek / Moonshot /
// 千问 / 智谱 / Together AI 等几乎所有提供 OpenAI 兼容协议的厂商。
//
// 文本调用仍走客户端（phase 1 text 未迁后端，AiText 拿 protocol=openai-compatible 后
// 在客户端用 createOpenAICompatible({baseURL, apiKey})(modelName) 直连），
// 后端这里只暴露 image/video/audio 的 stub —— 大多数 OpenAI 兼容厂商不支持图像/视频/音频
// 生成（少数支持的会用各家私有协议，不属于"通用兼容"范畴，应单独建模板）。

export const vendorId = "openai-compatible";

export async function imageRequest(
  _config: any,
  _model: any,
  _inputValues: Record<string, string>,
): Promise<string> {
  throw new Error("openai-compatible 模板不支持图像生成；如需图像请使用专用模板（toonflow / volcengine / klingai 等）");
}

export async function videoRequest(
  _config: any,
  _model: any,
  _inputValues: Record<string, string>,
): Promise<string> {
  throw new Error("openai-compatible 模板不支持视频生成；如需视频请使用专用模板（toonflow / volcengine / klingai / vidu / minimax）");
}

export async function ttsRequest(
  _config: any,
  _model: any,
  _inputValues: Record<string, string>,
): Promise<string> {
  throw new Error("openai-compatible 模板不支持 TTS；如需音频请使用专用模板");
}
