import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useBlocker, useRouteContext } from '@tanstack/react-router';
import {
  ScriptSaveResult,
  projectScriptDocument,
  type ScriptResult,
  type ProjectManifest,
} from '@frame-loom/contracts';
import type { Editor } from '@tiptap/core';
import { Button } from '@frame-loom/ui/components/button';
import { commandWindow } from '@/lib/desktop-bridge';
import type { EngineClient } from '@/lib/engine-client';
import { projectQuery, scriptQuery } from '@/lib/project-queries';
import { createScriptPersistence } from './script-persistence';
import { ScriptEditor } from './script-editor';
import { scrollToScriptNode } from './script-commands';
import { ImportDialog } from './import-dialog';
import { ConversionBanner } from './conversion-banner';

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
  const script = useQuery({
    ...scriptQuery(engineClient, projectId, episodeId),
    refetchInterval: (query) =>
      query.state.data?.conversion?.status === 'running' ||
      query.state.data?.conversion?.status === 'queued'
        ? 800
        : false,
  });
  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <nav
        aria-label="面包屑"
        className="flex items-center gap-2 border-b px-5 py-3 text-sm text-muted-foreground"
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
        <span>/ 剧本</span>
      </nav>
      {script.error ? (
        <p role="alert" className="p-5">
          {script.error.message}，可返回项目剧集列表。
        </p>
      ) : !script.data || !project.data ? (
        <p role="status">正在读取剧本…</p>
      ) : (
        <ScriptSession
          key={`${projectId}/${episodeId}`}
          client={engineClient}
          projectId={projectId}
          episodeId={episodeId}
          initial={script.data}
          project={project.data}
          targetId={blockId}
        />
      )}
    </section>
  );
}
function ScriptSession({
  client,
  projectId,
  episodeId,
  initial,
  project,
  targetId,
}: {
  client: EngineClient;
  projectId: string;
  episodeId: string;
  initial: ScriptResult;
  project: ProjectManifest;
  targetId?: string;
}) {
  const cache = useQueryClient(),
    [record] = useState(initial),
    [importing, setImporting] = useState(false),
    [editor, setEditor] = useState<Editor | null>(null),
    [missing, setMissing] = useState(false);
  const allowClose = useRef(false),
    composing = useRef(false);
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
          cache.setQueryData(scriptQuery(client, projectId, episodeId).queryKey, (old) => {
            if (!old) return old;
            return {
              id: old.id,
              conversion: old.conversion,
              source: old.source,
              revision: result.revision,
              document,
            };
          });
          void cache.invalidateQueries({ queryKey: ['projects', projectId], exact: true });
          void cache.invalidateQueries({ queryKey: ['projects', projectId, 'story'] });
          void cache.invalidateQueries({
            queryKey: ['projects', projectId, 'episodes'],
            exact: true,
          });
        },
      ),
    [record, client, projectId, episodeId, cache],
  );
  const snapshot = useSyncExternalStore(persistence.subscribe, persistence.getSnapshot);
  const running =
    initial.conversion?.status === 'queued' || initial.conversion?.status === 'running';
  const episode = project.episodes?.find((e) => e.id === episodeId);
  const document = episode
    ? projectScriptDocument(snapshot.document, {
        name: project.name,
        profile: project.profile,
        episode,
      })
    : snapshot.document;
  const flush = useCallback(
    () => (composing.current ? Promise.resolve(false) : persistence.flush()),
    [persistence],
  );
  const refresh = async () => {
    await cache.invalidateQueries({ queryKey: ['projects', projectId] });
  };
  useEffect(() => {
    if (initial.revision > persistence.getRevision() && !persistence.hasPendingChanges())
      persistence.reset(initial);
  }, [initial, persistence]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setMissing(!!editor && !!targetId && !scrollToScriptNode(editor, targetId));
    });
    return () => cancelAnimationFrame(frame);
  }, [editor, targetId, snapshot.generation]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!event.isComposing && event.keyCode !== 229) void flush();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [flush]);
  useBlocker({
    shouldBlockFn: async ({ current, next }) =>
      current.pathname !== next.pathname && !(await flush()),
    enableBeforeUnload: false,
  });
  useEffect(() => {
    let closing = false;
    const before = (event: BeforeUnloadEvent) => {
      if (allowClose.current || (!persistence.hasPendingChanges() && !composing.current)) return;
      event.preventDefault();
      event.returnValue = '剧本正在保存';
      if (closing) return;
      closing = true;
      void flush()
        .then(async (saved) => {
          closing = false;
          if (saved) {
            allowClose.current = true;
            await commandWindow('close');
          }
        })
        .catch(persistence.fail);
    };
    window.addEventListener('beforeunload', before);
    return () => {
      window.removeEventListener('beforeunload', before);
      persistence.stop();
    };
  }, [persistence, flush]);
  const status = {
    saved: '已保存',
    saving: '保存中…',
    error: '保存失败，草稿已保留',
    conflict: '修订冲突，草稿已保留',
    converting: '正在解析',
  }[snapshot.status];
  return (
    <>
      <div
        role="toolbar"
        aria-label="剧本操作"
        className="flex flex-wrap items-center gap-2 border-b px-4 py-2"
      >
        <span className="mr-auto text-xs text-muted-foreground" role="status">
          {status}
        </span>
        <Button variant="outline" size="sm" disabled={running} onClick={() => setImporting(true)}>
          重新导入
        </Button>
        <Button
          size="sm"
          disabled={running || snapshot.status === 'saving' || !persistence.hasPendingChanges()}
          onClick={() => void flush()}
        >
          保存
        </Button>
      </div>
      {snapshot.message && (
        <p role="alert" className="border-b p-3 text-sm text-destructive">
          {snapshot.message}
        </p>
      )}
      {missing && <p role="alert">该出现位置已删除或不存在。</p>}
      <ConversionBanner
        record={initial}
        client={client}
        projectId={projectId}
        episodeId={episodeId}
        revision={() => persistence.getRevision()}
        flush={flush}
        changed={refresh}
        edit={() => setImporting(true)}
      />
      <ScriptEditor
        key={snapshot.generation}
        document={document}
        locked={running}
        onChange={(document) => persistence.change(document)}
        onError={persistence.fail}
        onEditor={setEditor}
        onComposition={(value) => {
          composing.current = value;
          persistence.setComposing(value);
        }}
      />
      {importing && (
        <ImportDialog
          client={client}
          projectId={projectId}
          episodeId={episodeId}
          meta={document.meta}
          hasScenes={document.scenes.length > 0}
          text={initial.source ?? ''}
          flush={flush}
          revision={() => persistence.getRevision()}
          onImported={refresh}
          onClose={() => setImporting(false)}
        />
      )}
    </>
  );
}
