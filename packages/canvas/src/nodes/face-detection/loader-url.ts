// 完整 URL 不会触发 Vite 对 public loader 的 import query 注入。
export function loaderUrl(path: string, workerUrl: string): string {
  return new URL(path.replace(/\?import(?:&.*)?$/, ''), workerUrl).href;
}
