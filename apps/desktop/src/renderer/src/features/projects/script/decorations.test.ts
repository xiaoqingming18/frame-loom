// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import { findMentions, parseScriptText } from '@frame-loom/contracts';
import sample from '../../../../../../../../packages/contracts/fixtures/script-sample-01.txt?raw';
import { ScriptBlockNode, toEditorJson } from './editor-model';
import { blockDecorations, createDecorations, scriptDecorationKey } from './decorations';
const schema = getSchema([Document.extend({ content: 'scriptBlock+' }), Text, ScriptBlockNode]);
const terms = [{ name: '林夏', kind: 'character' as const, elementId: 'a' }];
it('样例装饰与共享匹配一致，单段修改仅重算一段，meta 全量刷新', () => {
  const blocks = parseScriptText(sample).blocks;
  const compute = vi.fn(blockDecorations);
  let state = EditorState.create({
    schema,
    doc: schema.nodeFromJSON(toEditorJson({ schemaVersion: 2, preface: '', appendix: '', blocks })),
    plugins: [createDecorations(compute)],
  });
  state = state.apply(state.tr.setMeta('mentions', terms));
  const decorations = scriptDecorationKey.getState(state)!.decorations;
  state.doc.forEach((node, pos, index) => {
    const hits = decorations
      .find(pos + 1, pos + node.nodeSize - 1)
      .filter((item) => (item.spec as { mention?: boolean }).mention === true);
    expect(hits.map((item) => ({ from: item.from - pos - 1, to: item.to - pos - 1 }))).toEqual(
      findMentions(node.textContent, terms, blocks[index].type).map(({ from, to }) => ({
        from,
        to,
      })),
    );
  });
  compute.mockClear();
  state = state.apply(state.tr.insertText('林夏', 1));
  expect(compute).toHaveBeenCalledTimes(1);
  compute.mockClear();
  state = state.apply(state.tr.setMeta('mentions', terms));
  expect(compute).toHaveBeenCalledTimes(blocks.length);
});
it('注释不匹配，不包含存疑装饰', () => {
  const node = schema.nodes.scriptBlock.create(
    { id: 'a', type: 'note', review: '{}' },
    schema.text('林夏'),
  );
  expect(blockDecorations(node, 0, terms)).toEqual([]);
});
