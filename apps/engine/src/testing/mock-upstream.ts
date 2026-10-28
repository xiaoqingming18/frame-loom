import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

export type RecordedRequest = {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
};
export type MockRoute = {
  method: string;
  path: string;
  headers?: Record<string, string>;
  reply: (request: RecordedRequest) =>
    | {
        status?: number;
        headers?: Record<string, string>;
        body?: string | Uint8Array;
        disconnect?: boolean;
      }
    | Promise<{
        status?: number;
        headers?: Record<string, string>;
        body?: string | Uint8Array;
        disconnect?: boolean;
      }>;
};
export async function mockUpstream(routes: MockRoute[]) {
  const requests: RecordedRequest[] = [];
  const violations: string[] = [];
  const server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk as Uint8Array));
      const request = {
        method: req.method ?? '',
        path: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      };
      requests.push(request);
      const route = routes.find(
        (route) => route.method === request.method && route.path === request.path,
      );
      if (!route) {
        violations.push(`${request.method} ${request.path}`);
        res.writeHead(404).end();
        return;
      }
      if (
        Object.entries(route.headers ?? {}).some(
          ([key, value]) => request.headers[key.toLowerCase()] !== value,
        )
      ) {
        violations.push(`鉴权不匹配 ${request.path}`);
        res.writeHead(401).end();
        return;
      }
      const result = await route.reply(request);
      if (result.disconnect) {
        res.destroy();
        return;
      }
      res
        .writeHead(result.status ?? 200, result.headers ?? { 'Content-Type': 'application/json' })
        .end(result.body);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    violations,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
