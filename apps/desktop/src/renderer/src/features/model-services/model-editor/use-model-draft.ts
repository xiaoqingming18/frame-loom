import { useState } from 'react';
import {
  changeProtocol,
  emptyCapability,
  getProtocol,
  restoreCapabilityGroup,
  type CapabilityGroup,
} from '@frame-loom/contracts';
import { ModelWrite, type Model } from '@frame-loom/contracts';

export function modelWrite(model: Model): ModelWrite {
  return ModelWrite.parse(
    Object.fromEntries(Object.entries(model).filter(([key]) => key in ModelWrite.shape)),
  );
}
export function useModelDraft(model?: Model, copy = false) {
  const initial = () =>
    model
      ? {
          ...modelWrite(model),
          ...(copy
            ? {
                upstreamModelId: model.upstreamModelId + '-copy',
                displayName: model.displayName + ' 副本',
                enabled: false,
              }
            : {}),
        }
      : undefined;
  // 新模型的名称暂为空，提交时由 schema 统一校验。
  const [draft, setDraft] = useState<ModelWrite>(() =>
    model
      ? initial()!
      : {
          kind: 'chat',
          upstreamModelId: '',
          displayName: '',
          protocolId: null,
          enabled: false,
          capability: emptyCapability('chat'),
          endpointOverride: { confirmedHosts: [] },
          transport: {},
          extras: [],
          fixedFields: [],
        },
  );
  const [baseline, setBaseline] = useState(JSON.stringify(draft));
  const dirty = JSON.stringify(draft) !== baseline;
  return {
    draft,
    setDraft,
    dirty,
    markSaved: (value: ModelWrite) => {
      setDraft(value);
      setBaseline(JSON.stringify(value));
    },
    protocol: (id: string) => changeProtocol(draft, id),
    restore: (group: CapabilityGroup) => {
      const descriptor = draft.protocolId ? getProtocol(draft.protocolId) : undefined;
      if (descriptor)
        setDraft({
          ...draft,
          capability: restoreCapabilityGroup(draft.capability, descriptor, group),
        });
    },
  };
}
