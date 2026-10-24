import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor, Moon, Sun } from 'lucide-react';
import { ThemeSource } from '@frame-loom/contracts';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Button } from '@/components/ui/button';
import { getTheme, setTheme } from '@/lib/desktop-bridge';

export function AppearanceSettings() {
  const queryClient = useQueryClient();
  const theme = useQuery({ queryKey: ['theme'], queryFn: getTheme });
  const change = useMutation({
    mutationFn: setTheme,
    onSuccess: (source) => queryClient.setQueryData(['theme'], source),
  });
  return (
    <section className="space-y-6" aria-labelledby="appearance-heading">
      <div>
        <h2 id="appearance-heading" className="text-base font-medium">
          外观
        </h2>
        <p className="mt-2 text-muted-foreground">选择工作台的显示主题，偏好会保存在此设备。</p>
      </div>
      {theme.isPending && <p role="status">正在读取主题…</p>}
      {theme.isError && (
        <div role="alert">
          <p>主题读取失败，请重试。</p>
          <Button variant="outline" onClick={() => void theme.refetch()}>
            重新读取
          </Button>
        </div>
      )}
      {theme.data && (
        <ToggleGroup
          type="single"
          variant="outline"
          aria-label="显示主题"
          value={theme.data}
          disabled={change.isPending}
          onValueChange={(value) => {
            if (value) change.mutate(ThemeSource.parse(value));
          }}
        >
          <ToggleGroupItem value="system" className="h-20 flex-col gap-2">
            <Monitor />
            跟随系统
          </ToggleGroupItem>
          <ToggleGroupItem value="light" className="h-20 flex-col gap-2">
            <Sun />
            明亮
          </ToggleGroupItem>
          <ToggleGroupItem value="dark" className="h-20 flex-col gap-2">
            <Moon />
            暗黑
          </ToggleGroupItem>
        </ToggleGroup>
      )}
      {change.isError && (
        <p role="alert" className="text-destructive">
          主题保存失败，请重试。
        </p>
      )}
    </section>
  );
}
