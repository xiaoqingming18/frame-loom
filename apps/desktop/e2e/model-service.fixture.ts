import type { Page, ElectronApplication } from '@playwright/test';
import { Channel, Model, getProtocol, type Capability } from '@frame-loom/contracts';

export async function engineApi(page: Page, path: string, method = 'GET', body?: unknown) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const { baseUrl, token } = await (
        window as unknown as {
          frameLoom: { getEngineConnection(): Promise<{ baseUrl: string; token: string }> };
        }
      ).frameLoom.getEngineConnection();
      const response = await fetch(baseUrl + path, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
      return response.json() as Promise<unknown>;
    },
    { path, method, body },
  );
}

export async function addMediaModel(
  page: Page,
  channelId: string,
  protocolId: string,
  upstreamModelId: string,
  capability?: Capability,
) {
  const descriptor = getProtocol(protocolId)!;
  const kind = descriptor.kinds[0];
  return Model.array().parse(
    await engineApi(page, `/channels/${channelId}/models`, 'POST', [
      {
        kind,
        protocolId,
        upstreamModelId,
        displayName: upstreamModelId,
        enabled: true,
        capability: capability ?? descriptor.templates[kind],
      },
    ]),
  )[0];
}

export async function addMediaChannel(page: Page, baseUrl: string, apiKey: string) {
  return Channel.parse(
    await engineApi(page, '/channels', 'POST', {
      name: '本地模拟渠道',
      baseUrl,
      apiKey,
      catalogFormat: 'openai',
      enabled: true,
    }),
  );
}

/** 失败清理不经过画布保存拦截；仅终止本测试启动的进程。 */
export async function disposeTestApp(app: ElectronApplication | undefined) {
  if (!app) return;
  await app.evaluate(({ app }) => app.exit()).catch(() => {});
}
