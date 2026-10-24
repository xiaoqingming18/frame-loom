import { Test } from '@nestjs/testing';
import { expect, it } from 'vitest';
import { DatabaseService } from '../../core/database/database.service.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

it('通过装饰器元数据将 service 注入 controller', async () => {
  const module = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      HealthService,
      { provide: DatabaseService, useValue: { getSchemaVersion: () => '1' } },
    ],
  }).compile();
  try {
    expect(module.get(HealthController).getHealth()).toMatchObject({
      status: 'ok',
      schemaVersion: '1',
    });
  } finally {
    await module.close();
  }
});
