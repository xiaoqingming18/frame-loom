import { Injectable } from '@nestjs/common';
import { HealthResponse } from '@frame-loom/contracts';
import { readFileSync } from 'node:fs';
import { DatabaseService } from './database.service.js';

const { version: engineVersion } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

@Injectable()
export class HealthService {
  private readonly startedAt = new Date().toISOString();

  constructor(private readonly database: DatabaseService) {}

  getHealth(): HealthResponse {
    return HealthResponse.parse({
      status: 'ok',
      engineVersion,
      schemaVersion: this.database.getSchemaVersion(),
      startedAt: this.startedAt,
    });
  }
}
