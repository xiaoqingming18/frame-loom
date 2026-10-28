import { Injectable } from '@nestjs/common';
import { DomainError } from '../../../core/http/domain-error.js';
import type { ProtocolAdapter } from './types.js';
import { openaiImages } from './openai-images.js';
import { arkSeedream } from './ark-seedream.js';
import { geminiGenerate } from './gemini-generate.js';
import { arkSeedance } from './ark-seedance.js';
import { dashscopeWan } from './dashscope-wan.js';
import { minimaxVideoV2 } from './minimax-video-v2.js';
import { klingOmni } from './kling-omni.js';
import { openaiVideos } from './openai-videos.js';
import { newapiVideo } from './newapi-video.js';
import { openaiSpeech } from './openai-speech.js';
import { minimaxT2a } from './minimax-t2a.js';
import { elevenlabs } from './elevenlabs.js';

@Injectable()
export class ProtocolRegistry {
  readonly adapters = new Map<string, ProtocolAdapter>();
  constructor() {
    for (const adapter of [
      openaiImages,
      arkSeedream,
      geminiGenerate,
      arkSeedance,
      dashscopeWan,
      minimaxVideoV2,
      klingOmni,
      openaiVideos,
      newapiVideo,
      openaiSpeech,
      minimaxT2a,
      elevenlabs,
    ])
      this.register(adapter);
  }
  get(id: string): ProtocolAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new DomainError('INVALID_PROTOCOL', 422, '生成协议尚未接入');
    return adapter;
  }
  register(adapter: ProtocolAdapter) {
    this.adapters.set(adapter.descriptor.id, adapter);
  }
}
