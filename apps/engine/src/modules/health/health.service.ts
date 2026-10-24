import { Injectable } from '@nestjs/common';
import { HealthResponse } from '@frame-loom/contracts';
import { readFileSync } from 'node:fs';
import { DatabaseService } from '../../core/database/database.service.js';
import { packageRoot } from '../../package-root.js';

const { version: engineVersion } = JSON.parse(
  readFileSync(new URL('package.json', packageRoot), 'utf8'),
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
