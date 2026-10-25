import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  GenerationJob,
  GenerationJobList,
  ModelProfileList,
  type ModelProfile,
} from '@frame-loom/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import type { EngineClient } from '@/lib/engine-client';
import { channelsQuery, defaultsQuery, modelsQuery } from '@/lib/model-queries';

const key = ['generation', 'jobs'];
export function AudioLab({ client }: { client: EngineClient }) {
  const models = useQuery(modelsQuery(client));
  const channels = useQuery(channelsQuery(client));
  const defaults = useQuery(defaultsQuery(client));
  const profiles = useQuery({
    queryKey: ['generation', 'profiles'],
    queryFn: ({ signal }) => client.request('/model-profiles', ModelProfileList, { signal }),
  });
  const jobs = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => client.request('/generation-jobs', GenerationJobList, { signal }),
    refetchInterval: 2000,
  });
  const query = useQueryClient();
  const available =
    models.data?.filter(
      (model) =>
        model.kind === 'tts' &&
        model.enabled &&
        channels.data?.some((channel) => channel.id === model.channelId && channel.enabled),
    ) ?? [];
  const [selected, setSelected] = useState('');
  const model =
    available.find((item) => item.id === selected) ??
    available.find((item) => item.id === defaults.data?.tts) ??
    available[0];
  const profile =
    profiles.data?.find(
      (item) =>
        item.protocol === model?.protocol &&
        (model.profileId
          ? item.id === model.profileId
          : item.matchIds.includes(model.upstreamModelId)),
    ) ?? profiles.data?.find((item) => item.protocol === model?.protocol && item.generic);
  const create = useMutation({
    mutationFn: (body: object) =>
      client.request('/generation-jobs', GenerationJob, { method: 'POST', body }),
    onSuccess: () => query.invalidateQueries({ queryKey: key }),
  });
  function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!model || !profile) return;
    const form = new FormData(event.currentTarget);
    const params = Object.fromEntries(
      profile.params.map((param) => {
        const value = form.get(param.key);
        return [param.key, param.type === 'number' ? Number(value) : (value ?? param.default)];
      }),
    );
    create.mutate({
      modelId: model.id,
      mode: 'text',
      prompt: form.get('prompt'),
      params,
      inputs: [],
      source: 'manual',
    });
  }
  return (
    <section
      className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[320px_1fr]"
      aria-label="模型测试 · 配音"
    >
      <form className="space-y-4 rounded-2xl border bg-card p-5" onSubmit={generate}>
        <h1 className="font-serif text-2xl">模型测试 · 配音</h1>
        <label className="grid gap-2 text-xs text-muted-foreground">
          TTS 模型
          <NativeSelect
            value={model?.id ?? ''}
            onChange={(event) => setSelected(event.target.value)}
          >
            {available.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName}
              </option>
            ))}
          </NativeSelect>
        </label>
        {!available.length && (
          <p className="text-xs text-muted-foreground">请先添加并启用 TTS 模型。</p>
        )}
        {profile && <TtsFields profile={profile} />}
        <Button className="w-full" disabled={!model || !profile || create.isPending}>
          生成配音
        </Button>
        {create.error && (
          <p role="alert" className="text-xs text-destructive">
            {create.error.message}
          </p>
        )}
      </form>
      <div className="space-y-3">
        {jobs.data
          ?.filter((job) => job.kind === 'tts')
          .map((job) => (
            <article key={job.id} className="space-y-3 rounded-xl border bg-card p-4">
              <div className="text-xs text-muted-foreground">
                {job.status} · {new Date(job.createdAt).toLocaleTimeString()}
              </div>
              <p className="text-sm">{job.request.prompt}</p>
              {job.outputs.map((output) => (
                <audio
                  key={output.sha256}
                  controls
                  preload="metadata"
                  src={`frame-media://${output.sha256}`}
                />
              ))}
              {job.errorMessage && (
                <p role="alert" className="text-xs text-destructive">
                  {job.errorMessage}
                </p>
              )}
            </article>
          ))}
      </div>
    </section>
  );
}
function TtsFields({ profile }: { profile: ModelProfile }) {
  return (
    <>
      <label className="grid gap-2 text-xs text-muted-foreground">
        配音文本
        <Textarea name="prompt" required maxLength={32000} className="min-h-32" />
      </label>
      {profile.params.map((param) => (
        <label key={param.key} className="grid gap-2 text-xs text-muted-foreground">
          {param.name}
          {param.type === 'enum' ? (
            <NativeSelect name={param.key} defaultValue={String(param.default)}>
              {param.values?.map((value) => (
                <option key={String(value)} value={String(value)}>
                  {String(value)}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <Input
              name={param.key}
              type={param.type === 'number' ? 'number' : 'text'}
              min={param.min}
              max={param.max}
              defaultValue={String(param.default)}
            />
          )}
        </label>
      ))}
    </>
  );
}
