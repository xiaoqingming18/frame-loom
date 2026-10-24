import { useEffect, useState } from 'react';
import { Copy, Minus, Square, X } from 'lucide-react';
import type { WindowCommand } from '@frame-loom/contracts';
import { Button } from '@/components/ui/button';
import {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
} from '@/components/ui/menubar';
import { commandWindow, getWindowMaximized, onWindowMaximizedChanged } from '@/lib/desktop-bridge';

export function TitleBar({ onAbout }: { onAbout: () => void }) {
  const [error, setError] = useState('');
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let current = true;
    let changed = false;
    const unsubscribe = onWindowMaximizedChanged((value) => {
      changed = true;
      setMaximized(value);
    });
    void getWindowMaximized()
      .then((value) => {
        // 订阅先于查询，较早的查询结果不能覆盖其间收到的窗口事件。
        if (current && !changed) setMaximized(value);
      })
      .catch(() => {
        if (current && !changed) setError('窗口状态读取失败，请重试窗口操作。');
      });
    return () => {
      current = false;
      unsubscribe();
    };
  }, []);
  async function command(name: WindowCommand) {
    try {
      await commandWindow(name);
      setError('');
    } catch {
      setError('窗口操作失败，请重试。');
    }
  }
  return (
    <header className="title-bar flex h-[42px] shrink-0 items-center gap-6 pl-4 text-muted-foreground select-none">
      <span className="font-medium">Frame Loom</span>
      <Menubar className="h-auto gap-1 border-0 bg-transparent p-0 shadow-none">
        <MenubarMenu>
          <MenubarTrigger className="text-xs">文件</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={() => void command('quit')}>退出</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger className="text-xs">窗口</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={() => void command('minimize')}>最小化</MenubarItem>
            <MenubarItem onSelect={() => void command('toggle-maximize')}>
              最大化 / 还原
            </MenubarItem>
            <MenubarItem onSelect={() => void command('toggle-fullscreen')}>切换全屏</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger className="text-xs">帮助</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={onAbout}>关于 Frame Loom</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
      <div
        role="group"
        aria-label="窗口操作"
        className="window-controls pointer-events-auto relative z-[60] ml-auto flex h-full shrink-0"
      >
        <Button
          variant="ghost"
          aria-label="最小化窗口"
          title="最小化"
          className="h-full w-12 rounded-none px-0 hover:bg-accent hover:text-foreground"
          onClick={() => void command('minimize')}
        >
          <Minus aria-hidden="true" className="size-4" />
        </Button>
        <Button
          variant="ghost"
          aria-label={maximized ? '还原窗口' : '最大化窗口'}
          title={maximized ? '还原' : '最大化'}
          className="h-full w-12 rounded-none px-0 hover:bg-accent hover:text-foreground"
          onClick={() => void command('toggle-maximize')}
        >
          {maximized ? (
            <Copy aria-hidden="true" className="size-3.5" />
          ) : (
            <Square aria-hidden="true" className="size-3.5" />
          )}
        </Button>
        <Button
          variant="ghost"
          aria-label="关闭窗口"
          title="关闭"
          className="h-full w-12 rounded-none px-0 hover:bg-destructive hover:text-destructive-foreground dark:hover:bg-destructive"
          onClick={() => void command('close')}
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </header>
  );
}
