import { expect, it } from 'vitest';
import { ErrorResponse } from './index.js';

const error: ErrorResponse = { code: 'VALIDATION_FAILED', message: '请求参数无效' };

it('接受错误响应与可选的字段问题', () => {
  expect(ErrorResponse.parse(error)).toEqual(error);
  const withIssues = { ...error, issues: [{ path: 'items.0.name', message: '名称不能为空' }] };
  expect(ErrorResponse.parse(withIssues)).toEqual(withIssues);
  expect(ErrorResponse.parse({ ...error, issues: [] }).issues).toEqual([]);
});

it.each(['code', 'message'] as const)('拒绝缺少 %s 的错误响应', (field) => {
  const input = { ...error };
  Reflect.deleteProperty(input, field);
  expect(ErrorResponse.safeParse(input).success).toBe(false);
});

it.each([
  null,
  { ...error, code: 400 },
  { ...error, message: null },
  { ...error, issues: {} },
  { ...error, issues: [{ message: '缺少路径' }] },
  { ...error, issues: [{ path: ['name'], message: '路径必须是字符串' }] },
  { ...error, issues: [{ path: 'name', message: 1 }] },
])('拒绝非法错误响应：%j', (input) => {
  expect(ErrorResponse.safeParse(input).success).toBe(false);
});
