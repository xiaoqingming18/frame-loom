import { Injectable } from '@nestjs/common';
import { DomainError } from '../../../core/http/domain-error.js';
import type { ProtocolAdapter } from './types.js';

@Injectable()
export class ProtocolRegistry {
  readonly adapters = new Map<string, ProtocolAdapter>();
  get(id: string): ProtocolAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new DomainError('INVALID_PROTOCOL', 422, '生成协议尚未接入');
    return adapter;
  }
  register(adapter: ProtocolAdapter) {
    this.adapters.set(adapter.descriptor.id, adapter);
  }
}
