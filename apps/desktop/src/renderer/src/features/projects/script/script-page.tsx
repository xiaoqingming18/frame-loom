import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useBlocker, useRouteContext } from '@tanstack/react-router';
import {
  episodeLabel,
  ScriptSaveResult,
  StoryElement,
  type ScriptResult,
  type ElementKind,
  EngineEvent,
  applyMarkdownEdit,
  renderScriptMarkdown,
} from '@frame-loom/contracts';
import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { Button } from '@frame-loom/ui/components/button';
import { commandWindow, setPreferences } from '@/lib/desktop-bridge';
import type { EngineClient } from '@/lib/engine-client';
import { preferencesQuery, projectQuery, scriptQuery, storyQuery } from '@/lib/project-queries';
import { createScriptPersistence } from './script-persistence';
import { ScriptEditor } from './script-editor';
import { toEditorJson } from './editor-model';
import { MarkdownView, ScriptViewTabs } from './markdown-view';
import { BlockHandle } from './block-handle';
import { ReviewPopover } from './review-popover';
import { SelectionToolbar } from './selection-toolbar';
import { CharacterAutocomplete } from './character-autocomplete';
import { MentionCard } from './mention-card';
import { ElementPanel } from './element-panel';
import { scrollToBlock } from './scene-commands';
import { ImportDialog } from './import-dialog';
import { ConversionBanner } from './conversion-banner';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@frame-loom/ui/components/dialog';

export function ScriptPage({
  projectId,
  episodeId,
  blockId,
}: {
  projectId: string;
  episodeId: string;
  blockId?: string;
}) {
  const { engineClient } = useRouteContext({ from: '__root__' });
  const project = useQuery(projectQuery(engineClient, projectId));
  const script = useQuery(scriptQuery(engineClient, projectId, episodeId));
  const episode = project.data?.episodes?.find((episode) => episode.id === episodeId);
  return (
    <section className="flex h-full flex-col bg-background">
      <nav
        aria-label="面包屑"
        className="flex min-w-0 items-center gap-2 border-b px-5 py-4 text-sm text-muted-foreground"
      >
        <Link to="/projects" search={{}}>
          项目库
        </Link>
        <span>/</span>
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          search={{ tab: 'episodes', path: '' }}
        >
          {project.data?.name ?? '项目'}
        </Link>
        <span>/</span>
        <span className="truncate text-foreground">{episode ? episodeLabel(episode) : '剧本'}</span>
      </nav>
      {script.error ? (
        <p role="alert">{script.error.message}</p>
      ) : script.isPending ? (
        <p role="status">正在读取剧本…</p>
      ) : (
        <ScriptSession
          key={`${projectId}/${episodeId}`}
          initial={script.data}
          client={engineClient}
          projectId={projectId}
          episodeId={episodeId}
          blockId={blockId}
          number={episode?.number ?? 1}
        />
      )}
    </section>
  );
}

