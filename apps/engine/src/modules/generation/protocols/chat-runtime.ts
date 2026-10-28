import type { ProtocolDescriptor } from '@frame-loom/contracts';
import { DomainError } from '../../../core/http/domain-error.js';

export function chatRuntime(descriptor: ProtocolDescriptor) {
  const api = descriptor.chatRuntime?.api;
  if (!api) throw new DomainError('INVALID_PROTOCOL', 422, '协议未接入文本运行时');
  return api;
}
