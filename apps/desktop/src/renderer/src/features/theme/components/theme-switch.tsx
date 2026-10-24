import { useMutationState, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor, Moon, Sun } from 'lucide-react';
import { ThemeSource } from '@frame-loom/contracts';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Button } from '@/components/ui/button';
import { getTheme, setTheme } from '@/lib/desktop-bridge';

export function ThemeSwitch() {
  const queryClient = useQueryClient();
  const theme = useQuery({ queryKey: ['theme'], queryFn: getTheme });
  const saves = useMutationState({
    filters: { mutationKey: ['theme'] },
    select: (mutation) => mutation.state.status,
  });
  const change = useMutation({
    mutationKey: ['theme'],
    mutationFn: setTheme,
    onSuccess: (source) => queryClient.setQueryData(['theme'], source),
  });
  return (
    <div className="shrink-0 space-y-2">
      {theme.isPending && (
        <p role="status" className="text-xs text-muted-foreground">
          正在读取主题…
        </p>
      )}
      {theme.isError && (
        <div role="alert" className="space-y-2 text-xs text-destructive">
          <p>主题读取失败，请重试。</p>
          <Button size="sm" variant="outline" onClick={() => void theme.refetch()}>
            重新读取
          </Button>
        </div>
      )}
      {theme.data && (
        <ToggleGroup
          type="single"
          size="sm"
          spacing={1}
          aria-label="显示主题"
          className="rounded-xl bg-muted p-1"
          value={theme.data}
          disabled={saves.includes('pending')}
          onValueChange={(value) => {
            if (value) change.mutate(ThemeSource.parse(value));
          }}
        >
          {(
            [
              { value: 'dark', label: '暗黑', Icon: Moon },
              { value: 'light', label: '明亮', Icon: Sun },
              { value: 'system', label: '跟随系统', Icon: Monitor },
            ] as const
          ).map(({ value, label, Icon }) => (
            <ToggleGroupItem
              key={value}
              value={value}
              aria-label={label}
              title={label}
              className="size-8 rounded-lg px-0 text-muted-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm"
            >
              <Icon aria-hidden="true" />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
      {saves.at(-1) === 'error' && (
        <p role="alert" className="text-xs text-destructive">
          主题保存失败，请重试。
        </p>
      )}
    </div>
  );
}
