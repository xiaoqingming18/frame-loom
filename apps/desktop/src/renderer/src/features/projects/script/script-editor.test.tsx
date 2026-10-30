import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import type { ScriptDocument } from '@frame-loom/contracts';
import { ScriptEditor } from './script-editor';
import { applyReview } from './script-commands';
import { parseScriptText } from '@frame-loom/contracts';
import sample from '../../../../../../../../packages/contracts/fixtures/script-sample-02.txt?raw';
afterEach(cleanup);
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
it('前言附录折叠、制作提示和场标题属性显示，类型选项排除幕', async () => {
  const parsed = parseScriptText(sample);
  const changed = vi.fn<(document: ScriptDocument) => void>();
  render(
    <ScriptEditor
      document={{
        schemaVersion: 2,
        preface: parsed.preface,
        appendix: parsed.appendix,
        blocks: parsed.blocks,
      }}
      onChange={changed}
      onError={vi.fn()}
    />,
  );
  const editor = await screen.findByRole('textbox', { name: '剧本编辑区' });
  for (const text of ['内景', '城西卢宅·正屋', '清晨', '多年以后', '00:00–00:35', '镜头'])
    expect(editor.textContent).toContain(text);
  expect(screen.queryByRole('option', { name: '幕' })).toBeNull();
  const summary = screen.getByText('前言').closest('summary')!;
  expect(summary.closest('details')!.open).toBe(false);
  fireEvent.click(summary);
  expect(summary.closest('details')!.textContent).toContain('一句话梗概');
  fireEvent.click(screen.getAllByRole('button', { name: '切换场景时间' })[0]);
  expect(changed.mock.lastCall?.[0].blocks[0].attrs).toMatchObject({
    timeText: null,
    time: 'dusk',
  });
});
it('渲染类型、切换时间、切换类型及撤销重做', async () => {
  const changed = vi.fn<(document: ScriptDocument) => void>();
  render(
    <ScriptEditor
      document={{
        schemaVersion: 2,
        preface: '',
        appendix: '',
        blocks: [
          {
            id: 'a',
            type: 'scene',
            text: '天台',
            attrs: { time: 'day', space: 'ext', timeText: null, note: null, timecode: null },
          },
        ],
      }}
      onChange={changed}
      onError={vi.fn()}
    />,
  );
  await screen.findByRole('textbox', { name: '剧本编辑区' });
  expect(screen.getByText('天台').getAttribute('data-block-type')).toBe('scene');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '撤销' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '切换场景时间' }));
  expect(changed.mock.lastCall?.[0].blocks[0].attrs).toEqual({
    time: 'night',
    space: 'ext',
    timeText: null,
    note: null,
    timecode: null,
  });
  fireEvent.change(screen.getByLabelText('段落类型'), { target: { value: 'dialogue' } });
  expect(changed.mock.lastCall?.[0].blocks[0].type).toBe('dialogue');
  fireEvent.click(screen.getByRole('button', { name: '撤销' }));
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '重做' }).disabled).toBe(false),
  );
});
it('粘贴三行生成三个动作段', async () => {
  let editor: Editor | null = null;
  const changed = vi.fn<(document: ScriptDocument) => void>();
  render(
    <ScriptEditor
      document={{
        schemaVersion: 2,
        preface: '',
        appendix: '',
        blocks: [{ id: 'a', type: 'scene', text: '' }],
      }}
      onChange={changed}
      onError={vi.fn()}
      onEditor={(value) => {
        editor = value;
      }}
    />,
  );
  const textbox = await screen.findByRole('textbox', { name: '剧本编辑区' });
  await waitFor(() => expect(editor).not.toBeNull());
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => '一\n二\n三' } });
  fireEvent(textbox, event);
  expect(changed.mock.lastCall?.[0].blocks.map((block) => block.text)).toEqual(['一', '二', '三']);
});
it('保持存疑场标题后仍显示可切换徽标', async () => {
  let editor: Editor | null = null;
  const changed = vi.fn<(document: ScriptDocument) => void>();
  render(
    <ScriptEditor
      document={{
        schemaVersion: 2,
        preface: '',
        appendix: '',
        blocks: [
          {
            id: 'a',
            type: 'scene',
            text: '天台',
            attrs: { time: 'night', space: 'ext', timeText: null, note: null, timecode: null },
            review: { reason: '存疑', options: [{ type: 'scene' }] },
          },
        ],
      }}
      onChange={changed}
      onError={vi.fn()}
      onEditor={(value) => {
        editor = value;
      }}
    />,
  );
  await screen.findByRole('textbox', { name: '剧本编辑区' });
  await waitFor(() => expect(editor).not.toBeNull());
  editor!.commands.command(({ state, dispatch }) => applyReview('a')(state, dispatch));
  fireEvent.click(screen.getByRole('button', { name: '切换场景时间' }));
  expect(changed.mock.lastCall?.[0].blocks[0].attrs).toEqual({
    time: 'dawn',
    space: 'ext',
    timeText: null,
    note: null,
    timecode: null,
  });
});

it.each([{ isComposing: true }, { keyCode: 229 }])(
  '输入法确认键 %j 不拆段，后续普通 Enter 正常拆段',
  async (ime) => {
    render(
      <ScriptEditor
        document={{
          schemaVersion: 2,
          preface: '',
          appendix: '',
          blocks: [{ id: 'a', type: 'action', text: '你好' }],
        }}
        onChange={vi.fn()}
        onError={vi.fn()}
      />,
    );
    const textbox = await screen.findByRole('textbox', { name: '剧本编辑区' });
    fireEvent.keyDown(textbox, { key: 'Enter', code: 'Enter', keyCode: 13, ...ime });
    expect(textbox.querySelectorAll('p')).toHaveLength(1);
    expect(textbox.textContent).toBe('你好');
    fireEvent.keyDown(textbox, { key: 'Enter', code: 'Enter', keyCode: 13 });
    expect(textbox.querySelectorAll('p')).toHaveLength(2);
  },
);
