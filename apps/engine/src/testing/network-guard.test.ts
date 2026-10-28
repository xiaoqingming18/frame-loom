import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

it('全局网络守卫拒绝外网、私网与自动重定向，允许本地 mock', async () => {
  for (const url of ['https://external.invalid', 'http://192.168.1.1', 'http://localhost']) {
    await expect(fetch(url)).rejects.toThrow('测试网络守卫');
    await expect(fetch(new Request(url))).rejects.toThrow('测试网络守卫');
  }
  const server = createServer((request, response) => {
    if (request.url === '/redirect')
      response.writeHead(302, { Location: 'https://external.invalid' }).end();
    else response.end('本地模拟');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    expect(await (await fetch(base)).text()).toBe('本地模拟');
    await expect(fetch(`${base}/redirect`)).rejects.toThrow();
    expect((await fetch(`${base}/redirect`, { redirect: 'manual' })).status).toBe(302);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});
