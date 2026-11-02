import { expect, it } from 'vitest';
import { getSchema, type JSONContent } from '@tiptap/core';
import Text from '@tiptap/extension-text';
import { ScriptDocument, createEditableScript } from '@frame-loom/contracts';
import raw from '../../../../../../../../packages/contracts/fixtures/standard-script-short.json?raw';
import {
  ScriptRootNode,
  ScriptIntroNode,
  ScriptEndNode,
  ScriptSceneNode,
  ScriptBeatNode,
  ScriptFieldNode,
  toEditorJson,
  fromEditorJson,
} from './editor-model';
const schema = getSchema([
  ScriptRootNode,
  ScriptIntroNode,
  ScriptEndNode,
  ScriptSceneNode,
  ScriptBeatNode,
  ScriptFieldNode,
  Text,
]);
it('U01 标准业务及内部身份与 ProseMirror 无损往返，空场空字段可编辑', () => {
  const doc = createEditableScript(ScriptDocument.parse(JSON.parse(raw)));
  expect(fromEditorJson(schema.nodeFromJSON(toEditorJson(doc)).toJSON() as JSONContent)).toEqual(
    doc,
  );
  const empty = { ...doc, scenes: [] };
  expect(fromEditorJson(schema.nodeFromJSON(toEditorJson(empty)).toJSON() as JSONContent)).toEqual(
    empty,
  );
});
it('拒绝非法富文本和重复身份', () => {
  const doc = createEditableScript(ScriptDocument.parse(JSON.parse(raw)));
  const json = toEditorJson(doc);
  json.content![0].content![0].content = [
    { type: 'text', text: '伪造', marks: [{ type: 'bold' }] },
  ];
  expect(() => fromEditorJson(json)).toThrow('纯文本');
});
it('拒绝多余字段、字段错序及未知内容类型，不能静默丢文字', () => {
  const doc = createEditableScript(ScriptDocument.parse(JSON.parse(raw)));
  for (const change of [
    (json: JSONContent) => {
      json.content![1].content![3].content!.push({
        type: 'scriptField',
        attrs: { field: 'content' },
        content: [{ type: 'text', text: '不可丢失' }],
      });
    },
    (json: JSONContent) => {
      json.content![0].content!.reverse();
    },
    (json: JSONContent) => {
      json.content![1].content![3].attrs = { id: crypto.randomUUID(), type: 'sound' };
    },
  ]) {
    const json = toEditorJson(doc);
    change(json);
    expect(() => fromEditorJson(json)).toThrow();
  }
});
