import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

// Google SDK 不接受自定义 fetch；仅为单次调用转发到固定上游，统一禁止凭据重定向。
export async function googleTransport(
  baseUrl: string,
  signal: AbortSignal,
  onStatus: (status: number) => void,
) {
  const prefix = `/${randomUUID()}`;
  const server = createServer((request, response) => {
    void forward(request, response);
  });
  async function forward(request: IncomingMessage, response: ServerResponse) {
    if (request.method !== 'POST' || !request.url?.startsWith(`${prefix}/`)) {
      response.writeHead(404).end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk as Uint8Array);
        size += bytes.length;
        if (size > 4 * 1024 * 1024) throw new Error('请求过大');
        chunks.push(bytes);
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (value && !['host', 'connection', 'content-length', 'transfer-encoding'].includes(name))
          headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      const upstream = await fetch(baseUrl, {
        method: 'POST',
        headers,
        body: Buffer.concat(chunks),
        signal,
        redirect: 'error',
      });
      onStatus(upstream.status);
      response.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
      });
      if (upstream.body) {
        const reader = upstream.body.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (!response.write(value)) await once(response, 'drain', { signal });
          }
        } finally {
          reader.releaseLock();
        }
        response.end();
      } else response.end();
    } catch {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    }
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const close = () => server.closeAllConnections();
  signal.addEventListener('abort', close, { once: true });
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}${prefix}`,
    async close() {
      signal.removeEventListener('abort', close);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
