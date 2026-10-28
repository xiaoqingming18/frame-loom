import { Plus, Server } from 'lucide-react';
import type { Channel, Model } from '@frame-loom/contracts/model-service';
import { Button } from '@frame-loom/ui/components/button';
import { Switch } from '@frame-loom/ui/components/switch';
import { Badge } from '@frame-loom/ui/components/badge';
import { kindLabels } from './labels';

export function ChannelList({
  channels,
  models,
  onAdd,
  onOpen,
  onToggle,
}: {
  channels: Channel[];
  models: Model[];
  onAdd: () => void;
  onOpen: (id: string) => void;
  onToggle: (channel: Channel) => void;
}) {
  return (
    <section className="space-y-5" aria-labelledby="models-heading">
      <header className="flex items-center justify-between gap-3">
        <h2 id="models-heading" className="text-xl font-semibold">
          模型服务
        </h2>
        <Button size="sm" onClick={onAdd}>
          <Plus aria-hidden="true" />
          添加渠道
        </Button>
      </header>
      {!channels.length && (
        <div className="grid justify-items-start gap-4 rounded-xl border border-dashed border-border px-6 py-10">
          <Server aria-hidden="true" className="size-7 text-muted-foreground" />
          <div>
            <h3 className="font-medium">连接你的模型服务</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              添加渠道，再为每个模型选择协议与能力。密钥加密保存在此设备。
            </p>
          </div>
          <Button variant="outline" onClick={onAdd}>
            添加第一个渠道
          </Button>
        </div>
      )}
      <div className="space-y-3">
        {channels.map((channel) => {
          const children = models.filter((model) => model.channelId === channel.id);
          const pending = children.filter((model) => !model.protocolId).length;
          return (
            <article
              key={channel.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent/40"
            >
              <button
                type="button"
                className="grid min-w-0 flex-1 gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onOpen(channel.id)}
              >
                <span className="font-medium">{channel.name}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {channel.baseUrl}
                </span>
                <span className="text-xs text-muted-foreground">
                  {Object.entries(kindLabels)
                    .map(
                      ([kind, label]) =>
                        `${label} ${children.filter((model) => model.kind === kind).length}`,
                    )
                    .join(' · ')}
                </span>
                {pending > 0 && (
                  <Badge variant="outline" className="w-fit text-warning">
                    {pending} 个模型待选协议
                  </Badge>
                )}
              </button>
              <Switch
                aria-label={`启用渠道 ${channel.name}`}
                checked={channel.enabled}
                onCheckedChange={() => onToggle(channel)}
              />
            </article>
          );
        })}
      </div>
    </section>
  );
}
