import 'reflect-metadata';

const nativeFetch = globalThis.fetch;

// 测试只能连接本地模拟服务，且不能经自动重定向绕过入口检查。
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== '127.0.0.1') {
    throw new Error('测试网络守卫：仅允许 127.0.0.1 模拟服务');
  }
  const redirect = init?.redirect ?? (input instanceof Request ? input.redirect : 'follow');
  return nativeFetch(input, { ...init, redirect: redirect === 'follow' ? 'error' : redirect });
};
