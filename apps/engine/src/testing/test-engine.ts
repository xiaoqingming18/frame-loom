import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createEngine } from '../application.js';
import { EngineConfig } from '../core/config/config.js';
import { ProtocolRegistry } from '../modules/generation/protocols/registry.js';
import type { ProtocolAdapter } from '../modules/generation/protocols/types.js';

export async function testEngine(adapter?: ProtocolAdapter) {
  const directory = await mkdtemp(join(tmpdir(), 'loom-services-'));
  const config = new EngineConfig('a'.repeat(64), directory, [], 'b'.repeat(64));
  let app = await createEngine(config);
  let origin = '';
  async function listen() {
    if (adapter) app.get(ProtocolRegistry).register(adapter);
    await app.listen(0, '127.0.0.1');
    origin = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  }
  await listen();
  return {
    directory,
    config,
    get app() {
      return app;
    },
    request(path: string, method = 'GET', body?: unknown) {
      return fetch(origin + path, {
        method,
        headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    },
    async restart() {
      await app.close();
      app = await createEngine(config);
      await listen();
    },
    async close() {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
