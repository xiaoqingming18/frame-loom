import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FlaskConical, Send, Square } from 'lucide-react';
import { LlmEvent, type ModelUsage } from '@frame-loom/contracts';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { EngineClient } from '@/lib/engine-client';
import { channelsQuery, modelsQuery, defaultsQuery } from '@/lib/model-queries';
import { ImageLab } from './image-lab';

type Message = {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  complete: boolean;
};

export function ModelLab({ engineClient: client }: { engineClient: EngineClient }) {
  return (
    <Tabs defaultValue="text" className="mx-auto min-h-full w-full max-w-6xl gap-6 p-6 lg:p-10">
      <TabsList aria-label="模型测试类别" variant="line">
        <TabsTrigger value="text">文本</TabsTrigger>
        <TabsTrigger value="image">图片</TabsTrigger>
      </TabsList>
      <TabsContent value="text">
        <TextModelLab client={client} />
      </TabsContent>
      <TabsContent value="image">
        <ImageLab client={client} />
      </TabsContent>
    </Tabs>
  );
}

function TextModelLab({ client }: { client: EngineClient }) {
  const models = useQuery(modelsQuery(client));
  const channels = useQuery(channelsQuery(client));
  const defaults = useQuery(defaultsQuery(client));
  const [selected, setSelected] = useState('');
  const available =
    models.data?.filter(
      (model) =>
        model.kind === 'chat' &&
        model.enabled &&
        channels.data?.some((channel) => channel.id === model.channelId && channel.enabled),
    ) ?? [];
  const modelId = available.some((model) => model.id === selected)
    ? selected
    : (available.find((model) => model.id === defaults.data?.chat)?.id ?? available[0]?.id ?? '');
  return (
    <ModelConversation
      key={modelId}
      client={client}
      modelId={modelId}
      queryError={models.error ?? channels.error ?? defaults.error}
      empty={!models.isPending && !channels.isPending && !available.length}
      selector={(running) => (
        <label className="grid gap-2 text-xs text-muted-foreground">
          文本模型
          <NativeSelect
            aria-label="文本模型"
            disabled={running}
            value={modelId}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">选择已启用的文本模型</option>
            {available.map((model) => (
              <option key={model.id} value={model.id}>
                {channels.data?.find((channel) => channel.id === model.channelId)?.name} /{' '}
                {model.displayName}
              </option>
            ))}
          </NativeSelect>
        </label>
      )}
    />
  );
}

function ModelConversation({
  client,
  modelId,
  queryError,
  empty,
  selector,
}: {
  client: EngineClient;
  modelId: string;
  queryError: Error | null;
  empty: boolean;
  selector: (running: boolean) => ReactNode;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [usage, setUsage] = useState<ModelUsage>();
  const active = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [messages]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!input.trim() || !modelId || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const history = [
      ...messages
        .filter((message) => message.complete)
        .map(({ role, content }) => ({ role, content })),
      { role: 'user' as const, content: input.trim() },
    ];
    const index = messages.length + 1;
    setMessages((previous) => [
      ...previous,
      { role: 'user', content: input.trim(), complete: false },
      { role: 'assistant', content: '', thinking: '', complete: false },
    ]);
    setInput('');
    setRunning(true);
    setError('');
    setUsage(undefined);
    let completed = false;
    try {
      for await (const item of client.stream('/llm/test-chat', LlmEvent, {
        method: 'POST',
        body: { modelId, messages: history },
        signal: controller.signal,
      })) {
        if (item.type === 'error') throw new Error(`${item.code} · ${item.message}`);
        if (item.type === 'done') {
          completed = true;
          setUsage(item.usage);
        }
        setMessages((previous) =>
          previous.map((message, i) =>
            i === index - 1 && item.type === 'done'
              ? { ...message, complete: true }
              : i !== index
                ? message
                : {
                    ...message,
                    content: message.content + (item.type === 'text.delta' ? item.delta : ''),
                    thinking:
                      (message.thinking ?? '') + (item.type === 'thinking.delta' ? item.delta : ''),
                    complete: item.type === 'done' || message.complete,
                  },
          ),
        );
      }
      if (!completed) setError('INCOMPLETE_STREAM · 响应流提前结束');
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : '请求失败');
      else setError('REQUEST_ABORTED · 已停止生成');
    } finally {
      active.current = null;
      setRunning(false);
    }
  }
  return (
    <section
      className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-6"
      aria-labelledby="lab-heading"
    >
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <FlaskConical aria-hidden="true" className="size-4" />
            模型测试
          </p>
          <h1 id="lab-heading" className="font-serif text-2xl">
            从一句话开始测试
          </h1>
          <p className="mt-2 text-xs text-muted-foreground">
            对话仅保留在当前页面，切换模型会清空记录。
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={running || !messages.length}
          onClick={() => {
            setMessages([]);
            setError('');
            setUsage(undefined);
          }}
        >
          清空对话
        </Button>
      </header>
      <div className="flex flex-1 flex-col gap-6">
        {selector(running)}
        {queryError && (
          <p role="alert" className="text-sm text-destructive">
            {queryError.message}
          </p>
        )}
        {empty && (
          <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
            请先在设置中心的「模型服务」添加渠道，并启用文本模型。
          </p>
        )}
        <div role="log" aria-label="文本对话" aria-live="polite" className="flex-1 space-y-5">
          {messages.map((message, index) => (
            <article
              key={index}
              className={
                message.role === 'user' ? 'ml-10 rounded-2xl border bg-card p-4' : 'mr-10 p-4'
              }
            >
              <p className="mb-2 text-xs text-muted-foreground">
                {message.role === 'user' ? '你' : '模型'}
                {!message.complete && !running && ' · 未完成'}
              </p>
              {message.thinking && (
                <details className="mb-3 text-xs text-muted-foreground">
                  <summary>推理过程</summary>
                  <p className="mt-2 break-words whitespace-pre-wrap">{message.thinking}</p>
                </details>
              )}
              <p className="break-words whitespace-pre-wrap">
                {message.content || (running ? '正在生成…' : '未收到文本')}
              </p>
            </article>
          ))}
          <div ref={end} />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {usage && (
          <p role="status" className="text-xs text-muted-foreground">
            用量：输入 {usage.input} · 输出 {usage.output} · 缓存读取 {usage.cacheRead} · 缓存写入{' '}
            {usage.cacheWrite} · 总计 {usage.totalTokens}
          </p>
        )}
        <form
          onSubmit={(event) => void submit(event)}
          className="space-y-3 rounded-2xl border bg-card p-4 shadow-panel"
        >
          <Textarea
            aria-label="测试消息"
            placeholder="输入消息，测试模型的文本响应…"
            maxLength={32000}
            disabled={running || !modelId || messages.length >= 50}
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {messages.length >= 50 ? '已达 25 轮上限，请清空对话。' : 'Enter 换行，点击发送开始'}
            </p>
            {running ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => active.current?.abort()}
              >
                <Square aria-hidden="true" />
                停止
              </Button>
            ) : (
              <Button
                type="submit"
                size="sm"
                disabled={!modelId || !input.trim() || messages.length >= 50}
              >
                <Send aria-hidden="true" />
                发送
              </Button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
