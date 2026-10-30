import fs from 'node:fs/promises';
import { afterEach, expect, it } from 'vitest';
import {
  EpisodeSummary,
  ModelWrite,
  ProjectSummary,
  ScriptResult,
  StoryResult,
  getProtocol,
  type ConversionState,
} from '@frame-loom/contracts';
import { testEngine } from '../../testing/test-engine.js';
import { mockUpstream, type MockRoute } from '../../testing/mock-upstream.js';
import { ModelServicesRepository } from '../model-services/model-services.repository.js';
import { EventBus } from '../../core/events/event-bus.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const profile = { form: 'short', medium: 'live', genres: ['悬疑'], aspect: null };
const source = () =>
  fs.readFile(
    new URL('../../../../../packages/contracts/fixtures/script-sample-01.txt', import.meta.url),
    'utf8',
  );
const source2 = () =>
  fs.readFile(
    new URL('../../../../../packages/contracts/fixtures/script-sample-02.txt', import.meta.url),
    'utf8',
  );
function stream(content: string) {
  return {
    headers: { 'Content-Type': 'text/event-stream' },
    body: `data: ${JSON.stringify({ id: 'conversion', choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'conversion', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
  };
}
async function setup(reply?: MockRoute['reply']) {
  const upstream = reply
    ? await mockUpstream([{ method: 'POST', path: '/v1/chat/completions', reply }])
    : null;
  if (upstream) cleanups.push(() => upstream.close());
  const s = await testEngine();
  cleanups.push(() => s.close());
  if (upstream) {
    const repo = s.app.get(ModelServicesRepository);
    const channel = repo.saveChannel({
      name: '转换测试',
      baseUrl: upstream.origin,
      apiKey: 'test',
      enabled: true,
    });
    const model = repo.saveModels(channel.id, [
      ModelWrite.parse({
        kind: 'chat',
        upstreamModelId: 'chat',
        displayName: '文本',
        protocolId: 'openai-chat',
        capability: { ...getProtocol('openai-chat')!.templates.chat!, maxOutput: 1024 },
        enabled: true,
      }),
    ])[0];
    repo.saveDefaults({ chat: model.id });
  }
  const project = ProjectSummary.parse(
    await (await s.request('/projects', 'POST', { name: '转换', location: s.directory })).json(),
  );
  const base = `/projects/${project.id}`;
  const episode = EpisodeSummary.parse(
    await (await s.request(`${base}/episodes`, 'POST', { number: 1, title: '' })).json(),
  );
  const url = `${base}/episodes/${episode.id}/script`;
  const read = async () => ScriptResult.parse(await (await s.request(url)).json());
  const wait = async (status: ConversionState['status']) => {
    await expect
      .poll(async () => (await read()).conversion?.status, { timeout: 10000 })
      .toBe(status);
    return read();
  };
  return { s, upstream, project, episode, base, url, read, wait };
}

it('纯规则转换经过状态事件并保留原文，统计恰好符合验收', async () => {
  const { s, url, base, read, wait } = await setup();
  const statuses: string[] = [];
  const subscription = s.app.get(EventBus).events.subscribe((event) => {
    if (event.type === 'script.conversion.updated') statuses.push(event.type);
  });
  const text = await source();
  const response = await s.request(`${url}/import`, 'POST', { revision: 1, text, profile });
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({ revision: 2, conversion: { status: 'queued' } });
  const file = await wait('succeeded');
  expect(file).toMatchObject({
    revision: 3,
    pendingImport: null,
    source: { text },
    conversion: { result: { scenes: 7, blocks: 60, unsure: 3, addedElements: 10 } },
  });
  expect(file.conversion!.warnings.join()).toContain('未设置默认文本模型');
  expect(statuses.length).toBeGreaterThanOrEqual(3);
  expect(StoryResult.parse(await (await s.request(`${base}/story`)).json()).elements).toHaveLength(
    10,
  );
  subscription.unsubscribe();
  await s.restart();
  expect((await read()).conversion).toBeNull();
});

it.each(['valid', 'retry', 'invalid', 'provider'] as const)(
  '模拟模型 %s：只使用标签、过滤伪造文字与元素并验证请求次数',
  async (scenario) => {
    let calls = 0;
    let originalId = '';
    const { s, upstream, url, base, wait } = await setup((request) => {
      calls++;
      if (scenario === 'provider') return { status: 500, body: '{}' };
      if (scenario === 'invalid' || (scenario === 'retry' && calls === 1))
        return stream('不是 JSON');
      const body = JSON.parse(request.body) as { messages: { role: string; content: string }[] };
      const input = JSON.parse(
        body.messages.find((message) => message.role === 'user')!.content,
      ) as { lines: { id: number; text: string; unsure: boolean }[] };
      const line = input.lines.find((line) => line.text === '周屿 你这几年还好吗');
      if (line) expect(line.unsure).toBe(true);
      return stream(
        '```json\n' +
          JSON.stringify({
            decisions: [
              ...(line
                ? [{ id: line.id, type: 'dialogue', character: '周屿', text: '伪造对白' }]
                : []),
              { id: 0, type: 'note' },
            ],
            elements: [
              { kind: 'prop', name: '旧信封', aliases: [], sameAs: null },
              { kind: 'prop', name: '原文没有的道具', aliases: [], sameAs: null },
              { kind: 'character', name: '小林', aliases: [], sameAs: '林夏' },
            ],
          }) +
          '\n```',
      );
    });
    const text =
      scenario === 'provider'
        ? (await source()) + '\n' + '陌生的长名字：你好\n'.repeat(100)
        : await source();
    await s.request(`${url}/import`, 'POST', { revision: 1, text, profile });
    const result = await wait('succeeded');
    expect(upstream!.requests).toHaveLength(
      scenario === 'invalid' ? 4 : scenario === 'retry' ? 3 : scenario === 'provider' ? 1 : 2,
    );
    expect(upstream!.violations).toEqual([]);
    expect(JSON.stringify(result.document)).not.toContain('伪造对白');
    if (scenario === 'valid' || scenario === 'retry') {
      const index = result.document.blocks.findIndex(
        (block) => block.type === 'dialogue' && block.text === '你这几年还好吗',
      );
      expect(index).toBeGreaterThan(0);
      expect(result.document.blocks[index - 1]).toMatchObject({ type: 'character', text: '周屿' });
      originalId = result.document.blocks[index].id;
      expect(originalId).toBeTruthy();
      const story = StoryResult.parse(await (await s.request(`${base}/story`)).json());
      expect(story.elements.some((element) => element.name === '原文没有的道具')).toBe(false);
      expect(story.elements.find((element) => element.name === '小林')?.suggestedMergeInto).toBe(
        story.elements.find((element) => element.name === '林夏')?.id,
      );
    } else {
      expect(
        result.document.blocks.some(
          (block) => block.text === '周屿 你这几年还好吗' && block.review,
        ),
      ).toBe(true);
      expect(result.conversion!.warnings.length).toBeGreaterThan(0);
    }
  },
);

