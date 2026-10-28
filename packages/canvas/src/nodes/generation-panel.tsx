import { useMemo } from 'react';
import { GenerationComposer } from './generation-composer';
import {
  checkRequest,
  checkMedia,
  imageEditSupport,
  parsePromptReferences,
  type CanvasMediaData,
  type SemanticRequest,
  type SemanticParams,
  type SemanticParamKey,
} from '@frame-loom/contracts';
import { isNodeLocked, updateData } from '../commands/commands';
import { useCanvas, useCanvasState } from '../context';
import { generationSources, generationModel } from './generation-inputs';
import { writeGenerationJob } from './generation-writeback';
import { defaultMediaParams } from './params/defaults';

export function GenerationPanel({
  nodeId,
  kind,
  data,
}: {
  nodeId: string;
  kind: 'image' | 'video' | 'audio';
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
  const missingRefs = parsePromptReferences(data.prompt).filter(
    (ref) => !references.some((input) => input.sourceId === ref.nodeId),
  );
  const prompt = data.prompt.replace(/@\{([A-Za-z0-9_-]+)\}/g, (token, id: string) => {
    const reference = references.find((item) => item.sourceId === id);
    return reference ? `@{${reference.input.sha256}}` : token;
  });
  const missingInputs =
    document.edges.filter((edge) => edge.target === nodeId).length >
    references.filter((ref) => !ref.local).length;
  const api = host.generation;
  if (!api) return null;

  const modelKind = kind === 'audio' ? 'tts' : kind;
  const options = config?.models.filter((model) => model.kind === modelKind) ?? [];
  const model = generationModel(config, modelKind, data.modelId);
  const cap = model?.capability;
  const mode = cap?.kind === 'video' ? (data.mode ?? cap.defaultMode) : undefined;
  const pendingParams = data.pendingParams ?? {};
  const request: SemanticRequest | undefined =
    model && cap
      ? {
          modelId: model.id,
          ...(mode ? { mode } : {}),
          prompt,
          params: { ...defaultMediaParams(cap), ...data.params },
          inputs,
          extras: {
            ...Object.fromEntries(
              model.extras
                .filter((param) => param.default !== undefined)
                .map((param) => [param.key, param.default!]),
            ),
            ...data.extras,
          },
          ...(data.imageEdit ? { imageEdit: data.imageEdit } : {}),
          source: 'canvas',
        }
      : undefined;
  const editSupport =
    cap?.kind === 'image' && model ? imageEditSupport(cap, model.protocol) : undefined;
  const imageEditIssue =
    request?.imageEdit && editSupport
      ? !editSupport[request.imageEdit.operation].available
        ? editSupport[request.imageEdit.operation].reason
        : request.imageEdit.operation === 'emotion' &&
            request.imageEdit.maskMode === 'provider' &&
            !editSupport.emotion.mask
          ? '所选模型不支持蒙版'
          : undefined
      : undefined;
  const issues =
    request && model
      ? [
          ...checkRequest(
            request,
            { kind: model.kind, capability: model.capability, extras: model.extras },
            model.protocol,
          ),
          ...checkMedia(references, model.capability),
        ]
      : [];
  const storageMissing =
    !!config &&
    !config.storageReady &&
    inputs.some((input) => model?.transport[input.kind] === 'url');
  const countInvalid = cap?.kind === 'image' && (data.count ?? 1) > (cap.count.max ?? 4);
  const setData = (change: (current: CanvasMediaData) => CanvasMediaData) =>
    store.getState().apply((document) => updateData<CanvasMediaData>(document, nodeId, change));

  async function generate() {
    if (
      !api ||
      !request ||
      issues.length ||
      countInvalid ||
      Object.keys(pendingParams).length ||
      storageMissing ||
      missingInputs ||
      missingRefs.length ||
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
    !config && (configError ?? '正在读取模型配置…'),
    !model &&
      (data.modelId ? '原模型已不可用，请重新选择生成模型' : '请先在模型服务中启用生成模型'),
    countInvalid && '生成数量超过当前模型上限',
    !prompt.trim() && '请填写提示词',
    prompt.length > 32000 && '提示词最多 32000 字',
    missingRefs.length > 0 && '引用的参考已断开',
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
      onExtras={(extras) => setData((current) => ({ ...current, extras }))}
      onPrompt={(prompt) => setData((current) => ({ ...current, prompt }))}
      onCount={(count) => setData((current) => ({ ...current, count }))}
      onParams={(params) =>
        setData((current) => {
          const pending = { ...current.pendingParams };
          for (const key of Object.keys(params) as SemanticParamKey[]) {
            if (params[key] !== current.params?.[key] || params[key] === pending[key])
              delete pending[key];
          }
          return {
            ...current,
            params,
            pendingParams: pending,
          };
        })
      }
      onModel={(id) => {
        const next = options.find((item) => item.id === id);
        if (!next) return;
        const previous = { ...data.pendingParams, ...request?.params, ...data.params };
        const params: SemanticParams = { ...defaultMediaParams(next.capability), ...previous };
        const nextMode =
          next.capability.kind === 'video' ? (mode ?? next.capability.defaultMode) : undefined;
        const problems = checkRequest(
          { modelId: id, mode: nextMode, prompt, inputs, params, extras: {}, source: 'canvas' },
          next,
          next.protocol,
        );
        const pending: SemanticParams = {};
        for (const [key, value] of Object.entries(previous)) {
          if (
            problems.some(
              (issue) =>
                issue.field === `params.${key}` ||
                (issue.field === 'params.size' &&
                  ['tier', 'aspectRatio', 'width', 'height'].includes(key)),
            )
          ) {
            Object.assign(pending, { [key]: value });
            delete params[key as SemanticParamKey];
          }
        }
        const extras = Object.fromEntries(
          Object.entries(data.extras ?? {}).filter(([key]) =>
            next.extras.some((param) => param.key === key),
          ),
        );
        setData((current) => ({ ...current, modelId: id, params, extras, pendingParams: pending }));
        if (Object.keys(pending).length)
          store.getState().notify('新模型无法沿用部分参数，请在参数中重新选择或清除待处理项');
      }}
    />
  );
}
