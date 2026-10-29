import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { SceneAttrs, CharacterAttrs } from '@frame-loom/contracts';

const timeLabels = { day: '日', night: '夜', dawn: '晨', dusk: '昏' };
const spaceLabels = { int: '内', ext: '外', intext: '内外' };
export const SceneChips = Extension.create<{ episodeNumber: number }>({
  name: 'sceneChips',
  addOptions: () => ({ episodeNumber: 1 }),
  addProseMirrorPlugins() {
    const episodeNumber = this.options.episodeNumber;
    return [
      new Plugin({
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            let scene = 0;
            state.doc.forEach((node, pos) => {
              if (node.attrs.type === 'scene') {
                scene++;
                const number = scene;
                const attrs = node.attrs.attrs
                  ? (JSON.parse(node.attrs.attrs as string) as SceneAttrs)
                  : { time: null, space: null };
                decorations.push(
                  Decoration.widget(
                    pos + 1,
                    (view) => {
                      const container = document.createElement('span');
                      container.className = 'script-scene-chips';
                      container.contentEditable = 'false';
                      const badge = document.createElement('span');
                      badge.textContent = `${episodeNumber}-${number}`;
                      container.append(badge);
                      for (const field of ['time', 'space'] as const) {
                        const button = document.createElement('button');
                        button.type = 'button';
                        button.setAttribute(
                          'aria-label',
                          field === 'time' ? '切换场景时间' : '切换场景内外',
                        );
                        button.textContent =
                          field === 'time'
                            ? attrs.time
                              ? timeLabels[attrs.time]
                              : '时间'
                            : attrs.space
                              ? spaceLabels[attrs.space]
                              : '内外';
                        button.addEventListener('mousedown', (event) => event.preventDefault());
                        button.addEventListener('click', () => {
                          if (!view.editable) return;
                          const current = view.state.doc.nodeAt(pos);
                          if (!current) return;
                          const values =
                            field === 'time'
                              ? [null, 'day', 'night', 'dawn', 'dusk']
                              : [null, 'int', 'ext', 'intext'];
                          const next = {
                            ...attrs,
                            [field]: values[(values.indexOf(attrs[field]) + 1) % values.length],
                          };
                          view.dispatch(
                            view.state.tr.setNodeMarkup(pos, undefined, {
                              ...current.attrs,
                              attrs: JSON.stringify(next),
                            }),
                          );
                        });
                        container.append(button);
                      }
                      return container;
                    },
                    { key: `scene-${node.attrs.id}-${node.attrs.attrs}-${number}`, side: -1 },
                  ),
                );
              }
              if (node.attrs.type === 'character' && node.attrs.attrs) {
                const { delivery } = JSON.parse(node.attrs.attrs as string) as CharacterAttrs;
                if (delivery)
                  decorations.push(
                    Decoration.widget(
                      pos + node.nodeSize - 1,
                      () => {
                        const span = document.createElement('span');
                        span.className = 'script-chip';
                        span.textContent = delivery.toUpperCase();
                        return span;
                      },
                      { key: `${node.attrs.id}-${delivery}` },
                    ),
                  );
              }
              if (
                node.attrs.type === 'sound' ||
                node.attrs.type === 'text' ||
                node.attrs.type === 'note'
              )
                decorations.push(
                  Decoration.widget(
                    pos + 1,
                    () => {
                      const span = document.createElement('span');
                      span.textContent =
                        node.attrs.type === 'sound'
                          ? '♬ '
                          : node.attrs.type === 'text'
                            ? '字幕 '
                            : '▤ ';
                      span.setAttribute('aria-hidden', 'true');
                      return span;
                    },
                    { key: `prefix-${node.attrs.id}-${node.attrs.type}`, side: -1 },
                  ),
                );
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
