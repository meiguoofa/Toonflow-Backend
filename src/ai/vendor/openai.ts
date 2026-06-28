// Phase 1 后端 vendor 适配 - OpenAI 标准接口
// 原文件：Toonflow-app/data/vendor/openai.ts
// 客户端图片/视频/TTS 都是空实现，后端这里也保持 stub（仅文本走客户端 SDK）。

export const vendorId = "openai";

export async function imageRequest(
  _config: any,
  _model: any,
  _inputValues: Record<string, string>,
): Promise<string> {
  throw new Error("vendor=openai 暂不支持图片生成");
}

export async function videoRequest(
  _config: any,
  _model: any,
  _inputValues: Record<string, string>,
): Promise<string> {
  throw new Error("vendor=openai 暂不支持视频生成");
}

export async function ttsRequest(
  _config: any,
  _model: any,
  _inputValues: Record<string, string>,
): Promise<string> {
  throw new Error("vendor=openai 暂不支持 TTS");
}