it('导入前检查设定与原文，取消保留原文，运行中拒绝写入，重启后可以继续和丢弃', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { s, upstream, url, base, episode, wait, read } = await setup(async () => {
    await gate;
    return stream('{"decisions":[],"elements":[]}');
  });
  expect(
    await (await s.request(`${url}/import`, 'POST', { revision: 1, text: '原文' })).json(),
  ).toMatchObject({ code: 'PROJECT_PROFILE_REQUIRED' });
  expect(
    await (await s.request(`${url}/import`, 'POST', { revision: 1, profile })).json(),
  ).toMatchObject({ code: 'SCRIPT_IMPORT_EMPTY' });
  await s.request(`${url}/import`, 'POST', { revision: 1, text: await source(), profile });
  await expect.poll(() => upstream!.requests.length).toBe(1);
  expect(
    await (
      await s.request(url, 'PUT', { revision: 2, document: { schemaVersion: 1, blocks: [] } })
    ).json(),
  ).toMatchObject({ code: 'SCRIPT_CONVERTING' });
  expect(await (await s.request(`${base}/episodes/${episode.id}`, 'DELETE')).json()).toMatchObject({
    code: 'SCRIPT_CONVERTING',
  });
  expect((await s.request(`${url}/import`, 'DELETE')).status).toBe(409);
  await s.request(`${url}/import/cancel`, 'POST');
  const cancelled = await wait('cancelled');
  expect(cancelled.document.blocks).toEqual([]);
  expect(cancelled.pendingImport?.text).toBe(await source());
  release();
  await s.restart();
  expect((await read()).conversion).toBeNull();
  expect((await read()).pendingImport).not.toBeNull();
  s.app.get(ModelServicesRepository).saveDefaults({ chat: null });
  expect((await s.request(`${url}/import`, 'POST', { revision: 2 })).status).toBe(202);
  await wait('succeeded');
  expect((await s.request(`${url}/import`, 'POST', { revision: 1 })).status).toBe(409);
  expect((await s.request(`${url}/import`, 'DELETE')).status).toBe(200);
  expect((await read()).pendingImport).toBeNull();
});

