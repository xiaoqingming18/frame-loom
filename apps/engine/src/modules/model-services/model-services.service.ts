import { Injectable } from '@nestjs/common';
import { ModelWrite, ModelExport } from '@frame-loom/contracts';
import { getProtocol, validateModel } from '@frame-loom/contracts';
import { ModelServicesRepository } from './model-services.repository.js';

@Injectable()
export class ModelServicesService {
  constructor(private readonly repository: ModelServicesRepository) {}
  export(id: string): ModelExport {
    const model = this.repository.getModel(id);
    const write = ModelWrite.parse(
      Object.fromEntries(
        Object.keys(ModelWrite.shape).map((key) => [key, model[key as keyof typeof model]]),
      ),
    );
    const { enabled, endpointOverride, ...fields } = write;
    void enabled;
    const { confirmedHosts, ...override } = endpointOverride;
    void confirmedHosts;
    return ModelExport.parse({
      schema: 'frame-loom.model',
      schemaVersion: 1,
      model: { ...fields, endpointOverride: override },
    });
  }
  preview(channelId: string, input: ModelExport) {
    const channel = this.repository.getChannel(channelId);
    const model = ModelWrite.parse({
      ...input.model,
      enabled: false,
      endpointOverride: { ...input.model.endpointOverride, confirmedHosts: [] },
    });
    return {
      model,
      issues: validateModel(
        model,
        model.protocolId ? getProtocol(model.protocolId) : undefined,
        channel,
      ),
    };
  }
}
