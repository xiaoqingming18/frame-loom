// 公网地址仅供 URL 校验和签名；真正的网络请求只到本地严格模拟服务器。
const remote = new URL(process.env.FRAME_LOOM_MOCK_STORAGE);
if (remote.hostname !== '127.0.0.1') throw new Error('模拟服务器必须监听回环地址');
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (
    url.origin === 'http://8.8.8.8' &&
    /^\/bucket\/audio\/[a-f0-9]{64}\.(wav|mp4)$/.test(url.pathname)
  ) {
    url.protocol = remote.protocol;
    url.host = remote.host;
    return originalFetch(new Request(url, request));
  }
  if (url.hostname !== '127.0.0.1') throw new Error('E2E 禁止非回环网络连接');
  return originalFetch(request);
};
await import('../../../engine/dist/main.js');
