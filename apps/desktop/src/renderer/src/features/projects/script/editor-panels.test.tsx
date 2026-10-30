import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { Editor } from '@tiptap/core';
import type { ScriptDocument, StoryResult } from '@frame-loom/contracts';
import { parseScriptText } from '@frame-loom/contracts';
import sample from '../../../../../../../../packages/contracts/fixtures/script-sample-01.txt?raw';
import { scriptExtensions } from './editor-extensions';
import { fromEditorJson, toEditorJson } from './editor-model';
import { Outline } from './outline';
import { moveScene } from './scene-commands';
import { ReviewPopover } from './review-popover';
import { SelectionToolbar } from './selection-toolbar';
import { CharacterAutocomplete } from './character-autocomplete';
import { ElementPanel } from './element-panel';
import { BlockHandle } from './block-handle';
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
const editors: Editor[] = [];
afterEach(() => {
  cleanup();
  editors.splice(0).forEach((editor) => editor.destroy());
});
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
const make = (document: ScriptDocument) => {
  const editor = new Editor({
    extensions: scriptExtensions(),
    content: toEditorJson(document),
    injectCSS: false,
  });
  editors.push(editor);
  return editor;
};
const story: StoryResult = {
  revision: 1,
  ignored: [],
  elements: [
    {
      id: 'a',
      kind: 'character',
      name: '林夏',
      aliases: [],
      status: 'confirmed',
      description: '',
      attrs: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mentions: 2,
      episodes: [],
    },
  ],
};
it('大纲显示幕与七场，点击定位；整场移动一次撤销', () => {
  const document: ScriptDocument = {
    schemaVersion: 2,
    preface: '',
    appendix: '',
    blocks: parseScriptText(sample).blocks,
  };
  const editor = make(document);
  const scroll = vi.fn();
  HTMLElement.prototype.scrollIntoView = scroll;
  render(<Outline editor={editor} document={document} number={1} />);
  expect(screen.getByText('第一幕')).toBeTruthy();
  expect(screen.getByText('第二幕')).toBeTruthy();
  const scenes = document.blocks.filter((block) => block.type === 'scene');
  const third = scenes[2];
  moveScene(editor, document, 1, third.id, scenes[3].id);
  expect(
    fromEditorJson(editor.getJSON()).blocks.filter((block) => block.type === 'scene')[3].id,
  ).toBe(third.id);
  editor.commands.undo();
  expect(fromEditorJson(editor.getJSON())).toEqual(document);
  fireEvent.click(screen.getByText(/1-1 旧书店/u));
  expect(scroll).toHaveBeenCalled();
});
it('存疑选择对白保留原 id，一次撤销恢复', async () => {
  const block = parseScriptText(sample).blocks.find(
    (block) => block.text === '周屿 你这几年还好吗',
  )!;
  const editor = make({ schemaVersion: 2, preface: '', appendix: '', blocks: [block] });
  const button = document.createElement('button');
  button.dataset.reviewId = block.id;
  editor.view.dom.append(button);
  render(<ReviewPopover editor={editor} blocks={[block]} source={sample} />);
  fireEvent.click(button);
  fireEvent.click(await screen.findByRole('button', { name: '改为对白（角色：周屿）' }));
  expect(fromEditorJson(editor.getJSON()).blocks[1]).toMatchObject({
    id: block.id,
    type: 'dialogue',
    text: '你这几年还好吗',
  });
  editor.commands.undo();
  expect(fromEditorJson(editor.getJSON()).blocks).toEqual([block]);
});
it('人物前缀候选用 Enter 完成', async () => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  const editor = make({
    schemaVersion: 2,
    preface: '',
    appendix: '',
    blocks: [{ id: 'a', type: 'character', text: '' }],
  });
  render(<CharacterAutocomplete editor={editor} elements={story.elements} />);
  editor.commands.insertContent('林');
  await screen.findByRole('option', { name: '林夏' });
  fireEvent.keyDown(editor.view.dom, { key: 'Enter' });
  expect(fromEditorJson(editor.getJSON()).blocks[0].text).toBe('林夏');
});
it.each([{ isComposing: true }, { keyCode: 229 }])(
  '输入法确认键 %j 不选择人物补全候选',
  async (ime) => {
    const editor = make({
      schemaVersion: 2,
      preface: '',
      appendix: '',
      blocks: [{ id: 'a', type: 'character', text: '' }],
    });
    render(<CharacterAutocomplete editor={editor} elements={story.elements} />);
    editor.commands.insertContent('林');
    await screen.findByRole('option', { name: '林夏' });
    fireEvent.keyDown(editor.view.dom, { key: 'Enter', code: 'Enter', keyCode: 13, ...ime });
    expect(fromEditorJson(editor.getJSON()).blocks).toMatchObject([{ text: '林' }]);
    fireEvent.keyDown(editor.view.dom, { key: 'Enter', code: 'Enter', keyCode: 13 });
    expect(fromEditorJson(editor.getJSON()).blocks).toMatchObject([{ text: '林夏' }]);
  },
);
it('选中文字标记道具；41 字禁用', async () => {
  const editor = make({
    schemaVersion: 2,
    preface: '',
    appendix: '',
    blocks: [{ id: 'a', type: 'action', text: '旧信封' }],
  });
  const create = vi.fn().mockResolvedValue(undefined);
  render(<SelectionToolbar editor={editor} create={create} />);
  editor.commands.setTextSelection({ from: 1, to: 4 });
  fireEvent.click(await screen.findByRole('button', { name: '标记为道具' }));
  expect(create).toHaveBeenCalledWith('prop', '旧信封');
  await waitFor(() => expect(screen.queryByRole('button', { name: '标记为人物' })).toBeNull());
  editor.commands.setContent(
    toEditorJson({
      schemaVersion: 2,
      preface: '',
      appendix: '',
      blocks: [{ id: 'a', type: 'action', text: '字'.repeat(41) }],
    }),
  );
  editor.commands.setTextSelection({ from: 1, to: 42 });
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '标记为人物' }).disabled).toBe(
      true,
    ),
  );
});
it('本集元素逐处定位、确认、忽略与合并', () => {
  const document: ScriptDocument = {
    schemaVersion: 2,
    preface: '',
    appendix: '',
    blocks: [{ id: 'a', type: 'action', text: '林夏看着林夏' }],
  };
  const editor = make(document);
  const mutate = vi.fn().mockResolvedValue(undefined);
  const scroll = vi.fn();
  HTMLElement.prototype.scrollIntoView = scroll;
  const pending = { ...story.elements[0], id: 'b', name: '小林', status: 'pending' as const };
  render(
    <ElementPanel
      editor={editor}
      document={{
        schemaVersion: 2,
        preface: '',
        appendix: '',
        blocks: [{ id: 'a', type: 'action', text: '林夏看着林夏，小林' }],
      }}
      story={{ ...story, elements: [...story.elements, pending] }}
      number={1}
      projectId="p"
      selected="a"
      onSelect={vi.fn()}
      mutate={mutate}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '下一处' }));
  expect(scroll).toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole('button', { name: '合并到…' })[1]);
  fireEvent.change(screen.getByLabelText('合并目标'), { target: { value: 'a' } });
  expect(mutate).toHaveBeenCalledWith('elements/b/merge', 'POST', { into: 'a' });
  fireEvent.click(screen.getByRole('button', { name: '忽略' }));
  expect(mutate).toHaveBeenCalledWith('elements/b', 'DELETE', undefined);
});
it('段落手柄菜单把动作改为对白', async () => {
  const editor = make({
    schemaVersion: 2,
    preface: '',
    appendix: '',
    blocks: [{ id: 'a', type: 'action', text: '你好' }],
  });
  vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 1, inside: 0 });
  render(<BlockHandle editor={editor} />);
  fireEvent.mouseMove(editor.view.dom.querySelector('p')!, { clientX: 10, clientY: 10 });
  fireEvent.click(screen.getByRole('button', { name: '段落类型：动作' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '对白' }));
  expect(fromEditorJson(editor.getJSON()).blocks[0].type).toBe('dialogue');
});
it('大纲菜单移动时读取最新正文', async () => {
  const document: ScriptDocument = {
    schemaVersion: 2,
    preface: '',
    appendix: '',
    blocks: [
      { id: 's1', type: 'scene', text: '书店' },
      { id: 'a', type: 'action', text: '旧文字' },
      { id: 's2', type: 'scene', text: '天台' },
    ],
  };
  const editor = make(document);
  render(<Outline editor={editor} document={document} number={1} />);
  const pos = editor.state.doc.child(0).nodeSize + 1;
  editor.commands.insertContentAt(pos, '新');
  fireEvent.keyDown(screen.getByRole('button', { name: '1-1 场菜单' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: '下移' }));
  expect(fromEditorJson(editor.getJSON()).blocks.map((block) => block.id)).toEqual([
    's2',
    's1',
    'a',
  ]);
  expect(fromEditorJson(editor.getJSON()).blocks[2].text).toBe('新旧文字');
});
