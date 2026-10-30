// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getSchema, type JSONContent } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state';
import { history, undo, redo } from '@tiptap/pm/history';
import { BLOCK_TYPES, type ScriptBlock } from '@frame-loom/contracts';
import { ScriptBlockNode, fromEditorJson, toEditorJson } from './editor-model';
import {
  NEXT_TYPE,
  TYPE_CYCLE,
  applyReview,
  backspaceBlock,
  clearReviewPlugin,
  cycleBlockType,
  enterBlock,
  moveBlock,
  pasteLines,
  setBlockType,
} from './script-commands';

const schema = getSchema([Document.extend({ content: 'scriptBlock+' }), Text, ScriptBlockNode]);
function setup(blocks: ScriptBlock[], cursor = blocks[0].text.length + 1) {
  let state = EditorState.create({
    schema,
    doc: schema.nodeFromJSON(toEditorJson({ schemaVersion: 2, preface: '', appendix: '', blocks })),
    plugins: [history(), clearReviewPlugin()],
  });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, cursor)));
  return {
    get state() {
      return state;
    },
    get blocks() {
      return fromEditorJson(state.doc.toJSON() as JSONContent).blocks;
    },
    run(command: Command) {
      return command(state, (tr) => {
        state = state.applyTransaction(tr).state;
      });
    },
  };
}
describe('剧本键盘命令', () => {
  it.each(BLOCK_TYPES)('%s 末尾 Enter 映射', (type) => {
    const editor = setup([{ id: 'a', type, text: '内容' }]);
    editor.run(enterBlock);
    expect(editor.blocks.map((block) => block.type)).toEqual([type, NEXT_TYPE[type]]);
    expect(new Set(editor.blocks.map((block) => block.id)).size).toBe(2);
  });
  it.each(BLOCK_TYPES.filter((type) => type !== 'action'))('%s 空段 Enter 改动作', (type) => {
    const editor = setup([{ id: 'a', type, text: '' }]);
    editor.run(enterBlock);
    expect(editor.blocks).toEqual([{ id: 'a', type: 'action', text: '' }]);
  });
  it('Tab 整圈和反向、非空吞 Tab', () => {
    const editor = setup([{ id: 'a', type: 'action', text: '' }]);
    for (const type of [...TYPE_CYCLE.slice(1), 'action']) {
      editor.run(cycleBlockType(1));
      expect(editor.blocks[0].type).toBe(type);
    }
    editor.run(cycleBlockType(-1));
    expect(editor.blocks[0].type).toBe('act');
    const nonempty = setup([{ id: 'a', type: 'action', text: '文字' }]);
    expect(nonempty.run(cycleBlockType(1))).toBe(true);
    expect(nonempty.blocks[0].type).toBe('action');
  });
  it.each(BLOCK_TYPES)('直接切换 %s 并清 review', (type) => {
    const editor = setup([
      {
        id: 'a',
        type: 'action',
        text: '',
        review: { reason: '未知', options: [{ type: 'action' }] },
      },
    ]);
    editor.run(setBlockType(type));
    expect(editor.blocks[0]).toEqual({ id: 'a', type, text: '' });
  });
  it('解析场标题和角色后缀', () => {
    const scene = setup([{ id: 'a', type: 'action', text: '1-8 夜 外 天台' }]);
    scene.run(enterBlock);
    expect(scene.blocks[0]).toEqual({
      id: 'a',
      type: 'scene',
      text: '天台',
      attrs: { time: 'night', space: 'ext', timeText: null, note: null, timecode: null },
    });
    const character = setup([{ id: 'a', type: 'character', text: '店主（OS）' }]);
    character.run(enterBlock);
    expect(character.blocks[0]).toEqual({
      id: 'a',
      type: 'character',
      text: '店主',
      attrs: { delivery: 'os', extension: null },
    });
  });
  it('中间拆分后半无来源，撤销恢复 id，重做仍唯一', () => {
    const original: ScriptBlock[] = [
      { id: 'a', type: 'action', text: '你好世界', src: { line: 1 } },
    ];
    const editor = setup(original, 3);
    editor.run(enterBlock);
    expect(editor.blocks.map((block) => block.text)).toEqual(['你好', '世界']);
    expect(editor.blocks[1].src).toBeUndefined();
    expect(editor.blocks[1].id).not.toBe('a');
    editor.run(undo);
    expect(editor.blocks).toEqual(original);
    editor.run(redo);
    expect(new Set(editor.blocks.map((block) => block.id)).size).toBe(2);
  });
  it('文本变化清存疑，候选拆分保留对白 id', () => {
    const block: ScriptBlock = {
      id: 'a',
      type: 'action',
      text: '周屿 你好',
      review: { reason: '存疑', options: [{ type: 'dialogue', character: '周屿', text: '你好' }] },
    };
    const editor = setup([block]);
    editor.run(applyReview('a', block.review!.options[0]));
    expect(editor.blocks[1]).toEqual({ id: 'a', type: 'dialogue', text: '你好' });
    editor.run(undo);
    expect(editor.blocks).toEqual([block]);
    editor.run((state, dispatch) => {
      dispatch?.(state.tr.insertText('啊'));
      return true;
    });
    expect(editor.blocks[0].review).toBeUndefined();
  });
  it('多行粘贴、移动和开头退格', () => {
    const editor = setup([{ id: 'a', type: 'scene', text: '' }]);
    editor.run(pasteLines('一\n二\n三'));
    expect(editor.blocks.map((block) => block.type)).toEqual(['action', 'action', 'action']);
    expect(new Set(editor.blocks.map((block) => block.id)).size).toBe(3);
    const moving = setup([
      { id: 'a', type: 'action', text: '一' },
      { id: 'b', type: 'action', text: '二' },
    ]);
    moving.run(moveBlock(1));
    expect(moving.blocks.map((block) => block.id)).toEqual(['b', 'a']);
    moving.run(moveBlock(-1));
    expect(moving.blocks.map((block) => block.id)).toEqual(['a', 'b']);
    const joining = setup(
      [
        { id: 'a', type: 'action', text: '一' },
        { id: 'b', type: 'action', text: '二' },
      ],
      4,
    );
    joining.run(backspaceBlock);
    expect(joining.blocks[0].text).toBe('一二');
  });
  it('组字期间所有命令不处理', () => {
    const editor = setup([{ id: 'a', type: 'action', text: '' }]);
    for (const command of [
      enterBlock,
      setBlockType('scene'),
      cycleBlockType(1),
      moveBlock(1),
      pasteLines('一\n二'),
      backspaceBlock,
    ])
      expect(command(editor.state, undefined, { composing: true } as never)).toBe(false);
  });
  it('保持当前只清除存疑，保留场标题属性和来源', () => {
    const block: ScriptBlock = {
      id: 'a',
      type: 'scene',
      text: '天台',
      attrs: { time: 'night', space: 'ext', timeText: null, note: null, timecode: null },
      src: { line: 1 },
      review: { reason: '存疑', options: [{ type: 'scene' }] },
    };
    const editor = setup([block]);
    editor.run(applyReview('a'));
    expect(editor.blocks[0]).toEqual({ ...block, review: undefined });
  });
});