it('真实 Markdown 规则转换入库角色表，重导不覆盖说明、不重复新增', async () => {
  const { s, url, base, wait } = await setup();
  const text = await source2();
  await s.request(`${url}/import`, 'POST', { revision: 1, text, profile });
  const first = await wait('succeeded');
  expect(first.conversion!.result).toEqual({ scenes: 6, blocks: 67, unsure: 2, addedElements: 24 });
  const story = StoryResult.parse(await (await s.request(`${base}/story`)).json());
  expect(
    story.elements
      .filter((element) => element.status === 'confirmed')
      .map((element) => element.name),
  ).toEqual(['卢允之', '影娘', '卢母', '道士', '张小姐']);
  expect(story.elements.filter((element) => element.status === 'pending')).toHaveLength(19);
  expect(story.elements.some((element) => ['片名', '片尾字幕卡'].includes(element.name))).toBe(
    false,
  );
  const person = story.elements.find((element) => element.name === '影娘')!;
  await s.request(`${base}/story/elements/${person.id}`, 'PATCH', { description: '手动说明' });
  await s.request(`${url}/import`, 'POST', { revision: first.revision, text, profile });
  expect((await wait('succeeded')).conversion!.result?.addedElements).toBe(0);
  expect(
    StoryResult.parse(await (await s.request(`${base}/story`)).json()).elements.find(
      (element) => element.id === person.id,
    )?.description,
  ).toBe('手动说明');
});
it('全部正文分批，非存疑决定生效且未提及的存疑清除', async () => {
  const seen: { id: number; text: string; guess: string; unsure: boolean }[] = [];
  const { s, url, wait, upstream } = await setup((request) => {
    const body = JSON.parse(request.body) as { messages: { role: string; content: string }[] };
    const input = JSON.parse(body.messages.find((message) => message.role === 'user')!.content) as {
      lines: typeof seen;
    };
    seen.push(...input.lines);
    return stream(
      JSON.stringify({
        decisions: input.lines.some((line) => line.id === 142)
          ? [{ id: 142, type: 'production', text: '伪造对白' }]
          : [],
        elements: [{ kind: 'prop', name: '不存在的道具', aliases: [], sameAs: null }],
      }),
    );
  });
  const text = await source2();
  await s.request(`${url}/import`, 'POST', { revision: 1, text, profile });
  const result = await wait('succeeded');
  expect(upstream!.requests).toHaveLength(3);
  expect(seen).toHaveLength(67);
  expect(seen.every((line) => line.id >= 47 && line.id <= 164)).toBe(true);
  expect(new Set(seen.map((line) => line.id)).size).toBe(67);
  expect(seen.find((line) => line.id === 142)).toMatchObject({ guess: 'action', unsure: false });
  expect(result.document.blocks.find((block) => block.src?.line === 142)).toMatchObject({
    type: 'production',
    text: '反打：卢生也笑了，左边嘴角往上翘，和她一模一样。',
    attrs: { label: '提示' },
  });
  expect(result.document.blocks.some((block) => block.review)).toBe(false);
  expect(JSON.stringify(result.document)).not.toContain('伪造对白');
});
