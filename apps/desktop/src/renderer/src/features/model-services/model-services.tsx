import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Channel, type Model } from '@frame-loom/contracts/model-service';
import type { EngineClient } from '@/lib/engine-client';
import { channelsQuery, modelsQuery } from '@/lib/model-queries';
import { ChannelList } from './channel-list';
import { ChannelForm } from './channel-form';
import { ChannelDetail } from './channel-detail';
import { CatalogDialog } from './catalog-dialog';
import { ModelEditor } from './model-editor/model-editor';
import { ModelTest } from './model-test';
import { ErrorMessage } from './form-fields';

type View = { type: 'list' } | { type: 'form'; channel?: Channel } | { type: 'detail'; id: string };
export function ModelServices({
  engineClient: client,
  onOpenStorage = () => {},
}: {
  engineClient: EngineClient;
  onOpenStorage?: () => void;
}) {
  const channels = useQuery(channelsQuery(client));
  const models = useQuery(modelsQuery(client));
  const queries = useQueryClient();
  const [view, setView] = useState<View>({ type: 'list' });
  const [catalog, setCatalog] = useState(false);
  const [editor, setEditor] = useState<{ model?: Model; copy?: boolean }>();
  const [testing, setTesting] = useState<Model>();
  const [highlighted, setHighlighted] = useState<string[]>([]);
  const [error, setError] = useState('');
  const channel =
    view.type === 'detail' ? channels.data?.find((channel) => channel.id === view.id) : undefined;
  const children = channel
    ? (models.data?.filter((model) => model.channelId === channel.id) ?? [])
    : [];
  const refresh = async () => {
    await queries.invalidateQueries({ queryKey: ['models'] });
  };
  useEffect(() => {
    if (!highlighted.length) return;
    const timer = setTimeout(() => setHighlighted([]), 2000);
    return () => clearTimeout(timer);
  }, [highlighted]);
  async function toggle(channel: Channel) {
    setError('');
    try {
      await client.request(`/channels/${channel.id}`, Channel, {
        method: 'PATCH',
        body: { enabled: !channel.enabled },
      });
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '渠道更新失败');
    }
  }
  return (
    <>
      <ErrorMessage error={channels.error ?? models.error ?? error} />
      {channels.isPending || models.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          正在加载模型服务…
        </p>
      ) : view.type === 'form' ? (
        <ChannelForm
          key={view.channel?.id ?? 'new'}
          client={client}
          channel={view.channel}
          onClose={() =>
            setView(view.channel ? { type: 'detail', id: view.channel.id } : { type: 'list' })
          }
          onSaved={async (saved, read) => {
            await refresh();
            setView({ type: 'detail', id: saved.id });
            setCatalog(read);
          }}
        />
      ) : view.type === 'detail' && channel ? (
        <ChannelDetail
          client={client}
          channel={channel}
          models={children}
          highlighted={highlighted}
          onBack={() => setView({ type: 'list' })}
          onEdit={() => setView({ type: 'form', channel })}
          onCatalog={() => setCatalog(true)}
          onModel={(model, copy) => setEditor({ model, copy })}
          onTest={setTesting}
          onRefresh={refresh}
          onDeleted={() => setView({ type: 'list' })}
        />
      ) : (
        <ChannelList
          channels={channels.data ?? []}
          models={models.data ?? []}
          onAdd={() => setView({ type: 'form' })}
          onOpen={(id) => setView({ type: 'detail', id })}
          onToggle={(channel) => void toggle(channel)}
        />
      )}
      {catalog && channel && (
        <CatalogDialog
          client={client}
          channel={channel}
          models={children}
          onClose={() => setCatalog(false)}
          onAdded={async (ids) => {
            await refresh();
            setHighlighted(ids);
            setCatalog(false);
          }}
        />
      )}
      {editor && channel && (
        <ModelEditor
          key={`${editor.model?.id ?? 'new'}-${!!editor.copy}`}
          client={client}
          channel={channel}
          model={editor.model}
          copy={editor.copy}
          onClose={() => setEditor(undefined)}
          onSaved={refresh}
          onTest={setTesting}
          onOpenStorage={onOpenStorage}
        />
      )}
      {testing && (
        <ModelTest
          key={testing.id}
          client={client}
          model={testing}
          onClose={() => setTesting(undefined)}
        />
      )}
    </>
  );
}
