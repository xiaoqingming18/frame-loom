import {
  checkMedia,
  checkRequest,
  type CanvasMediaData,
  type MediaFile,
  type SemanticInput,
} from '@frame-loom/contracts';
import type { CanvasGenerationModel } from '../host';
import { videoInputs } from './media';

type Reference = { input: SemanticInput; media: Partial<MediaFile> };

export function referenceRoleReason(
  model: CanvasGenerationModel,
  data: Pick<CanvasMediaData, 'mode'>,
  role: SemanticInput['role'],
  kind: SemanticInput['kind'],
) {
  if (model.capability.kind !== 'video') return '请选择视频模型';
  const port = videoInputs(data, model.capability).find((port) => port.id === role);
  return !port || !port.accepts.includes(kind) ? '当前方式不支持此素材角色或类型' : undefined;
}

/** 编辑过程允许另一必填槽位暂空，只拒绝本次添加产生的校验问题。 */
export function referenceCandidateIssue(
  model: CanvasGenerationModel,
  data: CanvasMediaData,
  refs: Reference[],
  candidate: Reference,
) {
  const role = referenceRoleReason(model, data, candidate.input.role, candidate.input.kind);
  if (role) return role;
  const request = {
    modelId: model.id,
    mode: data.mode,
    prompt: data.prompt,
    params: data.params ?? {},
    extras: {},
    source: 'canvas' as const,
  };
  const before = checkRequest(
    { ...request, inputs: refs.map((ref) => ref.input) },
    model,
    model.protocol,
  );
  const after = checkRequest(
    { ...request, inputs: [...refs.map((ref) => ref.input), candidate.input] },
    model,
    model.protocol,
  );
  return (
    checkMedia([...refs, candidate], model.capability)[0]?.message ??
    after.find(
      (issue) =>
        issue.field === 'inputs' &&
        !before.some(
          (previous) => previous.field === issue.field && previous.message === issue.message,
        ),
    )?.message
  );
}
