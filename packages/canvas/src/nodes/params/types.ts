import type {
  Capability,
  ProtocolDescriptor,
  SemanticInput,
  SemanticParams,
  VideoModeId,
} from '@frame-loom/contracts';

export interface CapabilityParamsProps {
  capability: Capability;
  protocol: ProtocolDescriptor;
  mode?: VideoModeId;
  inputs: SemanticInput[];
  params: SemanticParams;
  onChange: (params: SemanticParams) => void;
  disabled: boolean;
  readOnly?: boolean;
}
