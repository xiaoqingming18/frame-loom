import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Folder, PanelLeft, Plus, Search, SquarePen } from 'lucide-react';
import logo from '@/assets/logo.png';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SettingsMenu } from './settings-menu';

export function Sidebar({ hasError, onSettings }: { hasError: boolean; onSettings: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <aside
      aria-label="侧栏"
      className={cn('flex shrink-0 flex-col', collapsed ? 'w-16' : 'w-[260px]')}
    >
      <div
        className={cn('flex items-center justify-between pt-3 pb-5', collapsed ? 'px-3' : 'px-4')}
      >
        {!collapsed && (
          <div className="flex items-center gap-2 font-serif text-[15px] font-semibold">
            <img src={logo} alt="" className="size-5 rounded-md" />
            Frame Loom
          </div>
        )}
        <div className="flex items-center gap-2 text-muted-foreground">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={collapsed ? '展开侧栏' : '折叠侧栏'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            <PanelLeft />
          </Button>
          {!collapsed && (
            <Button variant="ghost" size="icon-sm" aria-label="搜索（尚未开放）" disabled>
              <Search />
            </Button>
          )}
        </div>
      </div>
      <nav aria-label="主导航" className={cn('space-y-0.5', collapsed ? 'px-2' : 'px-3')}>
        {(
          [
            { to: '/', label: '开始创作', Icon: SquarePen },
            { to: '/projects', label: '项目库', Icon: Folder },
          ] as const
        ).map(({ to, label, Icon }) => (
          <Link
            key={to}
            to={to}
            search={{}}
            aria-label={label}
            title={collapsed ? label : undefined}
            activeOptions={{ exact: true }}
            activeProps={{ className: 'bg-accent-active', 'aria-current': 'page' }}
            className={cn(
              'flex items-center gap-3 rounded-lg py-2.5 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring',
              collapsed ? 'justify-center px-2' : 'px-3',
            )}
          >
            <Icon className="size-4 shrink-0" />
            {!collapsed && label}
          </Link>
        ))}
      </nav>
      {!collapsed && (
        <div className="flex items-center justify-between pt-5 pr-4 pb-2.5 pl-6 text-xs text-muted-foreground">
          <span>项目</span>
          <Button size="icon-sm" variant="ghost" aria-label="新建项目（尚未开放）" disabled>
            <Plus className="size-3.5" />
          </Button>
        </div>
      )}
      <div className="mt-auto px-3 py-3">
        <SettingsMenu collapsed={collapsed} hasError={hasError} onSettings={onSettings} />
      </div>
    </aside>
  );
}
