// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { getSchema } from '@tiptap/core';
import { DecorationSet } from '@tiptap/pm/view';
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
it('默认不显示下划线，选择一个元素或打开全部模式后才显示，存疑不受影响', () => {
  const plugin = createDecorations();
  let state = EditorState.create({
    schema,
    doc: schema.nodeFromJSON(
      toEditorJson({
        schemaVersion: 2,
        preface: '',
        appendix: '',
        blocks: [
          {
            id: 'a',
            type: 'action',
            text: '林夏 天台',
            review: { reason: '存疑', options: [{ type: 'action' }] },
          },
        ],
      }),
    ),
    plugins: [plugin],
  });
  const allTerms = [...terms, { name: '天台', kind: 'location' as const, elementId: 'b' }];
  state = state.apply(state.tr.setMeta('mentions', allTerms));
  const visible = () => (plugin.props.decorations!.call(plugin, state) as DecorationSet).find();
  expect(
    visible().filter((decoration) => (decoration.spec as { mention?: boolean }).mention),
  ).toHaveLength(0);
  expect(
    visible().some((decoration) =>
      (decoration.spec as { key?: string }).key?.startsWith('review-'),
    ),
  ).toBe(true);
  state = state.apply(state.tr.setMeta('selectedElement', 'a'));
  expect(
    visible()
      .filter((decoration) => (decoration.spec as { mention?: boolean }).mention)
      .map((decoration) => (decoration.spec as { elementId?: string }).elementId),
  ).toEqual(['a']);
  state = state.apply(state.tr.setMeta('scriptMentions', true));
  expect(
    visible().filter((decoration) => (decoration.spec as { mention?: boolean }).mention),
  ).toHaveLength(2);
});
