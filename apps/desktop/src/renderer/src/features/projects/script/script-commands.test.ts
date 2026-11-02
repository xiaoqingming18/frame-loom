import { afterEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { emptyScriptDocument, type EditableScriptDocument } from '@frame-loom/contracts';
import { scriptExtensions, isScriptCompositionKey } from './editor-extensions';
import { toEditorJson, fromEditorJson } from './editor-model';
import {
  addScene,
  addBeat,
  moveNode,
  removeNode,
  switchBeat,
  enterBeat,
  backspaceBeat,
  focusField,
  pasteText,
} from './script-commands';
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});
it('U06/U07 字段跳转不改正文，空行退格回到前文，非空行和跨字段粘贴不删结构', () => {
  const editor = setup();
  addScene(editor);
  addBeat(editor, read(editor).scenes[0].id, 'dialogue');
  const before = read(editor);
  expect(editor.state.selection.$from.parent.attrs.field).toBe('speaker');
  focusField(1)(editor.state, editor.view.dispatch, editor.view);
  expect(editor.state.selection.$from.parent.attrs.field).toBe('emotion');
  focusField(-1)(editor.state, editor.view.dispatch, editor.view);
  expect(editor.state.selection.$from.parent.attrs.field).toBe('speaker');
  expect(read(editor)).toEqual(before);
  backspaceBeat(editor.state, editor.view.dispatch, editor.view);
  expect(read(editor).scenes[0].beats).toEqual([]);
  expect(editor.state.selection.$from.parent.attrs.field).toBe('atmosphere');
  addBeat(editor, before.scenes[0].id, 'action');
  pasteText('林夏\r\n等一等。')(editor.state, editor.view.dispatch, editor.view);
  expect(read(editor).scenes[0].beats[0]).toMatchObject({ content: '林夏\n等一等。' });
  const end = editor.state.selection.from;
  const start = editor.state.selection.$from.start();
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, start)));
  expect(backspaceBeat(editor.state, editor.view.dispatch, editor.view)).toBe(true);
  expect(read(editor).scenes[0].beats).toHaveLength(1);
  const full = read(editor);
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2, end)),
  );
  pasteText('覆盖')(editor.state, editor.view.dispatch, editor.view);
  expect(read(editor)).toEqual(full);
});
function setup() {
  const doc = emptyScriptDocument({
    name: '剧名',
    episode: { number: 2, title: '重逢', duration_sec: 0 },
  });
  const editor = new Editor({ extensions: scriptExtensions(), content: toEditorJson(doc) });
  editors.push(editor);
  return editor;
}
const read = (editor: Editor): EditableScriptDocument => fromEditorJson(editor.getJSON());
it('U04 场次添加移动删除保持身份，场号自动，操作可单步撤销', () => {
  const editor = setup();
  addScene(editor);
  addScene(editor);
  const before = read(editor).scenes.map((s) => s.id);
  moveNode(editor, before[1], -1);
  expect(read(editor).scenes.map((s) => s.id)).toEqual([...before].reverse());
  expect(read(editor).scenes.map((s) => s.scene_id)).toEqual(['2-1', '2-2']);
  editor.commands.undo();
  expect(read(editor).scenes.map((s) => s.id)).toEqual(before);
  removeNode(editor, before[0]);
  expect(read(editor).scenes).toHaveLength(1);
  removeNode(editor, before[1]);
  expect(read(editor).scenes).toHaveLength(1);
});
it('U05/U08 对白转动作保留全字段，一次撤销恢复身份和字段', () => {
  const editor = setup();
  addScene(editor);
  const scene = read(editor).scenes[0];
  addBeat(editor, scene.id, 'dialogue');
  const doc = read(editor);
  const beat = doc.scenes[0].beats[0];
  doc.scenes[0].beats = [
    { id: beat.id, type: 'dialogue', speaker: '林夏', emotion: '疑惑', line: '您认识我？' },
  ];
  editor.commands.setContent(toEditorJson(doc), { emitUpdate: false });
  switchBeat(editor, beat.id);
  expect(read(editor).scenes[0].beats[0]).toEqual({
    id: beat.id,
    type: 'action',
    content: '林夏（疑惑）：您认识我？',
  });
  editor.commands.undo();
  expect(read(editor).scenes[0].beats).toEqual(doc.scenes[0].beats);
  switchBeat(editor, beat.id);
  switchBeat(editor, beat.id);
  expect(read(editor).scenes[0].beats).toEqual(doc.scenes[0].beats);
});
it('U06/U07 Enter 新增同类、空行删除，组字和229确认不拆行', () => {
  const editor = setup();
  addScene(editor);
  addBeat(editor, read(editor).scenes[0].id, 'action');
  expect(enterBeat(editor.state, editor.view.dispatch, editor.view)).toBe(true);
  expect(read(editor).scenes[0].beats).toHaveLength(2);
  const position = editor.state.selection.from;
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position)),
  );
  backspaceBeat(editor.state, editor.view.dispatch, editor.view);
  expect(read(editor).scenes[0].beats).toHaveLength(1);
  expect(
    isScriptCompositionKey(
      editor.view,
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }),
    ),
  ).toBe(true);
  expect(
    isScriptCompositionKey(
      editor.view,
      new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229 }),
    ),
  ).toBe(true);
});
