import { describe, expect, it } from 'vitest';
import { EngineConnection } from './index.js';

const connection: EngineConnection = {
  baseUrl: 'http://127.0.0.1:43123',
  token: 'a'.repeat(64),
};

describe('EngineConnection', () => {
  it('接受合法连接信息', () => {
    expect(EngineConnection.parse(connection)).toEqual(connection);
  });

  it.each([1, 80, 65535])('接受端口 %i', (port) => {
    const input = { ...connection, baseUrl: `http://127.0.0.1:${port}` };
    expect(EngineConnection.parse(input)).toEqual(input);
  });

  it.each(['baseUrl', 'token'] as const)('拒绝缺少 %s 的连接信息', (field) => {
    const input = { ...connection };
    Reflect.deleteProperty(input, field);
    expect(EngineConnection.safeParse(input).success).toBe(false);
  });

  it.each([
    { token: '' },
    { token: 123 },
    { baseUrl: 123 },
    { baseUrl: 'http://localhost:43123' },
    { baseUrl: 'http://192.168.1.1:43123' },
    { baseUrl: 'http://[::1]:43123' },
    { baseUrl: 'http://127.0.0.1.example.com:43123' },
    { baseUrl: 'http://127.1:43123' },
    { baseUrl: 'http://2130706433:43123' },
    { baseUrl: 'https://127.0.0.1:43123' },
    { baseUrl: 'http://127.0.0.1' },
    { baseUrl: 'http://127.0.0.1:0' },
    { baseUrl: 'http://127.0.0.1:65536' },
    { baseUrl: 'http://127.0.0.1:100000' },
    { baseUrl: 'http://127.0.0.1:-1' },
    { baseUrl: 'http://127.0.0.1:1.5' },
    { baseUrl: 'http://127.0.0.1:080' },
    { baseUrl: 'http://127.0.0.1:43123/' },
    { baseUrl: 'http://127.0.0.1:43123/health' },
    { baseUrl: 'http://127.0.0.1:43123?token=secret' },
    { baseUrl: 'http://127.0.0.1:43123#fragment' },
    { baseUrl: 'http://user@127.0.0.1:43123' },
    { baseUrl: ' http://127.0.0.1:43123' },
    { baseUrl: 'http://127.0.0.1:43123\n' },
  ])('拒绝错误连接信息：%j', (invalid) => {
    expect(EngineConnection.safeParse({ ...connection, ...invalid }).success).toBe(false);
  });
});
