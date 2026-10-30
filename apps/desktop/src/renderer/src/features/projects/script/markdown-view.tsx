import { useEffect, useRef } from 'react';
import { Textarea } from '@frame-loom/ui/components/textarea';
import { Tabs, TabsList, TabsTrigger } from '@frame-loom/ui/components/tabs';

export function ScriptViewTabs({
  view,
  onChange,
  disabled,
}: {
  view: 'styled' | 'markdown';
  onChange: (view: 'styled' | 'markdown') => void;
  disabled?: boolean;
}) {
  return (
    <Tabs value={view} onValueChange={(value) => onChange(value as 'styled' | 'markdown')}>
      <TabsList aria-label="剧本视图">
        <TabsTrigger value="styled" disabled={disabled}>
          样式
        </TabsTrigger>
        <TabsTrigger value="markdown" disabled={disabled}>
          Markdown
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
export function MarkdownView({
  text,
  onChange,
  readOnly,
  error,
  unsure,
  cursor,
}: {
  text: string;
  onChange: (text: string) => void;
  readOnly: boolean;
  error: string | null;
  unsure: number;
  cursor?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (cursor !== undefined) {
      ref.current?.focus();
      ref.current?.setSelectionRange(cursor, cursor);
    }
  }, [cursor]);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-muted/50 p-4">
      {error && (
        <p role="alert" className="mx-auto mb-3 w-full max-w-[900px] text-sm text-destructive">
          {error}
        </p>
      )}
      {!!unsure && (
        <p
          role="status"
          className="mx-auto mb-3 w-full max-w-[900px] text-sm text-muted-foreground"
        >
          {unsure} 行识别存疑，切回样式视图后处理
        </p>
      )}
      <Textarea
        ref={ref}
        aria-label="Markdown 原文"
        value={text}
        onChange={(event) => onChange(event.target.value)}
        readOnly={readOnly}
        maxLength={200000}
        spellCheck={false}
        className="mx-auto min-h-0 w-full max-w-[900px] flex-1 resize-none bg-card font-mono text-sm leading-relaxed"
      />
    </div>
  );
}
