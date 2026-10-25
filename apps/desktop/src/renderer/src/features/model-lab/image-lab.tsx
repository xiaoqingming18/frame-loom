import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, RefreshCw, Sparkles } from 'lucide-react';
import {
  checkGenerationRequest,
  EngineEvent,
  GenerationJob,
  GenerationJobList,
  ModelProfileList,
  type GenerationInput,
  type GenerationRequest,
  type ModelProfile,
} from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Input } from '@frame-loom/ui/components/input';
import { NativeSelect } from '@frame-loom/ui/components/native-select';
import { Textarea } from '@frame-loom/ui/components/textarea';
import type { EngineClient } from '@/lib/engine-client';
import { channelsQuery, defaultsQuery, modelsQuery } from '@/lib/model-queries';
import { VideoInputs } from './video-inputs';

const states = {
  pending: '等待名额',
  submitting: '正在提交',
  running: '远端生成中',
  downloading: '正在保存产物',
  succeeded: '已完成',
  submit_unknown: '提交结果不明',
  failed: '失败',
  cancelled: '已放弃',
};
const jobsKey = ['generation', 'jobs'];

export function ImageLab({
  client,
  kind = 'image',
}: {
  client: EngineClient;
  kind?: 'image' | 'video';
}) {
  const label = kind === 'image' ? '图片' : '视频';
  const models = useQuery(modelsQuery(client));
  const channels = useQuery(channelsQuery(client));
  const defaults = useQuery(defaultsQuery(client));
  const profiles = useQuery({
    queryKey: ['generation', 'profiles'],
    queryFn: ({ signal }) => client.request('/model-profiles', ModelProfileList, { signal }),
  });
  const jobs = useQuery({
    queryKey: jobsKey,
    queryFn: ({ signal }) => client.request('/generation-jobs', GenerationJobList, { signal }),
    refetchInterval: (query) =>
      query.state.data?.some((job) =>
        ['pending', 'submitting', 'running', 'downloading'].includes(job.status),
      )
        ? 2000
        : false,
  });
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState('');
  const [confirm, setConfirm] = useState('');
  const available =
    models.data?.filter(
      (model) =>
        model.kind === kind &&
        model.enabled &&
        channels.data?.some((channel) => channel.id === model.channelId && channel.enabled),
    ) ?? [];
  const model =
    available.find((item) => item.id === selected) ??
    available.find((item) => item.id === defaults.data?.[kind]) ??
    available[0];
  const profile =
    profiles.data?.find(
      (item) =>
        item.protocol === model?.protocol &&
        (model?.profileId
          ? item.id === model.profileId
          : item.matchIds.includes(model?.upstreamModelId ?? '')),
    ) ??
    (!model?.profileId
      ? profiles.data?.find((item) => item.protocol === model?.protocol && item.generic)
      : undefined);
  const action = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      client.request(`/generation-jobs/${id}/${name}`, GenerationJob, { method: 'POST' }),
    onSuccess: async () => {
      setConfirm('');
      await queryClient.invalidateQueries({ queryKey: jobsKey });
    },
  });
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        // SSE 提供即时更新；流中断时由活动任务的定时查询兜底。
        for await (const event of client.stream('/events', EngineEvent, {
          signal: controller.signal,
        })) {
          if (event.type === 'generation.job.updated')
            await queryClient.invalidateQueries({ queryKey: jobsKey });
        }
      } catch {
        /* 活动任务继续定时查询，手动刷新也可恢复列表。 */
      }
    })();
    return () => controller.abort();
  }, [client, queryClient]);
  const queryError =
    models.error ?? channels.error ?? defaults.error ?? profiles.error ?? jobs.error;
  return (
    <section className="space-y-6" aria-labelledby={`${kind}-lab-heading`}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <ImagePlus className="size-4" aria-hidden="true" />
            模型测试 · {label}
          </p>
          <h1 id={`${kind}-lab-heading`} className="font-serif text-2xl">
            {kind === 'image' ? '让画面先发生' : '让镜头动起来'}
          </h1>
          <p className="mt-2 text-xs text-muted-foreground">
            任务由本地服务持续执行，生成结果保存到本机。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void jobs.refetch()}>
          <RefreshCw aria-hidden="true" />
          刷新任务
        </Button>
      </header>
      {queryError && (
        <p role="alert" className="text-sm text-destructive">
          {queryError.message}
        </p>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
        <div className="space-y-5 rounded-2xl border bg-card p-5 shadow-panel">
          <label className="grid gap-2 text-xs text-muted-foreground">
            {label}模型
            <NativeSelect
              aria-label={`${label}模型`}
              value={model?.id ?? ''}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">选择已启用的{label}模型</option>
              {available.map((item) => (
                <option key={item.id} value={item.id}>
                  {channels.data?.find((channel) => channel.id === item.channelId)?.name} /{' '}
                  {item.displayName}
                </option>
              ))}
            </NativeSelect>
          </label>
          {!available.length && !models.isPending && (
            <p className="text-xs text-muted-foreground">
              请在设置中心的「模型服务」添加并启用{label}模型。
            </p>
          )}
          {profile && model ? (
            <ImageForm
              key={`${model.id}:${profile.id}`}
              client={client}
              profile={profile}
              modelId={model.id}
            />
          ) : (
            model &&
            !profiles.isPending && (
              <p role="alert" className="text-xs text-destructive">
                模型档案与协议不匹配，请检查配置。
              </p>
            )
          )}
        </div>
        <div className="min-w-0 space-y-4" aria-label={`${label}任务列表`}>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <h2 className="font-medium text-foreground">生成记录</h2>
            <span>最近 100 项</span>
          </div>
          {jobs.data
            ?.filter((job) => job.kind === kind)
            .map((job) => (
              <article key={job.id} className="space-y-4 rounded-2xl border bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {new Date(job.createdAt).toLocaleTimeString()}
                  </p>
                  <span
                    role="status"
                    className={
                      job.status === 'failed' || job.status === 'submit_unknown'
                        ? 'text-xs text-destructive'
                        : 'text-xs text-muted-foreground'
                    }
                  >
                    {states[job.status]}
                  </span>
                </div>
                <p className="text-sm break-words whitespace-pre-wrap">{job.request.prompt}</p>
                {!!job.outputs.length && (
                  <div className="grid grid-cols-2 gap-3">
                    {job.outputs.map((output, index) => (
                      <figure
                        key={`${output.sha256}:${index}`}
                        className="overflow-hidden rounded-xl border bg-muted/30"
                      >
                        {kind === 'video' ? (
                          <video
                            src={`frame-media://${output.sha256}`}
                            aria-label={`生成视频 ${index + 1}`}
                            controls
                            preload="metadata"
                            className="aspect-video w-full object-contain"
                          />
                        ) : (
                          <img
                            src={`frame-media://${output.sha256}`}
                            alt={`生成图片 ${index + 1}`}
                            className="aspect-square w-full object-contain"
                          />
                        )}
                        <figcaption className="px-3 py-2 text-xs text-muted-foreground">
                          {output.width} × {output.height}
                          {output.durationMs != null &&
                            ` · ${(output.durationMs / 1000).toFixed(1)} 秒`}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                )}
                {job.errorMessage && (
                  <p className="text-xs text-destructive">
                    {job.errorCategory && `${job.errorCategory} · `}
                    {job.errorMessage}
                  </p>
                )}
                {job.status === 'submit_unknown' && (
                  <p className="text-xs text-muted-foreground">
                    远端可能已经受理并扣费。请先确认厂商记录，重新提交可能再次计费。
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {['submit_unknown', 'failed', 'cancelled'].includes(job.status) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={action.isPending}
                      onClick={() =>
                        confirm === job.id
                          ? action.mutate({ id: job.id, name: 'resubmit' })
                          : setConfirm(job.id)
                      }
                    >
                      {confirm === job.id ? '确认重新提交（可能再次计费）' : '重新提交'}
                    </Button>
                  )}
                  {job.remoteTaskId && ['submit_unknown', 'failed'].includes(job.status) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={action.isPending}
                      onClick={() => action.mutate({ id: job.id, name: 'requery' })}
                    >
                      重新查询
                    </Button>
                  )}
                  {!['succeeded', 'failed', 'cancelled'].includes(job.status) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={action.isPending}
                      onClick={() => action.mutate({ id: job.id, name: 'cancel' })}
                    >
                      放弃
                    </Button>
                  )}
                </div>
              </article>
            ))}
          {jobs.data && !jobs.data.some((job) => job.kind === kind) && (
            <div className="grid min-h-72 place-content-center gap-3 rounded-2xl border border-dashed p-8 text-center text-muted-foreground">
              <ImagePlus className="mx-auto size-8" strokeWidth={1} aria-hidden="true" />
              <p className="text-sm">
                {kind === 'image' ? '第一张画面，从这里开始' : '第一段镜头，从这里开始'}
              </p>
              <p className="text-xs">填写提示词并生成，产物会显示在此处。</p>
            </div>
          )}
          {action.error && (
            <p role="alert" className="text-xs text-destructive">
              {action.error.message}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function ImageForm({
  client,
  modelId,
  profile,
}: {
  client: EngineClient;
  modelId: string;
  profile: ModelProfile;
}) {
  const queries = useQueryClient();
  const [mode, setMode] = useState(profile.modes[0].id);
  const [prompt, setPrompt] = useState('');
  const [params, setParams] = useState<GenerationRequest['params']>(
    Object.fromEntries(profile.params.map((param) => [param.key, param.default])),
  );
  const [inputs, setInputs] = useState<GenerationInput[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState('');
  const [reading, setReading] = useState(false);
  const request = { modelId, mode, prompt, params, inputs, source: 'manual' as const };
  const issues = checkGenerationRequest(profile, request);
  const submit = useMutation({
    mutationFn: () =>
      client.request('/generation-jobs', GenerationJob, { method: 'POST', body: request }),
    onSuccess: () => queries.invalidateQueries({ queryKey: jobsKey }),
  });
  async function upload(selected: FileList | null) {
    setUploadError('');
    setReading(true);
    try {
      const list = Array.from(selected ?? []);
      const limit = profile.inputs.find((item) => item.kind === 'image');
      if (
        !limit ||
        list.length > limit.maxCount ||
        list.some((file) => file.size > limit.maxBytes || !limit.mimeTypes.includes(file.type))
      )
        throw new Error('参考图数量、格式或大小超过档案上限');
      const loaded = await Promise.all(
        list.map(
          (file) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                typeof reader.result === 'string'
                  ? resolve(reader.result)
                  : reject(new Error('无法读取参考图'));
              reader.onerror = () => reject(new Error('无法读取参考图'));
              reader.readAsDataURL(file);
            }),
        ),
      );
      setInputs(loaded.map((dataUrl) => ({ kind: 'image', role: 'reference', dataUrl })));
      setFiles(list.map((file) => file.name));
    } catch (error) {
      setInputs([]);
      setFiles([]);
      setUploadError(error instanceof Error ? error.message : '读取失败');
    } finally {
      setReading(false);
    }
  }
  function generate(event: FormEvent) {
    event.preventDefault();
    if (!issues.length && prompt.trim() && !reading) submit.mutate();
  }
  return (
    <form onSubmit={generate} className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {profile.name}
        {profile.generic && ' · 未匹配内置 ID，请按供应商文档确认能力。'}
      </p>
      <label className="grid gap-2 text-xs text-muted-foreground">
        生成模式
        <NativeSelect
          aria-label="生成模式"
          value={mode}
          onChange={(event) => {
            setMode(event.target.value);
            setInputs([]);
            setFiles([]);
          }}
        >
          {profile.modes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="grid gap-2 text-xs text-muted-foreground">
        {profile.kind === 'video' ? '视频' : '图片'}提示词
        <Textarea
          value={prompt}
          maxLength={profile.protocol === 'minimax-video-v2' ? 7000 : 32000}
          required
          placeholder="描述主体、镜头、光线与氛围…"
          className="min-h-32"
          onChange={(event) => setPrompt(event.target.value)}
        />
      </label>
      {profile.params.map((param) => (
        <label key={param.key} className="grid gap-2 text-xs text-muted-foreground">
          {param.name}
          {param.type === 'enum' ? (
            <NativeSelect
              value={String(params[param.key])}
              onChange={(event) =>
                setParams({
                  ...params,
                  [param.key]: param.values!.find((value) => String(value) === event.target.value)!,
                })
              }
            >
              {param.values?.map((value) => {
                const invalid = checkGenerationRequest(profile, {
                  ...request,
                  params: { ...params, [param.key]: value },
                }).find((issue) => issue.field === param.key);
                return (
                  <option key={String(value)} value={String(value)} disabled={!!invalid}>
                    {String(value)}
                    {invalid && `（${invalid.message}）`}
                  </option>
                );
              })}
            </NativeSelect>
          ) : param.type === 'boolean' ? (
            <input
              type="checkbox"
              checked={params[param.key] === true}
              onChange={(event) => setParams({ ...params, [param.key]: event.target.checked })}
            />
          ) : (
            <Input
              type={param.type === 'number' ? 'number' : 'text'}
              min={param.min}
              max={param.max}
              value={String(params[param.key])}
              onChange={(event) =>
                setParams({
                  ...params,
                  [param.key]:
                    param.type === 'number' ? Number(event.target.value) : event.target.value,
                })
              }
            />
          )}
        </label>
      ))}
      {profile.kind === 'video' && (
        <VideoInputs
          key={mode}
          client={client}
          profile={profile}
          mode={mode}
          params={params}
          inputs={inputs}
          onChange={setInputs}
          onReading={setReading}
          disabled={submit.isPending}
        />
      )}
      {profile.kind === 'image' && mode !== 'text' && (
        <label className="grid gap-2 text-xs text-muted-foreground">
          参考图
          <Input
            aria-label="参考图"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            disabled={reading || submit.isPending}
            onChange={(event) => void upload(event.target.files)}
          />
          <span>
            最多 {profile.inputs.find((item) => item.kind === 'image')?.maxCount ?? 0}{' '}
            张，随请求内联发送。
          </span>
          {files.length > 0 && <span className="break-words">{files.join('、')}</span>}
        </label>
      )}
      {issues.map((issue, index) => (
        <p key={index} className="text-xs text-muted-foreground">
          {issue.message}
        </p>
      ))}
      {(uploadError || submit.error) && (
        <p role="alert" className="text-xs text-destructive">
          {uploadError || submit.error?.message}
        </p>
      )}
      <Button
        type="submit"
        className="w-full"
        disabled={submit.isPending || reading || !prompt.trim() || !!issues.length}
      >
        <Sparkles aria-hidden="true" />
        {submit.isPending ? '正在创建任务…' : `生成${profile.kind === 'video' ? '视频' : '图片'}`}
      </Button>
    </form>
  );
}
