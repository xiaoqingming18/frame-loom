import { expect, it } from 'vitest';
import raw from '../fixtures/standard-script-short.json?raw';
import {
  ScriptDocument,
  EditableScriptDocument,
  ScriptBeat,
  ScriptMeta,
  StoryElement,
  createEditableScript,
  standardScriptDocument,
  projectScriptDocument,
  normalizeAction,
} from './scripts.js';
import { EpisodeSummary, ProjectManifest, ProjectDiskManifest } from './projects.js';

const doc = ScriptDocument.parse(JSON.parse(raw));
it('C01/C02/C03 标准文档严格限定字段、类型和秒数，草稿允许空场', () => {
  expect(
    ScriptDocument.parse({ meta: { ...doc.meta, duration_sec: 0 }, scenes: [] }).scenes,
  ).toEqual([]);
  for (const patch of [{ blocks: [] }, { preface: '' }, { appendix: '' }, { duration_text: '' }])
    expect(ScriptDocument.safeParse({ ...doc, ...patch }).success).toBe(false);
  for (const type of ['sound', 'production', 'note'])
    expect(ScriptBeat.safeParse({ type, content: '' }).success).toBe(false);
  expect(
    ScriptBeat.safeParse({ type: 'dialogue', speaker: '', emotion: '', line: '' }).success,
  ).toBe(true);
  expect(ScriptBeat.safeParse({ type: 'dialogue', speaker: '', emotion: '' }).success).toBe(false);
  expect(ScriptBeat.safeParse({ type: 'action', content: '', speaker: '' }).success).toBe(false);
  for (const duration_sec of [-1, 0.5])
    expect(ScriptMeta.safeParse({ ...doc.meta, duration_sec }).success).toBe(false);
  for (const patch of [{ time_of_day: '晨' }, { interior: '内' }])
    expect(
      ScriptDocument.safeParse({ ...doc, scenes: [{ ...doc.scenes[0], ...patch }] }).success,
    ).toBe(false);
  const editable = createEditableScript(doc);
  expect(
    EditableScriptDocument.safeParse({
      ...editable,
      scenes: [editable.scenes[0], editable.scenes[0]],
    }).success,
  ).toBe(false);
});
it('C04 动作标记幂等，台词标点不变，业务输出不含内部身份', () => {
  for (const text of ['动作。', '△ 动作。', '△ △ △ 动作。']) {
    let content = text;
    for (let n = 0; n < 3; n++) content = normalizeAction(content);
    expect(content).toBe('动作。');
  }
  expect(standardScriptDocument(createEditableScript(doc))).toEqual(doc);
});
it('C05/C08 投影最新权威信息，移动和改单集号不改变身份', () => {
  const editable = createEditableScript(doc);
  const scenes = [...editable.scenes].reverse();
  const result = projectScriptDocument(
    { ...editable, scenes },
    {
      name: '新剧名',
      profile: { genres: ['都市'], style: '新画风' },
      episode: { number: 5, title: '新标题', duration_sec: 120 },
    },
  );
  expect(result.meta).toEqual({
    ...doc.meta,
    series: '新剧名',
    genre: '都市',
    style: '新画风',
    episode: 5,
    title: '新标题',
    duration_sec: 120,
  });
  expect(result.scenes.map((s) => s.scene_id)).toEqual(['5-1', '5-2']);
  expect(result.scenes.map((s) => s.id)).toEqual(scenes.map((s) => s.id));
  expect(result.scenes[0].beats).toEqual(scenes[0].beats);
});
it('C06 新磁盘清单拒绝剧集聚合，HTTP 允许，旧清单仍可识别', () => {
  const now = new Date().toISOString();
  const manifest = {
    format: 'frame-loom-project',
    formatVersion: 2,
    id: crypto.randomUUID(),
    name: '项目',
    createdAt: now,
    updatedAt: now,
    pages: [],
  };
  const episodes = [
    EpisodeSummary.parse({
      id: crypto.randomUUID(),
      number: 1,
      title: '',
      createdAt: now,
      updatedAt: now,
      scenes: 0,
      chars: 0,
      draft: true,
    }),
  ];
  expect(ProjectManifest.parse({ ...manifest, episodes }).episodes).toEqual(episodes);
  expect(ProjectDiskManifest.safeParse({ ...manifest, episodes }).success).toBe(false);
  expect(ProjectDiskManifest.parse(manifest).formatVersion).toBe(2);
  expect(ProjectManifest.parse({ ...manifest, formatVersion: 1, episodes }).formatVersion).toBe(1);
});
it('人物和地点资料分开校验，名字及别名精确碰撞', () => {
  const now = new Date().toISOString();
  const element = {
    id: crypto.randomUUID(),
    kind: 'character',
    name: '林夏',
    aliases: [],
    status: 'pending',
    attrs: {},
    description: '',
    manuallyEdited: false,
    createdAt: now,
    updatedAt: now,
  };
  expect(
    StoryElement.parse({ ...element, attrs: { age: '约30岁', appearance: ['黑发'] } }).attrs,
  ).toEqual({ age: '约30岁', appearance: ['黑发'] });
  expect(StoryElement.safeParse({ ...element, aliases: [' 林夏 '] }).success).toBe(false);
  expect(StoryElement.safeParse({ ...element, attrs: { layout: '大厅' } }).success).toBe(false);
  expect(StoryElement.safeParse({ ...element, kind: 'prop', attrs: { age: '' } }).success).toBe(
    false,
  );
});
