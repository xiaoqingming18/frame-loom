import type { ProtocolDescriptor } from '@frame-loom/contracts';
import { DomainError } from '../../../core/http/domain-error.js';

export function chatRuntime(descriptor: ProtocolDescriptor) {
  const apis = {
    'openai-chat': 'openai-completions',
    'openai-responses': 'openai-responses',
    'anthropic-messages': 'anthropic-messages',
    'gemini-generate': 'google-generative-ai',
  } as const;
  const api = apis[descriptor.id as keyof typeof apis];
  if (!api) throw new DomainError('INVALID_PROTOCOL', 422, '协议未接入文本运行时');
  return api;
}
