// 故意为空：之前尝试在这里给 fetch 一个 any-return 的全局声明，但 @types/node 20+ 提供了更
// 精确的 fetch global（来自 undici-types），二者会合并签名，反而让 .json() 仍然是
// Promise<unknown>。最终方案：每个用到 fetch 的模块在顶部加 `const fetch: any =
// (globalThis as any).fetch;` 局部 shadow 一下即可。
export {};
