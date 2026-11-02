import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  EpisodeSummary,
  ModelWrite,
  ProjectSummary,
  ScriptResult,
  StoryResult,
  getProtocol,
} from '@frame-loom/contracts';
import { testEngine } from '../../testing/test-engine.js';
import { ModelServicesRepository } from '../model-services/model-services.repository.js';
import { LlmService } from '../llm/llm.service.js';
import { ProjectScriptDatabase } from '../projects/project-script-database.js';
import { ProjectStore } from '../projects/project-store.js';
import { DomainError } from '../../core/http/domain-error.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});
const Request = z.object({
  mode: z.string(),
  batchId: z.string(),
  responsible: z.object({ start: z.number(), end: z.number() }),
  context: z.object({ start: z.number(), end: z.number() }).optional(),
  continuation: z.boolean().optional(),
  sceneKey: z.number().optional(),
  source: z.array(z.object({ id: z.number(), text: z.string() })),
});
async function setup(model = true, maxOutput = 8192) {
  const s = await testEngine();
  cleanups.push(() => s.close());
  if (model) {
    const repo = s.app.get(ModelServicesRepository);
    const channel = repo.saveChannel({
      name: '测试模型',
      baseUrl: 'http://127.0.0.1:1',
      apiKey: 'test',
      enabled: true,
    });
    const saved = repo.saveModels(channel.id, [
      ModelWrite.parse({
        kind: 'chat',
        upstreamModelId: 'script',
        displayName: '文本模型',
        protocolId: 'openai-chat',
        enabled: true,
        capability: {
          ...getProtocol('openai-chat')!.templates.chat!,
          maxOutput,
          contextWindow: 32768,
        },
      }),
    ])[0];
    repo.saveDefaults({ chat: saved.id });
  }
  const project = ProjectSummary.parse(
    await (
      await s.request('/projects', 'POST', { name: '导入测试', location: s.directory })
    ).json(),
  );
  const base = `/projects/${project.id}`;
  const episode = EpisodeSummary.parse(
    await (await s.request(`${base}/episodes`, 'POST', { number: 1, title: '' })).json(),
  );
  const url = `${base}/episodes/${episode.id}/script`;
  const read = async () => ScriptResult.parse(await (await s.request(url)).json());
  const llm = s.app.get(LlmService);
  vi.spyOn(llm, 'validateChat').mockResolvedValue();
  const requests: z.infer<typeof Request>[] = [];
  const mock = vi.spyOn(llm, 'complete').mockImplementation((_id, input) => {
    const request = Request.parse(JSON.parse(input.user));
    requests.push(request);
    if (request.mode === 'locate')
      return Promise.resolve(
        JSON.stringify({
          batchId: request.batchId,
          responsible: request.responsible,
          context: request.context,
          parts: [
            {
              range: request.responsible,
              kind: 'scene',
              sceneKey: 0,
              continuation: request.responsible.start !== 0,
              reason: '',
            },
          ],
        }),
      );
    const beats = request.source
      .filter((u) => u.id !== 0)
      .map(() => ({ type: 'action', content: '老陈站在门外。' }));
    const mappings = request.source
      .filter((u) => u.id !== 0)
      .map((u, index) => ({
        unit: u.id,
        start: 2,
        end: u.text.length,
        path: `beats.${index}.content`,
      }));
    if (request.responsible.start === 0)
      mappings.unshift({ unit: 0, start: 3, end: 6, path: 'location' });
    return Promise.resolve(
      JSON.stringify({
        batchId: request.batchId,
        responsible: request.responsible,
        sceneKey: 0,
        continuation: request.continuation,
        scene: {
          location: '便利店',
          time_of_day: '夜',
          interior: true,
          characters: ['老陈'],
          atmosphere: '',
          beats,
        },
        mappings,
      }),
    );
  });
  const wait = async () => {
    await expect
      .poll(async () => (await read()).conversion?.status, { timeout: 20000 })
      .toMatch(/^(succeeded|failed|cancelled)$/);
    return read();
  };
  return { s, project, episode, base, url, read, mock, requests, wait };
}
it('M01 无模型拒绝，不调用规则或改变文档', async () => {
  const { s, url, read, mock } = await setup(false);
  const before = await read();
  expect((await s.request(`${url}/import`, 'POST', { revision: 1, text: '原文' })).status).toBe(
    422,
  );
  expect(mock).not.toHaveBeenCalled();
  expect(await read()).toEqual(before);
});
it('M04/M05/M06 长单场至少三批、重复句按次数保留、人物完整入库', async () => {
  const { s, base, url, requests, wait } = await setup();
  const text = ['## 便利店 夜 内', ...Array.from({ length: 160 }, () => '△ 老陈站在门外。')].join(
    '\n',
  );
  expect((await s.request(`${url}/import`, 'POST', { revision: 1, text })).status).toBe(202);
  const record = await wait();
  expect(record.conversion?.error).toBeNull();
  expect(record.conversion?.status).toBe('succeeded');
  expect(requests.filter((r) => r.mode === 'scene').length).toBeGreaterThanOrEqual(3);
  expect(record.document.scenes).toHaveLength(1);
  expect(record.document.scenes[0].beats).toHaveLength(160);
  expect(
    record.document.scenes[0].beats.every(
      (b) => b.type === 'action' && b.content === '老陈站在门外。',
    ),
  ).toBe(true);
  expect(
    StoryResult.parse(await (await s.request(`${base}/story`)).json())
      .elements.map((e) => e.name)
      .sort(),
  ).toEqual(['便利店', '老陈'].sort());
});
it('M07/M08 持续改词不替换旧文档，修正后仅重试失败批次', async () => {
  const { s, url, read, mock, requests, wait } = await setup();
  const original = mock.getMockImplementation()!;
  let broken = true;
  mock.mockImplementation(async (...args) => {
    const response = await original(...args);
    const request = Request.parse(JSON.parse(args[1].user));
    if (broken && request.mode === 'scene')
      return response.replaceAll('老陈站在门外。', '老陈站在屋内。');
    return response;
  });
  const before = await read();
  const text = '## 便利店 夜 内\n△ 老陈站在门外。';
  await s.request(`${url}/import`, 'POST', { revision: 1, text });
  expect((await wait()).conversion?.status).toBe('failed');
  expect((await read()).document).toEqual(before.document);
  const boundaries = requests.filter((r) => r.mode === 'locate').length;
  broken = false;
  await s.request(`${url}/import`, 'POST', { revision: 1 });
  expect((await wait()).conversion?.status).toBe('succeeded');
  expect(requests.filter((r) => r.mode === 'locate')).toHaveLength(boundaries);
});
it('M09 取消迟到回包无效，重启不自动付费', async () => {
  const { s, url, read, mock, wait } = await setup();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = mock.getMockImplementation()!;
  mock.mockImplementation(async (...args) => {
    await gate;
    return original(...args);
  });
  await s.request(`${url}/import`, 'POST', {
    revision: 1,
    text: '## 便利店 夜 内\n△ 老陈站在门外。',
  });
  await s.request(`${url}/import/cancel`, 'POST');
  release();
  expect((await wait()).conversion?.status).toBe('cancelled');
  expect((await read()).revision).toBe(1);
  expect((await read()).document.scenes).toEqual([]);
  await s.restart();
  expect((await read()).conversion?.status).toBe('cancelled');
});
it('M05/M08 坏 JSON 有界缩小到单行，人物括注与跨行台词续成一个对白', async () => {
  const { s, url, mock, wait, requests } = await setup();
  const locate = mock.getMockImplementation()!;
  const scenes = [
    {
      location: '便利店',
      time_of_day: '夜',
      interior: true,
      atmosphere: '',
      characters: ['林夏'],
      beats: [],
    },
    {
      location: '便利店',
      time_of_day: '夜',
      interior: true,
      atmosphere: '',
      characters: ['林夏'],
      beats: [{ type: 'dialogue', speaker: '林夏', emotion: '低声', line: '' }],
    },
    {
      location: '便利店',
      time_of_day: '夜',
      interior: true,
      atmosphere: '',
      characters: ['林夏'],
      beats: [{ type: 'dialogue', speaker: '林夏', emotion: '低声', line: '不要开门。' }],
    },
    {
      location: '便利店',
      time_of_day: '夜',
      interior: true,
      atmosphere: '',
      characters: ['林夏'],
      beats: [{ type: 'dialogue', speaker: '林夏', emotion: '低声', line: '请等一等。' }],
    },
  ];
  const mappings = [
    [{ unit: 0, start: 3, end: 6, path: 'location' }],
    [
      { unit: 1, start: 0, end: 2, path: 'beats.0.speaker' },
      { unit: 1, start: 3, end: 5, path: 'beats.0.emotion' },
    ],
    [{ unit: 2, start: 0, end: 5, path: 'beats.0.line' }],
    [{ unit: 3, start: 0, end: 5, path: 'beats.0.line' }],
  ];
  let contentCalls = 0;
  mock.mockImplementation((...args) => {
    const request = Request.parse(JSON.parse(args[1].user));
    if (request.mode === 'locate') return locate(...args);
    contentCalls++;
    if (request.responsible.end - request.responsible.start > 1) return Promise.resolve('{');
    const index = request.responsible.start;
    return Promise.resolve(
      JSON.stringify({
        batchId: request.batchId,
        responsible: request.responsible,
        sceneKey: 0,
        continuation: request.continuation,
        firstBeatContinuation: index >= 2,
        scene: scenes[index],
        mappings: mappings[index],
      }),
    );
  });
  await s.request(`${url}/import`, 'POST', {
    revision: 1,
    text: '## 便利店 夜 内\n林夏（低声）：\n不要开门。\n请等一等。',
  });
  const result = await wait();
  expect(result.conversion?.error).toBeNull();
  expect(result.conversion?.status).toBe('succeeded');
  expect(contentCalls).toBe(10);
  expect(requests.filter((request) => request.mode === 'locate')).toHaveLength(1);
  expect(result.document.scenes[0].beats).toEqual([
    {
      id: result.document.scenes[0].beats[0].id,
      type: 'dialogue',
      speaker: '林夏',
      emotion: '低声',
      line: '不要开门。\n请等一等。',
    },
  ]);
});
it('M09 项目移除先收束任务，迟到回包不再写项目', async () => {
  const { s, base, url, mock } = await setup();
  const original = mock.getMockImplementation()!;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  mock.mockImplementation(async (...args) => {
    await gate;
    return original(...args);
  });
  await s.request(`${url}/import`, 'POST', {
    revision: 1,
    text: '## 便利店 夜 内\n△ 老陈站在门外。',
  });
  const removing = s.request(base, 'DELETE');
  await expect
    .poll(async () => ScriptResult.parse(await (await s.request(url)).json()).conversion?.status)
    .toBe('cancelled');
  release();
  expect((await removing).status).toBe(200);
  expect((await s.request(url)).status).toBe(404);
});
it('M03 极小输出容量明确失败，不裁断原文、不触发模型调用', async () => {
  const { s, url, mock, wait } = await setup(true, 1024);
  await s.request(`${url}/import`, 'POST', {
    revision: 1,
    text: '## 便利店 夜 内\n△ 老陈站在门外。',
  });
  const result = await wait();
  expect(result.conversion?.status).toBe('failed');
  expect(result.conversion?.error).toContain('预算不足');
  expect(result.source).toBe('## 便利店 夜 内\n△ 老陈站在门外。');
  expect(result.revision).toBe(1);
  expect(mock).not.toHaveBeenCalled();
});
it('M11 应用标记故障回滚正文和设定，修复重试复用成功批', async () => {
  const { s, project, base, url, mock, wait } = await setup();
  const database = s.app.get(ProjectScriptDatabase);
  await database.use(project.rootPath, project.id, (db) =>
    db.exec(
      "CREATE TRIGGER fail_apply BEFORE UPDATE OF applied ON script_imports BEGIN SELECT RAISE(ABORT,'应用失败'); END",
    ),
  );
  await s.request(`${url}/import`, 'POST', {
    revision: 1,
    text: '## 便利店 夜 内\n△ 老陈站在门外。',
  });
  expect((await wait()).conversion?.status).toBe('failed');
  expect(await (await s.request(url)).json()).toMatchObject({
    revision: 1,
    document: { scenes: [] },
  });
  expect(StoryResult.parse(await (await s.request(`${base}/story`)).json()).elements).toEqual([]);
  const calls = mock.mock.calls.length;
  await database.use(project.rootPath, project.id, (db) => {
    expect(db.prepare('SELECT applied FROM script_imports').get()).toEqual({ applied: 0 });
    db.exec('DROP TRIGGER fail_apply');
  });
  await s.request(`${url}/import`, 'POST', { revision: 1 });
  expect((await wait()).conversion?.status).toBe('succeeded');
  expect(mock).toHaveBeenCalledTimes(calls);
  await database.use(project.rootPath, project.id, (db) =>
    expect(db.prepare('SELECT applied FROM script_imports').get()).toEqual({ applied: 1 }),
  );
});
it('M12 项目信息改变不能应用旧快照，运行中保存拒绝覆盖', async () => {
  const { s, project, base, url, mock, read, wait } = await setup();
  const original = mock.getMockImplementation()!;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  mock.mockImplementation(async (...args) => {
    await gate;
    return original(...args);
  });
  const before = await read();
  await s.request(`${url}/import`, 'POST', {
    revision: 1,
    text: '## 便利店 夜 内\n△ 老陈站在门外。',
  });
  expect((await s.request(url, 'PUT', { revision: 1, document: before.document })).status).toBe(
    409,
  );
  await s.request(`${base}/profile`, 'PUT', {
    form: null,
    medium: null,
    genres: [],
    aspect: null,
    style: '已改画风',
  });
  release();
  expect((await wait()).conversion?.error).toContain('已变化');
  expect((await read()).revision).toBe(1);
  expect((await read()).document.meta.style).toBe('已改画风');
  const store = s.app.get(ProjectStore);
  expect((await store.readManifest(project.rootPath)).profile?.style).toBe('已改画风');
});
it('M04/M06 多场长文至少三批，相同地点独立场、重复句按原次数保存', async () => {
  const { s, url, mock, requests, wait } = await setup();
  mock.mockImplementation((_id, input) => {
    const request = Request.parse(JSON.parse(input.user));
    requests.push(request);
    const headers = [0, 81];
    if (request.mode === 'locate')
      return Promise.resolve(
        JSON.stringify({
          batchId: request.batchId,
          responsible: request.responsible,
          context: request.context,
          parts: headers.flatMap((sceneKey) => {
            const start = Math.max(sceneKey, request.responsible.start),
              end = Math.min(sceneKey + 81, request.responsible.end);
            return start < end
              ? [
                  {
                    range: { start, end },
                    kind: 'scene',
                    sceneKey,
                    continuation: start > sceneKey,
                    reason: '',
                  },
                ]
              : [];
          }),
        }),
      );
    const rows = request.source.filter((unit) => !headers.includes(unit.id));
    return Promise.resolve(
      JSON.stringify({
        batchId: request.batchId,
        responsible: request.responsible,
        sceneKey: request.sceneKey,
        continuation: request.continuation,
        scene: {
          location: '便利店',
          interior: true,
          time_of_day: '夜',
          atmosphere: '',
          characters: ['老陈'],
          beats: rows.map(() => ({ type: 'action', content: '老陈站在门外。' })),
        },
        mappings: [
          ...request.source
            .filter((unit) => headers.includes(unit.id))
            .map((unit) => ({ unit: unit.id, start: 0, end: 3, path: 'location' })),
          ...rows.map((unit, index) => ({
            unit: unit.id,
            start: 2,
            end: 9,
            path: `beats.${index}.content`,
          })),
        ],
      }),
    );
  });
  const scene = ['便利店 夜 内', ...Array.from({ length: 80 }, () => '△ 老陈站在门外。')];
  await s.request(`${url}/import`, 'POST', { revision: 1, text: [...scene, ...scene].join('\n') });
  const result = await wait();
  expect(result.conversion?.error).toBeNull();
  expect(
    result.document.scenes.map((scene) => [scene.scene_id, scene.location, scene.beats.length]),
  ).toEqual([
    ['1-1', '便利店', 80],
    ['1-2', '便利店', 80],
  ]);
  expect(requests.filter((request) => request.mode === 'locate').length).toBeGreaterThanOrEqual(3);
  expect(requests.filter((request) => request.mode === 'scene').length).toBeGreaterThanOrEqual(3);
});
it('M09 排队取消不调用模型，其他任务完成后仍保持取消状态', async () => {
  const { s, base, url, mock, wait } = await setup();
  const original = mock.getMockImplementation()!;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  mock.mockImplementation(async (...args) => {
    await gate;
    return original(...args);
  });
  const second = EpisodeSummary.parse(
    await (await s.request(`${base}/episodes`, 'POST', { number: 2, title: '' })).json(),
  );
  const nextUrl = `${base}/episodes/${second.id}/script`;
  const input = { revision: 1, text: '## 便利店 夜 内\n△ 老陈站在门外。' };
  await s.request(`${url}/import`, 'POST', input);
  await s.request(`${nextUrl}/import`, 'POST', input);
  expect(ScriptResult.parse(await (await s.request(nextUrl)).json()).conversion?.status).toBe(
    'queued',
  );
  await s.request(`${nextUrl}/import/cancel`, 'POST');
  release();
  expect((await wait()).conversion?.status).toBe('succeeded');
  const cancelled = ScriptResult.parse(await (await s.request(nextUrl)).json());
  expect(cancelled.conversion?.status).toBe('cancelled');
  expect(cancelled.document.scenes).toEqual([]);
  expect(mock).toHaveBeenCalledTimes(2);
});
it.each(['queued', 'running'])(
  'M09 重启将持久化的%s任务转为可重试中断，不自动调用模型',
  async (status) => {
    const { s, project, url, mock, wait } = await setup();
    mock.mockRejectedValue(new Error('模拟断网'));
    await s.request(`${url}/import`, 'POST', {
      revision: 1,
      text: '## 便利店 夜 内\n△ 老陈站在门外。',
    });
    expect((await wait()).conversion?.status).toBe('failed');
    await s.app.get(ProjectScriptDatabase).use(project.rootPath, project.id, (db) =>
      db.prepare('UPDATE script_imports SET state=?').run(
        JSON.stringify({
          status,
          stage: status === 'running' ? 'parsing' : null,
          done: 1,
          total: 3,
          warnings: [],
          error: null,
          result: null,
        }),
      ),
    );
    await s.restart();
    const complete = vi.spyOn(s.app.get(LlmService), 'complete');
    const result = ScriptResult.parse(await (await s.request(url)).json());
    expect(result.conversion?.status).toBe('failed');
    expect(result.conversion?.error).toContain('中断');
    expect(result.source).toContain('老陈站在门外。');
    expect(result.document.scenes).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
  },
);
it('M08 原文改变不复用旧定位缓存；应用成功后旧revision不能再次应用', async () => {
  const { s, url, mock, wait, requests } = await setup();
  const original = mock.getMockImplementation()!;
  let broken = true;
  mock.mockImplementation((...args) => {
    const request = Request.parse(JSON.parse(args[1].user));
    return request.mode === 'scene' && broken
      ? Promise.reject(new Error('断网'))
      : original(...args);
  });
  await s.request(`${url}/import`, 'POST', {
    revision: 1,
    text: '## 便利店 夜 内\n△ 老陈站在门外。',
  });
  expect((await wait()).conversion?.status).toBe('failed');
  const located = requests.filter((request) => request.mode === 'locate').length;
  broken = false;
  await s.request(`${url}/import`, 'POST', {
    revision: 1,
    text: '## 便利店 夜 内\n△ 老陈站在门外。\n△ 老陈站在门外。',
  });
  const result = await wait();
  expect(result.conversion?.status).toBe('succeeded');
  expect(requests.filter((request) => request.mode === 'locate').length).toBeGreaterThan(located);
  expect(result.document.scenes[0].beats).toHaveLength(2);
  const calls = mock.mock.calls.length;
  expect((await s.request(`${url}/import`, 'POST', { revision: 1 })).status).toBe(409);
  expect(mock).toHaveBeenCalledTimes(calls);
});
it.each(['parsing', 'applying'])('M09 在%s阶段取消，文档与设定保持原样', async (stage) => {
  const { s, base, url, project, wait } = await setup();
  const database = s.app.get(ProjectScriptDatabase);
  const use = database.use.bind(database);
  let cancelled = false;
  vi.spyOn(database, 'use').mockImplementation(async (root, id, operation) => {
    const result = await use(root, id, operation);
    if (!cancelled && id === project.id) {
      const current = await use(root, id, (db) =>
        db.prepare('SELECT state FROM script_imports LIMIT 1').get(),
      );
      const row = z.object({ state: z.string() }).optional().parse(current);
      if (
        row &&
        z.object({ stage: z.string().nullable() }).parse(JSON.parse(row.state)).stage === stage
      ) {
        cancelled = true;
        await s.request(`${url}/import/cancel`, 'POST');
      }
    }
    return result;
  });
  await s.request(`${url}/import`, 'POST', {
    revision: 1,
    text: '## 便利店 夜 内\n△ 老陈站在门外。',
  });
  const result = await wait();
  expect(cancelled).toBe(true);
  expect(result.conversion?.status).toBe('cancelled');
  expect(result.document.scenes).toEqual([]);
  expect(result.revision).toBe(1);
  expect(StoryResult.parse(await (await s.request(`${base}/story`)).json()).elements).toEqual([]);
});
it.each(['UPSTREAM_RATE_LIMIT', 'UPSTREAM_UNAVAILABLE', 'UPSTREAM_TIMEOUT'])(
  'M10 %s仅有界重试，失败不应用',
  async (code) => {
    const { s, url, mock, wait } = await setup();
    mock.mockRejectedValue(new DomainError(code, 502, '可控上游故障'));
    await s.request(`${url}/import`, 'POST', {
      revision: 1,
      text: '## 便利店 夜 内\n△ 老陈站在门外。',
    });
    const result = await wait();
    expect(result.conversion).toMatchObject({ status: 'failed', error: '可控上游故障' });
    expect(result.revision).toBe(1);
    expect(result.document.scenes).toEqual([]);
    expect(mock).toHaveBeenCalledTimes(2);
  },
);
