import { useRef, useState } from 'react';
import { ChevronRight, Palette, Settings } from 'lucide-react';
import { Popover } from 'radix-ui';
import { Button } from '@frame-loom/ui/components/button';
import { ThemeSwitch } from '@/features/theme/components/theme-switch';
import { cn } from '@frame-loom/ui/lib/utils';

export function SettingsMenu({
  collapsed,
  hasError,
  onSettings,
}: {
  collapsed: boolean;
  hasError: boolean;
  onSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const openingSettings = useRef(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          id="settings-button"
          variant="ghost"
          className={cn('relative gap-2.5 text-muted-foreground', collapsed && 'w-full px-0')}
          aria-label="设置中心"
        >
          <Settings aria-hidden="true" className="size-4" />
          {!collapsed && '设置中心'}
          {hasError && (
            <span
              role="img"
              aria-label="本地引擎连接失败"
              className="size-1.5 rounded-full bg-destructive"
            />
          )}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-label="快捷设置"
          side="top"
          align="start"
          sideOffset={10}
          collisionPadding={12}
          className="z-50 w-72 max-w-[calc(100vw-1.5rem)] rounded-2xl border bg-popover p-2 text-popover-foreground shadow-panel-focus outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-2"
          onCloseAutoFocus={(event) => {
            // 打开模态窗口时，焦点交给 Dialog，避免面板关闭后抢回入口。
            if (openingSettings.current) event.preventDefault();
            openingSettings.current = false;
          }}
        >
          <div className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="flex items-center gap-3 text-sm">
              <Palette aria-hidden="true" className="size-4 text-muted-foreground" />
              主题
            </span>
            <ThemeSwitch />
          </div>
          <Button
            variant="ghost"
            className="h-11 w-full justify-start gap-3 rounded-xl px-3 font-normal"
            onClick={() => {
              openingSettings.current = true;
              setOpen(false);
              onSettings();
            }}
          >
            <Settings aria-hidden="true" className="size-4 text-muted-foreground" />
            设置
            <ChevronRight aria-hidden="true" className="ml-auto size-4 text-muted-foreground" />
          </Button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