function ScriptSession({
  initial,
  client,
  projectId,
  episodeId,
  blockId,
  number,
}: {
  initial: ScriptResult;
  client: EngineClient;
  projectId: string;
  episodeId: string;
  blockId?: string;
  number: number;
}) {
  const queryClient = useQueryClient();
  const preferences = useQuery(preferencesQuery());
  const [preferenceBusy, setPreferenceBusy] = useState(false);
  const [viewOverride, setViewOverride] = useState<'styled' | 'markdown' | null>(null);
  const view = viewOverride ?? (blockId ? 'styled' : (preferences.data?.scriptView ?? 'styled'));
  const [markdownText, setMarkdownText] = useState(
    () => renderScriptMarkdown(initial.document).text,
  );
  const markdown = useRef({ oldDoc: initial.document, oldText: markdownText, text: markdownText });
  const [markdownError, setMarkdownError] = useState<string | null>(null);
  const [markdownDirty, setMarkdownDirty] = useState(false);
  const [unsure, setUnsure] = useState(0);
  const [markdownCursor, setMarkdownCursor] = useState<number>();
  const applyingMarkdown = useRef(false);
  const switchingView = useRef(false);
  const pendingMarkdown = useRef<Promise<boolean> | null>(null);
  const story = useQuery(storyQuery(client, projectId));
  const project = useQuery(projectQuery(client, projectId));
  const [importOpen, setImportOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [openedAt] = useState(Date.now);
  const running =
    initial.conversion?.status === 'queued' || initial.conversion?.status === 'running';
  const [editor, setEditor] = useState<Editor | null>(null);
  const focusBlank = useRef(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [elementsOpen, setElementsOpen] = useState<boolean>();
  const [record] = useState(initial);
  const allowClose = useRef(false);
  const persistence = useMemo(
    () =>
      createScriptPersistence(
        record,
        (revision, document) =>
          client.request(`/projects/${projectId}/episodes/${episodeId}/script`, ScriptSaveResult, {
            method: 'PUT',
            body: { revision, document },
          }),
        (result, document) => {
          queryClient.setQueryData(
            scriptQuery(client, projectId, episodeId).queryKey,
            (previous) =>
              previous ? { ...previous, revision: result.revision, document } : previous,
          );
          void queryClient.invalidateQueries({
            queryKey: ['projects', projectId, 'episodes'],
            exact: true,
          });
          void queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'story'] });
        },
      ),
    [client, projectId, episodeId, queryClient, record],
  );
  const state = useSyncExternalStore(persistence.subscribe, persistence.getSnapshot);
  async function flush() {
    if (pendingMarkdown.current) {
      if (!(await pendingMarkdown.current)) return false;
      return flush();
    }
    const current = markdown.current;
    if (view === 'markdown' && current.text !== current.oldText) {
      const text = current.text;
      const run = async () => {
        try {
          const result = applyMarkdownEdit(current.oldDoc, current.oldText, text);
          setMarkdownError(null);
          setUnsure(result.unsure.length);
          persistence.change(result.document);
          if (!(await persistence.flush())) return false;
          markdown.current = {
            oldDoc: result.document,
            oldText: text,
            text: markdown.current.text,
          };
          setMarkdownDirty(markdown.current.text !== text);
          return true;
        } catch (error) {
          setMarkdownError(error instanceof Error ? error.message : 'Markdown 转换失败');
          return false;
        }
      };
      pendingMarkdown.current = run();
      try {
        return await pendingMarkdown.current;
      } finally {
        pendingMarkdown.current = null;
      }
    }
    return persistence.flush();
  }
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(() => {
    if (view !== 'markdown' || markdown.current.text === markdown.current.oldText || running)
      return;
    const timer = setTimeout(() => {
      void flushRef.current();
    }, 1000);
    return () => clearTimeout(timer);
  }, [markdownText, view, running]);
  async function changeView(next: 'styled' | 'markdown', region?: 'preface' | 'appendix') {
    if (switchingView.current || (next === view && !region)) return;
    switchingView.current = true;
    try {
      if (!(await flush())) return;
      if (next === 'markdown') {
        const document = persistence.getSnapshot().document;
        const text = renderScriptMarkdown(document).text;
        markdown.current = { oldDoc: document, oldText: text, text };
        setMarkdownText(text);
        setMarkdownDirty(false);
        setMarkdownError(null);
        setMarkdownCursor(
          region === 'preface'
            ? 0
            : region === 'appendix'
              ? text.indexOf('<!-- 附录 -->') + '<!-- 附录 -->\n\n'.length
              : undefined,
        );
      } else if (editor) {
        const document = persistence.getSnapshot().document;
        const node = editor.schema.nodeFromJSON(toEditorJson(document));
        applyingMarkdown.current = true;
        try {
          const tr = closeHistory(editor.state.tr)
            .replaceWith(0, editor.state.doc.content.size, node.content)
            .setDocAttribute('preface', document.preface)
            .setDocAttribute('appendix', document.appendix);
          editor.view.dispatch(tr);
          editor.view.dispatch(closeHistory(editor.state.tr));
        } finally {
          applyingMarkdown.current = false;
        }
      }
      setViewOverride(next);
      try {
        const value = await setPreferences({ scriptView: next });
        queryClient.setQueryData(preferencesQuery().queryKey, value);
      } catch (error) {
        persistence.fail(error);
      }
    } finally {
      switchingView.current = false;
    }
  }
  useEffect(() => {
    if (editor && focusBlank.current) {
      editor.commands.focus('start');
      focusBlank.current = false;
    }
  }, [editor]);
  useEffect(() => {
    if (initial.revision > persistence.getRevision() && !persistence.hasPendingChanges()) {
      persistence.reset(initial);
    }
  }, [initial, persistence]);
  useEffect(() => {
    let generation = persistence.getSnapshot().generation;
    return persistence.subscribe(() => {
      const snapshot = persistence.getSnapshot();
      if (generation === snapshot.generation) return;
      generation = snapshot.generation;
      const text = renderScriptMarkdown(snapshot.document).text;
      markdown.current = { oldDoc: snapshot.document, oldText: text, text };
      setMarkdownText(text);
      setMarkdownDirty(false);
      setMarkdownError(null);
    });
  }, [persistence]);
  useEffect(() => {
    const abort = new AbortController();
    let retry: ReturnType<typeof setTimeout>;
    const subscribe = async () => {
      try {
        for await (const event of client.stream('/events', EngineEvent, { signal: abort.signal })) {
          if (
            event.type === 'script.conversion.updated' &&
            event.projectId === projectId &&
            event.episodeId === episodeId
          ) {
            await queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
          }
        }
      } catch (error) {
        if (!abort.signal.aborted) console.warn('剧本事件连接中断', error);
      }
      if (!abort.signal.aborted) retry = setTimeout(() => void subscribe(), 1500);
    };
    void subscribe();
    return () => {
      abort.abort();
      clearTimeout(retry);
    };
  }, [client, projectId, episodeId, queryClient]);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
  };
  useEffect(() => {
    if (!editor || !story.data) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(
        'mentions',
        story.data.elements.flatMap((element) =>
          [element.name, ...element.aliases].map((name) => ({
            name,
            elementId: element.id,
            kind: element.kind,
          })),
        ),
      ),
    );
  }, [editor, story.data]);
  useEffect(() => {
    if (editor && blockId) scrollToBlock(editor, blockId);
  }, [editor, blockId]);
  useEffect(() => {
    if (editor) editor.view.dispatch(editor.state.tr.setMeta('selectedElement', selected ?? ''));
  }, [editor, selected]);
  useEffect(() => {
    if (editor)
      editor.view.dispatch(
        editor.state.tr.setMeta('scriptMentions', preferences.data?.scriptMentions ?? false),
      );
  }, [editor, preferences.data?.scriptMentions]);
  async function mutate(path: string, method: string, body?: unknown) {
    const schema = z.union([z.object({ saved: z.literal(true) }), StoryElement]);
    await client.request(`/projects/${projectId}/story/${path}`, schema, { method, body });
    await queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'story'] });
    await queryClient.invalidateQueries({
      queryKey: ['projects', projectId, 'episodes'],
      exact: true,
    });
  }
  const createElement = (kind: ElementKind, name: string) =>
    mutate('elements', 'POST', { kind, name });
  useBlocker({
    shouldBlockFn: async ({ current, next }) =>
      current.pathname !== next.pathname && !(await flush()),
    enableBeforeUnload: false,
  });
  useEffect(() => {
    let closing = false;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        allowClose.current ||
        (!persistence.hasPendingChanges() && markdown.current.text === markdown.current.oldText)
      )
        return;
      event.preventDefault();
      event.returnValue = '剧本正在保存';
      if (closing) return;
      closing = true;
      void flushRef
        .current()
        .then(async (saved) => {
          closing = false;
          if (saved) {
            allowClose.current = true;
            await commandWindow('close');
          }
        })
        .catch(persistence.fail);
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      persistence.stop();
    };
  }, [persistence]);
  useEffect(() => {
    if (!blockId) return;
    const target = window.document.querySelector(`[data-id="${CSS.escape(blockId)}"]`);
    target?.scrollIntoView({ block: 'center' });
  }, [blockId, state.generation]);
  async function reload() {
    const record = await queryClient.fetchQuery(scriptQuery(client, projectId, episodeId));
    persistence.reset(record);
  }
  const status = {
    saved: '已保存，元素已同步',
    saving: '保存中…',
    error: '保存失败',
    conflict: '已被外部修改',
    converting: '正在转换，暂不能保存',
  }[state.status];
  const toolbar = (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-pressed={preferences.data?.scriptMentions ?? false}
        disabled={preferenceBusy}
        onClick={() => {
          setPreferenceBusy(true);
          void setPreferences({ scriptMentions: !(preferences.data?.scriptMentions ?? false) })
            .then((value) => queryClient.setQueryData(preferencesQuery().queryKey, value))
            .catch(persistence.fail)
            .finally(() => setPreferenceBusy(false));
        }}
      >
        元素标记
      </Button>
      <Button variant="ghost" size="sm" disabled={running} onClick={() => setImportOpen(true)}>
        重新导入
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={!initial.source}
        onClick={() => setSourceOpen(true)}
      >
        查看原文
      </Button>
      <span role="status" aria-label="剧本保存状态" className="text-xs text-muted-foreground">
        {status}
      </span>
    </>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-script-host data-block={blockId}>
      <ConversionBanner
        record={initial}
        client={client}
        projectId={projectId}
        episodeId={episodeId}
        revision={() => persistence.getRevision()}
        flush={flush}
        changed={refresh}
        edit={() => setImportOpen(true)}
        view={() => setElementsOpen(true)}
        openedAt={openedAt}
      />
      {state.message && (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b p-3">
          <span>{state.message}</span>
          <Button variant="outline" size="sm" onClick={() => void reload().catch(persistence.fail)}>
            重新加载
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void navigator.clipboard
                .writeText(
                  view === 'markdown'
                    ? markdown.current.text
                    : state.document.blocks.map((block) => block.text).join('\n'),
                )
                .catch(persistence.fail)
            }
          >
            复制全文
          </Button>
          {state.status === 'error' && <Button onClick={() => void flush()}>重试保存</Button>}
        </div>
      )}
      {running && view !== 'markdown' ? (
        <div aria-label="剧本转换中" className="flex-1 animate-pulse space-y-6 p-10">
          <div className="h-6 w-2/3 rounded-md bg-accent" />
          <div className="h-40 rounded-md bg-accent" />
        </div>
      ) : state.document.blocks.length || view === 'markdown' || editor ? (
        <ScriptEditor
          key={state.generation}
          document={state.document}
          onChange={(document) => {
            if (!applyingMarkdown.current) persistence.change(document);
          }}
          onError={persistence.fail}
          toolbar={toolbar}
          locked={running}
          tabs={
            <ScriptViewTabs
              view={view}
              onChange={(next) => {
                void changeView(next);
              }}
            />
          }
          saveStatus={
            <span role="status" aria-label="剧本保存状态" className="text-xs text-muted-foreground">
              {markdownDirty && state.status === 'saved' ? '等待保存…' : status}
            </span>
          }
          markdown={
            view === 'markdown' ? (
              <MarkdownView
                text={markdownText}
                onChange={(text) => {
                  markdown.current.text = text;
                  setMarkdownDirty(true);
                  setMarkdownText(text);
                }}
                readOnly={running}
                error={markdownError}
                unsure={unsure}
                cursor={markdownCursor}
              />
            ) : undefined
          }
          onMarkdown={(region) => {
            void changeView('markdown', region);
          }}
          number={number}
          onEditor={setEditor}
          elementsOpen={elementsOpen}
          onElementsOpen={setElementsOpen}
          right={(editor) => (
            <ElementPanel
              editor={editor}
              story={story.data ?? { revision: 0, elements: [], ignored: [] }}
              document={state.document}
              number={number}
              projectId={projectId}
              selected={selected}
              onSelect={setSelected}
              mutate={mutate}
            />
          )}
          overlays={(editor) => (
            <>
              <BlockHandle editor={editor} />
              <ReviewPopover
                editor={editor}
                blocks={state.document.blocks}
                source={initial.source?.text}
              />
              <SelectionToolbar editor={editor} create={createElement} />
              <CharacterAutocomplete editor={editor} elements={story.data?.elements ?? []} />
              <MentionCard
                editor={editor}
                elements={story.data?.elements ?? []}
                openElement={(id) => {
                  setSelected(id);
                  setElementsOpen(true);
                }}
              />
            </>
          )}
        />
      ) : !initial.pendingImport ? (
        <div className="m-auto grid max-w-2xl gap-4 p-6 sm:grid-cols-2">
          <Button variant="outline" className="h-36" onClick={() => setImportOpen(true)}>
            粘贴整集剧本
          </Button>
          <Button
            variant="outline"
            className="h-36"
            onClick={() => {
              focusBlank.current = true;
              persistence.change({
                schemaVersion: 2,
                preface: '',
                appendix: '',
                blocks: [
                  {
                    id: crypto.randomUUID(),
                    type: 'scene',
                    text: '',
                    attrs: { time: null, space: null, timeText: null, note: null, timecode: null },
                  },
                ],
              });
            }}
          >
            从空白开始写
          </Button>
        </div>
      ) : null}
      {importOpen && (
        <ImportDialog
          client={client}
          projectId={projectId}
          episodeId={episodeId}
          profile={project.data?.profile}
          hasBlocks={!!state.document.blocks.length}
          text={initial.pendingImport?.text}
          flush={flush}
          revision={() => persistence.getRevision()}
          onImported={refresh}
          onClose={() => setImportOpen(false)}
        />
      )}
      {sourceOpen && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setSourceOpen(false);
          }}
        >
          <DialogContent className="top-0 right-0 left-auto h-full max-w-full translate-x-0 translate-y-0 overflow-auto rounded-none sm:max-w-2xl">
            <DialogTitle>剧本原文</DialogTitle>
            <DialogDescription>最近一次成功转换的原文，只读。</DialogDescription>
            <div className="font-mono text-sm">
              {initial.source?.text.split(/\r\n?|\n/u).map((line, index) => (
                <div key={index} className="flex gap-4">
                  <span className="w-10 shrink-0 text-right text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="whitespace-pre-wrap">{line || ' '}</span>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
