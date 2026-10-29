import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useBlocker, useRouteContext } from '@tanstack/react-router';
import { episodeLabel, ScriptSaveResult, type ScriptResult } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { commandWindow } from '@/lib/desktop-bridge';
import type { EngineClient } from '@/lib/engine-client';
import { projectQuery, scriptQuery } from '@/lib/project-queries';
import { createScriptPersistence } from './script-persistence';
import { ScriptEditor } from './script-editor';

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
}: {
  initial: ScriptResult;
  client: EngineClient;
  projectId: string;
  episodeId: string;
  blockId?: string;
}) {
  const queryClient = useQueryClient();
  const [record] = useState(initial);
  const [generation, setGeneration] = useState(0);
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
        (result) => {
          void queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'episodes'] });
          if (result.addedElements)
            void queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'story'] });
        },
      ),
    [client, projectId, episodeId, queryClient, record],
  );
  const state = useSyncExternalStore(persistence.subscribe, persistence.getSnapshot);
  useBlocker({
    shouldBlockFn: async ({ current, next }) =>
      current.pathname !== next.pathname && !(await persistence.flush()),
    enableBeforeUnload: false,
  });
  useEffect(() => {
    let closing = false;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (allowClose.current || !persistence.hasPendingChanges()) return;
      event.preventDefault();
      event.returnValue = '剧本正在保存';
      if (closing) return;
      closing = true;
      void persistence
        .flush()
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
  }, [blockId, generation]);
  async function reload() {
    const record = await queryClient.fetchQuery(scriptQuery(client, projectId, episodeId));
    persistence.reset(record);
    setGeneration((value) => value + 1);
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
      <Button variant="ghost" size="sm" disabled>
        重新导入
      </Button>
      <Button variant="ghost" size="sm" disabled>
        查看原文
      </Button>
      <span role="status" aria-label="剧本保存状态" className="text-xs text-muted-foreground">
        {status}
      </span>
    </>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-block={blockId}>
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
                .writeText(state.document.blocks.map((block) => block.text).join('\n'))
                .catch(persistence.fail)
            }
          >
            复制全文
          </Button>
          {state.status === 'error' && (
            <Button onClick={() => void persistence.flush()}>重试保存</Button>
          )}
        </div>
      )}
      {state.document.blocks.length ? (
        <ScriptEditor
          key={generation}
          document={state.document}
          onChange={(document) => persistence.change(document)}
          onError={persistence.fail}
          toolbar={toolbar}
        />
      ) : (
        <div className="m-auto grid max-w-2xl gap-4 p-6 sm:grid-cols-2">
          <Button variant="outline" className="h-36" disabled>
            粘贴整集剧本
          </Button>
          <Button
            variant="outline"
            className="h-36"
            onClick={() =>
              persistence.change({
                schemaVersion: 1,
                blocks: [
                  {
                    id: crypto.randomUUID(),
                    type: 'scene',
                    text: '',
                    attrs: { time: null, space: null },
                  },
                ],
              })
            }
          >
            从空白开始写
          </Button>
        </div>
      )}
    </div>
  );
}
