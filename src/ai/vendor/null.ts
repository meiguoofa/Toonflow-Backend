// Phase 1 后端 vendor 适配 - 空模板（null）
// 原文件：Toonflow-app/data/vendor/null.ts
// 客户端图片/视频/TTS 均为空实现（return ""），后端这里也保持 stub。

export const vendorId = "null";

export async function imageRequest(
  _config: any,
  _model: any,
  _inputValues: Record<string, string>,
): Promise<string> {
  throw new Error("vendor=null 不支持图片生成");
}

export async function videoRequest(
  _config: any,
  _model: any,
  _inputValues: Record<string, string>,
): Promise<string> {
  throw new Error("vendor=null 不支持视频生成");
}

export async function ttsRequest(
  _config: any,
  _model: any,
  _inputValues: Record<string, string>,
): Promise<string> {
  throw new Error("vendor=null 不支持 TTS");
}
