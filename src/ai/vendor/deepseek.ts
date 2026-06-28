// Phase 1 后端 vendor 适配 - DeepSeek
// 原文件：Toonflow-app/data/vendor/deepseek.ts
// 客户端只实现了 textRequest，图片/视频/TTS 都返回空字符串，后端这里也保持 stub。

export const vendorId = "deepseek";

export async function imageRequest(
  _config: any,
  _model: any,
  _inputValues: Record<string, string>,
): Promise<string> {
  throw new Error("vendor=deepseek 暂不支持图片生成");
}

export async function videoRequest(
  _config: any,
  _model: any,
  _inputValues: Record<string, string>,
): Promise<string> {
  throw new Error("vendor=deepseek 暂不支持视频生成");
}

export async function ttsRequest(
  _config: any,
  _model: any,
  _inputValues: Record<string, string>,
): Promise<string> {
  throw new Error("vendor=deepseek 暂不支持 TTS");
}
