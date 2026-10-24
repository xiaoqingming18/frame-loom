import { useState } from 'react';
import type { WindowCommand } from '@frame-loom/contracts';
import {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
} from '@/components/ui/menubar';
import { commandWindow } from '@/lib/desktop-bridge';

export function TitleBar({ onAbout }: { onAbout: () => void }) {
  const [error, setError] = useState('');
  async function command(name: WindowCommand) {
    try {
      await commandWindow(name);
      setError('');
    } catch {
      setError('窗口操作失败，请重试。');
    }
  }
  return (
    <header className="title-bar flex h-[42px] shrink-0 items-center gap-6 px-4 text-muted-foreground">
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
        <span role="alert" className="text-destructive">
          {error}
        </span>
      )}
    </header>
  );
}
