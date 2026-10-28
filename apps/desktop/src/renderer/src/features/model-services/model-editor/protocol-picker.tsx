import { useState } from 'react';
import { protocolsForKind, getProtocol } from '@frame-loom/contracts';
import type { ModelKind } from '@frame-loom/contracts/model-service';
import { Input } from '@frame-loom/ui/components/input';

export function ProtocolPicker({
  kind,
  value,
  onChange,
}: {
  kind: ModelKind;
  value: string | null;
  onChange: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const current = value ? getProtocol(value) : undefined;
  const protocols = protocolsForKind(kind).filter((item) =>
    `${item.label} ${item.vendor} ${item.operations.submit?.path}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <section className="space-y-3" aria-label="请求协议">
      <h3 className="text-sm font-medium">请求协议</h3>
      <Input
        aria-label="搜索协议"
        placeholder="按名称、厂商或路径搜索"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="grid gap-3 rounded-xl border border-border p-3 md:grid-cols-2">
        <div role="radiogroup" aria-label="协议目录" className="max-h-64 space-y-1 overflow-y-auto">
          {protocols.map((item) => (
            <button
              type="button"
              role="radio"
              aria-checked={value === item.id}
              key={item.id}
              className={`block w-full rounded-lg p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring ${value === item.id ? 'bg-accent-active' : 'hover:bg-accent'}`}
              onClick={() => onChange(item.id)}
            >
              <span className="block text-sm font-medium">{item.label}</span>
              <span className="mt-1 block font-mono text-xs text-muted-foreground">
                {item.vendor} · POST {item.operations.submit?.path}
              </span>
              {item.notes?.map((note) => (
                <span key={note} className="mt-1 block text-xs text-muted-foreground">
                  {note}
                </span>
              ))}
            </button>
          ))}
        </div>
        <div className="space-y-2 text-xs text-muted-foreground">
          {current ? (
            <>
              <p className="font-medium text-foreground">{current.label}</p>
              <p>
                鉴权：{current.auth} · 标准前缀：{current.standardPrefix || '无'}
              </p>
              {Object.entries(current.operations).map(([key, spec]) => (
                <p key={key} className="font-mono break-all">
                  {spec.method} {spec.path}
                </p>
              ))}
              {current.sources.map((source) => (
                <a
                  key={source.url}
                  className="block break-all text-primary underline"
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  官方文档 · {source.checkedAt}
                </a>
              ))}
            </>
          ) : (
            <p>选择协议，查看请求格式与能力模板。</p>
          )}
        </div>
      </div>
    </section>
  );
}
