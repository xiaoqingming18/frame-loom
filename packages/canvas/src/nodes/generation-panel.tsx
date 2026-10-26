import { useMemo } from 'react';
import {
  checkGenerationRequest,
  type CanvasMediaData,
  type GenerationRequest,
} from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Input } from '@frame-loom/ui/components/input';
import { NativeSelect } from '@frame-loom/ui/components/native-select';
import { Textarea } from '@frame-loom/ui/components/textarea';
import { isNodeLocked, updateData } from '../commands/commands';
import { useCanvas, useCanvasState } from '../context';
import { generationInputs, generationModel } from './generation-inputs';
import { writeGenerationJob } from './generation-writeback';

export function GenerationPanel({
  nodeId,
  kind,
  data,
}: {
  nodeId: string;
  kind: 'image' | 'video';
  data: CanvasMediaData;
}) {
  const { host, store } = useCanvas();
  const config = useCanvasState((state) => state.generationConfig);
  const configError = useCanvasState((state) => state.generationError);
  const document = useCanvasState((state) => state.document);
  const generating = useCanvasState((state) => state.generationSubmitting.has(nodeId));
  const job = useCanvasState((state) =>
    state.generationJobs.get(
      (state.document.nodes.find((node) => node.id === nodeId)?.data as CanvasMediaData | undefined)
        ?.pendingJobId ?? '',
    ),
  );
  const locked = useCanvasState((state) => {
    const node = state.document.nodes.find((item) => item.id === nodeId);
    return !node || isNodeLocked(state.document, node);
  });
  const prompt = data.prompt;
  const inputs = useMemo(() => generationInputs(document, nodeId), [document, nodeId]);
  const missingInputs =
    document.edges.filter((edge) => edge.target === nodeId).length > inputs.length;
  const api = host.generation;
  if (!api) return null;

  const options = config?.models.filter((model) => model.kind === kind) ?? [];
  const model = generationModel(config, kind, data.modelId);
  const profile = model?.profile;
  const mode = kind === 'video' ? (data.mode ?? 'text') : inputs.length ? 'reference' : 'text';
  const request: GenerationRequest | undefined =
    model && profile
      ? {
          modelId: model.id,
          mode,
          prompt,
          params: {
            ...Object.fromEntries(profile.params.map((param) => [param.key, param.default])),
            ...data.params,
          },
          inputs,
          source: 'canvas',
        }
      : undefined;
  const issues = request && profile ? checkGenerationRequest(profile, request) : [];
  const storageMissing =
    !!config &&
    !config.storageReady &&
    inputs.some(
      (input) =>
        input.kind !== 'image' ||
        profile?.inputs.find((limit) => limit.kind === input.kind)?.transport === 'url',
    );
  const setData = (change: (current: CanvasMediaData) => CanvasMediaData) =>
    store.getState().apply((document) => updateData<CanvasMediaData>(document, nodeId, change));

  async function generate() {
    if (
      !api ||
      !request ||
      issues.length ||
      storageMissing ||
      missingInputs ||
      data.pendingJobId ||
      locked ||
      generating
    )
      return;
    if (store.getState().generationSubmitting.has(nodeId)) return;
    if (!setData((current) => ({ ...current, modelId: request.modelId, params: request.params })))
      return;
    store.getState().setGenerationSubmitting(nodeId, true);
    try {
      const created = await api.create(request);
      if (!store.getState().document.nodes.some((node) => node.id === nodeId)) {
        store.getState().notify('生成任务已创建；节点已删除，远端可能仍在运行并计费');
        store.getState().applySystem((document) =>
          updateData<CanvasMediaData>(document, nodeId, (current) => ({
            ...current,
            pendingJobId: created.id,
          })),
        );
        return;
      }
      store.getState().applySystem((document) =>
        updateData<CanvasMediaData>(document, nodeId, (current) => ({
          ...current,
          pendingJobId: created.id,
        })),
      );
      store.getState().setGenerationJob(created);
    } catch (error) {
      store.getState().notify(error instanceof Error ? error.message : '创建任务失败');
    } finally {
      store.getState().setGenerationSubmitting(nodeId, false);
    }
  }

  return (
    <div className="nodrag nopan space-y-2 border-t bg-card p-2 text-xs">
      {config ? (
        <>
          <NativeSelect
            aria-label="生成模型"
            disabled={locked}
            value={model?.id ?? ''}
            onChange={(event) =>
              setData((current) => ({ ...current, modelId: event.target.value, params: {} }))
            }
          >
            <option value="">选择{kind === 'image' ? '图片' : '视频'}模型</option>
            {options.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </NativeSelect>
          <Textarea
            aria-label="生成提示词"
            disabled={locked}
            value={prompt}
            maxLength={profile?.protocol === 'minimax-video-v2' ? 7000 : 32000}
            placeholder="描述画面…"
            onChange={(event) => setData((current) => ({ ...current, prompt: event.target.value }))}
          />
          {profile?.params.map((param) => {
            const value = data.params?.[param.key] ?? param.default;
            return (
              <label key={param.key} className="flex items-center justify-between gap-2">
                <span className="shrink-0">{param.name}</span>
                {param.type === 'enum' ? (
                  <NativeSelect
                    aria-label={param.name}
                    className="w-auto min-w-0 flex-1"
                    disabled={locked}
                    value={String(value)}
                    onChange={(event) => {
                      const next =
                        param.values?.find((item) => String(item) === event.target.value) ?? value;
                      setData((current) => ({
                        ...current,
                        params: { ...current.params, [param.key]: next },
                      }));
                    }}
                  >
                    {param.values?.map((choice) => (
                      <option key={String(choice)} value={String(choice)}>
                        {String(choice)}
                      </option>
                    ))}
                  </NativeSelect>
                ) : param.type === 'boolean' ? (
                  <input
                    aria-label={param.name}
                    disabled={locked}
                    type="checkbox"
                    checked={value === true}
                    onChange={(event) =>
                      setData((current) => ({
                        ...current,
                        params: { ...current.params, [param.key]: event.target.checked },
                      }))
                    }
                  />
                ) : (
                  <Input
                    aria-label={param.name}
                    className="w-auto min-w-0 flex-1"
                    disabled={locked}
                    type={param.type === 'number' ? 'number' : 'text'}
                    min={param.min}
                    max={param.max}
                    value={String(value)}
                    onChange={(event) =>
                      setData((current) => ({
                        ...current,
                        params: {
                          ...current.params,
                          [param.key]:
                            param.type === 'number'
                              ? Number(event.target.value)
                              : event.target.value,
                        },
                      }))
                    }
                  />
                )}
              </label>
            );
          })}
          {issues.map((issue, index) => (
            <p key={`${issue.field}-${index}`} className="text-muted-foreground">
              {issue.message}
            </p>
          ))}
          {model && !profile && <p>此模型没有匹配的生成档案，无法提交任务</p>}
          {data.modelId && !model && <p>原模型已不可用，请重新选择生成模型</p>}
          {config && options.length === 0 && (
            <p>请先在模型服务中启用{kind === 'image' ? '图片' : '视频'}模型</p>
          )}
          {storageMissing && <p>当前参考素材需要先配置对象存储</p>}
          {missingInputs && <p>连线来源尚无可用媒体，请先生成或上传素材</p>}
          {job?.errorMessage && (
            <p role="alert" className="text-destructive">
              {job.errorMessage}
            </p>
          )}
          {data.pendingJobId ? (
            <>
              <p role="status">
                {job?.status === 'submit_unknown'
                  ? '提交结果不明：远端可能已受理并计费'
                  : (job?.status ?? '正在查询生成任务…')}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void api
                    .cancel(data.pendingJobId!)
                    .then((next) => {
                      store.getState().setGenerationJob(next);
                      store
                        .getState()
                        .applySystem((document) => writeGenerationJob(document, next));
                      store.getState().notify(next.errorMessage ?? '生成任务已结束');
                    })
                    .catch((error: unknown) =>
                      store
                        .getState()
                        .notify(error instanceof Error ? error.message : '放弃任务失败'),
                    )
                }
              >
                放弃任务
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={
                !request ||
                !!issues.length ||
                storageMissing ||
                missingInputs ||
                locked ||
                generating ||
                !prompt.trim()
              }
              onClick={() => void generate()}
            >
              生成{kind === 'image' ? '图片' : '视频'}
            </Button>
          )}
          {data.versions.length > 1 && (
            <NativeSelect
              aria-label="当前版本"
              disabled={locked}
              value={String(data.activeVersion)}
              onChange={(event) =>
                setData((current) => ({
                  ...current,
                  activeVersion: Number(event.target.value),
                }))
              }
            >
              {data.versions.map((version, index) => (
                <option key={`${version.sha256}-${index}`} value={index}>
                  版本 {index + 1}
                </option>
              ))}
            </NativeSelect>
          )}
        </>
      ) : (
        <p role={configError ? 'alert' : 'status'}>{configError ?? '正在读取模型档案…'}</p>
      )}
    </div>
  );
}
