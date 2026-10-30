// @vitest-environment node
import sample from '../../../../../../../../packages/contracts/fixtures/script-sample-01.txt?raw';
import sample2 from '../../../../../../../../packages/contracts/fixtures/script-sample-02.txt?raw';
import type { JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import Text from '@tiptap/extension-text';
import { BLOCK_TYPES, parseScriptText, type ScriptDocument } from '@frame-loom/contracts';
import { fromEditorJson, ScriptBlockNode, ScriptRootNode, toEditorJson } from './editor-model';

export const schema = getSchema([ScriptRootNode, Text, ScriptBlockNode]);
describe('剧本文档模型', () => {
  const documents: ScriptDocument[] = [
    { schemaVersion: 2, preface: '', appendix: '', blocks: parseScriptText(sample).blocks },
    {
      schemaVersion: 2,
      preface: parseScriptText(sample2).preface,
      appendix: parseScriptText(sample2).appendix,
      blocks: parseScriptText(sample2).blocks,
    },
    {
      schemaVersion: 2,
      preface: '前言',
      appendix: '附录',
      blocks: BLOCK_TYPES.map((type, index) => ({
        id: `b${index}`,
        type,
        text: index % 2 ? '内容' : '',
        ...(type === 'scene'
          ? {
              attrs: {
                time: 'night' as const,
                space: 'ext' as const,
                timeText: null,
                note: null,
                timecode: null,
              },
            }
          : type === 'character'
            ? { attrs: { delivery: 'os' as const, extension: null } }
            : type === 'sound' || type === 'production'
              ? { attrs: { label: '音效' } }
              : {}),
        ...(index % 2
          ? { src: { line: index }, review: { reason: '存疑', options: [{ type }] } }
          : {}),
      })),
    },
  ];
  it.each(documents)('经 EditorState 无损往返', (document) => {
    const state = EditorState.create({ schema, doc: schema.nodeFromJSON(toEditorJson(document)) });
    expect(fromEditorJson(state.doc.toJSON() as JSONContent)).toEqual(document);
  });
  it('拒绝换行和行内标记', () => {
    expect(() =>
      fromEditorJson(
        toEditorJson({
          schemaVersion: 2,
          preface: '',
          appendix: '',
          blocks: [{ id: 'a', type: 'action', text: '一\n二' }],
        }),
      ),
    ).toThrow();
    expect(() =>
      fromEditorJson({
        type: 'doc',
        content: [
          {
            type: 'scriptBlock',
            content: [{ type: 'text', text: '一', marks: [{ type: 'bold' }] }],
          },
        ],
      }),
    ).toThrow();
  });
});
