import { Node, type JSONContent } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import {
  EditableScriptDocument,
  ScriptMeta,
  type EditableScriptBeat,
  type EditableScriptScene,
} from '@frame-loom/contracts';

export const ScriptRootNode = Document.extend({
  content: 'scriptIntro scriptScene* scriptEnd',
  addAttributes: () => ({ meta: { default: null } }),
});
export const ScriptFieldNode = Node.create({
  name: 'scriptField',
  content: 'text*',
  marks: '',
  defining: true,
  addAttributes: () => ({ field: { default: '' } }),
  parseHTML: () => [{ tag: 'span[data-script-field]' }],
  renderHTML: ({ node }) => [
    'span',
    {
      'data-script-field': String(node.attrs.field),
      'aria-label': fieldLabel(String(node.attrs.field)),
      'data-placeholder': fieldPlaceholder(String(node.attrs.field)),
      role: 'textbox',
      class: 'script-field',
    },
    0,
  ],
});
function fieldPlaceholder(field: string) {
  return (
    (
      {
        characters: '角色A、角色B',
        atmosphere: '场景氛围描述',
        content: '动作描述',
        speaker: '角色',
        core_conflict: '一句话核心冲突',
        hook_end: '本集结尾钩子',
      } as Record<string, string>
    )[field] ?? fieldLabel(field)
  );
}
export function fieldLabel(field: string) {
  return (
    (
      {
        location: '地点',
        characters: '人物',
        atmosphere: '氛围',
        content: '动作',
        speaker: '说话人',
        emotion: '情绪',
        line: '台词',
        core_conflict: '核心冲突',
        hook_start: '开场钩子',
        hook_end: '结尾钩子',
      } as Record<string, string>
    )[field] ?? field
  );
}
export const ScriptIntroNode = Node.create({
  name: 'scriptIntro',
  content: 'scriptField{2}',
  addAttributes: () => ({ episode: { default: 1 } }),
  parseHTML: () => [{ tag: 'div[data-script-intro]' }],
  renderHTML: ({ node }) => [
    'div',
    { 'data-script-intro': '', 'data-episode-mark': `第 ${String(node.attrs.episode)} 集` },
    0,
  ],
});
export const ScriptEndNode = Node.create({
  name: 'scriptEnd',
  content: 'scriptField',
  parseHTML: () => [{ tag: 'div[data-script-end]' }],
  renderHTML: () => ['div', { 'data-script-end': '' }, 0],
});
export const ScriptSceneNode = Node.create({
  name: 'scriptScene',
  content: 'scriptField{3} scriptBeat*',
  defining: true,
  addAttributes: () => ({
    id: { default: null },
    interior: { default: true },
    time_of_day: { default: '日' },
  }),
  parseHTML: () => [{ tag: 'section[data-script-scene]' }],
  renderHTML: ({ node }) => [
    'section',
    { 'data-script-scene': '', 'data-id': String(node.attrs.id) },
    0,
  ],
});
export const ScriptBeatNode = Node.create({
  name: 'scriptBeat',
  content: 'scriptField+',
  defining: true,
  addAttributes: () => ({ id: { default: null }, type: { default: 'action' } }),
  parseHTML: () => [{ tag: 'div[data-script-beat]' }],
  renderHTML: ({ node }) => [
    'div',
    { 'data-script-beat': String(node.attrs.type), 'data-id': String(node.attrs.id) },
    0,
  ],
});
export const fieldJson = (field: string, text: string): JSONContent => ({
  type: 'scriptField',
  attrs: { field },
  ...(text ? { content: [{ type: 'text', text }] } : {}),
});
export function beatJson(beat: EditableScriptBeat): JSONContent {
  return {
    type: 'scriptBeat',
    attrs: { id: beat.id, type: beat.type },
    content:
      beat.type === 'action'
        ? [fieldJson('content', beat.content)]
        : [
            fieldJson('speaker', beat.speaker),
            fieldJson('emotion', beat.emotion),
            fieldJson('line', beat.line),
          ],
  };
}
export function sceneJson(scene: EditableScriptScene): JSONContent {
  return {
    type: 'scriptScene',
    attrs: { id: scene.id, interior: scene.interior, time_of_day: scene.time_of_day },
    content: [
      fieldJson('location', scene.location),
      fieldJson('characters', scene.characters.join('、')),
      fieldJson('atmosphere', scene.atmosphere),
      ...scene.beats.map(beatJson),
    ],
  };
}
export function toEditorJson(doc: EditableScriptDocument): JSONContent {
  return {
    type: 'doc',
    attrs: { meta: doc.meta },
    content: [
      {
        type: 'scriptIntro',
        attrs: { episode: doc.meta.episode },
        content: [
          fieldJson('core_conflict', doc.meta.core_conflict),
          fieldJson('hook_start', doc.meta.hook_start),
        ],
      },
      ...doc.scenes.map(sceneJson),
      { type: 'scriptEnd', content: [fieldJson('hook_end', doc.meta.hook_end)] },
    ],
  };
}
function text(node: JSONContent | undefined): string {
  if (
    !node ||
    node.type !== 'scriptField' ||
    node.marks?.length ||
    node.content?.some((n) => n.type !== 'text' || n.marks?.length)
  )
    throw new Error('剧本字段只允许纯文本');
  return (node.content ?? []).map((n) => n.text ?? '').join('');
}
function assertFields(node: JSONContent, names: string[]) {
  if (
    (node.content?.length ?? 0) !== names.length ||
    names.some(
      (name, index) =>
        node.content?.[index].type !== 'scriptField' || node.content[index].attrs?.field !== name,
    )
  )
    throw new Error('剧本字段数量或顺序无效');
}
export function fromEditorJson(json: JSONContent): EditableScriptDocument {
  if (json.type !== 'doc') throw new Error('剧本根节点无效');
  const meta = ScriptMeta.parse(json.attrs?.meta);
  const intro = json.content?.[0],
    end = json.content?.at(-1);
  if (intro?.type !== 'scriptIntro' || end?.type !== 'scriptEnd')
    throw new Error('剧本头尾字段无效');
  assertFields(intro, ['core_conflict', 'hook_start']);
  assertFields(end, ['hook_end']);
  return EditableScriptDocument.parse({
    meta: {
      ...meta,
      core_conflict: text(intro.content?.[0]),
      hook_start: text(intro.content?.[1]),
      hook_end: text(end.content?.[0]),
    },
    scenes: (json.content ?? []).slice(1, -1).map((scene, index) => {
      if (scene.type !== 'scriptScene') throw new Error('剧本只允许场次');
      const fields = scene.content ?? [];
      assertFields({ content: fields.slice(0, 3) }, ['location', 'characters', 'atmosphere']);
      const sceneAttrs: Record<string, unknown> = scene.attrs ?? {};
      return {
        id: sceneAttrs.id,
        scene_id: `${meta.episode}-${index + 1}`,
        location: text(fields[0]),
        characters: [
          ...new Set(
            text(fields[1])
              .split(/[、,，\n]/u)
              .map((n) => n.trim())
              .filter(Boolean),
          ),
        ],
        atmosphere: text(fields[2]),
        interior: sceneAttrs.interior,
        time_of_day: sceneAttrs.time_of_day,
        beats: fields.slice(3).map((beat) => {
          if (beat.type !== 'scriptBeat') throw new Error('场内只允许动作或对白');
          const attrs: Record<string, unknown> = beat.attrs ?? {};
          if (attrs.type !== 'action' && attrs.type !== 'dialogue') throw new Error('内容类型无效');
          assertFields(
            beat,
            attrs.type === 'action' ? ['content'] : ['speaker', 'emotion', 'line'],
          );
          return attrs.type === 'action'
            ? { id: attrs.id, type: 'action', content: text(beat.content?.[0]) }
            : {
                id: attrs.id,
                type: attrs.type,
                speaker: text(beat.content?.[0]),
                emotion: text(beat.content?.[1]),
                line: text(beat.content?.[2]),
              };
        }),
      };
    }),
  });
}
