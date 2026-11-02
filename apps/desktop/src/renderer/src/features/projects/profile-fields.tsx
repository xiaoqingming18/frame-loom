import { useId, useState } from 'react';
import {
  GENRE_PRESETS,
  Genre,
  PROJECT_FORMS,
  PROJECT_MEDIA,
  type ProjectProfile,
} from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Input } from '@frame-loom/ui/components/input';
import { cn } from '@frame-loom/ui/lib/utils';

export function ProfileFields({
  value,
  onChange,
  compact = false,
  disabled = false,
}: {
  value: ProjectProfile;
  onChange: (value: ProjectProfile) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const [custom, setCustom] = useState<string | null>(null);
  const [error, setError] = useState('');
  function toggleGenre(name: string) {
    if (value.genres.includes(name)) {
      onChange({ ...value, genres: value.genres.filter((genre) => genre !== name) });
      setError('');
      return;
    }
    if (value.genres.length >= 5) {
      setError('最多选择 5 个题材');
      return;
    }
    onChange({ ...value, genres: [...value.genres, name] });
    setError('');
  }
  return (
    <fieldset disabled={disabled} className="grid gap-4">
      <label className="grid gap-2 text-sm">
        共享画风
        <Input
          value={value.style ?? ''}
          maxLength={2000}
          onChange={(event) => onChange({ ...value, style: event.target.value })}
        />
      </label>
      {(['form', 'medium'] as const).map((field) => (
        <fieldset key={field} className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">
            {field === 'form' ? '内容形式' : '制作媒介'}
            {compact && '（必填）'}
          </legend>
          <div className="flex flex-wrap gap-2">
            {Object.entries(field === 'form' ? PROJECT_FORMS : PROJECT_MEDIA).map(
              ([key, label]) => (
                <label
                  key={key}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm has-focus-visible:ring-2 has-focus-visible:ring-ring',
                    value[field] === key && 'border-primary bg-accent',
                  )}
                >
                  <input
                    type="radio"
                    name={`${id}-${field}`}
                    checked={value[field] === key}
                    onChange={() => onChange({ ...value, [field]: key })}
                  />
                  {label}
                </label>
              ),
            )}
          </div>
        </fieldset>
      ))}
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">题材{compact && '（必填）'}</legend>
        <div className="flex flex-wrap gap-2">
          {[
            ...GENRE_PRESETS,
            ...value.genres.filter(
              (genre) => !(GENRE_PRESETS as readonly string[]).includes(genre),
            ),
          ].map((name) => (
            <Button
              key={name}
              type="button"
              size="sm"
              variant={value.genres.includes(name) ? 'secondary' : 'outline'}
              aria-pressed={value.genres.includes(name)}
              aria-label={
                !(GENRE_PRESETS as readonly string[]).includes(name) ? `删除题材 ${name}` : name
              }
              onClick={() => toggleGenre(name)}
            >
              {name}
            </Button>
          ))}
          {custom === null ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setCustom('')}>
              + 自定义
            </Button>
          ) : (
            <Input
              aria-label="自定义题材"
              autoFocus
              value={custom}
              className="w-32"
              onChange={(event) => setCustom(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setCustom(null);
                }
                if (event.key !== 'Enter') return;
                event.preventDefault();
                const parsed = Genre.safeParse(custom);
                if (!parsed.success) {
                  setError('题材须为 1–10 个字符，不能含控制字符');
                  return;
                }
                if (
                  value.genres.some((genre) => genre.toLowerCase() === parsed.data.toLowerCase())
                ) {
                  setError('题材已存在');
                  return;
                }
                toggleGenre(parsed.data);
                setCustom(null);
              }}
            />
          )}
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </fieldset>
      {!compact && (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">画幅</legend>
          <div className="flex flex-wrap gap-3">
            {(['16:9', '9:16', '2.39:1', '4:3'] as const).map((aspect) => (
              <label key={aspect} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`${id}-aspect`}
                  checked={value.aspect === aspect}
                  onChange={() => onChange({ ...value, aspect })}
                />
                {aspect}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </fieldset>
  );
}
