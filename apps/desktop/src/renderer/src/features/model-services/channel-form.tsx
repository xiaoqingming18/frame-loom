import { useState, type FormEvent } from 'react';
import { ArrowLeft, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { Channel, ChannelWrite, type CatalogFormat } from '@frame-loom/contracts/model-service';
import { resolveCatalogUrl } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Input } from '@frame-loom/ui/components/input';
import { NativeSelect } from '@frame-loom/ui/components/native-select';
import { Checkbox } from '@frame-loom/ui/components/checkbox';
import type { EngineClient } from '@/lib/engine-client';
import { Field, ErrorMessage } from './form-fields';

const presets: { name: string; baseUrl: string; catalogFormat: CatalogFormat }[] = [
  { name: '中转站 / 自定义', baseUrl: '', catalogFormat: 'openai' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', catalogFormat: 'openai' },
  { name: 'Anthropic', baseUrl: 'https://api.anthropic.com', catalogFormat: 'anthropic' },
  {
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    catalogFormat: 'gemini',
  },
  {
    name: '火山方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    catalogFormat: 'openai',
  },
  { name: '阿里云百炼', baseUrl: 'https://dashscope.aliyuncs.com', catalogFormat: 'openai' },
  { name: 'MiniMax', baseUrl: 'https://api.minimax.io', catalogFormat: 'openai' },
  { name: '可灵', baseUrl: 'https://api.kling.ai', catalogFormat: 'openai' },
  { name: 'ElevenLabs', baseUrl: 'https://api.elevenlabs.io', catalogFormat: 'openai' },
];
export function ChannelForm({
  client,
  channel,
  onClose,
  onSaved,
}: {
  client: EngineClient;
  channel?: Channel;
  onClose: () => void;
  onSaved: (channel: Channel, read: boolean) => Promise<void>;
}) {
  const [name, setName] = useState(channel?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(channel?.baseUrl ?? '');
  const [catalogFormat, setFormat] = useState<CatalogFormat>(channel?.catalogFormat ?? 'openai');
  const [concurrency, setConcurrency] = useState(channel?.concurrency ?? 2);
  const [apiKey, setKey] = useState('');
  const [secretKey, setSecret] = useState('');
  const [show, setShow] = useState(false);
  const [clear, setClear] = useState(false);
  const [resetHeaders, setResetHeaders] = useState(!channel);
  const [headers, setHeaders] = useState<{ name: string; value: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  let catalogUrl = '请先填写有效服务地址';
  try {
    catalogUrl = resolveCatalogUrl(baseUrl, catalogFormat);
  } catch {
    /* 草稿尚未填完。 */
  }
  async function save(event: FormEvent, read = false) {
    event.preventDefault();
    setError('');
    const parsed = ChannelWrite.safeParse({
      name,
      baseUrl,
      catalogFormat,
      concurrency,
      enabled: channel?.enabled ?? true,
      ...(clear ? { apiKey: '' } : apiKey ? { apiKey } : {}),
      ...(secretKey ? { secretKey } : {}),
      ...(resetHeaders
        ? { headers: Object.fromEntries(headers.map((header) => [header.name, header.value])) }
        : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join('；'));
      return;
    }
    setBusy(true);
    try {
      const saved = await client.request(
        channel ? `/channels/${channel.id}` : '/channels',
        Channel,
        { method: channel ? 'PATCH' : 'POST', body: parsed.data },
      );
      await onSaved(saved, read);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '渠道保存失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-5">
      <Button variant="ghost" size="sm" onClick={onClose}>
        <ArrowLeft aria-hidden="true" />
        模型服务
      </Button>
      <h2 className="text-xl font-semibold">{channel ? '编辑渠道' : '添加渠道'}</h2>
      <div className="grid gap-6 sm:grid-cols-[130px_1fr]">
        <nav aria-label="渠道预设" className="flex gap-1 overflow-x-auto sm:flex-col">
          {presets.map((preset) => (
            <Button
              key={preset.name}
              variant="ghost"
              size="sm"
              className="justify-start whitespace-nowrap"
              onClick={() => {
                setName(preset.name);
                setBaseUrl(preset.baseUrl);
                setFormat(preset.catalogFormat);
              }}
            >
              {preset.name}
            </Button>
          ))}
        </nav>
        <form className="min-w-0 space-y-4" onSubmit={(event) => void save(event)}>
          <Field label="渠道名称">
            <Input
              required
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="服务地址">
            <Input
              required
              type="url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </Field>
          <p className="font-mono text-xs break-all text-muted-foreground">
            模型列表地址：{catalogUrl}
          </p>
          <Field label="API Key">
            <span className="flex gap-2">
              <Input
                type={show ? 'text' : 'password'}
                autoComplete="off"
                placeholder={channel ? '留空保留已保存的 Key' : ''}
                value={apiKey}
                onChange={(event) => setKey(event.target.value)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={show ? '隐藏密钥' : '显示密钥'}
                onClick={() => setShow(!show)}
              >
                {show ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </Button>
            </span>
          </Field>
          {channel && (
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={clear} onCheckedChange={(value) => setClear(value === true)} />
              清除已保存的 Key
            </label>
          )}
          <details className="rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-sm">高级设置</summary>
            <div className="mt-4 space-y-4">
              <Field label="Secret Key" help="仅 AK/SK 签名类协议需要；留空保留">
                <Input
                  type="password"
                  value={secretKey}
                  onChange={(event) => setSecret(event.target.value)}
                />
              </Field>
              <Field label="模型列表格式">
                <NativeSelect
                  value={catalogFormat}
                  onChange={(event) => setFormat(event.target.value as CatalogFormat)}
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="gemini">Gemini</option>
                </NativeSelect>
              </Field>
              <Field label="渠道并发">
                <Input
                  type="number"
                  min={1}
                  max={16}
                  value={concurrency}
                  onChange={(event) => setConcurrency(Number(event.target.value))}
                />
              </Field>
              {channel && (
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={resetHeaders}
                    onCheckedChange={(value) => setResetHeaders(value === true)}
                  />
                  重新设置请求头（已保存：{channel.headerNames.join('、') || '无'}）
                </label>
              )}
              {resetHeaders && (
                <div className="space-y-2">
                  {headers.map((header, index) => (
                    <div key={index} className="flex gap-2">
                      <Input
                        aria-label={`请求头名称 ${index + 1}`}
                        value={header.name}
                        onChange={(event) =>
                          setHeaders(
                            headers.map((item, i) =>
                              i === index ? { ...item, name: event.target.value } : item,
                            ),
                          )
                        }
                      />
                      <Input
                        aria-label={`请求头值 ${index + 1}`}
                        type="password"
                        value={header.value}
                        onChange={(event) =>
                          setHeaders(
                            headers.map((item, i) =>
                              i === index ? { ...item, value: event.target.value } : item,
                            ),
                          )
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`移除请求头 ${index + 1}`}
                        onClick={() => setHeaders(headers.filter((_, i) => i !== index))}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={headers.length >= 32}
                    onClick={() => setHeaders([...headers, { name: '', value: '' }])}
                  >
                    <Plus aria-hidden="true" />
                    添加请求头
                  </Button>
                </div>
              )}
            </div>
          </details>
          <ErrorMessage error={error} />
          <footer className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button disabled={busy} type="submit">
              保存
            </Button>
            <Button
              disabled={busy}
              type="button"
              variant="secondary"
              onClick={(event) => void save(event, true)}
            >
              保存并读取模型
            </Button>
          </footer>
        </form>
      </div>
    </section>
  );
}
