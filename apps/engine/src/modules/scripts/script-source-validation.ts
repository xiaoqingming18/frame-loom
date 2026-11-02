import {
  type ImportSceneBatch,
  type ImportMetaBatch,
  type SourceUnit,
  type SourceRange,
  type ScriptBeat,
} from '@frame-loom/contracts';
import { DomainError } from '../../core/http/domain-error.js';

export function sourceUnits(text: string): SourceUnit[] {
  return text
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((text, id) => ({ id, text }));
}
export function partitionSource(units: SourceUnit[], limit: number): SourceRange[] {
  const ranges: SourceRange[] = [];
  let start = units[0]?.id ?? 0,
    size = 0;
  for (const unit of units) {
    const bytes = Buffer.byteLength(JSON.stringify(unit), 'utf8');
    if (bytes > limit)
      throw new DomainError(
        'SCRIPT_CAPACITY_INSUFFICIENT',
        422,
        `来源第${unit.id + 1}行超出最小片段容量，请换行后重试`,
      );
    if (size + bytes > limit && unit.id > start) {
      ranges.push({ start, end: unit.id });
      start = unit.id;
      size = 0;
    }
    size += bytes;
  }
  const end = (units.at(-1)?.id ?? -1) + 1;
  if (start < end) ranges.push({ start, end });
  return ranges;
}
function fieldAt(value: unknown, path: string): unknown {
  let current = value;
  for (const key of path.split('.')) {
    if (
      key === '__proto__' ||
      key === 'constructor' ||
      key === 'prototype' ||
      current === null ||
      typeof current !== 'object'
    )
      return undefined;
    current = Reflect.get(current, key);
  }
  return current;
}
export function validateSource(
  batch: ImportSceneBatch | ImportMetaBatch,
  units: SourceUnit[],
  inherited?: { location: string; atmosphere: string; lastBeat?: ScriptBeat },
) {
  const value = 'scene' in batch ? batch.scene : batch;
  const coverage = new Map<number, boolean[]>();
  for (let id = batch.responsible.start; id < batch.responsible.end; id++) {
    if (!units[id]) throw new DomainError('SCRIPT_SOURCE_INVALID', 422, '来源区间越界');
    coverage.set(
      id,
      Array.from({ length: units[id].text.length }, () => false),
    );
  }
  const mapped = new Map<string, string[]>();
  const positions = new Map<string, { unit: number; start: number; end: number }[]>();
  const beatSpans: { index: number; unit: number; start: number; end: number }[] = [];
  for (const mapping of batch.mappings) {
    const unit = units[mapping.unit],
      mask = coverage.get(mapping.unit);
    const field = fieldAt(value, mapping.path);
    if (!unit || !mask || mapping.end > unit.text.length || typeof field !== 'string')
      throw new DomainError('SCRIPT_SOURCE_INVALID', 422, `来源映射无效：${mapping.path}`);
    const parts = mapped.get(mapping.path) ?? [];
    const spans = positions.get(mapping.path) ?? [];
    const previous = spans.at(-1);
    if (
      previous &&
      (mapping.unit < previous.unit ||
        (mapping.unit === previous.unit && mapping.start < previous.end))
    )
      throw new DomainError('SCRIPT_SOURCE_ORDER', 422, `字段来源重复或乱序：${mapping.path}`);
    parts.push(unit.text.slice(mapping.start, mapping.end));
    mapped.set(mapping.path, parts);
    spans.push(mapping);
    positions.set(mapping.path, spans);
    const match = /^beats\.(\d+)\.(?:content|speaker|emotion|line)$/u.exec(mapping.path);
    if (match) beatSpans.push({ ...mapping, index: Number(match[1]) });
    for (let index = mapping.start; index < mapping.end; index++) mask[index] = true;
  }
  for (const [path, parts] of mapped)
    if (parts.join('\n') !== fieldAt(value, path))
      throw new DomainError('SCRIPT_SOURCE_CHANGED', 422, `原文被改写：${path}`);
  beatSpans.sort((a, b) => a.unit - b.unit || a.start - b.start);
  for (let index = 1; index < beatSpans.length; index++) {
    const previous = beatSpans[index - 1],
      current = beatSpans[index];
    if (
      current.index < previous.index ||
      (current.unit === previous.unit && current.start < previous.end)
    )
      throw new DomainError('SCRIPT_SOURCE_ORDER', 422, '内容来源重复、重叠或乱序');
  }
  const required: string[] = [];
  if ('scene' in batch) {
    if (batch.scene.location !== inherited?.location) required.push('location');
    if (batch.scene.atmosphere !== inherited?.atmosphere) required.push('atmosphere');
    for (const [index, beat] of batch.scene.beats.entries()) {
      if (beat.type === 'action') required.push(`beats.${index}.content`);
      else {
        const prior = index === 0 && batch.firstBeatContinuation ? inherited?.lastBeat : undefined;
        if (prior?.type !== 'dialogue' || prior.speaker !== beat.speaker)
          required.push(`beats.${index}.speaker`);
        if (prior?.type !== 'dialogue' || prior.emotion !== beat.emotion)
          required.push(`beats.${index}.emotion`);
        required.push(`beats.${index}.line`);
      }
    }
    for (const name of batch.scene.characters)
      if (
        !units
          .map((u) => u.text)
          .join('\n')
          .includes(name)
      )
        throw new DomainError('SCRIPT_SOURCE_CHANGED', 422, `人物不在原文：${name}`);
  } else {
    required.push('core_conflict', 'hook_start', 'hook_end');
    for (const field of Object.keys(batch.source_authority ?? {}))
      required.push(`source_authority.${field}`);
  }
  for (const path of required)
    if (fieldAt(value, path) && !mapped.has(path))
      throw new DomainError('SCRIPT_SOURCE_MISSING', 422, `缺少字段来源：${path}`);
  for (const [id, mask] of coverage) {
    const unit = units[id];
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})?\s*$/u.test(unit.text)) continue;
    const onLine = batch.mappings.filter((mapping) => mapping.unit === id);
    const allow = (start: number, end: number) => {
      for (let index = start; index < end; index++) mask[index] = true;
    };
    // 分隔符只在已映射字段之间豁免，正文内部和末尾标点仍须逐字覆盖。
    const dialogue = onLine
      .filter((mapping) => /^beats\.\d+\.(speaker|emotion|line)$/u.test(mapping.path))
      .sort((a, b) => a.start - b.start);
    const characters = onLine
      .filter((mapping) => mapping.path.startsWith('characters.'))
      .sort((a, b) => a.start - b.start);
    for (let index = 1; index < characters.length; index++) {
      const left = characters[index - 1],
        right = characters[index];
      if (/^\s*[、,，]\s*$/u.test(unit.text.slice(left.end, right.start)))
        allow(left.end, right.start);
    }
    for (let index = 1; index < dialogue.length; index++) {
      const left = dialogue[index - 1],
        right = dialogue[index];
      const [leftBeat, leftField] = left.path.split('.').slice(1);
      const [rightBeat, rightField] = right.path.split('.').slice(1);
      const gap = unit.text.slice(left.end, right.start);
      if (
        leftBeat === rightBeat &&
        ((leftField === 'speaker' && rightField === 'emotion' && /^\s*[(（]\s*$/u.test(gap)) ||
          (leftField === 'speaker' && rightField === 'line' && /^\s*[:：]\s*$/u.test(gap)) ||
          (leftField === 'emotion' && rightField === 'line' && /^\s*[)）]\s*[:：]?\s*$/u.test(gap)))
      )
        allow(left.end, right.start);
    }
    const last = dialogue.at(-1);
    if (
      last?.path.endsWith('.emotion') &&
      /^\s*[)）]\s*[:：]?\s*$/u.test(unit.text.slice(last.end))
    )
      allow(last.end, unit.text.length);
    if (last?.path.endsWith('.speaker') && /^\s*[:：]\s*$/u.test(unit.text.slice(last.end)))
      allow(last.end, unit.text.length);
    const first = onLine.slice().sort((a, b) => a.start - b.start)[0];
    if (first) {
      const prefix = unit.text.slice(0, first.start);
      const label = first.path.startsWith('source_authority.')
        ? /^\s*(?:#{1,6}\s+|(?:剧名|集号|标题|题材|类型|画风|单集时长|时长)[:：]\s*)$/u
        : first.path === 'location'
          ? /^\s*(?:#{1,6}\s*|(?:第)?\d+(?:[-－]\d+)?[场.、\s]*)?\s*$/u
          : first.path === 'atmosphere'
            ? /^\s*氛围[:：]\s*$/u
            : first.path.startsWith('characters.')
              ? /^\s*人物[:：]\s*$/u
              : first.path.endsWith('.content')
                ? /^\s*(?:△\s*)*$/u
                : first.path === 'core_conflict'
                  ? /^\s*核心冲突[:：]\s*$/u
                  : first.path === 'hook_start'
                    ? /^\s*开场钩子[:：]\s*$/u
                    : first.path === 'hook_end'
                      ? /^\s*结尾钩子[:：]\s*$/u
                      : /^\s*$/u;
      if (label.test(prefix)) allow(0, first.start);
    }
    let remainder = unit.text
      .split('')
      .filter((_, index) => !mask[index])
      .join('');
    if ('scene' in batch && onLine.some((mapping) => mapping.path === 'location')) {
      const time = batch.scene.time_of_day,
        place = batch.scene.interior ? '内' : '外';
      if ([`${time}${place}`, `${place}${time}`].includes(remainder.replace(/\s/gu, '')))
        remainder = '';
    }
    if (/\S/u.test(remainder))
      throw new DomainError(
        'SCRIPT_SOURCE_MISSING',
        422,
        `来源第${id + 1}行有遗漏或不可表示内容：${remainder.slice(0, 60)}`,
      );
  }
}
