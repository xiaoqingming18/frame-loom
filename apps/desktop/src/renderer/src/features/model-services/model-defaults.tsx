import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ModelDefaults, ModelKind } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { NativeSelect } from '@frame-loom/ui/components/native-select';
import type { EngineClient } from '@/lib/engine-client';
import { channelsQuery, defaultsQuery, modelsQuery } from '@/lib/model-queries';
import { kindLabels } from './labels';

export function ModelDefaultsSettings({
  engineClient: client,
  onOpenModels,
}: {
  engineClient: EngineClient;
  onOpenModels: () => void;
}) {
  const channels = useQuery(channelsQuery(client));
  const models = useQuery(modelsQuery(client));
  const defaults = useQuery(defaultsQuery(client));
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (body: Partial<ModelDefaults>) =>
      client.request('/model-defaults', ModelDefaults, { method: 'PUT', body }),
    onSuccess: (data) => queryClient.setQueryData(defaultsQuery(client).queryKey, data),
  });
  const available =
    models.data?.filter(
      (model) =>
        model.enabled &&
        !model.blockedReason &&
        channels.data?.some((channel) => channel.id === model.channelId && channel.enabled),
    ) ?? [];
  const error = channels.error ?? models.error ?? defaults.error ?? save.error;
  return (
    <section aria-labelledby="defaults-heading" className="space-y-6">
      <header>
        <h2 id="defaults-heading" className="text-xl font-semibold">
          默认模型
        </h2>
        <p className="mt-2 text-xs text-muted-foreground">
          业务功能未指定模型时使用。只列出已启用渠道中的已启用模型。
        </p>
      </header>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
      {!models.isPending && !available.length && (
        <p className="text-xs text-muted-foreground">
          还没有可用模型。
          <Button variant="link" size="xs" onClick={onOpenModels}>
            前往模型服务添加
          </Button>
        </p>
      )}
      {defaults.data && (
        <div className="grid gap-4 sm:grid-cols-2">
          {ModelKind.options.map((kind) => (
            <label key={kind} className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
              {kindLabels[kind]}
              <NativeSelect
                disabled={save.isPending}
                value={defaults.data[kind] ?? ''}
                onChange={(event) => save.mutate({ [kind]: event.target.value || null })}
              >
                <option value="">未设置</option>
                {available
                  .filter((model) => model.kind === kind)
                  .map((model) => (
                    <option key={model.id} value={model.id}>
                      {channels.data?.find((item) => item.id === model.channelId)?.name} /{' '}
                      {model.displayName}
                    </option>
                  ))}
              </NativeSelect>
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
