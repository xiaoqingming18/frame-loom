import { useMemo } from 'react';
import { GenerationComposer } from './generation-composer';
import {
  checkGenerationRequest,
  checkGenerationMedia,
  imageEditCapabilityIssue,
  generationParamReason,
  resolveImageParams,
  resolveImagePrompt,
  type CanvasMediaData,
  type GenerationRequest,
} from '@frame-loom/contracts';
import { isNodeLocked, updateData } from '../commands/commands';
import { useCanvas, useCanvasState } from '../context';
import { generationSources, generationModel } from './generation-inputs';
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
  const pendingIds = data.pendingJobIds ?? [];
  const locked = useCanvasState((state) => {
    const node = state.document.nodes.find((item) => item.id === nodeId);
    return !node || isNodeLocked(state.document, node);
  });
  const references = useMemo(() => generationSources(document, nodeId), [document, nodeId]);
  const inputs = references.map((reference) => reference.input);
  const resolved =
    kind === 'image'
      ? resolveImagePrompt(
          data.prompt,
          references.map((reference) => reference.sourceId),
        )
      : { prompt: data.prompt, missingNodeIds: [] };
  const prompt = resolved.prompt;
  const missingInputs =
    document.edges.filter((edge) => edge.target === nodeId).length >
    references.filter((ref) => !ref.local).length;
  const api = host.generation;
  if (!api) return null;

  const options = config?.models.filter((model) => model.kind === kind) ?? [];
  const model = generationModel(config, kind, data.modelId);
  const profile = model?.profile;
  const mode = kind === 'video' ? (data.mode ?? 'text') : inputs.length ? 'reference' : 'text';
  const pendingParams = data.pendingParams ?? {};
  const request: GenerationRequest | undefined =
    model && profile
      ? {
          modelId: model.id,
          mode,
          prompt,
          params:
            kind === 'image'
              ? resolveImageParams(profile, data.params ?? {}).params
              : {
                  ...Object.fromEntries(profile.params.map((param) => [param.key, param.default])),
                  ...data.params,
                },
          inputs,
          ...(data.imageEdit ? { imageEdit: data.imageEdit } : {}),
          source: 'canvas',
        }
      : undefined;
  const imageEditIssue =
    request?.imageEdit && profile
      ? imageEditCapabilityIssue(request.imageEdit, profile.imageEditCapabilities)
      : undefined;
  const issues =
    request && profile
      ? [...checkGenerationRequest(profile, request), ...checkGenerationMedia(profile, references)]
      : [];
  const storageMissing =
    !!config &&
    !['provider-file', 'file'].includes(model?.upload ?? '') &&
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
      Object.keys(pendingParams).length ||
      storageMissing ||
      missingInputs ||
      resolved.missingNodeIds.length ||
      prompt.length > 32000 ||
      pendingIds.length ||
      locked ||
      generating
    )
      return;
    if (store.getState().generationSubmitting.has(nodeId)) return;
    if (!setData((current) => ({ ...current, modelId: request.modelId, params: request.params })))
      return;
    store.getState().setGenerationSubmitting(nodeId, true);
    try {
      for (let index = 0; index < (kind === 'image' ? (data.count ?? 1) : 1); index++) {
        const created = await api.create(request);
        store.getState().setGenerationJob(created);
        store.getState().applySystem((document) =>
          updateData<CanvasMediaData>(document, nodeId, (current) => ({
            ...current,
            pendingJobIds: [...(current.pendingJobIds ?? []), created.id],
          })),
        );
        store.getState().applySystem((document) => writeGenerationJob(document, created));
        if (!store.getState().document.nodes.some((node) => node.id === nodeId)) {
          store.getState().notify('生成任务已创建；节点已删除，远端可能仍在运行并计费');
          return;
        }
      }
    } catch (error) {
      store.getState().notify(error instanceof Error ? error.message : '创建任务失败');
    } finally {
      store.getState().setGenerationSubmitting(nodeId, false);
    }
  }

  const disabledReason = [
    locked && '节点已锁定',
    generating && '正在提交任务',
    pendingIds.length > 0 && '请等待当前任务结束或放弃任务',
    !config && (configError ?? '正在读取模型档案…'),
    !model &&
      (data.modelId ? '原模型已不可用，请重新选择生成模型' : '请先在模型服务中启用生成模型'),
    model && !profile && '此模型没有匹配的生成档案，无法提交任务',
    !prompt.trim() && '请填写提示词',
    prompt.length > 32000 && '替换后的提示词最多 32000 字',
    resolved.missingNodeIds.length > 0 && '引用的参考已断开',
    storageMissing && '当前参考素材需要先配置对象存储',
    missingInputs && '连线来源尚无可用媒体，请先生成或上传素材',
    issues[0]?.message,
    imageEditIssue,
    Object.keys(pendingParams).length > 0 && '模型切换后有参数需要确认或清除',
  ].find((reason) => typeof reason === 'string');
  return (
    <GenerationComposer
      nodeId={nodeId}
      kind={kind}
      data={data}
      model={model}
      options={options}
      params={request?.params ?? {}}
      inputs={inputs}
      locked={locked}
      countDisabled={locked || generating || !!pendingIds.length}
      disabledReason={disabledReason}
      onGenerate={() => void generate()}
      onPrompt={(prompt) => setData((current) => ({ ...current, prompt }))}
      onCount={(count) => setData((current) => ({ ...current, count }))}
      onParam={(key, value) =>
        setData((current) => {
          const pending = { ...current.pendingParams };
          delete pending[key];
          return {
            ...current,
            params: { ...request?.params, [key]: value },
            pendingParams: pending,
          };
        })
      }
      onModel={(id) => {
        const next = options.find((item) => item.id === id);
        if (!next?.profile) return;
        const previous = { ...data.pendingParams, ...data.params, ...request?.params };
        if (kind === 'image') {
          const resolved = resolveImageParams(next.profile, previous);
          setData((current) => ({
            ...current,
            modelId: id,
            params: resolved.params,
            pendingParams: {},
          }));
          if (resolved.changes.length)
            store
              .getState()
              .notify(
                `已按新模型调整：${resolved.changes.map((change) => change.message).join('；')}`,
              );
          return;
        }
        const params = Object.fromEntries(
          next.profile.params.map((param) => [
            param.key,
            param.key in previous ? previous[param.key] : param.default,
          ]),
        );
        const pending = Object.fromEntries(
          Object.entries(previous).filter(([key, value]) => {
            return !!generationParamReason(
              next.profile!,
              {
                modelId: id,
                mode,
                prompt,
                inputs,
                params,
                source: 'canvas',
              },
              key,
              value,
            );
          }),
        );
        setData((current) => ({ ...current, modelId: id, params, pendingParams: pending }));
        if (Object.keys(pending).length)
          store.getState().notify('新模型无法沿用部分参数，请在参数中重新选择或清除待处理项');
      }}
    />
  );
}
